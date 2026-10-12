"use client";

import { useEffect, useState } from "react";
import { ApiError, fileDownloadUrl, getOpenLink } from "@/lib/api";
import { Icon } from "@/components/Icon";

type Desktop = "windows" | "mac" | "linux" | "other";

/** Which desktop this is, from what the browser says about itself. */
function desktop(): Desktop {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const said = `${nav.userAgentData?.platform ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent}`.toLowerCase();
  if (said.includes("win")) return "windows";
  if (said.includes("mac") && !/iphone|ipad/.test(said)) return "mac";
  if (said.includes("linux") && !said.includes("android")) return "linux";
  return "other";
}

const HOW: Record<Desktop, string> = {
  windows: "Opens in PowerPoint on this computer. Without PowerPoint, the file downloads — open it from your downloads.",
  mac: "Opens in PowerPoint on this Mac. No PowerPoint (Keynote only)? Use Download instead.",
  linux: "Downloads the file; open it from your downloads (LibreOffice Impress or your default app).",
  other: "Downloads the file; open it with the presentation app on this device.",
};

/**
 * "Open in PowerPoint" (client review, D-158): the deck plays in the desk computer's own app,
 * where transitions, animations and video look as they will in the room — the browser preview
 * can't show those. On Windows and Mac it hands PowerPoint a five-minute link to this one
 * version (`ms-powerpoint:ofv|u|…`); if PowerPoint doesn't take it (the page never loses focus
 * to it), the file downloads instead. **Download** sits beside it always: on a Mac, LibreOffice also
 * claims these links and Keynote takes none, so a downloaded file (opened by the computer's
 * default app) is how Keynote gets it. Linux has no PowerPoint: Download only.
 * Only PowerPoint shows exactly what the room will — other apps are close, not the same.
 */
export function OpenInPowerPoint({ versionId, primary = false }: { versionId: string; primary?: boolean }) {
  // Unknown until the page is running in the browser; until then it reads as most desks are (PowerPoint).
  const [os, setOs] = useState<Desktop | null>(null);
  const [state, setState] = useState<"idle" | "opening" | "handed" | "downloaded">("idle");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setOs(desktop()), []);

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
    if (os === "linux" || os === "other") {
      download();
      return;
    }
    setState("opening");
    try {
      const { path } = await getOpenLink(versionId);
      let handedOver = false;
      // PowerPoint taking the link pulls focus away from the page (or its "Open PowerPoint?" prompt does).
      const leave = () => {
        handedOver = true;
      };
      window.addEventListener("blur", leave, { once: true });
      document.addEventListener("visibilitychange", leave, { once: true });
      window.location.href = `ms-powerpoint:ofv|u|${window.location.origin}${path}`;
      window.setTimeout(() => {
        window.removeEventListener("blur", leave);
        document.removeEventListener("visibilitychange", leave);
        // Handed to an app — which may not be PowerPoint: LibreOffice also claims these links on
        // a Mac, and Keynote takes none. Say so, with Download beside it for Keynote or the default app.
        if (handedOver) setState("handed");
        else download();
      }, 2500);
    } catch (caught) {
      setState("idle");
      setError(caught instanceof ApiError ? caught.message : "The presentation couldn't be opened. Try again.");
    }
  }

  const noPowerPoint = os === "linux" || os === "other";

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
        {!noPowerPoint && (
          <button type="button" className={primary ? "btn pri" : "btn"} disabled={state === "opening"} title={HOW[os ?? "windows"]} onClick={() => void open()}>
            <Icon name="play" />
            {state === "opening" ? "Opening…" : "Open in PowerPoint"}
          </button>
        )}
        {/* Always there: Keynote, LibreOffice or whichever app opens .pptx on this computer. */}
        <button
          type="button"
          className={noPowerPoint && primary ? "btn pri" : "btn"}
          title="Download the file and open it with this computer's app for presentations (Keynote, PowerPoint, LibreOffice…)"
          onClick={download}
        >
          <Icon name="download" />
          Download
        </button>
      </span>
      {state === "handed" && (
        <span className="note" style={{ maxWidth: 360 }}>
          Opened in this computer&rsquo;s app for PowerPoint links. Wrong app, or nothing opened? Press Download and open it
          with Keynote or PowerPoint.
        </span>
      )}
      {state === "downloaded" && (
        <span className="note" style={{ maxWidth: 320 }}>
          Downloaded — open it from your downloads.
        </span>
      )}
      {error && <span className="err">{error}</span>}
    </span>
  );
}
