import express from "express";
import { withScope, withSystemScope, getPool, verifyAuditChain, appendAudit as appendAuditRecord } from "@pmp/db";
import type { Actor, DomainError, EventRole, Result, ReviewAction } from "@pmp/domain";
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
import { requestReset, completeReset } from "./services/passwordReset.ts";
import {
  listStaff,
  resetPassword,
  resetMfa,
  setActive,
  unlock,
  grantRole,
  revokeRole,
} from "./services/admin.ts";

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
import {
  buildPreview,
  commitImport,
  saveTypedRow,
  deleteTypedSession,
  manualAgendaCsv,
  autoMap,
  agendaTemplateCsv,
  IMPORT_FIELDS,
} from "./services/scheduleImport.ts";
import {
  createEvent,
  configureEvent,
  draftOf,
  activateEvent,
  archiveEvent,
  restoreEvent,
  duplicateEvent,
  supportedTimezones,
} from "./services/events.ts";
import { eventAgenda } from "./services/agenda.ts";
import { queuePdfs, resumePdfQueue } from "./services/pdf.ts";
import {
  createSession,
  updateSession,
  setSessionCanceled,
  deleteSession,
  addPresentation,
  updatePresentation,
  deletePresentation,
  addPresenter,
  removePresenter,
} from "./services/agendaEdit.ts";
import {
  ensureTemplates,
  recipientsFor,
  sendBatch,
  deliveryLog,
  deliveryStats,
  recordDeliveryEvent,
  findCommunication,
} from "./services/comms.ts";
import { verifySnsMessage, parseSesEvent } from "@pmp/email";
import type { SnsMessage } from "@pmp/email";
import {
  scopePreview,
  buildPackage,
  deliverPackage,
  downloadPackage,
  latestPackage,
  packageDownloads,
  pdfCandidates,
} from "./services/archive.ts";
import type { ImportField, StagedRow, RowOverrides, ImportPreview } from "./services/scheduleImport.ts";
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
  // `x-file-name` carries the original filename on an upload. It is not a simple
  // header, so leaving it out of this list meant the browser refused every schedule
  // import before sending it — on the standalone screen and in the create-event
  // wizard alike — while the same call from a script worked perfectly.
  res.header("Access-Control-Allow-Headers", "content-type, authorization, x-file-name");
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
/** The event this request is about, once the middleware below has worked it out. */
const eventOfRequest = (req: express.Request): string | undefined =>
  (req as express.Request & { eventId?: string }).eventId;

/**
 * The actor, carrying the roles they hold **on this request's event**.
 *
 * `rolesFor` selects `DISTINCT role` with no event filter, which is right for the
 * question "may this account use the staff area at all" and wrong for every other
 * question. Handing that flat set to the domain meant `hasAnyRole(actor,
 * atLeast("presentation_manager"))` asked whether the account was a presentation
 * manager *anywhere* — so a room technician here who manages presentations on some
 * other conference could waive blocking findings and roll back approved versions on
 * this one.
 *
 * `platform_admin` survives the filter wherever it is held, for the reason in
 * PLATFORM_WIDE_ROLES.
 */
function actorFrom(req: express.Request): Actor | undefined {
  const principal = (req as express.Request & { principal?: Principal }).principal;
  if (principal?.kind !== "staff") return undefined;

  const eventId = eventOfRequest(req);
  if (!eventId) return { id: principal.user_id, roles: principal.roles };

  const here = principal.event_roles
    .filter((held) => held.event_id === eventId)
    .map((held) => held.role);
  for (const role of PLATFORM_WIDE_ROLES) {
    if (principal.roles.includes(role) && !here.includes(role)) here.push(role);
  }
  return { id: principal.user_id, roles: here };
}

/**
 * The database scope a request runs in. DXG staff work across every client;
 * a client-side account is pinned to the clients it actually holds a role on,
 * so RLS — not a hardcoded id — decides what it can see.
 */
/**
 * Thrown by `scopeFor` when an account reaches for an event it holds no role on.
 * Carries its own status and code so the handler at the foot of this file can render
 * it faithfully rather than flattening it into a generic failure.
 */
class ScopeError extends Error {
  readonly status = 403;
  readonly code = "auth.not_on_this_event";
  constructor(message: string) {
    super(message);
    this.name = "ScopeError";
  }
}

/**
 * `platform_admin` is the one role that is genuinely platform-wide, and the exception
 * is deliberate rather than convenient. Someone has to be able to create the first
 * event and grant roles on it, which is by definition a thing done from outside any
 * event; `scripts/bootstrapAdmin.ts` depends on it. Every other role — project
 * manager included — is held on an event or not at all.
 */
const PLATFORM_WIDE_ROLES: EventRole[] = ["platform_admin"];

