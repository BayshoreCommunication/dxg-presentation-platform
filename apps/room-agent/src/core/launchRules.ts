import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readZipEntries, readZipEntry } from "@pmp/files/zip";
import { MEDIA_TYPES, POWERPOINT_TYPES } from "./driver.ts";

/**
 * Whether a file may be shown (BUILD_SPEC §8). The agent only ever launches the exact file
 * it was given: present in its library, of a type it can play, and — when the expected
 * checksum is known — byte-identical to it (I-3). It never picks a "closest match".
 */
export type LaunchCandidate = { file: string; sha256?: string };
export type Verdict =
  | { ok: true; route: "powerpoint" | "media"; file: string; missingLinkedMedia: string[] }
  | { ok: false; code: string; reason: string };

export async function checkLaunch(candidate: LaunchCandidate, libraryRoot: string): Promise<Verdict> {
  const resolved = path.resolve(candidate.file);
  const root = path.resolve(libraryRoot);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return { ok: false, code: "outside_library", reason: "The file is not in this room's library." };
  }
  const type = path.extname(resolved).toLowerCase();
  const route = POWERPOINT_TYPES.includes(type) ? "powerpoint" : MEDIA_TYPES.includes(type) ? "media" : null;
  if (!route) {
    return {
      ok: false,
      code: "unsupported_type",
      reason:
        type === ".key"
          ? "Keynote files can't play on this room PC. Use the PDF copy DXG makes of it."
          : `This room PC can't play ${type || "this kind of"} files.`,
    };
  }
  const info = await stat(resolved).catch(() => null);
  if (!info?.isFile()) return { ok: false, code: "missing", reason: "The file isn't on this room PC yet." };
  if (candidate.sha256) {
    const actual = await sha256Of(resolved);
    if (actual !== candidate.sha256.toLowerCase()) {
      return { ok: false, code: "checksum_mismatch", reason: "The copy on this room PC doesn't match the approved file." };
    }
  }
  const missingLinkedMedia = route === "powerpoint" ? await missingLinkedMediaOf(resolved, info.size) : [];
  return { ok: true, route, file: resolved, missingLinkedMedia };
}

/**
 * Videos and sounds a deck links to (not embeds) that are not on this PC (G0-1 item 5).
 * PowerPoint shows a blank frame for them mid-talk; the agent finds them before the show
 * and reports them, so the technician hears about it before the speaker does. Only for
 * packages it can read cheaply (under 500 MB); legacy .ppt is not a package and is skipped.
 */
export async function missingLinkedMediaOf(deck: string, size: number): Promise<string[]> {
  if (size > 500 * 1024 * 1024 || deck.toLowerCase().endsWith(".ppt") || deck.toLowerCase().endsWith(".pps")) return [];
  let buffer: Buffer;
  try {
    buffer = await readFile(deck);
    const missing = new Set<string>();
    for (const entry of readZipEntries(buffer)) {
      if (!/^ppt\/slides\/_rels\/.+\.rels$/.test(entry.name)) continue;
      const xml = readZipEntry(buffer, entry).toString("utf8");
      for (const rel of xml.matchAll(/<Relationship\b[^>]*>/g)) {
        const tag = rel[0];
        if (!/TargetMode="External"/.test(tag) || !/Type="[^"]*(video|audio|media)"/i.test(tag)) continue;
        const target = tag.match(/Target="([^"]+)"/)?.[1];
        if (!target || /^https?:/i.test(target)) continue;
        const decoded = decodeURI(target);
        const local = decoded.startsWith("file:") ? fileURLToPath(decoded) : path.resolve(path.dirname(deck), decoded);
        const found = await stat(local).catch(() => null);
        if (!found?.isFile()) missing.add(decoded);
      }
    }
    return [...missing];
  } catch {
    return []; // not a readable package: PowerPoint (and the start timeout) will say so
  }
}

export function sha256Of(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}
