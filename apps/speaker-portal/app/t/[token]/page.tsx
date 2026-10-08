import Link from "next/link";

/**
 * The link from an older email carried an access code (D-016). Speakers now sign in with
 * their email address and a password (D-147, D-148): this page says so rather than
 * failing quietly, and points at the sign-in page.
 */
export default function TokenLink() {
  return (
    <div className="login">
      <div className="box">
        <b>DXG·PM</b>
        <div style={{ fontSize: 13, margin: "4px 0 18px" }}>This link is from an older email</div>
        <div className="note" style={{ marginBottom: 14, lineHeight: 1.6 }}>
          Speakers now sign in with their email address and a password. Your sign-in details were emailed
          to you by the DXG team — if you can&rsquo;t find them, ask the team who invited you and they will send
          them again.
        </div>
        <Link className="btn pri" style={{ width: "100%", display: "block", textAlign: "center" }} href="/login">
          Go to sign in
        </Link>
      </div>
    </div>
  );
}
