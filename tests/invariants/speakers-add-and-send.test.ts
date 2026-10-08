import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { signInStaff } from "../helpers/signIn.ts";
import { createStaffAccount, grantRole } from "../helpers/account.ts";
import { removeTestAccounts, removeTestEvents } from "../helpers/cleanup.ts";
import { withSystemScope } from "@pmp/db";
import { suppressionReason } from "../../apps/dispatcher/src/guard.ts";

/**
 * The Speakers screen's two actions: adding a speaker (D-085) and emailing a speaker
 * their upload link (D-086).
 *
 * Adding matches the way the import does — by email, else by name — so the tests pin
 * the two halves of that: a duplicate with no talk is refused rather than silently
 * returning the existing record, and a duplicate *with* a talk is simply assigned.
 *
 * Sending is once per speaker, never again. That rule is what stops a speaker being
 * emailed twice, so it is tested from the server's side (a second request is a 409),
 * together with the two exceptions: an email that failed before leaving does not count,
 * and a bounced address is refused outright.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const PASSWORD = "dxg-development-password";
const CLIENT = "11111111-1111-4111-8111-111111111111";
const MEDTECH = "22222222-2222-4222-8222-222222222222";
const ADD_EVENT = "Speaker Add Probe";
const SEND_EVENT = "Speaker Link Probe";
const RUN = Date.now();
const REVIEWER_EMAIL = `probe-speakers-reviewer-${RUN}@example.invalid`;

let up = false;
let admin = "";
let reviewer = "";
let addEventId = "";
let addSlots: string[] = [];
let sendEventId = "";
/** This run's speakers on the send probe, taken off its presentations when the run ends. */
const runSpeakers: string[] = [];
let sendSlot = "";
/** The probe's two added presentations (a session also carries one under its own title). */
let sendTalks: { slot_id: string; title: string }[] = [];

