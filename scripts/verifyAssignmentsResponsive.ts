import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { signInStaff } from "../tests/helpers/signIn.ts";

const STAFF = process.env.STAFF_BASE ?? "http://localhost:3000";
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const OUT = ".data/event-assignments-responsive";
const LABEL = process.argv.find((arg) => arg.startsWith("--label="))?.slice(8) ?? "after";
const captureOnly = process.argv.includes("--capture-only");
const widths = process.argv.find((arg) => arg.startsWith("--widths="))?.slice(9).split(",").map(Number) ?? [320, 375, 390, 430, 768, 1024, 1440, 1920];
const CHROME = process.env.CHROME_PATH ?? [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((candidate) => existsSync(candidate));
if (!CHROME) throw new Error("No Chrome executable found.");

const cookie = await signInStaff(API, "admin@example.invalid", "dxg-development-password");
const origin = new URL(STAFF);
const browser = await chromium.launch({ executablePath: CHROME });
const context = await browser.newContext({ deviceScaleFactor: 1, colorScheme: "light" });
await context.addCookies(cookie.split("; ").filter(Boolean).map((pair) => {
  const at = pair.indexOf("=");
  return { name: pair.slice(0, at), value: pair.slice(at + 1), domain: origin.hostname, path: "/" };
}));
const page = await context.newPage();
const errors: string[] = [];
const failures: string[] = [];
const results: unknown[] = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
page.on("response", (response) => {
  if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) failures.push(`${response.status()} ${response.url()}`);
});
await mkdir(OUT, { recursive: true });

