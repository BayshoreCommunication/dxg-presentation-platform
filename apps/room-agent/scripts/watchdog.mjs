// Keeps the Room Agent running (G0-1 items 10 and 13). Started at Windows sign-in by the
// scheduled task (scripts/install-autostart.ps1); restarts the agent whenever it exits,
// backing off if it keeps failing, and notes every restart in watchdog.log.
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const electron = path.join(root, "..", "..", "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
const logFile = path.join(root, "watchdog.log");
let failures = 0;

function start() {
  const began = Date.now();
  const child = spawn(electron, [path.join(root, "dist", "main.cjs")], { stdio: "ignore", shell: process.platform === "win32" });
  appendFileSync(logFile, `${new Date().toISOString()} started pid=${child.pid}\n`);
  child.on("exit", (code) => {
    failures = Date.now() - began < 30_000 ? failures + 1 : 0;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(failures, 5));
    appendFileSync(logFile, `${new Date().toISOString()} exited code=${code} restarting_in_ms=${delay}\n`);
    setTimeout(start, delay);
  });
}
start();