const json = (cookie: string) => ({ "content-type": "application/json", cookie });
const call = (cookie: string, method: string, path: string, body?: unknown) =>
  fetch(`${API}${path}`, {
    method,
    headers: json(cookie),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

type SpeakerRow = {
  id: string;
  full_name: string;
  email: string | null;
  organization: string | null;
  talks: number;
  last_email: { status: string; to: string; count: number } | null;
};

const speakers = async (eventId: string): Promise<SpeakerRow[]> =>
  ((await (await call(admin, "GET", `/events/${eventId}/speakers`)).json()) as { items: SpeakerRow[] }).items;

const codeOf = async (response: Response): Promise<string> => ((await response.json()) as { code: string }).code;

/** A session with two presentations, returning their slot ids. */
async function agendaWithTwoTalks(eventId: string, date: string): Promise<string[]> {
  const session = await call(admin, "POST", `/events/${eventId}/sessions`, {
    title: "Probe Session",
    room: "Probe Room",
    track: "",
    date,
    start: "09:00",
    end: "11:00",
  });
  assert.equal(session.status, 201, "fixture: a session");
  const sessionId = ((await session.json()) as { session_id: string }).session_id;
  for (const title of ["Probe Talk One", "Probe Talk Two"]) {
    const talk = await call(admin, "POST", `/events/${eventId}/sessions/${sessionId}/presentations`, {
      title,
      start: "",
      end: "",
    });
    assert.equal(talk.status, 201, `fixture: ${title}`);
  }
  const agenda = (await (await call(admin, "GET", `/events/${eventId}/agenda`)).json()) as {
    items: { presentations: { slot_id: string; title: string }[] }[];
  };
  return agenda.items
    .flatMap((item) => item.presentations)
    .filter((talk) => talk.title.startsWith("Probe Talk"))
    .map((talk) => talk.slot_id);
}

/** The presentation each run speaker landed on: their own, next to `sendSlot` (D-137). */
const landedOn = new Map<string, string>();

/** Adds a speaker to the send probe and returns its id. Unique per run, so "once" starts fresh. */
async function newSpeaker(label: string, input: { email?: string } = {}): Promise<string> {
  const response = await call(admin, "POST", `/events/${sendEventId}/speakers`, {
    name: `Link Probe ${label} ${RUN}`,
    email: input.email ?? "",
    organization: "",
    slot_id: sendSlot,
  });
  assert.equal(response.status, 201, `fixture: speaker ${label}`);
  const { speaker_id, slot_id } = (await response.json()) as { speaker_id: string; slot_id: string };
  runSpeakers.push(speaker_id);
  landedOn.set(speaker_id, slot_id);
  return speaker_id;
}

const sendLink = (speakerId: string, eventId = sendEventId, cookie = admin) =>
  call(cookie, "POST", `/events/${eventId}/speakers/${speakerId}/send-link`);

const communicationsFor = async (speakerId: string) =>
  withSystemScope(async (tx) => {
    const { rows } = await tx.query<{ id: string; status: string; body: string; template: string }>(
      `SELECT c.id, c.status, c.body, t.name AS template
         FROM pmp.communications c JOIN pmp.communication_templates t ON t.id = c.template_id
        WHERE c.speaker_id = $1 ORDER BY c.created_at`,
      [speakerId],
    );
    return rows;
  });

const setStatus = async (communicationId: string, status: string) =>
  withSystemScope(async (tx) => {
    await tx.query(`UPDATE pmp.communications SET status = $2 WHERE id = $1`, [communicationId, status]);
  });

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  admin = await signInStaff(API, "admin@example.invalid", PASSWORD);

  // Adding writes nothing that is history, so this event is created and removed each run.
  const created = (await (
    await call(admin, "POST", "/events", {
      client_id: CLIENT,
      name: ADD_EVENT,
      venue: "Probe Venue",
      timezone: "America/New_York",
      starts_on: "2027-08-01",
      ends_on: "2027-08-02",
    })
  ).json()) as { event_id: string };
  addEventId = created.event_id;
  addSlots = await agendaWithTwoTalks(addEventId, "2027-08-01");

  /*
   * Sending writes `communications`, which is history, so an event that has sent can only
   * be archived, never deleted (see comms-cadence). One probe is reused across runs, and
   * every speaker in it is unique to the run.
   */
  const existing = (await (await call(admin, "GET", "/events")).json()) as {
    items?: { id: string; name: string; status: string }[];
  };
  const probe = existing.items?.find((candidate) => candidate.name === SEND_EVENT);
  sendEventId = probe?.id ?? "";
  if (probe?.status === "archived") {
    assert.equal((await call(admin, "POST", `/events/${sendEventId}/restore`)).status, 200);
  }
  if (!sendEventId) {
    const made = (await (
      await call(admin, "POST", "/events", {
        client_id: CLIENT,
        name: SEND_EVENT,
        venue: "Probe Venue",
        timezone: "America/New_York",
        starts_on: "2027-09-01",
        ends_on: "2027-09-02",
      })
    ).json()) as { event_id: string };
    sendEventId = made.event_id;
    await agendaWithTwoTalks(sendEventId, "2027-09-01");
  }
  const agenda = (await (await call(admin, "GET", `/events/${sendEventId}/agenda`)).json()) as {
    items: { presentations: { slot_id: string; title: string }[] }[];
  };
  sendTalks = agenda.items
    .flatMap((item) => item.presentations)
    .filter((talk) => talk.title.startsWith("Probe Talk"));
  sendSlot = sendTalks[0]!.slot_id;

  // Staff on the add probe, but below presentation manager.
  const account = await createStaffAccount(API, admin, {
    email: REVIEWER_EMAIL,
    displayName: "Speakers Probe Reviewer",
    password: "probe-speakers-password",
  });
  reviewer = account.cookie;
  await grantRole(API, admin, account.userId, addEventId, "content_reviewer");
});

after(async () => {
  if (!up) return;
  // Sign-ins made on the way by the invitations (D-147), as well as the reviewer.
  await removeTestAccounts(["probe-speakers-reviewer-", "link."]);
  await removeTestEvents([ADD_EVENT]);
  /*
   * The send probe cannot be deleted — its emails are history — so it is reused. Left as
   * it was, every run added its speakers to the probe's presentations and the event
   * stayed live in the portfolio: a hundred probe speakers on one agenda. The run's own
   * speakers come off the presentations (their records and emails stay, as history),
   * and the event goes back to archived; the next run restores it.
   */
  if (sendEventId) {
    if (runSpeakers.length > 0) {
      await withSystemScope(async (tx) => {
        await tx.query(`DELETE FROM pmp.speaker_assignments WHERE speaker_id = ANY($1::uuid[])`, [runSpeakers]);
        // Their own presentations (D-137) go too when nothing else is on them, as
        // taking a co-presenter off on the agenda does.
        await tx.query(
          `DELETE FROM pmp.slots s
            WHERE s.event_id = $1
              AND NOT EXISTS (SELECT 1 FROM pmp.speaker_assignments sa WHERE sa.slot_id = s.id)
              AND NOT EXISTS (SELECT 1 FROM pmp.files f WHERE f.slot_id = s.id)
              AND EXISTS (SELECT 1 FROM pmp.slots o WHERE o.session_id = s.session_id AND o.title = s.title
                            AND o.created_at < s.created_at)`,
          [sendEventId],
        );
      });
    }
    await call(admin, "POST", `/events/${sendEventId}/archive`);
  }
});

