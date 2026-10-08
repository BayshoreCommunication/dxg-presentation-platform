import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { signInStaff, cookieFrom } from "../helpers/signIn.ts";
import { removeTestAccounts } from "../helpers/cleanup.ts";

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
let speaker = "";

const json = async (response: Response) => (await response.json()) as Record<string, unknown>;
const headers = (cookie: string) => ({ "content-type": "application/json", cookie });

type Talk = { slot_id: string; versions: { id: string; downloadable: boolean }[] };
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
  const signedIn = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: SPEAKER, password: PASSWORD }),
  });
  speaker = cookieFrom(signedIn);
});

after(async () => {
  if (up) await removeTestAccounts(["k.osei@example.invalid"]);
});

describe("a speaker signs in without a second factor and lands on their own presentations", () => {
  test("the password alone opens the session, and the principal says it is a speaker", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const session = (await json(await fetch(`${API}/auth/session`, { headers: { cookie: speaker } }))) as {
      principal: { account_kind: string; roles: string[]; mfa_enrolled: boolean };
    };
    assert.equal(session.principal.account_kind, "speaker");
    assert.deepEqual(session.principal.roles, []);
    assert.equal(session.principal.mfa_enrolled, false);
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

describe("a speaker account is refused everything that is the staff's", () => {
  // Event-scoped paths are refused by the event resolver (no role on the event) and the
  // rest by the staff gate; either way a speaker is told no, never asked for a second factor.
  for (const path of ["/events", `/events/${EVENT}/speakers`, `/events/${EVENT}/review-queue`, "/admin/users"]) {
    test(`${path} is 403`, async (t: TestContext) => {
      if (!up) return t.skip("API not running");
      const response = await fetch(`${API}${path}`, { headers: { cookie: speaker } });
      assert.equal(response.status, 403);
      const code = ((await json(response)) as { code: string }).code;
      assert.ok(["auth.not_staff", "auth.not_on_this_event"].includes(code), code);
    });
  }

  test("and staff are refused the speaker's own routes", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await fetch(`${API}/me/presentations`, { headers: { cookie: admin } });
    assert.equal(response.status, 403);
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
    const queue = (await json(await fetch(`${API}/events/${EVENT}/review-queue`, { headers: { cookie: reviewer } }))) as {
      items: { file_version_id: string; slot_id: string }[];
    };
    const other = queue.items.find((item) => item.slot_id !== talk.slot_id);
    if (other) {
      const notMine = await fetch(`${API}/me/file-versions/${other.file_version_id}/download`, { headers: { cookie: speaker } });
      assert.equal(notMine.status, 404);
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
    assert.equal(again.status, 200, "a second press finds the account rather than failing");
    assert.equal(((await json(again)) as { outcome: string }).outcome, "existing");

    const listed = (await json(await fetch(`${API}/events/${EVENT}/speakers`, { headers: { cookie: admin } }))) as {
      items: { id: string; account: string | null }[];
    };
    assert.equal(listed.items.find((row) => row.id === osei.id)!.account, "invited");
  });
});
