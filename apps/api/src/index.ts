import express from "express";
import { withScope, withSystemScope, getPool, verifyAuditChain, appendAudit as appendAuditRecord } from "@pmp/db";
import type { Actor, DomainError, EventRole, ReviewAction } from "@pmp/domain";
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
import {
  SESSION_COOKIE,
  staffLogin,
  completeMfaLogin,
  presenterLogin,
  resolveSession,
  logout as endSession,
  createStaffUser,
  changeOwnPassword,
  issuePresenterCredential,
  revokePresenterCredential,
} from "./services/auth.ts";
import type { Principal } from "./services/auth.ts";
import { startEnrolment, confirmEnrolment, disableMfa, answerChallenge } from "./services/mfa.ts";

/** Carries the half-finished sign-in between the password and the code. */
const MFA_COOKIE = "pmp_mfa";
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
  createEvent,
  configureEvent,
  draftOf,
  activateEvent,
  duplicateEvent,
  supportedTimezones,
} from "./services/events.ts";
import {
  ensureTemplates,
  recipientsFor,
  sendBatch,
  deliveryLog,
  deliveryStats,
  recordDeliveryEvent,
} from "./services/comms.ts";
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
app.use((req, res, next) => {
  // Dev only: the control center runs on a different port until they are served together.
  // Credentialed requests cannot use a wildcard origin.
  const origin = req.header("origin");
  if (origin) res.header("Access-Control-Allow-Origin", origin);
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Headers", "content-type, authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  next();
});
app.options(/.*/, (_req, res) => res.sendStatus(204));

const readCookie = (req: express.Request, name: string): string | null => {
  const header = req.header("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
};

const cookieOptions = (maxAgeMinutes: number) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: maxAgeMinutes * 60_000,
});

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

/** The signed-in staff member, or nobody. A presenter is never a staff actor. */
function actorFrom(req: express.Request): Actor | undefined {
  const principal = (req as express.Request & { principal?: Principal }).principal;
  if (principal?.kind !== "staff") return undefined;
  return { id: principal.user_id, roles: principal.roles };
}

/**
 * The database scope a request runs in. DXG staff work across every client;
 * a client-side account is pinned to the clients it actually holds a role on,
 * so RLS — not a hardcoded id — decides what it can see.
 */
function scopeFor(req: express.Request, eventId?: string): {
  userId: string;
  clientId?: string;
  eventId?: string;
  allClients?: boolean;
} {
  const principal = (req as express.Request & { principal?: Principal }).principal;
  if (principal?.kind !== "staff") throw new Error("scopeFor requires a staff principal");

  const isStaff = principal.roles.some((role) => STAFF_ROLES.includes(role));
  return {
    userId: principal.user_id,
    ...(eventId ? { eventId } : {}),
    ...(isStaff ? { allClients: true } : { clientId: principal.client_ids[0] ?? "" }),
  };
}

/** Attaches the signed-in principal, if there is one, to every request. */
app.use(async (req, _res, next) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return next();
  try {
    const principal = await withSystemScope((tx) =>
      resolveSession(tx, token),
    );
    if (principal) (req as express.Request & { principal?: Principal }).principal = principal;
  } catch (error) {
    console.error("session resolution failed", error);
  }
  return next();
});

/**
 * Deny by default on the staff surface. Signing in is not authorisation: a
 * client event admin is a real account with a real session, and must still be
 * refused every staff endpoint. Only the paths below are open to non-staff.
 */
const STAFF_ROLES: EventRole[] = [
  "platform_admin",
  "project_manager",
  "presentation_manager",
  "srr_technician",
  "room_technician",
  "content_reviewer",
];

const NON_STAFF_PATHS = [
  "/api/v1/auth/mfa/",
  "/api/v1/auth/login",
  "/api/v1/auth/logout",
  "/api/v1/auth/session",
  "/api/v1/auth/password",
  "/api/v1/portal/",
  "/api/v1/client/",
  "/api/v1/webhooks/",
  "/api/v1/agent/",
  "/ops/",
];