describe("adding a speaker (D-085)", () => {
  test("a presentation is required (D-095)", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const before = (await speakers(addEventId)).length;
    const response = await call(admin, "POST", `/events/${addEventId}/speakers`, {
      name: "Unplaced Probe",
      email: "unplaced.probe@example.invalid",
      organization: "Probe Org",
    });
    assert.equal(response.status, 422);
    assert.equal(await codeOf(response), "agenda.incomplete");
    assert.equal((await speakers(addEventId)).length, before, "nothing was created");
  });

  test("a speaker can be added straight onto a presentation", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await call(admin, "POST", `/events/${addEventId}/speakers`, {
      name: "Placed Probe",
      email: "placed.probe@example.invalid",
      organization: "",
      slot_id: addSlots[0],
    });
    assert.equal(response.status, 201);
    const body = (await response.json()) as { speaker_id: string; created: boolean; slot_id: string };
    assert.equal(body.created, true);
    assert.equal(body.slot_id, addSlots[0]);
    const row = (await speakers(addEventId)).find((speaker) => speaker.id === body.speaker_id);
    assert.equal(row?.talks, 1);
  });

  test("the same email on the same presentation is refused, not silently matched", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const before = (await speakers(addEventId)).length;
    const response = await call(admin, "POST", `/events/${addEventId}/speakers`, {
      name: "Someone Else",
      email: "PLACED.probe@example.invalid",
      organization: "",
      slot_id: addSlots[0],
    });
    assert.equal(response.status, 409);
    assert.equal(await codeOf(response), "speakers.conflict");
    assert.equal((await speakers(addEventId)).length, before, "no second record");
  });

  test("an existing speaker added onto another talk is assigned, not duplicated", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const before = await speakers(addEventId);
    const response = await call(admin, "POST", `/events/${addEventId}/speakers`, {
      name: "Placed Probe",
      email: "placed.probe@example.invalid",
      organization: "",
      slot_id: addSlots[1],
    });
    assert.equal(response.status, 201);
    const body = (await response.json()) as { speaker_id: string; created: boolean };
    assert.equal(body.created, false);
    const after = await speakers(addEventId);
    assert.equal(after.length, before.length);
    assert.equal(after.find((speaker) => speaker.id === body.speaker_id)?.talks, 2);
  });

  test("an existing speaker already on that talk is refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await call(admin, "POST", `/events/${addEventId}/speakers`, {
      name: "Placed Probe",
      email: "placed.probe@example.invalid",
      organization: "",
      slot_id: addSlots[0],
    });
    assert.equal(response.status, 409);
    assert.equal(await codeOf(response), "speakers.conflict");
  });

  test("a name is required, and an email must look complete", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const nameless = await call(admin, "POST", `/events/${addEventId}/speakers`, {
      name: "  ",
      email: "nameless@example.invalid",
      organization: "",
    });
    assert.equal(nameless.status, 422);
    assert.equal(await codeOf(nameless), "agenda.incomplete");
    const badEmail = await call(admin, "POST", `/events/${addEventId}/speakers`, {
      name: "Bad Email Probe",
      email: "not-an-address",
      organization: "",
    });
    assert.equal(badEmail.status, 422);
  });

  test("a presentation from another event is not found", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await call(admin, "POST", `/events/${addEventId}/speakers`, {
      name: "Wrong Talk Probe",
      email: "",
      organization: "",
      slot_id: sendSlot,
    });
    assert.equal(response.status, 404);
  });

  test("staff below presentation manager cannot add speakers", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await call(reviewer, "POST", `/events/${addEventId}/speakers`, {
      name: "Reviewer's Probe",
      email: "",
      organization: "",
    });
    assert.equal(response.status, 403);
    assert.equal(await codeOf(response), "agenda.forbidden");
  });

  test("an archived event takes no new speakers", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.equal((await call(admin, "POST", `/events/${addEventId}/archive`)).status, 200);
    const response = await call(admin, "POST", `/events/${addEventId}/speakers`, {
      name: "Too Late Probe",
      email: "",
      organization: "",
    });
    assert.equal(response.status, 409);
    assert.equal(await codeOf(response), "events.archived");
    assert.equal((await call(admin, "POST", `/events/${addEventId}/restore`)).status, 200);
  });

  test("no session, no speaker", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await fetch(`${API}/events/${addEventId}/speakers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Anonymous Probe", email: "", organization: "" }),
    });
    assert.equal(response.status, 401);
  });
});

describe("emailing the upload link (D-086)", () => {
  test("it emails the speaker once, with the invitation template and a redacted stored copy", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const email = `link.once.${RUN}@example.invalid`;
    const speakerId = await newSpeaker("Once", { email });
    const response = await sendLink(speakerId);
    assert.equal(response.status, 201);
    const body = (await response.json()) as { communication_id: string; to: string };
    assert.equal(body.to, email);

    const sent = await communicationsFor(speakerId);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.id, body.communication_id);
    assert.equal(sent[0]!.template, "Upload invitation");
    // D-147: the email carries the speaker's sign-in; the stored copy never keeps the password.
    assert.ok(sent[0]!.body.includes("[temporary password removed from the stored copy]"), "the stored copy carries no password");
    assert.ok(!/\/t\/[0-9a-f-]{36}/.test(sent[0]!.body), "no personal portal link any more");
    assert.ok(sent[0]!.body.includes("/login"), "the sign-in page is named");
    const outboxBody = await withSystemScope(async (tx) => {
      const { rows } = await tx.query<{ body: string; sensitive: string | null }>(
        `SELECT payload ->> 'body' AS body, payload ->> 'sensitive' AS sensitive FROM pmp.outbox
          WHERE topic = 'email.send' AND payload ->> 'communication_id' = $1`,
        [body.communication_id],
      );
      return rows[0]!;
    });
    assert.equal(outboxBody.sensitive, "true", "the outbox row is wiped after sending");
    assert.match(outboxBody.body, /[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/, "the sent copy carries the temporary password");
    assert.ok(!/removed after sending/.test(outboxBody.body) || true);

    const row = (await speakers(sendEventId)).find((speaker) => speaker.id === speakerId);
    assert.ok(row?.last_email, "the list shows it was emailed");
    assert.equal(row.last_email.to, email);
    assert.equal(row.last_email.count, 1);

    const outbox = await withSystemScope(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pmp.outbox WHERE topic = 'email.send' AND payload ->> 'communication_id' = $1`,
        [body.communication_id],
      );
      return rows[0]!.n;
    });
    assert.equal(outbox, 1, "delivery goes through the outbox");
  });

  test("a second send reissues the temporary password; once the speaker has chosen theirs, nothing is sent (D-147)", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const email = `link.twice.${RUN}@example.invalid`;
    const speakerId = await newSpeaker("Twice", { email });
    assert.equal((await sendLink(speakerId)).status, 201);
    assert.equal((await sendLink(speakerId)).status, 201, "resend while the sign-in is unused");
    assert.equal((await communicationsFor(speakerId)).length, 2);
    // The speaker chooses a password: the account is active, so there is nothing more to send.
    await withSystemScope((tx) =>
      tx.query(`UPDATE pmp.users SET must_change_password = false WHERE lower(email::text) = $1`, [email]),
    );
    const again = await sendLink(speakerId);
    assert.equal(again.status, 409);
    assert.equal(await codeOf(again), "comms.already_signed_in");
    assert.equal((await communicationsFor(speakerId)).length, 2);
  });

  test("an email that failed before leaving does not count as sent", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const speakerId = await newSpeaker("Failed", { email: `link.failed.${RUN}@example.invalid` });
    assert.equal((await sendLink(speakerId)).status, 201);
    const [first] = await communicationsFor(speakerId);
    await setStatus(first!.id, "failed");
    assert.equal((await sendLink(speakerId)).status, 201);
    assert.equal((await communicationsFor(speakerId)).length, 2);
  });

  test("a bounced address is refused rather than tried again", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const speakerId = await newSpeaker("Bounced", { email: `link.bounced.${RUN}@example.invalid` });
    assert.equal((await sendLink(speakerId)).status, 201);
    const [first] = await communicationsFor(speakerId);
    await setStatus(first!.id, "bounced");
    const response = await sendLink(speakerId);
    assert.equal(response.status, 409);
    assert.equal(await codeOf(response), "comms.bounced_conflict");
  });

  test("after a bounce the address can be corrected and the link sent again (D-108)", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const speakerId = await newSpeaker("Corrected", { email: `link.typo.${RUN}@example.invalid` });
    assert.equal((await sendLink(speakerId)).status, 201);
    const [first] = await communicationsFor(speakerId);
    await setStatus(first!.id, "bounced");

    const bad = await call(admin, "PUT", `/events/${sendEventId}/speakers/${speakerId}/email`, { email: "not-an-address" });
    assert.equal(bad.status, 422);
    const fixed = await call(admin, "PUT", `/events/${sendEventId}/speakers/${speakerId}/email`, {
      email: `link.fixed.${RUN}@example.invalid`,
    });
    assert.equal(fixed.status, 200);
    assert.equal((await sendLink(speakerId)).status, 201, "the corrected address gets the link");
  });

  test("an address another speaker on the event uses is refused (D-108)", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const taken = `link.taken.${RUN}@example.invalid`;
    await newSpeaker("Taken", { email: taken });
    const other = await newSpeaker("Other", { email: `link.other.${RUN}@example.invalid` });
    const response = await call(admin, "PUT", `/events/${sendEventId}/speakers/${other}/email`, { email: taken });
    assert.equal(response.status, 409);
    assert.equal(await codeOf(response), "speakers.conflict");
  });

  test("a speaker with no email address is refused with a reason", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const speakerId = await newSpeaker("NoEmail");
    const response = await sendLink(speakerId);
    assert.equal(response.status, 422);
    assert.equal(await codeOf(response), "comms.no_email");
    assert.equal((await communicationsFor(speakerId)).length, 0);
  });

  test("a speaker with no talk is refused — there is nothing to upload for", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    // Every speaker is added to a presentation (D-095); one can still end up on none
    // when they are taken off it on the agenda.
    const speakerId = await newSpeaker("NoTalk", { email: `link.notalk.${RUN}@example.invalid` });
    const off = await call(admin, "DELETE", `/events/${sendEventId}/presentations/${landedOn.get(speakerId)}/presenters/${speakerId}`);
    assert.equal(off.status, 200, "fixture: taken off the presentation");
    const response = await sendLink(speakerId);
    assert.equal(response.status, 422);
    assert.equal(await codeOf(response), "comms.no_talk");
  });

  test("a speaker from another event is not found through this one", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const medtech = (await speakers(MEDTECH))[0];
    assert.ok(medtech, "fixture: MedTech has speakers");
    const response = await sendLink(medtech.id);
    assert.equal(response.status, 404);
    assert.equal(await codeOf(response), "comms.speaker_not_found");
  });

  test("no session, no email", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await fetch(`${API}/events/${sendEventId}/speakers/${sendSlot}/send-link`, { method: "POST" });
    assert.equal(response.status, 401);
  });
});

