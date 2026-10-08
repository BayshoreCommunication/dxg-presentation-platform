import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/SignOutButton";
import { getSession } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Where a 403 lands. Signing in worked; the account simply has no role that grants
 * access to what it asked for. The most common way to arrive here is a brand-new
 * staff account on its first sign-in — the account is created before anyone gives it
 * a role — so the page says who can fix it and what they have to do, rather than
 * leaving someone staring at "forbidden".
 */
export default async function NoAccessPage({ searchParams }: { searchParams: Promise<{ for?: string }> }) {
  // The API's refusal text is not shown: it named an event the person never picked, and
  // sent them to the wrong admin screen (D-108). The page says the one thing that is true.
  // A speaker account (D-146) that typed a staff address is not missing a role: its one
  // screen is Manage presentations, so it goes there instead of reading about Event assignments.
  const { principal } = await getSession().catch(() => ({ principal: null }));
  if (principal?.account_kind === "speaker") redirect("/presentations");
  const client = (await searchParams).for === "client";
  if (client) {
    return (
      <div className="card" style={{ maxWidth: 560, margin: "40px auto" }}>
        <div className="cbd">
          <h1 className="htitle" style={{ marginTop: 0 }}>
            No event has been shared with you yet
          </h1>
          <p className="note" style={{ marginTop: 14, lineHeight: 1.6 }}>
            Your sign-in worked. Your DXG contact will share your event with you — once they have,
            sign in again and it will be there.
          </p>
          {/* A27 (D-113): one real way out; "Check again" only came straight back here. */}
          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <SignOutButton className="btn pri" />
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="card" style={{ maxWidth: 560, margin: "40px auto" }}>
      <div className="cbd">
        <h1 className="htitle" style={{ marginTop: 0 }}>
          You haven&rsquo;t been added to an event yet
        </h1>

        <p className="note" style={{ marginTop: 14, lineHeight: 1.6 }}>
          Your account is set up and your sign-in worked. What&rsquo;s missing is access to an
          event: every DXG staff account is added to the events it works on separately.
        </p>

        <p className="note" style={{ marginTop: 10, lineHeight: 1.6 }}>
          Ask a DXG administrator to add you on <strong>Event assignments</strong>. Once they
          have, sign in again and your events will be there.
        </p>

        {/* A27 (D-113): one real way out; "Check again" only came straight back here. */}
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <SignOutButton className="btn pri" />
        </div>
      </div>
    </div>
  );
}
