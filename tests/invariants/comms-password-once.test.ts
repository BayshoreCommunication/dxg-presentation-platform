import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { signInStaff } from "../helpers/signIn.ts";
import { removeTestAccounts } from "../helpers/cleanup.ts";
import { withSystemScope } from "@pmp/db";

/**
 * D-179: a speaker's password is emailed when their sign-in is made — not again with every
 * invitation or reminder. A later batch tells them to sign in with the password they were sent
 * (or "Forgotten your password?") and leaves it unchanged. "Send sign-in" on the Speakers screen,
 * which exists to send it again, still issues a fresh one.
 *
 * The probe is reused, not recreated (see comms-cadence): an event that has sent mail can't be
 * deleted, so it is archived after and restored before.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const PASSWORD = "dxg-development-password";
const EVENT_NAME = "Comms Password Once Probe";
const RUN = Date.now();
const EMAIL = `password.once.${RUN}@example.invalid`;
const REDACTED = "[temporary password removed from the stored copy]";

let up = false;
let admin = "";
let eventId = "";
let invitation = "";
let reminder = "";
let speakerId = "";

const json = (cookie: string) => ({ "content-type": "application/json", cookie });
const call = (method: string, path: string, body?: unknown) =>
  fetch(`${API}${path}`, { method, headers: json(admin), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

/** The stored copy of the latest email to the speaker, and their password hash now. */
const latest = async (): Promise<{ body: string; hash: string }> =>
  withSystemScope(async (tx) => {
    const { rows } = await tx.query<{ body: string; hash: string }>(
      `SELECT c.body, u.password_hash AS hash
         FROM pmp.communications c, pmp.users u
        WHERE c.event_id = $1 AND c.speaker_id = $2 AND lower(u.email::text) = $3
        ORDER BY c.created_at DESC LIMIT 1`,
      [eventId, speakerId, EMAIL],
    );
    return rows[0]!;
  });
const ageSends = (hours: number) =>
  withSystemScope((tx) =>
    tx.query(`UPDATE pmp.communications SET created_at = created_at - make_interval(hours => $2) WHERE event_id = $1`, [
      eventId,
      hours,
    ]),
  );

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  admin = await signInStaff(API, "admin@example.invalid", PASSWORD);

  const existing = (await (await call("GET", "/events")).json()) as { items?: { id: string; name: string; status: string }[] };
  const probe = existing.items?.find((candidate) => candidate.name === EVENT_NAME);
  eventId = probe?.id ?? "";
  if (probe?.status === "archived") assert.equal((await call("POST", `/events/${eventId}/restore`)).status, 200);
  if (!eventId) {
    eventId = ((await (
      await call("POST", "/events", {
        client_id: "11111111-1111-4111-8111-111111111111",
        name: EVENT_NAME,
        venue: "Tampa",
        timezone: "America/New_York",
        starts_on: "2027-03-16",
        ends_on: "2027-03-16",
      })
    ).json()) as { event_id: string }).event_id;
  }
  // A new speaker each run, so their sign-in is made by this run's first invitation.
  const title = `Password Once Talk ${RUN}`;
  assert.equal((await call("POST", `/events/${eventId}/sessions`, { title, room: "Room A", track: "", date: "2027-03-16", start: "09:00", end: "10:00" })).status, 201);
  const agenda = (await (await call("GET", `/events/${eventId}/agenda`)).json()) as {
    items: { presentations: { slot_id: string; title: string }[] }[];
  };
  const slot = agenda.items.flatMap((item) => item.presentations).find((talk) => talk.title === title)!;
  speakerId = ((await (
    await call("POST", `/events/${eventId}/speakers`, { name: `Pat Once ${RUN}`, email: EMAIL, organization: "", slot_id: slot.slot_id })
  ).json()) as { speaker_id: string }).speaker_id;

  const comms = (await (await call("GET", `/events/${eventId}/comms`)).json()) as { templates: { id: string; name: string }[] };
  invitation = comms.templates.find((t) => t.name === "Upload invitation")!.id;
  reminder = comms.templates.find((t) => t.name === "Reminder — file still missing")!.id;
  await ageSends(48);
});

after(async () => {
  if (!up) return;
  await removeTestAccounts(["password.once."]);
  await withSystemScope((tx) => tx.query(`UPDATE pmp.events SET status = 'archived' WHERE id = $1`, [eventId]));
});

describe("a speaker's password is emailed once, when their sign-in is made (D-179)", () => {
  let firstHash = "";

  test("the first invitation makes the sign-in and carries a temporary password", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const sent = (await (await call("POST", `/events/${eventId}/comms/send`, { template_id: invitation, missing_only: false })).json()) as {
      queued: number;
    };
    assert.ok(sent.queued >= 1);
    const email = await latest();
    assert.ok(email.body.includes(REDACTED), "the password was in the email (redacted from the stored copy)");
    firstHash = email.hash;
  });

  test("a later reminder carries no password, and the password is unchanged", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    await ageSends(48);
    const sent = (await (await call("POST", `/events/${eventId}/comms/send`, { template_id: reminder, missing_only: true, speaker_ids: [speakerId] })).json()) as {
      queued: number;
    };
    assert.equal(sent.queued, 1);
    const email = await latest();
    assert.ok(!email.body.includes(REDACTED), "no password in the reminder");
    assert.match(email.body, /the one we sent you when your sign-in was made/);
    assert.match(email.body, /Forgotten your password\?/);
    assert.equal(email.hash, firstHash, "the speaker's password still works");
  });

  test('"Send sign-in" still sends a fresh temporary password', async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const sent = await call("POST", `/events/${eventId}/speakers/${speakerId}/send-link`);
    assert.ok(sent.ok, `send-link: ${sent.status}`);
    const email = await latest();
    assert.ok(email.body.includes(REDACTED), "a password in this one");
    assert.notEqual(email.hash, firstHash, "a new temporary password replaced the unused one");
  });
});