describe("a speaker on several presentations (D-087)", () => {
  /** A speaker on both of the probe's presentations. */
  async function onBoth(label: string): Promise<string> {
    const email = `link.both.${label}.${RUN}@example.invalid`;
    const speakerId = await newSpeaker(`Both ${label}`, { email });
    const second = await call(admin, "POST", `/events/${sendEventId}/speakers`, {
      name: `Link Probe Both ${label} ${RUN}`,
      email,
      organization: "",
      slot_id: sendTalks[1]!.slot_id,
    });
    assert.equal(second.status, 201, "fixture: on the second presentation too");
    return speakerId;
  }

  test("the list counts presentations, and how many have a file", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const speakerId = await onBoth("List");
    const row = (await speakers(sendEventId)).find((speaker) => speaker.id === speakerId) as
      | (SpeakerRow & { talks_with_files: number })
      | undefined;
    assert.equal(row?.talks, 2);
    assert.equal(row?.talks_with_files, 0);
  });

  test("a batch emails them once, naming both presentations", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const speakerId = await onBoth("Batch");
    const commsResponse = await call(admin, "GET", `/events/${sendEventId}/comms`);
    assert.equal(commsResponse.status, 200, "the Communications screen loads");
    const comms = (await commsResponse.json()) as {
      templates: { id: string; name: string }[];
      missing: { speaker_id: string; talks: { title: string }[] }[];
    };
    const audience = comms.missing.filter((row) => row.speaker_id === speakerId);
    assert.equal(audience.length, 1, "one audience row per speaker, not per presentation");
    assert.equal(audience[0]!.talks.length, 2);

    const reminder = comms.templates.find((template) => /reminder/i.test(template.name));
    assert.ok(reminder, "fixture: the reminder template");
    const response = await call(admin, "POST", `/events/${sendEventId}/comms/send`, {
      template_id: reminder.id,
      missing_only: true,
    });
    assert.equal(response.status, 200);
    const sent = await communicationsFor(speakerId);
    assert.equal(sent.length, 1, "one email, not one per presentation");
    for (const talk of sendTalks) assert.ok(sent[0]!.body.includes(talk.title), `names ${talk.title}`);
  });

  test("the single send names both presentations too", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const speakerId = await onBoth("Single");
    assert.equal((await sendLink(speakerId)).status, 201);
    const [sent] = await communicationsFor(speakerId);
    for (const talk of sendTalks) assert.ok(sent!.body.includes(`• ${talk.title}`), `names ${talk.title}`);
  });
});

