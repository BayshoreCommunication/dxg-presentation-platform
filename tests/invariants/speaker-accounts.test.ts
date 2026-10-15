import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { signInStaff, cookieFrom } from "../helpers/signIn.ts";
import { removeTestAccounts } from "../helpers/cleanup.ts";
import { withSystemScope } from "@pmp/db";

/**
 * Speaker accounts (D-146): a persistent sign-in on the staff site that reaches only the
 * speaker's own presentations, on every event carrying their email — and nothing of the
 * staff's. The seeded speaker `p.raman@example.invalid` has one; the others do not.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const EVENT = "22222222-2222-4222-8222-222222222222";
const PASSWORD = "dxg-development-password";
const SPEAKER = "p.raman@example.invalid";

let up = false;
let admin = "";
let reviewer = "";
let support = "";
let speaker = "";

const json = async (response: Response) => (await response.json()) as Record<string, unknown>;
const headers = (cookie: string) => ({ "content-type": "application/json", cookie });

type Talk = { slot_id: string; title: string; versions: { id: string; downloadable: boolean }[] };
type Mine = { speaker: { email: string }; events: { id: string; talks: Talk[] }[] };

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  admin = await signInStaff(API, "admin@example.invalid", PASSWORD);
  reviewer = await signInStaff(API, "c.delgado@example.invalid", PASSWORD);
  // Asking a speaker for changes is support staff's and admins' (D-163): m.vega is support staff.
  support = await signInStaff(API, "m.vega@example.invalid", PASSWORD);
  const signedIn = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: SPEAKER, password: PASSWORD }),
  });
  speaker = cookieFrom(signedIn);
  // Osei starts without a sign-in whatever an earlier run, or a hand test, left behind.
  await removeTestAccounts(["k.osei@example.invalid"]);
});

after(async () => {
  if (up) await removeTestAccounts(["k.osei@example.invalid"]);
});

describe("a speaker signs in without a second factor and lands on their own presentations", () => {
  test("the password alone opens a session on the speaker site, under its own cookie (D-148)", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.match(speaker, /pmp_speaker=/, "a speaker's cookie, never the staff one");
    assert.doesNotMatch(speaker, /pmp_session=/);
    const session = (await json(await fetch(`${API}/me/session`, { headers: { cookie: speaker } }))) as {
      principal: { account_kind: string; roles: string[]; mfa_enrolled: boolean };
    };
    assert.equal(session.principal.account_kind, "speaker");
    assert.deepEqual(session.principal.roles, []);
    assert.equal(session.principal.mfa_enrolled, false);
    // The staff site's "who am I" does not know the speaker: the cookie is not its own.
    assert.equal((await fetch(`${API}/auth/session`, { headers: { cookie: speaker } })).status, 401);
  });

  test("their presentations are only their own, on every event carrying their address", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const mine = (await json(await fetch(`${API}/me/presentations`, { headers: { cookie: speaker } }))) as Mine;
    assert.equal(mine.speaker.email, SPEAKER);
    assert.equal(mine.events.length, 1);
    assert.equal(mine.events[0]!.id, EVENT);
    assert.equal(mine.events[0]!.talks.length, 1, "Raman speaks on one seeded talk");
  });
});

describe("a speaker's own views of the event (portfolio, agenda, Speaker Ready Room)", () => {
  test("their events, the programme with only their own status, and the ready room — never another event", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const events = (await json(await fetch(`${API}/me/events`, { headers: { cookie: speaker } }))) as { items: { id: string }[] };
    assert.equal(events.items.length, 1);
    assert.equal(events.items[0]!.id, EVENT);

    const agenda = (await json(await fetch(`${API}/me/events/${EVENT}/agenda`, { headers: { cookie: speaker } }))) as {
      items: { presentations: { mine: boolean; status: string | null; speakers: { name: string }[] }[] }[];
    };
    const presentations = agenda.items.flatMap((session) => session.presentations);
    assert.ok(presentations.length >= 3, "the whole programme");
    assert.equal(presentations.filter((row) => row.mine).length, 1, "one talk is Raman's");
    assert.ok(presentations.every((row) => row.mine || row.status === null), "no status of anyone else's talk");
    assert.ok(presentations.every((row) => row.speakers.every((who) => !("id" in who))), "names only, no ids");

    const srr = (await json(await fetch(`${API}/me/events/${EVENT}/srr`, { headers: { cookie: speaker } }))) as {
      stations: { name: string; busy: boolean }[];
      checkins: unknown[];
      sign_offs: unknown[];
      talks: unknown[];
    };
    assert.ok(Array.isArray(srr.stations) && Array.isArray(srr.checkins) && Array.isArray(srr.sign_offs));
    assert.equal(srr.talks.length, 1);

    const other = "33333333-3333-4333-8333-333333333333";
    assert.equal((await fetch(`${API}/me/events/${other}/agenda`, { headers: { cookie: speaker } })).status, 404);
    assert.equal((await fetch(`${API}/me/events/${other}/srr`, { headers: { cookie: speaker } })).status, 404);
  });
});

describe("what the team decides reaches the speaker inside the site (2026-10-11)", () => {
  test("a revision request becomes an unread notice; opening the bell marks it read", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const before = (await json(await fetch(`${API}/me/notifications`, { headers: { cookie: speaker } }))) as { items: unknown[]; unread: number };
    const mine = (await json(await fetch(`${API}/me/presentations`, { headers: { cookie: speaker } }))) as Mine;
    const talk = mine.events[0]!.talks[0]!;

    // A version of the speaker's own that is genuinely awaiting review: uploaded here, so the
    // test does not depend on what the seed or an earlier suite left on the talk.
    const body = await readFile("tests/fixtures/g0-1/aspect-16x9.pptx");
    const sha256 = createHash("sha256").update(body).digest("hex");
    const begun = (await json(
      await fetch(`${API}/me/uploads`, {
        method: "POST",
        headers: headers(speaker),
        body: JSON.stringify({ slot_id: talk.slot_id, file_name: "needs-changes.pptx", total_bytes: body.length }),
      }),
    )) as { upload_id: string };
    await fetch(`${API}/me/uploads/${begun.upload_id}/parts/1`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream", cookie: speaker },
      body,
    });
    const uploaded = (await json(
      await fetch(`${API}/me/uploads/${begun.upload_id}/complete`, {
        method: "POST",
        headers: headers(speaker),
        body: JSON.stringify({ slot_id: talk.slot_id, file_name: "needs-changes.pptx", sha256 }),
      }),
    )) as { file_version_id: string; processing_state: string };
    assert.equal(uploaded.processing_state, "stored", "fixture: the upload is stored and awaiting review");

    const asked = await fetch(`${API}/file-versions/${uploaded.file_version_id}/request-revision`, {
      method: "POST",
      headers: headers(support),
      body: JSON.stringify({ note: "Please use the 16:9 template and embed the video." }),
    });
    assert.equal(asked.status, 200, `request-revision ${asked.status} ${await asked.text()}`);

    const after = (await json(await fetch(`${API}/me/notifications`, { headers: { cookie: speaker } }))) as {
      items: { kind: string; title: string; body: string; talk: string | null; read_at: string | null }[];
      unread: number;
    };
    assert.equal(after.unread, before.unread + 1);
    const notice = after.items[0]!;
    assert.equal(notice.kind, "changes_requested");
    assert.match(notice.title, /Changes needed/);
    assert.equal(notice.body, "Please use the 16:9 template and embed the video.");
    assert.equal(notice.talk, talk.title);
    assert.equal(notice.read_at, null);

    const marked = (await json(
      await fetch(`${API}/me/notifications/read`, { method: "POST", headers: headers(speaker), body: JSON.stringify({ all: true }) }),
    )) as { marked: number };
    assert.ok(marked.marked >= 1);
    const read = (await json(await fetch(`${API}/me/notifications`, { headers: { cookie: speaker } }))) as { unread: number };
    assert.equal(read.unread, 0);

    // Staff never read a speaker's bell.
    assert.equal((await fetch(`${API}/me/notifications`, { headers: { cookie: admin } })).status, 401);
  });
});

describe("a speaker account is refused everything that is the staff's", () => {
  // Event-scoped paths are refused by the event resolver (no role on the event) and the
  // rest by the staff gate; either way a speaker is told no, never asked for a second factor.
  // The speaker's cookie is not read on staff paths at all (D-148): no session, 401.
  for (const path of ["/events", `/events/${EVENT}/speakers`, `/events/${EVENT}/review-queue`, "/admin/users"]) {
    test(`${path} is refused`, async (t: TestContext) => {
      if (!up) return t.skip("API not running");
      const response = await fetch(`${API}${path}`, { headers: { cookie: speaker } });
      assert.ok([401, 403].includes(response.status), String(response.status));
    });
  }

  test("and staff are refused the speaker's own routes", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await fetch(`${API}/me/presentations`, { headers: { cookie: admin } });
    assert.equal(response.status, 401, "a staff cookie is not a speaker session");
  });

  test("a temporary password opens only the page that replaces it", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    await withSystemScope((tx) =>
      tx.query(`UPDATE pmp.users SET must_change_password = true WHERE lower(email::text) = $1`, [SPEAKER]),
    );
    try {
      assert.equal((await fetch(`${API}/me/presentations`, { headers: { cookie: speaker } })).status, 403);
      assert.equal((await fetch(`${API}/me/session`, { headers: { cookie: speaker } })).status, 200);
    } finally {
      await withSystemScope((tx) =>
        tx.query(`UPDATE pmp.users SET must_change_password = false WHERE lower(email::text) = $1`, [SPEAKER]),
      );
    }
  });
});

describe("uploads and downloads stay within the speaker's own talks", () => {
  const fixture = "tests/fixtures/g0-1/aspect-16x9.pptx";

  test("an upload to another speaker's talk is refused as not theirs", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const rows = (await json(await fetch(`${API}/events/${EVENT}/speakers`, { headers: { cookie: admin } }))) as {
      items: { id: string; email: string }[];
    };
    const osei = rows.items.find((row) => row.email === "k.osei@example.invalid")!;
    const agenda = (await json(await fetch(`${API}/events/${EVENT}/agenda`, { headers: { cookie: admin } }))) as {
      items: { presentations: { slot_id: string; speakers: { id: string }[] }[] }[];
    };
    const theirs = agenda.items
      .flatMap((session) => session.presentations)
      .find((presentation) => presentation.speakers.some((who) => who.id === osei.id))!;
    const response = await fetch(`${API}/me/uploads`, {
      method: "POST",
      headers: headers(speaker),
      body: JSON.stringify({ slot_id: theirs.slot_id, file_name: "x.pptx", total_bytes: 10 }),
    });
    assert.equal(response.status, 422);
    assert.equal(((await json(response)) as { code: string }).code, "portal.not_your_talk");
  });

  test("their own talk takes a resumable upload, byte for byte, and only the approved version downloads", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const before = (await json(await fetch(`${API}/me/presentations`, { headers: { cookie: speaker } }))) as Mine;
    const talk = before.events[0]!.talks[0]!;
    const body = await readFile(fixture);
    const sha256 = createHash("sha256").update(body).digest("hex");

    const begun = (await json(
      await fetch(`${API}/me/uploads`, {
        method: "POST",
        headers: headers(speaker),
        body: JSON.stringify({ slot_id: talk.slot_id, file_name: "aspect-16x9.pptx", total_bytes: body.length }),
      }),
    )) as { upload_id: string };
    assert.ok(begun.upload_id);

    const part = await fetch(`${API}/me/uploads/${begun.upload_id}/parts/1`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream", cookie: speaker },
      body,
    });
    assert.equal(part.status, 200);
    const state = (await json(await fetch(`${API}/me/uploads/${begun.upload_id}`, { headers: { cookie: speaker } }))) as {
      received: number[];
    };
    assert.deepEqual(state.received, [1], "resume asks the server what already landed");

    // Another talk named at the finish is refused: the upload belongs to the talk it began for.
    const finished = (await json(
      await fetch(`${API}/me/uploads/${begun.upload_id}/complete`, {
        method: "POST",
        headers: headers(speaker),
        body: JSON.stringify({ slot_id: talk.slot_id, file_name: "aspect-16x9.pptx", sha256 }),
      }),
    )) as { file_version_id: string; sha256: string; processing_state: string };
    assert.equal(finished.sha256, sha256);
    assert.equal(finished.processing_state, "stored");

    const after = (await json(await fetch(`${API}/me/presentations`, { headers: { cookie: speaker } }))) as Mine;
    const versions = after.events[0]!.talks[0]!.versions;
    const pending = versions.find((version) => version.id === finished.file_version_id)!;
    assert.equal(pending.downloadable, false, "a version still in review is not the speaker's to take");
    const refused = await fetch(`${API}/me/file-versions/${pending.id}/download`, { headers: { cookie: speaker } });
    assert.equal(refused.status, 403);

    const approved = versions.find((version) => version.downloadable);
    if (approved) {
      const download = await fetch(`${API}/me/file-versions/${approved.id}/download`, { headers: { cookie: speaker } });
      assert.equal(download.status, 200);
      assert.ok((await download.arrayBuffer()).byteLength > 0);
    }

    // Someone else's version — a reviewer can see every version; the speaker cannot fetch one that is not theirs.
    const queue = (await json(await fetch(`${API}/events/${EVENT}/review-queue`, { headers: { cookie: support } }))) as {
      items: { file_version_id: string; slot_id: string }[];
    };
    const other = queue.items.find((item) => item.slot_id !== talk.slot_id);
    if (other) {
      const notMine = await fetch(`${API}/me/file-versions/${other.file_version_id}/download`, { headers: { cookie: speaker } });
      assert.equal(notMine.status, 404);
    }
  });
});

describe("a staff member's address never becomes a speaker's sign-in", () => {
  test("Add speaker refuses the staff address before creating anything", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const agenda = (await json(await fetch(`${API}/events/${EVENT}/agenda`, { headers: { cookie: admin } }))) as {
      items: { presentations: { slot_id: string }[] }[];
    };
    const slot = agenda.items.flatMap((session) => session.presentations)[0]!.slot_id;
    const before = (await json(await fetch(`${API}/events/${EVENT}/speakers`, { headers: { cookie: admin } }))) as {
      items: { id: string }[];
    };
    const response = await fetch(`${API}/events/${EVENT}/speakers`, {
      method: "POST",
      headers: headers(admin),
      body: JSON.stringify({ name: "Probe Staffmail", email: "m.vega@example.invalid", organization: "", slot_id: slot }),
    });
    assert.equal(response.status, 409);
    assert.equal(((await json(response)) as { code: string }).code, "speakers.staff_address_conflict");
    const after = (await json(await fetch(`${API}/events/${EVENT}/speakers`, { headers: { cookie: admin } }))) as {
      items: { id: string }[];
    };
    assert.equal(after.items.length, before.items.length, "no speaker was created");
  });

  test("the send-time guards still protect an older invalid speaker record", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const speakerId = await withSystemScope(async (tx) => {
      const { rows: slots } = await tx.query<{ id: string; client_id: string }>(
        `SELECT id, client_id FROM pmp.slots WHERE event_id = $1 ORDER BY created_at LIMIT 1`,
        [EVENT],
      );
      const slot = slots[0]!;
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO pmp.speakers (client_id, event_id, email, full_name)
         VALUES ($1,$2,'m.vega@example.invalid','Legacy Staffmail Probe') RETURNING id`,
        [slot.client_id, EVENT],
      );
      await tx.query(
        `INSERT INTO pmp.speaker_assignments (speaker_id, slot_id, event_id, client_id) VALUES ($1,$2,$3,$4)`,
        [rows[0]!.id, slot.id, EVENT, slot.client_id],
      );
      return rows[0]!.id;
    });
    try {
      const refused = await fetch(`${API}/events/${EVENT}/speakers/${speakerId}/send-link`, { method: "POST", headers: headers(admin) });
      assert.equal(refused.status, 409);
      assert.equal(((await json(refused)) as { code: string }).code, "comms.staff_address");
      const account = await fetch(`${API}/events/${EVENT}/speakers/${speakerId}/account`, { method: "POST", headers: headers(admin) });
      assert.equal(account.status, 409);
    } finally {
      await withSystemScope(async (tx) => {
        await tx.query(`DELETE FROM pmp.speaker_assignments WHERE speaker_id = $1`, [speakerId]);
        await tx.query(`DELETE FROM pmp.speakers WHERE id = $1`, [speakerId]);
      });
    }
  });
});

describe("staff give a speaker a sign-in from the Speakers screen", () => {
  test("a content reviewer cannot; a root admin can, and the account is emailed a temporary password", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const rows = (await json(await fetch(`${API}/events/${EVENT}/speakers`, { headers: { cookie: admin } }))) as {
      items: { id: string; email: string; account: string | null }[];
    };
    const osei = rows.items.find((row) => row.email === "k.osei@example.invalid")!;
    assert.equal(osei.account, null, "no sign-in yet");

    const refused = await fetch(`${API}/events/${EVENT}/speakers/${osei.id}/account`, { method: "POST", headers: headers(reviewer) });
    assert.equal(refused.status, 403);

    const created = await fetch(`${API}/events/${EVENT}/speakers/${osei.id}/account`, { method: "POST", headers: headers(admin) });
    assert.equal(created.status, 201);
    assert.equal(((await json(created)) as { outcome: string }).outcome, "created");

    const again = await fetch(`${API}/events/${EVENT}/speakers/${osei.id}/account`, { method: "POST", headers: headers(admin) });
    assert.equal(again.status, 201, "a second press reissues the unused temporary password (D-147)");
    assert.equal(((await json(again)) as { outcome: string }).outcome, "reissued");

    // Once the speaker has chosen a password there is nothing to issue.
    await withSystemScope((tx) =>
      tx.query(`UPDATE pmp.users SET must_change_password = false WHERE lower(email::text) = 'k.osei@example.invalid'`),
    );
    const settled = await fetch(`${API}/events/${EVENT}/speakers/${osei.id}/account`, { method: "POST", headers: headers(admin) });
    assert.equal(settled.status, 200);
    assert.equal(((await json(settled)) as { outcome: string }).outcome, "existing");

    const listed = (await json(await fetch(`${API}/events/${EVENT}/speakers`, { headers: { cookie: admin } }))) as {
      items: { id: string; account: string | null }[];
    };
    assert.equal(listed.items.find((row) => row.id === osei.id)!.account, "active");
  });
});
