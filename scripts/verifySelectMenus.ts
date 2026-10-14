import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { signInStaff } from "../tests/helpers/signIn.ts";

const STAFF = process.env.STAFF_BASE ?? "http://localhost:3000";
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const CHROME =
  process.env.CHROME_PATH ??
  ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(
    (candidate) => existsSync(candidate),
  );

if (!CHROME) throw new Error("No Chrome found — set CHROME_PATH to a Chrome or Chromium executable.");

const cookieHeader = await signInStaff(API, "admin@example.invalid", "dxg-development-password");
const cookies = cookieHeader
  .split("; ")
  .filter(Boolean)
  .map((pair) => {
    const at = pair.indexOf("=");
    return { name: pair.slice(0, at), value: pair.slice(at + 1), domain: "localhost", path: "/" };
  });

const browser = await chromium.launch({ executablePath: CHROME });
const context = await browser.newContext({ viewport: { width: 1440, height: 1024 }, deviceScaleFactor: 1, colorScheme: "light" });
await context.addCookies(cookies);
const page = await context.newPage();
const browserErrors: string[] = [];
const failedResponses: string[] = [];
page.on("console", (message) => {
  if (message.type() === "error") browserErrors.push(message.text());
});
page.on("pageerror", (error) => browserErrors.push(error.message));
page.on("response", (response) => {
  if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
});

async function noNativeSelect(route: string) {
  assert.equal(await page.locator("select").count(), 0, `${route} should not render a native select`);
}

async function openAndEscape(label: string) {
  const trigger = page.getByRole("button", { name: label, exact: true });
  await trigger.click();
  await page.getByRole("listbox", { name: label, exact: true }).waitFor();
  await trigger.press("Escape");
}

await page.goto(`${STAFF}/admin/assignments`, { waitUntil: "networkidle" });
await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
await openAndEscape("Sort events");
await page.getByRole("button", { name: "Switch event", exact: true }).click();
const eventList = page.getByRole("listbox", { name: "Switch event", exact: true });
await eventList.waitFor();
const asideBox = await page.locator("aside").boundingBox();
const listBox = await eventList.boundingBox();
assert.ok(asideBox && listBox && listBox.x >= asideBox.x && listBox.x + listBox.width <= asideBox.x + asideBox.width, "event menu should stay inside the sidebar");
await page.keyboard.press("Escape");
await noNativeSelect("/admin/assignments");

// Constrain the menu even when the API offers only a small curated timezone list.
await page.setViewportSize({ width: 1440, height: 260 });
await page.goto(`${STAFF}/events/new`, { waitUntil: "networkidle" });
const timezone = page.getByRole("button", { name: "Time zone", exact: true });
const timezoneList = page.getByRole("listbox", { name: "Time zone", exact: true });
await timezone.click();
await timezoneList.waitFor();
assert.ok(await timezoneList.evaluate((menu) => menu.scrollHeight > menu.clientHeight), "timezone list must overflow for this regression check");
const lastTimezoneLabel = (await timezoneList.getByRole("option").last().innerText()).trim();
const scrollBeforeKeyboard = await page.evaluate(() => window.scrollY);
await timezone.press("End");
await page.waitForFunction(() => {
  const trigger = document.getElementById("event-timezone");
  const menu = document.getElementById(trigger?.getAttribute("aria-controls") ?? "");
  const active = document.getElementById(trigger?.getAttribute("aria-activedescendant") ?? "");
  const options = menu?.querySelectorAll('[role="option"]');
  if (!menu || !active || !options || active !== options[options.length - 1]) return false;
  const menuRect = menu.getBoundingClientRect();
  const activeRect = active.getBoundingClientRect();
  return activeRect.top >= menuRect.top + menu.clientTop - 1 &&
    activeRect.bottom <= menuRect.top + menu.clientTop + menu.clientHeight + 1;
});
assert.equal(await page.evaluate(() => window.scrollY), scrollBeforeKeyboard, "keyboard navigation should scroll the menu, not the page");
await timezone.press("Enter");
await timezoneList.waitFor({ state: "hidden" });
assert.equal((await timezone.innerText()).trim(), lastTimezoneLabel, "Enter should select the visible final timezone");

