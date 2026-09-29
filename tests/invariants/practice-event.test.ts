import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { signInStaff } from "../helpers/signIn.ts";
import { createStaffAccount, grantRole } from "../helpers/account.ts";
import { removeTestAccounts } from "../helpers/cleanup.ts";
import { withSystemScope } from "@pmp/db";
import type { EmailSender, Message } from "@pmp/email";
import { handle } from "../../apps/dispatcher/src/handle.ts";

/**
 * Practice events (D-116): any DXG staff member can start one for themselves; it is
 * built from made-up speakers on `practice.invalid`; its emails are recorded as
 * "Practice — not sent" and never reach a mail transport; its project-manager role counts
 * only inside it; and one person may have at most three open.
 *
 * Practice events send (well — record) mail, which is history, so they are archived at
 * the end rather than deleted — which is also exactly how staff put one away.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const PASSWORD = "dxg-development-password";
const MEDTECH = "22222222-2222-4222-8222-222222222222";
const RUN = Date.now();
const STAFF_EMAIL = `probe-practice-staff-${RUN}@example.invalid`;
const CLIENT_EMAIL = `probe-practice-client-${RUN}@example.invalid`;
const MAIL = path.join(process.env.FILE_ROOT ?? ".data", "mail");
const STARTED = Date.now();

let up = false;
let admin = "";
let staff = "";
let staffId = "";
let client = "";
let first: { event_id: string; name: string; files: { title: string; state: string }[] } | null = null;
const created: string[] = [];

const json = (cookie: string) => ({ "content-type": "application/json", cookie });
const call = (cookie: string, method: string, route: string, body?: unknown) =>
  fetch(`${API}${route}`, {
    method,
    headers: json(cookie),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The "changes requested" email a practice event produces while it is built. */
const changesEmail = async (eventId: string) =>
  withSystemScope(async (tx) => {
    const { rows } = await tx.query<{ id: string; status: string; to_address: string }>(
      `SELECT id, status, to_address::text FROM pmp.communications WHERE event_id = $1 ORDER BY created_at LIMIT 1`,
      [eventId],
    );
    return rows[0];
  });

/** Mail files written by the file transport since this run began, that mention `address`. */
async function mailTo(address: string): Promise<string[]> {
  const names = await readdir(MAIL).catch(() => [] as string[]);
  const hits: string[] = [];
  for (const name of names) {
    const file = path.join(MAIL, name);
    if ((await stat(file)).mtimeMs < STARTED) continue;
    if ((await readFile(file, "utf8")).includes(address)) hits.push(name);
  }
  return hits;
}

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  admin = await signInStaff(API, "admin@example.invalid", PASSWORD);

  // A room technician on a real event: staff, and nowhere near a manager.
  const account = await createStaffAccount(API, admin, {
    email: STAFF_EMAIL,
    displayName: `Practice Probe ${RUN}`,
    password: "probe-practice-password",
  });
  staff = account.cookie;
  staffId = account.userId;
  await grantRole(API, admin, staffId, MEDTECH, "room_technician");

  // A client's account, which is not staff.
  const clientAccount = await createStaffAccount(API, admin, {
    email: CLIENT_EMAIL,
    displayName: `Practice Client Probe ${RUN}`,
    password: "probe-practice-password",
  });
  client = clientAccount.cookie;
  await grantRole(API, admin, clientAccount.userId, MEDTECH, "client_event_admin");
});

after(async () => {
  if (!up) return;
  for (const eventId of created) await call(admin, "POST", `/events/${eventId}/archive`, { reason: "practice probe" });
  await removeTestAccounts(["probe-practice-staff-", "probe-practice-client-"]);
});

