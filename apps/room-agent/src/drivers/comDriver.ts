import type { DriverEvent, PlaybackDriver, ShowRequest, ShowStatus } from "../core/driver.ts";
import { PlaybackError } from "../core/driver.ts";
import { processTable } from "../core/processes.ts";
import { setSlideShowMonitor } from "./windowsDisplay.ts";

/**
 * PowerPoint over COM, inside the agent (D-002's first choice), through `winax`.
 *
 * `winax` is not a dependency of the repo: it is a native module built against Electron
 * on the Windows test machine (see docs/poc/G0-1_RUNBOOK.md), and cannot install on the
 * Linux servers. The known risk this driver exists to measure: COM calls are synchronous,
 * so a PowerPoint that hangs inside a call blocks the agent's own event loop — the
 * supervisor's timeout cannot fire. The helper driver does not have that weakness.
 */

// COM constants (MsoTriState, PpAlertLevel, MsoAutomationSecurity).
const TRUE = -1;
const FALSE = 0;
const ALERTS_NONE = 1;
const MACROS_FORCE_DISABLE = 3;

type ComObject = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export class ComDriver implements PlaybackDriver {
  readonly name = "com" as const;
  #app: ComObject | null = null;
  #presentation: ComObject | null = null;
  #listeners = new Set<(event: DriverEvent) => void>();

  async #application(): Promise<ComObject> {
    if (this.#app) return this.#app;
    let winax: { Object: new (progId: string) => ComObject };
    try {
      winax = (await import("winax" as string)) as typeof winax;
    } catch {
      throw new PlaybackError("com_unavailable", "The COM bridge (winax) isn't installed on this PC.");
    }
    const app = new winax.Object("PowerPoint.Application");
    // No dialogs a room PC could get stuck behind (item 8: external links never prompt),
    // and macros never run (item 8).
    app.DisplayAlerts = ALERTS_NONE;
    app.AutomationSecurity = MACROS_FORCE_DISABLE;
    this.#app = app;
    return app;
  }

  async start(request: ShowRequest) {
    const began = Date.now();
    await setSlideShowMonitor(request.monitor);
    const app = await this.#application();
    try {
      this.#presentation = app.Presentations.Open(request.file, TRUE, FALSE, FALSE);
      const settings = this.#presentation!.SlideShowSettings;
      settings.ShowPresenterView = request.presenterView ? TRUE : FALSE;
      settings.Run();
    } catch (caught) {
      throw new PlaybackError("open_failed", `PowerPoint couldn't open the file: ${String(caught)}`);
    }
    while (Number(app.SlideShowWindows.Count) < 1) {
      if (Date.now() - began > 15_000) throw new PlaybackError("timeout", "The slideshow didn't start.");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const [powerPoint] = await processTable().powerPoint();
    return { firstSlideMs: Date.now() - began, ...(powerPoint ? { pid: powerPoint.pid } : {}) };
  }

  async status(): Promise<ShowStatus> {
    const app = this.#app;
    if (!app) return { running: false, responsive: true };
    try {
      if (Number(app.SlideShowWindows.Count) < 1) return { running: false, responsive: true };
      const window = app.SlideShowWindows.Item(1);
      return {
        running: true,
        responsive: true,
        slide: Number(window.View.CurrentShowPosition),
        window: {
          left: Number(window.Left),
          top: Number(window.Top),
          width: Number(window.Width),
          height: Number(window.Height),
        },
      };
    } catch (caught) {
      this.#emit({ kind: "crashed", detail: `COM call failed: ${String(caught)}` });
      throw caught;
    }
  }

  async stop() {
    const app = this.#app;
    if (!app) return;
    if (Number(app.SlideShowWindows.Count) > 0) app.SlideShowWindows.Item(1).View.Exit();
    this.#presentation?.Close();
    this.#presentation = null;
  }

  async shutdown() {
    try {
      this.#presentation?.Close();
    } catch {
      // Already gone.
    }
    try {
      this.#app?.Quit();
    } catch {
      // Already gone; the supervisor ends any leftover process.
    }
    this.#presentation = null;
    this.#app = null;
  }

  onEvent(listener: (event: DriverEvent) => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(event: DriverEvent) {
    for (const listener of this.#listeners) listener(event);
  }
}
