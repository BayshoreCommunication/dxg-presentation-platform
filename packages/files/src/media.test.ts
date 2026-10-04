import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { slideMedia, readSlideMedia } from "./media.ts";
import { writeZip } from "./zipWrite.ts";

const RELS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const rel = (id: string, type: string, target: string, external = false) =>
  `<Relationship Id="${id}" Type="${RELS}/${type}" Target="${target}"${external ? ' TargetMode="External"' : ""}/>`;
const rels = (body: string) => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
const text = (name: string, body: string) => ({ name, body: Buffer.from(body, "utf8") });

/** Two slides, listed out of file order; a video on the second, with PowerPoint's double relationship. */
const deck = () =>
  writeZip([
    text(
      "ppt/presentation.xml",
      `<p:presentation xmlns:p="x" xmlns:r="${RELS}"><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`,
    ),
    text("ppt/_rels/presentation.xml.rels", rels(rel("rId2", "slide", "slides/slide1.xml") + rel("rId3", "slide", "slides/slide2.xml"))),
    text("ppt/slides/slide1.xml", "<p:sld/>"),
    text("ppt/slides/slide2.xml", "<p:sld/>"),
    text(
      "ppt/slides/_rels/slide1.xml.rels",
      rels(
        rel("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml") +
          rel("rId2", "video", "../media/media1.mp4") +
          `<Relationship Id="rId3" Type="http://schemas.microsoft.com/office/2007/relationships/media" Target="../media/media1.mp4"/>` +
          rel("rId4", "image", "../media/image1.png") +
          rel("rId5", "video", "https://example.invalid/clip.mp4", true),
      ),
    ),
    text("ppt/slides/_rels/slide2.xml.rels", rels(rel("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"))),
    text("ppt/media/media1.mp4", "not really a video"),
    text("ppt/media/image1.png", "not really an image"),
  ]);

describe("embedded media is found and tied to its slide", () => {
  test("a video is reported once, on the slide in presentation order", () => {
    const found = slideMedia(deck());
    assert.deepEqual(found, [
      // slide1.xml is the *second* slide: presentation.xml lists rId3 (slide2.xml) first.
      { slide: 2, name: "media1.mp4", kind: "video", content_type: "video/mp4", size: 18 },
    ]);
  });

  test("the bytes come back by name, and only for media", () => {
    const body = deck();
    assert.equal(readSlideMedia(body, "media1.mp4")?.body.toString("utf8"), "not really a video");
    assert.equal(readSlideMedia(body, "image1.png"), null, "an image is not media");
    assert.equal(readSlideMedia(body, "../presentation.xml"), null, "no path tricks");
    assert.equal(readSlideMedia(body, "missing.mp4"), null);
  });

  test("a deck without media, or no deck at all, is simply empty", () => {
    assert.deepEqual(slideMedia(writeZip([text("ppt/presentation.xml", "<p:presentation/>")])), []);
    assert.deepEqual(slideMedia(Buffer.from("%PDF-1.4 not a zip")), []);
  });
});
