import { readZipEntries, readZipEntry } from "./zip.ts";

/**
 * Minimal spreadsheet reader for schedule import (FR-IMP-001). XLSX is an OOXML
 * package, so the ZIP reader already here can open it — no dependency, and the
 * same code path that inspects presentations.
 */
export type SheetRows = string[][];

export function parseSheet(body: Buffer, fileName: string): SheetRows {
  return fileName.toLowerCase().endsWith(".csv") ? parseCsv(body.toString("utf8")) : parseXlsx(body);
}

/** RFC 4180-ish: quoted fields, doubled quotes, embedded newlines and commas. */
export function parseCsv(text: string): SheetRows {
  const rows: SheetRows = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((cell) => cell.trim() !== ""));
}

const columnIndex = (ref: string): number => {
  const letters = /^([A-Z]+)/.exec(ref)?.[1] ?? "A";
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
};

/** Excel serial date → ISO date (1900 system, with Excel's 1900 leap-year quirk). */
export function excelSerialToDate(serial: number): string {
  const ms = Math.round((serial - 25569) * 86_400 * 1000);
  return new Date(ms).toISOString();
}

export function parseXlsx(body: Buffer): SheetRows {
  const entries = readZipEntries(body);
  const decode = (name: string): string | null => {
    const entry = entries.find((candidate) => candidate.name === name);
    return entry ? readZipEntry(body, entry).toString("utf8") : null;
  };

  const sharedXml = decode("xl/sharedStrings.xml") ?? "";
  const shared: string[] = [];
  for (const match of sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const text = [...(match[1] ?? "").matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
      .map((part) => part[1] ?? "")
      .join("");
    shared.push(unescapeXml(text));
  }

  const sheetName =
    entries.find((entry) => /^xl\/worksheets\/sheet1\.xml$/.test(entry.name))?.name ??
    entries.find((entry) => /^xl\/worksheets\/.+\.xml$/.test(entry.name))?.name;
  const sheetXml = sheetName ? decode(sheetName) : null;
  if (!sheetXml) throw new Error("no worksheet found in workbook");

  const rows: SheetRows = [];
  for (const rowMatch of sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cellMatch of (rowMatch[1] ?? "").matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1] ?? "";
      const inner = cellMatch[2] ?? "";
      const ref = /r="([A-Z]+\d+)"/.exec(attributes)?.[1] ?? "A1";
      const type = /t="([^"]+)"/.exec(attributes)?.[1];
      const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "";
      const inlineText = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((part) => part[1] ?? "").join("");

      let value: string;
      if (type === "s") value = shared[Number(raw)] ?? "";
      else if (type === "inlineStr") value = unescapeXml(inlineText);
      else value = unescapeXml(raw);

      const index = columnIndex(ref);
      while (cells.length < index) cells.push("");
      cells[index] = value;
    }
    rows.push(cells);
  }
  return rows.filter((row) => row.some((cell) => cell.trim() !== ""));
}

const unescapeXml = (value: string): string =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
