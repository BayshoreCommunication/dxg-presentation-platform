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

/*
 * ── coordinating the second factor across processes ─────────────────────────
 *
 * `mfa_last_counter` is per account, and the server refuses a code whose step it has
 * already accepted. Six invariant suites sign in as `admin@example.invalid`, and
 * `node --test` runs each file in its own process — so the module-level bookkeeping
 * below cannot see the others, and two suites starting in the same 30-second step
 * collide. `signInStaff` retried, but with six processes the retries collide too: one
 * run burned 69 seconds and still failed five tests.
 *
 * The step each account last consumed is recorded in a file instead, guarded by an
 * exclusive-create mutex. A process waits only until the step moves past the one
 * already spent — usually seconds, not a full window — and the wait happens while
 * holding the lock, so two processes cannot pick the same step.
 */
const COORD_DIR = ".data/test-mfa";
const STEP_NOW = () => Math.floor(Date.now() / 1000 / 30);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Held only for the moment it takes to claim a step; stale locks are broken. */
async function withStepLock<T>(account: string, fn: () => Promise<T>): Promise<T> {
  const { mkdir, open, readFile, writeFile, stat, unlink } = await import("node:fs/promises");
  await mkdir(COORD_DIR, { recursive: true });
  const key = account.replace(/[^a-z0-9]+/gi, "_");
  const lock = `${COORD_DIR}/${key}.lock`;
  const ledger = `${COORD_DIR}/${key}.step`;

  /*
   * The ceiling has to clear a *legitimate* queue, which is one 30-second window per
   * process sharing this account — the holder waits out the spent step while holding
   * the lock, so N contenders cost N windows. Eight suites now sign in as
   * `admin@example.invalid`, so the old 600 × 250 ms = 150 s ceiling was under half of
   * the 240 s that queue can honestly take, and the two suites added on 2026-09-21
   * tipped it over: "could not claim an authenticator step", which reads like a
   * deadlock and is simply the queue being longer than the patience.
   *
   * A crashed holder is *not* what this bounds — the 60-second staleness check below
   * is, and it is unaffected by how long we are willing to queue. So the ceiling is
   * set well clear of any plausible queue rather than trimmed to it.
   */
  const deadline = Date.now() + 8 * 60_000;
  while (Date.now() < deadline) {
    try {
      const handle = await open(lock, "wx");
      await handle.close();
      try {
        const spent = Number((await readFile(ledger, "utf8").catch(() => "0")).trim()) || 0;
        // Wait out only what is actually spent, not a whole window on principle.
        while (STEP_NOW() <= spent) await sleep(500);
        await writeFile(ledger, String(STEP_NOW()), "utf8");
        return await fn();
      } finally {
        await unlink(lock).catch(() => undefined);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Someone crashed holding it: a lock older than two windows is not real.
      const age = await stat(lock)
        .then((info) => Date.now() - info.mtimeMs)
        .catch(() => 0);
      if (age > 60_000) await unlink(lock).catch(() => undefined);
      await sleep(250);
    }
  }
  throw new Error(`could not claim an authenticator step for ${account}`);
}

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

    /*
     * Claiming the step and spending it happen together, under the lock: picking a code
     * and then racing another process to the server is the collision this exists to
     * prevent.
     */
    const second = await withStepLock(email, () =>
      fetch(`${api}/auth/mfa/verify`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookieFrom(first) },
        body: JSON.stringify({ code: totp(DEV_MFA_SECRET) }),
      }),
    );
    if (second.ok) return cookieFrom(second);

    const detail = (await second.json().catch(() => ({}))) as { code?: string; message?: string };
    lastReason = `${second.status} ${detail.code ?? "unknown"}`;

    /*
     * Another test file got this account's counter first. Wait out the step and take
     * the next one — the loser of the race retries rather than reporting a failure
     * that says nothing about the code under test.
     */
    if (attempt < attempts) await sleep((30 - ((Date.now() / 1000) % 30)) * 1000 + 250);
  }

  throw new Error(
    `sign-in failed for ${email} after ${attempts} attempts: ${lastReason} — second factor`,
  );
}
