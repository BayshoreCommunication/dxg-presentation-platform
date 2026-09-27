import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { S3Storage, storageFromEnv, LocalStorage } from "./index.ts";

/**
 * The S3 driver against a real S3 API. Runs when S3_TEST_ENDPOINT points at one — locally
 * a MinIO container — and is skipped otherwise, so `npm test` needs no network.
 *
 *   docker run -d -p 9100:9000 -e MINIO_ROOT_USER=pmptest -e MINIO_ROOT_PASSWORD=pmptest-secret minio/minio server /data
 *   S3_TEST_ENDPOINT=http://127.0.0.1:9100 AWS_ACCESS_KEY_ID=pmptest AWS_SECRET_ACCESS_KEY=pmptest-secret npm test
 */
const endpoint = process.env.S3_TEST_ENDPOINT;
let storage: S3Storage;

before(async () => {
  if (!endpoint) return;
  storage = new S3Storage({
    bucket: process.env.S3_TEST_BUCKET ?? "pmp-test",
    region: "us-east-1",
    endpoint,
    forcePathStyle: true,
    partsRoot: await mkdtemp(path.join(os.tmpdir(), "pmp-s3-parts-")),
  });
});

test("an object put is read back byte for byte", { skip: !endpoint && "S3_TEST_ENDPOINT not set" }, async () => {
  const body = Buffer.from(`probe ${randomUUID()}`);
  const stored = await storage.put(`probe/${randomUUID()}.bin`, body);
  assert.equal(stored.size, body.length);
  assert.equal(stored.sha256, createHash("sha256").update(body).digest("hex"));
  assert.deepEqual(await storage.read(stored.key), body);
});

test("a resumable upload is assembled, hashed and stored under its digest", { skip: !endpoint && "S3_TEST_ENDPOINT not set" }, async () => {
  const uploadId = randomUUID();
  const one = Buffer.alloc(1024 * 1024, 1);
  const two = Buffer.from("tail");
  await storage.putPart(uploadId, 1, one);
  await storage.putPart(uploadId, 2, two);
  assert.deepEqual((await storage.listParts(uploadId)).map((part) => part.partNumber), [1, 2]);

  const stored = await storage.assemble(uploadId, "client/event");
  const whole = Buffer.concat([one, two]);
  assert.equal(stored.key, `client/event/${createHash("sha256").update(whole).digest("hex")}`);
  assert.deepEqual(await storage.read(stored.key), whole);
  assert.deepEqual(await storage.listParts(uploadId), [], "the parts are cleaned up");
});

test("a missing object is an error, not an empty file", { skip: !endpoint && "S3_TEST_ENDPOINT not set" }, async () => {
  await assert.rejects(storage.read(`probe/missing-${randomUUID()}`));
});

test("the environment chooses the driver, and S3 without a bucket refuses to start", () => {
  assert.ok(storageFromEnv({ FILE_ROOT: "/tmp/x" }) instanceof LocalStorage);
  assert.ok(storageFromEnv({ FILE_STORAGE: "s3", S3_BUCKET: "b", S3_REGION: "us-east-2" }) instanceof S3Storage);
  assert.throws(() => storageFromEnv({ FILE_STORAGE: "s3" }), /S3_BUCKET/);
});
