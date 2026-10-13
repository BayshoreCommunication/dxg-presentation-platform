"use client";

import { useEffect, useState } from "react";
import { ApiError, fileDownloadUrl, getOpenLink } from "@/lib/api";
import { Icon } from "@/components/Icon";

type Desktop = "windows" | "mac" | "linux" | "other";

/** Which desktop this is, from what the browser says about itself. */
function desktop(): Desktop {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const said = `${nav.userAgentData?.platform ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent}`.toLowerCase();
  // A phone or tablet first: its platform field can still read like a desktop's.
  if (/android|iphone|ipod|mobile/.test(navigator.userAgent.toLowerCase())) return "other";
  if (said.includes("win")) return "windows";
  if (said.includes("mac") && !/iphone|ipad/.test(said)) return "mac";
  if (said.includes("linux") && !said.includes("android")) return "linux";
  return "other";
}

/** What the main button says and does on each desktop (D-167, Travis). */
const OPEN: Record<Desktop, { label: string; how: string }> = {
  windows: {
    label: "Open in PowerPoint",
    how: "Opens in PowerPoint on this computer (the browser asks first). Nothing opens? The file downloads instead.",
  },
  mac: {
    label: "Open in Keynote",
    how: "Downloads the file and Keynote (this Mac's app for presentations) opens it. In Chrome, choose \u201cAlways open files of this type\u201d once and it opens by itself.",
  },
  linux: {
    label: "Open in LibreOffice",
    how: "Downloads the file and LibreOffice Impress (this computer's app for presentations) opens it.",
  },
  other: { label: "Download", how: "Downloads the file; open it with the presentation app on this device." },
};

/**
 * "Open in PowerPoint" (client review, D-158; per desktop in D-167, Travis): the deck plays in the
 * desk computer's own app, where transitions, animations and video look as they will in the room —
 * the browser preview can't show those.
 * - **Windows**: hands PowerPoint a five-minute link to this one version (`ms-powerpoint:ofv|u|…`);
 *   the browser asks "Open PowerPoint?". If nothing takes it (the page never loses focus) the
 *   file downloads. **Download** sits beside it.
 * - **Mac**: no website can open Keynote with a file — it takes no link — so "Open in Keynote"
 *   downloads and the Mac's default app opens it (Chrome's "Always open files of this type" makes
 *   that automatic). The PowerPoint link is not offered: without PowerPoint, LibreOffice answers it
 *   and opens empty (tried on a desk Mac, 2026-10-13).
 * - **Linux**: the same as a Mac, with LibreOffice Impress.
 * - Phones and tablets: Download.
 */
export function OpenInPowerPoint({ versionId, primary = false }: { versionId: string; primary?: boolean }) {
  // Unknown until the page is running in the browser; until then it reads as most desks are.
  const [os, setOs] = useState<Desktop | null>(null);
  const [state, setState] = useState<"idle" | "opening" | "handed" | "downloaded">("idle");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setOs(desktop()), []);
  const here = os ?? "windows";

  function download() {
    const link = document.createElement("a");
    link.href = fileDownloadUrl(versionId);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setState("downloaded");
  }

  async function open() {
    setError(null);
    // Only Windows hands the file to an app by link; everywhere else the download is the way in.
    if (here !== "windows") {
      download();
      return;
    }
    setState("opening");
    try {
      const { path } = await getOpenLink(versionId);
      let handedOver = false;
      // PowerPoint taking the link pulls focus away from the page (or the browser's "Open PowerPoint?" prompt does).
      const leave = () => {
        handedOver = true;
      };
      window.addEventListener("blur", leave, { once: true });
      document.addEventListener("visibilitychange", leave, { once: true });
      window.location.href = `ms-powerpoint:ofv|u|${window.location.origin}${path}`;
      window.setTimeout(() => {
        window.removeEventListener("blur", leave);
        document.removeEventListener("visibilitychange", leave);
        if (handedOver) setState("handed");
        else download();
      }, 2500);
    } catch (caught) {
      setState("idle");
      setError(caught instanceof ApiError ? caught.message : "The presentation couldn't be opened. Try again.");
    }
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className={primary ? "btn pri" : "btn"}
          disabled={state === "opening"}
          title={OPEN[here].how}
          onClick={() => void open()}
        >
          <Icon name={here === "other" ? "download" : "play"} />
          {state === "opening" ? "Opening…" : OPEN[here].label}
        </button>
        {/* A plain download beside it on every desktop (Travis); on a phone the main button is one. */}
        {here !== "other" && (
          <button
            type="button"
            className="btn"
            title="Download the file and open it with this computer's app for presentations"
            onClick={download}
          >
            <Icon name="download" />
            Download
          </button>
        )}
      </span>
      {state === "handed" && (
        <span className="note" style={{ maxWidth: 360 }}>
          Opened in PowerPoint. Nothing opened? Press Download.
        </span>
      )}
      {state === "downloaded" && (
        <span className="note" style={{ maxWidth: 360 }}>
          {here === "mac"
            ? "Downloaded — open it from your downloads and Keynote shows it. In Chrome, \u201cAlways open files of this type\u201d opens it by itself next time."
            : here === "linux"
              ? "Downloaded — open it from your downloads in LibreOffice Impress."
              : "Downloaded — open it from your downloads."}
        </span>
      )}
      {error && <span className="err">{error}</span>}
    </span>
  );
}
