import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { signInStaff, cookieFrom } from "../helpers/signIn.ts";
import { createStaffAccount, grantRole } from "../helpers/account.ts";
import { removeTestAccounts } from "../helpers/cleanup.ts";
import { withSystemScope } from "@pmp/db";

/**
 * Release permission and the archive (FR-SPK-003, D-089).
 *
 * Every speaker starts "undecided", and the archive leaves an undecided speaker's talk
 * out — but nothing could set the permission, so a speaker added after the seed could
 * never reach the client's package. And for a co-presented talk the archive read one
 * presenter's permission, chosen by chance.
 *
 * So: staff can set it; and a co-presented talk goes in only as far as *every* presenter
 * agreed. The talk here is really uploaded through the portal and really approved, so
 * the archive's own scope is what is checked.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const PASSWORD = "dxg-development-password";
const CLIENT = "11111111-1111-4111-8111-111111111111";
const NAME = "Release Permission Probe";
const RUN = Date.now();
const LEAD_EMAIL = `release.lead.${RUN}@example.invalid`;
const REVIEWER_EMAIL = `probe-release-reviewer-${RUN}@example.invalid`;
const TALK = `Release Talk ${RUN}`;

let up = false;
let staff = "";
let reviewer = "";
let eventId = "";
let slotId = "";
let lead = "";
let co = "";

const json = (cookie: string) => ({ "content-type": "application/json", cookie });
const call = (method: string, path: string, body?: unknown, cookie = staff) =>
  fetch(`${API}${path}`, {
    method,
    headers: json(cookie),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const setRelease = (speakerId: string, value: string, cookie = staff) =>
  call("PUT", `/events/${eventId}/speakers/${speakerId}/release-permission`, { release_permission: value }, cookie);

type Scope = {
  included: { title: string; speaker: string | null; formats: string[] }[];
  excluded: { title: string; speaker: string | null; reason: string }[];
};
const scope = async (): Promise<Scope> => (await (await call("GET", `/events/${eventId}/archive/scope`)).json()) as Scope;
const ours = async () => {
  const current = await scope();
  return {
    included: current.included.find((row) => row.title === TALK),
    excluded: current.excluded.find((row) => row.title === TALK),
  };
};

async function addPresenter(name: string, email: string): Promise<string> {
  const response = await call("POST", `/events/${eventId}/speakers`, { name, email, organization: "", slot_id: slotId });
  assert.equal(response.status, 201, `fixture: ${name}`);
  return ((await response.json()) as { speaker_id: string }).speaker_id;
}

/** Uploads one small file as the lead presenter, then claims and approves it as staff. */
async function uploadAndApprove(): Promise<void> {
  const { access_code } = (await (await call("POST", `/speakers/${lead}/credentials`, {})).json()) as {
    access_code: string;
  };
  const login = await call("POST", "/portal/login", { email: LEAD_EMAIL, code: access_code }, "");
  assert.equal(login.status, 200, "fixture: the presenter signs in");
  const presenter = cookieFrom(login);

  const body = Buffer.from(`release probe ${RUN}`);
  const started = (await (
    await call("POST", "/portal/uploads", { slot_id: slotId, file_name: "deck.pptx", total_bytes: body.length }, presenter)
  ).json()) as { upload_id: string };
  await fetch(`${API}/portal/uploads/${started.upload_id}/parts/1`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream", cookie: presenter },
    body,
  });
  const done = await call("POST", `/portal/uploads/${started.upload_id}/complete`, { slot_id: slotId, file_name: "deck.pptx" }, presenter);
  assert.equal(done.status, 200, "fixture: the upload is accepted");

  const queue = (await (await call("GET", `/events/${eventId}/review-queue`)).json()) as {
    items: { file_version_id: string; slot_id: string; lock_version: number }[];
  };
  const item = queue.items.find((entry) => entry.slot_id === slotId);
  assert.ok(item, "fixture: the upload is waiting for review");
  const claimed = (await (
    await call("POST", `/file-versions/${item.file_version_id}:transition`, { action: "claim", lock_version: item.lock_version })
  ).json()) as { lock_version: number };
  const approved = await call("POST", `/file-versions/${item.file_version_id}:transition`, {
    action: "approve",
    lock_version: claimed.lock_version,
  });
  assert.equal(approved.status, 200, "fixture: the version is approved");
}

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  staff = await signInStaff(API, "admin@example.invalid", PASSWORD);

  // Uploads are history, so the probe is reused (and left archived) rather than deleted.
  const existing = (await (await call("GET", "/events")).json()) as { items: { id: string; name: string; status: string }[] };
  const probe = existing.items.find((item) => item.name === NAME);
  if (probe) {
    eventId = probe.id;
    if (probe.status === "archived") assert.equal((await call("POST", `/events/${eventId}/restore`, {})).status, 200);
  } else {
    const created = (await (
      await call("POST", "/events", {
        client_id: CLIENT,
        name: NAME,
        venue: "Probe Venue",
        timezone: "America/New_York",
        starts_on: "2027-10-01",
        ends_on: "2027-10-01",
      })
    ).json()) as { event_id: string };
    eventId = created.event_id;
  }

  // A talk of its own each run, so earlier runs' approvals never answer for this one.
  const session = await call("POST", `/events/${eventId}/sessions`, {
    title: TALK,
    room: "Probe Room",
    track: "",
    date: "2027-10-01",
    start: "09:00",
    end: "10:00",
  });
  assert.equal(session.status, 201, "fixture: the session");
  const agenda = (await (await call("GET", `/events/${eventId}/agenda`)).json()) as {
    items: { presentations: { slot_id: string; title: string }[] }[];
  };
  slotId = agenda.items.flatMap((item) => item.presentations).find((talk) => talk.title === TALK)!.slot_id;

  lead = await addPresenter(`Release Lead ${RUN}`, LEAD_EMAIL);
  co = await addPresenter(`Release Co ${RUN}`, `release.co.${RUN}@example.invalid`);
  await uploadAndApprove();

  const account = await createStaffAccount(API, staff, {
    email: REVIEWER_EMAIL,
    displayName: "Release Probe Reviewer",
    password: "probe-release-password",
  });
  reviewer = account.cookie;
  await grantRole(API, staff, account.userId, eventId, "content_reviewer");
});