function scopeFor(req: express.Request, eventId?: string): {
  userId: string;
  clientId?: string;
  eventId?: string;
  allClients?: boolean;
} {
  const principal = (req as express.Request & { principal?: Principal }).principal;
  if (principal?.kind !== "staff") throw new Error("scopeFor requires a staff principal");

  /*
   * SRS §5: "Access shall be event-scoped and least-privilege. Client and event
   * isolation is mandatory."
   *
   * Until now `rolesFor` flattened every role across every event, so holding any role
   * on any one event granted that role's powers on all of them — a content reviewer
   * on one conference could read another's speakers. Checking here rather than in each
   * service is deliberate: this is the single place every event-scoped route passes
   * through, so a route added tomorrow inherits the rule instead of having to remember
   * it.
   */
  const scopedTo = eventId ?? eventOfRequest(req);
  if (scopedTo && !principal.roles.some((role) => PLATFORM_WIDE_ROLES.includes(role))) {
    const onThisEvent = principal.event_roles.some((held) => held.event_id === scopedTo);
    if (!onThisEvent) {
      throw new ScopeError("Your account has no role on this event.");
    }
  }

  const isStaff = principal.roles.some((role) => STAFF_ROLES.includes(role));
  return {
    userId: principal.user_id,
    ...(scopedTo ? { eventId: scopedTo } : {}),
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

/* ── archived events are read-only (D-062) ──────────────────────────────── */

/**
 * An archived event can be read but not changed. Reads are the only methods that
 * pass; every write is refused with one code, whichever door it came through — the
 * staff routes (via the event resolver below), the agenda import's upload-cache
 * routes, and the speaker portal. Restore is the way out and duplicate only reads its
 * source, so those are exempt (as is archive, whose own refusal says more).
 */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const WRITES_ALLOWED_WHEN_ARCHIVED = [
  /^\/api\/v1\/events\/[^/]+\/restore$/,
  /^\/api\/v1\/events\/[^/]+\/duplicate$/,
  // Archiving again reaches the service, which answers with its own clearer conflict.
  /^\/api\/v1\/events\/[^/]+\/archive$/,
];

const ARCHIVED_REFUSAL = {
  code: "events.archived",
  message: "This event is archived, so it is read-only. Restore it to make changes.",
};

const isArchived = async (eventId: string): Promise<boolean> => {
  const { rows } = await withSystemScope((tx) =>
    tx.query<{ status: string }>(`SELECT status FROM pmp.events WHERE id = $1`, [eventId]),
  );
  return rows[0]?.status === "archived";
};

/** True when this request would change an archived event and must be refused. */
const writesToArchived = async (req: express.Request, eventId: string): Promise<boolean> => {
  if (READ_METHODS.has(req.method)) return false;
  if (WRITES_ALLOWED_WHEN_ARCHIVED.some((pattern) => pattern.test(req.path))) return false;
  return isArchived(eventId);
};

/* ── which event does this URL belong to? ─────────────────────────────────── */

/**
 * How to find the owning event of a resource named directly in the path.
 *
 * D-025 put the event check in `scopeFor`, which every `/events/{eventId}/…` route
 * passes through — and that is where it stopped. A route like `GET /slots/{id}` never
 * mentions an event: the event is a property of the slot, and nothing looked it up, so
 * eighteen routes were protected and twenty were not.
 *
 * Matching on the path rather than on Express's route params is deliberate: `app.use`
 * middleware does not receive them, and a table keyed by URL shape means a route added
 * tomorrow under an existing prefix inherits the rule instead of having to remember
 * it — which is what D-025 claimed and only half delivered.
 */
const EVENT_OF_PATH: { pattern: RegExp; sql: string }[] = [
  {
    pattern: /^\/api\/v1\/events\/([^/]+)/,
    sql: `SELECT id AS event_id, client_id FROM pmp.events WHERE id = $1`,
  },
  {
    pattern: /^\/api\/v1\/client\/events\/([^/]+)/,
    sql: `SELECT id AS event_id, client_id FROM pmp.events WHERE id = $1`,
  },
  {
    pattern: /^\/api\/v1\/slots\/([^/]+)/,
    sql: `SELECT event_id, client_id FROM pmp.slots WHERE id = $1`,
  },
  {
    pattern: /^\/api\/v1\/file-versions\/([^/]+)/,
    sql: `SELECT s.event_id, s.client_id
            FROM pmp.file_versions fv
            JOIN pmp.files f ON f.id = fv.file_id
            JOIN pmp.slots s ON s.id = f.slot_id
           WHERE fv.id = $1`,
  },
  {
    pattern: /^\/api\/v1\/findings\/([^/]+)/,
    sql: `SELECT s.event_id, s.client_id
            FROM pmp.inspection_findings inf
            JOIN pmp.file_versions fv ON fv.id = inf.file_version_id
            JOIN pmp.files f ON f.id = fv.file_id
            JOIN pmp.slots s ON s.id = f.slot_id
           WHERE inf.id = $1`,
  },
  {
    pattern: /^\/api\/v1\/rooms\/([^/]+)/,
    sql: `SELECT event_id, client_id FROM pmp.rooms WHERE id = $1`,
  },
  {
    pattern: /^\/api\/v1\/room-files\/([^/]+)/,
    sql: `SELECT event_id, client_id FROM pmp.room_files WHERE id = $1`,
  },
  {
    pattern: /^\/api\/v1\/srr\/checkins\/([^/]+)/,
    sql: `SELECT event_id, client_id FROM pmp.srr_checkins WHERE id = $1`,
  },
  {
    pattern: /^\/api\/v1\/speakers\/([^/]+)/,
    sql: `SELECT event_id, client_id FROM pmp.speakers WHERE id = $1`,
  },
  {
    pattern: /^\/api\/v1\/archive-packages\/([^/]+)/,
    sql: `SELECT event_id, client_id FROM pmp.archive_packages WHERE id = $1`,
  },
  /*
   * No `/imports/…` pattern at all. Every id under it — `cells`, `remap`, the row
   * routes and now `commit` (D-051) — is an upload-cache key rather than a row, so a
   * lookup here would never find one and would turn the request into a 404. They all
   * take their event from the cache entry and hand it to `scopeFor`, which refuses a
   * caller holding no role on it: the same check, made where the event is actually
   * known.
   *
   * `commit` was the exception until the `schedule_imports` row stopped existing
   * before the commit, which is exactly what it used to look up.
   */
];

/** `<id>:<action>` is one path segment; the id is what comes before the colon. */
const idPart = (segment: string): string => {
  const decoded = decodeURIComponent(segment);
  const colon = decoded.lastIndexOf(":");
  return colon < 0 ? decoded : decoded.slice(0, colon);
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves the event a request is about, refuses it if the account holds no role
 * there, and records the attempt when it does refuse (BUILD_SPEC I-4: blocked *and*
 * logged).
 *
 * A resource that does not exist is a 404 and a resource on another event is a 403.
 * The distinction is deliberate: these are staff-only routes behind a session and the
 * ids are UUIDs, so confirming existence is not a practical enumeration risk, while
 * collapsing the two would tell a project manager who mistyped a URL that their own
 * talk had vanished.
 */
app.use(async (req, res, next) => {
  if (!req.path.startsWith("/api/v1/")) return next();
  const principal = (req as express.Request & { principal?: Principal }).principal;
  if (principal?.kind !== "staff") return next();

  const route = EVENT_OF_PATH.find((candidate) => candidate.pattern.test(req.path));
  if (!route) return next();
  const id = idPart(route.pattern.exec(req.path)![1] ?? "");
  // Upload ids are not resources yet — the import cache holds them — and a malformed
  // id is for the handler to reject with its own message.
  if (!UUID.test(id)) return next();

  let owner: { event_id: string; client_id: string } | undefined;
  try {
    owner = await withSystemScope(async (tx) => {
      const { rows } = await tx.query<{ event_id: string; client_id: string }>(route.sql, [id]);
      return rows[0];
    });
  } catch {
    return next(); // a lookup failure is the handler's problem, not a denial
  }

  if (!owner) {
    return res.status(404).json({ code: "resource.not_found", message: "No such record." });
  }

  const request = req as express.Request & { eventId?: string };
  request.eventId = owner.event_id;

  const platformWide = principal.roles.some((role) => PLATFORM_WIDE_ROLES.includes(role));
  const onThisEvent = principal.event_roles.some((held) => held.event_id === owner.event_id);
  if (platformWide || onThisEvent) {
    // Checked after the role check, so an outsider still learns only "not yours".
    if (await writesToArchived(req, owner.event_id)) return res.status(409).json(ARCHIVED_REFUSAL);
    return next();
  }

  await withSystemScope((tx) =>
    appendAuditRecord(tx, {
      partitionId: owner.event_id,
      clientId: owner.client_id,
      actorUserId: principal.user_id,
      action: "security.cross_event_attempt",
      subjectType: "request",
      subjectId: id,
      detail: { method: req.method, path: req.path },
    }),
  ).catch(() => undefined);

  return res.status(403).json({
    code: "auth.not_on_this_event",
    message: "Your account has no role on this event.",
  });
});

/**
 * `/imports/{uploadId}/…` names no event in its path — the id is an upload-cache key —
 * so the resolver above cannot see it. The cache entry knows the event, and an import
 * started before the event was archived must not be committed after.
 */
app.use("/api/v1/imports/:uploadId", async (req, res, next) => {
  const cached = importCache.get(String(req.params.uploadId));
  if (cached && (await writesToArchived(req, cached.eventId))) return res.status(409).json(ARCHIVED_REFUSAL);
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
  "/api/v1/auth/password-reset/",
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
  // `_conflict` as well as `.conflict`: a state that refuses a well-formed request is a
  // 409 whichever way the code is spelled, and the suffix rule alone silently sent
  // `events.days_conflict` out as a 400 — "malformed", which it is not.
  if (error.code.endsWith(".conflict") || error.code.endsWith("_conflict")) return 409;
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
  if (error.code === "auth.reset_invalid") return 422;
  // A well-formed request whose value breaks a rule is unprocessable, not malformed.
  if (
    error.code === "auth.too_short" ||
    error.code === "auth.too_long" ||
    error.code === "auth.too_common" ||
    error.code === "auth.same_as_old" ||
    error.code === "admin.too_short" ||
    error.code === "admin.too_long" ||
    error.code === "admin.too_common"
  ) {
    return 422;
  }
  if (error.code.startsWith("admin.") && error.code.endsWith("forbidden")) return 403;
  if (
    error.code === "admin.reason_required" ||
    error.code === "admin.self_lockout" ||
    error.code === "admin.last_admin" ||
    error.code === "admin.unknown_role"
  ) {
    return 422;
  }
  if (
    error.code.endsWith(".event_incomplete") ||
    error.code.endsWith(".incomplete") ||
    error.code.endsWith(".bad_dates") ||
    error.code.endsWith(".name_required") ||
    error.code.endsWith(".not_a_draft") ||
    error.code.endsWith(".unknown_timezone") ||
    error.code.endsWith(".bad_times")
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

  /*
   * The portfolio lists the events this account works on, not every event in the
   * system. That is the same least-privilege rule `scopeFor` applies per event (SRS
   * §5) — a list of things you cannot open is not useful, and naming other clients'
   * events to someone with no role on them is itself a small disclosure.
   *
   * `platform_admin` sees everything, for the same reason it may cross events at all.
   */
  const principal = (req as express.Request & { principal?: Principal }).principal;
  const seesAll =
    principal?.kind === "staff" && principal.roles.some((role) => PLATFORM_WIDE_ROLES.includes(role));
  const own = principal?.kind === "staff" ? [...new Set(principal.event_roles.map((held) => held.event_id))] : [];

  const items = await withScope(scopeFor(req), async (tx) => {
    if (seesAll) {
      const { rows } = await tx.query(
        `SELECT id, name, starts_on::text, ends_on::text, timezone, status
           FROM pmp.events ORDER BY starts_on DESC`,
      );
      return rows;
    }
    if (own.length === 0) return [];
    const { rows } = await tx.query(
      `SELECT id, name, starts_on::text, ends_on::text, timezone, status
         FROM pmp.events WHERE id = ANY($1::uuid[]) ORDER BY starts_on DESC`,
      [own],
    );
    return rows;
  });
  return res.json({ items, next_cursor: null });
});

// The Agenda tab of the event details (D-063): sessions with their presentations.
app.get("/api/v1/events/:eventId/agenda", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const eventId = String(req.params.eventId);
  const items = await withScope(scopeFor(req, eventId), (tx) => eventAgenda(tx, eventId));
  return res.json({ items });
});

/*
 * Editing the agenda from the event details (D-064). All under `/events/{id}/…`, so
 * the event resolver scopes them, refuses outsiders, and refuses every write on an
 * archived event (D-062) before a handler runs.
 */
const agendaRoute =
  <T>(
    status: number,
    run: (
      tx: Parameters<Parameters<typeof withScope>[1]>[0],
      actor: Actor,
      req: express.Request,
    ) => Promise<Result<T, DomainError>>,
  ) =>
  async (req: express.Request, res: express.Response) => {
    const actor = actorFrom(req);
    if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
    const result = await withScope(scopeFor(req, String(req.params.eventId)), (tx) => run(tx, actor, req));
    if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
    return res.status(status).json(result.value);
  };

// The services validate every field; this only names the shape they expect.
const bodyOf = <T = { reason?: string }>(req: express.Request): T => (req.body ?? {}) as T;

app.post(
  "/api/v1/events/:eventId/sessions",
  agendaRoute(201, (tx, actor, req) => createSession(tx, actor, String(req.params.eventId), bodyOf(req))),
);
app.patch(
  "/api/v1/events/:eventId/sessions/:sessionId",
  agendaRoute(200, (tx, actor, req) =>
    updateSession(tx, actor, String(req.params.eventId), String(req.params.sessionId), bodyOf(req)),
  ),
);
app.post(
  "/api/v1/events/:eventId/sessions/:sessionId/cancel",
  agendaRoute(200, (tx, actor, req) =>
    setSessionCanceled(tx, actor, String(req.params.eventId), String(req.params.sessionId), true, String(bodyOf(req).reason ?? "")),
  ),
);
app.post(
  "/api/v1/events/:eventId/sessions/:sessionId/reinstate",
  agendaRoute(200, (tx, actor, req) =>
    setSessionCanceled(tx, actor, String(req.params.eventId), String(req.params.sessionId), false, String(bodyOf(req).reason ?? "")),
  ),
);
app.delete(
  "/api/v1/events/:eventId/sessions/:sessionId",
  agendaRoute(200, (tx, actor, req) => deleteSession(tx, actor, String(req.params.eventId), String(req.params.sessionId))),
);
app.post(
  "/api/v1/events/:eventId/sessions/:sessionId/presentations",
  agendaRoute(201, (tx, actor, req) =>
    addPresentation(tx, actor, String(req.params.eventId), String(req.params.sessionId), bodyOf(req)),
  ),
);
app.patch(
  "/api/v1/events/:eventId/presentations/:slotId",
  agendaRoute(200, (tx, actor, req) =>
    updatePresentation(tx, actor, String(req.params.eventId), String(req.params.slotId), bodyOf(req)),
  ),
);
app.delete(
  "/api/v1/events/:eventId/presentations/:slotId",
  agendaRoute(200, (tx, actor, req) => deletePresentation(tx, actor, String(req.params.eventId), String(req.params.slotId))),
);
app.post(
  "/api/v1/events/:eventId/presentations/:slotId/presenters",
  agendaRoute(201, (tx, actor, req) =>
    addPresenter(tx, actor, String(req.params.eventId), String(req.params.slotId), bodyOf(req)),
  ),
);
app.delete(
  "/api/v1/events/:eventId/presentations/:slotId/presenters/:speakerId",
  agendaRoute(200, (tx, actor, req) =>
    removePresenter(tx, actor, String(req.params.eventId), String(req.params.slotId), String(req.params.speakerId)),
  ),
);

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

  const body = req.body as { action?: string; lock_version?: number; reason?: string; note?: string };
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
        ...(typeof body.note === "string" ? { note: body.note } : {}),
      }),
    );
    if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
    // An approved version is what the archive ships, so its PDF copy is made now, in
    // the background, rather than when someone is waiting on a package (D-067).
    // After the commit: the queue reads the version on its own connection.
    if ((result.value as { review_state?: string }).review_state === "approved") {
      void queuePdfs([versionId]).catch((error: unknown) => console.error("pdf queue", error));
    }
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
    if (await writesToArchived(req, principal.event_id)) return res.status(409).json(ARCHIVED_REFUSAL);
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
    if (await writesToArchived(req, session.event_id)) return res.status(409).json(ARCHIVED_REFUSAL);
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
  withPortalSession(req, res, async (session, tx) => {
    // The event's own upload deadline (D-071). The portal showed "Feb 27 · 23:59 ET" on
    // every event; it now shows this, or says none is set.
    const { rows } = await tx.query<{ deadline: string | null }>(
      `SELECT settings ->> 'upload_deadline' AS deadline FROM pmp.events WHERE id = $1`,
      [session.event_id],
    );
    return res.json({
      speaker: { id: session.speaker_id, name: session.speaker_name },
      event: {
        id: session.event_id,
        name: session.event_name,
        timezone: session.timezone,
        upload_deadline: rows[0]?.deadline || null,
      },
    });
  }),
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
  //
  // Every version of the same talk, not just this one (D-070): a reviewer opening v3
  // needs the note that sent v2 back, or they review blind.
  const items = await withScope(scopeFor(req), async (tx) => {
    const { rows } = await tx.query(
      `SELECT c.id, c.lane, c.body, c.created_at, fv.version_number,
              COALESCE(u.display_name, sp.full_name) AS author,
              (c.author_speaker_id IS NOT NULL) AS from_speaker
         FROM pmp.comments c
         JOIN pmp.file_versions fv ON fv.id = c.file_version_id
         LEFT JOIN pmp.users u ON u.id = c.author_user_id
         LEFT JOIN pmp.speakers sp ON sp.id = c.author_speaker_id
        WHERE fv.file_id = (SELECT file_id FROM pmp.file_versions WHERE id = $1)
        ORDER BY c.created_at`,
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

/**
 * The uploaded file plus whatever the operator has since changed about it — the column
 * mapping and any cells they have typed in. Both are held here so that re-mapping a
 * column does not discard corrections, and correcting a cell does not discard the
 * mapping. Every re-validation runs the whole file through `buildPreview` again.
 */
const importCache = new Map<
  string,
  {
    eventId: string;
    fileName: string;
    body: Buffer;
    mapping?: (ImportField | null)[];
    overrides?: RowOverrides;
    /**
     * Set when the agenda is being typed in rather than uploaded. Rows may only be
     * added and removed on such an import: on a file one the row numbers belong to
     * the file, and moving them would detach the operator's corrections from the rows
     * they were typed for.
     */
    manual?: boolean;
    /** How many rows the operator has typed in. */
    blankRows?: number;
    /** Row numbers taken out of the import; skipped rather than renumbered. */
    excluded?: number[];
    /**
     * For a typed agenda, the session each row has written (D-053). A row is saved
     * straight to the event, so this is how a later edit finds the session it made
     * instead of creating a second one, and how Remove knows what to delete.
     */
    sessions?: Record<number, string>;
    /**
     * The mapping the last preview actually used — the operator's if they corrected a
     * column, the auto-mapped one otherwise. Kept apart from `mapping`, which means
     * "the operator chose this" and is fed back into `buildPreview` as an override.
     * This one is only read when the commit writes its record, so an auto-mapped
     * import still records how its columns were read.
     */
    effectiveMapping?: (ImportField | null)[];
  }
>();

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
  importCache.set(uploadId, { ...importCache.get(uploadId)!, effectiveMapping: [...result.value.mapping] });
  return res.status(201).json({ ...result.value, upload_id: uploadId, manual: false, saved_rows: [] });
});

/**
 * Start an agenda with no file — the operator types the sessions in.
 *
 * It is the same import as an uploaded one, holding the template's headings and no
 * data rows, so mapping, validation, the row editor and the all-or-nothing commit are
 * the ones the file path already uses. Only where the rows come from differs.
 */
app.post("/api/v1/events/:eventId/imports/blank", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });

  const eventId = String(req.params.eventId);
  const uploadId = randomUUID();
  const fileName = "manual-entry.csv";
  const body = Buffer.from(manualAgendaCsv(), "utf8");
  importCache.set(uploadId, { eventId, fileName, body, manual: true, blankRows: 1 });

  const result = await withScope(scopeFor(req, eventId), (tx) =>
    buildPreview(tx, {
      eventId,
      fileName,
      body,
      actorId: actor.id,
      s3Key: `imports/${uploadId}`,
      blankRows: 1,
    }),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  importCache.set(uploadId, { ...importCache.get(uploadId)!, effectiveMapping: [...result.value.mapping] });
  return res.status(201).json({ ...result.value, upload_id: uploadId, manual: true, saved_rows: [] });
});

