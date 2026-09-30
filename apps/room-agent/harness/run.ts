/**
 * G0-1 harness (docs/poc/G0-1_PLAN.md A6; docs/PHASE0_GATE.md §G0-1).
 *
 * Drives a running Room Agent through its control port and writes evidence for each item
 * of the 16-item matrix to docs/poc/evidence/<os>/item-NN/result.json. Scripted items
 * measure themselves; items that need eyes (fidelity, holding screen) ask the operator and
 * record the answer. `report` turns the results into the table for ROOM_AGENT_POC.md.
 *
 *   node harness/run.ts versions --os win11
 *   node harness/run.ts 1 --os win11 [--cycles 100]
 *   node harness/run.ts 14 --os win11 [--hours 72]
 *   node harness/run.ts report --os win11
 *
 * Options: --port 47800 (the agent's control port), --corpus <dir> (default
 * tests/fixtures/g0-1; must be the agent's libraryRoot), --os <label>.
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { processTable } from "../src/core/processes.ts";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..", "..");

// ── options ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1]! : fallback;
};
const command = args[0] ?? "help";
const os = flag("os", process.platform === "win32" ? "windows" : process.platform);
const port = Number(flag("port", "47800"));
const corpus = path.resolve(flag("corpus", path.join(repo, "tests", "fixtures", "g0-1")));
const evidenceRoot = path.join(repo, "docs", "poc", "evidence", os);
const processes = processTable();

// ── agent client ───────────────────────────────────────────────────────────
type Launch = {
  outcome: string;
  launchId: string;
  firstSlideMs?: number;
  code?: string;
  reason?: string;
  missingLinkedMedia?: string[];
};
const agent = {
  async call<T>(method: "GET" | "POST", route: string, body?: unknown): Promise<T> {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return (await response.json()) as T;
  },
  launch: (file: string, extra: Record<string, unknown> = {}) =>
    agent.call<Launch>("POST", "/launch", { file: path.join(corpus, file), ...extra }),
  stop: () => agent.call<{ state: string }>("POST", "/stop"),
  reset: () => agent.call<{ state: string }>("POST", "/reset"),
  status: () => agent.call<{ state: string; current: { launchId: string } | null; pid: number }>("GET", "/status"),
  show: () => agent.call<Record<string, unknown>>("GET", "/show"),
  displays: () => agent.call<{ monitor: number; bounds: { x: number; y: number; width: number; height: number } }[]>("GET", "/displays"),
  async up(timeoutMs = 60_000): Promise<boolean> {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      try {
        await agent.status();
        return true;
      } catch {
        await sleep(500);
      }
    }
    return false;
  },
};

// ── corpus roles (harness/corpus.json maps a role to a file in the corpus) ─
type Corpus = Record<string, string | string[]>;
const loadCorpus = async (): Promise<Corpus> =>
  JSON.parse(await readFile(path.join(here, "corpus.json"), "utf8")) as Corpus;
const one = (c: Corpus, role: string): string => {
  const value = c[role];
  const file = Array.isArray(value) ? value[0] : value;
  if (!file) throw new Error(`harness/corpus.json has no "${role}"`);
  return file;
};
const many = (c: Corpus, role: string): string[] => {
  const value = c[role];
  return Array.isArray(value) ? value : value ? [value] : [];
};

// ── helpers ────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const p95 = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]! : NaN;
};
const prompt = createInterface({ input: process.stdin, output: process.stdout });
async function ask(question: string): Promise<{ yes: boolean; note: string }> {
  const answer = (await prompt.question(`\n${question}\n  [y]es / [n]o, then an optional note: `)).trim();
  return { yes: /^y/i.test(answer), note: answer.replace(/^[yn]\w*\s*/i, "") };
}

type Status = "PASS" | "FAIL" | "NEEDS_REVIEW";
type Result = { item: number; title: string; status: Status; metrics: Record<string, unknown>; checks: unknown[]; notes: string[] };

async function save(result: Result) {
  const dir = path.join(evidenceRoot, `item-${String(result.item).padStart(2, "0")}`);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "result.json"),
    JSON.stringify({ ...result, os, finished_at: new Date().toISOString() }, null, 2),
  );
  console.log(`\nItem ${result.item} — ${result.title}: ${result.status}`);
  console.log(JSON.stringify(result.metrics, null, 2));
}

