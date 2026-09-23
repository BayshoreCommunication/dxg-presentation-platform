"use client";

import { useCallback, useEffect, useState } from "react";
import type { CommentRow } from "@/lib/api";
import { addComment, getComments, ApiError } from "@/lib/api";

const LANE: Record<string, { label: string; tone: string; audience: string }> = {
  internal: { label: "Internal", tone: "int", audience: "DXG staff only" },
  speaker_visible: { label: "To speaker", tone: "spk", audience: "shown to the speaker in their portal" },
  client_visible: { label: "Client lane", tone: "cli", audience: "client review lane" },
};

/**
 * The real comment thread for a talk (D-070), replacing two invented comments that
 * the review screen showed on every file. Covers every version of the talk, so the
 * note that sent v2 back is in front of whoever reviews v3.
 *
 * Writing offers the two audiences that reach someone today: internal (staff only) and
 * to the speaker (shown in the speaker portal). The client lane exists in the data but
 * no client surface shows per-talk comments yet, so it is not offered — a note written
 * there would go nowhere while looking sent.
 */
export function CommentsPanel({ versionId, versionNumber }: { versionId: string; versionNumber: number }) {
  const [comments, setComments] = useState<CommentRow[] | null>(null);
  const [lane, setLane] = useState<"internal" | "speaker_visible">("internal");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setComments((await getComments(versionId)).items);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "Could not load comments.");
    }
  }, [versionId]);

  useEffect(() => {
    setComments(null);
    setBody("");
    setError(null);
    void load();
  }, [load]);

  const submit = async () => {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await addComment(versionId, lane, body);
      setBody("");
      await load();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 12 }}>
      <div className="note" style={{ marginBottom: 4 }}>
        Comments on this presentation{comments && comments.length > 0 ? ` · ${comments.length}` : ""}
      </div>

      {comments === null ? (
        <div className="note">Loading…</div>
      ) : comments.length === 0 ? (
        <div className="note" style={{ marginBottom: 6 }}>
          No comments yet.
        </div>
      ) : (
        comments.map((comment) => {
          const lane = LANE[comment.lane] ?? LANE.internal!;
          return (
            <div className={`lane ${lane.tone}`} key={comment.id} style={{ whiteSpace: "pre-wrap" }}>
              <b>{comment.author ?? "Unknown"}</b>
              {comment.from_speaker ? " (speaker)" : ""}
              <span className="aud">{lane.label}</span>
              <span className="note">
                {" "}
                · v{comment.version_number}
                {comment.version_number !== versionNumber ? " (earlier version)" : ""} ·{" "}
                {new Date(comment.created_at).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <br />
              {comment.body}
            </div>
          );
        })
      )}

      <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 10, marginTop: 8 }}>
        <div role="radiogroup" aria-label="Who sees this comment" style={{ display: "flex", gap: 14, marginBottom: 6 }}>
          {(["internal", "speaker_visible"] as const).map((option) => (
            <label key={option} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13 }}>
              <input
                type="radio"
                name={`lane-${versionId}`}
                checked={lane === option}
                onChange={() => setLane(option)}
              />
              <b>{LANE[option]!.label}</b>
              <span className="note">— {LANE[option]!.audience}</span>
            </label>
          ))}
        </div>
        <textarea
          aria-label="Comment"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={lane === "internal" ? "A note for the DXG team…" : "A note the speaker will see in their portal…"}
          rows={3}
          maxLength={5000}
          style={{ width: "100%", resize: "vertical", font: "inherit" }}
          onKeyDown={(event) => {
            // Keep the review shortcuts (A / R) from firing while typing.
            event.stopPropagation();
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit();
          }}
        />
        {error && (
          <div className="err" style={{ margin: "6px 0 0" }}>
            {error}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
          <button type="button" className="btn" disabled={busy || !body.trim()} onClick={() => void submit()}>
            {busy ? "Adding…" : lane === "internal" ? "Add internal note" : "Send to speaker"}
          </button>
          <span className="note">⌘/Ctrl + Enter</span>
        </div>
      </div>
    </div>
  );
}
