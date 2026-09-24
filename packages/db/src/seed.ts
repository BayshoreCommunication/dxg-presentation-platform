import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  hashPassword,
  generateAccessCode,
  normaliseCode,
  hashSecret,
  generateRecoveryCodes,
  normaliseRecoveryCode,
  groupSecret,
  totp,
} from "@pmp/auth";
import { getOwnerPool, closePool } from "./pool.ts";

/** Development credentials only. Real deployments create accounts via the admin API. */
const DEV_PASSWORD = "dxg-development-password";
/**
 * A fixed TOTP secret for the development accounts. MFA is enforced for everyone,
 * including here — this is a real second factor with a known secret, not a way
 * around one. `npm run demo:totp` prints the current code.
 */
const DEV_MFA_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

const FILE_ROOT = process.env.FILE_ROOT ?? ".data";

/**
 * Writes a small stand-in object at the content-addressed key a real upload
 * would use, so every downstream step (sync verification, archive packaging)
 * has real bytes with a real checksum to work against.
 */
async function writeFixtureObject(clientId: string, eventId: string, label: string) {
  const body = Buffer.from(`DXG fixture object: ${label}\n`.repeat(64));
  const sha256 = createHash("sha256").update(body).digest("hex");
  const key = `${clientId}/${eventId}/${sha256}`;
  const target = path.join(FILE_ROOT, "library", key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body);
  return { sha256, key, size: body.length };
}

/**
 * Synthetic development fixture mirroring the prototype's cast (no real client
 * or speaker content — AGENTS.md). MedTech Forward 2026, day 2, three talks in
 * the three states the 19-step walkthrough moves between.
 */
const IDS = {
  client: "11111111-1111-4111-8111-111111111111",
  event: "22222222-2222-4222-8222-222222222222",
  pm: "33333333-3333-4333-8333-333333333331",
  reviewer: "33333333-3333-4333-8333-333333333332",
  roomTech: "33333333-3333-4333-8333-333333333333",
  clientAdmin: "33333333-3333-4333-8333-333333333334",
  admin: "33333333-3333-4333-8333-333333333335",
} as const;

const TALKS = [
  {
    key: "raman",
    speaker: "Dr. Priya Raman",
    email: "p.raman@example.invalid",
    org: "Bayview Medical",
    room: "Ballroom A",
    title: "Robotic Surgery Outcomes: Five-Year Data",
    start: "2026-03-11T10:30:00-04:00",
    end: "2026-03-11T11:00:00-04:00",
    versions: [
      { n: 1, processing: "stored", inspection: "passed_with_warnings", review: "superseded" },
      { n: 2, processing: "stored", inspection: "passed_with_warnings", review: "approved" },
    ],
    roomSync: "active",
  },
  {
    key: "fontaine",
    speaker: "Alicia Fontaine",
    email: "a.fontaine@example.invalid",
    org: "CardioNext",
    room: "Room 212",
    title: "CardioNext Trial Results",
    start: "2026-03-11T11:15:00-04:00",
    end: "2026-03-11T11:45:00-04:00",
    versions: [{ n: 1, processing: "stored", inspection: "passed", review: "awaiting_review" }],
    roomSync: null,
  },
  {
    key: "osei",
    speaker: "Kwame Osei",
    email: "k.osei@example.invalid",
    org: "Nordic Devices",
    room: "Room 210",
    title: "Sensor Talk — linked video",
    start: "2026-03-11T13:00:00-04:00",
    end: "2026-03-11T13:30:00-04:00",
    versions: [
      { n: 1, processing: "stored", inspection: "passed_with_warnings", review: "awaiting_review" },
    ],
    roomSync: null,
  },
] as const;