/** Launch → wait → stop, the unit of work of several items. */
async function cycle(file: string, holdMs = 1500, extra: Record<string, unknown> = {}) {
  const launch = await agent.launch(file, extra);
  if (launch.outcome === "showing") await sleep(holdMs);
  await agent.stop();
  return launch;
}

// ── the 16 items ───────────────────────────────────────────────────────────
const ITEMS: Record<number, { title: string; run: (c: Corpus) => Promise<Result> }> = {
  1: {
    title: "Launch reliability: 100 cycles, ≥99% success, first slide ≤10 s P95",
    async run(c) {
      const cycles = Number(flag("cycles", "100"));
      const times: number[] = [];
      const failures: unknown[] = [];
      let maxPowerPoint = 0;
      for (let i = 1; i <= cycles; i += 1) {
        const launch = await cycle(one(c, "standard"), 1000);
        if (launch.outcome === "showing") times.push(launch.firstSlideMs ?? NaN);
        else failures.push({ cycle: i, ...launch });
        maxPowerPoint = Math.max(maxPowerPoint, (await processes.powerPoint()).length);
        process.stdout.write(`\r  cycle ${i}/${cycles} · failures ${failures.length}`);
      }
      const success = times.length / cycles;
      const p95ms = p95(times);
      return {
        item: 1,
        title: this.title,
        status: success < 0.99 || p95ms > 10_000 ? "FAIL" : cycles < 100 ? "NEEDS_REVIEW" : "PASS",
        metrics: { cycles, success_rate: success, first_slide_p95_ms: p95ms, first_slide_max_ms: Math.max(...times), max_powerpoint_processes: maxPowerPoint },
        checks: failures,
        notes: [],
      };
    },
  },
  2: {
    title: "Slideshow mode with presenter view on and off",
    async run(c) {
      const checks = [];
      for (const presenterView of [false, true]) {
        const launch = await agent.launch(one(c, "standard"), { presenterView, monitor: 1 });
        const answer = await ask(
          `Presenter view ${presenterView ? "ON" : "OFF"}: is the slideshow full screen on monitor 1${presenterView ? " and presenter view on the other monitor" : " with no presenter view"}?`,
        );
        checks.push({ presenterView, launch: launch.outcome, ...answer });
        await agent.stop();
      }
      return { item: 2, title: this.title, status: checks.every((x) => x.yes && x.launch === "showing") ? "PASS" : "FAIL", metrics: {}, checks, notes: [] };
    },
  },
  3: {
    title: "Multi-monitor: targeting a specific monitor (2- and 3-monitor setups)",
    async run(c) {
      const displays = await agent.displays();
      const checks = [];
      for (const display of displays) {
        const launch = await agent.launch(one(c, "standard"), { monitor: display.monitor });
        await sleep(1500);
        const show = await agent.show();
        const answer = await ask(`Did the slideshow open on monitor ${display.monitor} (${display.bounds.width}×${display.bounds.height} at ${display.bounds.x},${display.bounds.y})?`);
        checks.push({ monitor: display.monitor, bounds: display.bounds, launch: launch.outcome, window_reported: show, ...answer });
        await agent.stop();
      }
      return {
        item: 3,
        title: this.title,
        status: displays.length >= 2 && checks.every((x) => x.yes) ? "PASS" : displays.length < 2 ? "NEEDS_REVIEW" : "FAIL",
        metrics: { monitors: displays.length },
        checks,
        notes: displays.length < 3 ? ["Run again on the 3-monitor machine."] : [],
      };
    },
  },
  4: {
    title: "Animations and transitions fidelity (vs native PowerPoint, per deck)",
    async run(c) {
      const checks = [];
      for (const deck of many(c, "animations")) {
        const launch = await agent.launch(deck);
        const answer = await ask(`${deck}: step through it. Do animations and transitions match opening it by hand in PowerPoint? (record the screen)`);
        checks.push({ deck, launch: launch.outcome, ...answer });
        await agent.stop();
      }
      return { item: 4, title: this.title, status: checks.every((x) => x.yes) ? "PASS" : "FAIL", metrics: { decks: checks.length }, checks, notes: ["Attach screen recordings to this folder."] };
    },
  },
  5: {
    title: "Embedded and linked media play; missing linked media detected and reported",
    async run(c) {
      const checks = [];
      for (const deck of [...many(c, "embedded_video"), ...many(c, "linked_video")]) {
        const launch = await agent.launch(deck);
        const answer = await ask(`${deck}: does the video play correctly?`);
        checks.push({ deck, launch: launch.outcome, missing: launch.missingLinkedMedia, ...answer });
        await agent.stop();
      }
      const missingDeck = one(c, "missing_linked_video");
      const missing = await agent.launch(missingDeck);
      await agent.stop();
      const reported = (missing.missingLinkedMedia ?? []).length > 0;
      checks.push({ deck: missingDeck, launch: missing.outcome, missing: missing.missingLinkedMedia, reported });
      return {
        item: 5,
        title: this.title,
        status: reported && checks.every((x) => (x as { yes?: boolean }).yes !== false) ? "PASS" : "FAIL",
        metrics: { missing_linked_reported: reported },
        checks,
        notes: [],
      };
    },
  },
  6: {
    title: "Font handling: a missing-font deck renders with documented substitution",
    async run(c) {
      const checks = [];
      for (const deck of many(c, "fonts")) {
        const launch = await agent.launch(deck);
        const answer = await ask(`${deck}: note which font PowerPoint substituted and whether the text still fits. Acceptable?`);
        checks.push({ deck, launch: launch.outcome, ...answer });
        await agent.stop();
      }
      return { item: 6, title: this.title, status: checks.every((x) => x.yes) ? "PASS" : "FAIL", metrics: {}, checks, notes: ["Record the substitution in the report."] };
    },
  },
  7: {
    title: "PPT and PPTX launch; PDF, video and image play; Keynote handled",
    async run(c) {
      const checks = [];
      for (const role of ["standard", "legacy_ppt", "pdf", "video", "image"]) {
        const file = one(c, role);
        const launch = await agent.launch(file);
        const answer = await ask(`${role} (${file}): is it showing full screen?`);
        checks.push({ role, file, launch: launch.outcome, ...answer });
        await agent.stop();
      }
      const key = many(c, "keynote")[0];
      if (key) {
        const launch = await agent.launch(key);
        checks.push({ role: "keynote", file: key, launch: launch.outcome, code: launch.code, expected: "refused → play the PDF copy" });
        await agent.stop();
      }
      const ok = checks.every((x) => ((x as { role: string }).role === "keynote" ? (x as { launch: string }).launch === "refused" : (x as { yes?: boolean }).yes));
      if (!key) return { item: 7, title: this.title, status: ok ? "NEEDS_REVIEW" : "FAIL", metrics: {}, checks, notes: ["No Keynote file in harness/corpus.json yet (MANIFEST.md TODO)."] };
      return { item: 7, title: this.title, status: ok ? "PASS" : "FAIL", metrics: {}, checks, notes: [] };
    },
  },
  8: {
    title: "Macro-enabled deck: macros disabled; external links do not auto-open",
    async run(c) {
      const checks = [];
      for (const role of ["macro", "external_links"]) {
        const deck = one(c, role);
        const launch = await agent.launch(deck);
        const answer = await ask(
          role === "macro"
            ? `${deck}: showing with no macro prompt, and no macro ran?`
            : `${deck}: showing with no prompt to update links, and nothing external opened?`,
        );
        checks.push({ role, deck, launch: launch.outcome, ...answer });
        await agent.stop();
      }
      return { item: 8, title: this.title, status: checks.every((x) => x.yes && x.launch === "showing") ? "PASS" : "FAIL", metrics: {}, checks, notes: [] };
    },
  },
  9: {
    title: "PowerPoint crash: detected ≤5 s; relaunch or holding screen ≤10 s",
    async run(c) {
      const runs = [];
      for (let i = 0; i < 5; i += 1) {
        await agent.launch(one(c, "standard"));
        await sleep(3000);
        const killedAt = Date.now();
        for (const p of await processes.powerPoint()) await processes.kill(p.pid);
        await sleep(12_000);
        const entries = await readLog();
        const crashed = entries.findLast((e) => e.kind === "show.crashed");
        const relaunched = entries.findLast((e) => e.kind === "show.relaunched");
        runs.push({
          detected_ms: crashed ? Date.parse(crashed.at) - killedAt : null,
          recovery_ms: relaunched ? Number(relaunched.detail.recovery_ms) : null,
          state_after: (await agent.status()).state,
        });
        await agent.stop();
      }
      const ok = runs.every((r) => r.detected_ms !== null && r.detected_ms <= 5000 && r.recovery_ms !== null && r.recovery_ms <= 10_000);
      return { item: 9, title: this.title, status: ok ? "PASS" : "FAIL", metrics: { runs: runs.length }, checks: runs, notes: [] };
    },
  },
  10: {
    title: "Agent crash: the watchdog restarts it and playback state is recovered",
    async run(c) {
      const launch = await agent.launch(one(c, "standard"));
      await sleep(2000);
      const before = await agent.status();
      const killedAt = Date.now();
      await run("taskkill", ["/PID", String(before.pid), "/F"]).catch(() => undefined);
      const back = await agent.up(60_000);
      const after = back ? await agent.status() : null;
      const resumed = after?.current?.launchId === launch.launchId && after?.state === "showing";
      await agent.stop().catch(() => undefined);
      return {
        item: 10,
        title: this.title,
        status: back && resumed ? "PASS" : "FAIL",
        metrics: { back_in_ms: back ? Date.now() - killedAt : null, resumed_same_show: resumed },
        checks: [{ before, after }],
        notes: ["Requires the watchdog (scripts/install-autostart.ps1)."],
      };
    },
  },
  11: {
    title: "Holding screen in every failure path — never a bare desktop",
    async run(c) {
      const paths: [string, () => Promise<unknown>][] = [
        ["before any show", async () => undefined],
        ["file missing", () => agent.launch("does-not-exist.pptx")],
        ["checksum mismatch", () => agent.launch(one(c, "standard"), { sha256: "0".repeat(64) })],
        ["corrupted deck", () => agent.launch(one(c, "corrupted"))],
        ["after a show ends", () => cycle(one(c, "standard"), 1000)],
        ["PowerPoint killed twice (gives up)", async () => {
          await agent.launch(one(c, "standard"));
          for (let i = 0; i < 2; i += 1) {
            await sleep(4000);
            for (const p of await processes.powerPoint()) await processes.kill(p.pid);
          }
          await sleep(12_000);
        }],
      ];
      const checks = [];
      for (const [label, trigger] of paths) {
        await trigger();
        const answer = await ask(`${label}: is the holding screen showing (not the desktop)?`);
        checks.push({ path: label, ...answer });
      }
      await agent.reset();
      return { item: 11, title: this.title, status: checks.every((x) => x.yes) ? "PASS" : "FAIL", metrics: {}, checks, notes: [] };
    },
  },
  12: {
    title: "Offline restart: library intact and playable with the network unplugged",
    async run(c) {
      const unplugged = await ask("Unplug the network (or disable the adapter) now. Done?");
      await ask("Restart the agent (end it in Task Manager; the watchdog brings it back). Done?");
      const back = await agent.up(90_000);
      const launch = back ? await cycle(one(c, "standard"), 3000) : null;
      const shown = await ask("Did the presentation show?");
      return {
        item: 12,
        title: this.title,
        status: unplugged.yes && back && launch?.outcome === "showing" && shown.yes ? "PASS" : "FAIL",
        metrics: { agent_back: back, launch: launch?.outcome ?? null },
        checks: [unplugged, shown],
        notes: [],
      };
    },
  },
  13: {
    title: "Windows reboot: agent starts by itself and resumes the right state",
    async run(c) {
      if (!args.includes("--after-reboot")) {
        const launch = await agent.launch(one(c, "standard"));
        await mkdir(evidenceRoot, { recursive: true });
        await writeFile(path.join(evidenceRoot, "reboot-launch.json"), JSON.stringify(launch));
        console.log("\nNow restart Windows and sign in, then run:  node harness/run.ts 13 --after-reboot");
        process.exit(0);
      }
      const before = JSON.parse(await readFile(path.join(evidenceRoot, "reboot-launch.json"), "utf8")) as Launch;
      const back = await agent.up(180_000);
      const after = back ? await agent.status() : null;
      const resumed = after?.current?.launchId === before.launchId;
      await agent.stop().catch(() => undefined);
      return { item: 13, title: this.title, status: back && resumed ? "PASS" : "FAIL", metrics: { agent_started: back, resumed_same_show: resumed }, checks: [{ before, after }], notes: [] };
    },
  },
  14: {
    title: "72-hour offline soak: memory growth ≤20%, no orphaned PowerPoint, launches keep firing",
    async run(c) {
      const hours = Number(flag("hours", "72"));
      const everyMin = Number(flag("launch-every-min", "10"));
      const dir = path.join(evidenceRoot, "item-14");
      await mkdir(dir, { recursive: true });
      const csv = path.join(dir, "samples.csv");
      await writeFile(csv, "at,agent_state,powerpoint_processes,powerpoint_kb,agent_kb,launches,launch_failures\n");
      const end = Date.now() + hours * 3_600_000;
      let launches = 0;
      let failures = 0;
      let nextLaunch = Date.now();
      const agentKb: number[] = [];
      let maxOrphans = 0;
      while (Date.now() < end) {
        if (Date.now() >= nextLaunch) {
          const launch = await cycle(one(c, "standard"), 60_000).catch(() => null);
          launches += 1;
          if (launch?.outcome !== "showing") failures += 1;
          nextLaunch = Date.now() + everyMin * 60_000;
        }
        const status = await agent.status().catch(() => null);
        const ppt = await processes.powerPoint();
        const mem = status ? await memoryOf(status.pid) : 0;
        if (mem) agentKb.push(mem);
        if (status?.state === "idle") maxOrphans = Math.max(maxOrphans, Math.max(0, ppt.length - 1));
        await appendFile(csv, `${new Date().toISOString()},${status?.state ?? "down"},${ppt.length},${ppt.reduce((s, p) => s + p.memoryKb, 0)},${mem},${launches},${failures}\n`);
        await sleep(60_000);
      }
      const first = agentKb.slice(0, 10).reduce((s, v) => s + v, 0) / Math.max(1, Math.min(10, agentKb.length));
      const last = agentKb.slice(-10).reduce((s, v) => s + v, 0) / Math.max(1, Math.min(10, agentKb.length));
      const growth = first ? (last - first) / first : NaN;
      return {
        item: 14,
        title: this.title,
        status: hours >= 72 && growth <= 0.2 && maxOrphans === 0 && failures === 0 ? "PASS" : hours < 72 ? "NEEDS_REVIEW" : "FAIL",
        metrics: { hours, launches, launch_failures: failures, agent_memory_growth: growth, max_orphaned_powerpoint: maxOrphans },
        checks: [],
        notes: ["samples.csv holds a sample a minute; graph it for the report."],
      };
    },
  },
  15: {
    title: "Process cleanup: zero orphaned PowerPoint processes after 100 cycles",
    async run(c) {
      const cycles = Number(flag("cycles", "100"));
      let maxDuring = 0;
      for (let i = 1; i <= cycles; i += 1) {
        await cycle(one(c, "standard"), 500);
        maxDuring = Math.max(maxDuring, (await processes.powerPoint()).length);
        process.stdout.write(`\r  cycle ${i}/${cycles}`);
      }
      await agent.reset();
      await sleep(3000);
      const left = (await processes.powerPoint()).length;
      return {
        item: 15,
        title: this.title,
        status: left !== 0 || maxDuring > 1 ? "FAIL" : cycles < 100 ? "NEEDS_REVIEW" : "PASS",
        metrics: { cycles, max_powerpoint_during: maxDuring, powerpoint_left_after_reset: left },
        checks: [],
        notes: [],
      };
    },
  },
  16: {
    title: "Concurrent launches: the second is refused cleanly; never two instances",
    async run(c) {
      const checks = [];
      for (let i = 0; i < 10; i += 1) {
        const results = await Promise.all([agent.launch(one(c, "standard")), agent.launch(one(c, "standard"))]);
        const outcomes = results.map((r) => r.outcome).sort();
        const powerPoint = (await processes.powerPoint()).length;
        checks.push({ outcomes, powerPoint });
        await agent.stop();
      }
      const ok = checks.every((x) => x.outcomes.join() === "busy,showing" && x.powerPoint <= 1);
      return { item: 16, title: this.title, status: ok ? "PASS" : "FAIL", metrics: { rounds: checks.length }, checks, notes: [] };
    },
  },
};

