"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { QueueItem } from "@/lib/api";
import { previewUrl, requestPreview, ApiError } from "@/lib/api";
import { SlideViewer } from "@/components/SlideViewer";

/**
 * The file's actual slides, for the reviewer (D-074) — replacing eight numbered
 * placeholder boxes that showed the same whatever was uploaded.
 *
 * The preview is the version's PDF, made by LibreOffice as soon as the upload is
 * scanned clean. While that runs (seconds, usually) the pane says so and re-checks; if it
 * fails, it says why and offers another try. A version uploaded before previews existed
 * is queued the first time it is opened.
 */
export function SlidePreview({ item }: { item: QueueItem }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const asked = useRef<string | null>(null);
  const state = item.pdf_state;

  // Never queued (uploaded before previews existed): ask for one, once per version.
  useEffect(() => {
    if (state !== null || asked.current === item.file_version_id) return;
    asked.current = item.file_version_id;
    requestPreview(item.file_version_id)
      .then(() => router.refresh())
      .catch((failure: unknown) => setError(failure instanceof ApiError ? failure.message : "Could not ask for a preview."));
  }, [state, item.file_version_id, router]);

  // While it is being made, look again every few seconds.
  const waiting = state === null || state === "queued" || state === "converting";
  useEffect(() => {
    if (!waiting) return;
    const handle = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(handle);
  }, [waiting, router]);

  const frame: React.CSSProperties = {
    width: "100%",
    height: 540,
    border: "1px solid var(--line)",
    borderRadius: 6,
    background: "var(--mist)",
  };

  if (state === "done") {
    const src = previewUrl(item.file_version_id);
    return (
      <div>
        {/* Thumbnails on the left, the slide large on the right (D-075). */}
        <SlideViewer key={item.file_version_id} url={src} title={`${item.title}, version ${item.version_number}`} />
        <div className="note" style={{ marginTop: 4 }}>
          Rendered from the uploaded file — fonts and video can differ slightly from PowerPoint.{" "}
          <a href={src} target="_blank" rel="noreferrer">
            Open as PDF ↗
          </a>
        </div>
      </div>
    );
  }

  if (state === "failed") {
    return (
      <div style={{ ...frame, height: "auto", padding: 16 }}>
        <b>No preview for this file.</b>
        <div className="note" style={{ margin: "4px 0 10px" }}>
          {item.pdf_error ?? "The conversion failed."}
        </div>
        {error && <div className="err">{error}</div>}
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            requestPreview(item.file_version_id)
              .then(() => router.refresh())
              .catch((failure: unknown) => setError(failure instanceof ApiError ? failure.message : "Could not retry."))
              .finally(() => setBusy(false));
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div
      style={{ ...frame, height: 180, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }}
      role="status"
    >
      <b>Preparing the slide preview…</b>
      <span className="note">Usually a few seconds. This updates on its own.</span>
      {error && (
        <div className="err" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
    </div>
  );
}
