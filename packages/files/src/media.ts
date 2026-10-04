import { readZipEntries, readZipEntry, type ZipEntry } from "./zip.ts";

/**
 * The videos and sounds a deck carries, each tied to the slide it plays on.
 *
 * The slide preview is a PDF (D-074), and a PDF has no moving pictures: a slide with
 * an embedded video renders as its poster frame, or as nothing at all, which read as
 * "the upload lost the video". It did not — the file in the library is byte-for-byte
 * what the speaker sent — so the viewer plays the media straight out of that file,
 * beside the still of the slide it belongs to.
 */
export type SlideMedia = {
  /** 1-based, in the order the deck presents its slides — the preview's page order. */
  slide: number;
  /** The file's name inside the package, `media1.mp4`; unique within a deck. */
  name: string;
  kind: "video" | "audio";
  content_type: string;
  size: number;
};

const MEDIA_TYPES: Record<string, { kind: SlideMedia["kind"]; content_type: string }> = {
  ".mp4": { kind: "video", content_type: "video/mp4" },
  ".m4v": { kind: "video", content_type: "video/x-m4v" },
  ".mov": { kind: "video", content_type: "video/quicktime" },
  ".webm": { kind: "video", content_type: "video/webm" },
  ".wmv": { kind: "video", content_type: "video/x-ms-wmv" },
  ".avi": { kind: "video", content_type: "video/x-msvideo" },
  ".mp3": { kind: "audio", content_type: "audio/mpeg" },
  ".m4a": { kind: "audio", content_type: "audio/mp4" },
  ".wav": { kind: "audio", content_type: "audio/wav" },
  ".aac": { kind: "audio", content_type: "audio/aac" },
};

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
};

/** A relationship part, as `(id, type, target, external)` tuples — no XML parser needed for this shape. */
function relationships(xml: string): { id: string; type: string; target: string; external: boolean }[] {
  const out: { id: string; type: string; target: string; external: boolean }[] = [];
  for (const tag of xml.match(/<Relationship\b[^>]*\/?>/g) ?? []) {
    const id = /\bId="([^"]*)"/.exec(tag)?.[1];
    const type = /\bType="([^"]*)"/.exec(tag)?.[1];
    const target = /\bTarget="([^"]*)"/.exec(tag)?.[1];
    if (!id || !type || !target) continue;
    out.push({ id, type, target, external: /\bTargetMode="External"/.test(tag) });
  }
  return out;
}

/** `ppt/slides/../media/media1.mp4` → `ppt/media/media1.mp4`. */
function resolve(from: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = from.split("/").slice(0, -1);
  for (const piece of target.split("/")) {
    if (piece === "..") parts.pop();
    else if (piece !== ".") parts.push(piece);
  }
  return parts.join("/");
}

/**
 * The slides in presentation order, as package paths. `presentation.xml` lists them by
 * relationship id; the number in `slideN.xml` is not the order — a deck whose slides
 * were moved about keeps its original file names.
 */
function slidesInOrder(body: Buffer, entries: ZipEntry[]): string[] {
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const presentation = byName.get("ppt/presentation.xml");
  const rels = byName.get("ppt/_rels/presentation.xml.rels");
  if (!presentation || !rels) return [];
  const targets = new Map(
    relationships(readZipEntry(body, rels).toString("utf8")).map((rel) => [rel.id, resolve("ppt/presentation.xml", rel.target)]),
  );
  const xml = readZipEntry(body, presentation).toString("utf8");
  const ordered: string[] = [];
  for (const tag of xml.match(/<p:sldId\b[^>]*\/?>/g) ?? []) {
    const id = /\br:id="([^"]*)"/.exec(tag)?.[1];
    const path = id ? targets.get(id) : undefined;
    if (path && byName.has(path)) ordered.push(path);
  }
  return ordered;
}

/**
 * Every embedded video or sound in a `.pptx`, with the slide it is on. Empty for a
 * deck without media, and for anything that is not a readable package — the
 * inspection already reports a corrupt file; this only has to not throw.
 */
export function slideMedia(body: Buffer): SlideMedia[] {
  let entries: ZipEntry[];
  try {
    entries = readZipEntries(body);
  } catch {
    return [];
  }
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const found: SlideMedia[] = [];
  const seen = new Set<string>();

  slidesInOrder(body, entries).forEach((slidePath, index) => {
    const relsPath = slidePath.replace(/^ppt\/slides\/(slide\d+\.xml)$/, "ppt/slides/_rels/$1.rels");
    const rels = byName.get(relsPath);
    if (!rels) return;
    let xml: string;
    try {
      xml = readZipEntry(body, rels).toString("utf8");
    } catch {
      return;
    }
    for (const rel of relationships(xml)) {
      // PowerPoint writes two relationships per video — `.../video` and Microsoft's
      // `.../media` — to the same target; one entry per file per slide is the answer.
      if (rel.external || !/\/relationships\/(video|audio|media)$/.test(rel.type)) continue;
      const path = resolve(slidePath, rel.target);
      const entry = byName.get(path);
      const type = MEDIA_TYPES[extensionOf(path)];
      if (!entry || !type) continue;
      const key = `${index + 1}:${path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ slide: index + 1, name: path.split("/").pop()!, kind: type.kind, content_type: type.content_type, size: entry.size });
    }
  });
  return found;
}

/** The bytes of one embedded media file, by the name `slideMedia` reported, or null. */
export function readSlideMedia(body: Buffer, name: string): { body: Buffer; content_type: string } | null {
  if (!/^[\w.-]+$/.test(name)) return null;
  const type = MEDIA_TYPES[extensionOf(name)];
  if (!type) return null;
  try {
    const entry = readZipEntries(body).find((candidate) => candidate.name === `ppt/media/${name}`);
    return entry ? { body: readZipEntry(body, entry), content_type: type.content_type } : null;
  } catch {
    return null;
  }
}