// ── log, memory, versions, report ──────────────────────────────────────────
type Entry = { local_seq: number; at: string; kind: string; detail: Record<string, unknown> };
async function readLog(): Promise<Entry[]> {
  const dataDir = process.env.APPDATA ? path.join(process.env.APPDATA, "DXG Room Agent") : flag("agent-data", "");
  const text = await readFile(path.join(dataDir, "logs", "launch-log.jsonl"), "utf8").catch(() => "");
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Entry);
}

async function memoryOf(pid: number): Promise<number> {
  if (process.platform !== "win32") return 0;
  const { stdout } = await run("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]).catch(() => ({ stdout: "" }));
  const kb = stdout.match(/"([\d.,\s]+)\s*K"/)?.[1];
  return kb ? Number(kb.replace(/[^\d]/g, "")) : 0;
}

async function versions() {
  const read = async (file: string, argv: string[]) => (await run(file, argv).catch(() => ({ stdout: "" }))).stdout.trim();
  const officeVersion = await read("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Office\\ClickToRun\\Configuration", "/v", "VersionToReport"]);
  const pkg = async (name: string) =>
    ((JSON.parse(await readFile(path.join(repo, "node_modules", name, "package.json"), "utf8").catch(() => "{}")) as { version?: string }).version ?? "not installed");
  const info = {
    os_label: os,
    windows: await read("cmd", ["/c", "ver"]),
    powerpoint_build: officeVersion.split(/\s+/).at(-1) ?? "unknown",
    node: process.version,
    electron: await pkg("electron"),
    winax: await pkg("winax"),
    arch: process.arch,
    recorded_at: new Date().toISOString(),
  };
  await mkdir(evidenceRoot, { recursive: true });
  await writeFile(path.join(evidenceRoot, "versions.json"), JSON.stringify(info, null, 2));
  console.log(JSON.stringify(info, null, 2));
}

