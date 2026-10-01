import { test } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import type { EmailSender, Message } from "@pmp/email";
import { handle } from "./handle.ts";
import type { Db } from "./handle.ts";

/**
 * D-116: a practice event's email never reaches the mail transport, whatever its address.
 * The database is a stub that answers the one question the guard asks — is this
 * communication's event a practice event? — and records every write.
 */
function harness(practice: boolean) {
  const sent: Message[] = [];
  const writes: { sql: string; params: unknown[] }[] = [];
  const sender: EmailSender = {
    name: "stub",
    send: async (message) => {
      sent.push(message);
      return { id: "stub-1", accepted: true };
    },
  };
  const tx = {
    query: async (sql: string, params: unknown[] = []) => {
      if (/SELECT e\.is_practice/.test(sql)) return { rows: [{ is_practice: practice }] };
      writes.push({ sql, params });
      return { rows: [], rowCount: 1 };
    },
  } as unknown as pg.PoolClient;
  const db: Db = (fn) => fn(tx);
  return { sent, writes, deps: { sender, db, refuse: async () => null } };
}

const row = (to: string) => ({
  id: "1",
  topic: "email.send",
  // A real-looking address on purpose: the guard is about the event, not the domain.
  payload: { communication_id: "c-1", to, subject: "Changes needed", body: "Hi" },
});

test("a practice event's email is never handed to the sender", async () => {
  const { sent, writes, deps } = harness(true);
  await handle(row("someone@gmail.com"), deps);
  assert.equal(sent.length, 0);
  const update = writes.find((write) => write.sql.includes("UPDATE pmp.communications"));
  assert.ok(update, "the communication is settled");
  assert.deepEqual(update.params.slice(0, 2), ["c-1", "practice"]);
  assert.ok(writes.some((write) => write.sql.includes("communication_events") && write.params[1] === "practice"));
});

test("the practice check runs before the address check", async () => {
  const { sent, deps } = harness(true);
  let asked = false;
  await handle(row("a@practice.invalid"), {
    ...deps,
    refuse: async () => {
      asked = true;
      return null;
    },
  });
  assert.equal(asked, false);
  assert.equal(sent.length, 0);
});

test("a real event's email is still sent", async () => {
  const { sent, writes, deps } = harness(false);
  await handle(row("someone@gmail.com"), deps);
  assert.equal(sent.length, 1);
  assert.ok(writes.some((write) => write.sql.includes("SET status = 'sent'")));
});

/** D-138: a speaker email queued with the event's look goes out branded, with its text too. */
test("an email with a look is sent as branded HTML, from the event's sender, replying to its address", async () => {
  const { sent, deps } = harness(false);
  await handle(
    {
      id: "2",
      topic: "email.send",
      payload: {
        communication_id: "c-2",
        to: "speaker@gmail.com",
        subject: "Upload your deck",
        body: "Hi Ana,\n\nPlease upload by Friday.",
        look: {
          banner_url: "https://speakers.example.com/api/v1/email-banner/e1?v=abc",
          button: { label: "Upload your presentation", url: "https://speakers.example.com/t/tok" },
          event_name: "MedTech Forward",
          from_name: "MedTech Forward organisers",
          reply_to: "team@medtech.example.com",
        },
      },
    },
    deps,
  );
  assert.equal(sent.length, 1);
  const message = sent[0]!;
  assert.equal(message.body, "Hi Ana,\n\nPlease upload by Friday.", "the plain text goes too");
  assert.match(message.html ?? "", /email-banner\/e1/);
  assert.match(message.html ?? "", /href="https:\/\/speakers\.example\.com\/t\/tok"/);
  assert.equal(message.fromName, "MedTech Forward organisers");
  assert.equal(message.replyTo, "team@medtech.example.com");
});

test("an email without a look stays plain text", async () => {
  const { sent, deps } = harness(false);
  await handle(row("staff@gmail.com"), deps);
  assert.equal(sent[0]!.html, undefined);
  assert.equal(sent[0]!.fromName, undefined);
});
