import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { signInStaff } from "../helpers/signIn.ts";

/**
 * The Agenda tab's endpoint (D-063): every session of the event, each carrying its
 * presentations, their speakers and the status the domain derives for them. Read-only,
 * signed-in, and event-scoped like every other `/events/{id}/…` route.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const PASSWORD = "dxg-development-password";
/** The seeded event (`db:seed`) — synthetic content, three timed sessions. */
const SEEDED = "22222222-2222-4222-8222-222222222222";

let up = false;
let admin = "";

type Agenda = {
  items: {
    id: string;
    title: string;
    starts_at: string;
    ends_at: string;
    room: string | null;
    presentations: {
      slot_id: string;
      title: string;
      speakers: { id: string; name: string; role: string }[];
      status: string;
      status_label: string;
    }[];
  }[];
};

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (up) admin = await signInStaff(API, "admin@example.invalid", PASSWORD);
});

describe("the event agenda", () => {
  test("lists sessions in time order, each with its presentations and speakers", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await fetch(`${API}/events/${SEEDED}/agenda`, { headers: { cookie: admin } });
    assert.equal(response.status, 200);
    const { items } = (await response.json()) as Agenda;
    assert.ok(items.length > 0, "the seeded event has sessions");
    const starts = items.map((session) => Date.parse(session.starts_at));
    assert.deepEqual(starts, [...starts].sort((a, b) => a - b), "sessions come in start order");
    const presentations = items.flatMap((session) => session.presentations);
    assert.ok(presentations.length > 0);
    assert.ok(presentations.some((item) => item.speakers.length > 0), "speakers are attached to their talks");
    for (const item of presentations) {
      assert.ok(item.status && item.status_label, "every presentation carries a derived status");
    }
  });

  test("agrees with the talks list about every presentation's status", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const [agenda, talks] = await Promise.all([
      fetch(`${API}/events/${SEEDED}/agenda`, { headers: { cookie: admin } }).then((r) => r.json() as Promise<Agenda>),
      fetch(`${API}/events/${SEEDED}/talks`, { headers: { cookie: admin } }).then(
        (r) => r.json() as Promise<{ items: { slot_id: string; status: string }[] }>,
      ),
    ]);
    const statusOf = new Map(talks.items.map((talk) => [talk.slot_id, talk.status]));
    for (const item of agenda.items.flatMap((session) => session.presentations)) {
      assert.equal(item.status, statusOf.get(item.slot_id), `status of "${item.title}"`);
    }
  });

  test("needs a session", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.equal((await fetch(`${API}/events/${SEEDED}/agenda`)).status, 401);
  });
});