after(async () => {
  if (!up) return;
  await removeTestAccounts(["probe-release-reviewer-"]);
  if (eventId) await call("POST", `/events/${eventId}/archive`, {});
});

describe("setting a release permission", () => {
  test("a new speaker starts not set, and staff can set it", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const speakers = (await (await call("GET", `/events/${eventId}/speakers`)).json()) as {
      items: { id: string; release_permission: string }[];
    };
    assert.equal(speakers.items.find((speaker) => speaker.id === co)?.release_permission, "undecided");
    const response = await setRelease(co, "pdf_only");
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as { release_permission: string }).release_permission, "pdf_only");
    await setRelease(co, "undecided");
  });

  test("a change is audited with what it was and what it became", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    await setRelease(co, "none");
    await setRelease(co, "undecided");
    const audits = await withSystemScope(async (tx) => {
      const { rows } = await tx.query<{ detail: { before: string; after: string } }>(
        `SELECT detail FROM pmp.audit_records
          WHERE action = 'speakers.release_permission_set' AND subject_id = $1 ORDER BY id`,
        [co],
      );
      return rows.map((row) => `${row.detail.before}→${row.detail.after}`);
    });
    assert.deepEqual(audits.slice(-2), ["undecided→none", "none→undecided"]);
  });

  test("an unknown value is refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await setRelease(co, "everything");
    assert.equal(response.status, 400);
    assert.equal(((await response.json()) as { code: string }).code, "speakers.bad_release_permission");
  });

  test("staff below presentation manager cannot change it", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.equal((await setRelease(co, "full", reviewer)).status, 403);
  });

  test("a speaker from another event is not found through this one", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const medtech = (await (await call("GET", "/events/22222222-2222-4222-8222-222222222222/speakers")).json()) as {
      items: { id: string }[];
    };
    assert.equal((await setRelease(medtech.items[0]!.id, "none")).status, 404);
  });
});

describe("a co-presented talk is archived only as far as every presenter agreed", () => {
  test("both presenters are named", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const { included, excluded } = await ours();
    const speaker = (included ?? excluded)?.speaker ?? "";
    assert.ok(speaker.includes("Release Lead") && speaker.includes("Release Co"), speaker);
  });

  test("one presenter not set keeps it out, whatever the other agreed", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    await setRelease(lead, "full");
    await setRelease(co, "undecided");
    const { included, excluded } = await ours();
    assert.equal(included, undefined);
    assert.equal(excluded?.reason, "release permission not set");
  });

  test("one presenter withholding keeps it out", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    await setRelease(lead, "full");
    await setRelease(co, "none");
    const { excluded } = await ours();
    assert.equal(excluded?.reason, "speaker withheld permission");
  });

  test("full and PDF only goes in as PDF only", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    await setRelease(lead, "full");
    await setRelease(co, "pdf_only");
    const { included } = await ours();
    assert.deepEqual(included?.formats, ["pdf"]);
  });

  test("both full goes in as PowerPoint and PDF", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    await setRelease(lead, "full");
    await setRelease(co, "full");
    const { included } = await ours();
    assert.deepEqual(included?.formats, ["pptx", "pdf"]);
  });
});
