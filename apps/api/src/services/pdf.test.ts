import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { convertToPdf, findLibreOffice, ConversionError } from "./pdf.ts";

/**
 * PDF conversion with LibreOffice (D-067). The rules that need no LibreOffice always
 * run; the real conversion runs only where LibreOffice is installed, and says so when
 * it skips.
 */
describe("PDF conversion", () => {
  test("a PDF original is passed through untouched", async () => {
    const original = Buffer.from("%PDF-1.4 original bytes");
    assert.deepEqual(await convertToPdf(original, "Final Deck.PDF"), original);
  });

  test("a format LibreOffice cannot open is refused with a reason", async () => {
    await assert.rejects(convertToPdf(Buffer.from("x"), "walkthrough.mp4"), (error: unknown) => {
      assert.ok(error instanceof ConversionError);
      assert.match((error as Error).message, /\.mp4/);
      return true;
    });
  });

  test("a file with no extension is refused rather than guessed at", async () => {
    await assert.rejects(convertToPdf(Buffer.from("x"), "deck"), ConversionError);
  });

  test("a real PowerPoint deck becomes a real PDF", async (t) => {
    const soffice = await findLibreOffice();
    if (!soffice) return t.skip("LibreOffice is not installed here");

    // Make a genuine .pptx with LibreOffice itself: text → PDF → Impress → PPTX.
    const work = await mkdtemp(path.join(os.tmpdir(), "pmp-pdf-test-"));
    try {
      await writeFile(path.join(work, "deck.txt"), "Synthetic test slide\n");
      const run = (profile: string, args: string[]) =>
        spawnSync(soffice, [`-env:UserInstallation=file://${path.join(work, profile)}`, "--headless", ...args], {
          cwd: work,
          timeout: 120_000,
        });
      run("p1", ["--convert-to", "pdf", "deck.txt"]);
      run("p2", ["--infilter=impress_pdf_import", "--convert-to", "pptx", "deck.pdf"]);
      const pptx = await readFile(path.join(work, "deck.pptx"));
      assert.equal(pptx.subarray(0, 2).toString(), "PK", "the fixture is a real OOXML deck");

      // A name with spaces and brackets, as speakers' files have.
      const pdf = await convertToPdf(pptx, "Keynote (final v3).pptx");
      assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
      assert.ok(pdf.length > 1000, "a real document, not an empty shell");

      // The old binary format (PowerPoint 97–2003), which speakers still send.
      run("p3", ["--convert-to", "ppt", "deck.pptx"]);
      const ppt = await readFile(path.join(work, "deck.ppt"));
      assert.equal(ppt.subarray(0, 4).toString("hex"), "d0cf11e0", "the fixture is a real legacy .ppt");
      const fromPpt = await convertToPdf(ppt, "Old deck (2019).ppt");
      assert.equal(fromPpt.subarray(0, 5).toString(), "%PDF-");
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
});
