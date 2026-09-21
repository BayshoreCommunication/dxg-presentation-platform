import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { withScope, withSystemScope, closePool, getPool } from "@pmp/db";

/**
 * BUILD_SPEC I-4 — client isolation, enforced by the database rather than by
 * remembering to write a WHERE clause.
 *
 * This suite could not be written until 2026-09-21. Migration 005 enabled and FORCEd
 * row security on every tenant table and granted its policies `TO pmp_app`, and the
 * application then connected as `pmp` — the schema owner, a superuser. A superuser
 * bypasses row security, so every policy was dead on arrival: a session scoped to a
 * client that did not exist read every event, speaker and file version in the
 * database. D-035 makes the application connect as `pmp_app`.
 *
 * It also could not be *meaningfully* written before, because the seed has one client:
 * isolation between tenants is untestable with a single tenant, so this suite makes a
 * second one and takes it away again.
 */
const PROBE = "RLS Isolation Probe";
let clientA = "";
let clientB = "";
let eventA = "";
let eventB = "";

const uuid = () => crypto.randomUUID();

before(async () => {
  const database = process.env.PGDATABASE ?? "pmp_dev";
  if (!/^pmp_(dev|test)/.test(database)) {
    throw new Error(`refusing to seed probe tenants into "${database}"`);
  }

  await withSystemScope(async (tx) => {
    for (const side of ["A", "B"] as const) {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO pmp.clients (id, name) VALUES ($1, $2) RETURNING id`,
        [uuid(), `${PROBE} ${side}`],
      );
      const clientId = rows[0]!.id;
      const { rows: eventRows } = await tx.query<{ id: string }>(
        `INSERT INTO pmp.events (id, client_id, name, starts_on, ends_on, timezone, status)
         VALUES ($1,$2,$3,'2027-07-01','2027-07-02','America/New_York','draft') RETURNING id`,
        [uuid(), clientId, `${PROBE} ${side} Event`],
      );
      if (side === "A") {
        clientA = clientId;
        eventA = eventRows[0]!.id;
      } else {
        clientB = clientId;
        eventB = eventRows[0]!.id;
      }
    }
  });
});

describe("the database, not the application, decides what a client can see", () => {
  test("the application does not connect as a superuser", async (t: TestContext) => {
    void t;
    const { rows } = await getPool().query<{
      current_user: string;
      superuser: boolean;
      bypassrls: boolean;
    }>(
      `SELECT current_user,
              rolsuper AS superuser,
              rolbypassrls AS bypassrls
         FROM pg_roles WHERE rolname = current_user`,
    );
    const who = rows[0]!;
    // The entire fix, in one assertion: everything below is meaningless without it.
    assert.equal(who.superuser, false, `${who.current_user} is a superuser and bypasses every policy`);
    assert.equal(who.bypassrls, false, `${who.current_user} has BYPASSRLS`);
  });

  test("a client sees its own event and not the other's", async () => {
    const seenByA = await withScope({ clientId: clientA }, async (tx) =>
      (await tx.query<{ id: string }>(`SELECT id FROM pmp.events`)).rows.map((row) => row.id),
    );
    assert.ok(seenByA.includes(eventA), "A must see its own event");
    assert.ok(!seenByA.includes(eventB), "A must not see B's event");

    const seenByB = await withScope({ clientId: clientB }, async (tx) =>
      (await tx.query<{ id: string }>(`SELECT id FROM pmp.events`)).rows.map((row) => row.id),
    );
    assert.ok(seenByB.includes(eventB));
    assert.ok(!seenByB.includes(eventA));
  });

  test("a bare SELECT with no WHERE clause is still isolated", async () => {
    // The point of RLS: forgetting the filter is not a disclosure.
    const count = await withScope({ clientId: clientA }, async (tx) =>
      Number((await tx.query<{ n: string }>(`SELECT count(*)::text AS n FROM pmp.events`)).rows[0]!.n),
    );
    assert.equal(count, 1, "scoped to one client, the whole table is one event");
  });

  test("a client scoped to nobody sees nothing", async () => {
    const seen = await withScope({ clientId: "99999999-9999-4999-8999-999999999999" }, async (tx) => ({
      events: (await tx.query<{ n: string }>(`SELECT count(*)::text AS n FROM pmp.events`)).rows[0]!.n,
      speakers: (await tx.query<{ n: string }>(`SELECT count(*)::text AS n FROM pmp.speakers`)).rows[0]!.n,
      versions: (await tx.query<{ n: string }>(`SELECT count(*)::text AS n FROM pmp.file_versions`)).rows[0]!
        .n,
    }));
    // Before D-035 this returned every row in the database.
    assert.deepEqual(seen, { events: "0", speakers: "0", versions: "0" });
  });

  test("platform context still sees across clients, because DXG staff work across them", async () => {
    const seen = await withSystemScope(async (tx) =>
      (await tx.query<{ id: string }>(`SELECT id FROM pmp.events`)).rows.map((row) => row.id),
    );
    assert.ok(seen.includes(eventA) && seen.includes(eventB));
  });

  test("writing into another client is refused by the policy, not just by the app", async () => {
    await assert.rejects(
      () =>
        withScope({ clientId: clientA }, (tx) =>
          tx.query(
            `INSERT INTO pmp.events (id, client_id, name, starts_on, ends_on, timezone, status)
             VALUES ($1,$2,'Smuggled','2027-07-01','2027-07-02','America/New_York','draft')`,
            [uuid(), clientB],
          ),
        ),
      /row-level security/i,
      "a WITH CHECK violation, not a silent success",
    );
  });

  test("another client's event cannot be touched, because it is not there to touch", async () => {
    /*
     * No error here, and that is the correct behaviour: the USING clause makes B's
     * event invisible to A, so the UPDATE matches nothing. What matters is that it
     * changed nothing — an invisible row cannot be modified by a statement that cannot
     * see it.
     */
    const changed = await withScope({ clientId: clientA }, async (tx) => {
      const result = await tx.query(`UPDATE pmp.events SET name = 'stolen' WHERE id = $1`, [eventB]);
      return result.rowCount;
    });
    assert.equal(changed, 0, "B's event must be untouchable from A's scope");

    const stillNamed = await withSystemScope(async (tx) =>
      (await tx.query<{ name: string }>(`SELECT name FROM pmp.events WHERE id = $1`, [eventB])).rows[0]!
        .name,
    );
    assert.match(stillNamed, /RLS Isolation Probe B/, "and it must still be what it was");
  });

  test("an event I can see cannot be handed to another client", async () => {
    // The dangerous direction: A owns this row and tries to move it into B, which is a
    // WITH CHECK violation rather than an invisible no-op.
    await assert.rejects(
      () =>
        withScope({ clientId: clientA }, (tx) =>
          tx.query(`UPDATE pmp.events SET client_id = $1 WHERE id = $2`, [clientB, eventA]),
        ),
      /row-level security/i,
    );
  });
});

describe("the application role owns nothing and can escalate to nothing", () => {
  test("it cannot become the owner", async () => {
    await assert.rejects(
      () => getPool().query(`SET ROLE pmp`),
      /permission denied|must be (a )?member/i,
      "SET ROLE back to the owner would undo the whole fix",
    );
  });

  test("it cannot change the schema", async () => {
    await assert.rejects(
      () => getPool().query(`CREATE TABLE pmp.smuggled (id int)`),
      /permission denied/i,
    );
    await assert.rejects(() => getPool().query(`ALTER TABLE pmp.events DROP COLUMN name`), /must be owner/i);
  });

  test("it cannot rewrite or erase the audit", async () => {
    await assert.rejects(
      () => getPool().query(`UPDATE pmp.audit_records SET action = 'rewritten'`),
      /permission denied/i,
      "append-only is a grant, not a convention",
    );
    await assert.rejects(() => getPool().query(`DELETE FROM pmp.audit_records`), /permission denied/i);
  });

  test("it cannot read the migration ledger", async () => {
    await assert.rejects(
      () => getPool().query(`SELECT * FROM pmp.schema_migrations`),
      /permission denied/i,
    );
  });
});

after(async () => {
  /*
   * Two transactions, not one. Both deletes in a single `withSystemScope` meant a
   * foreign-key failure on the second rolled back the first, so nothing was removed and
   * every run left another pair of tenants behind — until `POST /events` started
   * refusing to guess which of nine clients an event belonged to, and took two other
   * suites down with it.
   *
   * Events are found by their client rather than by their own name, so a probe tenant
   * cannot be orphaned by an event this suite did not name.
   */
  await withSystemScope((tx) =>
    tx.query(`DELETE FROM pmp.events WHERE client_id IN (SELECT id FROM pmp.clients WHERE name LIKE $1)`, [
      `${PROBE}%`,
    ]),
  );
  await withSystemScope((tx) => tx.query(`DELETE FROM pmp.clients WHERE name LIKE $1`, [`${PROBE}%`]));
  await closePool();
});
