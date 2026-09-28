import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { writeZip } from "../../packages/files/src/zipWrite.ts";
import { withSystemScope } from "@pmp/db";
import { signInStaff } from "../helpers/signIn.ts";

/**
 * Only a file that passed its virus scan and finished inspection is reviewed or approved
 * (WORKFLOW_STATES §1, §3; D-105). Found in the Speaker Ready Room check of 2026-09-28: a
 * USB file carrying the EICAR test signature was quarantined, yet it sat in the review
 * queue and could be claimed, approved and queued to its room — no waiver needed.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const CLIENT = "11111111-1111-4111-8111-111111111111";
const NAME = "Review Eligibility Probe";
const DAY = "2031-07-15";
const RUN = Date.now();
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

let up = false;
let admin = "";
let eventId = "";
let checkinId = "";
let infected = "";
let clean = "";

const call = (method: string, path: string, body?: unknown) =>
  fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie: admin },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** Brings a file in the way the Speaker Ready Room does: a USB upload, scanned and inspected. */
async function usbFile(bytes: Buffer, fileName: string): Promise<{ file_version_id: string; scan_result: string }> {
  const { upload_id } = (await (await call("POST", "/srr/uploads", {})).json()) as { upload_id: string };
  const part = await fetch(`${API}/srr/uploads/${upload_id}/parts/1`, {
    method: "PUT",
    headers: { cookie: admin, "content-type": "application/octet-stream" },
    body: bytes,
  });
  assert.equal(part.status, 200);
  const response = await call("POST", `/srr/checkins/${checkinId}/usb-ingestions`, {
    upload_id,
    file_name: fileName,
    reason: "review eligibility probe",
  });
  assert.equal(response.status, 200);
  return (await response.json()) as { file_version_id: string; scan_result: string };
}

const version = (id: string) =>
  withSystemScope(async (tx) => {
    const { rows } = await tx.query<{ lock_version: number; review_state: string }>(
      `SELECT lock_version, review_state FROM pmp.file_versions WHERE id = $1`,
      [id],
    );
    return rows[0]!;
  });

const transition = async (id: string, action: string) =>
  call("POST", `/file-versions/${id}:transition`, { action, lock_version: (await version(id)).lock_version });

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  admin = await signInStaff(API, "admin@example.invalid", "dxg-development-password");

  // Its own event, reused across runs: the quarantined uploads are history and stay.
  const events = (await (await call("GET", "/events")).json()) as { items: { id: string; name: string; status: string }[] };
  const probe = events.items.find((item) => item.name === NAME);
  eventId = probe?.id ?? "";
  if (probe?.status === "archived") await call("POST", `/events/${eventId}/restore`);
  if (!eventId) {
    const created = (await (
      await call("POST", "/events", { client_id: CLIENT, name: NAME, venue: "Probe", timezone: "America/New_York", starts_on: DAY, ends_on: DAY })
    ).json()) as { event_id: string };
    eventId = created.event_id;
  }

  const title = `Eligibility Talk ${RUN}`;
  assert.equal(
    (await call("POST", `/events/${eventId}/sessions`, { title, room: "Probe Room", track: "", date: DAY, start: "09:00", end: "10:00" })).status,
    201,
  );
  const agenda = (await (await call("GET", `/events/${eventId}/agenda`)).json()) as {
    items: { presentations: { slot_id: string; title: string }[] }[];
  };
  const slot = agenda.items.flatMap((item) => item.presentations).find((talk) => talk.title === title)!;
  const speaker = (await (
    await call("POST", `/events/${eventId}/speakers`, {
      name: `Eligibility Speaker ${RUN}`,
      email: `eligibility.${RUN}@example.invalid`,
      organization: "",
      slot_id: slot.slot_id,
    })
  ).json()) as { speaker_id: string };
  const station = (await (await call("POST", `/events/${eventId}/srr/stations`, { name: `Desk ${RUN}` })).json()) as { id: string };
  const checkin = await call("POST", `/events/${eventId}/srr/checkins`, { speaker_id: speaker.speaker_id, station_id: station.id });
  assert.equal(checkin.status, 201);
  checkinId = ((await checkin.json()) as { checkin_id: string }).checkin_id;

  const bad = await usbFile(Buffer.from(EICAR), "infected.pptx");
  assert.equal(bad.scan_result, "infected", "the EICAR signature must be caught by the scanner");
  infected = bad.file_version_id;
});

