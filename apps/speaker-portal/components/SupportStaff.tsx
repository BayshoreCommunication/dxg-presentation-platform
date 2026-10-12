import type { SupportStaffRow } from "@/lib/api";

/**
 * Speaker Support Staff (client review, D-156): the assistants who may submit this speaker's
 * presentations. The DXG team adds and removes them (Travis: "DXG-কে দিয়ে করাও"); the speaker
 * sees who they are here.
 */
export function SupportStaff({ rows, max }: { rows: SupportStaffRow[]; max: number }) {
  return (
    <>
      <h1 className="htitle">Support staff</h1>
      <p className="note" style={{ marginTop: -8 }}>
        People who may upload and update your presentations for you. They see your Manage presentations and nothing else —
        not your agenda, the Speaker Ready Room or your messages. Their uploads are yours.
      </p>

      <div className="card">
        <div className="chd">
          <h3>
            Your support staff · {rows.length} of {max}
          </h3>
        </div>
        <div className="cbd" style={{ padding: rows.length ? "0 0 4px" : undefined }}>
          {rows.length === 0 ? (
            <div className="empty">No support staff yet.</div>
          ) : (
            <table>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.user_id}>
                    <td>
                      <b>{row.name}</b> <span className="note">· {row.email}</span>
                    </td>
                    <td style={{ textAlign: "right" }} className="note">
                      {row.state === "invited" ? "Sign-in emailed — password not chosen yet" : "Active"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <p className="note">
        To add an assistant, or to take one off, ask the DXG team who invited you — tell them the assistant&rsquo;s name and
        email address.
      </p>
    </>
  );
}
