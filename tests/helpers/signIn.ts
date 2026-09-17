import { totp } from "@pmp/auth";

/** The development authenticator secret the seed enrols staff accounts with. */
export const DEV_MFA_SECRET = process.env.DEV_MFA_SECRET ?? "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

export const cookieFrom = (response: Response): string =>
  (response.headers.getSetCookie?.() ?? [])
    .map((entry) => entry.split(";")[0])
    .filter((entry) => !entry.endsWith("="))
    .join("; ");

let lastCounterIssued: number | null = null;
let startedAtStep: number | null = null;

/**
 * Hands back a code from a step this helper has not used before. The server
 * refuses a replayed code — correctly — so sequential tests signing in within
 * the same 30-second window would otherwise fail each other.
 */
export async function freshCode(secret = DEV_MFA_SECRET): Promise<string> {
  const step = () => Math.floor(Date.now() / 1000 / 30);
  const wait = () =>
    new Promise((resolve) => setTimeout(resolve, (30 - ((Date.now() / 1000) % 30)) * 1000 + 250));

  // The server refuses a code whose step it has already accepted, and that state
  // outlives the test run. Waiting for a step boundary on first use guarantees a
  // counter higher than anything a previous run consumed, so re-running the
  // suite immediately is deterministic rather than a coin flip.
  if (startedAtStep === null) {
    startedAtStep = step();
    await wait();
  }

  // Not worth issuing a code with under three seconds left on it either.
  if ((Date.now() / 1000) % 30 > 27) await wait();
  while (lastCounterIssued !== null && step() === lastCounterIssued) await wait();

  lastCounterIssued = step();
  return totp(secret);
}

/**
 * Signs a staff account in through both factors and returns the session cookie.
 * Staff sign-in is two steps now, so tests have to walk both.
 */
export async function signInStaff(
  api: string,
  email: string,
  password: string,
): Promise<string> {
  const first = await fetch(`${api}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!first.ok) return "";

  const body = (await first.json()) as { step?: string };
  if (body.step === "signed_in") return cookieFrom(first);

  const second = await fetch(`${api}/auth/mfa/verify`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieFrom(first) },
    body: JSON.stringify({ code: await freshCode() }),
  });
  return second.ok ? cookieFrom(second) : "";
}