after(async () => {
  if (!up || !eventId) return;
  await call("POST", `/events/${eventId}/archive`);
});

describe("a quarantined file is never reviewed (D-105)", () => {
  test("it is not in the review queue", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const queue = (await (await call("GET", `/events/${eventId}/review-queue`)).json()) as { items: { file_version_id: string }[] };
    assert.equal(queue.items.some((item) => item.file_version_id === infected), false);
  });

  test("it cannot be claimed or approved", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    for (const action of ["claim", "approve"]) {
      const response = await transition(infected, action);
      assert.equal(response.status, 409, `${action} must be refused`);
      assert.equal(((await response.json()) as { code: string }).code, "review.ineligible_conflict");
    }
    assert.equal((await version(infected)).review_state, "awaiting_review");
  });

  test("its virus finding cannot be waived", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const findingId = await withSystemScope(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM pmp.inspection_findings WHERE file_version_id = $1 AND check_code = 'malware'`,
        [infected],
      );
      return rows[0]?.id;
    });
    assert.ok(findingId, "a quarantined file carries a malware finding");
    const response = await call("POST", `/findings/${findingId}/waive`, { reason: "trying to release it" });
    assert.equal(response.status, 409);
    assert.equal(((await response.json()) as { code: string }).code, "inspection.not_waivable_conflict");
  });
});

describe("a blocking finding holds approval until it is waived (D-105)", () => {
  test("approve is refused, then allowed once the finding is waived", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    // The smallest package inspection accepts: a 16:9 PowerPoint with one slide.
    const deck = writeZip([
      { name: "[Content_Types].xml", body: Buffer.from('<?xml version="1.0"?><Types/>') },
      { name: "ppt/presentation.xml", body: Buffer.from('<p:presentation><p:sldSz cx="12192000" cy="6858000"/></p:presentation>') },
      { name: "ppt/slides/slide1.xml", body: Buffer.from("<p:sld/>") },
    ]);
    const good = await usbFile(deck, "clean.pptx");
    clean = good.file_version_id;
    // A blocking finding of the kind inspection raises, on the clean file.
    const findingId = await withSystemScope(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO pmp.inspection_findings (file_version_id, event_id, client_id, check_code, severity, detail)
         SELECT id, event_id, client_id, 'aspect_ratio', 'blocking', '{"probe":true}'::jsonb
           FROM pmp.file_versions WHERE id = $1
         RETURNING id`,
        [clean],
      );
      return rows[0]!.id;
    });
    assert.equal((await transition(clean, "claim")).status, 200, "a clean file can be claimed");
    const refused = await transition(clean, "approve");
    assert.equal(refused.status, 409);
    assert.match(((await refused.json()) as { message: string }).message, /blocking finding/);

    assert.equal((await call("POST", `/findings/${findingId}/waive`, { reason: "client accepts 4:3 for this talk" })).status, 200);
    assert.equal((await transition(clean, "approve")).status, 200, "approved once waived");
  });
});

describe("the presentation receipt (D-106)", () => {
  test("it can only be emailed once there is one, and then goes to the speaker", async (t: TestContext) => {
    if (!up || !clean) return t.skip("API not running");
    const early = await call("POST", `/srr/checkins/${checkinId}/receipt/email`);
    assert.equal(early.status, 409, "no receipt before sign-off");

    const signed = await call("POST", `/srr/checkins/${checkinId}/sign-off`, { file_version_id: clean });
    assert.equal(signed.status, 200);

    const sent = await call("POST", `/srr/checkins/${checkinId}/receipt/email`);
    assert.equal(sent.status, 200);
    assert.equal(((await sent.json()) as { emailed_to: string }).emailed_to, `eligibility.${RUN}@example.invalid`);
    const logged = await withSystemScope(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pmp.communications
          WHERE to_address = $1 AND subject LIKE '%presentation receipt%'`,
        [`eligibility.${RUN}@example.invalid`],
      );
      return rows[0]!.n;
    });
    assert.equal(logged, 1, "the receipt email is in the event's mail log");
  });
});