/**
 * Runs the cached file back through validation with whatever is currently known.
 *
 * Also remembers the mapping the preview settled on. The commit writes the import
 * record now (D-051) and has no parsed sheet of its own, so without this an
 * auto-mapped agenda — the ordinary case — would record no mapping at all.
 */
async function revalidate(req: express.Request, actor: Actor, uploadId: string) {
  const cached = importCache.get(uploadId)!;
  const result = await withScope(scopeFor(req, cached.eventId), (tx) =>
    buildPreview(tx, {
      eventId: cached.eventId,
      fileName: cached.fileName,
      body: cached.body,
      actorId: actor.id,
      s3Key: `imports/${uploadId}`,
      ...(cached.mapping ? { mapping: cached.mapping } : {}),
      ...(cached.overrides ? { overrides: cached.overrides } : {}),
      ...(cached.blankRows ? { blankRows: cached.blankRows } : {}),
      ...(cached.excluded ? { excluded: cached.excluded } : {}),
    }),
  );
  if (result.ok) {
    const current = importCache.get(uploadId);
    if (current) importCache.set(uploadId, { ...current, effectiveMapping: [...result.value.mapping] });
  }
  return result;
}

/** Re-map columns and re-validate without re-uploading the file. */
app.post("/api/v1/imports/:uploadId/remap", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const cached = importCache.get(String(req.params.uploadId));
  if (!cached) return res.status(404).json({ code: "import.expired", message: "Upload the file again." });
  const body = req.body as { mapping?: (ImportField | null)[] };
  if (body.mapping) importCache.set(String(req.params.uploadId), { ...cached, mapping: body.mapping });

  const result = await revalidate(req, actor, String(req.params.uploadId));
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json({
    ...result.value,
    upload_id: String(req.params.uploadId),
    manual: cached.manual ?? false,
    saved_rows: savedRows(String(req.params.uploadId)),
  });
});

