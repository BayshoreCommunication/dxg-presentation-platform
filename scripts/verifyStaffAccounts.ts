import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";
import { signInStaff } from "../tests/helpers/signIn.ts";

const STAFF = process.env.STAFF_BASE ?? "http://localhost:3000";
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const OUT = ".data/staff-accounts";
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

await page.goto(`${STAFF}/admin/users`, { waitUntil: "networkidle" });
await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
await page.getByRole("heading", { name: "Staff accounts" }).waitFor();

const settingsButton = page.getByRole("button", { name: "Settings", exact: true });
const settingsTriggerIcon = settingsButton.locator("svg");
const helpLink = page.getByRole("link", { name: "Help", exact: true });
assert.equal(await helpLink.locator("svg").count(), 1, "Help should use a recognizable question-circle icon");
assert.equal(await helpLink.evaluate((element) => getComputedStyle(element).height), "36px", "Help should share the top-bar control height");
assert.equal(await settingsButton.evaluate((element) => getComputedStyle(element).height), "36px", "Settings should share the top-bar control height");
assert.equal(await settingsButton.evaluate((element) => getComputedStyle(element).width), "36px", "Settings should use a balanced square button");
assert.equal(await settingsTriggerIcon.count(), 1, "settings should use one recognizable icon");
assert.equal(await settingsTriggerIcon.getAttribute("viewBox"), "0 0 24 24", "settings should use the standard 24px gear icon");
assert.equal(await settingsTriggerIcon.evaluate((element) => getComputedStyle(element).width), "18px", "settings gear should be optically clear");
await settingsButton.click();
const settingsMenu = page.getByRole("menu");
assert.equal(await settingsMenu.locator(".item > svg").count(), 5, "each account and appearance setting should have a meaningful icon");
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/settings-icons-1440x1024.png`, fullPage: false });
await page.getByRole("button", { name: "Settings", exact: true }).click();

await page.evaluate(() => window.localStorage.setItem("dxg.theme", "dark"));
await page.reload({ waitUntil: "networkidle" });
await page.getByRole("button", { name: "Settings", exact: true }).click();
assert.equal(await page.locator("html").getAttribute("data-theme"), "dark", "the icon menu should remain legible in dark theme");
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/settings-icons-dark-1440x1024.png`, fullPage: false });
await page.getByRole("button", { name: "Settings", exact: true }).click();
await page.evaluate(() => window.localStorage.setItem("dxg.theme", "light"));
await page.reload({ waitUntil: "networkidle" });
await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });

await page.getByRole("button", { name: "Access level", exact: true }).click();
const accessList = page.getByRole("listbox", { name: "Access level", exact: true });
await accessList.waitFor();
assert.equal(await page.getByRole("button", { name: "Access level", exact: true }).locator(".select-menu-option-icon > svg").count(), 1, "selected access level should keep its role icon");
assert.equal(await accessList.locator(".select-menu-option-icon > svg").count(), 4, "every access level should have a meaningful role icon");
assert.equal(await accessList.evaluate((element) => getComputedStyle(element).position), "fixed", "select menus should escape card clipping");
assert.ok(Number(await accessList.evaluate((element) => getComputedStyle(element).zIndex)) >= 10000, "select menus should layer above surrounding content");
await page.screenshot({ path: `${OUT}/select-over-content-1440x1024.png`, fullPage: false });
await page.keyboard.press("Escape");

const accountRows = () => page.locator(".staff-accounts-table tbody > tr:not(.assignment-editor-row)");
assert.ok((await accountRows().count()) > 0, "staff rows should render");
assert.ok((await accountRows().count()) <= 8, "pagination should cap the visible staff rows");

const search = page.getByPlaceholder("Search name, email or access level…");
await search.fill("delgado");
assert.equal(await accountRows().count(), 1, "search should narrow staff rows");
await search.fill("");

await page.getByRole("button", { name: "Active", exact: true }).click();
assert.ok((await accountRows().count()) > 0, "active accounts should render");
assert.equal(await page.locator(".staff-security-status", { hasText: "Deactivated" }).count(), 0, "active filter should exclude deactivated accounts");

