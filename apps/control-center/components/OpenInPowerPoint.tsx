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

/** The Mac opener's installer (D-168), served by the API. */
const MAC_OPENER_URL = "/api/v1/downloads/dxgpm-opener-mac.pkg";

/** What the main button says and does on each desktop (D-167, Travis). */
const OPEN: Record<Desktop, { label: string; how: string }> = {
  windows: {
    label: "Open in PowerPoint",
    how: "Opens in PowerPoint on this computer (the browser asks first). Nothing opens? The file downloads instead.",
  },
  mac: {
    label: "Open in Keynote",
    how: "With DXG\u00b7PM Opener on this Mac, the browser asks to open it and the deck opens in Keynote (or this Mac's app for presentations). Without it, the file downloads.",
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
 * - **Mac**: no website can open Keynote with a file — it takes no link — and LibreOffice drops the
 *   file from a PowerPoint link (tried on a desk Mac, 2026-10-13). So a Mac gets **DXG·PM Opener**
 *   (D-168, `tools/mac-opener`), installed once: "Open in Keynote" hands it the same five-minute
 *   link as `dxgpm-open:<url>`, the browser asks "Open DXG·PM Opener?", and it fetches the deck and
 *   opens it in the Mac's default app (Keynote, LibreOffice or PowerPoint). Without the opener
 *   nothing takes the link, so the file downloads — and the page offers the installer.
 * - **Linux**: the same as a Mac, with LibreOffice Impress.
 * - Phones and tablets: Download.
 */
/** Set in this browser once DXG·PM Opener has taken a link, so the install offer stops showing (D-168). */
const OPENER_SEEN = "dxgpm.macOpener";
const remember = (seen: boolean) => {
  try {
    if (seen) window.localStorage.setItem(OPENER_SEEN, "1");
    else window.localStorage.removeItem(OPENER_SEEN);
  } catch {
    // Storage can be off (private mode); the offer simply keeps showing.
  }
};

/**
 * The buttons are returned as items of the caller's row (a wrapping flex row), and what there is
 * to say goes on a line of its own under the whole row, so the row stays one even line.
 */
export function OpenInPowerPoint({ versionId, primary = false }: { versionId: string; primary?: boolean }) {
  // Unknown until the page is running in the browser; until then it reads as most desks are.
  const [os, setOs] = useState<Desktop | null>(null);
  const [state, setState] = useState<"idle" | "opening" | "handed" | "downloaded">("idle");
  const [error, setError] = useState<string | null>(null);
  // Has this browser seen the Mac opener work? Then there's nothing to install.
  const [openerSeen, setOpenerSeen] = useState(true);
  useEffect(() => {
    setOs(desktop());
    try {
      setOpenerSeen(window.localStorage.getItem(OPENER_SEEN) === "1");
    } catch {
      setOpenerSeen(false);
    }
  }, []);
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
    // Windows hands PowerPoint the link, a Mac hands it to DXG·PM Opener; Linux and phones download.
    if (here !== "windows" && here !== "mac") {
      download();
      return;
    }
    setState("opening");
    try {
      const { path } = await getOpenLink(versionId);
      let handedOver = false;
      // The app taking the link pulls focus away from the page (or the browser's "Open …?" prompt does).
      const leave = () => {
        handedOver = true;
      };
      window.addEventListener("blur", leave, { once: true });
      document.addEventListener("visibilitychange", leave, { once: true });
      const link = `${window.location.origin}${path}`;
      window.location.href = here === "mac" ? `dxgpm-open:${link}` : `ms-powerpoint:ofv|u|${link}`;
      window.setTimeout(() => {
        window.removeEventListener("blur", leave);
        document.removeEventListener("visibilitychange", leave);
        if (handedOver) {
          setState("handed");
          if (here === "mac") {
            remember(true);
            setOpenerSeen(true);
          }
        } else {
          download();
          // Nothing took the link: on a Mac that means no opener (any more) — offer it again.
          if (here === "mac") {
            remember(false);
            setOpenerSeen(false);
          }
        }
      }, 2500);
    } catch (caught) {
      setState("idle");
      setError(caught instanceof ApiError ? caught.message : "The presentation couldn't be opened. Try again.");
    }
  }

  const app = here === "mac" ? "Keynote" : here === "linux" ? "LibreOffice Impress" : "PowerPoint";
  const said =
    state === "handed"
      ? `Opening in ${here === "mac" ? "this Mac's app for presentations" : "PowerPoint"} — nothing opened? Press Download.`
      : state === "downloaded"
        ? `Downloaded — open it from your downloads${here === "other" ? "" : ` in ${app}`}.`
        : null;
  const offerOpener = here === "mac" && !openerSeen;

  return (
    <>
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
      {(said || offerOpener || error) && (
        // Last in the row and as wide as it, so it sits on its own line under every button.
        <span className="note" style={{ flexBasis: "100%", order: 1, margin: 0 }}>
          {said}
          {said && offerOpener ? " " : null}
          {/* The Mac opener (D-168): offered until this browser has seen it work. */}
          {offerOpener && (
            <>
              {state === "downloaded" ? "To open straight in Keynote, " : "Open straight in Keynote: "}
              <a
                href={MAC_OPENER_URL}
                title="Double-click the installer. If the Mac says it can't be opened: System Settings → Privacy & Security → Open Anyway, then Install."
              >
                install DXG&middot;PM Opener
              </a>{" "}
              (once per Mac).
            </>
          )}
          {error && <span className="err"> {error}</span>}
        </span>
      )}
    </>
  );
}
