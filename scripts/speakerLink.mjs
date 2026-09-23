/**
 * Issues a presenter access code for the demo, exactly as DXG does in the
 * product: sign in as staff, then generate the credential.
 *
 *   npm run demo:link            # first speaker with an email
 *   npm run demo:link -- Osei    # by name, organisation or email
 */
import { setTimeout as sleep } from "node:timers/promises";
import { totp } from "../packages/auth/src/totp.ts";

const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const EMAIL = process.env.DXG_EMAIL ?? "m.vega@example.invalid";
const PASSWORD = process.env.DXG_PASSWORD ?? "dxg-development-password";
/** The secret every seeded account shares. Never leaves development; see seed.ts. */
const MFA_SECRET = process.env.DEV_MFA_SECRET ?? "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const query = process.argv[2] ?? "";

/**
 * Cookies, by name, newest wins.
 *
 * Signing in takes two requests and they set different cookies — the first a
 * short-lived MFA challenge, the second the session. Concatenating everything the
 * server ever sent would send both, so they are kept in a map and the later value
 * replaces the earlier one.
 */
const jar = new Map();
const remember = (response) => {
  for (const entry of response.headers.getSetCookie?.() ?? []) {
    const [pair] = entry.split(";");
    const index = pair.indexOf("=");
    if (index > 0) jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
};
const cookieHeader = () =>
  [...jar].map(([name, value]) => `${name}=${value}`).join("; ");

const post = (path, body) =>
  fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieHeader() },
    body: JSON.stringify(body ?? {}),
  });

/**
 * A code with enough of its window left to survive the round trip.
 *
 * TOTP steps every 30 seconds, and one generated in the last moment of a step is
 * routinely refused by the time it arrives. Waiting for the next step is a second or
 * two and removes the flake entirely.
 */
const freshCode = async () => {
  const left = 30 - Math.floor((Date.now() / 1000) % 30);
  if (left < 3) await sleep((left + 1) * 1000);
  return totp(MFA_SECRET);
};

const signIn = await post("/auth/login", { email: EMAIL, password: PASSWORD });
remember(signIn);
const started = await signIn.json().catch(() => ({}));

if (!signIn.ok) {
  console.error(
    `Could not sign in as ${EMAIL}: ${started.message ?? signIn.status}. ` +
      "Run `npm run db:seed` first, or set DXG_EMAIL / DXG_PASSWORD.",
  );
  process.exit(1);
}

/*
 * The second factor. A password alone returns 200 with `{step:"mfa_required"}` and no
 * session, which this script used to read as success — it then failed on the next
 * request and reported "No events — run db:seed first", blaming missing data for an
 * authentication that had never finished. Staff MFA became mandatory after the script
 * was written, so it had been broken ever since.
 */
if (started.step === "mfa_required") {
  let verified = await post("/auth/mfa/verify", { code: await freshCode() });
  let detail = verified.ok ? {} : await verified.json().catch(() => ({}));

  /*
   * A code may only be spent once, so running this twice inside the same 30-second
   * step is refused — which is the server being right and the script being annoying.
   * Waiting for the next step and trying again costs a few seconds and makes
   * `demo:link` safe to run back to back, which is how anyone preparing a demo uses it.
   */
  if (!verified.ok && detail.code === "mfa.code_reused") {
    await sleep((30 - Math.floor((Date.now() / 1000) % 30) + 1) * 1000);
    verified = await post("/auth/mfa/verify", { code: totp(MFA_SECRET) });
    detail = verified.ok ? {} : await verified.json().catch(() => ({}));
  }

  remember(verified);
  if (!verified.ok) {
    console.error(
      `Second factor refused for ${EMAIL}: ${detail.message ?? verified.status}. ` +
        "If this account uses a real authenticator, set DEV_MFA_SECRET to its secret.",
    );
    process.exit(1);
  }
}

const headers = { cookie: cookieHeader(), "content-type": "application/json" };

const eventsResponse = await fetch(`${API}/events`, { headers });
if (!eventsResponse.ok) {
  // Not the same thing as an empty database, and saying so sent people to re-seed a
  // database that was fine.
  console.error(`Signed in, but /events answered ${eventsResponse.status}. The session is not valid.`);
  process.exit(1);
}
const events = await eventsResponse.json();
if (!events.items?.length) {
  console.error("No events — run `npm run db:seed` first.");
  process.exit(1);
}

let found;
for (const event of events.items) {
  const speakers = await (
    await fetch(`${API}/events/${event.id}/speakers?q=${encodeURIComponent(query)}`, { headers })
  ).json();
  const candidate = speakers.items?.find((speaker) => speaker.email);
  if (candidate) {
    found = { event, speaker: candidate };
    break;
  }
}

if (!found) {
  console.error(
    query
      ? `No speaker with an email address matches "${query}" in any event.`
      : "No speaker with an email address exists yet.",
  );
  process.exit(1);
}

const credential = await (
  await fetch(`${API}/speakers/${found.speaker.id}/credentials`, { method: "POST", headers })
).json();

console.error(`${found.speaker.full_name} · ${found.event.name}`);
console.error(`email: ${found.speaker.email}`);
console.error(`code:  ${credential.access_code}`);
console.log(credential.link);

await fetch(`${API}/auth/logout`, { method: "POST", headers });
