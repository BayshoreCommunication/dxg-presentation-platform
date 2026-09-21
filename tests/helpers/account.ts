import { totp } from "@pmp/auth";
import { cookieFrom, freshCode } from "./signIn.ts";

/**
 * Creates a staff account and walks it all the way to a usable session.
 *
 * Suites that test event scoping need an actor holding a role on one event and none
 * on another, and every seeded account holds a role on the event that carries all the
 * content — so the only honest way to test "this account is not on that event" is to
 * make an account that genuinely is not. The account is created the way the product
 * creates one: a password that must be changed on first use, and MFA enrolled before
 * anything else is reachable (D-017).
 */
export async function createStaffAccount(
  api: string,
  admin: string,
  input: { email: string; displayName: string; password: string },
): Promise<{ userId: string; cookie: string; secret: string }> {
  const json = (cookie: string) => ({ "content-type": "application/json", cookie });
  const initial = "dxg-development-password";

  const created = (await (
    await fetch(`${api}/admin/users`, {
      method: "POST",
      headers: json(admin),
      body: JSON.stringify({ email: input.email, display_name: input.displayName, password: initial }),
    })
  ).json()) as { user_id?: string; code?: string; message?: string };
  if (!created.user_id) {
    throw new Error(`could not create ${input.email}: ${created.code} ${created.message}`);
  }

  // First sign-in: the account exists but must change the password it was handed.
  const first = await fetch(`${api}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: input.email, password: initial }),
  });
  await fetch(`${api}/auth/password`, {
    method: "POST",
    headers: json(cookieFrom(first)),
    body: JSON.stringify({ current_password: initial, new_password: input.password }),
  });

  const second = await fetch(`${api}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: input.email, password: input.password }),
  });
  let cookie = cookieFrom(second);

  // Enrolment: the secret comes back in the clear, so the suite can act as the
  // authenticator app would.
  const enrolment = (await (
    await fetch(`${api}/auth/mfa/start`, { method: "POST", headers: json(cookie) })
  ).json()) as { secret: string };
  const confirmed = await fetch(`${api}/auth/mfa/confirm`, {
    method: "POST",
    headers: json(cookie),
    body: JSON.stringify({ code: totp(enrolment.secret) }),
  });
  if (!confirmed.ok) {
    throw new Error(`could not enrol ${input.email}: ${confirmed.status}`);
  }
  cookie = cookieFrom(confirmed) || cookie;

  return { userId: created.user_id, cookie, secret: enrolment.secret };
}

/** Signs an account created by `createStaffAccount` back in, second factor and all. */
export async function signInWithSecret(
  api: string,
  email: string,
  password: string,
  secret: string,
): Promise<string> {
  const first = await fetch(`${api}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await first.json()) as { step?: string };
  if (body.step === "signed_in") return cookieFrom(first);

  const second = await fetch(`${api}/auth/mfa/verify`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieFrom(first) },
    body: JSON.stringify({ code: await freshCode(secret) }),
  });
  if (!second.ok) throw new Error(`second factor refused for ${email}: ${second.status}`);
  return cookieFrom(second);
}

/** Grants a role on one event, which is the only place roles exist (D-025). */
export async function grantRole(
  api: string,
  admin: string,
  userId: string,
  eventId: string,
  role: string,
): Promise<void> {
  const response = await fetch(`${api}/admin/users/${userId}/roles`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: admin },
    body: JSON.stringify({ event_id: eventId, role, grant: true }),
  });
  if (!response.ok) throw new Error(`could not grant ${role}: ${response.status}`);
}
