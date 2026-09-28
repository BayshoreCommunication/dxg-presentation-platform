/**
 * Captures the VISUAL_ACCEPTANCE §3 sheet: every baseline screen next to the same screen
 * in the built app (D-104). Re-run it at each milestone that touches UI and compare with
 * the approved sheet.
 *
 *   npm run dev                 # the full local stack, seeded (npm run db:seed)
 *   npm run visual:capture      # all 17 screens
 *   npm run visual:capture -- portfolio,review   # just these
 *
 * Writes `.data/visual-sheet/<screen>-baseline.png` and `<screen>-app.png` at 1440×900
 * (full page, 2× pixels), plus `-375` phone captures for the two portals. Uses the Chrome
 * installed on this machine (set CHROME_PATH to another Chromium if needed).
 *
 * Development data only: it signs in with the seeded accounts, and issuing the demo
 * speaker's portal code replaces the one they had.
 */
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { withSystemScope, closePool } from "@pmp/db";
import { signInStaff } from "../tests/helpers/signIn.ts";

const STAFF = process.env.STAFF_BASE ?? "http://localhost:3000";
const PORTAL = process.env.PORTAL_BASE ?? "http://localhost:3001";
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const OUT = ".data/visual-sheet/";
const PASSWORD = "dxg-development-password";
const EVENT = "22222222-2222-4222-8222-222222222222"; // MedTech Forward 2026 (seed)
const TALK = "Robotic Surgery Outcomes: Five-Year Data";
const ROOM = "Ballroom A";
const SPEAKER_EMAIL = "p.raman@example.invalid";

const CHROME =
  process.env.CHROME_PATH ??
  ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(
    (candidate) => existsSync(candidate),
  );
if (!CHROME) throw new Error("No Chrome found — set CHROME_PATH to a Chrome or Chromium executable.");

// The seeded talk, room and latest check-in; their ids are random per seed.
const ids = await withSystemScope(async (tx) => {
  const one = async (sql: string, params: unknown[]) => (await tx.query<{ id: string }>(sql, params)).rows[0]?.id;
  return {
    slot: await one(`SELECT id FROM pmp.slots WHERE event_id = $1 AND title = $2`, [EVENT, TALK]),
    room: await one(`SELECT id FROM pmp.rooms WHERE event_id = $1 AND name = $2`, [EVENT, ROOM]),
    checkin: await one(`SELECT id FROM pmp.srr_checkins WHERE event_id = $1 ORDER BY checked_in_at DESC LIMIT 1`, [EVENT]),
  };
});
await closePool();
if (!ids.slot || !ids.room) throw new Error("The seeded demo event is missing — run `npm run db:seed`.");
if (!ids.checkin) console.error("! no check-in on the demo event yet: Check-in and USB intake will show the SRR list");

type Who = "staff" | "client" | "presenter";
type Screen = { key: string; baseline: string; url: string; who: Who; phone?: boolean; openUsb?: boolean };
const E = EVENT;
const CHECKIN = ids.checkin ? `${STAFF}/events/${E}/srr/${ids.checkin}` : `${STAFF}/events/${E}/srr`;
// `baseline` is the label of the baseline prototype's sidebar button for that screen.
const ALL: Screen[] = [
  { key: "portfolio", baseline: "Portfolio", url: `${STAFF}/`, who: "staff" },
  { key: "wizard", baseline: "Create event", url: `${STAFF}/events/new`, who: "staff" },
  { key: "import", baseline: "Schedule import", url: `${STAFF}/events/${E}/import`, who: "staff" },
  { key: "command", baseline: "Command center", url: `${STAFF}/events/${E}`, who: "staff" },
  { key: "speakers", baseline: "Speakers", url: `${STAFF}/events/${E}/speakers`, who: "staff" },
  { key: "detail", baseline: "Presentation detail", url: `${STAFF}/events/${E}/talks/${ids.slot}`, who: "staff" },
  { key: "inspect", baseline: "Inspection", url: `${STAFF}/events/${E}/talks/${ids.slot}/inspection`, who: "staff" },
  { key: "review", baseline: "Review & approval", url: `${STAFF}/events/${E}/review`, who: "staff" },
  { key: "comms", baseline: "Communications", url: `${STAFF}/events/${E}/comms`, who: "staff" },
  { key: "archive", baseline: "Archive builder", url: `${STAFF}/events/${E}/archive`, who: "staff" },
  { key: "srr", baseline: "Speaker Ready Room", url: `${STAFF}/events/${E}/srr`, who: "staff" },
  { key: "checkin", baseline: "Check-in", url: CHECKIN, who: "staff" },
  { key: "ingest", baseline: "USB intake", url: CHECKIN, who: "staff", openUsb: true },
  { key: "sync", baseline: "Room sync", url: `${STAFF}/events/${E}/sync`, who: "staff" },
  { key: "agent", baseline: "Room Agent (Ballroom A)", url: `${STAFF}/events/${E}/agent/${ids.room}`, who: "staff" },
  { key: "speaker", baseline: "Speaker portal", url: `${PORTAL}/portal`, who: "presenter", phone: true },
  { key: "client", baseline: "Client portal", url: `${STAFF}/client/${E}`, who: "client", phone: true },
];
const only = process.argv[2] ? new Set(process.argv[2].split(",")) : null;
const screens = only ? ALL.filter((screen) => only.has(screen.key)) : ALL;