/**
 * A cell the operator typed on the review screen, for a row the file left incomplete.
 *
 * Corrections are sent as cell values and re-enter `buildPreview` where the file's own
 * cells do, so the date is parsed, the venue timezone applied and the
 * (room, start, title) match key recomputed by exactly the code that rejected the row.
 * Doing it in the browser would have meant a second implementation of the timezone
 * conversion, which is the part most worth having only once.
 */
app.post("/api/v1/imports/:uploadId/cells", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const uploadId = String(req.params.uploadId);
  const cached = importCache.get(uploadId);
  if (!cached) return res.status(404).json({ code: "import.expired", message: "Upload the file again." });

  const body = req.body as {
    row?: number;
    field?: ImportField;
    value?: string;
    cells?: Partial<Record<ImportField, string>>;
  };
  if (typeof body.row !== "number") {
    return res.status(400).json({ code: "request.invalid", message: "`row` is required." });
  }

  /*
   * One field or a whole row. The row editor saves several cells at once, and sending
   * them one at a time would re-read the file once per field and race its own results
   * — the last response to arrive would win, not the last edit made.
   */
  const patch: Partial<Record<ImportField, string>> =
    body.cells ?? (typeof body.field === "string" ? { [body.field]: body.value ?? "" } : {});
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ code: "request.invalid", message: "`cells` or `field` is required." });
  }
  const unknown = Object.keys(patch).filter((field) => !IMPORT_FIELDS.includes(field as ImportField));
  if (unknown.length > 0) {
    return res.status(400).json({ code: "request.invalid", message: `Unknown field ${unknown[0]}.` });
  }

  const overrides: RowOverrides = {
    ...cached.overrides,
    [body.row]: { ...cached.overrides?.[body.row], ...patch },
  };
  importCache.set(uploadId, { ...cached, overrides });

  const result = await revalidate(req, actor, uploadId);
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  // On a typed agenda, saving the row is what puts it on the event (D-053).
  await persistTypedRow(req, actor, uploadId, body.row, result.value);
  return res.json({
    ...result.value,
    upload_id: uploadId,
    manual: cached.manual ?? false,
    saved_rows: savedRows(uploadId),
  });
});

