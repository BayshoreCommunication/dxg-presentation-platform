import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { DriverEvent, PlaybackDriver, ShowRequest, ShowStatus } from "../core/driver.ts";
import { PlaybackError } from "../core/driver.ts";

/**
 * PowerPoint over COM in a separate PowerShell process (D-002's fallback, G0-1 step 3).
 * A PowerPoint that hangs inside a COM call blocks only the helper: the supervisor's
 * timeout fires, `shutdown` kills the helper, and the next start spawns a fresh one.
 * Talks one JSON line per request (helper/ppt-helper.ps1).
 */
type Reply = { id: number; ok: boolean; code?: string; message?: string } & Record<string, unknown>;

export type HelperOptions = {
  /** The program to run; defaults to Windows PowerShell 5.1, present on every Windows PC. */
  command?: string;
  /** Its arguments; defaults to running helper/ppt-helper.ps1. Tests use a Node stand-in. */
  args?: string[];
};

export class HelperDriver implements PlaybackDriver {
  readonly name = "helper" as const;
  #command: string;
  #args: string[];
  #child: ChildProcessWithoutNullStreams | null = null;
  #nextId = 1;
  #pending = new Map<number, { resolve: (reply: Reply) => void; reject: (error: Error) => void }>();
  #listeners = new Set<(event: DriverEvent) => void>();
  #quitting = false;

  constructor(options: HelperOptions = {}) {
    this.#command = options.command ?? "powershell";
    this.#args = options.args ?? [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      fileURLToPath(new URL("../../helper/ppt-helper.ps1", import.meta.url)),
    ];
  }

  #spawn(): ChildProcessWithoutNullStreams {
    if (this.#child) return this.#child;
    const child = spawn(this.#command, this.#args, { windowsHide: true });
    createInterface({ input: child.stdout }).on("line", (line) => {
      let reply: Reply;
      try {
        reply = JSON.parse(line) as Reply;
      } catch {
        return; // not ours (PowerShell noise)
      }
      const waiting = this.#pending.get(reply.id);
      if (waiting) {
        this.#pending.delete(reply.id);
        waiting.resolve(reply);
      }
    });
    child.on("exit", (code) => {
      this.#child = null;
      for (const waiting of this.#pending.values()) waiting.reject(new PlaybackError("helper_exited", `Helper exited (${code})`));
      this.#pending.clear();
      if (!this.#quitting) this.#emit({ kind: "crashed", detail: `PowerPoint helper exited (${code})` });
      this.#quitting = false;
    });
    this.#child = child;
    return child;
  }

  async #call(body: Record<string, unknown>): Promise<Reply> {
    const child = this.#spawn();
    const id = this.#nextId++;
    const reply = await new Promise<Reply>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ id, ...body }) + "\n");
    });
    if (!reply.ok) throw new PlaybackError(reply.code ?? "helper_error", reply.message ?? "The helper refused.");
    return reply;
  }

  async start(request: ShowRequest) {
    const reply = await this.#call({
      cmd: "start",
      file: request.file,
      monitor: request.monitor,
      presenterView: request.presenterView,
    });
    return {
      firstSlideMs: Number(reply.firstSlideMs),
      ...(typeof reply.pid === "number" ? { pid: reply.pid } : {}),
    };
  }

  async status(): Promise<ShowStatus> {
    if (!this.#child) return { running: false, responsive: true };
    const reply = await this.#call({ cmd: "status" });
    return reply as unknown as ShowStatus;
  }

  async stop() {
    if (this.#child) await this.#call({ cmd: "stop" });
  }

  /** Asks the helper to quit PowerPoint; if it doesn't answer, kills the helper outright. */
  async shutdown() {
    const child = this.#child;
    if (!child) return;
    this.#quitting = true;
    await Promise.race([
      this.#call({ cmd: "shutdown" }).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    child.kill();
    this.#child = null;
  }

  onEvent(listener: (event: DriverEvent) => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(event: DriverEvent) {
    for (const listener of this.#listeners) listener(event);
  }
}