try {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1024 });
    await page.goto(`${STAFF}/admin/assignments`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Event assignments", exact: true }).waitFor();
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await page.evaluate(() => document.fonts.ready);
    const geometry = await page.evaluate(() => {
      const bounds = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector)!;
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
      };
      const pills = Array.from(document.querySelectorAll<HTMLButtonElement>(".assignment-filters button")).map((button) => {
        const lines = Array.from(button.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()).flatMap((node) => {
          const range = document.createRange();
          range.selectNodeContents(node);
          return Array.from(range.getClientRects()).map((rect) => rect.top);
        });
        return { label: button.textContent?.trim(), textLines: new Set(lines).size, ...bounds(`.assignment-filters button:nth-child(${Array.from(button.parentElement!.children).indexOf(button) + 1})`) };
      });
      const wrap = document.querySelector<HTMLElement>(".assignment-table-wrap")!;
      const actionClipping = Array.from(document.querySelectorAll<HTMLButtonElement>(".assignment-table tbody tr:not(.assignment-editor-row) td:last-child button")).filter((button) => {
        const rect = button.getBoundingClientRect();
        const cell = button.closest("td")!.getBoundingClientRect();
        return rect.left < cell.left - 1 || rect.right > cell.right + 1;
      }).map((button) => button.textContent?.trim());
      return { viewport: window.innerWidth, pageWidth: document.documentElement.scrollWidth, toolbar: bounds(".assignment-toolbar"), search: bounds(".assignment-search"), sort: bounds(".assignment-toolbar-end"), pills, table: { scrollWidth: wrap.scrollWidth, clientWidth: wrap.clientWidth }, actionClipping };
    });
    const widthIssues: string[] = [];
    if (geometry.pageWidth > width + 1) widthIssues.push("page horizontal overflow");
    if (geometry.pills.some((pill) => pill.textLines !== 1)) widthIssues.push("filter text wraps");
    if (geometry.pills.some((pill) => pill.x < geometry.toolbar.x - 1 || pill.right > geometry.toolbar.right + 1)) widthIssues.push("filter clips toolbar");
    if (geometry.search.x < 0 || geometry.search.right > width + 1 || geometry.sort.x < 0 || geometry.sort.right > width + 1) widthIssues.push("toolbar controls outside viewport");
    if (geometry.actionClipping.length) widthIssues.push("row action clips its cell");
    await page.screenshot({ path: `${OUT}/${LABEL}-${width}.png`, fullPage: false, animations: "disabled" });

    await page.getByRole("button", { name: "Sort events", exact: true }).click();
    const sortMenu = page.getByRole("listbox", { name: "Sort events", exact: true });
    await sortMenu.waitFor();
    await page.waitForFunction(() => Boolean(document.querySelector<HTMLElement>(".select-menu-list")?.style.left));
    const sortPopup = await sortMenu.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, onTop: element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + 15)) };
    });
    if (sortPopup.left < 0 || sortPopup.right > width + 1 || sortPopup.top < 0 || sortPopup.bottom > (width < 768 ? 844 : 1024) + 1 || !sortPopup.onTop) widthIssues.push("sort menu viewport/layer failure");
    await page.keyboard.press("Escape");

    const assignButton = page.getByRole("button", { name: "Assign staff", exact: true }).first();
    let editorGeometry: unknown = null;
    let staffPopup: unknown = null;
    const selectedLabels: unknown[] = [];
    if (await assignButton.count()) {
      await assignButton.click();
      await page.getByText("Assign additional staff", { exact: true }).waitFor();
      await page.locator(".assignment-table-wrap").evaluate((element) => { element.scrollLeft = 0; });
      editorGeometry = await page.locator(".assignment-editor").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const wrap = element.closest(".assignment-table-wrap")!.getBoundingClientRect();
        const controls = Array.from(element.querySelectorAll<HTMLButtonElement>(".assignment-add-controls button")).map((button) => {
          const box = button.getBoundingClientRect();
          return { label: button.textContent?.trim(), left: box.left, right: box.right };
        });
        return { left: rect.left, right: rect.right, wrapLeft: wrap.left, wrapRight: wrap.right, controls };
      });
      const editor = editorGeometry as { left: number; right: number; wrapLeft: number; wrapRight: number; controls: { left: number; right: number }[] };
      if (editor.left < editor.wrapLeft - 1 || editor.right > editor.wrapRight + 1 || editor.controls.some((button) => button.left < editor.wrapLeft - 1 || button.right > editor.wrapRight + 1)) widthIssues.push("accordion controls outside scroll viewport");
      await page.locator(".assignment-editor").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}/${LABEL}-editor-${width}.png`, fullPage: false, animations: "disabled" });
      const staffTrigger = page.locator(".assignment-editor .assignment-staff-select button");
      if (await staffTrigger.isEnabled()) {
        await staffTrigger.click();
        const staffMenu = page.locator(".select-menu-list");
        await staffMenu.waitFor();
        await page.waitForFunction(() => Boolean(document.querySelector<HTMLElement>(".select-menu-list")?.style.left));
        staffPopup = await staffMenu.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, onTop: element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + 15)) };
        });
        const popup = staffPopup as { left: number; right: number; top: number; bottom: number; onTop: boolean };
        if (popup.left < 0 || popup.right > width + 1 || popup.top < 0 || popup.bottom > (width < 768 ? 844 : 1024) + 1 || !popup.onTop) widthIssues.push("staff menu viewport/layer failure");
        const probes = await page.locator(".assignment-editor .select-menu-sizer > span:not(.select-menu-group)").evaluateAll((elements) => elements.slice(1).map((element) => ({
          label: element.textContent ?? "", width: element.getBoundingClientRect().width, fontSize: getComputedStyle(element).fontSize, fontFamily: getComputedStyle(element).fontFamily,
        })).sort((a, b) => b.width - a.width));
        const menuFont = await staffMenu.evaluate((element) => ({ fontSize: getComputedStyle(element).fontSize, fontFamily: getComputedStyle(element).fontFamily }));
        if (probes.some((probe) => probe.fontSize !== menuFont.fontSize || probe.fontFamily !== menuFont.fontFamily)) widthIssues.push("select sizing font differs from portaled menu");
        await page.screenshot({ path: `${OUT}/${LABEL}-staff-menu-${width}.png`, fullPage: false, animations: "disabled" });
        const supportOption = staffMenu.getByRole("option", { name: "M. Vega — DXG Support staff", exact: true });
        if (await supportOption.count()) {
          await supportOption.click();
          const selectedText = await staffTrigger.locator(".select-menu-value > span:last-child").evaluate((element) => ({ width: element.clientWidth, naturalWidth: element.scrollWidth }));
          selectedLabels.push({ label: "M. Vega — DXG Support staff", ...selectedText });
          if (width >= 1024 && selectedText.naturalWidth > selectedText.width + 1) widthIssues.push("ordinary selected staff label is unnecessarily truncated");
          await page.screenshot({ path: `${OUT}/${LABEL}-selected-staff-${width}.png`, fullPage: false, animations: "disabled" });
        } else await page.keyboard.press("Escape");
        const longest = probes[0];
        if (longest) {
          await staffTrigger.click();
          await staffMenu.getByRole("option", { name: longest.label, exact: true }).click();
          const selectedText = await staffTrigger.locator(".select-menu-value > span:last-child").evaluate((element) => ({ width: element.clientWidth, naturalWidth: element.scrollWidth }));
          if (width >= 1024 && selectedText.naturalWidth > selectedText.width + 1) widthIssues.push("long selected staff label is unnecessarily truncated");
          await page.screenshot({ path: `${OUT}/${LABEL}-selected-long-staff-${width}.png`, fullPage: false, animations: "disabled" });
          await staffTrigger.click();
          const selectedOption = staffMenu.getByRole("option", { name: longest.label, exact: true });
          const optionText = await selectedOption.locator(".select-menu-option-content > span:last-child").evaluate((element) => ({ width: element.clientWidth, naturalWidth: element.scrollWidth, overflow: getComputedStyle(element).textOverflow }));
          const fitsViewport = longest.width + 67 <= width - 16;
          if (fitsViewport && optionText.naturalWidth > optionText.width + 1) widthIssues.push("long menu label truncates despite available viewport space");
          if (!fitsViewport && optionText.naturalWidth > optionText.width + 1 && optionText.overflow !== "ellipsis") widthIssues.push("viewport-constrained label lacks ellipsis");
          selectedLabels.push({ label: longest.label, probe: longest, trigger: selectedText, menu: optionText, fitsViewport });
          await page.screenshot({ path: `${OUT}/${LABEL}-selected-long-menu-${width}.png`, fullPage: false, animations: "disabled" });
          await page.keyboard.press("Escape");
        }
      }
    }
    await page.getByRole("button", { name: "Assigned", exact: true }).click();
    const manage = page.locator('button[aria-label^="Manage assignments for"]').first();
    let assignedEditor = false;
    if (await manage.count()) {
      assignedEditor = true;
      await manage.click();
      await page.locator(".assignment-table-wrap").evaluate((element) => { element.scrollLeft = element.scrollWidth; });
      const assignedBounds = await page.locator(".assignment-editor").evaluate((element) => {
        const wrap = element.closest(".assignment-table-wrap")!.getBoundingClientRect();
        return Array.from(element.querySelectorAll<HTMLElement>(".assignment-current-person,.assignment-person-copy,.assignment-person-alert,.assignment-role-count,.assignment-remove-button,.assignment-add-controls button")).every((item) => {
          const rect = item.getBoundingClientRect();
          return rect.left >= wrap.left - 1 && rect.right <= wrap.right + 1 && (!item.classList.contains("assignment-person-copy") || rect.width >= 50);
        });
      });
      if (!assignedBounds) widthIssues.push("assigned editor clips when table scrolls right");
      await page.locator(".assignment-editor").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}/${LABEL}-assigned-editor-${width}.png`, fullPage: false, animations: "disabled" });
      await manage.click();
    }
    await page.getByRole("button", { name: "All events", exact: true }).click();
    const finished = page.locator("details").filter({ has: page.getByText(/^Finished events ·/) });
    let historyGeometry: unknown = null;
    if (await finished.count()) {
      await finished.locator("summary").click();
      historyGeometry = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }));
      if ((historyGeometry as { width: number }).width > width + 1) widthIssues.push("finished history causes page overflow");
      await finished.locator("summary").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}/${LABEL}-history-${width}.png`, fullPage: false, animations: "disabled" });
      await finished.locator("summary").click();
    }
    results.push({ width, issues: widthIssues, geometry, sortPopup, editorGeometry, staffPopup, selectedLabels, assignedEditor, historyGeometry });
  }
  const actionableErrors = errors.filter((error) => !(error === "Failed to load resource: the server responded with a status of 404 (Not Found)" && failures.length === 0));
  console.log(JSON.stringify({ label: LABEL, results, errors: actionableErrors, failedResponses: failures, output: OUT }, null, 2));
  if (!captureOnly) {
    assert.deepEqual(results.flatMap((result) => (result as { width: number; issues: string[] }).issues.map((issue) => `${(result as { width: number }).width}: ${issue}`)), []);
    assert.deepEqual(actionableErrors, []);
    assert.deepEqual(failures, []);
  }
} finally {
  await context.close();
  await browser.close();
}
