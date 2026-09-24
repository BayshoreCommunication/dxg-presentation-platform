"use client";

import { useRef, useState } from "react";
import { ApiError, assetUrl, removeAsset, uploadAsset } from "@/lib/api";
import type { AssetKind, BrandAsset } from "@/lib/api";

const COPY: Record<AssetKind, { accept: string; hint: string; choose: string }> = {
  header: {
    accept: "image/png,image/jpeg,image/webp",
    hint: "PNG, JPEG or WebP · up to 5 MB · shown across the top of the speaker portal. A wide image works best (about 1600 × 400).",
    choose: "Upload header…",
  },
  template: {
    accept: ".pptx,.potx,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.presentationml.template",
    hint: "PowerPoint .pptx or .potx · up to 50 MB · speakers download it from the portal to build their deck.",
    choose: "Upload template…",
  },
};

const size = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Reads an asset out of an event's `branding` (D-093), or null. */
export function assetFrom(branding: Record<string, unknown> | undefined, kind: AssetKind): BrandAsset | null {
  const value = branding?.[kind];
  return value && typeof value === "object" && typeof (value as BrandAsset).file_name === "string"
    ? (value as BrandAsset)
    : null;
}

/**
 * One of the event's two brand files (D-093): the header image, previewed, or the slide
 * template, downloadable. Uploading saves straight away — there is no separate save —
 * because the file is the whole change; uploading again replaces it.
 */
export function BrandAssetField({
  eventId,
  kind,
  initial,
  disabled = false,
}: {
  eventId: string;
  kind: AssetKind;
  initial: BrandAsset | null;
  disabled?: boolean;
}) {
  const [asset, setAsset] = useState<BrandAsset | null>(initial);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const copy = COPY[kind];

  const upload = async (file: File) => {
    setBusy("upload");
    setError(null);
    try {
      setAsset(await uploadAsset(eventId, kind, file));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The file could not be uploaded.");
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  };

  const remove = async () => {
    setBusy("remove");
    setError(null);
    try {
      await removeAsset(eventId, kind);
      setAsset(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "It could not be removed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <input
        ref={input}
        type="file"
        accept={copy.accept}
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />

      {asset && kind === "header" && (
        <img
          src={assetUrl(eventId, "header", asset.uploaded_at)}
          alt="Event header"
          style={{
            display: "block",
            width: "100%",
            aspectRatio: "4 / 1",
            objectFit: "cover",
            borderRadius: 10,
            border: "1px solid var(--line)",
            marginBottom: 8,
            background: "var(--muted)",
          }}
        />
      )}

      {asset ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="mono" style={{ overflowWrap: "anywhere", flex: "1 1 100%", minWidth: 0 }}>
            {asset.file_name} <span className="note">· {size(asset.size_bytes)}</span>
          </span>
          {kind === "template" && (
            <a className="btn" href={assetUrl(eventId, "template", asset.uploaded_at)}>
              Download
            </a>
          )}
          <button type="button" className="btn" disabled={disabled || busy !== null} onClick={() => input.current?.click()}>
            {busy === "upload" ? "Uploading…" : "Replace"}
          </button>
          <button type="button" className="btn" disabled={disabled || busy !== null} onClick={() => void remove()}>
            {busy === "remove" ? "Removing…" : "Remove"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn"
          style={{ width: "100%" }}
          disabled={disabled || busy !== null}
          onClick={() => input.current?.click()}
        >
          {busy === "upload" ? "Uploading…" : copy.choose}
        </button>
      )}

      <div className="note" style={{ marginTop: 6 }}>
        {copy.hint}
      </div>
      {error && (
        <div className="err" style={{ marginTop: 8, marginBottom: 0 }}>
          {error}
        </div>
      )}
    </div>
  );
}
