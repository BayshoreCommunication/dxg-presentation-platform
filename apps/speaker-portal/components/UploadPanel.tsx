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

type Phase = "idle" | "hashing" | "uploading" | "paused" | "completing" | "done" | "failed";

/**
 * Resumable multipart upload (FR-FILE-002/003, NFR-PERF-02). Parts are uploaded
 * one at a time and the server records each; on resume the client asks which
 * parts already landed and continues from there — never from zero.
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
  const pausedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const percent =
    upload && totalParts(upload) > 0 ? Math.min(100, Math.round((sent / totalParts(upload)) * 100)) : 0;

  if (phase === "idle" || phase === "failed") {
    return (
      <>
        {error && <div className="err">{error}</div>}
        <div style={{ border: "2px dashed var(--line)", borderRadius: 10, padding: 26, textAlign: "center" }}>
          <b>Drag your presentation here</b>
          <div className="note" style={{ margin: "4px 0 10px" }}>
            PPTX preferred · up to 10 GB · uploads resume automatically if your connection drops
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".pptx,.ppt,.pdf,.key"
            style={{ display: "none" }}
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              if (chosen) void start(chosen);
            }}
          />
          <button className="btn pri" onClick={() => inputRef.current?.click()}>
            Choose file…
          </button>
        </div>
      </>
    );
  }

  if (phase === "done") {
    return (
      <div>
        <button
          className="btn"
          onClick={() => {
            setPhase("idle");
            setUpload(null);
            setSent(0);
          }}
        >
          Replace file
        </button>
      </div>
    );
  }

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

const formatBytes = (bytes: number): string =>
  bytes >= 1_000_000_000
    ? `${(bytes / 1_000_000_000).toFixed(1)} GB`
    : `${Math.round(bytes / 1_000_000)} MB`;
