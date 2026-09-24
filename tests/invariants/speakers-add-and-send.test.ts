import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { signInStaff } from "../helpers/signIn.ts";
import { createStaffAccount, grantRole } from "../helpers/account.ts";
import { removeTestAccounts, removeTestEvents } from "../helpers/cleanup.ts";
import { withSystemScope } from "@pmp/db";

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

/** Adds a speaker to the send probe and returns its id. Unique per run, so "once" starts fresh. */
async function newSpeaker(label: string, input: { email?: string; onTalk?: boolean } = {}): Promise<string> {
  const response = await call(admin, "POST", `/events/${sendEventId}/speakers`, {
    name: `Link Probe ${label} ${RUN}`,
    email: input.email ?? "",
    organization: "",
    ...(input.onTalk === false ? {} : { slot_id: sendSlot }),
  });
  assert.equal(response.status, 201, `fixture: speaker ${label}`);
  return ((await response.json()) as { speaker_id: string }).speaker_id;
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
  await removeTestAccounts(["probe-speakers-reviewer-"]);
  await removeTestEvents([ADD_EVENT]);
});

describe("adding a speaker (D-085)", () => {
  test("a speaker can be added with no talk yet", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await call(admin, "POST", `/events/${addEventId}/speakers`, {
      name: "Unplaced Probe",
      email: "unplaced.probe@example.invalid",
      organization: "Probe Org",
    });
    assert.equal(response.status, 201);
    const body = (await response.json()) as { speaker_id: string; created: boolean; slot_id: string | null };
    assert.equal(body.created, true);
    assert.equal(body.slot_id, null);
    const row = (await speakers(addEventId)).find((speaker) => speaker.id === body.speaker_id);
    assert.ok(row, "the speaker is in the directory");
    assert.equal(row.email, "unplaced.probe@example.invalid");
    assert.equal(row.organization, "Probe Org");
    assert.equal(row.talks, 0);
    assert.equal(row.last_email, null, "nobody has emailed them");
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

  test("the same email with no talk is refused, not silently matched", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const before = (await speakers(addEventId)).length;
    const response = await call(admin, "POST", `/events/${addEventId}/speakers`, {
      name: "Someone Else",
      email: "PLACED.probe@example.invalid",
      organization: "",
    });
    assert.equal(response.status, 409);
    assert.equal(await codeOf(response), "speakers.conflict");
    assert.equal((await speakers(addEventId)).length, before, "no second record");
  });

  test("the same name with no email and no talk is refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await call(admin, "POST", `/events/${addEventId}/speakers`, {
      name: "unplaced PROBE",
      email: "",
      organization: "",
    });
    assert.equal(response.status, 409);
    assert.equal(await codeOf(response), "speakers.conflict");
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
    assert.ok(sent[0]!.body.includes("[personal link removed]"), "the stored copy carries no sign-in link");
    assert.ok(!/\/t\/[0-9a-f-]{36}/.test(sent[0]!.body));

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

  test("a second send is refused, and nothing more is queued", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const speakerId = await newSpeaker("Twice", { email: `link.twice.${RUN}@example.invalid` });
    assert.equal((await sendLink(speakerId)).status, 201);
    const again = await sendLink(speakerId);
    assert.equal(again.status, 409);
    assert.equal(await codeOf(again), "comms.already_sent_conflict");
    // Whatever the delivery status has moved to, it still counts as sent.
    const [first] = await communicationsFor(speakerId);
    await setStatus(first!.id, "delivered");
    assert.equal((await sendLink(speakerId)).status, 409);
    assert.equal((await communicationsFor(speakerId)).length, 1);
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
    const speakerId = await newSpeaker("NoTalk", { email: `link.notalk.${RUN}@example.invalid`, onTalk: false });
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
