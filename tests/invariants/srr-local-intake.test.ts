import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { writeZip } from "../../packages/files/src/zipWrite.ts";
import { withSystemScope } from "@pmp/db";
import { signInStaff } from "../helpers/signIn.ts";

/**
 * The Speaker Ready Room after the client's review (D-152): "local intake" takes a file
 * from a USB drive or one saved on the desk's computer; DXG staff may upload or update a
 * speaker's presentation straight from the room, without a check-in; and the room's
 * check-ins and checkouts come out as a CSV report.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const CLIENT = "11111111-1111-4111-8111-111111111111";
const SEED_EVENT = "22222222-2222-4222-8222-222222222222";
const PASSWORD = "dxg-development-password";
const NAME = "SRR Local Intake Probe";
const DAY = "2031-08-12";
const RUN = Date.now();

let up = false;
let admin = "";
let eventId = "";
let slotId = "";
let speakerName = "";
let deskName = "";

const call = (method: string, path: string, body?: unknown, cookie = admin) =>
  fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const deck = () =>
  writeZip([
    { name: "[Content_Types].xml", body: Buffer.from('<?xml version="1.0"?><Types/>') },
    { name: "ppt/presentation.xml", body: Buffer.from('<p:presentation><p:sldSz cx="12192000" cy="6858000"/></p:presentation>') },
    { name: "ppt/slides/slide1.xml", body: Buffer.from("<p:sld/>") },
  ]);

async function uploaded(bytes: Buffer): Promise<string> {
  const { upload_id } = (await (await call("POST", "/srr/uploads", {})).json()) as { upload_id: string };
  const part = await fetch(`${API}/srr/uploads/${upload_id}/parts/1`, {
    method: "PUT",
    headers: { cookie: admin, "content-type": "application/octet-stream" },
    body: bytes,
  });
  assert.equal(part.status, 200);
  return upload_id;
}

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  admin = await signInStaff(API, "admin@example.invalid", PASSWORD);

  const events = (await (await call("GET", "/events")).json()) as { items: { id: string; name: string; status: string }[] };
  const probe = events.items.find((item) => item.name === NAME);
  eventId = probe?.id ?? "";
  if (probe?.status === "archived") await call("POST", `/events/${eventId}/restore`);
  if (!eventId) {
    const created = (await (
      await call("POST", "/events", { client_id: CLIENT, name: NAME, venue: "Probe", timezone: "America/Chicago", starts_on: DAY, ends_on: DAY })
    ).json()) as { event_id: string };
    eventId = created.event_id;
  }

  const title = `Local Intake Talk ${RUN}`;
  assert.equal(
    (await call("POST", `/events/${eventId}/sessions`, { title, room: "Probe Room", track: "", date: DAY, start: "09:00", end: "10:00" })).status,
    201,
  );
  const agenda = (await (await call("GET", `/events/${eventId}/agenda`)).json()) as {
    items: { presentations: { slot_id: string; title: string }[] }[];
  };
  slotId = agenda.items.flatMap((item) => item.presentations).find((talk) => talk.title === title)!.slot_id;
  speakerName = `Intake Speaker ${RUN}`;
  const speaker = (await (
    await call("POST", `/events/${eventId}/speakers`, {
      name: speakerName,
      email: `intake.${RUN}@example.invalid`,
      organization: "",
      slot_id: slotId,
    })
  ).json()) as { speaker_id: string };

  // One visit, checked in and out, for the report.
  deskName = `Desk ${RUN}`;
  // A new event's Speaker Ready Room starts closed (D-156); open it, as on the event day.
  assert.equal((await call("PUT", `/events/${eventId}/srr-open`, { open: true })).status, 200);
  const station = (await (await call("POST", `/events/${eventId}/srr/stations`, { name: deskName })).json()) as { id: string };
  const checkin = await call("POST", `/events/${eventId}/srr/checkins`, { speaker_id: speaker.speaker_id, station_id: station.id });
  assert.equal(checkin.status, 201);
  const { checkin_id } = (await checkin.json()) as { checkin_id: string };
  assert.equal((await call("POST", `/srr/checkins/${checkin_id}/depart`)).status, 200);
});

after(async () => {
  if (!up || !eventId) return;
  await call("POST", `/events/${eventId}/archive`);
});

describe("local intake from the Speaker Ready Room, without a check-in (D-152)", () => {
  test("staff upload a speaker's file; it is scanned, stored as the next version and sent to review", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const first = await call("POST", `/events/${eventId}/srr/slots/${slotId}/intake`, {
      upload_id: await uploaded(deck()),
      file_name: "saved-on-desk.pptx",
      reason: "speaker brought the file on a laptop",
    });
    assert.equal(first.status, 200);
    const body = (await first.json()) as { scan_result: string; version_number: number; file_version_id: string; ingestion_id: string | null };
    assert.equal(body.scan_result, "clean");
    assert.equal(body.ingestion_id, null, "no check-in, so no check-in intake row");

    const second = (await (
      await call("POST", `/events/${eventId}/srr/slots/${slotId}/intake`, {
        upload_id: await uploaded(deck()),
        file_name: "saved-on-desk-v2.pptx",
        reason: "closing slide added",
      })
    ).json()) as { version_number: number; file_version_id: string; compared_with: { version_number: number; basis: string } | null };
    assert.equal(second.version_number, body.version_number + 1, "an update is the next version");
    assert.deepEqual(second.compared_with, { version_number: body.version_number, basis: "previous" });

    const stored = await withSystemScope(async (tx) => {
      const { rows } = await tx.query<{ source: string; review_state: string; processing_state: string }>(
        `SELECT source, review_state, processing_state FROM pmp.file_versions WHERE id = ANY($1::uuid[])
          ORDER BY version_number`,
        [[body.file_version_id, second.file_version_id]],
      );
      const { rows: audit } = await tx.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pmp.audit_records
          WHERE action = 'srr.local_intake' AND subject_id = $1 AND reason = $2`,
        [body.file_version_id, "speaker brought the file on a laptop"],
      );
      return { first: rows[0]!, latest: rows[1]!, audited: Number(audit[0]!.n) };
    });
    assert.equal(stored.first.source, "srr_manual");
    assert.equal(stored.first.processing_state, "stored");
    assert.equal(stored.first.review_state, "superseded", "the update replaces it in review");
    assert.equal(stored.latest.review_state, "awaiting_review");
    assert.equal(stored.audited, 1, "the intake is audited with its reason");
  });

  test("a reason is required, and the talk must belong to the event", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const noReason = await call("POST", `/events/${eventId}/srr/slots/${slotId}/intake`, {
      upload_id: await uploaded(deck()),
      file_name: "x.pptx",
      reason: "  ",
    });
    assert.equal(noReason.status, 422);
    assert.equal(((await noReason.json()) as { code: string }).code, "srr.reason_required");

    const otherEvent = await call("POST", `/events/${SEED_EVENT}/srr/slots/${slotId}/intake`, {
      upload_id: await uploaded(deck()),
      file_name: "x.pptx",
      reason: "wrong event",
    });
    assert.equal(otherEvent.status, 404);
  });

  test("support staff are refused, as they are the whole Speaker Ready Room (D-151)", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const support = await signInStaff(API, "m.vega@example.invalid", PASSWORD);
    for (const [method, path] of [
      ["POST", `/events/${SEED_EVENT}/srr/slots/${slotId}/intake`],
      ["GET", `/events/${SEED_EVENT}/srr/report.csv`],
    ] as const) {
      const response = await call(method, path, method === "POST" ? { upload_id: "x", file_name: "x.pptx", reason: "r" } : undefined, support);
      assert.equal(response.status, 403, `${method} ${path}`);
      assert.equal(((await response.json()) as { code: string }).code, "auth.kind_forbidden");
    }
  });
});

describe("the check-in / checkout report (D-152)", () => {
  test("is a CSV with presenter, desk, check-in and checkout times on the event's clock", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await call("GET", `/events/${eventId}/srr/report.csv`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/csv/);
    assert.match(response.headers.get("content-disposition") ?? "", /^attachment; filename="srr-local-intake-probe-speaker-ready-room-check-ins\.csv"/);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], "a byte-order mark, so Excel reads UTF-8");
    const [heading, ...lines] = bytes.subarray(3).toString("utf8").trim().split("\r\n");
    assert.equal(
      heading,
      "Presenter,Email,Talk,Room,Desk,Check-in (America/Chicago),Checkout (America/Chicago),Minutes at desk,Checked in by,Signed-off version",
    );
    const row = lines.find((line) => line.startsWith(speakerName));
    assert.ok(row, "the probe speaker's visit is listed");
    const cells = row.split(",");
    assert.equal(cells[4], deskName);
    assert.match(cells[5]!, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    assert.match(cells[6]!, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, "checked out, so a checkout time");
    assert.equal(cells[7], "0");
  });

  test("a technician can download it", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const technician = await signInStaff(API, "c.delgado@example.invalid", PASSWORD);
    const response = await call("GET", `/events/${SEED_EVENT}/srr/report.csv`, undefined, technician);
    assert.equal(response.status, 200);
  });
});
