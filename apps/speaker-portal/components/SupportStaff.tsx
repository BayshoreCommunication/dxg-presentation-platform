"use client";

import { useCallback, useState } from "react";
import type { SupportStaffRow } from "@/lib/api";
import { addSupportStaff, getSupportStaff, PortalError, removeSupportStaff } from "@/lib/api";
import { Icon } from "@/components/Icon";
import { Toast } from "@/components/Toast";

/**
 * Speaker Support Staff (client review, D-155): a speaker gives an assistant their own sign-in
 * to submit presentations for them. The assistant sees this speaker's Manage presentations —
 * upload, update, download — and nothing else on the site.
 */
export function SupportStaff({ initial, max }: { initial: SupportStaffRow[]; max: number }) {
  const [rows, setRows] = useState(initial);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const closeToast = useCallback(() => setToast(null), []);

  async function run(work: () => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      setToast(await work());
      setRows((await getSupportStaff()).items);
    } catch (caught) {
      setError(caught instanceof PortalError ? caught.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const full = rows.length >= max;

  return (
    <>
      <h1 className="htitle">Support staff</h1>
      <p className="note" style={{ marginTop: -8 }}>
        Give an assistant their own sign-in to upload and update your presentations for you. They see your Manage
        presentations and nothing else — not your agenda, the Speaker Ready Room or your messages.
      </p>

      {error && <div className="err">{error}</div>}

      <div className="card">
        <div className="chd">
          <h3>
            Your support staff · {rows.length} of {max}
          </h3>
        </div>
        <div className="cbd" style={{ padding: rows.length ? "0 0 4px" : undefined }}>
          {rows.length === 0 ? (
            <div className="empty">No support staff yet. Add your assistant below.</div>
          ) : (
            <table>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.user_id}>
                    <td>
                      <b>{row.name}</b> <span className="note">· {row.email}</span>
                      <div className="note" style={{ marginTop: 2 }}>
                        {row.state === "invited"
                          ? "Sign-in emailed — they haven't chosen their password yet."
                          : "Active — they can submit your presentations."}
                      </div>
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {confirming === row.user_id ? (
                        <>
                          <button
                            type="button"
                            className="btn danger"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await removeSupportStaff(row.user_id);
                                setConfirming(null);
                                return `${row.name} can no longer sign in`;
                              })
                            }
                          >
                            <Icon name="trash" />
                            Remove {row.name}
                          </button>{" "}
                          <button type="button" className="btn" onClick={() => setConfirming(null)}>
                            Keep
                          </button>
                        </>
                      ) : (
                        <button type="button" className="btn" disabled={busy} onClick={() => setConfirming(row.user_id)}>
                          <Icon name="trash" />
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <div className="chd">
          <h3>Add support staff</h3>
        </div>
        <form
          className="cbd"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const added = await addSupportStaff(name, email);
              setName("");
              setEmail("");
              return `Sign-in emailed to ${added.email}`;
            });
          }}
        >
          <div className="field">
            <label htmlFor="support-name">Their name</label>
            <input id="support-name" style={{ width: "100%" }} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="support-email">Their email address</label>
            <input
              id="support-email"
              type="email"
              style={{ width: "100%" }}
              maxLength={120}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <p className="note" style={{ marginTop: 0 }}>
            We email them a temporary password; they choose their own when they first sign in.
          </p>
          <button type="submit" className="btn pri" disabled={busy || full || !name.trim() || !email.trim()} title={full ? `Up to ${max} support staff` : undefined}>
            <Icon name="send" />
            {busy ? "Sending…" : "Add and email their sign-in"}
          </button>
        </form>
      </div>

      <Toast message={toast} onClose={closeToast} />
    </>
  );
}
