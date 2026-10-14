import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { signInStaff } from "../tests/helpers/signIn.ts";

const STAFF = process.env.STAFF_BASE ?? "http://localhost:3000";
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const OUT = ".data/event-assignments";
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

await mkdir(OUT, { recursive: true });
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

await page.goto(`${STAFF}/admin/assignments`, { waitUntil: "networkidle" });
await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
await page.getByRole("heading", { name: "Event assignments" }).waitFor();
assert.ok((await page.locator("tr:has(.assignment-event-name)").count()) > 0, "event rows should render");
assert.ok((await page.locator("tr:has(.assignment-event-name)").count()) <= 8, "pagination should cap the visible event rows");

const firstPageName = await page.locator(".assignment-event-name").first().innerText();
await page.getByRole("button", { name: "Next page" }).click();
assert.notEqual(await page.locator(".assignment-event-name").first().innerText(), firstPageName, "next page should show a new event slice");
await page.getByRole("button", { name: "Previous page" }).click();

await page.getByRole("button", { name: "Switch event" }).click();
await page.getByRole("listbox", { name: "Switch event" }).waitFor();
await page.screenshot({ path: `${OUT}/sidebar-select-open-1440x1024.png`, fullPage: false });
await page.keyboard.press("Escape");

await page.getByRole("button", { name: "Needs staff", exact: true }).click();
const needsRows = page.locator("tr:has(.assignment-event-name)");
assert.ok((await needsRows.count()) > 0, "the local fixture should include events needing staff");
assert.equal(await needsRows.locator(".assignment-status", { hasText: "Needs staff" }).count(), await needsRows.count());

await page.getByRole("button", { name: "Assigned", exact: true }).click();
const assignedRows = page.locator("tr:has(.assignment-event-name)");
assert.ok((await assignedRows.count()) > 0, "the local fixture should include assigned events");
assert.equal(await assignedRows.locator(".assignment-status", { hasText: "Assigned" }).count(), await assignedRows.count());

await page.getByPlaceholder("Search events…").fill("event-that-does-not-exist");
await page.getByText("No events found", { exact: true }).waitFor();
await page.getByPlaceholder("Search events…").fill("");
await page.getByRole("button", { name: "All events", exact: true }).click();
await page.getByRole("button", { name: "Sort events" }).click();
await page.getByRole("option", { name: "Oldest first" }).click();
await page.getByRole("button", { name: "Sort events" }).click();
await page.getByRole("option", { name: "Upcoming first" }).click();
await page.getByRole("button", { name: "Sort events" }).click();
await page.screenshot({ path: `${OUT}/select-open-1440x1024.png`, fullPage: false });
await page.keyboard.press("Escape");

const manage = page.locator('button[aria-label^="Manage assignments for"]').first();
await manage.click();
await page.getByText("Assign additional staff", { exact: true }).waitFor();
await page.screenshot({ path: `${OUT}/editor-1440x1024.png`, fullPage: false });
await manage.click();

const assign = page.getByRole("button", { name: "Assign staff", exact: true }).first();
if (await assign.count()) {
  await assign.click();
  await page.getByText("Assign additional staff", { exact: true }).waitFor();
  await assign.click();
}

await page.screenshot({ path: `${OUT}/implementation-1440x1024.png`, fullPage: false });

await page.setViewportSize({ width: 390, height: 844 });
await page.reload({ waitUntil: "networkidle" });
await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
await page.screenshot({ path: `${OUT}/implementation-390x844.png`, fullPage: false });
assert.equal(
  await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  true,
  "the mobile page itself should not overflow; the table has its own scroll region",
);

console.log(JSON.stringify({
  route: page.url(),
  rows: await page.locator("tr:has(.assignment-event-name)").count(),
  screenshots: [`${OUT}/implementation-1440x1024.png`, `${OUT}/select-open-1440x1024.png`, `${OUT}/sidebar-select-open-1440x1024.png`, `${OUT}/editor-1440x1024.png`, `${OUT}/implementation-390x844.png`],
  interactions: ["pagination", "sidebar event menu", "needs-staff filter", "assigned filter", "search empty state", "custom sort menu", "assigned editor", "unassigned editor", "mobile overflow"],
  browserErrors,
  failedResponses,
}, null, 2));

const actionableResponses = failedResponses.filter((failure) => !failure.endsWith("/favicon.ico"));
const actionableBrowserErrors = browserErrors.filter(
  (message) => !(message === "Failed to load resource: the server responded with a status of 404 (Not Found)" && actionableResponses.length === 0),
);
assert.deepEqual(actionableResponses, [], `failed responses: ${actionableResponses.join(" | ")}`);
assert.deepEqual(actionableBrowserErrors, [], `browser errors: ${actionableBrowserErrors.join(" | ")}`);

await context.close();
await browser.close();
