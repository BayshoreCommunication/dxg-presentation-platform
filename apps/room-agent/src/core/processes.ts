import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * PowerPoint processes on this PC (G0-1 items 9, 14, 15): the supervisor uses it to find a
 * crashed or orphaned POWERPNT.EXE and end it, and the harness to count orphans and
 * sample memory during the soak. Windows only; elsewhere there is nothing to find.
 */
export type ProcessInfo = { pid: number; memoryKb: number };

export interface ProcessTable {
  powerPoint(): Promise<ProcessInfo[]>;
  kill(pid: number): Promise<void>;
}

export const windowsProcesses: ProcessTable = {
  async powerPoint() {
    try {
      const { stdout } = await run("tasklist", ["/FI", "IMAGENAME eq POWERPNT.EXE", "/FO", "CSV", "/NH"], {
        windowsHide: true,
      });
      return parseTasklist(stdout);
    } catch {
      // A remote (SSH) session is refused `tasklist` — the harness runs from one on the G0-1 PC.
      // Get-Process is allowed and sees the desktop session's PowerPoint too.
      const { stdout } = await run(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          // `exit 0`: with no PowerPoint running Get-Process ends in an error status — that is "none".
          "Get-Process POWERPNT -ErrorAction SilentlyContinue | ForEach-Object { \"$($_.Id),$([int]($_.WorkingSet64 / 1KB))\" }; exit 0",
        ],
        { windowsHide: true },
      );
      return parsePidMemory(stdout);
    }
  },
  async kill(pid) {
    await run("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }).catch(() => undefined);
  },
};

export const noProcesses: ProcessTable = {
  async powerPoint() {
    return [];
  },
  async kill() {},
};

export const processTable = (): ProcessTable => (process.platform === "win32" ? windowsProcesses : noProcesses);

/** `"POWERPNT.EXE","1234","Console","1","183,456 K"` → pid and memory. */
export function parseTasklist(csv: string): ProcessInfo[] {
  return csv
    .split(/\r?\n/)
    .map((line) => line.match(/^"([^"]+)","(\d+)","[^"]*","[^"]*","([\d.,\s]+)\s*K"/i))
    .filter((match): match is RegExpMatchArray => Boolean(match) && /POWERPNT/i.test(match![1]!))
    .map((match) => ({ pid: Number(match[2]), memoryKb: Number(match[3]!.replace(/[^\d]/g, "")) }));
}

/** `1234,183456` per line (pid, memory in KB) — the Get-Process fallback's output. */
export function parsePidMemory(text: string): ProcessInfo[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^(\d+),(\d+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({ pid: Number(match[1]), memoryKb: Number(match[2]) }));
}
