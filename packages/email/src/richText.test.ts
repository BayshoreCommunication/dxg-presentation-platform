import { test } from "node:test";
import assert from "node:assert/strict";
import { fillHtml, htmlToText, sanitizeEmailHtml, textToHtml } from "./richText.ts";

test("formatting the toolbar makes is kept", () => {
  const html = sanitizeEmailHtml(
    '<p style="text-align: center"><strong>Bold</strong> <em>it</em> <u>u</u> <s>s</s> <sup>2</sup>' +
      '<span style="color: #e60000; background-color: #ffff00; font-family: serif; font-size: 18px">x</span></p>' +
      '<ul><li>one</li></ul><ol><li>first</li></ol><p><a href="https://example.com/tips">Tips</a></p>',
  );
  for (const kept of ["<strong>Bold</strong>", "<em>it</em>", "<u>u</u>", "<s>s</s>", "<sup>2</sup>", "<ul><li>one</li></ul>", "<ol><li>first</li></ol>"]) {
    assert.ok(html.includes(kept), kept);
  }
  assert.match(html, /text-align:center/);
  assert.match(html, /color:#e60000/);
  assert.match(html, /font-family:serif/);
  assert.match(html, /href="https:\/\/example\.com\/tips"/);
});

test("anything that could run, or reach elsewhere, is removed", () => {
  const html = sanitizeEmailHtml(
    '<p onclick="steal()">hi<script>alert(1)</script></p><a href="javascript:alert(1)">x</a>' +
      '<img src="data:image/png;base64,AAAA" onerror="x()"><iframe src="https://evil"></iframe>' +
      '<span style="position:fixed;background:url(https://evil/x)">y</span><form><input></form>',
  );
  assert.ok(!/script|onclick|onerror|javascript:|data:|iframe|position|url\(|<form|<input/i.test(html), html);
});

test("plain text becomes the editor's lines, and back", () => {
  const text = "Hi {{speaker_first}},\n\nPlease upload <now>.\n{{upload_link}}";
  const html = textToHtml(text);
  assert.equal(html, "<p>Hi {{speaker_first}},</p><p><br></p><p>Please upload &lt;now&gt;.</p><p>{{upload_link}}</p>");
  assert.equal(htmlToText(html), text);
});

test("the plain-text twin shows bullets, numbers and where links go", () => {
  const text = htmlToText(
    '<p>Formats:</p><ul><li>PowerPoint</li><li>PDF</li></ul><ol><li>Upload</li><li>Check</li></ol>' +
      '<p>See <a href="https://example.com/tips">the tips page</a> or https://example.com/raw.</p>',
  );
  assert.equal(text, "Formats:\n• PowerPoint\n• PDF\n1. Upload\n2. Check\nSee the tips page (https://example.com/tips) or https://example.com/raw.");
});

test("merge fields are filled as text, never markup, and the upload link is a link", () => {
  const html = fillHtml("<p>Hi {{speaker_first}}, {{upload_link}} {{presentations}} {{unknown}}</p>", {
    speaker_first: "<b>Ana</b>",
    upload_link: "https://speakers.example.com/t/abc",
    presentations: "• One\n• Two",
  });
  assert.ok(html.includes("&lt;b&gt;Ana&lt;/b&gt;"));
  assert.ok(html.includes('<a href="https://speakers.example.com/t/abc">https://speakers.example.com/t/abc</a>'));
  assert.ok(html.includes("• One<br>• Two"));
  assert.ok(html.includes("{{unknown}}"), "an unknown field is left for validation to catch");
});

test("the editor's blank lines survive as blank lines, and paragraphs lose the mail client's margin", () => {
  const html = sanitizeEmailHtml("<p>Hi</p><p></p><p>Bye&nbsp;now</p>");
  assert.equal(html, '<p style="margin:0">Hi</p><p style="margin:0"><br /></p><p style="margin:0">Bye now</p>');
  assert.equal(htmlToText(html), "Hi\n\nBye now");
});

test("the editor's bulleted list is kept as a list", () => {
  const html = sanitizeEmailHtml('<ul><li data-list="bullet">One</li></ul><p><strong>Bold</strong></p>');
  assert.match(html, /<ul><li>One<\/li><\/ul>/);
  assert.match(html, /<strong>Bold<\/strong>/);
});

