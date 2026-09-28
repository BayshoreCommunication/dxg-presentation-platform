import type { DriverEvent, PlaybackDriver, ShowRequest, ShowStatus } from "../core/driver.ts";
import { PlaybackError } from "../core/driver.ts";

/**
 * A driver with no PowerPoint behind it, for macOS development, CI and fault injection: the
 * supervisor's rules (crash detection, relaunch, holding screen, one show at a time) are
 * proved against it before they meet real COM on Windows.
 */
export type FakeFaults = {
  startDelayMs?: number;
  /** The next start fails with this code. */
  failStart?: string;
  /** The show "crashes" this long after starting. */
  crashAfterMs?: number;
  /** status() stops answering this long after starting. */
  hangAfterMs?: number;
};

export class FakeDriver implements PlaybackDriver {
  readonly name = "fake" as const;
  faults: FakeFaults;
  starts = 0;
  shutdowns = 0;
  #running = false;
  #hung = false;
  #listeners = new Set<(event: DriverEvent) => void>();
  #timers: NodeJS.Timeout[] = [];

  constructor(faults: FakeFaults = {}) {
    this.faults = faults;
  }

  async start(_request: ShowRequest) {
    this.starts += 1;
    const began = Date.now();
    if (this.faults.startDelayMs) await new Promise((resolve) => setTimeout(resolve, this.faults.startDelayMs));
    if (this.faults.failStart) {
      const code = this.faults.failStart;
      delete this.faults.failStart;
      throw new PlaybackError(code, `Fake start failure: ${code}`);
    }
    this.#running = true;
    this.#hung = false;
    if (this.faults.crashAfterMs !== undefined) {
      this.#timers.push(
        setTimeout(() => {
          this.#running = false;
          this.#emit({ kind: "crashed", detail: "fake crash" });
        }, this.faults.crashAfterMs),
      );
    }
    if (this.faults.hangAfterMs !== undefined) {
      this.#timers.push(setTimeout(() => (this.#hung = true), this.faults.hangAfterMs));
    }
    return { firstSlideMs: Date.now() - began, pid: 4242 };
  }

  async status(): Promise<ShowStatus> {
    if (this.#hung) return new Promise(() => undefined); // never answers
    return this.#running ? { running: true, responsive: true, slide: 1, pid: 4242 } : { running: false, responsive: true };
  }

  async stop() {
    this.#running = false;
    this.#clear();
  }

  async shutdown() {
    this.shutdowns += 1;
    this.#running = false;
    this.#hung = false;
    this.#clear();
  }

  onEvent(listener: (event: DriverEvent) => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Test hook: the speaker pressed Esc on the last slide. */
  endShow() {
    this.#running = false;
    this.#emit({ kind: "ended" });
  }

  #emit(event: DriverEvent) {
    for (const listener of this.#listeners) listener(event);
  }

  #clear() {
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers = [];
  }
}
