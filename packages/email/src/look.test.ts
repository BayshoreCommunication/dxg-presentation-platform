import { test } from "node:test";
import assert from "node:assert/strict";
import { fromHeader, renderEmailHtml } from "./look.ts";

test("the banner, the button and the message appear in that order", () => {
  const html = renderEmailHtml({
    subject: "Upload your deck",
    body: "Hi Ana,\n\nPlease upload.",
    banner_url: "https://speakers.example.com/api/v1/email-banner/e1?v=abc",
    button: { label: "Upload your presentation", url: "https://speakers.example.com/t/123" },
    event_name: "MedTech Forward",
  });
  const banner = html.indexOf("email-banner/e1");
  const button = html.indexOf("Upload your presentation");
  const message = html.indexOf("Please upload.");
  assert.ok(banner > 0 && button > banner && message > button, "banner, then button, then message");
  assert.match(html, /alt="MedTech Forward"/);
});

test("the message is escaped and its web links become links", () => {
  const html = renderEmailHtml({
    subject: "s",
    body: "<script>alert(1)</script> see https://example.com/x.",
  });
  assert.ok(!html.includes("<script>alert"), "markup in a template is shown, never run");
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<a href="https:\/\/example\.com\/x"[^>]*>https:\/\/example\.com\/x<\/a>\./, "the full stop stays outside the link");
});

test("only web addresses are ever linked or loaded", () => {
  const html = renderEmailHtml({
    subject: "s",
    body: "javascript:alert(1)",
    banner_url: "javascript:alert(1)",
    button: { label: "Go", url: "javascript:alert(1)" },
  });
  assert.ok(!/href="javascript/i.test(html));
  assert.ok(!/src="javascript/i.test(html));
  assert.ok(!html.includes(">Go<"), "a button with an unsafe link is left out");
});

test("without a banner the event name heads the email", () => {
  const html = renderEmailHtml({ subject: "s", body: "b", event_name: "NeuroSummit" });
  assert.ok(!html.includes("<img"));
  assert.match(html, />NeuroSummit</);
});

test("blank lines make paragraphs; single breaks stay inside one", () => {
  const html = renderEmailHtml({ subject: "s", body: "one\ntwo\n\nthree" });
  assert.match(html, />one<br>two<\/p>/);
  assert.match(html, />three<\/p>/);
});

test("the From header carries the sender name, encoded when it needs to be", () => {
  assert.equal(fromHeader("noreply@x.com", "DXG Events"), '"DXG Events" <noreply@x.com>');
  assert.equal(fromHeader("noreply@x.com", ""), "noreply@x.com");
  assert.equal(fromHeader("noreply@x.com", 'Evil"\r\nBcc: a@b.c'), '"EvilBcc: a@b.c" <noreply@x.com>', "no header injection");
  assert.match(fromHeader("noreply@x.com", "Café Expo"), /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <noreply@x\.com>$/);
});
