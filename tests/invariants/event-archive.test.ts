import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { signInStaff } from "../helpers/signIn.ts";
import { removeTestEvents } from "../helpers/cleanup.ts";

/**
 * Archiving an event is reversible and deletes nothing (D-061).
 *
 * Archive takes any event off the portfolio; restore puts it back in the status it
 * had, so a draft goes back to setup and not onto the list as a live event. Both
 * refuse the move that makes no sense (archiving twice, restoring what is not
 * archived) rather than quietly succeeding.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const PASSWORD = "dxg-development-password";
const NAME = "Event Archive Probe";
const CLIENT = "11111111-1111-4111-8111-111111111111";

let up = false;
let admin = "";
let eventId = "";

const json = (cookie: string) => ({ "content-type": "application/json", cookie });
const post = (path: string, body: unknown = {}) =>
  fetch(`${API}${path}`, { method: "POST", headers: json(admin), body: JSON.stringify(body) });
const statusOf = async (id: string): Promise<string> =>
  ((await (await fetch(`${API}/events/${id}/draft`, { headers: { cookie: admin } })).json()) as { status: string })
    .status;

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  admin = await signInStaff(API, "admin@example.invalid", PASSWORD);
  const created = (await (
    await post("/events", {
      client_id: CLIENT,
      name: NAME,
      venue: "Tampa Convention Center",
      timezone: "America/New_York",
      starts_on: "2027-04-10",
      ends_on: "2027-04-11",
    })
  ).json()) as { event_id: string };
  eventId = created.event_id;
});

after(async () => {
  if (up) await removeTestEvents([NAME]);
});

describe("archiving an event", () => {
  test("any event can be archived, including an unfinished draft", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.equal(await statusOf(eventId), "draft");
    const response = await post(`/events/${eventId}/archive`, { reason: "abandoned setup" });
    assert.equal(response.status, 200);
    assert.equal(await statusOf(eventId), "archived");
  });

  test("the portfolio still returns it, marked archived, so it can be shown on request", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const { items } = (await (await fetch(`${API}/events`, { headers: { cookie: admin } })).json()) as {
      items: { id: string; status: string }[];
    };
    assert.equal(items.find((item) => item.id === eventId)?.status, "archived");
  });

  test("archiving twice is refused as a conflict", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await post(`/events/${eventId}/archive`);
    assert.equal(response.status, 409);
    assert.equal(((await response.json()) as { code: string }).code, "events.archive_conflict");
  });

  test("restoring returns it to the status it was archived from", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await post(`/events/${eventId}/restore`);
    assert.equal(response.status, 200);
    assert.equal(await statusOf(eventId), "draft", "a draft comes back as a draft, not a live event");
  });

  test("restoring an event that is not archived is refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await post(`/events/${eventId}/restore`);
    assert.equal(response.status, 409);
  });

  test("it needs a session", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await fetch(`${API}/events/${eventId}/archive`, { method: "POST" });
    assert.equal(response.status, 401);
  });
});

/**
 * An archived event is read-only (D-062): every write is refused with
 * `409 events.archived`, whichever door it comes through, and reads still work.
 */
describe("an archived event is read-only", () => {
  const AGENDA = [
    "Session Title,Session Location,Session Date,Session Start,Session End,Presenter Email",
    "Only Session,Ballroom A,04/10/2027,9:00 AM,10:00 AM,probe@example.invalid",
  ].join("\n");
  let frozen = "";
  let pendingUpload = "";
  let pendingRows: unknown[] = [];

  const expectArchived = async (response: Response) => {
    assert.equal(response.status, 409);
    assert.equal(((await response.json()) as { code: string }).code, "events.archived");
  };

  before(async () => {
    if (!up) return;
    const created = (await (
      await post("/events", {
        client_id: CLIENT,
        name: `${NAME} frozen`,
        venue: "Tampa Convention Center",
        timezone: "America/New_York",
        starts_on: "2027-04-10",
        ends_on: "2027-04-11",
      })
    ).json()) as { event_id: string };
    frozen = created.event_id;
    // An import staged before archiving, to be committed after.
    const preview = (await (
      await fetch(`${API}/events/${frozen}/imports`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream", "x-file-name": "agenda.csv", cookie: admin },
        body: Buffer.from(AGENDA, "utf8"),
      })
    ).json()) as { upload_id: string; rows: unknown[] };
    pendingUpload = preview.upload_id;
    pendingRows = preview.rows;
    assert.equal((await post(`/events/${frozen}/archive`)).status, 200);
  });

  test("editing its setup is refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await fetch(`${API}/events/${frozen}`, {
      method: "PATCH",
      headers: json(admin),
      body: JSON.stringify({ settings: { reminders: "T-7 only" } }),
    });
    await expectArchived(response);
  });

  test("starting an agenda import is refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await fetch(`${API}/events/${frozen}/imports`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-file-name": "agenda.csv", cookie: admin },
      body: Buffer.from(AGENDA, "utf8"),
    });
    await expectArchived(response);
  });

  test("an import staged before archiving cannot be committed after", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    await expectArchived(await post(`/imports/${pendingUpload}/commit`, { rows: pendingRows }));
  });

  test("sending communications is refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    await expectArchived(await post(`/events/${frozen}/comms/send`, { template: "invite", speaker_ids: [] }));
  });

  test("reading it still works", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.equal(await statusOf(frozen), "archived");
    const summary = await fetch(`${API}/events/${frozen}/summary`, { headers: { cookie: admin } });
    assert.equal(summary.status, 200);
  });

  test("duplicating it is allowed — the copy is a new, writable event", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await post(`/events/${frozen}/duplicate`, {
      name: `${NAME} copy`,
      starts_on: "2027-05-10",
      ends_on: "2027-05-11",
    });
    assert.equal(response.status, 201);
  });

  test("once restored, it can be changed again", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.equal((await post(`/events/${frozen}/restore`)).status, 200);
    const response = await fetch(`${API}/events/${frozen}`, {
      method: "PATCH",
      headers: json(admin),
      body: JSON.stringify({ settings: { reminders: "T-7 only" } }),
    });
    assert.equal(response.status, 200);
  });
});
