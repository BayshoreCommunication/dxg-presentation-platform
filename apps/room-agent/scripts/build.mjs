// Bundles the Electron main process and copies the pages and helper beside it (dist/).
import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";

await mkdir("dist/helper", { recursive: true });
await build({
  entryPoints: ["electron/main.ts"],
  outfile: "dist/main.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  // Native or Electron-provided: resolved at run time on the room PC.
  external: ["electron", "winax"],
  logLevel: "warning",
  // HelperDriver's default script path uses import.meta.url, which a CJS bundle cannot
  // keep; the bundled agent always passes the path explicitly (driverFor), so it is unused.
  logOverride: { "empty-import-meta": "silent" },
});
await cp("electron/holding.html", "dist/holding.html");
await cp("electron/media.html", "dist/media.html");
await cp("helper/ppt-helper.ps1", "dist/helper/ppt-helper.ps1");
console.log("built dist/main.cjs");
