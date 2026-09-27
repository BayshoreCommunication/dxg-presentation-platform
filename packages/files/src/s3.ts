import { createHash } from "node:crypto";
import path from "node:path";
import type { S3Client } from "@aws-sdk/client-s3";
import { LocalStorage } from "./storage.ts";
import type { Storage, StoredObject } from "./storage.ts";

/**
 * S3 object storage (M2-2, production readiness).
 *
 * Every presentation, PDF copy, brand asset and archive package lived on the API server's
 * own disk. In production they go to S3 instead, behind the same `Storage` interface, so
 * nothing above this file changes:
 *
 *   - **objects** (assembled uploads, derived PDFs, brand files, archive packages) are
 *     S3 objects under the same keys the local driver used — content-addressed
 *     `client/event/sha256` for uploads — with server-side encryption;
 *   - **upload parts** stay on the server's local disk while an upload is in progress
 *     (they are small, short-lived and resumed by the same server), then are assembled,
 *     hashed and written to S3 in one piece. The resumable-upload protocol is unchanged.
 *
 * Works against AWS S3 or any S3-compatible store (MinIO locally): `S3_ENDPOINT` and
 * `S3_FORCE_PATH_STYLE` point it elsewhere.
 */
export type S3Config = {
  bucket: string;
  region: string;
  endpoint?: string | undefined;
  forcePathStyle?: boolean;
  /** Where in-progress upload parts are kept on local disk. */
  partsRoot: string;
};

const sha256 = (body: Buffer): string => createHash("sha256").update(body).digest("hex");

export class S3Storage implements Storage {
  private readonly config: S3Config;
  private readonly parts: LocalStorage;
  private client: S3Client | undefined;

  constructor(config: S3Config) {
    this.config = config;
    this.parts = new LocalStorage(config.partsRoot);
  }

  private async s3(): Promise<S3Client> {
    if (!this.client) {
      const { S3Client } = await import("@aws-sdk/client-s3");
      this.client = new S3Client({
        region: this.config.region,
        ...(this.config.endpoint ? { endpoint: this.config.endpoint } : {}),
        forcePathStyle: this.config.forcePathStyle ?? false,
      });
    }
    return this.client;
  }

  putPart(uploadId: string, partNumber: number, body: Buffer) {
    return this.parts.putPart(uploadId, partNumber, body);
  }

  listParts(uploadId: string) {
    return this.parts.listParts(uploadId);
  }

  abort(uploadId: string) {
    return this.parts.abort(uploadId);
  }

  /** The parts, joined and hashed on local disk, then stored in S3 under their digest. */
  async assemble(uploadId: string, prefix: string): Promise<StoredObject> {
    const local = await this.parts.assemble(uploadId, prefix);
    const body = await this.parts.read(local.key);
    await this.put(local.key, body);
    await this.parts.remove(local.key);
    return { key: local.key, sha256: local.sha256, size: local.size };
  }

  async read(key: string): Promise<Buffer> {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const response = await (await this.s3()).send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
    if (!response.Body) throw new Error(`S3 returned no body for ${key}`);
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async put(key: string, body: Buffer): Promise<StoredObject> {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const digest = sha256(body);
    await (await this.s3()).send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ServerSideEncryption: this.config.endpoint ? undefined : "AES256",
        // S3 verifies the bytes it stored against this, so a corrupted upload fails loudly.
        ChecksumSHA256: Buffer.from(digest, "hex").toString("base64"),
        ContentType: guessType(key),
      }),
    );
    return { key, sha256: digest, size: body.length };
  }
}

function guessType(key: string): string {
  const extension = path.extname(key).toLowerCase();
  return (
    {
      ".pdf": "application/pdf",
      ".zip": "application/zip",
      ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    }[extension] ?? "application/octet-stream"
  );
}

/**
 * The storage the environment asks for: `FILE_STORAGE=s3` (production) or local disk
 * under `FILE_ROOT` (development, and the default).
 */
export function storageFromEnv(env: NodeJS.ProcessEnv = process.env): Storage {
  const root = env.FILE_ROOT ?? ".data";
  if (env.FILE_STORAGE !== "s3") return new LocalStorage(root);
  const bucket = env.S3_BUCKET;
  const region = env.S3_REGION ?? env.AWS_REGION;
  const missing = [!bucket && "S3_BUCKET", !region && "S3_REGION (or AWS_REGION)"].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`FILE_STORAGE=s3 is missing required configuration: ${missing.join(", ")}`);
  }
  return new S3Storage({
    bucket: bucket!,
    region: region!,
    endpoint: env.S3_ENDPOINT || undefined,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "1",
    partsRoot: root,
  });
}
