/**
 * Creates the very first platform admin on a deployment that has none.
 *
 *     node --env-file=.env scripts/bootstrapAdmin.ts \
 *       --email you@dxg.live --name "A. Whitfield" \
 *       --client "MedTech Industry Association" --event "MedTech Forward 2026" \
 *       --starts 2026-03-10 --ends 2026-03-12 --timezone America/New_York
 *
 * **Why a script and not an endpoint.** A bootstrap endpoint cannot authenticate the
 * person calling it — there is nobody to authenticate against yet — so it would be a
 * URL that mints an administrator. Whoever can run this already has the database
 * credentials, which is a higher bar than anything an HTTP route could check.
 *
 * **It is not a back door.** It refuses outright once any platform admin exists, so
 * it cannot be used to mint a second one quietly. After the first, accounts are made
 * through Staff accounts, by a named person, with the audit that carries.
 *
 * **Why it wants a client and an event.** Roles live in `event_roles`, whose
 * `event_id` is NOT NULL with a foreign key to `events`. There is nowhere to hang a
 * role on an empty database. Rather than invent a placeholder event that would haunt
 * every listing, this creates the first real one from details you supply — the thing
 * the first administrator was going to do first anyway. If the event already exists
 * by name, it is reused rather than duplicated.
 *
 * The account comes out the way every other account does: a temporary password shown
 * exactly once, `must_change_password` set, and no authenticator — so the first
 * sign-in forces a real password and TOTP enrolment before anything else is reachable.
 */
import { withSystemScope, appendAudit } from "@pmp/db";
import { hashPassword, generateAccessCode } from "@pmp/auth";
import { isKnownTimezone } from "../apps/api/src/services/events.ts";

type Args = Record<string, string>;

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      args[key] = "true";
    } else {
      args[key] = value;
      i += 1;
    }
  }
  return args;
}

function fail(message: string): never {
  console.error(`\n  ✖ ${message}\n`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const email = (args.email ?? "").trim().toLowerCase();
const name = (args.name ?? "").trim();
const clientName = (args.client ?? "").trim();
const eventName = (args.event ?? "").trim();
const starts = (args.starts ?? "").trim();
const ends = (args.ends ?? "").trim();
const timezone = (args.timezone ?? "America/New_York").trim();

if (!email || !name || !clientName || !eventName || !starts || !ends) {
  fail(
    "Required: --email --name --client --event --starts --ends. Optional: --timezone (default America/New_York).",
  );
}
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(`“${email}” does not look like an email address.`);
if (!isKnownTimezone(timezone)) fail(`“${timezone}” is not a supported timezone.`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(starts) || !/^\d{4}-\d{2}-\d{2}$/.test(ends)) {
  fail("Dates must be YYYY-MM-DD.");
}
if (new Date(ends) < new Date(starts)) fail("The event cannot end before it starts.");

const temporary = generateAccessCode(4, 4);

const result = await withSystemScope(async (tx) => {
  // Refuse rather than mint a second administrator. This is the one check that keeps
  // the script from being a standing way in.
  const { rows: admins } = await tx.query<{ email: string }>(
    `SELECT u.email::text AS email
       FROM pmp.event_roles er JOIN pmp.users u ON u.id = er.user_id
      WHERE er.role = 'platform_admin' LIMIT 1`,
  );
  if (admins[0]) {
    return { refused: `A platform admin already exists (${admins[0].email}). Create further accounts from Staff accounts.` };
  }

  const { rows: taken } = await tx.query(`SELECT id FROM pmp.users WHERE lower(email::text) = $1`, [email]);
  if (taken[0]) return { refused: `An account already exists for ${email}.` };

  // `clients.name` carries no unique constraint, so match explicitly rather than
  // lean on ON CONFLICT — which fails outright without one.
  const { rows: foundClient } = await tx.query<{ id: string }>(
    `SELECT id FROM pmp.clients WHERE name = $1`,
    [clientName],
  );
  const clientId =
    foundClient[0]?.id ??
    (await tx.query<{ id: string }>(`INSERT INTO pmp.clients (name) VALUES ($1) RETURNING id`, [clientName]))
      .rows[0]!.id;

  const { rows: existingEvent } = await tx.query<{ id: string }>(
    `SELECT id FROM pmp.events WHERE client_id = $1 AND name = $2`,
    [clientId, eventName],
  );
  const eventId =
    existingEvent[0]?.id ??
    (
      await tx.query<{ id: string }>(
        `INSERT INTO pmp.events (client_id, name, starts_on, ends_on, timezone, status)
         VALUES ($1, $2, $3::date, $4::date, $5, 'draft') RETURNING id`,
        [clientId, eventName, starts, ends, timezone],
      )
    ).rows[0]!.id;

  const { rows: userRows } = await tx.query<{ id: string }>(
    `INSERT INTO pmp.users (email, display_name, password_hash, password_set_at, must_change_password)
     VALUES ($1::citext, $2, $3, now(), true) RETURNING id`,
    [email, name, await hashPassword(temporary)],
  );
  const userId = userRows[0]!.id;

  await tx.query(
    `INSERT INTO pmp.event_roles (user_id, event_id, role) VALUES ($1, $2, 'platform_admin')`,
    [userId, eventId],
  );

  // The first administrator is exactly the account whose creation nobody can be asked
  // to vouch for later, so it goes into the same hash-chained trail as every other
  // account change — with no actor, because there was no one to act.
  await appendAudit(tx, {
    partitionId: userId,
    clientId: userId,
    action: "admin.bootstrapped",
    subjectType: "user",
    subjectId: userId,
    detail: { email, event_id: eventId, client_id: clientId, via: "scripts/bootstrapAdmin.ts" },
    reason: "First platform admin created on an installation that had none.",
  });

  return { userId, eventId, clientId };
});

if ("refused" in result && result.refused) fail(result.refused);

console.log(`
  Platform admin created.

    email               ${email}
    temporary password  ${temporary}

    client              ${clientName}
    event               ${eventName}  (${starts} → ${ends}, ${timezone})

  Shown once — it is stored only as a hash. Hand it over directly, not by email.

  On first sign-in this account must set its own password and enrol an authenticator
  before anything else is reachable. Every account after this one is created from
  Staff accounts, by a named person.
`);
process.exit(0);