async function report() {
  const rows: string[] = ["| # | Item | Status | Key figures |", "|---|---|---|---|"];
  const dirs = (await readdir(evidenceRoot).catch(() => [])).filter((d) => d.startsWith("item-")).sort();
  const done = new Map<number, Result>();
  for (const dir of dirs) {
    const result = JSON.parse(await readFile(path.join(evidenceRoot, dir, "result.json"), "utf8").catch(() => "null")) as Result | null;
    if (result) done.set(result.item, result);
  }
  for (let item = 1; item <= 16; item += 1) {
    const result = done.get(item);
    rows.push(`| ${item} | ${ITEMS[item]!.title} | ${result?.status ?? "not run"} | ${result ? JSON.stringify(result.metrics).replace(/\|/g, "/") : ""} |`);
  }
  const table = rows.join("\n");
  await writeFile(path.join(evidenceRoot, "SUMMARY.md"), `# G0-1 results — ${os}\n\n${table}\n`);
  console.log(table);
}

// ── main ───────────────────────────────────────────────────────────────────
try {
  if (command === "versions") await versions();
  else if (command === "report") await report();
  else if (/^\d+$/.test(command) && ITEMS[Number(command)]) {
    if (!(await agent.up(10_000))) throw new Error(`No Room Agent answering on port ${port}. Start it first.`);
    // Every item starts from the holding screen with no PowerPoint left over — a show left
    // running by an earlier, interrupted item would make this one's first launch "busy".
    // Not after a reboot: item 13 is checking that the agent resumed the show by itself.
    if (!args.includes("--after-reboot")) await agent.reset();
    await save(await ITEMS[Number(command)]!.run(await loadCorpus()));
  } else {
    console.log("Usage: node harness/run.ts <1-16 | versions | report> --os <label> [--port 47800] [--corpus dir]");
  }
} finally {
  prompt.close();
}
