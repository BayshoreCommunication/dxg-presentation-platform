"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DuplicatePair, SpeakerRow } from "@/lib/api";
import { getSpeakers, mergeSpeakers, inviteSpeaker, remindSpeakersWithoutFiles, ApiError } from "@/lib/api";
import { Chip } from "@/components/Chip";

/** Screen 5 — the speaker directory, its duplicates, and the chase list. */
export function SpeakersView({
  eventId,
  initial,
  duplicates,
}: {
  eventId: string;
  initial: SpeakerRow[];
  duplicates: DuplicatePair[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function search(next: string) {
    setQuery(next);
    try {
      const { items } = await getSpeakers(eventId, next);
      setRows(items);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Search failed.");
    }
  }

  const missing = rows.filter((row) => row.with_files === 0);

  function statusOf(row: SpeakerRow): { status: string; label: string } {
    if (row.talks === 0) return { status: "canceled", label: "No talks" };
    if (row.with_files === 0) return { status: "missing", label: "Not submitted" };
    if (row.approved >= row.talks) return { status: "synchronized_onsite", label: "Approved" };
    return { status: "submitted", label: "Submitted" };
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h1 className="htitle" style={{ margin: 0 }}>
          Speakers · {rows.length}
        </h1>
        <span style={{ display: "flex", gap: 8 }}>
          {/*
            It sends now. This said "Reminder queued to the N speakers without a
            file" and queued nothing — the handler only set the toast — so the one
            thing on the screen that claimed an action had happened was the one thing
            that had not. It reports what actually happened instead, including the
            recipients the send refused and why.
          */}
          <button
            className="btn"
            disabled={busy || missing.length === 0}
            onClick={() => {
              setBusy(true);
              setError(null);
              setToast(null);
              void (async () => {
                try {
                  const result = await remindSpeakersWithoutFiles(eventId);
                  const skipped = result.skipped
                    .map((entry) => `${entry.count} ${entry.reason}`)
                    .join(" · ");
                  setToast(
                    result.queued === 0 && skipped
                      ? `Nobody was emailed — ${skipped}`
                      : `Reminder sent to ${result.queued} speaker${result.queued === 1 ? "" : "s"}` +
                          (skipped ? ` · skipped: ${skipped}` : ""),
                  );
                  // The log and the delivery counters live on Communications.
                  router.refresh();
                } catch (caught) {
                  setError(caught instanceof ApiError ? caught.message : "The reminder could not be sent.");
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            Bulk remind ({missing.length})
          </button>
          <button className="btn pri" disabled title="Add speaker — M1-8">
            + Add speaker
          </button>
        </span>
      </div>

      {error && <div className="err">{error}</div>}

      {duplicates.length > 0 && (
        <div className="card" style={{ borderColor: "var(--warn)" }}>
          <div className="chd">
            <h3>Possible duplicates · {duplicates.length}</h3>
            <span className="m">merging preserves both file histories and every assignment</span>
          </div>
          <div className="cbd" style={{ padding: "0 0 4px" }}>
            <table>
              <tbody>
                {duplicates.map((pair) => (
                  <tr key={`${pair.a_id}-${pair.b_id}`}>
                    <td>
                      <b>{pair.a_name}</b> <span className="note">{pair.a_email}</span>
                      {" ↔ "}
                      <b>{pair.b_name}</b> <span className="note">{pair.b_email}</span>
                      <br />
                      <span className="note">matched on {pair.reason}</span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="btn"
                        disabled={busy}
                        onClick={() => {
                          setBusy(true);
                          void mergeSpeakers(pair.b_id, pair.a_id)
                            .then(() => {
                              setToast(`Merged into ${pair.a_name} — assignments and history preserved`);
                              router.refresh();
                            })
                            .catch((caught: unknown) =>
                              setError(caught instanceof ApiError ? caught.message : "Merge failed."),
                            )
                            .finally(() => setBusy(false));
                        }}
                      >
                        Merge into {pair.a_name}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <div className="cbd" style={{ borderBottom: "1px solid var(--line)" }}>
          <input
            style={{ width: "100%" }}
            placeholder={`Search ${initial.length} speakers by name, organization or email…`}
            value={query}
            onChange={(event) => void search(event.target.value)}
          />
        </div>
        <div className="cbd" style={{ padding: "0 0 4px" }}>
          {rows.length === 0 ? (
            <div className="empty">No speaker matches “{query}”.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Speaker</th>
                  <th>Organization</th>
                  <th>Talks</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const status = statusOf(row);
                  return (
                    <tr key={row.id}>
                      <td>
                        <b>{row.full_name}</b>
                        <br />
                        <span className="note mono">{row.email ?? "no email"}</span>
                      </td>
                      <td>{row.organization ?? "—"}</td>
                      <td className="num">{row.talks}</td>
                      <td>
                        <Chip status={status.status} label={status.label} />
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          className="btn"
                          style={{ padding: "4px 10px" }}
                          disabled={busy || !row.email}
                          onClick={() => {
                            setBusy(true);
                            void inviteSpeaker(row.id)
                              .then((invite) => setToast(`Upload link issued · ${invite.url}`))
                              .catch(() => setError("Could not issue a link."))
                              .finally(() => setBusy(false));
                          }}
                        >
                          Send upload link
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className={`toast ${toast ? "show" : ""}`} style={{ maxWidth: "80vw" }}>
        {toast}
      </div>
    </>
  );
}