async function seed(): Promise<void> {
  const pool = getOwnerPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path TO pmp, public");

    // Dev fixture only: start from an empty domain so re-seeding is repeatable.
    // Never run against anything but a local database (D-009).
    if (process.env.NODE_ENV === "production") {
      throw new Error("refusing to seed a production database");
    }
    const { rows: tables } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
        WHERE schemaname = 'pmp' AND tablename <> 'schema_migrations'`,
    );
    await client.query(
      `TRUNCATE TABLE ${tables.map((t) => `pmp.${t.tablename}`).join(", ")} RESTART IDENTITY CASCADE`,
    );
    await client.query("INSERT INTO clients (id, name) VALUES ($1, $2)", [
      IDS.client,
      "MedTech Industry Association",
    ]);

    await client.query(
      `INSERT INTO events (id, client_id, name, starts_on, ends_on, timezone, status)
       VALUES ($1, $2, 'MedTech Forward 2026', '2026-03-10', '2026-03-12', 'America/New_York', 'active')`,
      [IDS.event, IDS.client],
    );

    const staff: [string, string, string, string][] = [
      // Someone has to be able to create the others.
      [IDS.admin, "admin@example.invalid", "A. Whitfield", "platform_admin"],
      [IDS.pm, "m.vega@example.invalid", "M. Vega", "presentation_manager"],
      [IDS.reviewer, "c.delgado@example.invalid", "C. Delgado", "content_reviewer"],
      [IDS.roomTech, "t.okafor@example.invalid", "T. Okafor", "room_technician"],
      [IDS.clientAdmin, "j.ellis@example.invalid", "J. Ellis", "client_event_admin"],
    ];
    const devHash = await hashPassword(DEV_PASSWORD);
    const recoveryCodes = generateRecoveryCodes(3);
    for (const [id, email, name, role] of staff) {
      await client.query(
        `INSERT INTO users (id, email, display_name, password_hash, password_set_at,
                            must_change_password, mfa_secret, mfa_enrolled_at)
         VALUES ($1, $2, $3, $4, now(), false, $5, now())
         ON CONFLICT (id) DO UPDATE
           SET display_name = EXCLUDED.display_name, password_hash = EXCLUDED.password_hash,
               mfa_secret = EXCLUDED.mfa_secret, mfa_enrolled_at = EXCLUDED.mfa_enrolled_at`,
        [id, email, name, devHash, DEV_MFA_SECRET],
      );
      await client.query(
        `INSERT INTO event_roles (user_id, event_id, role) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [id, IDS.event, role],
      );
      for (const recovery of recoveryCodes) {
        await client.query(
          `INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [id, hashSecret(normaliseRecoveryCode(recovery))],
        );
      }
    }

    // A few extra rooms so the event looks like a real conference floor and
    // schedule-import matching has something to match against.
    for (const extra of ["Ballroom B", "Room 214"]) {
      await client.query(`INSERT INTO rooms (event_id, client_id, name) VALUES ($1, $2, $3)`, [
        IDS.event,
        IDS.client,
        extra,
      ]);
    }

    // The demo event's Speaker Ready Room desks (D-080). Stations are event data now, so
    // the seed supplies them the way an operator would; a new event starts with none.
    for (const [position, name] of ["Station 1", "Station 2", "Station 3 · USB"].entries()) {
      await client.query(
        `INSERT INTO srr_stations (event_id, client_id, name, position) VALUES ($1, $2, $3, $4)`,
        [IDS.event, IDS.client, name, position + 1],
      );
    }

    const { rows: dayRows } = await client.query<{ id: string }>(
      `INSERT INTO event_days (event_id, client_id, day_date) VALUES ($1, $2, '2026-03-11') RETURNING id`,
      [IDS.event, IDS.client],
    );
    const dayId = dayRows[0]?.id;

    for (const talk of TALKS) {
      const { rows: roomRows } = await client.query<{ id: string }>(
        `INSERT INTO rooms (event_id, client_id, name) VALUES ($1, $2, $3) RETURNING id`,
        [IDS.event, IDS.client, talk.room],
      );
      const roomId = roomRows[0]!.id;

      await client.query(
        `INSERT INTO room_agents (room_id, event_id, client_id, device_fingerprint, public_key,
                                  agent_version, last_heartbeat_at)
         VALUES ($1, $2, $3, $4, '\\x00'::bytea, '1.4.2', now())`,
        [roomId, IDS.event, IDS.client, `${talk.room.replace(/\s+/g, "-").toUpperCase()}-01`],
      );

      const { rows: sessionRows } = await client.query<{ id: string }>(
        `INSERT INTO sessions (event_id, client_id, room_id, day_id, title, starts_at, ends_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [IDS.event, IDS.client, roomId, dayId, talk.title, talk.start, talk.end],
      );
      const { rows: slotRows } = await client.query<{ id: string }>(
        `INSERT INTO slots (session_id, event_id, client_id, title) VALUES ($1, $2, $3, $4) RETURNING id`,
        [sessionRows[0]!.id, IDS.event, IDS.client, talk.title],
      );
      const slotId = slotRows[0]!.id;

      const { rows: speakerRows } = await client.query<{ id: string }>(
        `INSERT INTO speakers (client_id, event_id, email, full_name, organization, release_permission)
         VALUES ($1, $2, $3, $4, $5, 'full') RETURNING id`,
        [IDS.client, IDS.event, talk.email, talk.speaker, talk.org],
      );
      await client.query(
        `INSERT INTO speaker_assignments (speaker_id, slot_id, event_id, client_id) VALUES ($1, $2, $3, $4)`,
        [speakerRows[0]!.id, slotId, IDS.event, IDS.client],
      );

      const { rows: fileRows } = await client.query<{ id: string }>(
        `INSERT INTO files (event_id, client_id, slot_id, display_name) VALUES ($1, $2, $3, $4) RETURNING id`,
        [IDS.event, IDS.client, slotId, `${talk.key}_presentation.pptx`],
      );
      const fileId = fileRows[0]!.id;

      let approvedVersionId: string | undefined;
      let approvedSha: Buffer | null = null;
      for (const version of talk.versions) {
        const object = await writeFixtureObject(IDS.client, IDS.event, `${talk.key}-v${version.n}`);
        const sha = Buffer.from(object.sha256, "hex");
        const { rows: versionRows } = await client.query<{ id: string }>(
          `INSERT INTO file_versions (file_id, event_id, client_id, version_number, original_filename,
                                      content_type, size_bytes, sha256, s3_key, source,
                                      processing_state, inspection_state, review_state, approved_at, approved_by)
           VALUES ($1,$2,$3,$4,$5,'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                   $6,$7,$8,'portal',$9,$10,$11,$12,$13) RETURNING id`,
          [
            fileId,
            IDS.event,
            IDS.client,
            version.n,
            `${talk.key}_v${version.n}.pptx`,
            // The size of the bytes actually stored (D-081). This was a hand-typed figure —
            // 504 MB for a 1.9 KB fixture — so every size on screen was invented.
            object.size,
            sha,
            object.key,
            version.processing,
            version.inspection,
            version.review,
            version.review === "approved" ? new Date().toISOString() : null,
            version.review === "approved" ? IDS.reviewer : null,
          ],
        );
        if (version.review === "approved") {
          approvedVersionId = versionRows[0]!.id;
          approvedSha = sha;
        }

        // Seeded versions carry the same inspection metadata a real ingest would
        // record, so version comparison in SRR has something to compare against.
        for (const meta of [
          { slides: talk.key === "raman" ? 42 : 24 },
          { embedded_media: talk.key === "raman" ? 3 : 1 },
        ]) {
          await client.query(
            `INSERT INTO inspection_findings (file_version_id, event_id, client_id, check_code, severity, detail)
             VALUES ($1, $2, $3, 'metadata', 'info', $4)`,
            [versionRows[0]!.id, IDS.event, IDS.client, JSON.stringify(meta)],
          );
        }
        await client.query(
          `INSERT INTO inspection_findings (file_version_id, event_id, client_id, check_code, severity, detail)
           VALUES ($1, $2, $3, 'aspect', 'info', $4)`,
          [versionRows[0]!.id, IDS.event, IDS.client, JSON.stringify({ aspect: "16:9", room_profile: "16:9" })],
        );

        if (version.inspection === "passed_with_warnings") {
          await client.query(
            `INSERT INTO inspection_findings (file_version_id, event_id, client_id, check_code, severity, detail)
             VALUES ($1, $2, $3, 'codec', 'warning', $4)`,
            [
              versionRows[0]!.id,
              IDS.event,
              IDS.client,
              JSON.stringify({ slide_refs: [14], codec: "HEVC", expected: "H.264" }),
            ],
          );
        }
      }

      if (approvedVersionId && talk.roomSync) {
        await client.query(
          `INSERT INTO room_files (file_version_id, room_id, event_id, client_id, sync_state, synced_sha256)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [approvedVersionId, roomId, IDS.event, IDS.client, talk.roomSync, approvedSha],
        );
      }
    }

    // Every seeded speaker gets a presenter credential, printed once below —
    // exactly how DXG issues them in the product.
    const issued: string[] = [];
    const { rows: seededSpeakers } = await client.query<{ id: string; full_name: string; email: string }>(
      `SELECT id, full_name, email::text FROM speakers WHERE event_id = $1 ORDER BY full_name`,
      [IDS.event],
    );
    for (const speaker of seededSpeakers) {
      const code = generateAccessCode();
      await client.query(
        `INSERT INTO speaker_tokens (speaker_id, event_id, client_id, kind, token_hash, expires_at, code_hint)
         VALUES ($1, $2, $3, 'access_code', $4, now() + interval '45 days', $5)`,
        [speaker.id, IDS.event, IDS.client, hashSecret(normaliseCode(code)), code.slice(-4)],
      );
      issued.push(`  ${speaker.full_name.padEnd(20)} ${speaker.email.padEnd(30)} ${code}`);
    }

    await client.query("COMMIT");
    console.log("\nstaff sign-in (development only):");
    for (const [, email, name] of staff) console.log(`  ${name.padEnd(20)} ${email.padEnd(30)} ${DEV_PASSWORD}`);
    console.log("\nsecond factor — MFA is enforced, these accounts are pre-enrolled:");
    console.log(`  authenticator secret  ${groupSecret(DEV_MFA_SECRET)}`);
    console.log(`  code right now        ${totp(DEV_MFA_SECRET)}   (npm run demo:totp)`);
    console.log(`  recovery codes        ${recoveryCodes.join("  ")}`);
    console.log("\npresenter access codes (issued by DXG, shown once):");
    for (const line of issued) console.log(line);
    console.log("");
    console.log(`seeded event ${IDS.event}: 3 rooms, 3 talks, 4 file versions, 4 staff users`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await closePool();
  }
}

await seed();
