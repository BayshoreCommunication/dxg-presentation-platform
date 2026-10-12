import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { withSystemScope } from "@pmp/db";
import { signInStaff } from "../helpers/signIn.ts";

/**
 * "Open in PowerPoint" (client review, D-158): staff get a five-minute link to one stored
 * version, which PowerPoint fetches without a sign-in; it serves that file only, only while it
 * lasts, and issuing it is audited.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const ORIGIN = API.replace("/api/v1", "");
const EVENT = "22222222-2222-4222-8222-222222222222";
const PASSWORD = "dxg-development-password";

let up = false;
let admin = "";
let versionId = "";

before(async () => {
  try {
    up = (await fetch(`${ORIGIN}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  admin = await signInStaff(API, "admin@example.invalid", PASSWORD);
  versionId = await withSystemScope(async (tx) =>
    (await tx.query<{ id: string }>(
      `SELECT id FROM pmp.file_versions WHERE event_id = $1 AND processing_state = 'stored' ORDER BY created_at DESC LIMIT 1`,
      [EVENT],
    )).rows[0]!.id,
  );
});

describe("a link PowerPoint can open (D-158)", () => {
  test("issued to staff for a stored version; serves the file without a sign-in; audited", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const issued = await fetch(`${API}/file-versions/${versionId}/open-link`, { method: "POST", headers: { cookie: admin } });
    assert.equal(issued.status, 201);
    const { path, filename } = (await issued.json()) as { path: string; filename: string };
    assert.match(path, /^\/api\/v1\/open\/[A-Za-z0-9_-]{40,}\/.+\.(pptx|ppt|pdf|key)$/);
    assert.ok(filename.includes(" - v"), "named by speaker, talk and version");

    const served = await fetch(`${ORIGIN}${path}`);
    assert.equal(served.status, 200, "no cookie needed");
    assert.match(served.headers.get("content-disposition") ?? "", /^inline;/);
    assert.ok((await served.arrayBuffer()).byteLength > 0);
    assert.equal((await fetch(`${ORIGIN}${path}`)).status, 200, "PowerPoint may fetch more than once");

    const audited = await withSystemScope(async (tx) =>
      (await tx.query(`SELECT 1 FROM pmp.audit_records WHERE action = 'file.open_link_issued' AND subject_id = $1`, [versionId])).rows.length,
    );
    assert.ok(audited >= 1);
  });

  test("an expired or made-up link serves nothing", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const { path } = (await (await fetch(`${API}/file-versions/${versionId}/open-link`, { method: "POST", headers: { cookie: admin } })).json()) as { path: string };
    await withSystemScope((tx) => tx.query(`UPDATE pmp.open_links SET expires_at = now() - interval '1 second' WHERE file_version_id = $1`, [versionId]));
    assert.equal((await fetch(`${ORIGIN}${path}`)).status, 404);
    assert.equal((await fetch(`${ORIGIN}/api/v1/open/not-a-real-token-at-all/deck.pptx`)).status, 404);
  });

  test("no link without a staff sign-in", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.equal((await fetch(`${API}/file-versions/${versionId}/open-link`, { method: "POST" })).status, 401);
  });
});
