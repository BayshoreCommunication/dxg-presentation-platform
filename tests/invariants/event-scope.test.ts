import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { signInStaff } from "../helpers/signIn.ts";
import { removeTestEvents } from "../helpers/cleanup.ts";

/**
 * SRS §5: "Access shall be event-scoped and least-privilege. Client and event
 * isolation is mandatory."
 *
 * The flattened role list on the principal says what an account can ever do. It does
 * not say where. Before this was enforced, a content reviewer on one conference could
 * read another conference's speakers and figures — two different clients' material,
 * separated by nothing but the absence of a link to it.
 *
 * `platform_admin` is the deliberate exception: someone has to create the first event
 * and grant roles on it, which cannot itself be done from inside an event.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const EVENT_A = "22222222-2222-4222-8222-222222222222";
const PASSWORD = "dxg-development-password";

let up = false;
let admin = "";
let reviewer = "";
let EVENT_B = "";

/** Every event-scoped surface worth checking, not just the one that exposed this. */
const surfaces = (eventId: string) => [
  ["summary", `${API}/events/${eventId}/summary`],
  ["speakers", `${API}/events/${eventId}/speakers`],
  ["review queue", `${API}/events/${eventId}/review-queue`],
  ["archive scope", `${API}/events/${eventId}/archive/scope`],
  ["communications", `${API}/events/${eventId}/comms`],
  ["room sync fleet", `${API}/events/${eventId}/sync/fleet`],
  ["talks", `${API}/events/${eventId}/talks`],
  ["risk list", `${API}/events/${eventId}/risk-list`],
  ["speaker ready room", `${API}/events/${eventId}/srr`],
];

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;

  // No `?? ""` and no skip-on-failure: the API answered its health check, so a
  // sign-in that fails here is a real failure and should be seen as one.
  admin = await signInStaff(API, "admin@example.invalid", PASSWORD);
  reviewer = await signInStaff(API, "c.delgado@example.invalid", PASSWORD);

  // A second event the reviewer holds no role on. Reused if a previous run made it.
  const { items } = (await (await fetch(`${API}/events`, { headers: { cookie: admin } })).json()) as {
    items: { id: string; name: string }[];
  };
  const existing = items.find((event) => event.name === "Event Scope Probe");
  EVENT_B =
    existing?.id ??
    (
      (await (
        await fetch(`${API}/events`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: admin },
          body: JSON.stringify({
            name: "Event Scope Probe",
            venue: "Elsewhere",
            timezone: "America/New_York",
            starts_on: "2026-06-01",
            ends_on: "2026-06-02",
          }),
        })
      ).json()) as { event_id: string }
    ).event_id;
});

describe("a role on one event is not a role on another", () => {
  test("the reviewer reaches the event they are actually on", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await fetch(`${API}/events/${EVENT_A}/summary`, { headers: { cookie: reviewer } });
    assert.equal(response.status, 200, "holding a role on this event must still work");
  });

  for (const [label] of surfaces("x")) {
    test(`the reviewer is refused another event's ${label}`, async (t: TestContext) => {
      if (!up) return t.skip("API not running");
      const url = surfaces(EVENT_B).find(([name]) => name === label)![1]!;
      const response = await fetch(url, { headers: { cookie: reviewer } });
      const body = (await response.json().catch(() => ({}))) as { code?: string };

      assert.equal(response.status, 403, `${label} on another event must be refused, got ${response.status}`);
      assert.equal(body.code, "auth.not_on_this_event");
    });
  }

  test("the refusal names the reason rather than a generic failure", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await fetch(`${API}/events/${EVENT_B}/summary`, { headers: { cookie: reviewer } });
    const body = (await response.json()) as { message?: string };
    assert.match(String(body.message), /no role on this event/i);
  });

  test("a platform admin crosses events by design", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    // The exception exists so the first event can be created at all; if it ever
    // stops holding, bootstrapping a new installation breaks.
    for (const [label, url] of surfaces(EVENT_B)) {
      const response = await fetch(url, { headers: { cookie: admin } });
      assert.notEqual(response.status, 403, `platform admin should not be refused ${label}`);
    }
  });
});

/*
 * This suite needs a second event to prove a role on one is not a role on another, so
 * it makes one — and takes it away again. Left behind it sat in every portfolio and
 * every switcher, and the only way to clear it was wiping the database.
 */
after(async () => {
  if (!up) return;
  await removeTestEvents(["Event Scope Probe"]);
});