await page.getByRole("button", { name: "Deactivated", exact: true }).click();
assert.ok((await accountRows().count()) > 0, "deactivated accounts should render");
assert.equal(await page.locator(".staff-security-status", { hasText: "Deactivated" }).count(), await accountRows().count());

await page.getByRole("button", { name: "All accounts", exact: true }).click();
const firstPageName = await page.locator(".staff-account-identity strong").first().innerText();
const next = page.getByRole("button", { name: "Next page", exact: true });
if (await next.count()) {
  await next.click();
  assert.notEqual(await page.locator(".staff-account-identity strong").first().innerText(), firstPageName, "next page should show a new account slice");
  await page.getByRole("button", { name: "Previous page", exact: true }).click();
}

const manage = page.locator('button[aria-label^="Manage "]').nth(1);
const arrow = manage.locator("svg");
assert.equal(await arrow.evaluate((element) => getComputedStyle(element).transform), "none", "closed row should show the down arrow without rotation");
await manage.click();
await page.getByText("Password, sign-in security and account access.", { exact: true }).waitFor();
assert.notEqual(await arrow.evaluate((element) => getComputedStyle(element).transform), "none", "open row should rotate the arrow upward");

const actionPanel = page.locator(".staff-account-actions");
const actionColors = await Promise.all([
  actionPanel.getByRole("button", { name: "Reset password", exact: true }),
  actionPanel.getByRole("button", { name: "Reset sign-in app", exact: true }),
  actionPanel.getByRole("button", { name: "Change access level", exact: true }),
  actionPanel.getByRole("button", { name: "Deactivate", exact: true }),
  actionPanel.getByRole("button", { name: "Delete", exact: true }),
].map((button) => button.evaluate((element) => getComputedStyle(element).color)));
assert.equal(new Set(actionColors).size, 4, "security, warning, access and destructive actions should use distinct semantic colors");
await page.screenshot({ path: `${OUT}/editor-1440x1024.png`, fullPage: false });

await page.getByRole("button", { name: "Change access level", exact: true }).click();
await page.getByRole("button", { name: /New access level for/ }).waitFor();
await page.getByRole("button", { name: "Cancel", exact: true }).click();
await manage.click();
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/implementation-1440x1024.png`, fullPage: false });

await page.setViewportSize({ width: 390, height: 844 });
await page.reload({ waitUntil: "networkidle" });
await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
await page.screenshot({ path: `${OUT}/implementation-390x844.png`, fullPage: false });
assert.equal(
  await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  true,
  "the mobile page itself should not overflow; the table owns its horizontal scroll",
);

const actionableResponses = failedResponses.filter((failure) => !failure.endsWith("/favicon.ico"));
const actionableBrowserErrors = browserErrors.filter(
  (message) => !(message === "Failed to load resource: the server responded with a status of 404 (Not Found)" && actionableResponses.length === 0),
);
assert.deepEqual(actionableResponses, [], `failed responses: ${actionableResponses.join(" | ")}`);
assert.deepEqual(actionableBrowserErrors, [], `browser errors: ${actionableBrowserErrors.join(" | ")}`);

console.log(JSON.stringify({
  route: page.url(),
  screenshots: [`${OUT}/implementation-1440x1024.png`, `${OUT}/editor-1440x1024.png`, `${OUT}/settings-icons-1440x1024.png`, `${OUT}/settings-icons-dark-1440x1024.png`, `${OUT}/select-over-content-1440x1024.png`, `${OUT}/implementation-390x844.png`],
  interactions: ["balanced Help and Settings controls", "recognizable settings gear", "settings icons", "access-level icons", "select layering", "search", "active filter", "deactivated filter", "pagination", "accordion arrow", "semantic action colors", "capitalized action labels", "manage panel", "change-access confirmation", "mobile overflow"],
  browserErrors: actionableBrowserErrors,
  failedResponses: actionableResponses,
}, null, 2));

await context.close();
await browser.close();
