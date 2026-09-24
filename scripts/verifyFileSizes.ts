/**
 * Checks every stored file version's recorded size against the bytes actually in storage
 * (D-081). `npm run db:verify-sizes` reports; `npm run db:verify-sizes -- --fix` corrects.
 *
 * Sizes on screen are read from `file_versions.size_bytes`. A real upload records the size
 * of the bytes it assembled, but the development seed used to record hand-typed figures —
 * 504 MB for a 1.9 KB fixture — so the Files screen showed invented sizes.
 *
 * `--fix` is refused outside a development database: on real data a recorded size that
 * disagrees with storage is an integrity fault to investigate, not a number to overwrite.
 */
import { stat } from "node:fs/promises";
import path from "node:path";
import { getOwnerPool, closePool, dbConfig } from "@pmp/db";

const FILE_ROOT = process.env.FILE_ROOT ?? ".data";
const fix = process.argv.includes("--fix");

const database = dbConfig.database;
if (fix && !/^pmp_(dev|test)/.test(database)) {
  console.error(`refusing to --fix sizes in "${database}" — only a development database may be corrected this way`);
  process.exit(2);
}

const pool = getOwnerPool();
try {
  const { rows } = await pool.query<{ id: string; original_filename: string; version_number: number; size_bytes: string; s3_key: string }>(
    `SELECT id, original_filename, version_number, size_bytes::text, s3_key
       FROM pmp.file_versions
      WHERE processing_state = 'stored'
      ORDER BY created_at`,
  );
  let wrong = 0;
  let missing = 0;
  for (const row of rows) {
    const actual = await stat(path.join(FILE_ROOT, "library", row.s3_key)).then(
      (info) => info.size,
      () => null,
    );
    if (actual === null) {
      missing += 1;
      console.log(`MISSING  ${row.original_filename} v${row.version_number} — no stored object at ${row.s3_key}`);
      continue;
    }
    if (actual === Number(row.size_bytes)) continue;
    wrong += 1;
    console.log(`${fix ? "FIXED   " : "MISMATCH"} ${row.original_filename} v${row.version_number} — recorded ${row.size_bytes}, stored ${actual}`);
    if (fix) {
      await pool.query(`UPDATE pmp.file_versions SET size_bytes = $2 WHERE id = $1`, [row.id, actual]);
    }
  }
  console.log(`${rows.length} stored versions checked · ${wrong} size mismatch(es) · ${missing} missing object(s)`);
  if (!fix && wrong + missing > 0) process.exitCode = 1;
} finally {
  await closePool();
}
