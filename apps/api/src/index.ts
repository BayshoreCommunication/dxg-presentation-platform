import express from "express";
import { withScope, getPool, verifyAuditChain } from "@pmp/db";
import type { Actor, DomainError, ReviewAction } from "@pmp/domain";
import { listTalks } from "./services/talks.ts";
import { decide } from "./services/review.ts";

const app = express();
app.use(express.json());

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
      `SELECT id, name, starts_on, ends_on, timezone, status FROM pmp.events ORDER BY starts_on DESC`,
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

app.get("/api/v1/events/:eventId/:auditAndAction", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(401).json({ code: "auth.unknown_user", message: "Unknown dev user." });
  const { id: resource, action: customMethod } = splitAction(String(req.params.auditAndAction));
  if (resource !== "audit" || customMethod !== "verify") {
    return res.status(404).json({ code: "request.unknown_method", message: "Unknown method." });
  }
  const eventId = String(req.params.eventId);
  const verdict = await withScope({ userId: actor.id, clientId: DEV_CLIENT_ID, eventId }, (tx) =>
    verifyAuditChain(tx, eventId),
  );
  return res.json(verdict);
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.error(`api listening on http://localhost:${port}`);
});
