import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PlaybackDriver, ShowRequest } from "./driver.ts";
import { PlaybackError } from "./driver.ts";
import { checkLaunch } from "./launchRules.ts";
import type { LaunchLog } from "./launchLog.ts";
import type { ProcessTable } from "./processes.ts";

/**
 * The Room Agent's supervisor (BUILD_SPEC §9; G0-1 items 9, 10, 11, 15, 16).
 *
 * Rules it enforces, whatever the driver:
 *   - one show at a time: a second launch while one is running or starting is refused
 *     cleanly, never two PowerPoints fighting (item 16);
 *   - only a verified file launches (BUILD_SPEC §8); anything else is refused and the
 *     holding screen stays up;
 *   - the holding screen is up whenever nothing is showing — before, between and after
 *     shows, and in every failure path (item 11): never a bare desktop;
 *   - a crash or a PowerPoint that stops answering is noticed within 5 s (a status poll
 *     every second, "not answering" after two missed 1.5 s answers), the holding screen
 *     goes up, leftover PowerPoint processes are ended (item 15), and the show is started
 *     again once (item 9);
 *   - what is showing is written to a state file, so an agent restarted by its watchdog
 *     resumes the same show (item 10).
 */

export interface HoldingScreen {
  show(reason: string): void;
  hide(): void;
}

/** PDFs, videos and images, played by the agent itself (Electron), not PowerPoint. */
export interface MediaPlayer {
  play(file: string, monitor: number): Promise<void>;
  stop(): Promise<void>;
}

export type LaunchInput = {
  file: string;
  sha256?: string;
  monitor: number;
  presenterView?: boolean;
  launchId?: string;
};

export type LaunchResult =
  | {
      outcome: "showing";
      launchId: string;
      firstSlideMs: number;
      route: "powerpoint" | "media";
      /** Linked videos/sounds missing on this PC — shown anyway, reported (item 5). */
      missingLinkedMedia: string[];
    }
  | { outcome: "busy" | "refused" | "failed"; launchId: string; code: string; reason: string };

export type SupervisorState = "idle" | "launching" | "showing" | "recovering";

export type SupervisorOptions = {
  driver: PlaybackDriver;
  holding: HoldingScreen;
  log: LaunchLog;
  processes: ProcessTable;
  libraryRoot: string;
  stateDir: string;
  media?: MediaPlayer;
  pollMs?: number;
  statusTimeoutMs?: number;
  missedAnswers?: number;
  launchTimeoutMs?: number;
  relaunchesPerShow?: number;
};

type Current = { request: ShowRequest; route: "powerpoint" | "media"; relaunches: number; startedAt: number };

export class Supervisor {
  readonly #o: Required<Omit<SupervisorOptions, "media">> & { media?: MediaPlayer };
  #state: SupervisorState = "idle";
  #current: Current | null = null;
  #watch: NodeJS.Timeout | null = null;
  #missed = 0;
  #stopping = false;
  #unsubscribe: () => void;

