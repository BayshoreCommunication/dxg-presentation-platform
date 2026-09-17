import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { inspectPresentation, worstSeverity } from "./inspect.ts";
import { DevSignatureScanner } from "./scanner.ts";
import { readZipEntries, readZipEntry } from "./zip.ts";

/** Builds a real (tiny) ZIP so the checks run against actual bytes, not mocks. */
function makeZip(files: { name: string; body: string }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const content = Buffer.from(file.body, "utf8");
    const deflated = deflateRawSync(content);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(local, deflated);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);

    offset += local.length + deflated.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, eocd]);
}

const deck = (extra: { name: string; body: string }[] = [], cx = 12192000, cy = 6858000) =>
  makeZip([
    { name: "[Content_Types].xml", body: "<Types/>" },
    { name: "ppt/presentation.xml", body: `<p:presentation><p:sldSz cx="${cx}" cy="${cy}"/></p:presentation>` },
    { name: "ppt/slides/slide1.xml", body: "<p:sld/>" },
    { name: "ppt/slides/slide2.xml", body: "<p:sld/>" },
    ...extra,
  ]);

const codes = (findings: { check_code: string }[]) => findings.map((finding) => finding.check_code);

describe("zip reader", () => {
  test("lists and inflates entries", () => {
    const buffer = deck();
    const entries = readZipEntries(buffer);
    assert.ok(entries.some((entry) => entry.name === "ppt/presentation.xml"));
    const xml = readZipEntry(buffer, entries.find((e) => e.name === "ppt/presentation.xml")!).toString();
    assert.match(xml, /sldSz/);
  });
});

describe("tier-1 inspection (FR-INSP-001/002)", () => {
  test("a clean 16:9 deck produces only informational findings", () => {
    const findings = inspectPresentation(deck(), "clean.pptx");
    assert.equal(worstSeverity(findings), "info");
    assert.ok(findings.some((f) => f.check_code === "metadata" && f.detail.slides === 2));
  });

  test("a 4:3 deck warns against a 16:9 room profile", () => {
    const findings = inspectPresentation(deck([], 9144000, 6858000), "old.pptx");
    const aspect = findings.find((finding) => finding.check_code === "aspect");
    assert.equal(aspect?.severity, "warning");
    assert.equal(aspect?.detail.aspect, "4:3");
  });

  test("macro-enabled content is blocking", () => {
    const findings = inspectPresentation(deck([{ name: "ppt/vbaProject.bin", body: "MZ" }]), "macros.pptm");
    assert.ok(codes(findings).includes("macros"));
    assert.equal(worstSeverity(findings), "blocking");
  });

  test("a .mov video warns about the codec the room profile does not guarantee", () => {
    const findings = inspectPresentation(deck([{ name: "ppt/media/demo.mov", body: "moov" }]), "video.pptx");
    const codec = findings.find((finding) => finding.check_code === "codec");
    assert.equal(codec?.severity, "warning");
    assert.equal(codec?.detail.file, "demo.mov");
  });

  test("linked (not embedded) media is detected in the relationship parts", () => {
    const rels = {
      name: "ppt/slides/_rels/slide1.xml.rels",
      body: '<Relationships><Relationship Type="http://x/video" TargetMode="External" Target="file:///C:/clip.mp4"/></Relationships>',
    };
    const findings = inspectPresentation(deck([rels]), "linked.pptx");
    assert.ok(codes(findings).includes("linked_media"));
  });

  test("a file that is not a presentation package is blocking, not a crash", () => {
    const findings = inspectPresentation(Buffer.from("just some bytes"), "notes.pptx");
    assert.equal(codes(findings).includes("corruption"), true);
    assert.equal(worstSeverity(findings), "blocking");
  });
});

describe("scanner fails closed (I-2)", () => {
  test("a clean file passes", async () => {
    const result = await new DevSignatureScanner().scan(deck());
    assert.equal(result.verdict, "clean");
  });

  test("the EICAR test signature is detected", async () => {
    const eicar = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
    const result = await new DevSignatureScanner().scan(eicar);
    assert.equal(result.verdict, "infected");
    assert.equal(result.signature, "Eicar-Test-Signature");
  });
});
