import { signInStaff } from "./signIn.ts";

/** C. Delgado, a seeded DXG Technician staff account. */
export const DELGADO_ID = "33333333-3333-4333-8333-333333333332";

/**
 * Taking in a file for a speaker is DXG Technician staff's alone (D-162), so a suite that
 * uploads on a probe event places the seeded technician on it — the way DXG does, under
 * Event assignments — and acts as them for the upload.
 */
export async function technicianOn(api: string, admin: string, eventId: string): Promise<string> {
  await placeTechnician(api, admin, eventId);
  return signInStaff(api, "c.delgado@example.invalid", "dxg-development-password");
}

/**
 * Places the seeded technician on the event without signing in as them: a check-in names the
 * technician who helps the speaker, and they must be on the event (D-169). Returns their id.
 */
export async function placeTechnician(api: string, admin: string, eventId: string): Promise<string> {
  const placed = await fetch(`${api}/admin/users/${DELGADO_ID}/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: admin },
    body: JSON.stringify({ event_id: eventId, assign: true }),
  });
  if (!placed.ok) throw new Error(`could not place the technician on ${eventId}: ${placed.status}`);
  return DELGADO_ID;
}
