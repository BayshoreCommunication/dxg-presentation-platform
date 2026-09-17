/**
 * Prints a fresh speaker-portal link for the demo (production sends these by
 * email, M3-5). Searches every event the user can see, so creating another
 * event does not change which speaker is found.
 *
 *   npm run demo:link            # first speaker with an email
 *   npm run demo:link -- Osei    # by name, organisation or email
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const query = process.argv[2] ?? "";
const headers = { "x-dev-user": "pm" };

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

const invite = await (
  await fetch(`${API}/speakers/${found.speaker.id}/invite`, { method: "POST", headers })
).json();

console.error(`${found.speaker.full_name} · ${found.event.name}`);
console.log(invite.url);