/**
 * One more row, after the last the import already has — with its values, not before
 * them.
 *
 * `cells` is optional, but it is how the screen uses this: the editor for a new
 * session opens over nothing on the server, and only saving sends anything here.
 * Appending the row first and filling it afterwards is what left an empty row behind
 * every time the dialog was cancelled.
 */
app.post("/api/v1/imports/:uploadId/rows", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const uploadId = String(req.params.uploadId);
  const cached = importCache.get(uploadId);
  if (!cached) return res.status(404).json({ code: "import.expired", message: "Upload the file again." });
  if (!cached.manual) {
    return res.status(400).json({ code: "import.not_manual", message: "This agenda came from a file." });
  }

  const body = (req.body ?? {}) as { cells?: Partial<Record<ImportField, string>> };
  const cells = body.cells ?? {};
  const unknown = Object.keys(cells).filter((field) => !IMPORT_FIELDS.includes(field as ImportField));
  if (unknown.length > 0) {
    return res.status(400).json({ code: "request.invalid", message: `Unknown field ${unknown[0]}.` });
  }

  const blankRows = (cached.blankRows ?? 0) + 1;
  /*
   * A typed agenda carries no rows from a file, so its data rows are numbered from 2
   * — the headings are row 1 — and the row just appended is the last of them.
   */
  const addedRow = blankRows + 1;
  const overrides: RowOverrides = { ...cached.overrides };
  if (Object.keys(cells).length > 0) overrides[addedRow] = cells;
  importCache.set(uploadId, { ...cached, blankRows, overrides });
  const result = await revalidate(req, actor, uploadId);
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  await persistTypedRow(req, actor, uploadId, addedRow, result.value);
  return res.json({
    ...result.value,
    upload_id: uploadId,
    manual: cached.manual ?? false,
    saved_rows: savedRows(uploadId),
  });
});