describe("practice events (D-116)", () => {
  test("a staff member can start one, and it is a practice event with made-up speakers", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await call(staff, "POST", "/practice-events");
    assert.equal(response.status, 201);
    first = (await response.json()) as typeof first;
    created.push(first!.event_id);
    assert.match(first!.name, /^Practice — Practice Probe/);

    const facts = await withSystemScope(async (tx) => {
      const event = await tx.query<{ is_practice: boolean; status: string; practice_owner: string; client_practice: boolean }>(
        `SELECT e.is_practice, e.status, e.practice_owner, c.is_practice AS client_practice
           FROM pmp.events e JOIN pmp.clients c ON c.id = e.client_id WHERE e.id = $1`,
        [first!.event_id],
      );
      const speakers = await tx.query<{ email: string | null }>(
        `SELECT email::text FROM pmp.speakers WHERE event_id = $1`,
        [first!.event_id],
      );
      const role = await tx.query<{ role: string }>(
        `SELECT role FROM pmp.event_roles WHERE event_id = $1 AND user_id = $2`,
        [first!.event_id, staffId],
      );
      return { event: event.rows[0]!, speakers: speakers.rows, roles: role.rows.map((row) => row.role) };
    });
    assert.equal(facts.event.is_practice, true);
    assert.equal(facts.event.client_practice, true);
    assert.equal(facts.event.status, "active");
    assert.equal(facts.event.practice_owner, staffId);
    assert.deepEqual(facts.roles, ["project_manager"]);
    assert.ok(facts.speakers.length >= 5);
    for (const speaker of facts.speakers) assert.match(speaker.email ?? "", /@practice\.invalid$/);

    // Every state a reviewer meets, reached through the real services.
    const states = first!.files.map((file) => file.state);
    for (const state of ["approved", "changes requested", "waiting for review", "waiting for review, with a warning", "missing"]) {
      assert.ok(states.includes(state), `a file ${state}`);
    }

    // The portfolio can tell it apart.
    const listed = (await (await call(staff, "GET", "/events")).json()) as { items: { id: string; is_practice: boolean }[] };
    assert.equal(listed.items.find((event) => event.id === first!.event_id)?.is_practice, true);
  });

  test("its manager role counts only inside it", async (t: TestContext) => {
    if (!up || !first) return t.skip("API not running");
    const real = await call(staff, "POST", "/events", {
      client_id: "11111111-1111-4111-8111-111111111111",
      name: `Practice Escalation Probe ${RUN}`,
      venue: "",
      timezone: "America/New_York",
      starts_on: "2027-10-01",
      ends_on: "2027-10-02",
    });
    assert.equal(real.status, 403);
    assert.equal(((await real.json()) as { code: string }).code, "events.forbidden");
    // Inside it, the owner manages: the summary opens and it can be refused a copy, not access.
    assert.equal((await call(staff, "GET", `/events/${first.event_id}/summary`)).status, 200);
  });

  test("it can't be copied into a real event, and its client is never offered", async (t: TestContext) => {
    if (!up || !first) return t.skip("API not running");
    const copy = await call(admin, "POST", `/events/${first.event_id}/duplicate`, {
      name: `Practice Copy Probe ${RUN}`,
      starts_on: "2027-11-01",
      ends_on: "2027-11-02",
    });
    assert.equal(copy.status, 409);
    assert.equal(((await copy.json()) as { code: string }).code, "events.practice_conflict");
    const clients = (await (await call(admin, "GET", "/clients")).json()) as { items: { name: string }[] };
    assert.ok(!clients.items.some((row) => row.name === "DXG practice (not a real client)"));
  });

  test("a client account can't start one", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await call(client, "POST", "/practice-events");
    assert.equal(response.status, 403);
    assert.equal(((await response.json()) as { code: string }).code, "auth.not_staff");
  });

  test("the dispatcher records its email as practice and sends nothing (needs the current dispatcher running)", async (t: TestContext) => {
    if (!up || !first) return t.skip("API not running");
    let email = await changesEmail(first.event_id);
    assert.ok(email, "building it requested changes, which emails the speaker");
    for (let waited = 0; email!.status === "queued" && waited < 20_000; waited += 500) {
      await sleep(500);
      email = await changesEmail(first.event_id);
    }
    assert.equal(email!.status, "practice");
    assert.deepEqual(await mailTo(email!.to_address), [], "the file transport received nothing for it");
  });

  test("the guard itself: a practice communication is never handed to a sender", async (t: TestContext) => {
    if (!up || !first) return t.skip("API not running");
    // A fresh queued email on the practice event, handled here with a sender that records calls.
    const communicationId = await withSystemScope(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO pmp.communications (event_id, client_id, to_address, subject, body, status)
         SELECT id, client_id, 'someone@gmail.com', 'Practice probe', 'Hi', 'queued' FROM pmp.events WHERE id = $1
         RETURNING id`,
        [first!.event_id],
      );
      return rows[0]!.id;
    });
    const sent: Message[] = [];
    const sender: EmailSender = {
      name: "probe",
      send: async (message) => {
        sent.push(message);
        return { id: "probe", accepted: true };
      },
    };
    await handle(
      { id: "0", topic: "email.send", payload: { communication_id: communicationId, to: "someone@gmail.com", subject: "Practice probe" } },
      { sender, db: withSystemScope },
    );
    assert.equal(sent.length, 0);
    const status = await withSystemScope(async (tx) =>
      (await tx.query<{ status: string }>(`SELECT status FROM pmp.communications WHERE id = $1`, [communicationId])).rows[0]!.status,
    );
    assert.equal(status, "practice");
  });

  test("a fourth open practice event is refused", async (t: TestContext) => {
    if (!up || !first) return t.skip("API not running");
    for (let made = 1; made < 3; made += 1) {
      const response = await call(staff, "POST", "/practice-events");
      assert.equal(response.status, 201);
      created.push(((await response.json()) as { event_id: string }).event_id);
    }
    const fourth = await call(staff, "POST", "/practice-events");
    assert.equal(fourth.status, 422);
    const body = (await fourth.json()) as { code: string; message: string };
    assert.equal(body.code, "practice.limit_reached");
    assert.match(body.message, /Archive one/);

    // Archiving one makes room again.
    assert.equal((await call(staff, "POST", `/events/${created[0]}/archive`, {})).status, 200);
    const again = await call(staff, "POST", "/practice-events");
    assert.equal(again.status, 201);
    created.push(((await again.json()) as { event_id: string }).event_id);
  });
});
