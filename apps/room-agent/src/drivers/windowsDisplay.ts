import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Which monitor PowerPoint puts the slideshow on (G0-1 item 3). PowerPoint reads it from
 * its per-user options, not from the COM call, so both drivers set it just before Run.
 * `\\.\DISPLAY<n>` is how Windows names monitors; the harness records where the window
 * actually lands, which is the evidence.
 */
export async function setSlideShowMonitor(monitor: number): Promise<void> {
  await run(
    "reg",
    [
      "add",
      "HKCU\\Software\\Microsoft\\Office\\16.0\\PowerPoint\\Options",
      "/v",
      "DisplayMonitor",
      "/t",
      "REG_SZ",
      "/d",
      `\\\\.\\DISPLAY${monitor}`,
      "/f",
    ],
    { windowsHide: true },
  );
}
