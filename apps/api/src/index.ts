import express from "express";
import { withScope, getPool, verifyAuditChain } from "@pmp/db";
import type { Actor, DomainError, ReviewAction } from "@pmp/domain";
import { listTalks } from "./services/talks.ts";
import { eventSummary, riskList, reviewQueue, syncFleet } from "./services/queries.ts";
import {
  resolveToken,
  portalTalks,
  beginUpload,
  uploadState,
  completeUpload,
  storage,
  hashToken,
} from "./services/portal.ts";
import { randomUUID } from "node:crypto";
import { agentView, syncRoom, acknowledge, launch } from "./services/agent.ts";
import type { PortalSession } from "./services/portal.ts";
import { decide } from "./services/review.ts";

const app = express();
app.use(express.json());
app.use((_req, res, next) => {
  // Dev only: the control center runs on a different port until they are served together.
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "content-type, x-dev-user, authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  next();
});
app.options(/.*/, (_req, res) => res.sendStatus(204));

/** M0 stand-in for OIDC (M1-1 replaces it). Never shipped beyond local dev. */
const DEV_USERS: Record<string, Actor> = {
  pm: { id: "33333333-3333-4333-8333-333333333331", roles: ["presentation_manager"] },
  reviewer: { id: "33333333-3333-4333-8333-333333333332", roles: ["content_reviewer"] },
  room_tech: { id: "33333333-3333-4333-8333-333333333333", roles: ["room_technician"] },
  client: { id: "33333333-3333-4333-8333-333333333334", roles: ["client_event_admin"] },
};
const DEV_CLIENT_ID = "11111111-1111-4111-8111-111111111111";

function actorFrom(req: express.Request): Actor | undefined {
  const key = String(req.header("x-dev-user") ?? "reviewer");
  return DEV_USERS[key];
}

const statusFor = (error: DomainError): number => {
  if (error.code.endsWith(".not_found")) return 404;
  if (error.code.endsWith(".conflict")) return 409;
  if (error.code.endsWith(".forbidden") || error.code.endsWith(".override_forbidden")) return 403;
  if (error.code.endsWith(".illegal_transition")) return 422;
  return 400;
};

app.get("/ops/health", async (_req, res) => {
  try {
    await getPool().query("SELECT 1");
    res.json({ status: "ok", database: "up" });
  } catch {
    res.status(503).json({ status: "degraded", database: "down" });
  }
});

app.get("/api/v1/events", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const items = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID }, async (tx) => {
    const { rows } = await tx.query(
      `SELECT id, name, starts_on::text, ends_on::text, timezone, status
         FROM pmp.events ORDER BY starts_on DESC`,
    );
    return rows;
  });
  return res.json({ items, next_cursor: null });
});

app.get("/api/v1/events/:eventId/talks", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const eventId = String(req.params.eventId);
  const items = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID, eventId }, (tx) =>
    listTalks(tx, eventId),
  );
  return res.json({ items, next_cursor: null });
});

/**
 * The API surface spells actions as an `:action` suffix (api/openapi.yaml, an
 * AIP-style custom method). That colon is not a path separator, so the whole
 * `<id>:<action>` segment is captured as one param and split here.
 */
const splitAction = (segment: string): { id: string; action: string } => {
  const index = segment.lastIndexOf(":");
  return index < 0
    ? { id: segment, action: "" }
    : { id: segment.slice(0, index), action: segment.slice(index + 1) };
};

app.post("/api/v1/file-versions/:versionAndAction", async (req, res) => {
  const { id: versionId, action: customMethod } = splitAction(String(req.params.versionAndAction));
  if (customMethod !== "transition") {
    return res.status(404).json({ code: "request.unknown_method", message: "Unknown method." });
  }
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });

  const body = req.body as { action?: string; lock_version?: number; reason?: string };
  if (typeof body.action !== "string" || typeof body.lock_version !== "number") {
    return res.status(400).json({
      code: "request.invalid",
      message: "`action` and `lock_version` are required (BUILD_SPEC §6.3).",
    });
  }

  try {
    const result = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID }, (tx) =>
      decide(tx, {
        versionId,
        action: body.action as ReviewAction,
        actor,
        lockVersion: body.lock_version as number,
        ...(body.reason === undefined ? {} : { reason: body.reason }),
      }),
    );
    if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
    return res.json(result.value);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ code: "internal", message: "Unexpected failure." });
  }
});

app.get("/api/v1/events/:eventId/:auditAndAction", async (req, res, next) => {
  // This pattern also matches sibling routes such as /summary, so anything that
  // is not the `audit:verify` custom method is handed on to them.
  const { id: resource, action: customMethod } = splitAction(String(req.params.auditAndAction));
  if (resource !== "audit" || customMethod !== "verify") return next();
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const eventId = String(req.params.eventId);
  const verdict = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID, eventId }, (tx) =>
    verifyAuditChain(tx, eventId),
  );
  return res.json(verdict);
});

