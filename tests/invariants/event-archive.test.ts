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
