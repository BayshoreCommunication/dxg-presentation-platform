import type { PlaybackDriver } from "../core/driver.ts";
import { ComDriver } from "./comDriver.ts";
import { FakeDriver } from "./fakeDriver.ts";
import { HelperDriver } from "./helperDriver.ts";

/** The driver named in config (G0-1 evidence sets the default; BUILD_SPEC §9). */
export function driverFor(name: string | undefined, options: { helperScript?: string } = {}): PlaybackDriver {
  switch (name ?? (process.platform === "win32" ? "helper" : "fake")) {
    case "com":
      return new ComDriver();
    case "helper":
      // A bundled agent passes the script's real path (import.meta.url does not survive bundling).
      return options.helperScript
        ? new HelperDriver({
            args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", options.helperScript],
          })
        : new HelperDriver();
    case "fake":
      return new FakeDriver();
    default:
      throw new Error(`Unknown playback driver "${name}" — use com, helper or fake.`);
  }
}