app.get("/api/v1/events/:eventId/summary", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const eventId = String(req.params.eventId);
  const summary = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID, eventId }, (tx) =>
    eventSummary(tx, eventId),
  );
  if (!summary) return res.status(404).json({ code: "events.not_found", message: "No such event." });
  return res.json(summary);
});

app.get("/api/v1/events/:eventId/risk-list", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const eventId = String(req.params.eventId);
  const items = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID, eventId }, (tx) =>
    riskList(tx, eventId),
  );
  return res.json({ items, next_cursor: null });
});

app.get("/api/v1/events/:eventId/review-queue", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const eventId = String(req.params.eventId);
  const items = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID, eventId }, (tx) =>
    reviewQueue(tx, eventId),
  );
  return res.json({ items, next_cursor: null });
});

app.get("/api/v1/events/:eventId/sync/fleet", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const eventId = String(req.params.eventId);
  const items = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID, eventId }, (tx) =>
    syncFleet(tx, eventId),
  );
  return res.json({ items, next_cursor: null });
});

/**
 * Agent heartbeat (FR-AGT-001). Device-credential auth arrives with M5-1; for now
 * the agent identifies itself by room, which is enough to drive room readiness.
 */
app.post("/api/v1/agent/heartbeat", async (req, res) => {
  const body = req.body as { room_id?: string; agent_version?: string };
  if (typeof body.room_id !== "string") {
    return res.status(400).json({ code: "request.invalid", message: "`room_id` is required." });
  }
  const updated = await withScope({ userId: DEV_USERS.pm!.id, clientId: DEV_CLIENT_ID }, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE pmp.room_agents SET last_heartbeat_at = now(), agent_version = COALESCE($2, agent_version)
        WHERE room_id = $1 AND revoked_at IS NULL`,
      [body.room_id, body.agent_version ?? null],
    );
    return rowCount ?? 0;
  });
  if (updated === 0) {
    return res.status(404).json({ code: "agent.not_registered", message: "No agent for that room." });
  }
  return res.json({ acknowledged: true, at: new Date().toISOString() });
});

/* ── room agent (screen 15; M5 builds the Windows client itself) ──────────── */

app.get("/api/v1/rooms/:roomId/agent-view", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const roomId = String(req.params.roomId);
  const view = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID }, (tx) => agentView(tx, roomId));
  if (!view) return res.status(404).json({ code: "agent.room_not_found", message: "No such room." });
  return res.json(view);
});

app.post("/api/v1/rooms/:roomId/sync", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const roomId = String(req.params.roomId);
  const result = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID }, async (tx) => {
    await tx.query(
      `UPDATE pmp.room_agents SET last_heartbeat_at = now() WHERE room_id = $1 AND revoked_at IS NULL`,
      [roomId],
    );
    return syncRoom(tx, actor, roomId);
  });
  return res.json(result);
});

app.post("/api/v1/room-files/:roomFileId/acknowledge", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const body = req.body as { lock_version?: number };
  if (typeof body.lock_version !== "number") {
    return res.status(400).json({ code: "request.invalid", message: "`lock_version` is required." });
  }
  const result = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID }, (tx) =>
    acknowledge(tx, actor, String(req.params.roomFileId), body.lock_version as number),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json(result.value);
});

app.post("/api/v1/rooms/:roomId/launch", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const body = req.body as { slot_id?: string };
  if (!body.slot_id) {
    return res.status(400).json({ code: "request.invalid", message: "`slot_id` is required." });
  }
  const result = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID }, (tx) =>
    launch(tx, actor, { roomId: String(req.params.roomId), slotId: body.slot_id as string }),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json(result.value);
});

app.get("/api/v1/events/:eventId/speakers", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const eventId = String(req.params.eventId);
  const query = String(req.query.q ?? "");
  const items = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID, eventId }, async (tx) => {
    const { rows } = await tx.query(
      `SELECT sp.id, sp.full_name, sp.email::text, sp.release_permission,
              count(sa.id)::int AS talks
         FROM pmp.speakers sp
         LEFT JOIN pmp.speaker_assignments sa ON sa.speaker_id = sp.id
        WHERE sp.event_id = $1 AND sp.merged_into IS NULL
          AND ($2 = '' OR sp.full_name ILIKE '%' || $2 || '%')
        GROUP BY sp.id
        ORDER BY sp.full_name`,
      [eventId, query],
    );
    return rows;
  });
  return res.json({ items, next_cursor: null });
});

/* ── speaker portal (M06) — speaker-token auth only ───────────────────────── */

app.use(express.raw({ type: "application/octet-stream", limit: "64mb" }));

const bearer = (req: express.Request): string | null => {
  const header = req.header("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
};

async function withPortalSession(
  req: express.Request,
  res: express.Response,
  fn: (session: PortalSession, tx: Parameters<Parameters<typeof withScope>[1]>[0]) => Promise<unknown>,
): Promise<unknown> {
  const token = bearer(req);
  if (!token) return res.status(401).json({ code: "portal.no_token", message: "Missing access token." });
  return withScope({ userId: DEV_USERS.pm!.id, clientId: DEV_CLIENT_ID }, async (tx) => {
    const session = await resolveToken(tx, token);
    if (!session) {
      return res.status(401).json({
        code: "portal.invalid_token",
        message: "This link has expired or been revoked. Ask the DXG team for a new one.",
      });
    }
    return fn(session, tx);
  });
}

/** Issues a speaker link. In production this is sent by the comms batch (M3-5). */
app.post("/api/v1/speakers/:speakerId/invite", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const speakerId = String(req.params.speakerId);
  const token = randomUUID();
  const issued = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID }, async (tx) => {
    const { rows } = await tx.query<{ event_id: string }>(
      `SELECT event_id FROM pmp.speakers WHERE id = $1`,
      [speakerId],
    );
    if (!rows[0]) return null;
    await tx.query(
      `INSERT INTO pmp.speaker_tokens (speaker_id, event_id, client_id, kind, token_hash, expires_at)
       VALUES ($1, $2, $3, 'magic_link', $4, now() + interval '30 days')`,
      [speakerId, rows[0].event_id, DEV_CLIENT_ID, hashToken(token)],
    );
    return rows[0].event_id;
  });
  if (!issued) return res.status(404).json({ code: "speakers.not_found", message: "No such speaker." });
  return res.status(201).json({ token, url: `http://localhost:3001/t/${token}` });
});

app.get("/api/v1/portal/session", (req, res) =>
  withPortalSession(req, res, async (session) =>
    res.json({
      speaker: { id: session.speaker_id, name: session.speaker_name },
      event: { id: session.event_id, name: session.event_name, timezone: session.timezone },
    }),
  ),
);

app.get("/api/v1/portal/talks", (req, res) =>
  withPortalSession(req, res, async (session, tx) => res.json({ items: await portalTalks(tx, session) })),
);

app.post("/api/v1/portal/uploads", (req, res) =>
  withPortalSession(req, res, async (session, tx) => {
    const body = req.body as { slot_id?: string; file_name?: string; total_bytes?: number };
    if (!body.slot_id || !body.file_name || typeof body.total_bytes !== "number") {
      return res.status(400).json({
        code: "request.invalid",
        message: "`slot_id`, `file_name` and `total_bytes` are required.",
      });
    }
    const result = await beginUpload(tx, session, {
      slotId: body.slot_id,
      fileName: body.file_name,
      totalBytes: body.total_bytes,
    });
    if (!result.ok) return res.status(422).json({ code: result.code, message: result.message });
    return res.status(201).json(result.value);
  }),
);

/** Resume: the client asks which parts already landed and continues from there. */
app.get("/api/v1/portal/uploads/:uploadId", (req, res) =>
  withPortalSession(req, res, async () => res.json(await uploadState(String(req.params.uploadId)))),
);

app.put("/api/v1/portal/uploads/:uploadId/parts/:partNumber", (req, res) =>
  withPortalSession(req, res, async () => {
    const part = Number(req.params.partNumber);
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return res.status(400).json({ code: "request.invalid", message: "Empty part." });
    }
    const { sha256 } = await storage.putPart(String(req.params.uploadId), part, body);
    return res.json({ part_number: part, size: body.length, sha256 });
  }),
);

app.post("/api/v1/portal/uploads/:uploadId/complete", (req, res) =>
  withPortalSession(req, res, async (session, tx) => {
    const body = req.body as { slot_id?: string; file_name?: string; sha256?: string };
    if (!body.slot_id || !body.file_name) {
      return res.status(400).json({ code: "request.invalid", message: "`slot_id` and `file_name` are required." });
    }
    const result = await completeUpload(tx, session, {
      uploadId: String(req.params.uploadId),
      slotId: body.slot_id,
      fileName: body.file_name,
      ...(body.sha256 ? { expectedSha256: body.sha256 } : {}),
    });
    if (!result.ok) return res.status(422).json({ code: result.code, message: result.message });
    return res.json(result.value);
  }),
);

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.error(`api listening on http://localhost:${port}`);
});
