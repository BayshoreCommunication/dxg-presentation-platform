import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { writeZip, sha256Of } from "./zipWrite.ts";
import { readZipEntries, readZipEntry } from "./zip.ts";

describe("archive zip writer", () => {
  test("what is written can be read back byte-for-byte, binary included", () => {
    const binary = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01, 0x02, 0xff]);
    const entries = [
      { name: "manifest.json", body: Buffer.from('{"files":1}') },
      { name: "Ballroom A/raman_v2.pptx", body: binary },
    ];
    const zip = writeZip(entries);
    const read = readZipEntries(zip);

    assert.deepEqual(
      read.map((entry) => entry.name),
      entries.map((entry) => entry.name),
    );
    for (const entry of entries) {
      const found = read.find((candidate) => candidate.name === entry.name)!;
      assert.deepEqual(readZipEntry(zip, found), entry.body);
    }
  });

  test("checksums survive the round trip — the manifest's claim matches the zip", () => {
    const body = Buffer.from("presentation bytes");
    const zip = writeZip([{ name: "deck.pptx", body }]);
    const read = readZipEntries(zip);
    assert.equal(sha256Of(readZipEntry(zip, read[0]!)), sha256Of(body));
  });

  test("an empty package is still a valid archive", () => {
    assert.deepEqual(readZipEntries(writeZip([])), []);
  });

  test("entry order is preserved", () => {
    const zip = writeZip([
      { name: "a.txt", body: Buffer.from("a") },
      { name: "b.txt", body: Buffer.from("b") },
      { name: "c.txt", body: Buffer.from("c") },
    ]);
    assert.deepEqual(
      readZipEntries(zip).map((entry) => entry.name),
      ["a.txt", "b.txt", "c.txt"],
    );
  });
});