/**
 * Take a row out of the import — a row from a file as readily as a typed one.
 *
 * It is skipped, not deleted. A file's row numbers belong to the file, so an error
 * that names row 12 has to mean the twelfth row of the spreadsheet on the operator's
 * screen; shifting the rows below a removal would break that, and would also detach
 * every correction typed into them, `overrides` being keyed by row number. Skipping
 * costs nothing and keeps both true — which is why removal now works on an uploaded
 * agenda at all, where renumbering had ruled it out.
 */
app.delete("/api/v1/imports/:uploadId/rows/:row", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const uploadId = String(req.params.uploadId);
  const cached = importCache.get(uploadId);
  if (!cached) return res.status(404).json({ code: "import.expired", message: "Upload the file again." });

  const row = Number(req.params.row);
  if (!Number.isInteger(row)) {
    return res.status(400).json({ code: "request.invalid", message: "`row` must be a row number." });
  }
  if (cached.excluded?.includes(row)) {
    return res.status(409).json({ code: "import.already_removed", message: "That row is already out." });
  }

  const excluded = [...(cached.excluded ?? []), row];
  importCache.set(uploadId, { ...cached, excluded });

  const result = await revalidate(req, actor, uploadId);
  if (!result.ok) {
    importCache.set(uploadId, cached);
    return res.status(statusFor(result.error)).json(result.error);
  }

  /*
   * On a typed agenda the row is already a session (D-053), so removing it is a
   * deletion rather than "leave this out of the import". The screen asks first; this
   * is what it asks about.
   */
  const session = cached.sessions?.[row];
  if (cached.manual && session) {
    const removal = await withScope(scopeFor(req, cached.eventId), (tx) =>
      deleteTypedSession(tx, actor, { eventId: cached.eventId, sessionId: session }),
    );
    if (!removal.ok) {
      importCache.set(uploadId, cached);
      return res.status(statusFor(removal.error)).json(removal.error);
    }
    const current = importCache.get(uploadId)!;
    const sessions = { ...current.sessions };
    delete sessions[row];
    importCache.set(uploadId, { ...current, sessions });
  }
  /*
   * Asked rather than counted. Whether a row is the last one depends on what the file
   * held, what was typed and what is already out, and `buildPreview` is the only thing
   * that knows all three — so the removal is tried and put back if it emptied the
   * import, instead of a second count here that could disagree with it.
   */
  if (result.value.rows.length === 0) {
    importCache.set(uploadId, cached);
    return res.status(400).json({ code: "import.last_row", message: "An agenda needs at least one row." });
  }
  return res.json({
    ...result.value,
    upload_id: uploadId,
    manual: cached.manual ?? false,
    saved_rows: savedRows(uploadId),
  });
});

/** Puts every removed row back, for a removal the operator did not mean. */
app.post("/api/v1/imports/:uploadId/rows/restore", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const uploadId = String(req.params.uploadId);
  const cached = importCache.get(uploadId);
  if (!cached) return res.status(404).json({ code: "import.expired", message: "Upload the file again." });

  importCache.set(uploadId, { ...cached, excluded: [] });
  const result = await revalidate(req, actor, uploadId);
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json({
    ...result.value,
    upload_id: uploadId,
    manual: cached.manual ?? false,
    saved_rows: savedRows(uploadId),
  });
});

/**
 * Writes a typed row to the event and remembers the session it made (D-053).
 *
 * A row that is still incomplete is left alone rather than refused — the operator may
 * be part-way through it, and the screen already disables Save until it is complete.
 * This is the belt to that braces.
 */
async function persistTypedRow(
  req: express.Request,
  actor: Actor,
  uploadId: string,
  rowNumber: number,
  preview: ImportPreview,
): Promise<void> {
  const cached = importCache.get(uploadId);
  if (!cached?.manual) return;
  const row = preview.rows.find((candidate) => candidate.row === rowNumber);
  if (!row || row.missing.length > 0) return;

  const existing = cached.sessions?.[rowNumber];
  const result = await withScope(scopeFor(req, cached.eventId), (tx) =>
    saveTypedRow(tx, actor, {
      eventId: cached.eventId,
      row,
      ...(existing ? { sessionId: existing } : {}),
    }),
  );
  if (!result.ok) return;

  const current = importCache.get(uploadId);
  if (current) {
    importCache.set(uploadId, {
      ...current,
      sessions: { ...current.sessions, [rowNumber]: result.value.session_id },
    });
  }
}

/** Which rows of a typed agenda are on the event, so the screen can say so. */
const savedRows = (uploadId: string): number[] =>
  Object.keys(importCache.get(uploadId)?.sessions ?? {}).map(Number);

/**
 * Commit, keyed by the upload rather than by a `schedule_imports` row (D-051).
 *
 * It used to be keyed by a record the *preview* had inserted, which is what made every
 * look at a file leave an import behind. There is no record to name until the commit
 * succeeds, so the staging session identifies itself — the same `upload_id` that
 * `cells`, `remap` and the row routes already use.
 *
 * The event now comes from the cache entry rather than the request body, and
 * `scopeFor` refuses a caller with no role on it. That is the check the authz
 * middleware used to make by looking the import row up, and it is the stronger of the
 * two: a body can claim any event, a cache entry cannot.
 */
app.post("/api/v1/imports/:uploadId/commit", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const uploadId = String(req.params.uploadId);
  const cached = importCache.get(uploadId);
  if (!cached) return res.status(404).json({ code: "import.expired", message: "Upload the file again." });

  const body = req.body as { rows?: StagedRow[] };
  if (!Array.isArray(body.rows)) {
    return res.status(400).json({ code: "request.invalid", message: "`rows` is required." });
  }

  const result = await withScope(scopeFor(req, cached.eventId), (tx) =>
    commitImport(tx, actor, {
      eventId: cached.eventId,
      rows: body.rows as StagedRow[],
      fileName: cached.fileName,
      s3Key: `imports/${uploadId}`,
      mapping: cached.effectiveMapping ?? cached.mapping ?? [],
    }),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json(result.value);
});

/**
 * The blank agenda template. Generated from the same field list the mapper uses rather
 * than served as a static file, so it cannot drift from what the importer understands
 * — a template offering a column we no longer read, or missing one we now require,
 * would send an operator away to fill in the wrong thing.
 */
