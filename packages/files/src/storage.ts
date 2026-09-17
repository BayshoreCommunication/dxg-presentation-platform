import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Content-addressed object storage (BUILD_SPEC §6.8). The S3 driver lands in
 * M2-2; this local driver implements the same interface so the upload protocol,
 * checksums and resume behaviour are the real thing during development.
 */
export type StoredObject = { key: string; sha256: string; size: number };

export interface Storage {
  putPart(uploadId: string, partNumber: number, body: Buffer): Promise<{ sha256: string }>;
  listParts(uploadId: string): Promise<{ partNumber: number; size: number; sha256: string }[]>;
  assemble(uploadId: string, prefix: string): Promise<StoredObject>;
  abort(uploadId: string): Promise<void>;
  read(key: string): Promise<Buffer>;
}

const sha256 = (body: Buffer): string => createHash("sha256").update(body).digest("hex");

export class LocalStorage implements Storage {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  private uploadDir(uploadId: string): string {
    return path.join(this.root, "uploads", uploadId);
  }

  async putPart(uploadId: string, partNumber: number, body: Buffer): Promise<{ sha256: string }> {
    const dir = this.uploadDir(uploadId);
    await mkdir(dir, { recursive: true });
    const digest = sha256(body);
    await writeFile(path.join(dir, `${String(partNumber).padStart(6, "0")}.part`), body);
    await writeFile(path.join(dir, `${String(partNumber).padStart(6, "0")}.sha`), digest);
    return { sha256: digest };
  }

  async listParts(uploadId: string): Promise<{ partNumber: number; size: number; sha256: string }[]> {
    const dir = this.uploadDir(uploadId);
    const names = await readdir(dir).catch(() => [] as string[]);
    const parts = [];
    for (const name of names.filter((entry) => entry.endsWith(".part")).sort()) {
      const partNumber = Number(name.replace(".part", ""));
      const { size } = await stat(path.join(dir, name));
      const digest = await readFile(path.join(dir, name.replace(".part", ".sha")), "utf8").catch(() => "");
      parts.push({ partNumber, size, sha256: digest });
    }
    return parts;
  }

  /** Concatenates the parts, hashes the whole file, and stores it under its own digest. */
  async assemble(uploadId: string, prefix: string): Promise<StoredObject> {
    const dir = this.uploadDir(uploadId);
    const names = (await readdir(dir)).filter((entry) => entry.endsWith(".part")).sort();
    const chunks: Buffer[] = [];
    for (const name of names) chunks.push(await readFile(path.join(dir, name)));
    const body = Buffer.concat(chunks);
    const digest = sha256(body);
    const key = `${prefix}/${digest}`;
    const target = path.join(this.root, "library", key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
    await rm(dir, { recursive: true, force: true });
    return { key, sha256: digest, size: body.length };
  }

  async abort(uploadId: string): Promise<void> {
    await rm(this.uploadDir(uploadId), { recursive: true, force: true });
  }

  async read(key: string): Promise<Buffer> {
    return readFile(path.join(this.root, "library", key));
  }
}
