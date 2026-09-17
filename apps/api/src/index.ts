import express from "express";
import { withScope, getPool, verifyAuditChain, appendAudit as appendAuditRecord } from "@pmp/db";
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
import { srrDashboard, checkIn, checkinDetail, usbIngest, signOff, depart } from "./services/srr.ts";
import {
  presentationDetail,
  findingsFor,
  waiveFinding,
  addComment,
  requestRevisionFromFinding,
  rollBack,
} from "./services/presentation.ts";
import type { Lane } from "./services/presentation.ts";
import { buildPreview, commitImport, autoMap } from "./services/scheduleImport.ts";
import {
  scopePreview,
  buildPackage,
  deliverPackage,
  downloadPackage,
  latestPackage,
} from "./services/archive.ts";
import type { ImportField, StagedRow } from "./services/scheduleImport.ts";
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
const IMPORT_FIELD_LIST = [
  "session.title",
  "room.name",
  "session.date",
  "session.start",
  "session.end",
  "speaker.name",
  "speaker.email",
  "speaker.organization",
  "track.name",
];

function actorFrom(req: express.Request): Actor | undefined {
  const key = String(req.header("x-dev-user") ?? "reviewer");
  return DEV_USERS[key];
}

const statusFor = (error: DomainError): number => {
  if (error.code.endsWith("_not_found") || error.code.endsWith(".not_found")) return 404;
  if (
    error.code.endsWith(".reason_required") ||
    error.code.endsWith(".not_signable") ||
    error.code.endsWith(".already_waived") ||
    error.code.endsWith(".target_not_restorable") ||
    error.code.endsWith(".nothing_to_roll_back")
  ) {
    return 422;
  }
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
      `SELECT sp.id, sp.full_name, sp.email::text, sp.organization, sp.release_permission,
              count(DISTINCT sa.id)::int AS talks,
              count(DISTINCT fv.file_id) FILTER (WHERE fv.review_state = 'approved')::int AS approved,
              count(DISTINCT f.id)::int AS with_files
         FROM pmp.speakers sp
         LEFT JOIN pmp.speaker_assignments sa ON sa.speaker_id = sp.id
         LEFT JOIN pmp.files f ON f.slot_id = sa.slot_id
         LEFT JOIN pmp.file_versions fv ON fv.file_id = f.id
        WHERE sp.event_id = $1 AND sp.merged_into IS NULL
          AND ($2 = '' OR sp.full_name ILIKE '%' || $2 || '%'
               OR COALESCE(sp.organization,'') ILIKE '%' || $2 || '%'
               OR COALESCE(sp.email::text,'') ILIKE '%' || $2 || '%')
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

/* ── Speaker Ready Room (screens 11–13) ───────────────────────────────────── */

app.get("/api/v1/events/:eventId/srr", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const eventId = String(req.params.eventId);
  const view = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID, eventId }, (tx) =>
    srrDashboard(tx, eventId),
  );
  return res.json(view);
});

app.post("/api/v1/events/:eventId/srr/checkins", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const body = req.body as { speaker_id?: string; station?: string };
  if (!body.speaker_id) {
    return res.status(400).json({ code: "request.invalid", message: "`speaker_id` is required." });
  }
  const result = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID }, (tx) =>
    checkIn(tx, actor, {
      eventId: String(req.params.eventId),
      speakerId: body.speaker_id as string,
      station: body.station ?? "Station 2",
    }),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.status(201).json(result.value);
});

app.get("/api/v1/srr/checkins/:checkinId", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const detail = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID }, (tx) =>
    checkinDetail(tx, String(req.params.checkinId)),
  );
  if (!detail) return res.status(404).json({ code: "srr.checkin_not_found", message: "No such check-in." });
  return res.json(detail);
});

/** Staff-side resumable upload, used by USB intake (the portal has its own). */
app.post("/api/v1/srr/uploads", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  return res.status(201).json({ upload_id: randomUUID(), part_size: 5 * 1024 * 1024 });
});

app.put("/api/v1/srr/uploads/:uploadId/parts/:partNumber", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const body = req.body as Buffer;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    return res.status(400).json({ code: "request.invalid", message: "Empty part." });
  }
  const { sha256 } = await storage.putPart(String(req.params.uploadId), Number(req.params.partNumber), body);
  return res.json({ size: body.length, sha256 });
});

app.post("/api/v1/srr/checkins/:checkinId/usb-ingestions", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const body = req.body as { upload_id?: string; file_name?: string; reason?: string };
  if (!body.upload_id || !body.file_name) {
    return res.status(400).json({ code: "request.invalid", message: "`upload_id` and `file_name` are required." });
  }
  const result = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID }, (tx) =>
    usbIngest(tx, actor, {
      checkinId: String(req.params.checkinId),
      uploadId: body.upload_id as string,
      fileName: body.file_name as string,
      reason: body.reason ?? "",
    }),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json(result.value);
});

app.post("/api/v1/srr/checkins/:checkinId/sign-off", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const body = req.body as { file_version_id?: string };
  if (!body.file_version_id) {
    return res.status(400).json({ code: "request.invalid", message: "`file_version_id` is required." });
  }
  const result = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID }, (tx) =>
    signOff(tx, actor, {
      checkinId: String(req.params.checkinId),
      fileVersionId: body.file_version_id as string,
    }),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json(result.value);
});

app.post("/api/v1/srr/checkins/:checkinId/depart", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const result = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID }, (tx) =>
    depart(tx, actor, String(req.params.checkinId)),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json(result.value);
});

/* ── presentation detail & inspection (screens 6 and 7) ──────────────────── */

app.get("/api/v1/slots/:slotId", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const detail = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID }, (tx) =>
    presentationDetail(tx, String(req.params.slotId)),
  );
  if (!detail) return res.status(404).json({ code: "slots.not_found", message: "No such talk." });
  return res.json(detail);
});

app.get("/api/v1/file-versions/:versionId/findings", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const items = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID }, (tx) =>
    findingsFor(tx, String(req.params.versionId)),
  );
  return res.json({ items });
});

app.post("/api/v1/findings/:findingId/waive", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const body = req.body as { reason?: string };
  const result = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID }, (tx) =>
    waiveFinding(tx, actor, { findingId: String(req.params.findingId), reason: body.reason ?? "" }),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json(result.value);
});

app.get("/api/v1/file-versions/:versionId/comments", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  // Lane visibility: staff see every lane here; speaker and client surfaces are
  // filtered at their own endpoints (FR-REV-003).
  const items = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID }, async (tx) => {
    const { rows } = await tx.query(
      `SELECT c.id, c.lane, c.body, c.created_at, u.display_name AS author
         FROM pmp.comments c LEFT JOIN pmp.users u ON u.id = c.author_user_id
        WHERE c.file_version_id = $1 ORDER BY c.created_at`,
      [String(req.params.versionId)],
    );
    return rows;
  });
  return res.json({ items });
});

app.post("/api/v1/file-versions/:versionId/comments", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const body = req.body as { lane?: string; body?: string };
  const lanes = ["internal", "client_visible", "speaker_visible"];
  if (!body.lane || !lanes.includes(body.lane)) {
    return res.status(400).json({ code: "request.invalid", message: `lane must be one of ${lanes.join(", ")}.` });
  }
  const result = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID }, (tx) =>
    addComment(tx, actor, {
      versionId: String(req.params.versionId),
      lane: body.lane as Lane,
      body: body.body ?? "",
    }),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.status(201).json(result.value);
});

app.post("/api/v1/file-versions/:versionId/request-revision", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const body = req.body as { finding_id?: string; note?: string };
  if (!body.note) {
    return res.status(400).json({ code: "request.invalid", message: "`note` is required." });
  }
  const result = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID }, (tx) =>
    requestRevisionFromFinding(tx, actor, {
      versionId: String(req.params.versionId),
      findingId: body.finding_id ?? "",
      note: body.note as string,
    }),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json(result.value);
});

app.post("/api/v1/slots/:slotId/roll-back", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const body = req.body as { target_version_id?: string; reason?: string };
  if (!body.target_version_id) {
    return res.status(400).json({ code: "request.invalid", message: "`target_version_id` is required." });
  }
  const result = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID }, (tx) =>
    rollBack(tx, actor, {
      slotId: String(req.params.slotId),
      targetVersionId: body.target_version_id as string,
      reason: body.reason ?? "",
    }),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json(result.value);
});

/** Duplicate detection + merge (FR-SPK-003). */
app.get("/api/v1/events/:eventId/speaker-duplicates", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const eventId = String(req.params.eventId);
  const items = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID, eventId }, async (tx) => {
    const { rows } = await tx.query(
      `SELECT a.id AS a_id, a.full_name AS a_name, a.email::text AS a_email,
              b.id AS b_id, b.full_name AS b_name, b.email::text AS b_email,
              CASE WHEN lower(a.email::text) = lower(b.email::text) THEN 'same email'
                   ELSE 'same name and organization' END AS reason
         FROM pmp.speakers a
         JOIN pmp.speakers b
           ON b.event_id = a.event_id AND b.id > a.id AND b.merged_into IS NULL
          AND (lower(a.email::text) = lower(b.email::text)
               OR (lower(a.full_name) = lower(b.full_name)
                   AND COALESCE(lower(a.organization),'') = COALESCE(lower(b.organization),'')))
        WHERE a.event_id = $1 AND a.merged_into IS NULL`,
      [eventId],
    );
    return rows;
  });
  return res.json({ items });
});

app.post("/api/v1/speakers/:speakerId/merge", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const body = req.body as { into?: string };
  if (!body.into) {
    return res.status(400).json({ code: "request.invalid", message: "`into` is required." });
  }
  const survivor = body.into;
  const merged = String(req.params.speakerId);
  if (survivor === merged) {
    return res.status(422).json({ code: "speakers.same", message: "A speaker cannot be merged into itself." });
  }

  const result = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID }, async (tx) => {
    const { rows } = await tx.query<{ event_id: string; client_id: string }>(
      `SELECT event_id, client_id FROM pmp.speakers WHERE id = $1 AND merged_into IS NULL`,
      [merged],
    );
    if (!rows[0]) return null;

    // Assignments move to the survivor; both file histories stay reachable
    // because files hang off slots, not speakers.
    await tx.query(
      `UPDATE pmp.speaker_assignments sa SET speaker_id = $1
        WHERE sa.speaker_id = $2
          AND NOT EXISTS (SELECT 1 FROM pmp.speaker_assignments other
                           WHERE other.speaker_id = $1 AND other.slot_id = sa.slot_id)`,
      [survivor, merged],
    );
    await tx.query(`DELETE FROM pmp.speaker_assignments WHERE speaker_id = $1`, [merged]);
    await tx.query(`UPDATE pmp.speaker_tokens SET revoked_at = now() WHERE speaker_id = $1`, [merged]);
    await tx.query(
      `UPDATE pmp.speakers SET merged_into = $1, lock_version = lock_version + 1 WHERE id = $2`,
      [survivor, merged],
    );
    await appendAuditRecord(tx, {
      partitionId: rows[0].event_id,
      clientId: rows[0].client_id,
      actorUserId: actor.id,
      action: "speakers.merged",
      subjectType: "speaker",
      subjectId: merged,
      detail: { merged_into: survivor },
    });
    return { merged_into: survivor };
  });

  if (!result) return res.status(404).json({ code: "speakers.not_found", message: "No such speaker." });
  return res.json(result);
});

/* ── schedule import (screen 3) ──────────────────────────────────────────── */

const importCache = new Map<string, { eventId: string; fileName: string; body: Buffer }>();

app.post("/api/v1/events/:eventId/imports", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const fileName = String(req.header("x-file-name") ?? "agenda.csv");
  const body = req.body as Buffer;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    return res.status(400).json({ code: "request.invalid", message: "Empty file." });
  }

  const eventId = String(req.params.eventId);
  const uploadId = randomUUID();
  importCache.set(uploadId, { eventId, fileName, body });

  const result = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID, eventId }, (tx) =>
    buildPreview(tx, { eventId, fileName, body, actorId: actor.id, s3Key: `imports/${uploadId}` }),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.status(201).json({ ...result.value, upload_id: uploadId });
});

/** Re-map columns and re-validate without re-uploading the file. */
app.post("/api/v1/imports/:uploadId/remap", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const cached = importCache.get(String(req.params.uploadId));
  if (!cached) return res.status(404).json({ code: "import.expired", message: "Upload the file again." });
  const body = req.body as { mapping?: (ImportField | null)[] };

  const result = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID, eventId: cached.eventId }, (tx) =>
    buildPreview(tx, {
      eventId: cached.eventId,
      fileName: cached.fileName,
      body: cached.body,
      actorId: actor.id,
      s3Key: `imports/${String(req.params.uploadId)}`,
      ...(body.mapping ? { mapping: body.mapping } : {}),
    }),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json({ ...result.value, upload_id: String(req.params.uploadId) });
});

app.post("/api/v1/imports/:importId/commit", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const body = req.body as { event_id?: string; rows?: StagedRow[] };
  if (!body.event_id || !Array.isArray(body.rows)) {
    return res.status(400).json({ code: "request.invalid", message: "`event_id` and `rows` are required." });
  }
  const result = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID, eventId: body.event_id }, (tx) =>
    commitImport(tx, actor, {
      eventId: body.event_id as string,
      importId: String(req.params.importId),
      rows: body.rows as StagedRow[],
    }),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json(result.value);
});

app.get("/api/v1/import-fields", (_req, res) =>
  res.json({ fields: autoMap([]).length === 0 ? IMPORT_FIELD_LIST : IMPORT_FIELD_LIST }),
);

/* ── archive builder (screen 10) and client portal (screen 17) ───────────── */

app.get("/api/v1/events/:eventId/archive/scope", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const eventId = String(req.params.eventId);
  const scope = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID, eventId }, (tx) =>
    scopePreview(tx, eventId),
  );
  const latest = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID, eventId }, (tx) =>
    latestPackage(tx, eventId),
  );
  return res.json({ ...scope, latest_package: latest });
});

app.post("/api/v1/events/:eventId/archive-packages", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const eventId = String(req.params.eventId);
  const result = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID, eventId }, (tx) =>
    buildPackage(tx, actor, eventId),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.status(201).json(result.value);
});

app.post("/api/v1/archive-packages/:packageId/deliver", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const body = req.body as { days?: number };
  const result = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID }, (tx) =>
    deliverPackage(tx, actor, String(req.params.packageId), body.days ?? 7),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json(result.value);
});

app.get("/api/v1/archive-packages/:packageId/download", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const result = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID }, (tx) =>
    downloadPackage(tx, actor, String(req.params.packageId)),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  res.setHeader("content-type", "application/zip");
  res.setHeader("content-disposition", `attachment; filename="${result.value.filename}"`);
  return res.send(result.value.body);
});

/**
 * Client portal (screen 17). A distinct surface: read-only, restricted talks
 * excluded from every count as well as from the package, and scoped reviewers
 * see only what they are assigned (NFR-SEC-03).
 */
app.get("/api/v1/client/events/:eventId", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const clientRoles = ["client_event_admin", "scoped_reviewer"];
  if (!actor.roles.some((role) => clientRoles.includes(role))) {
    return res.status(403).json({
      code: "auth.not_a_client_role",
      message: "The client portal is for client event admins and scoped reviewers.",
    });
  }

  const eventId = String(req.params.eventId);
  const data = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID, eventId }, async (tx) => {
    const { rows: eventRows } = await tx.query(
      `SELECT e.id, e.name, e.starts_on::text, e.ends_on::text, c.name AS client_name
         FROM pmp.events e JOIN pmp.clients c ON c.id = e.client_id WHERE e.id = $1`,
      [eventId],
    );

    // Restricted talks are excluded from what the client sees, not just from
    // the package (FR-ARCH-001, SCREEN_SPECS §17).
    const { rows: totals } = await tx.query<{ total: string; collected: string; approved: string }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM pmp.files f JOIN pmp.file_versions fv ON fv.file_id = f.id
                 WHERE f.slot_id = s.id))::text AS collected,
              count(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM pmp.files f JOIN pmp.file_versions fv ON fv.file_id = f.id
                 WHERE f.slot_id = s.id AND fv.review_state = 'approved'))::text AS approved
         FROM pmp.slots s WHERE s.event_id = $1 AND s.restricted = false`,
      [eventId],
    );

    const { rows: tracks } = await tx.query<{ track: string; total: string; collected: string }>(
      `SELECT COALESCE(t.name, 'Unassigned') AS track, count(*)::text AS total,
              count(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM pmp.files f JOIN pmp.file_versions fv ON fv.file_id = f.id
                 WHERE f.slot_id = s.id))::text AS collected
         FROM pmp.slots s
         JOIN pmp.sessions se ON se.id = s.session_id
         LEFT JOIN pmp.tracks t ON t.id = se.track_id
        WHERE s.event_id = $1 AND s.restricted = false
        GROUP BY COALESCE(t.name, 'Unassigned')
        ORDER BY 1`,
      [eventId],
    );

    return { event: eventRows[0], totals: totals[0], tracks, package: await latestPackage(tx, eventId) };
  });

  return res.json(data);
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.error(`api listening on http://localhost:${port}`);
});
