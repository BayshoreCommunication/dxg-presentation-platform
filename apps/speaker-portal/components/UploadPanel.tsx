"use client";

import { useRef, useState } from "react";
import {
  beginUpload,
  getUploadState,
  putPart,
  completeUpload,
  sha256Hex,
  PortalError,
} from "@/lib/api";
import type { CompleteResult, UploadSession } from "@/lib/api";
import { formatBytes } from "@pmp/format";

type Phase = "idle" | "selected" | "hashing" | "uploading" | "paused" | "completing" | "done" | "failed";

/**
 * Resumable multipart upload (FR-FILE-002/003, NFR-PERF-02). Parts are uploaded
 * one at a time and the server records each; on resume the client asks which
 * parts already landed and continues from there — never from zero.
 *
 * Choosing (or dropping) a file only selects it: the speaker sees its name and size and
 * submits deliberately. Picking a file used to start the upload at once, so a wrong
 * click became a new version the team would then review.
 */
export function UploadPanel({
  slotId,
  onComplete,
}: {
  slotId: string;
  onComplete: (result: CompleteResult) => Promise<void>;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<UploadSession | null>(null);
  const [sent, setSent] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const pausedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function select(chosen: File) {
    setError(null);
    setFile(chosen);
    setPhase("selected");
  }

  function clearSelection() {
    setFile(null);
    setPhase("idle");
    // Lets the same file be chosen again after a cancel.
    if (inputRef.current) inputRef.current.value = "";
  }

  const totalParts = (session: UploadSession) => Math.max(1, Math.ceil(session.total_bytes / session.part_size));

  async function sendParts(chosen: File, session: UploadSession, alreadyHave: number[]) {
    const total = totalParts(session);
    for (let part = 1; part <= total; part += 1) {
      if (pausedRef.current) {
        setPhase("paused");
        setMessage(
          `Paused at ${Math.round((alreadyHave.length / total) * 100)}% — the ${formatBytes(
            alreadyHave.length * session.part_size,
          )} already uploaded is saved.`,
        );
        return false;
      }
      if (alreadyHave.includes(part)) continue;
      const start = (part - 1) * session.part_size;
      const chunk = await chosen.slice(start, start + session.part_size).arrayBuffer();
      await putPart(session.upload_id, part, chunk);
      alreadyHave.push(part);
      setSent(alreadyHave.length);
    }
    return true;
  }

  async function start(chosen: File) {
    setError(null);
    setFile(chosen);
    setPhase("hashing");
    setMessage("Checking the file…");
    try {
      const digest = await sha256Hex(chosen);
      const session = await beginUpload({
        slot_id: slotId,
        file_name: chosen.name,
        total_bytes: chosen.size,
      });
      setUpload(session);
      setPhase("uploading");
      setMessage(null);
      pausedRef.current = false;

      const finished = await sendParts(chosen, session, []);
      if (!finished) return;

      setPhase("completing");
      setMessage("Verifying checksum and running automated checks…");
      const result = await completeUpload(session.upload_id, {
        slot_id: slotId,
        file_name: chosen.name,
        sha256: digest,
      });
      setPhase("done");
      setMessage(null);
      await onComplete(result);
    } catch (caught) {
      setPhase("failed");
      setError(caught instanceof PortalError ? caught.message : "The upload failed. Nothing was stored.");
    }
  }

  async function resume() {
    if (!file || !upload) return;
    setError(null);
    pausedRef.current = false;
    setPhase("uploading");
    try {
      // Ask the server what it already has, rather than assuming.
      const state = await getUploadState(upload.upload_id);
      setMessage(`Resumed from ${formatBytes(state.bytes)} — not from zero.`);
      setSent(state.received.length);
      const finished = await sendParts(file, upload, [...state.received]);
      if (!finished) return;

      setPhase("completing");
      const digest = await sha256Hex(file);
      const result = await completeUpload(upload.upload_id, {
        slot_id: slotId,
        file_name: file.name,
        sha256: digest,
      });
      setPhase("done");
      setMessage(null);
      await onComplete(result);
    } catch (caught) {
      setPhase("failed");
      setError(caught instanceof PortalError ? caught.message : "The upload failed. Nothing was stored.");
    }
  }

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept=".pptx,.ppt,.pdf,.key"
      style={{ display: "none" }}
      onChange={(event) => {
        const chosen = event.target.files?.[0];
        if (chosen) select(chosen);
      }}
    />
  );

  const percent =
    upload && totalParts(upload) > 0 ? Math.min(100, Math.round((sent / totalParts(upload)) * 100)) : 0;

  if (phase === "selected" && file) {
    return (
      <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13 }}>
          <span className="mono" style={{ overflowWrap: "anywhere" }}>
            {file.name}
          </span>
          <span className="mono num">{formatBytes(file.size)}</span>
        </div>
        <div className="note" style={{ margin: "6px 0 12px" }}>
          Check this is the right file, then submit it. Nothing has been uploaded yet.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn pri" onClick={() => void start(file)}>
            Submit presentation
          </button>
          <button className="btn" onClick={() => inputRef.current?.click()}>
            Choose a different file
          </button>
          <button className="btn" onClick={clearSelection}>
            Cancel
          </button>
        </div>
        {fileInput}
      </div>
    );
  }

  if (phase === "idle" || phase === "failed") {
    return (
      <>
        {error && <div className="err">{error}</div>}
        <div
          style={{
            border: `2px dashed ${dragging ? "var(--blue)" : "var(--line)"}`,
            borderRadius: 10,
            padding: 26,
            textAlign: "center",
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const dropped = event.dataTransfer.files?.[0];
            if (dropped) select(dropped);
          }}
        >
          <b>Drag your presentation here</b>
          <div className="note" style={{ margin: "4px 0 10px" }}>
            PPTX preferred · up to 10 GB · uploads resume automatically if your connection drops
          </div>
          {fileInput}
          <button className="btn pri" onClick={() => inputRef.current?.click()}>
            Choose file…
          </button>
        </div>
      </>
    );
  }

  // The card shows the uploaded file once the list reloads; there is nothing to offer here.
  if (phase === "done") return null;


  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
        <span className="mono">{file?.name}</span>
        <span className="mono num">{formatBytes(file?.size ?? 0)}</span>
      </div>
      <div className="bar blue" style={{ margin: "10px 0 6px" }}>
        <i style={{ width: `${phase === "completing" ? 100 : percent}%` }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="note" style={phase === "paused" ? { color: "#8A5A12" } : undefined}>
          {message ??
            (phase === "hashing"
              ? "Checking the file…"
              : phase === "completing"
                ? "Verifying checksum and running automated checks…"
                : `${percent}% · resumable`)}
        </span>
        {phase === "uploading" && (
          <button
            className="btn"
            onClick={() => {
              pausedRef.current = true;
            }}
          >
            Simulate connection loss
          </button>
        )}
        {phase === "paused" && (
          <button className="btn pri" onClick={() => void resume()}>
            Resume upload
          </button>
        )}
      </div>
    </div>
  );
}

