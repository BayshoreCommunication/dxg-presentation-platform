import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { withSystemScope } from "@pmp/db";
import { queuePdfs } from "../../apps/api/src/services/pdf.ts";

/**
 * Background jobs run in the worker process, not the API (D-103). The API only queues a
 * row and notifies; if no worker is running, previews sit at "queued" for ever — so the
 * suite checks there is one, and that it picks work up without the API's help.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const HEALTH = `${API.replace("/api/v1", "")}/ops/health`;

let up = false;

before(async () => {
  try {
    up = (await fetch(HEALTH)).ok;
  } catch {
    up = false;
  }
});

const stateOf = (versionId: string) =>
  withSystemScope(async (tx) => {
    const { rows } = await tx.query<{ state: string; attempts: number }>(
      `SELECT state, attempts FROM pmp.pdf_conversions WHERE file_version_id = $1`,
      [versionId],
    );
    return rows[0];
  });

describe("the background worker (D-103)", () => {
  test("health reports a running worker", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const body = (await (await fetch(HEALTH)).json()) as { status: string; worker: string };
    assert.equal(body.status, "ok");
    assert.equal(body.worker, "up", "start one with `npm run dev:worker` (it is part of `npm run dev`)");
  });

  test("a queued preview is picked up by the worker within seconds", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const versionId = await withSystemScope(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM pmp.file_versions WHERE s3_key IS NOT NULL AND processing_state = 'stored'
          ORDER BY created_at DESC LIMIT 1`,
      );
      if (rows[0]) await tx.query(`DELETE FROM pmp.pdf_conversions WHERE file_version_id = $1`, [rows[0].id]);
      return rows[0]?.id;
    });
    if (!versionId) return t.skip("no stored file to convert");

    // Queued the way the API queues it: a row and a NOTIFY. Nothing here converts.
    assert.equal(await queuePdfs([versionId]), 1);
    let state = await stateOf(versionId);
    for (let waited = 0; waited < 60_000 && (state?.state === "queued" || state?.state === "converting"); waited += 500) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      state = await stateOf(versionId);
    }
    // "failed" still proves the worker took it: seeded fixtures are not always real decks.
    assert.ok(state && ["done", "failed"].includes(state.state), `still ${state?.state} after a minute`);
    assert.ok(state.attempts >= 1);
  });
});
