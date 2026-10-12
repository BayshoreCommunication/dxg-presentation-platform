"use client";

import { fileDownloadUrl } from "@/lib/api";
import { Icon } from "@/components/Icon";

/**
 * "Open in PowerPoint" (client review, D-158): the deck downloads and the computer opens it in its
 * own presentation app — PowerPoint, Keynote or whichever opens .pptx there — where transitions,
 * animations and video play as in the room. Travis: just the download, nothing else; a website
 * cannot open an app by itself, and the `ms-powerpoint:` link reached LibreOffice, never Keynote.
 */
export function OpenInPowerPoint({ versionId, primary = false }: { versionId: string; primary?: boolean }) {
  return (
    <a className={primary ? "btn pri" : "btn"} href={fileDownloadUrl(versionId)} download>
      <Icon name="play" />
      Open in PowerPoint
    </a>
  );
}
