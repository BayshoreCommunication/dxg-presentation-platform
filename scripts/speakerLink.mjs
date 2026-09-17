/** Prints a fresh speaker-portal link for the demo (production sends these by email, M3-5). */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const name = process.argv[2] ?? "Raman";

const events = await (await fetch(`${API}/events`, { headers: { "x-dev-user": "pm" } })).json();
const eventId = events.items[0]?.id;
if (!eventId) throw new Error("no event — run npm run db:seed first");

const speakers = await (
  await fetch(`${API}/events/${eventId}/speakers?q=${encodeURIComponent(name)}`, {
    headers: { "x-dev-user": "pm" },
  })
).json();
const speakerId = speakers.items?.[0]?.id;

if (!speakerId) {
  console.error(`Could not find a speaker matching "${name}". Pass a name, e.g. npm run demo:link -- Osei`);
  process.exit(1);
}

const invite = await (
  await fetch(`${API}/speakers/${speakerId}/invite`, { method: "POST", headers: { "x-dev-user": "pm" } })
).json();
console.log(invite.url);