app.get("/api/v1/events/:eventId/agenda-template", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const eventId = String(req.params.eventId);
  const name = await withScope(scopeFor(req, eventId), async (tx) => {
    const { rows } = await tx.query<{ name: string }>(`SELECT name FROM pmp.events WHERE id = $1`, [eventId]);
    return rows[0]?.name;
  });
  res.header("content-type", "text/csv; charset=utf-8");
  res.header("content-disposition", 'attachment; filename="dxg-agenda-template.csv"');
  return res.send(agendaTemplateCsv(name));
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
  const [latest, downloads] = await withScope(scopeFor(req, eventId), async (tx) => [
    await latestPackage(tx, eventId),
    await packageDownloads(tx, eventId),
  ] as const);
  return res.json({ ...scope, latest_package: latest, downloads });
});

/*
 * Queue PDF conversion for every approved talk that belongs in the PDF package and has
 * no PDF yet (D-067). `retry: true` also re-runs the ones that failed. Returns at once;
 * the archive builder polls the scope for progress.
 */
app.post("/api/v1/events/:eventId/archive/pdfs", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  if (!actor.roles.some((role) => ["presentation_manager", "project_manager", "platform_admin"].includes(role))) {
    return res.status(403).json({ code: "archive.forbidden", message: "Converting needs a presentation manager or above." });
  }
  const eventId = String(req.params.eventId);
  const ids = await withScope(scopeFor(req, eventId), (tx) => pdfCandidates(tx, eventId));
  const queued = await queuePdfs(ids, (req.body as { retry?: boolean } | undefined)?.retry === true);
  return res.json({ queued });
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
  // The link lasts 30 days from the event's end (D-069); the caller no longer picks it.
  const result = await withScope(scopeFor(req), (tx) =>
    deliverPackage(tx, actor, String(req.params.packageId)),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json(result.value);
});

app.get("/api/v1/archive-packages/:packageId/download", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const format = req.query.format === "pdf" ? "pdf" : "pptx";
  const result = await withScope(scopeFor(req), (tx) =>
    downloadPackage(tx, actor, String(req.params.packageId), format),
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
  const isClient = actor.roles.some((role) => clientRoles.includes(role));
  // Staff may look at this, as a preview of what their client sees.
  //
  // It is not a widening of what staff know: this view is a strict *subset* of the
  // control centre they already have, with restricted talks filtered out
  // (FR-ARCH-001). Refusing it only meant staff could not check what they were
  // about to show someone. The response says which kind of viewer asked, so the
  // screen can mark itself a preview rather than letting a staff member mistake a
  // deliberately narrowed view for the whole picture.
  const isStaff = actor.roles.some((role) => STAFF_ROLES.includes(role));
  if (!isClient && !isStaff) {
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

    return {
      event: eventRows[0],
      totals: totals[0],
      tracks,
      package: await latestPackage(tx, eventId),
      downloads: await packageDownloads(tx, eventId),
    };
  });

  // `viewed_as` is presentation, not permission — the filtering above already
  // happened, identically for both. It exists so the screen can say whose eyes
  // this is through.
  return res.json({ ...data, viewed_as: isClient ? "client" : "staff_preview" });
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
    basics?: { name: string; venue: string; timezone: string; starts_on: string; ends_on: string };
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

// Archive and restore (D-061). Reversible statuses, not deletions; audited both ways.
app.post("/api/v1/events/:eventId/archive", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const body = (req.body ?? {}) as { reason?: string };
  const result = await withScope(scopeFor(req), (tx) =>
    archiveEvent(tx, actor, String(req.params.eventId), typeof body.reason === "string" ? body.reason : ""),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json(result.value);
});

app.post("/api/v1/events/:eventId/restore", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const result = await withScope(scopeFor(req), (tx) =>
    restoreEvent(tx, actor, String(req.params.eventId)),
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
/**
 * SES delivery events, delivered by SNS. The signature is verified before
 * anything is recorded: a forged bounce would suppress future mail to that
 * speaker, so an unverified message is not merely ignored, it is refused.
 *
 * Accepts the platform's own shape too, which is how the bounce path is
 * exercised in development without an AWS account.
 */
const snsCertificates = new Map<string, string>();

async function fetchSnsCertificate(url: string): Promise<string> {
  const cached = snsCertificates.get(url);
  if (cached) return cached;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`certificate fetch failed: ${response.status}`);
  const pem = await response.text();
  snsCertificates.set(url, pem);
  return pem;
}

/**
 * SNS posts notifications with `Content-Type: text/plain; charset=UTF-8`, not
 * `application/json`, so the global `express.json()` never parses them and the
 * body arrives undefined. That silently breaks the whole delivery-event pipeline
 * — including the SubscriptionConfirmation that activates the subscription in the
 * first place, so the failure looks like "SNS never called us" rather than a bug
 * here. Parse regardless of the declared type; the signature check below is what
 * actually establishes trust, not the Content-Type header.
 */
const snsBody = express.json({ type: () => true, limit: "256kb" });

app.post("/api/v1/webhooks/email", snsBody, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  // The platform's own shape — used by the development mail path and by tests.
  if (typeof body.communication_id === "string" && typeof body.event_type === "string") {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_DIRECT_EMAIL_EVENTS !== "on") {
      return res.status(403).json({
        code: "webhooks.signature_required",
        message: "Delivery events must arrive signed, through SNS.",
      });
    }
    const result = await withSystemScope((tx) =>
      recordDeliveryEvent(tx, {
        communicationId: body.communication_id as string,
        eventType: body.event_type as string,
        payload: (body.payload as Record<string, unknown>) ?? {},
      }),
    );
    if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
    return res.json(result.value);
  }

  if (typeof body.Type !== "string") {
    return res.status(400).json({ code: "request.invalid", message: "Unrecognised delivery event." });
  }

  const message = body as unknown as SnsMessage;
  const allowed = (process.env.SNS_TOPIC_ARNS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const verdict = await verifySnsMessage(message, {
    fetchCertificate: fetchSnsCertificate,
    ...(allowed.length > 0 ? { allowedTopicArns: allowed } : {}),
  });
  if (!verdict.valid) {
    console.error(`[webhook] rejected SNS message: ${verdict.reason}`);
    return res.status(403).json({ code: "webhooks.invalid_signature", message: "Signature check failed." });
  }

  // SNS confirms a subscription by asking the endpoint to visit a URL it signs.
  if (message.Type === "SubscriptionConfirmation" && message.SubscribeURL) {
    await fetch(message.SubscribeURL).catch((error: unknown) =>
      console.error("[webhook] subscription confirmation failed:", error),
    );
    return res.status(200).json({ confirmed: true });
  }

  const event = parseSesEvent(message.Message);
  if (!event) return res.status(200).json({ ignored: true });

  const recorded = await withSystemScope(async (tx) => {
    const communicationId = await findCommunication(tx, {
      communicationId: event.communicationId,
      messageId: event.messageId,
    });
    if (!communicationId) return null;
    return recordDeliveryEvent(tx, {
      communicationId,
      eventType: event.status,
      payload: { ...event.detail, sns_message_id: message.MessageId },
    });
  });

  // An event for something we never sent is acknowledged, not retried forever.
  if (!recorded) return res.status(200).json({ ignored: true, reason: "no matching communication" });
  if (!recorded.ok) return res.status(statusFor(recorded.error)).json(recorded.error);
  return res.json(recorded.value);
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
  // Staff and presenters share this API origin, so one browser holds one session
  // cookie for both apps and signing into the portal replaces a staff session.
  // This endpoint answers "who is the signed-in *staff member*", so a presenter
  // here is not a staff member — it is no session at all. Returning the presenter
  // instead let the staff app render someone who cannot use it, and crash on the
  // roles a presenter does not have.
  if (!principal || principal.kind !== "staff") {
    return res.status(401).json({ code: "auth.no_session", message: "Not signed in." });
  }
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

/* ── account administration (screen: Admin · Staff accounts) ─────────────── */

app.get("/api/v1/admin/users", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const result = await withScope(scopeFor(req), (tx) => listStaff(tx, actor));
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json({ items: result.value });
});

app.post("/api/v1/admin/users/:userId/reset-password", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const result = await withScope(scopeFor(req), (tx) => resetPassword(tx, actor, String(req.params.userId)));
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json(result.value);
});

app.post("/api/v1/admin/users/:userId/reset-mfa", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const body = req.body as { reason?: string };
  const result = await withScope(scopeFor(req), (tx) =>
    resetMfa(tx, actor, String(req.params.userId), body.reason ?? ""),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json(result.value);
});

app.post("/api/v1/admin/users/:userId/active", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const body = req.body as { active?: boolean };
  const result = await withScope(scopeFor(req), (tx) =>
    setActive(tx, actor, String(req.params.userId), body.active !== false),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json(result.value);
});

app.post("/api/v1/admin/users/:userId/unlock", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const result = await withScope(scopeFor(req), (tx) => unlock(tx, actor, String(req.params.userId)));
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json(result.value);
});

