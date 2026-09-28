import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The agent's own record of what it did (BUILD_SPEC §9: logs queue locally and replay
 * deduplicated by (agent_id, local_seq)). Append-only JSON lines: it survives a crash or a
 * power cut with at most the last line lost, needs no database, and is the evidence file
 * the G0-1 harness reads.
 */
export type LogEntry = { local_seq: number; at: string; kind: string; detail: Record<string, unknown> };

export class LaunchLog {
  readonly file: string;
  #seq = 0;
  #ready: Promise<void>;

  constructor(dir: string) {
    this.file = path.join(dir, "launch-log.jsonl");
    this.#ready = this.#load();
  }

  async #load() {
    await mkdir(path.dirname(this.file), { recursive: true });
    const text = await readFile(this.file, "utf8").catch(() => "");
    const last = text.trimEnd().split("\n").at(-1);
    if (last) {
      try {
        this.#seq = (JSON.parse(last) as LogEntry).local_seq;
      } catch {
        // A torn last line from a power cut: carry on after the line count.
        this.#seq = text.split("\n").length;
      }
    }
  }

  async write(kind: string, detail: Record<string, unknown> = {}): Promise<LogEntry> {
    await this.#ready;
    this.#seq += 1;
    const entry: LogEntry = { local_seq: this.#seq, at: new Date().toISOString(), kind, detail };
    await appendFile(this.file, JSON.stringify(entry) + "\n");
    return entry;
  }

  async entries(): Promise<LogEntry[]> {
    await this.#ready;
    const text = await readFile(this.file, "utf8").catch(() => "");
    return text
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as LogEntry];
        } catch {
          return [];
        }
      });
  }
}
