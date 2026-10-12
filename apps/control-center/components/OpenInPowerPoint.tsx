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
  mac: "Opens in PowerPoint on this Mac. Without PowerPoint, the file downloads and opens in Keynote or your default app.",
  linux: "Downloads the file; open it from your downloads (LibreOffice Impress or your default app).",
  other: "Downloads the file; open it with the presentation app on this device.",
};

/**
 * "Open in PowerPoint" (client review, D-157): the deck plays in the desk computer's own app,
 * where transitions, animations and video look as they will in the room — the browser preview
 * can't show those. On Windows and Mac it hands PowerPoint a five-minute link to this one
 * version (`ms-powerpoint:ofv|u|…`); if PowerPoint doesn't take it (the page never loses focus
 * to it), the file downloads instead. Linux has no PowerPoint, so it downloads straight away.
 * Only PowerPoint shows exactly what the room will — other apps are close, not the same.
 */
export function OpenInPowerPoint({ versionId, primary = false }: { versionId: string; primary?: boolean }) {
  const [os, setOs] = useState<Desktop>("other");
  const [state, setState] = useState<"idle" | "opening" | "downloaded">("idle");
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
    if (os !== "windows" && os !== "mac") {
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
        if (handedOver) setState("idle");
        else download();
      }, 2500);
    } catch (caught) {
      setState("idle");
      setError(caught instanceof ApiError ? caught.message : "The presentation couldn't be opened. Try again.");
    }
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button type="button" className={primary ? "btn pri" : "btn"} disabled={state === "opening"} title={HOW[os]} onClick={() => void open()}>
        <Icon name="play" />
        {state === "opening" ? "Opening…" : os === "linux" || os === "other" ? "Open on this computer" : "Open in PowerPoint"}
      </button>
      {state === "downloaded" && (
        <span className="note" style={{ maxWidth: 320 }}>
          Downloaded — open it from your downloads.{os === "windows" || os === "mac" ? " (PowerPoint didn't open it.)" : ""}
        </span>
      )}
      {error && <span className="err">{error}</span>}
    </span>
  );
}