app.post("/api/v1/admin/users/:userId/roles", async (req, res) => {
  const body = req.body as { event_id?: string; role?: string; grant?: boolean };
  if (!body.event_id || !body.role) {
    return res.status(400).json({ code: "request.invalid", message: "`event_id` and `role` are required." });
  }

  /*
   * The event is in the body, not the path, so the resolver above cannot see it — and
   * without it this route asked the flat question: "is this account a project manager
   * anywhere?" A project manager on one conference could therefore grant themselves,
   * or anyone, a role on another. Naming the event here puts the route back under the
   * same rule as every other, `platform_admin` exception and all.
   */
  (req as express.Request & { eventId?: string }).eventId = body.event_id;

  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.no_session", message: "Sign in to continue." });
  const input = {
    userId: String(req.params.userId),
    eventId: body.event_id,
    role: body.role as EventRole,
  };
  const result = await withScope(scopeFor(req, body.event_id), async (tx) =>
    body.grant === false
      ? ((await revokeRole(tx, actor, input)) as Result<{ granted?: true; revoked?: true }, DomainError>)
      : ((await grantRole(tx, actor, input)) as Result<{ granted?: true; revoked?: true }, DomainError>),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  return res.json(result.value);
});

/* ── self-service password reset ─────────────────────────────────────────── */

const STAFF_APP_BASE = process.env.STAFF_BASE ?? "http://localhost:3000";

app.post("/api/v1/auth/password-reset/request", async (req, res) => {
  const body = req.body as { email?: string };
  if (!body.email) {
    return res.status(400).json({ code: "request.invalid", message: "Enter your email address." });
  }
  await withSystemScope((tx) =>
    requestReset(tx, { email: body.email as string, resetBase: STAFF_APP_BASE, ip: clientIp(req) }),
  );
  // Always the same answer: whether an account exists is not something this
  // endpoint will tell you.
  return res.status(202).json({
    message: "If that address belongs to an account, a reset link is on its way.",
  });
});

app.post("/api/v1/auth/password-reset/confirm", async (req, res) => {
  const body = req.body as { token?: string; new_password?: string };
  if (!body.token || !body.new_password) {
    return res.status(400).json({ code: "request.invalid", message: "A token and a new password are required." });
  }
  const result = await withSystemScope((tx) =>
    completeReset(tx, {
      token: body.token as string,
      newPassword: body.new_password as string,
      ip: clientIp(req),
    }),
  );
  if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  return res.json(result.value);
});

/**
 * Last-resort error handler. Express's default writes the stack trace into the
 * response body, and `/api/v1/webhooks/email` is unauthenticated by necessity —
 * so without this, absolute paths and internals are served to anyone who posts a
 * malformed body. Registered after every route so it catches what they throw.
 */
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status =
    typeof err === "object" && err !== null && typeof (err as { status?: unknown }).status === "number"
      ? (err as { status: number }).status
      : 500;

  // An error that carries its own code and message said what it meant; pass it through
  // rather than replacing it with something vaguer.
  if (status >= 400 && status < 500) {
    const typed = err as { code?: unknown; message?: unknown };
    if (typeof typed.code === "string" && typeof typed.message === "string") {
      return res.status(status).json({ code: typed.code, message: typed.message });
    }
    // Body-parser rejections are the client's fault and safe to name, but say no more.
    return res.status(status).json({ code: "request.invalid", message: "Malformed request." });
  }

  console.error("[api] unhandled error:", err);
  return res.status(500).json({ code: "server.error", message: "Unexpected server error." });
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.error(`api listening on http://localhost:${port}`);
  // Conversions interrupted by a restart go back in line (D-067).
  resumePdfQueue().catch((error: unknown) => console.error("pdf queue resume failed", error));
});
