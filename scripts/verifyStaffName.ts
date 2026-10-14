import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";
import { signInStaff } from "../tests/helpers/signIn.ts";
import { removeTestAccounts } from "../tests/helpers/cleanup.ts";
import { closePool } from "@pmp/db";

const STAFF = process.env.STAFF_BASE ?? "http://localhost:3000";
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(STAFF) || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/api\/v1$/.test(API)) {
  throw new Error("Staff name verification creates a disposable account and must run locally.");
}
if (!/^pmp_(dev|test)/.test(process.env.PGDATABASE ?? "pmp_dev")) {
  throw new Error("Staff name verification requires a development database.");
}
const CHROME = process.env.CHROME_PATH ?? [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium",
].find(existsSync);
if (!CHROME) throw new Error("No Chrome found — set CHROME_PATH.");

const run = Date.now();
const email = `name-ui-${run}@example.invalid`;
const original = `Name QA ${run}`;
const renamed = `Renamed Staff QA ${run}`;
const cookies = (await signInStaff(API, "admin@example.invalid", "dxg-development-password"))
  .split("; ").filter(Boolean).map(pair => {
    const at = pair.indexOf("=");
    return { name: pair.slice(0, at), value: pair.slice(at + 1), domain: "localhost", path: "/" };
  });
const browser = await chromium.launch({ executablePath: CHROME });
let userId: string | undefined;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await context.addCookies(cookies);
  const created = await context.request.post(`${API}/admin/users`, {
    data: { email, display_name: original, account_type: "support" },
  });
  assert.equal(created.status(), 201);
  userId = (await created.json() as { user_id: string }).user_id;
  const page = await context.newPage();
  const failures: string[] = [];
  page.on("pageerror", error => failures.push(error.message));
  page.on("response", response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
  await page.goto(`${STAFF}/admin/users`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Staff accounts", exact: true }).waitFor();
  const search = page.getByPlaceholder("Search name, email or access level…");
  await search.fill(email);
  await page.getByRole("button", { name: `Manage ${original}`, exact: true }).click();
  await page.getByRole("button", { name: "Change name", exact: true }).click();
  const input = page.getByRole("form", { name: /^Change name for / }).getByRole("textbox", { name: "Name", exact: true });
  assert.equal(await input.inputValue(), original);
  assert.equal(await input.getAttribute("maxlength"), "200");
  assert.equal(await page.getByRole("button", { name: "Save name", exact: true }).isEnabled(), false);
  await input.fill("Cancelled name");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.locator(".staff-account-identity strong").innerText(), original);
  await page.getByRole("button", { name: "Change name", exact: true }).click();
  await input.fill("   ");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await page.getByRole("alert").getByText("Enter a name, not just spaces.", { exact: true }).waitFor();
  await input.fill(`  ${renamed}  `);
  let releaseSave!: () => void;
  let saveStarted!: () => void;
  const holdSave = new Promise<void>(resolve => { releaseSave = resolve; });
  const started = new Promise<void>(resolve => { saveStarted = resolve; });
  await page.route(/\/api\/v1\/admin\/users\/[^/]+\/name$/, async route => {
    saveStarted();
    await holdSave;
    await route.continue();
  });
  const saved = page.waitForResponse(response => response.url().endsWith(`/admin/users/${userId}/name`) && response.request().method() === "POST");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await started;
  assert.equal(await page.getByRole("button", { name: "Change name", exact: true }).isEnabled(), false, "Other actions stay disabled while saving");
  assert.equal(await page.getByRole("button", { name: `Manage ${original}`, exact: true }).isEnabled(), false);
  releaseSave();
  assert.equal((await saved).status(), 200);
  await page.unroute(/\/api\/v1\/admin\/users\/[^/]+\/name$/);
  await page.getByRole("status").getByRole("heading", { name: `Name changed to ${renamed}.`, exact: true }).waitFor();
  await page.getByRole("button", { name: `Manage ${renamed}`, exact: true }).waitFor();
  assert.equal(await page.locator(".staff-account-identity .assignment-avatar").innerText(), "RS");
  await page.reload({ waitUntil: "networkidle" });
  await search.fill(email);
  assert.equal(await page.locator(".staff-account-identity strong").innerText(), renamed);
  const listed = await context.request.get(`${API}/admin/users`);
  const account = (await listed.json() as { items: { id: string; email: string; display_name: string; account_type: string }[] }).items.find(item => item.id === userId);
  assert.equal(account?.display_name, renamed);
  assert.equal(account?.email, email);
  assert.equal(account?.account_type, "support");
  await page.getByRole("button", { name: `Manage ${renamed}`, exact: true }).click();
  await page.getByRole("button", { name: "Change name", exact: true }).click();
  await mkdir(".data/staff-accounts", { recursive: true });
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.screenshot({ path: ".data/staff-accounts/change-name.png", fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  assert(await input.isVisible());
  assert(await page.getByRole("button", { name: "Save name", exact: true }).isVisible());
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1100 });
  await search.fill("admin@example.invalid");
  await page.locator('button[aria-label^="Manage "]').click();
  assert(await page.getByRole("button", { name: "Change name", exact: true }).isEnabled(), "An admin can edit their own display name");
  await page.getByRole("button", { name: "Change name", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.deepEqual(failures, []);
  console.log(JSON.stringify({ result: "pass", renamePersisted: true, cancel: true, blankRejected: true, nameTrimmed: true, avatarUpdated: true, emailAndAccessPreserved: true, ownNameEditable: true, mobile: "pass", browserErrors: failures }));
} finally {
  await browser.close();
  await removeTestAccounts([email]);
  await closePool();
}