app.use((req, res, next) => {
  if (!req.path.startsWith("/api/v1/") && !req.path.startsWith("/ops/")) return next();
  if (req.method === "OPTIONS") return next();
  if (NON_STAFF_PATHS.some((prefix) => req.path.startsWith(prefix))) return next();

  const actor = actorFrom(req);
  if (!actor) {
    return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  }
  if (!actor.roles.some((role) => STAFF_ROLES.includes(role))) {
    return res.status(403).json({
      code: "auth.not_staff",
      message: "This is a DXG staff area. Your account does not have a staff role on this event.",
    });
  }

  // NFR-SEC-02: staff accounts carry a second factor. An account that has not
  // enrolled can reach the enrolment endpoints and nothing else.
  const principal = (req as express.Request & { principal?: Principal }).principal;
  if (principal?.kind === "staff" && !principal.mfa_enrolled) {
    return res.status(403).json({
      code: "auth.mfa_required",
      message: "Set up your authenticator app before using the platform.",
    });
  }
  return next();
});


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
  if (
    error.code === "auth.invalid_credentials" ||
    error.code === "auth.expired" ||
    error.code === "auth.revoked" ||
    error.code === "auth.no_session"
  ) {
    return 401;
  }
  if (error.code === "auth.locked" || error.code === "mfa.too_many_attempts") return 429;
  if (error.code === "mfa.challenge_expired") return 401;
  if (error.code.startsWith("mfa.")) return 422;
  if (error.code === "auth.email_taken") return 409;
  if (
    error.code.endsWith(".event_incomplete") ||
    error.code.endsWith(".incomplete") ||
    error.code.endsWith(".bad_dates") ||
    error.code.endsWith(".name_required") ||
    error.code.endsWith(".unknown_timezone")
  ) {
    return 422;
  }
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
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const items = await withScope(scopeFor(req), async (tx) => {
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
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const eventId = String(req.params.eventId);
  const items = await withScope(scopeFor(req, eventId), (tx) =>
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
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });

  const body = req.body as { action?: string; lock_version?: number; reason?: string };
  if (typeof body.action !== "string" || typeof body.lock_version !== "number") {
    return res.status(400).json({
      code: "request.invalid",
      message: "`action` and `lock_version` are required (BUILD_SPEC §6.3).",
    });
  }

  try {
    const result = await withScope(scopeFor(req), (tx) =>
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
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const eventId = String(req.params.eventId);
  const verdict = await withScope(scopeFor(req, eventId), (tx) =>
    verifyAuditChain(tx, eventId),
  );
  return res.json(verdict);
});

app.get("/api/v1/events/:eventId/summary", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const eventId = String(req.params.eventId);
  const summary = await withScope(scopeFor(req, eventId), (tx) =>
    eventSummary(tx, eventId),
  );
  if (!summary) return res.status(404).json({ code: "events.not_found", message: "No such event." });
  return res.json(summary);
});

app.get("/api/v1/events/:eventId/risk-list", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const eventId = String(req.params.eventId);
  const items = await withScope(scopeFor(req, eventId), (tx) =>
    riskList(tx, eventId),
  );
  return res.json({ items, next_cursor: null });
});

app.get("/api/v1/events/:eventId/review-queue", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const eventId = String(req.params.eventId);
  const items = await withScope(scopeFor(req, eventId), (tx) =>
    reviewQueue(tx, eventId),
  );
  return res.json({ items, next_cursor: null });
});

