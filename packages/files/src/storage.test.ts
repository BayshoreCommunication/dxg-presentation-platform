import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { LocalStorage } from "./storage.ts";

/*
 * An upload id reaches the file system as a folder name, and `assemble`/`abort` delete
 * the folder it names. Express decodes `%2F` in a route parameter, so an id such as
 * `..%2F..%2Flibrary` once pointed outside the uploads folder. Only a UUID is an id.
 */
describe("upload ids never name a path outside the uploads folder", () => {
  test("anything but a UUID is refused before the disk is touched", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pmp-storage-"));
    try {
      const storage = new LocalStorage(root);
      for (const id of ["..", "../library", "../../etc", "a/b", "", "not-a-uuid"]) {
        await assert.rejects(storage.putPart(id, 1, Buffer.from("x")), /Not an upload id/, `putPart(${JSON.stringify(id)})`);
        await assert.rejects(storage.assemble(id, "p"), /Not an upload id/, `assemble(${JSON.stringify(id)})`);
        await assert.rejects(storage.abort(id), /Not an upload id/, `abort(${JSON.stringify(id)})`);
      }
      assert.deepEqual(await readdir(root), [], "nothing was written anywhere");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a real upload id still works end to end", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pmp-storage-"));
    try {
      const storage = new LocalStorage(root);
      const id = randomUUID();
      await storage.putPart(id, 1, Buffer.from("hello "));
      await storage.putPart(id, 2, Buffer.from("world"));
      const stored = await storage.assemble(id, "client/event");
      assert.equal((await storage.read(stored.key)).toString(), "hello world");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
