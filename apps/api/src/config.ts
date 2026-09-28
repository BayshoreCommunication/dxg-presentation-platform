/**
 * Production configuration, checked before the API accepts a request (production readiness).
 *
 * In development every setting has a working default. In production a missing or unsafe
 * one is a failure found at the first send or the first upload — or never: links in every
 * email pointing at localhost, files on one server's disk, uploads unscanned. So with
 * NODE_ENV=production the API refuses to start, naming every problem at once.
 */
export function productionProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV !== "production") return [];
  const problems: string[] = [];
  const need = (name: string, why: string) => {
    if (!env[name]?.trim()) problems.push(`${name} is not set — ${why}`);
  };
  const httpsUrl = (name: string) => {
    const value = env[name]?.trim();
    if (!value) return;
    if (!/^https:\/\/[^/]+$/.test(value.replace(/\/$/, ""))) {
      problems.push(`${name} must be an https:// origin with no path (it is "${value}")`);
    }
  };

  need("STAFF_BASE", "the staff app's address, used in account emails and to allow its requests");
  need("PORTAL_BASE", "the speaker portal's address, used in every upload link");
  httpsUrl("STAFF_BASE");
  httpsUrl("PORTAL_BASE");
  need("PGHOST", "the database host");
  need("PGPASSWORD", "the application database password");
  if (env.FILE_STORAGE !== "s3") problems.push("FILE_STORAGE must be s3 — presentations must not live on one server's disk");
  need("S3_BUCKET", "where presentations, PDFs and archives are stored");
  need("CLAMAV_HOST", "uploads must be scanned by ClamAV");
  if ((env.MAIL_TRANSPORT ?? "ses") !== "ses") problems.push("MAIL_TRANSPORT must be ses in production");
  need("MAIL_FROM", "the address speaker email is sent from");
  if (env.TRUST_PROXY !== "1") {
    problems.push("TRUST_PROXY must be 1 — the API runs behind the web server, and sign-in throttling needs the real client address");
  }
  if (env.DEV_MFA_SECRET) problems.push("DEV_MFA_SECRET is a development authenticator secret and must not be set in production");
  return problems;
}

export function assertProductionConfig(): void {
  const problems = productionProblems();
  if (problems.length === 0) return;
  console.error(`[pmp] refusing to start — production configuration is incomplete:\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}

/**
 * A fixed-window limit per client address, for the endpoints someone would hammer: signing
 * in and asking for password resets. Per-account lockout already stops guessing one
 * password; this stops one address trying many accounts, or flooding reset email.
 * In memory, which is right for the one API server this runs as.
 */
export function rateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (key: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } => {
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      if (hits.size > 10_000) {
        for (const [stale, value] of hits) if (value.resetAt <= now) hits.delete(stale);
      }
      return { allowed: true, retryAfterSeconds: 0 };
    }
    entry.count += 1;
    return { allowed: entry.count <= limit, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
  };
}