app.get("/api/v1/events/:eventId/sync/fleet", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const eventId = String(req.params.eventId);
  const items = await withScope(scopeFor(req, eventId), (tx) =>
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
  const updated = await withSystemScope(async (tx) => {
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
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const roomId = String(req.params.roomId);
  const view = await withScope(scopeFor(req), (tx) => agentView(tx, roomId));
  if (!view) return res.status(404).json({ code: "agent.room_not_found", message: "No such room." });
  return res.json(view);
});

app.post("/api/v1/rooms/:roomId/sync", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const roomId = String(req.params.roomId);
  const result = await withScope(scopeFor(req), async (tx) => {
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
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const body = req.body as { lock_version?: number };
  if (typeof body.lock_version !== "number") {
    return res.status(400).json({ code: "request.invalid", message: "`lock_version` is required." });
  }
  const result = await withScope(scopeFor(req), (tx) =>
    acknowledge(tx, actor, String(req.params.roomFileId), body.lock_version as number),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json(result.value);
});

app.post("/api/v1/rooms/:roomId/launch", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const body = req.body as { slot_id?: string };
  if (!body.slot_id) {
    return res.status(400).json({ code: "request.invalid", message: "`slot_id` is required." });
  }
  const result = await withScope(scopeFor(req), (tx) =>
    launch(tx, actor, { roomId: String(req.params.roomId), slotId: body.slot_id as string }),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json(result.value);
});

app.get("/api/v1/events/:eventId/speakers", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const eventId = String(req.params.eventId);
  const query = String(req.query.q ?? "");
  const items = await withScope(scopeFor(req, eventId), async (tx) => {
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
  // Either a signed-in presenter session, or the access code carried directly
  // (the emailed link) — the same credential, arriving by a different door.
  const principal = (req as express.Request & { principal?: Principal }).principal;
  if (principal?.kind === "presenter") {
    return withSystemScope(async (tx) => {
      const { rows } = await tx.query<{ name: string; timezone: string }>(
        `SELECT name, timezone FROM pmp.events WHERE id = $1`,
        [principal.event_id],
      );
      return fn(
        {
          speaker_id: principal.speaker_id,
          speaker_name: principal.display_name,
          event_id: principal.event_id,
          client_id: principal.client_id,
          event_name: rows[0]?.name ?? "",
          timezone: rows[0]?.timezone ?? "UTC",
        },
        tx,
      );
    });
  }

  const token = bearer(req);
  if (!token) return res.status(401).json({ code: "portal.no_token", message: "Sign in with your access code." });
  return withSystemScope(async (tx) => {
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
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const speakerId = String(req.params.speakerId);
  const token = randomUUID();
  const issued = await withScope(scopeFor(req), async (tx) => {
    const { rows } = await tx.query<{ event_id: string; client_id: string }>(
      `SELECT event_id, client_id FROM pmp.speakers WHERE id = $1`,
      [speakerId],
    );
    if (!rows[0]) return null;
    await tx.query(
      `INSERT INTO pmp.speaker_tokens (speaker_id, event_id, client_id, kind, token_hash, expires_at)
       VALUES ($1, $2, $3, 'magic_link', $4, now() + interval '30 days')`,
      [speakerId, rows[0].event_id, rows[0].client_id, hashToken(token)],
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
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const eventId = String(req.params.eventId);
  const view = await withScope(scopeFor(req, eventId), (tx) =>
    srrDashboard(tx, eventId),
  );
  return res.json(view);
});

app.post("/api/v1/events/:eventId/srr/checkins", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const body = req.body as { speaker_id?: string; station?: string };
  if (!body.speaker_id) {
    return res.status(400).json({ code: "request.invalid", message: "`speaker_id` is required." });
  }
  const result = await withScope(scopeFor(req), (tx) =>
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
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const detail = await withScope(scopeFor(req), (tx) =>
    checkinDetail(tx, String(req.params.checkinId)),
  );
  if (!detail) return res.status(404).json({ code: "srr.checkin_not_found", message: "No such check-in." });
  return res.json(detail);
});

/** Staff-side resumable upload, used by USB intake (the portal has its own). */
app.post("/api/v1/srr/uploads", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  return res.status(201).json({ upload_id: randomUUID(), part_size: 5 * 1024 * 1024 });
});

app.put("/api/v1/srr/uploads/:uploadId/parts/:partNumber", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const body = req.body as Buffer;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    return res.status(400).json({ code: "request.invalid", message: "Empty part." });
  }
  const { sha256 } = await storage.putPart(String(req.params.uploadId), Number(req.params.partNumber), body);
  return res.json({ size: body.length, sha256 });
});

app.post("/api/v1/srr/checkins/:checkinId/usb-ingestions", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const body = req.body as { upload_id?: string; file_name?: string; reason?: string };
  if (!body.upload_id || !body.file_name) {
    return res.status(400).json({ code: "request.invalid", message: "`upload_id` and `file_name` are required." });
  }
  const result = await withScope(scopeFor(req), (tx) =>
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
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const body = req.body as { file_version_id?: string };
  if (!body.file_version_id) {
    return res.status(400).json({ code: "request.invalid", message: "`file_version_id` is required." });
  }
  const result = await withScope(scopeFor(req), (tx) =>
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
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const result = await withScope(scopeFor(req), (tx) =>
    depart(tx, actor, String(req.params.checkinId)),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json(result.value);
});

/* ── presentation detail & inspection (screens 6 and 7) ──────────────────── */

app.get("/api/v1/slots/:slotId", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const detail = await withScope(scopeFor(req), (tx) =>
    presentationDetail(tx, String(req.params.slotId)),
  );
  if (!detail) return res.status(404).json({ code: "slots.not_found", message: "No such talk." });
  return res.json(detail);
});

app.get("/api/v1/file-versions/:versionId/findings", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const items = await withScope(scopeFor(req), (tx) =>
    findingsFor(tx, String(req.params.versionId)),
  );
  return res.json({ items });
});

app.post("/api/v1/findings/:findingId/waive", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const body = req.body as { reason?: string };
  const result = await withScope(scopeFor(req), (tx) =>
    waiveFinding(tx, actor, { findingId: String(req.params.findingId), reason: body.reason ?? "" }),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json(result.value);
});

app.get("/api/v1/file-versions/:versionId/comments", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  // Lane visibility: staff see every lane here; speaker and client surfaces are
  // filtered at their own endpoints (FR-REV-003).
  const items = await withScope(scopeFor(req), async (tx) => {
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
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const body = req.body as { lane?: string; body?: string };
  const lanes = ["internal", "client_visible", "speaker_visible"];
  if (!body.lane || !lanes.includes(body.lane)) {
    return res.status(400).json({ code: "request.invalid", message: `lane must be one of ${lanes.join(", ")}.` });
  }
  const result = await withScope(scopeFor(req), (tx) =>
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
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const body = req.body as { finding_id?: string; note?: string };
  if (!body.note) {
    return res.status(400).json({ code: "request.invalid", message: "`note` is required." });
  }
  const result = await withScope(scopeFor(req), (tx) =>
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
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const body = req.body as { target_version_id?: string; reason?: string };
  if (!body.target_version_id) {
    return res.status(400).json({ code: "request.invalid", message: "`target_version_id` is required." });
  }
  const result = await withScope(scopeFor(req), (tx) =>
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
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const eventId = String(req.params.eventId);
  const items = await withScope(scopeFor(req, eventId), async (tx) => {
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
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const body = req.body as { into?: string };
  if (!body.into) {
    return res.status(400).json({ code: "request.invalid", message: "`into` is required." });
  }
  const survivor = body.into;
  const merged = String(req.params.speakerId);
  if (survivor === merged) {
    return res.status(422).json({ code: "speakers.same", message: "A speaker cannot be merged into itself." });
  }

  const result = await withScope(scopeFor(req), async (tx) => {
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
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const fileName = String(req.header("x-file-name") ?? "agenda.csv");
  const body = req.body as Buffer;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    return res.status(400).json({ code: "request.invalid", message: "Empty file." });
  }

  const eventId = String(req.params.eventId);
  const uploadId = randomUUID();
  importCache.set(uploadId, { eventId, fileName, body });

  const result = await withScope(scopeFor(req, eventId), (tx) =>
    buildPreview(tx, { eventId, fileName, body, actorId: actor.id, s3Key: `imports/${uploadId}` }),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.status(201).json({ ...result.value, upload_id: uploadId });
});

/** Re-map columns and re-validate without re-uploading the file. */
app.post("/api/v1/imports/:uploadId/remap", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const cached = importCache.get(String(req.params.uploadId));
  if (!cached) return res.status(404).json({ code: "import.expired", message: "Upload the file again." });
  const body = req.body as { mapping?: (ImportField | null)[] };

  const result = await withScope(scopeFor(req, cached.eventId), (tx) =>
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
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const body = req.body as { event_id?: string; rows?: StagedRow[] };
  if (!body.event_id || !Array.isArray(body.rows)) {
    return res.status(400).json({ code: "request.invalid", message: "`event_id` and `rows` are required." });
  }
  const result = await withScope(scopeFor(req, body.event_id), (tx) =>
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
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const eventId = String(req.params.eventId);
  const scope = await withScope(scopeFor(req, eventId), (tx) =>
    scopePreview(tx, eventId),
  );
  const latest = await withScope(scopeFor(req, eventId), (tx) =>
    latestPackage(tx, eventId),
  );
  return res.json({ ...scope, latest_package: latest });
});

app.post("/api/v1/events/:eventId/archive-packages", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const eventId = String(req.params.eventId);
  const result = await withScope(scopeFor(req, eventId), (tx) =>
    buildPackage(tx, actor, eventId),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.status(201).json(result.value);
});

app.post("/api/v1/archive-packages/:packageId/deliver", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const body = req.body as { days?: number };
  const result = await withScope(scopeFor(req), (tx) =>
    deliverPackage(tx, actor, String(req.params.packageId), body.days ?? 7),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json(result.value);
});

app.get("/api/v1/archive-packages/:packageId/download", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const result = await withScope(scopeFor(req), (tx) =>
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
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const clientRoles = ["client_event_admin", "scoped_reviewer"];
  if (!actor.roles.some((role) => clientRoles.includes(role))) {
    return res.status(403).json({
      code: "auth.not_a_client_role",
      message: "The client portal is for client event admins and scoped reviewers.",
    });
  }

  const eventId = String(req.params.eventId);
  const data = await withScope(scopeFor(req, eventId), async (tx) => {
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

/* ── create event (screen 2) ─────────────────────────────────────────────── */

app.get("/api/v1/timezones", (_req, res) => res.json({ items: supportedTimezones() }));

app.get("/api/v1/clients", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const items = await withScope(scopeFor(req), async (tx) => {
    const { rows } = await tx.query(`SELECT id, name FROM pmp.clients ORDER BY name`);
    return rows;
  });
  return res.json({ items });
});

app.post("/api/v1/events", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const body = req.body as Record<string, string>;

  // An event belongs to a client. If the caller did not say which and there is
  // exactly one, use it; otherwise ask rather than guess.
  const clientId = await withScope(scopeFor(req), async (tx) => {
    if (body.client_id) return body.client_id;
    const { rows } = await tx.query<{ id: string }>(`SELECT id FROM pmp.clients`);
    return rows.length === 1 ? rows[0]!.id : null;
  });
  if (!clientId) {
    return res.status(422).json({
      code: "events.client_required",
      message: "Say which client this event is for — `client_id` is required when more than one exists.",
    });
  }

  const result = await withScope(scopeFor(req), (tx) =>
    createEvent(tx, actor, clientId, {
      name: body.name ?? "",
      venue: body.venue ?? "",
      timezone: body.timezone ?? "America/New_York",
      starts_on: body.starts_on ?? "",
      ends_on: body.ends_on ?? "",
    }),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.status(201).json(result.value);
});

app.get("/api/v1/events/:eventId/draft", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const result = await withScope(scopeFor(req), (tx) =>
    draftOf(tx, String(req.params.eventId)),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json(result.value);
});

app.patch("/api/v1/events/:eventId", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const body = req.body as {
    rooms?: string[];
    tracks?: string[];
    settings?: Record<string, unknown>;
    branding?: Record<string, unknown>;
  };
  const result = await withScope(scopeFor(req), (tx) =>
    configureEvent(tx, actor, String(req.params.eventId), body),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json(result.value);
});

app.post("/api/v1/events/:eventId/activate", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const result = await withScope(scopeFor(req), (tx) =>
    activateEvent(tx, actor, String(req.params.eventId)),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json(result.value);
});

app.post("/api/v1/events/:eventId/duplicate", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const body = req.body as Record<string, string>;
  const result = await withScope(scopeFor(req), (tx) =>
    duplicateEvent(tx, actor, String(req.params.eventId), {
      name: body.name ?? "Copy",
      starts_on: body.starts_on ?? "",
      ends_on: body.ends_on ?? "",
    }),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.status(201).json(result.value);
});

/* ── communications (screen 9) ───────────────────────────────────────────── */

app.get("/api/v1/events/:eventId/comms", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const eventId = String(req.params.eventId);
  const data = await withScope(scopeFor(req, eventId), async (tx) => {
    const templates = await ensureTemplates(tx, eventId);
    const invitation = templates[0];
    return {
      templates,
      recipients: invitation ? await recipientsFor(tx, eventId, invitation.id, false) : [],
      missing: invitation ? await recipientsFor(tx, eventId, invitation.id, true) : [],
      log: await deliveryLog(tx, eventId),
      stats: await deliveryStats(tx, eventId),
    };
  });
  return res.json(data);
});

app.post("/api/v1/events/:eventId/comms/send", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const body = req.body as { template_id?: string; missing_only?: boolean };
  if (!body.template_id) {
    return res.status(400).json({ code: "request.invalid", message: "`template_id` is required." });
  }
  const eventId = String(req.params.eventId);
  const result = await withScope(scopeFor(req, eventId), (tx) =>
    sendBatch(tx, actor, {
      eventId,
      templateId: body.template_id as string,
      missingOnly: body.missing_only === true,
    }),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json(result.value);
});

/** Provider callback (SES via SNS in production); signature verification is M3-5. */
app.post("/api/v1/webhooks/email", async (req, res) => {
  const body = req.body as { communication_id?: string; event_type?: string; payload?: Record<string, unknown> };
  if (!body.communication_id || !body.event_type) {
    return res.status(400).json({ code: "request.invalid", message: "`communication_id` and `event_type` are required." });
  }
  const result = await withSystemScope((tx) =>
    recordDeliveryEvent(tx, {
      communicationId: body.communication_id as string,
      eventType: body.event_type as string,
      payload: body.payload ?? {},
    }),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json(result.value);
});

/* ── authentication (two principals: DXG staff and presenters) ───────────── */

const clientIp = (req: express.Request): string | undefined => {
  const forwarded = req.header("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded ?? req.socket.remoteAddress ?? undefined;
  return address?.replace(/^::ffff:/, "");
};

app.post("/api/v1/auth/login", async (req, res) => {
  const body = req.body as { email?: string; password?: string };
  if (!body.email || !body.password) {
    return res.status(400).json({ code: "request.invalid", message: "Enter your email address and password." });
  }
  const result = await withSystemScope((tx) =>
    staffLogin(tx, {
      email: body.email as string,
      password: body.password as string,
      ip: clientIp(req),
      userAgent: req.header("user-agent") ?? undefined,
    }),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);

  if (result.value.step === "mfa_required") {
    // The challenge is not a session: on its own it grants nothing.
    res.cookie(MFA_COOKIE, result.value.challenge, cookieOptions(5));
    return res.json({ step: "mfa_required" });
  }

  res.cookie(SESSION_COOKIE, result.value.token, cookieOptions(24 * 60));
  return res.json({ step: "signed_in", principal: result.value.principal });
});

app.post("/api/v1/auth/mfa/verify", async (req, res) => {
  const challenge = readCookie(req, MFA_COOKIE);
  if (!challenge) {
    return res.status(401).json({ code: "mfa.challenge_expired", message: "Start signing in again." });
  }
  const body = req.body as { code?: string };
  if (!body.code) {
    return res.status(400).json({ code: "request.invalid", message: "Enter the code from your authenticator." });
  }

  const outcome = await withSystemScope((tx) => answerChallenge(tx, { token: challenge, code: body.code as string }));
  if (!outcome.ok) {
    if (outcome.error.code === "mfa.challenge_expired" || outcome.error.code === "mfa.too_many_attempts") {
      res.clearCookie(MFA_COOKIE, { path: "/" });
    }
    return res.status(statusFor(outcome.error)).json(outcome.error);
  }

  const { token, principal } = await withSystemScope((tx) =>
    completeMfaLogin(tx, outcome.userId, {
      ip: clientIp(req),
      userAgent: req.header("user-agent") ?? undefined,
    }),
  );
  res.clearCookie(MFA_COOKIE, { path: "/" });
  res.cookie(SESSION_COOKIE, token, cookieOptions(24 * 60));
  return res.json({
    step: "signed_in",
    principal,
    used_recovery_code: outcome.usedRecoveryCode,
    remaining_recovery_codes: outcome.remainingRecoveryCodes,
  });
});

/* ── MFA enrolment ───────────────────────────────────────────────────────── */

app.post("/api/v1/auth/mfa/start", async (req, res) => {
  const principal = (req as express.Request & { principal?: Principal }).principal;
  if (principal?.kind !== "staff") {
    return res.status(401).json({ code: "auth.no_session", message: "Sign in first." });
  }
  const result = await withSystemScope((tx) => startEnrolment(tx, principal.user_id));
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json(result.value);
});

app.post("/api/v1/auth/mfa/confirm", async (req, res) => {
  const principal = (req as express.Request & { principal?: Principal }).principal;
  if (principal?.kind !== "staff") {
    return res.status(401).json({ code: "auth.no_session", message: "Sign in first." });
  }
  const body = req.body as { code?: string };
  if (!body.code) {
    return res.status(400).json({ code: "request.invalid", message: "Enter the code from your authenticator." });
  }
  const result = await withSystemScope((tx) => confirmEnrolment(tx, principal.user_id, body.code as string));
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json(result.value);
});

app.post("/api/v1/auth/mfa/disable", async (req, res) => {
  const principal = (req as express.Request & { principal?: Principal }).principal;
  if (principal?.kind !== "staff") {
    return res.status(401).json({ code: "auth.no_session", message: "Sign in first." });
  }
  const body = req.body as { password?: string; code?: string };
  if (!body.password || !body.code) {
    return res.status(400).json({ code: "request.invalid", message: "Both your password and a code are required." });
  }
  const result = await withSystemScope((tx) =>
    disableMfa(tx, principal.user_id, { password: body.password as string, code: body.code as string }),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json(result.value);
});

app.post("/api/v1/portal/login", async (req, res) => {
  const body = req.body as { email?: string; code?: string };
  if (!body.email || !body.code) {
    return res.status(400).json({ code: "request.invalid", message: "Enter your email address and access code." });
  }
  const result = await withSystemScope((tx) =>
    presenterLogin(tx, {
      email: body.email as string,
      code: body.code as string,
      ip: clientIp(req),
      userAgent: req.header("user-agent") ?? undefined,
    }),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  res.cookie(SESSION_COOKIE, result.value.token, cookieOptions(24 * 60));
  return res.json({ principal: result.value.principal });
});

app.post("/api/v1/auth/logout", async (req, res) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) {
    await withSystemScope((tx) => endSession(tx, token));
  }
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  return res.status(204).end();
});

app.get("/api/v1/auth/session", (req, res) => {
  const principal = (req as express.Request & { principal?: Principal }).principal;
  if (!principal) return res.status(401).json({ code: "auth.no_session", message: "Not signed in." });
  return res.json({ principal });
});

app.post("/api/v1/auth/password", async (req, res) => {
  const principal = (req as express.Request & { principal?: Principal }).principal;
  if (principal?.kind !== "staff") {
    return res.status(401).json({ code: "auth.no_session", message: "Sign in first." });
  }
  const body = req.body as { current_password?: string; new_password?: string };
  if (!body.current_password || !body.new_password) {
    return res.status(400).json({ code: "request.invalid", message: "Both the current and new password are required." });
  }
  const result = await withScope(scopeFor(req), (tx) =>
    changeOwnPassword(tx, principal.user_id, {
      currentPassword: body.current_password as string,
      newPassword: body.new_password as string,
    }),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  return res.json(result.value);
});

app.post("/api/v1/admin/users", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in first." });
  const body = req.body as { email?: string; display_name?: string; password?: string };
  if (!body.email) {
    return res.status(400).json({ code: "request.invalid", message: "`email` is required." });
  }
  const result = await withScope(scopeFor(req), (tx) =>
    createStaffUser(tx, actor, {
      email: body.email as string,
      displayName: body.display_name ?? "",
      ...(body.password ? { password: body.password } : {}),
    }),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.status(201).json(result.value);
});

/** Generates a presenter's credential; the code is returned exactly once. */
app.post("/api/v1/speakers/:speakerId/credentials", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in first." });
  const result = await withScope(scopeFor(req), (tx) =>
    issuePresenterCredential(tx, actor, {
      speakerId: String(req.params.speakerId),
      portalBase: process.env.PORTAL_BASE ?? "http://localhost:3001",
    }),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.status(201).json(result.value);
});

app.delete("/api/v1/speakers/:speakerId/credentials", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in first." });
  const result = await withScope(scopeFor(req), (tx) =>
    revokePresenterCredential(tx, actor, String(req.params.speakerId)),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json(result.value);
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.error(`api listening on http://localhost:${port}`);
});
