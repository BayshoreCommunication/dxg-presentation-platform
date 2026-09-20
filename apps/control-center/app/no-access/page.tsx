import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * Where a 403 lands. Signing in worked; the account simply has no role that grants
 * access to what it asked for. The most common way to arrive here is a brand-new
 * staff account on its first sign-in — the account is created before anyone gives it
 * a role — so the page says who can fix it and what they have to do, rather than
 * leaving someone staring at "forbidden".
 */
export default async function NoAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;

  return (
    <div className="card" style={{ maxWidth: 560, margin: "40px auto" }}>
      <div className="cbd">
        <h1 className="htitle" style={{ marginTop: 0 }}>
          You&rsquo;re signed in, but this area isn&rsquo;t open to your account
        </h1>

        {reason && (
          <div className="err" style={{ marginTop: 12 }}>
            {reason}
          </div>
        )}

        <p className="note" style={{ marginTop: 14, lineHeight: 1.6 }}>
          Your sign-in worked. What&rsquo;s missing is a <strong>role on an event</strong> — an
          account is created first and given its access separately, so a new account starts with
          none.
        </p>

        <p className="note" style={{ marginTop: 10, lineHeight: 1.6 }}>
          Ask a DXG administrator to open <strong>Staff accounts</strong>, find your name, and add
          the role you need. Sign out and back in once they have, and this will be waiting for you.
        </p>

        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <Link href="/" className="btn">
            Try again
          </Link>
          <Link href="/login?reason=switch" className="btn">
            Sign in as someone else
          </Link>
        </div>
      </div>
    </div>
  );
}