  constructor(options: SupervisorOptions) {
    this.#o = {
      pollMs: 1000,
      statusTimeoutMs: 1500,
      missedAnswers: 2,
      launchTimeoutMs: 15_000,
      relaunchesPerShow: 1,
      ...options,
    };
    this.#unsubscribe = this.#o.driver.onEvent((event) => {
      if (event.kind === "crashed") void this.#onCrash(event.detail);
      else if (event.kind === "ended") void this.#onEnded();
    });
  }

  get state(): SupervisorState {
    return this.#state;
  }

  get current() {
    return this.#current ? { ...this.#current.request, route: this.#current.route } : null;
  }

  /** On agent start: clear leftovers, show the holding screen, resume an interrupted show. */
  async start(): Promise<void> {
    this.#o.holding.show("ready");
    const killed = await this.#killPowerPoint();
    await this.#o.log.write("agent.started", { driver: this.#o.driver.name, orphans_ended: killed });
    const saved = await this.#readState();
    if (saved) {
      await this.#o.log.write("agent.resuming", { launch_id: saved.launchId, file: saved.file });
      await this.launch({ ...saved, launchId: saved.launchId });
    }
  }

  async launch(input: LaunchInput): Promise<LaunchResult> {
    const launchId = input.launchId ?? randomUUID();
    if (this.#state !== "idle") {
      await this.#o.log.write("launch.busy", { launch_id: launchId, file: input.file, state: this.#state });
      return { outcome: "busy", launchId, code: "busy", reason: "A presentation is already showing. Stop it first." };
    }
    this.#state = "launching";
    try {
      const verdict = await checkLaunch(input, this.#o.libraryRoot);
      if (!verdict.ok) {
        this.#state = "idle";
        this.#o.holding.show(verdict.reason);
        await this.#o.log.write("launch.refused", { launch_id: launchId, file: input.file, code: verdict.code });
        return { outcome: "refused", launchId, code: verdict.code, reason: verdict.reason };
      }
      const request: ShowRequest = {
        file: verdict.file,
        monitor: input.monitor,
        presenterView: input.presenterView ?? false,
        launchId,
      };
      if (verdict.missingLinkedMedia.length > 0) {
        await this.#o.log.write("launch.missing_linked_media", {
          launch_id: launchId,
          file: request.file,
          missing: verdict.missingLinkedMedia,
        });
      }
      const firstSlideMs = await this.#begin(request, verdict.route);
      this.#current = { request, route: verdict.route, relaunches: 0, startedAt: Date.now() };
      this.#state = "showing";
      await this.#writeState(input, launchId);
      await this.#o.log.write("launch.showing", {
        launch_id: launchId,
        file: request.file,
        route: verdict.route,
        first_slide_ms: firstSlideMs,
        monitor: request.monitor,
        presenter_view: request.presenterView,
      });
      if (verdict.route === "powerpoint") this.#startWatch();
      return {
        outcome: "showing",
        launchId,
        firstSlideMs,
        route: verdict.route,
        missingLinkedMedia: verdict.missingLinkedMedia,
      };
    } catch (caught) {
      const code = caught instanceof PlaybackError ? caught.code : "start_failed";
      const reason = caught instanceof Error ? caught.message : String(caught);
      await this.#recoverAfterFailure();
      this.#state = "idle";
      this.#o.holding.show("The presentation couldn't start.");
      await this.#o.log.write("launch.failed", { launch_id: launchId, file: input.file, code, reason });
      return { outcome: "failed", launchId, code, reason };
    }
  }

  /** Ends the show and returns to the holding screen. */
  async stop(): Promise<void> {
    if (!this.#current) return;
    this.#stopping = true;
    this.#stopWatch();
    const { request, route } = this.#current;
    try {
      if (route === "media") await this.#o.media?.stop();
      else await this.#withTimeout(this.#o.driver.stop(), this.#o.launchTimeoutMs);
    } catch {
      await this.#recoverAfterFailure();
    }
    this.#current = null;
    this.#state = "idle";
    this.#stopping = false;
    this.#o.holding.show("ready");
    await this.#clearState();
    await this.#o.log.write("show.stopped", { launch_id: request.launchId });
  }

  /** What the driver reports about the running show (window position, slide). */
  async showStatus() {
    return this.#withTimeout(this.#o.driver.status(), this.#o.statusTimeoutMs * 2).catch((caught: unknown) => ({
      running: false,
      responsive: false,
      error: caught instanceof Error ? caught.message : String(caught),
    }));
  }

  /** Stops any show, quits PowerPoint and ends leftover processes; returns to the holding screen. */
  async reset(): Promise<void> {
    await this.stop();
    await this.#recoverAfterFailure();
    this.#o.holding.show("ready");
    await this.#o.log.write("agent.reset", {});
  }

  /** Agent shutdown: stop watching and leave nothing running. */
  async dispose(): Promise<void> {
    this.#stopWatch();
    this.#unsubscribe();
    await this.#o.driver.shutdown().catch(() => undefined);
  }

  async #begin(request: ShowRequest, route: "powerpoint" | "media"): Promise<number> {
    const began = Date.now();
    if (route === "media") {
      if (!this.#o.media) throw new PlaybackError("media_unavailable", "This agent can't play PDFs, videos or images.");
      await this.#withTimeout(this.#o.media.play(request.file, request.monitor), this.#o.launchTimeoutMs);
      this.#o.holding.hide();
      return Date.now() - began;
    }
    const started = await this.#withTimeout(this.#o.driver.start(request), this.#o.launchTimeoutMs);
    this.#o.holding.hide();
    return started.firstSlideMs;
  }

  #startWatch() {
    this.#missed = 0;
    this.#watch = setInterval(() => void this.#poll(), this.#o.pollMs);
  }

  #stopWatch() {
    if (this.#watch) clearInterval(this.#watch);
    this.#watch = null;
  }

  async #poll() {
    if (this.#state !== "showing" || this.#stopping) return;
    try {
      const status = await this.#withTimeout(this.#o.driver.status(), this.#o.statusTimeoutMs);
      this.#missed = 0;
      if (!status.running) await this.#onEnded();
    } catch {
      this.#missed += 1;
      if (this.#missed >= this.#o.missedAnswers) await this.#onCrash("PowerPoint stopped answering");
    }
  }

  async #onEnded() {
    if (this.#state !== "showing" || this.#stopping || !this.#current) return;
    this.#stopWatch();
    const { request } = this.#current;
    this.#current = null;
    this.#state = "idle";
    this.#o.holding.show("ready");
    await this.#clearState();
    await this.#o.log.write("show.ended", { launch_id: request.launchId });
  }

  async #onCrash(detail: string) {
    if (this.#state !== "showing" || this.#stopping || !this.#current) return;
    const detectedAt = Date.now();
    this.#stopWatch();
    this.#state = "recovering";
    const current = this.#current;
    this.#o.holding.show("One moment — restarting the presentation.");
    await this.#o.log.write("show.crashed", { launch_id: current.request.launchId, detail });
    await this.#recoverAfterFailure();

    if (current.relaunches >= this.#o.relaunchesPerShow) {
      this.#current = null;
      this.#state = "idle";
      this.#o.holding.show("The presentation stopped. Ask the room technician.");
      await this.#clearState();
      await this.#o.log.write("show.gave_up", { launch_id: current.request.launchId });
      return;
    }
    try {
      await this.#withTimeout(this.#o.driver.start(current.request), this.#o.launchTimeoutMs);
      this.#o.holding.hide();
      this.#current = { ...current, relaunches: current.relaunches + 1 };
      this.#state = "showing";
      await this.#o.log.write("show.relaunched", {
        launch_id: current.request.launchId,
        recovery_ms: Date.now() - detectedAt,
      });
      this.#startWatch();
    } catch (caught) {
      await this.#recoverAfterFailure();
      this.#current = null;
      this.#state = "idle";
      this.#o.holding.show("The presentation stopped. Ask the room technician.");
      await this.#clearState();
      await this.#o.log.write("show.relaunch_failed", {
        launch_id: current.request.launchId,
        reason: caught instanceof Error ? caught.message : String(caught),
      });
    }
  }

  /** After any failure: quit PowerPoint and end whatever it left behind (item 15). */
  async #recoverAfterFailure() {
    await this.#withTimeout(this.#o.driver.shutdown(), 5000).catch(() => undefined);
    await this.#killPowerPoint();
  }

  async #killPowerPoint(): Promise<number> {
    const found = await this.#o.processes.powerPoint().catch(() => []);
    for (const process of found) await this.#o.processes.kill(process.pid);
    return found.length;
  }

  #withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new PlaybackError("timeout", `No answer within ${ms} ms`)), ms);
      work.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  get #stateFile() {
    return path.join(this.#o.stateDir, "showing.json");
  }

  async #writeState(input: LaunchInput, launchId: string) {
    await mkdir(this.#o.stateDir, { recursive: true });
    await writeFile(this.#stateFile, JSON.stringify({ ...input, launchId }));
  }

  async #clearState() {
    await writeFile(this.#stateFile, "null").catch(() => undefined);
  }

  async #readState(): Promise<(LaunchInput & { launchId: string }) | null> {
    try {
      return JSON.parse(await readFile(this.#stateFile, "utf8")) as (LaunchInput & { launchId: string }) | null;
    } catch {
      return null;
    }
  }
}