// ── sessions, made the way the product makes them ──────────────────────────────
const cookieHeader = (response: Response) =>
  (response.headers.getSetCookie?.() ?? []).map((entry) => entry.split(";")[0]).join("; ");
const cookies: Record<Who, string> = { staff: "", client: "", presenter: "" };
cookies.staff = await signInStaff(API, "admin@example.invalid", PASSWORD);
if (screens.some((screen) => screen.who === "client")) {
  cookies.client = await signInStaff(API, "j.ellis@example.invalid", PASSWORD);
}
if (screens.some((screen) => screen.who === "presenter")) {
  const found = (await (
    await fetch(`${API}/events/${E}/speakers?q=Raman`, { headers: { cookie: cookies.staff } })
  ).json()) as { items?: { id?: string; speaker_id?: string }[] };
  const speakerId = found.items?.[0]?.id ?? found.items?.[0]?.speaker_id;
  const credential = (await (
    await fetch(`${API}/speakers/${speakerId}/credentials`, { method: "POST", headers: { cookie: cookies.staff } })
  ).json()) as { access_code?: string };
  const login = await fetch(`${API}/portal/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: SPEAKER_EMAIL, code: credential.access_code }),
  });
  cookies.presenter = cookieHeader(login);
  if (!cookies.presenter) throw new Error(`the demo speaker could not sign in (${login.status})`);
}

const asCookies = (header: string) =>
  header
    .split("; ")
    .filter(Boolean)
    .map((pair) => {
      const at = pair.indexOf("=");
      return { name: pair.slice(0, at), value: pair.slice(at + 1), domain: "localhost", path: "/" };
    });

// ── capture ────────────────────────────────────────────────────────────────────
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME });
const viewport = (phone: boolean) => (phone ? { width: 375, height: 812 } : { width: 1440, height: 900 });

async function captureApp(screen: Screen, phone: boolean): Promise<string> {
  const context = await browser.newContext({ viewport: viewport(phone), deviceScaleFactor: 2, colorScheme: "light" });
  await context.addCookies(asCookies(cookies[screen.who]));
  const page = await context.newPage();
  await page.goto(screen.url, { waitUntil: "networkidle" });
  if (screen.openUsb) {
    const button = page.getByRole("button", { name: /usb/i }).first();
    if (await button.count()) await button.click();
  }
  await page.waitForTimeout(1200); // entry animations settle
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }); // Next's dev badge
  await page.screenshot({ path: `${OUT}${screen.key}-app${phone ? "-375" : ""}.png`, fullPage: true });
  const landed = page.url();
  await context.close();
  return landed;
}

async function captureBaseline(screen: Screen, phone: boolean): Promise<void> {
  const context = await browser.newContext({ viewport: viewport(phone), deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(new URL("../prototype/client-baseline.html", import.meta.url).href, { waitUntil: "load" });
  await page.waitForTimeout(800);
  const signIn = page.locator("button", { hasText: "Sign in" }).first();
  if (await signIn.count()) await signIn.click();
  await page.waitForTimeout(500);
  const found = await page.evaluate((label) => {
    const buttons = [...document.querySelectorAll("button")];
    const button =
      buttons.find((b) => b.textContent?.trim() === label) ?? buttons.find((b) => b.textContent?.trim().startsWith(label));
    button?.click();
    return Boolean(button);
  }, screen.baseline);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}${screen.key}-baseline${phone ? "-375" : ""}.png`, fullPage: true });
  await context.close();
  if (!found) console.error(`! baseline has no "${screen.baseline}" button`);
}

for (const screen of screens) {
  for (const phone of screen.phone ? [false, true] : [false]) {
    await captureBaseline(screen, phone);
    const landed = await captureApp(screen, phone);
    // A redirect (to /login, or a moved route) means the capture is of the wrong screen.
    const expected = new URL(screen.url).pathname;
    const flag = new URL(landed).pathname === expected ? "" : `  ! expected ${expected}`;
    console.log(`${screen.key}${phone ? " (375)" : ""} → ${landed}${flag}`);
  }
}
await browser.close();
console.log(`\n${screens.length} screens → ${OUT}`);
