import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { signInStaff } from "../helpers/signIn.ts";
import { createStaffAccount, grantRole } from "../helpers/account.ts";
import { removeTestAccounts, removeTestEvents } from "../helpers/cleanup.ts";
import { withSystemScope } from "@pmp/db";

/**
 * Event files (FR-FILE-005, D-079).
 *
 * The list is a read of every presentation on an event, and the downloads hand over the
 * files themselves — the most sensitive thing the platform holds. So beyond "it lists",
 * this proves the three things that make it safe: another event's staff are refused
 * the list and every download route, a bulk request cannot smuggle in a version from
 * elsewhere, and every download lands in the event's audit chain.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const PASSWORD = "dxg-development-password";
const MEDTECH = "22222222-2222-4222-8222-222222222222";
const OUTSIDER_EMAIL = `probe-files-outsider-${Date.now()}@example.invalid`;
const PROBE_EVENT = "Files Probe";

let up = false;
let admin = "";
let outsider = "";

type Listing = {
  rooms: { room_id: string | null; files: number }[];
  counts: Record<string, number>;
  items: {
    version_id: string;
    filename: string;
    size_bytes: number;
    status: string;
    downloadable: boolean;
    history: { id: string; version_number: number }[];
  }[];
  total: number;
  pages: number;
};

const get = (path: string, cookie: string, init: RequestInit = {}) =>
  fetch(`${API}${path}`, { ...init, headers: { "content-type": "application/json", cookie, ...(init.headers ?? {}) } });

const downloads = async (versionId: string): Promise<number> =>
  withSystemScope(async (tx) => {
    const { rows } = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pmp.audit_records WHERE action = 'file.downloaded' AND subject_id = $1`,
      [versionId],
    );
    return rows[0]?.n ?? 0;
  });

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  admin = await signInStaff(API, "admin@example.invalid", PASSWORD);

  const created = (await (
    await get("/events", admin, {
      method: "POST",
      body: JSON.stringify({
        name: PROBE_EVENT,
        venue: "Elsewhere",
        timezone: "America/New_York",
        starts_on: "2027-07-01",
        ends_on: "2027-07-02",
      }),
    })
  ).json()) as { event_id: string };

  // Staff, with a real role — on a different event from the files.
  const account = await createStaffAccount(API, admin, {
    email: OUTSIDER_EMAIL,
    displayName: "Files Probe Outsider",
    password: "probe-files-password",
  });
  outsider = account.cookie;
  await grantRole(API, admin, account.userId, created.event_id, "presentation_manager");
});

after(async () => {
  if (!up) return;
  await removeTestAccounts(["probe-files-outsider-"]);
  await removeTestEvents([PROBE_EVENT]);
});

describe("event files: the list", () => {
  test("lists every file once, with its newest version and history", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await get(`/events/${MEDTECH}/files?limit=100`, admin);
    assert.equal(response.status, 200);
    const body = (await response.json()) as Listing;
    assert.ok(body.total > 0, "fixture: MedTech has uploaded files");
    assert.equal(body.items.length, body.total);
    assert.equal(
      body.rooms.reduce((sum, room) => sum + room.files, 0),
      body.total,
      "the room folders account for every file, including talks with no room",
    );
    const counted = ["review", "approved", "changes", "blocked", "other"].reduce(
      (sum, key) => sum + (body.counts[key] ?? 0),
      0,
    );
    assert.equal(counted, body.counts.all, "the tabs partition the files");
    for (const item of body.items) {
      assert.ok(item.history.length >= 1, `${item.filename} carries its versions`);
      assert.equal(item.history[0]!.id, item.version_id, "the row is the newest version");
    }
  });

  test("a status tab returns only that status, and paging covers the rest", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const approved = (await (await get(`/events/${MEDTECH}/files?status=approved&limit=100`, admin)).json()) as Listing;
    assert.ok(approved.items.every((item) => item.status === "approved"));
    const paged = (await (await get(`/events/${MEDTECH}/files?limit=1&page=1`, admin)).json()) as Listing;
    assert.equal(paged.items.length, Math.min(1, paged.total));
    assert.equal(paged.pages, paged.total);
  });

  test("searching narrows by filename", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const all = (await (await get(`/events/${MEDTECH}/files?limit=100`, admin)).json()) as Listing;
    const target = all.items[0]!;
    const found = (await (
      await get(`/events/${MEDTECH}/files?q=${encodeURIComponent(target.filename)}`, admin)
    ).json()) as Listing;
    assert.ok(found.items.some((item) => item.version_id === target.version_id));
  });
});

describe("event files: downloads", () => {
  test("a version downloads byte for byte, and the download is audited", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const all = (await (await get(`/events/${MEDTECH}/files?limit=100`, admin)).json()) as Listing;
    const target = all.items.find((item) => item.downloadable);
    assert.ok(target, "fixture: a stored file");
    const before = await downloads(target.version_id);
    const response = await get(`/file-versions/${target.version_id}/download`, admin);
    assert.equal(response.status, 200);
    assert.equal((await response.arrayBuffer()).byteLength, target.size_bytes);
    assert.equal(await downloads(target.version_id), before + 1, "every download is written to the audit chain");
  });

  test("a bulk download is one zip of the chosen versions", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const all = (await (await get(`/events/${MEDTECH}/files?limit=100`, admin)).json()) as Listing;
    const ids = all.items.filter((item) => item.downloadable).map((item) => item.version_id);
    const response = await get(`/events/${MEDTECH}/files:bulk-download`, admin, {
      method: "POST",
      body: JSON.stringify({ version_ids: ids }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/zip");
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(String.fromCharCode(bytes[0]!, bytes[1]!), "PK");
  });

  test("a bulk request cannot carry a version that is not on the event", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await get(`/events/${MEDTECH}/files:bulk-download`, admin, {
      method: "POST",
      body: JSON.stringify({ version_ids: ["00000000-0000-4000-8000-000000000000"] }),
    });
    assert.equal(response.status, 404);
  });

  test("an empty selection is refused with a reason", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await get(`/events/${MEDTECH}/files:bulk-download`, admin, {
      method: "POST",
      body: JSON.stringify({ version_ids: [] }),
    });
    assert.equal(response.status, 422);
    assert.equal(((await response.json()) as { code: string }).code, "file.bulk_empty");
  });
});

describe("event files: sizes are the stored bytes (D-081)", () => {
  test("every file's recorded size matches what downloads", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const all = (await (await get(`/events/${MEDTECH}/files?limit=100`, admin)).json()) as Listing;
    for (const item of all.items.filter((row) => row.downloadable)) {
      const bytes = (await (await get(`/file-versions/${item.version_id}/download`, admin)).arrayBuffer()).byteLength;
      assert.equal(item.size_bytes, bytes, `${item.filename}: shown ${item.size_bytes}, stored ${bytes}`);
    }
  });
});

describe("event files: who may see them", () => {
  test("no session, no list", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.equal((await fetch(`${API}/events/${MEDTECH}/files`)).status, 401);
  });

  test("another event's staff are refused the list and every download", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const all = (await (await get(`/events/${MEDTECH}/files?limit=100`, admin)).json()) as Listing;
    const versionId = all.items[0]!.version_id;
    assert.equal((await get(`/events/${MEDTECH}/files`, outsider)).status, 403);
    assert.equal((await get(`/file-versions/${versionId}/download`, outsider)).status, 403);
    const bulk = await get(`/events/${MEDTECH}/files:bulk-download`, outsider, {
      method: "POST",
      body: JSON.stringify({ version_ids: [versionId] }),
    });
    assert.equal(bulk.status, 403);
  });
});
