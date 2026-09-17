import { inflateRawSync } from "node:zlib";

/**
 * Minimal ZIP reader — enough to inspect an OOXML package without a dependency
 * and without opening the file in Office (BUILD_SPEC §11: inspection is
 * deterministic parsing, never a rendering engine).
 */
export type ZipEntry = { name: string; compressedSize: number; size: number; offset: number; method: number };

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

export function readZipEntries(buffer: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0 && i > buffer.length - 66_000; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip archive");

  const count = buffer.readUInt16LE(eocd + 10);
  let pointer = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];

  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(pointer) !== CENTRAL_SIGNATURE) break;
    const method = buffer.readUInt16LE(pointer + 10);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const size = buffer.readUInt32LE(pointer + 24);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const offset = buffer.readUInt32LE(pointer + 42);
    const name = buffer.subarray(pointer + 46, pointer + 46 + nameLength).toString("utf8");
    entries.push({ name, compressedSize, size, offset, method });
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Inflates one entry by following its local header. */
export function readZipEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  const nameLength = buffer.readUInt16LE(entry.offset + 26);
  const extraLength = buffer.readUInt16LE(entry.offset + 28);
  const start = entry.offset + 30 + nameLength + extraLength;
  const raw = buffer.subarray(start, start + entry.compressedSize);
  return entry.method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
}
