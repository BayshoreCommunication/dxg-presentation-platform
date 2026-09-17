import { readZipEntries, readZipEntry } from "./zip.ts";

/**
 * Tier-1 inspection (FR-INSP-001/002, BUILD_SPEC §11). Deterministic checks
 * only — no judgement about content, design or animation behaviour.
 */
export type Severity = "info" | "warning" | "blocking";
export type Finding = { check_code: string; severity: Severity; detail: Record<string, unknown> };

export type RoomProfile = { aspect: "16:9" | "4:3"; videoCodecs: string[] };
export const DEFAULT_ROOM_PROFILE: RoomProfile = { aspect: "16:9", videoCodecs: ["h264"] };

const MAX_BYTES = 10 * 1024 * 1024 * 1024;
const VIDEO_EXTENSIONS = [".mp4", ".mov", ".m4v", ".avi", ".wmv"];

export function inspectPresentation(
  body: Buffer,
  fileName: string,
  profile: RoomProfile = DEFAULT_ROOM_PROFILE,
): Finding[] {
  const findings: Finding[] = [];

  if (body.length > MAX_BYTES) {
    findings.push({ check_code: "size_type", severity: "blocking", detail: { bytes: body.length, limit: MAX_BYTES } });
    return findings;
  }
  findings.push({ check_code: "metadata", severity: "info", detail: { bytes: body.length, filename: fileName } });

  if (fileName.toLowerCase().endsWith(".pdf")) {
    if (!body.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      findings.push({ check_code: "corruption", severity: "blocking", detail: { reason: "not a PDF" } });
    }
    return findings;
  }

  let entries;
  try {
    entries = readZipEntries(body);
  } catch {
    findings.push({
      check_code: "corruption",
      severity: "blocking",
      detail: { reason: "file does not open as a PowerPoint package" },
    });
    return findings;
  }

  const names = entries.map((entry) => entry.name);
  if (!names.includes("[Content_Types].xml") || !names.some((name) => name.startsWith("ppt/"))) {
    findings.push({
      check_code: "corruption",
      severity: "blocking",
      detail: { reason: "not an OOXML presentation package" },
    });
    return findings;
  }

  if (names.some((name) => name.toLowerCase().includes("vbaproject.bin"))) {
    findings.push({ check_code: "macros", severity: "blocking", detail: { reason: "macro-enabled content" } });
  }

  const slides = names.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  findings.push({ check_code: "metadata", severity: "info", detail: { slides: slides.length } });

  const presentation = entries.find((entry) => entry.name === "ppt/presentation.xml");
  if (presentation) {
    try {
      const xml = readZipEntry(body, presentation).toString("utf8");
      const size = /<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/.exec(xml);
      if (size) {
        const ratio = Number(size[1]) / Number(size[2]);
        const aspect = Math.abs(ratio - 16 / 9) < 0.05 ? "16:9" : Math.abs(ratio - 4 / 3) < 0.05 ? "4:3" : "other";
        findings.push({
          check_code: "aspect",
          severity: aspect === profile.aspect ? "info" : "warning",
          detail: { aspect, room_profile: profile.aspect },
        });
      }
    } catch {
      /* presentation.xml unreadable — the corruption check above already covers hard failures */
    }
  }

  const media = names.filter((name) => name.startsWith("ppt/media/"));
  const videos = media.filter((name) => VIDEO_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext)));
  if (media.length > 0) {
    findings.push({ check_code: "metadata", severity: "info", detail: { embedded_media: media.length } });
  }
  // QuickTime containers frequently carry HEVC, which the room profile does not
  // guarantee. The real codec probe arrives with the media worker (M2-4).
  for (const video of videos.filter((name) => name.toLowerCase().endsWith(".mov"))) {
    findings.push({
      check_code: "codec",
      severity: "warning",
      detail: { file: video.split("/").pop(), container: "mov", expected: profile.videoCodecs[0] ?? "h264" },
    });
  }

  const externalLinks = entries.filter((entry) => entry.name.endsWith(".rels"));
  let linkedMedia = 0;
  for (const rels of externalLinks) {
    try {
      const xml = readZipEntry(body, rels).toString("utf8");
      linkedMedia += (xml.match(/TargetMode="External"[^>]*Type="[^"]*\/(video|audio)"/g) ?? []).length;
      linkedMedia += (xml.match(/Type="[^"]*\/(video|audio)"[^>]*TargetMode="External"/g) ?? []).length;
    } catch {
      /* ignore unreadable relationship parts */
    }
  }
  if (linkedMedia > 0) {
    findings.push({ check_code: "linked_media", severity: "warning", detail: { count: linkedMedia } });
  }

  return findings;
}

export const worstSeverity = (findings: Finding[]): Severity =>
  findings.some((finding) => finding.severity === "blocking")
    ? "blocking"
    : findings.some((finding) => finding.severity === "warning")
      ? "warning"
      : "info";
