/**
 * Issues a presenter access code for the demo, exactly as DXG does in the
 * product: sign in as staff, then generate the credential.
 *
 *   npm run demo:link            # first speaker with an email
 *   npm run demo:link -- Osei    # by name, organisation or email
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const EMAIL = process.env.DXG_EMAIL ?? "m.vega@example.invalid";
const PASSWORD = process.env.DXG_PASSWORD ?? "dxg-development-password";
const query = process.argv[2] ?? "";

const signIn = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (!signIn.ok) {
  console.error(`Could not sign in as ${EMAIL}. Run \`npm run db:seed\` first, or set DXG_EMAIL / DXG_PASSWORD.`);
  process.exit(1);
}
const cookie = (signIn.headers.getSetCookie?.() ?? [])
  .map((entry) => entry.split(";")[0])
  .join("; ");
const headers = { cookie, "content-type": "application/json" };

const events = await (await fetch(`${API}/events`, { headers })).json();
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
