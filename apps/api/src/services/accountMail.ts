import type pg from "pg";

/**
 * Emails a staff member the temporary password an administrator just issued (D-100).
 *
 * The password used to be shown once on screen for the administrator to pass on by
 * hand, which put it in whatever chat carried it. It now goes straight to the account's
 * own address. The outbox row is marked `sensitive`, so the dispatcher replaces the body
 * once the mail has gone and the password does not sit in the database afterwards.
 * It still has to be changed at first sign-in, and an authenticator set up.
 */
export async function queueTemporaryPasswordEmail(
  tx: pg.PoolClient,
  input: {
    to: string;
    displayName: string;
    temporaryPassword: string;
    reason: "created" | "reset";
    accountType: "root_admin" | "staff";
  },
): Promise<void> {
  const signIn = `${process.env.STAFF_BASE ?? "http://localhost:3000"}/login`;
  const opening =
    input.reason === "created"
      ? [
          `A DXG·PM ${input.accountType === "root_admin" ? "root admin" : "staff"} account has been created for you.`,
          "Sign in with this email address and the temporary password below:",
        ]
      : [
          "An administrator has reset the password on your DXG·PM account, and any open sessions have been ended.",
          "Sign in with this temporary password:",
        ];

  await tx.query(`INSERT INTO pmp.outbox (topic, payload) VALUES ('email.send', $1)`, [
    JSON.stringify({
      to: input.to,
      subject: input.reason === "created" ? "Your DXG·PM account" : "Your DXG·PM password was reset",
      sensitive: true,
      body: [
        `Hi ${input.displayName},`,
        "",
        ...opening,
        "",
        `    ${input.temporaryPassword}`,
        "",
        signIn,
        "",
        "You will be asked to choose your own password straight away, and then to set up an",
        "authenticator app (such as Google Authenticator or 1Password) before you can use the platform.",
        "",
        "If you were not expecting this email, tell the DXG presentation team.",
        "",
        "The DXG presentation team",
      ].join("\n"),
    }),
  ]);
}