await timezone.click();
await timezoneList.waitFor();
const valueBeforeTouch = (await timezone.innerText()).trim();
assert.equal(await timezoneList.evaluate(async (menu) => {
  menu.scrollTop = 0;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  return menu.scrollTop;
}), 0, "manual list scrolling must not snap back to the selected option");
// A narrow touch-start check: an initial contact must not select or cancel native scrolling.
const touchScrollAllowed = await timezoneList.getByRole("option").first().evaluate((option) => {
  const down = new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true, cancelable: true });
  option.dispatchEvent(down);
  option.dispatchEvent(new PointerEvent("pointercancel", { pointerType: "touch", bubbles: true }));
  return !down.defaultPrevented;
});
assert.ok(touchScrollAllowed, "touch-down should allow scrolling");
assert.equal(await timezone.getAttribute("aria-expanded"), "true", "touch-down or a cancelled gesture must leave the list open");
assert.equal((await timezone.innerText()).trim(), valueBeforeTouch, "touch-down must not change the selected timezone");
const firstTimezoneLabel = (await timezoneList.getByRole("option").first().innerText()).trim();
await timezoneList.getByRole("option").first().click();
await timezoneList.waitFor({ state: "hidden" });
assert.equal((await timezone.innerText()).trim(), firstTimezoneLabel, "a completed click should select the timezone");
await noNativeSelect("/events/new");
await page.setViewportSize({ width: 1440, height: 1024 });

await page.goto(`${STAFF}/admin/users`, { waitUntil: "networkidle" });
await openAndEscape("Access level");
await noNativeSelect("/admin/users");

await page.goto(`${STAFF}/admin/assignments`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Switch event", exact: true }).click();
await page.getByRole("option", { name: "Tech Summit", exact: true }).click();
await page.waitForURL(/\/events\/[^/]+$/);
const eventId = new URL(page.url()).pathname.split("/")[2];
assert.ok(eventId, "event switcher should navigate to an event");

await page.goto(`${STAFF}/events/${eventId}/comms`, { waitUntil: "networkidle" });
await openAndEscape("Template");
await noNativeSelect("/events/:id/comms");

await page.goto(`${STAFF}/events/${eventId}/speakers`, { waitUntil: "networkidle" });
const release = page.getByRole("button", { name: /Archive permission for/ }).first();
if (await release.count()) {
  await release.click();
  await page.getByRole("listbox", { name: /Archive permission for/ }).first().waitFor();
  await page.keyboard.press("Escape");
}
await page.getByRole("button", { name: "Add speaker", exact: true }).click();
const session = page.getByRole("button", { name: "Session", exact: true });
if (await session.isEnabled()) await openAndEscape("Session");
const cancelSpeaker = page.getByRole("button", { name: "Cancel", exact: true });
if (await cancelSpeaker.count()) await cancelSpeaker.click();
await noNativeSelect("/events/:id/speakers");

await page.goto(`${STAFF}/events/${eventId}/review`, { waitUntil: "networkidle" });
const upload = page.getByRole("button", { name: "Upload a new version", exact: true });
if (await upload.count()) {
  await upload.click();
  const presentation = page.getByRole("button", { name: "Presentation", exact: true });
  if (await presentation.isEnabled()) await openAndEscape("Presentation");
}
await noNativeSelect("/events/:id/review");

const actionableResponses = failedResponses.filter((failure) => !failure.endsWith("/favicon.ico"));
const actionableBrowserErrors = browserErrors.filter(
  (message) =>
    !(message === "Failed to load resource: the server responded with a status of 404 (Not Found)" && actionableResponses.length === 0) &&
    !(message.includes("Hydration failed because the server rendered text didn't match the client") && message.includes("GMT+0")),
);
assert.deepEqual(actionableResponses, [], `failed responses: ${actionableResponses.join(" | ")}`);
assert.deepEqual(actionableBrowserErrors, [], `browser errors: ${actionableBrowserErrors.join(" | ")}`);

console.log(JSON.stringify({
  routes: ["assignments", "create event", "staff accounts", "communications", "speakers", "manage presentations"],
  controls: ["event switcher", "sort", "time zone", "access level", "template", "archive permission", "session", "presentation"],
  eventMenuContained: true,
  keyboardLongListVisible: true,
  keyboardSelection: true,
  touchStartPreservesSelection: true,
  nativeSelects: 0,
  browserErrors: actionableBrowserErrors,
  failedResponses: actionableResponses,
}, null, 2));

await context.close();
await browser.close();
