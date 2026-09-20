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
 *
 * **This only serialises within one process.** Node runs each test file in its own,
 * so two files signing in as the same account in the same 30-second step still
 * collide — and `mfa_last_counter` is per account, so sharing
 * `admin@example.invalid` across four call sites is exactly the case that collides.
 * `signInStaff` handles the loser of that race by waiting for the next step and
 * trying again; this function alone cannot, because it cannot see the other process.
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
  // Three attempts spans a little over a minute of steps, which is far more than any
  // realistic pile-up of suites contending for the same account.
  const attempts = 3;
  let lastReason = "";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const first = await fetch(`${api}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!first.ok) {
      // A rejected password is not a race and will not improve with waiting.
      const detail = (await first.json().catch(() => ({}))) as { code?: string };
      throw new Error(
        `sign-in failed for ${email}: ${first.status} ${detail.code ?? "unknown"} — password step`,
      );
    }

    const body = (await first.json()) as { step?: string };
    if (body.step === "signed_in") return cookieFrom(first);

    const second = await fetch(`${api}/auth/mfa/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieFrom(first) },
      body: JSON.stringify({ code: await freshCode() }),
    });
    if (second.ok) return cookieFrom(second);

    const detail = (await second.json().catch(() => ({}))) as { code?: string; message?: string };
    lastReason = `${second.status} ${detail.code ?? "unknown"}`;

    /*
     * Another test file got this account's counter first. Wait out the step and take
     * the next one — the loser of the race retries rather than reporting a failure
     * that says nothing about the code under test.
     */
    if (attempt < attempts) {
      await new Promise((resolve) =>
        setTimeout(resolve, (30 - ((Date.now() / 1000) % 30)) * 1000 + 250),
      );
    }
  }

  throw new Error(
    `sign-in failed for ${email} after ${attempts} attempts: ${lastReason} — second factor`,
  );
}
