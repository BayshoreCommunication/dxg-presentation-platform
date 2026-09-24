import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { signInStaff, cookieFrom } from "../helpers/signIn.ts";

/**
 * Only the newest upload is reviewed (D-076, WORKFLOW_STATES §3 amended).
 *
 * A speaker who uploads v2 before v1 was decided used to leave both in Review
 * presentations, and a reviewer could approve the stale one. Now v1 is superseded the
 * moment v2 is stored — and because "superseded" can therefore mean "never approved",
 * rolling back to such a version is refused: it would approve a file nobody reviewed.
 *
 * The probe event is reused, not recreated: once it has files it cannot be deleted,
 * only archived, and a new one per run would pile up in the portfolio.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const PASSWORD = "dxg-development-password";
const NAME = "Stale Version Probe";
const CLIENT = "11111111-1111-4111-8111-111111111111";
const EMAIL = "stale.probe@example.invalid";
const AGENDA = [
  "Session Title,Session Location,Session Date,Session Start,Session End,Presenter Email",
  `Stale Probe Talk,Probe Room,06/01/2027,9:00 AM,10:00 AM,${EMAIL}`,
].join("\n");

let up = false;
let staff = "";
let eventId = "";
let slotId = "";
let presenter = "";

const json = (cookie: string) => ({ "content-type": "application/json", cookie });
const post = (path: string, body: unknown, cookie = staff) =>
  fetch(`${API}${path}`, { method: "POST", headers: json(cookie), body: JSON.stringify(body) });

/** Uploads one small file through the speaker portal, as a speaker would. */
async function upload(name: string, text: string): Promise<void> {
  const body = Buffer.from(text);
  const started = (await (
    await post("/portal/uploads", { slot_id: slotId, file_name: name, total_bytes: body.length }, presenter)
  ).json()) as { upload_id: string };
  await fetch(`${API}/portal/uploads/${started.upload_id}/parts/1`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream", cookie: presenter },
    body,
  });
  const done = await post(`/portal/uploads/${started.upload_id}/complete`, { slot_id: slotId, file_name: name }, presenter);
  assert.equal(done.status, 200, `${name} is accepted`);
}

type QueueItem = { file_version_id: string; slot_id: string; version_number: number; lock_version: number };
const queueForTalk = async (): Promise<QueueItem[]> =>
  ((await (await fetch(`${API}/events/${eventId}/review-queue`, { headers: { cookie: staff } })).json()) as {
    items: QueueItem[];
  }).items.filter((item) => item.slot_id === slotId);

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  staff = await signInStaff(API, "admin@example.invalid", PASSWORD);

  const existing = (await (await fetch(`${API}/events`, { headers: { cookie: staff } })).json()) as {
    items: { id: string; name: string; status: string }[];
  };
  const probe = existing.items.find((item) => item.name === NAME);
  if (probe) {
    eventId = probe.id;
    if (probe.status === "archived") await post(`/events/${eventId}/restore`, {});
  } else {
    const created = (await (
      await post("/events", {
        client_id: CLIENT,
        name: NAME,
        venue: "Probe Venue",
        timezone: "America/New_York",
        starts_on: "2027-06-01",
        ends_on: "2027-06-01",
      })
    ).json()) as { event_id: string };
    eventId = created.event_id;
    const preview = (await (
      await fetch(`${API}/events/${eventId}/imports`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream", "x-file-name": "agenda.csv", cookie: staff },
        body: Buffer.from(AGENDA, "utf8"),
      })
    ).json()) as { upload_id: string; rows: unknown[] };
    await post(`/imports/${preview.upload_id}/commit`, { rows: preview.rows });
  }

  const { items } = (await (await fetch(`${API}/events/${eventId}/agenda`, { headers: { cookie: staff } })).json()) as {
    items: { presentations: { slot_id: string; speakers: { id: string }[] }[] }[];
  };
  const talk = items[0]!.presentations[0]!;
  slotId = talk.slot_id;
  const { access_code } = (await (await post(`/speakers/${talk.speakers[0]!.id}/credentials`, {})).json()) as {
    access_code: string;
  };
  const login = await post("/portal/login", { email: EMAIL, code: access_code }, "");
  presenter = cookieFrom(login);
});

after(async () => {
  // Left archived between runs, out of the portfolio; the next run restores it.
  if (up && eventId) await post(`/events/${eventId}/archive`, {});
});

describe("only the newest upload is reviewed", () => {
  test("a newer upload replaces the one still waiting", async (t: TestContext) => {
    if (!up || !slotId) return t.skip("API not running");
    await upload("deck.pptx", `first ${Date.now()}`);
    await upload("deck.pptx", `second ${Date.now()}`);
    const waiting = await queueForTalk();
    assert.equal(waiting.length, 1, "one entry for the talk, not one per upload");
    const versions = (await (await fetch(`${API}/slots/${slotId}`, { headers: { cookie: staff } })).json()) as {
      versions: { version_number: number; review_state: string }[];
    };
    const newest = Math.max(...versions.versions.map((version) => version.version_number));
    assert.equal(waiting[0]!.version_number, newest, "the one left is the newest");
    assert.equal(
      versions.versions.find((version) => version.version_number === newest - 1)?.review_state,
      "superseded",
    );
  });

  test("a version replaced before review can never be rolled back to", async (t: TestContext) => {
    if (!up || !slotId) return t.skip("API not running");
    const [current] = await queueForTalk();
    const claimed = (await (
      await post(`/file-versions/${current!.file_version_id}:transition`, { action: "claim", lock_version: current!.lock_version })
    ).json()) as { lock_version: number };
    const approved = await post(`/file-versions/${current!.file_version_id}:transition`, {
      action: "approve",
      lock_version: claimed.lock_version,
    });
    assert.equal(approved.status, 200, "the newest version is approved");

    const { versions } = (await (await fetch(`${API}/slots/${slotId}`, { headers: { cookie: staff } })).json()) as {
      versions: { file_version_id: string; version_number: number; approved_at: string | null }[];
    };
    const neverApproved = versions.find((version) => version.version_number === current!.version_number - 1)!;
    assert.equal(neverApproved.approved_at, null);
    const rollBack = await post(`/slots/${slotId}/roll-back`, {
      target_version_id: neverApproved.file_version_id,
      reason: "probe: must be refused",
    });
    assert.equal(rollBack.status, 422);
    assert.equal(((await rollBack.json()) as { code: string }).code, "review.target_not_restorable");
  });
});