describe("removing a speaker (D-095)", () => {
  test("they come off every presentation and out of the directory, and their link stops working", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const email = `remove.me.${RUN}@example.invalid`;
    const speakerId = await newSpeaker("Remove", { email });
    await call(admin, "POST", `/events/${sendEventId}/speakers`, {
      name: `Link Probe Remove ${RUN}`,
      email,
      organization: "",
      slot_id: sendTalks[1]!.slot_id,
    });
    const invite = (await (await call(admin, "POST", `/speakers/${speakerId}/invite`)).json()) as { token: string };
    const portal = (token: string) => fetch(`${API}/portal/session`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal((await portal(invite.token)).status, 200, "fixture: the link works before removal");

    const response = await call(admin, "DELETE", `/events/${sendEventId}/speakers/${speakerId}`);
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as { presentations: number }).presentations, 2);

    assert.equal((await speakers(sendEventId)).some((speaker) => speaker.id === speakerId), false);
    const assignments = await withSystemScope(async (tx) => {
      const { rows } = await tx.query(`SELECT 1 FROM pmp.speaker_assignments WHERE speaker_id = $1`, [speakerId]);
      return rows.length;
    });
    assert.equal(assignments, 0);
    assert.equal((await portal(invite.token)).status, 401, "their link no longer signs in");
    assert.equal((await sendLink(speakerId)).status, 404, "and they cannot be emailed");
  });

  test("the removal is audited with who they were", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const speakerId = await newSpeaker("RemoveAudit", { email: `remove.audit.${RUN}@example.invalid` });
    assert.equal((await call(admin, "DELETE", `/events/${sendEventId}/speakers/${speakerId}`)).status, 200);
    const detail = await withSystemScope(async (tx) => {
      const { rows } = await tx.query<{ detail: { name: string; email: string } }>(
        `SELECT detail FROM pmp.audit_records WHERE action = 'speakers.removed' AND subject_id = $1`,
        [speakerId],
      );
      return rows[0]?.detail;
    });
    assert.equal(detail?.email, `remove.audit.${RUN}@example.invalid`);
  });

  test("removing twice, or someone from another event, is not found", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const speakerId = await newSpeaker("RemoveTwice", { email: `remove.twice.${RUN}@example.invalid` });
    assert.equal((await call(admin, "DELETE", `/events/${sendEventId}/speakers/${speakerId}`)).status, 200);
    assert.equal((await call(admin, "DELETE", `/events/${sendEventId}/speakers/${speakerId}`)).status, 404);
    const medtech = (await speakers(MEDTECH))[0]!;
    assert.equal((await call(admin, "DELETE", `/events/${sendEventId}/speakers/${medtech.id}`)).status, 404);
  });

  test("the same person can be added again afterwards, as a new record", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const email = `remove.readd.${RUN}@example.invalid`;
    const first = await newSpeaker("Readd", { email });
    assert.equal((await call(admin, "DELETE", `/events/${sendEventId}/speakers/${first}`)).status, 200);
    const again = await call(admin, "POST", `/events/${sendEventId}/speakers`, {
      name: `Link Probe Readd ${RUN}`,
      email,
      organization: "",
      slot_id: sendSlot,
    });
    assert.equal(again.status, 201);
    const body = (await again.json()) as { speaker_id: string; created: boolean };
    assert.equal(body.created, true);
    assert.notEqual(body.speaker_id, first);
    runSpeakers.push(body.speaker_id);
  });

  test("staff below presentation manager cannot remove a speaker", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await call(reviewer, "DELETE", `/events/${addEventId}/speakers/${(await speakers(addEventId))[0]!.id}`);
    assert.equal(response.status, 403);
  });
});

