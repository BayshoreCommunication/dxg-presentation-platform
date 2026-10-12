import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { hashPassword } from "@pmp/auth";
import { withSystemScope } from "@pmp/db";
import { writeZip } from "../../packages/files/src/zipWrite.ts";
import { cookieFrom } from "../helpers/signIn.ts";
import { removeTestAccounts } from "../helpers/cleanup.ts";

/**
 * Speaker Support Staff (client review, D-155): a speaker gives an assistant a sign-in; the
 * assistant reaches that speaker's presentations — and submits under their name — but
 * nothing else of the speaker site, and nothing of their own.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const PASSWORD = "dxg-development-password";
const SPEAKER = "p.raman@example.invalid";
const ASSISTANT = `probe-assistant-${Date.now()}@example.invalid`;

let up = false;
let speaker = "";
let assistant = "";
let assistantId = "";

const call = (cookie: string, method: string, path: string, body?: unknown) =>
  fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const signIn = async (email: string) =>
  cookieFrom(
    await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
  );

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  await removeTestAccounts(["probe-assistant-"]);
  speaker = await signIn(SPEAKER);
});

after(async () => {
  if (up) await removeTestAccounts(["probe-assistant-"]);
});

describe("a speaker gives an assistant a sign-in (D-155)", () => {
  test("added with a temporary password, emailed; listed as invited", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const added = await call(speaker, "POST", "/me/support-staff", { name: "Probe Assistant", email: ASSISTANT });
    assert.equal(added.status, 201);
    assistantId = ((await added.json()) as { user_id: string }).user_id;
    const list = (await (await call(speaker, "GET", "/me/support-staff")).json()) as { items: { email: string; state: string }[] };
    assert.equal(list.items.find((row) => row.email === ASSISTANT)?.state, "invited");
    const account = await withSystemScope(async (tx) =>
      (await tx.query<{ account_kind: string; must_change_password: boolean; assists: string }>(
        `SELECT account_kind, must_change_password, assists_user_id::text AS assists FROM pmp.users WHERE id = $1`,
        [assistantId],
      )).rows[0]!,
    );
    assert.equal(account.account_kind, "speaker", "a speaker account, so every speaker rule applies");
    assert.equal(account.must_change_password, true);
    const mailed = await withSystemScope(async (tx) =>
      (await tx.query(`SELECT 1 FROM pmp.outbox WHERE payload->>'to' = $1 AND (payload->>'sensitive')::boolean`, [ASSISTANT])).rows.length,
    );
    assert.equal(mailed, 1, "the sign-in goes by email, marked sensitive");
  });

  test("an address that is already an account, a speaker's own, or the speaker's is refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    for (const [email, code] of [
      ["m.vega@example.invalid", "support.email_taken"],
      ["k.osei@example.invalid", "support.email_taken"],
      [SPEAKER, "support.self"],
      [ASSISTANT, "support.email_taken"],
    ] as const) {
      const refused = await call(speaker, "POST", "/me/support-staff", { name: "Someone", email });
      assert.notEqual(refused.status, 201, email);
      assert.equal(((await refused.json()) as { code: string }).code, code, email);
    }
  });
});

describe("support staff submit the speaker's content, and nothing else", () => {
  before(async () => {
    if (!up || !assistantId) return;
    // Stands in for the assistant choosing their own password from the emailed one.
    const hash = await hashPassword(PASSWORD);
    await withSystemScope((tx) =>
      tx.query(`UPDATE pmp.users SET password_hash = $1, must_change_password = false WHERE id = $2`, [hash, assistantId]),
    );
    assistant = await signIn(ASSISTANT);
  });

  test("they see the speaker's presentations, named as the speaker's", async (t: TestContext) => {
    if (!up || !assistant) return t.skip("API not running");
    const session = (await (await call(assistant, "GET", "/me/session")).json()) as {
      principal: { assisting: { email: string } | null };
    };
    assert.equal(session.principal.assisting?.email, SPEAKER);
    const theirs = (await (await call(assistant, "GET", "/me/presentations")).json()) as {
      speaker: { email: string };
      events: { talks: unknown[] }[];
    };
    const own = (await (await call(speaker, "GET", "/me/presentations")).json()) as { events: { talks: unknown[] }[] };
    assert.equal(theirs.speaker.email, SPEAKER);
    assert.equal(theirs.events.flatMap((event) => event.talks).length, own.events.flatMap((event) => event.talks).length);
  });

  test("they upload to the speaker's talk; the version is the speaker's, submitted by them", async (t: TestContext) => {
    if (!up || !assistant) return t.skip("API not running");
    const own = (await (await call(speaker, "GET", "/me/presentations")).json()) as { events: { talks: { slot_id: string }[] }[] };
    const slot = own.events[0]!.talks[0]!.slot_id;
    const deck = writeZip([
      { name: "[Content_Types].xml", body: Buffer.from('<?xml version="1.0"?><Types/>') },
      { name: "ppt/presentation.xml", body: Buffer.from('<p:presentation><p:sldSz cx="12192000" cy="6858000"/></p:presentation>') },
      { name: "ppt/slides/slide1.xml", body: Buffer.from("<p:sld/>") },
    ]);
    const begun = await call(assistant, "POST", "/me/uploads", { slot_id: slot, file_name: "from-the-assistant.pptx", total_bytes: deck.length });
    assert.equal(begun.status, 201);
    const { upload_id } = (await begun.json()) as { upload_id: string };
    const part = await fetch(`${API}/me/uploads/${upload_id}/parts/1`, {
      method: "PUT",
      headers: { cookie: assistant, "content-type": "application/octet-stream" },
      body: deck,
    });
    assert.equal(part.status, 200);
    const done = await call(assistant, "POST", `/me/uploads/${upload_id}/complete`, { slot_id: slot, file_name: "from-the-assistant.pptx" });
    assert.equal(done.status, 200);
    const { file_version_id } = (await done.json()) as { file_version_id: string };
    const row = await withSystemScope(async (tx) =>
      (await tx.query<{ by_user: string | null; by_speaker: string | null }>(
        `SELECT uploaded_by_user::text AS by_user, uploaded_by_speaker::text AS by_speaker FROM pmp.file_versions WHERE id = $1`,
        [file_version_id],
      )).rows[0]!,
    );
    assert.equal(row.by_user, assistantId, "who actually submitted it");
    assert.ok(row.by_speaker, "and whose presentation it is");
  });

  test("the agenda, Speaker Ready Room, messages, events and support staff are the speaker's", async (t: TestContext) => {
    if (!up || !assistant) return t.skip("API not running");
    const events = (await (await call(speaker, "GET", "/me/events")).json()) as { items: { id: string }[] };
    const event = events.items[0]!.id;
    for (const path of ["/me/events", `/me/events/${event}/agenda`, `/me/events/${event}/srr`, "/me/notifications", "/me/support-staff"]) {
      const refused = await call(assistant, "GET", path);
      assert.equal(refused.status, 403, path);
      assert.equal(((await refused.json()) as { code: string }).code, "auth.support_staff_forbidden", path);
    }
    const adding = await call(assistant, "POST", "/me/support-staff", { name: "Another", email: "probe-assistant-2@example.invalid" });
    assert.equal(adding.status, 403, "an assistant has no assistants of their own");
  });

  test("removed, they can't sign in or use a session they had", async (t: TestContext) => {
    if (!up || !assistant) return t.skip("API not running");
    assert.equal((await call(speaker, "DELETE", `/me/support-staff/${assistantId}`)).status, 200);
    assert.equal((await call(assistant, "GET", "/me/presentations")).status, 401);
    const again = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: ASSISTANT, password: PASSWORD }),
    });
    assert.notEqual(again.status, 200);
  });
});