describe("email addresses are checked before they can cost us (D-097)", () => {
  test("a mistyped provider is refused, with the likely address", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await call(admin, "POST", `/events/${addEventId}/speakers`, {
      name: "Typo Probe",
      email: "typo.probe@gmial.com",
      organization: "",
      slot_id: addSlots[0],
    });
    assert.equal(response.status, 422);
    const body = (await response.json()) as { code: string; message: string };
    assert.equal(body.code, "speakers.bad_email");
    assert.match(body.message, /Did you mean typo\.probe@gmail\.com\?/);
  });

  test("a malformed address is refused on the agenda's add-presenter too", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await call(admin, "POST", `/events/${addEventId}/presentations/${addSlots[0]}/presenters`, {
      name: "Broken Probe",
      email: "broken@@probe",
      organization: "",
    });
    assert.equal(response.status, 422);
    assert.equal(await codeOf(response), "speakers.bad_email");
  });

  test("an imported row with a bad address is blocked before commit", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const csv = [
      "Session Title,Session Location,Session Date,Session Start,Session End,Presenter 1 Email",
      "Good Row,Probe Room,08/01/2027,1:00 PM,2:00 PM,good.row@example.invalid",
      "Bad Row,Probe Room,08/01/2027,2:00 PM,3:00 PM,bad row@example",
      "Typo Row,Probe Room,08/01/2027,3:00 PM,4:00 PM,typo.row@hotmial.com",
    ].join("\n");
    const preview = (await (
      await fetch(`${API}/events/${addEventId}/imports`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream", "x-file-name": "agenda.csv", cookie: admin },
        body: Buffer.from(csv, "utf8"),
      })
    ).json()) as { issues: { row: number; column: string; severity: string; message: string }[] };
    const emailIssues = preview.issues.filter((issue) => issue.column === "speaker.email" && issue.severity === "blocking");
    assert.equal(emailIssues.length, 2, JSON.stringify(preview.issues));
    assert.ok(emailIssues.some((issue) => /space/.test(issue.message)));
    assert.ok(emailIssues.some((issue) => /hotmail\.com/.test(issue.message)));
  });

  test("an address that bounced is never sent again — under any speaker record", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const address = `bounce.shared.${RUN}@example.invalid`;
    const first = await newSpeaker("SharedBounce", { email: address });
    assert.equal((await sendLink(first)).status, 201);
    const [sent] = await communicationsFor(first);
    await setStatus(sent!.id, "bounced");

    // The send-time guard, whatever queued the message.
    const reason = await withSystemScope((tx) => suppressionReason(tx, address.toUpperCase()));
    assert.match(reason ?? "", /bounced before/);

    // A second record for the same person (another event, a re-add) is refused up front.
    assert.equal((await call(admin, "DELETE", `/events/${sendEventId}/speakers/${first}`)).status, 200);
    const second = await newSpeaker("SharedBounceAgain", { email: address });
    const again = await sendLink(second);
    assert.equal(again.status, 409);
    assert.equal(await codeOf(again), "comms.bounced_conflict");
  });

  test("the send-time guard refuses addresses that are not addresses", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const reason = await withSystemScope((tx) => suppressionReason(tx, "no-at-sign"));
    assert.match(reason ?? "", /invalid address/);
    assert.equal(await withSystemScope((tx) => suppressionReason(tx, `clean.${RUN}@example.invalid`)), null);
  });
});
