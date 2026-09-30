import { app, BrowserWindow, screen } from "electron";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { LaunchLog } from "../src/core/launchLog.ts";
import { processTable } from "../src/core/processes.ts";
import { Supervisor } from "../src/core/supervisor.ts";
import type { HoldingScreen, LaunchInput, MediaPlayer } from "../src/core/supervisor.ts";
import { driverFor } from "../src/drivers/index.ts";

/**
 * The Room Agent's Electron shell (G0-1 proof of concept, docs/poc/G0-1_PLAN.md A1).
 *
 * It owns the windows — the holding screen and the media window — and wires them to the
 * supervisor, which owns everything else. A control port on 127.0.0.1 lets the G0-1
 * harness (and, after G0-1, the real Launch command) drive it; it answers only this PC.
 *
 * Settings come from `agent.config.json` in the agent's data folder, or environment:
 *   driver (com | helper | fake), libraryRoot, monitor (1-based), controlPort,
 *   eventName, roomName.
 */

type Config = {
  driver?: string;
  libraryRoot: string;
  monitor: number;
  controlPort: number;
  eventName: string;
  roomName: string;
};

function loadConfig(): Config {
  const dataDir = app.getPath("userData");
  let file: Partial<Config> = {};
  try {
    // Windows PowerShell 5 writes UTF-8 with a byte-order mark, which JSON.parse rejects —
    // and a silently ignored config sends the agent to the wrong library.
    const text = readFileSync(path.join(dataDir, "agent.config.json"), "utf8").replace(/^\uFEFF/, "");
    file = JSON.parse(text) as Partial<Config>;
  } catch {
    // No file: environment and defaults.
  }
  const env = process.env;
  return {
    ...(env.AGENT_DRIVER ?? file.driver ? { driver: env.AGENT_DRIVER ?? file.driver } : {}),
    libraryRoot: env.AGENT_LIBRARY ?? file.libraryRoot ?? path.join(dataDir, "library"),
    monitor: Number(env.AGENT_MONITOR ?? file.monitor ?? 1),
    controlPort: Number(env.AGENT_CONTROL_PORT ?? file.controlPort ?? 47800),
    eventName: env.AGENT_EVENT_NAME ?? file.eventName ?? "",
    roomName: env.AGENT_ROOM_NAME ?? file.roomName ?? "",
  };
}

/** Windows numbers monitors from 1; Electron lists displays in its own order — map by position. */
function displayFor(monitor: number) {
  const displays = [...screen.getAllDisplays()].sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
  return displays[Math.max(0, Math.min(displays.length - 1, monitor - 1))]!;
}

/** AGENT_WINDOWED=1: small ordinary windows, for developing on a desktop without losing it. */
const windowed = process.env.AGENT_WINDOWED === "1";

function fullScreenWindow(monitor: number): BrowserWindow {
  const { bounds } = displayFor(monitor);
  return new BrowserWindow({
    ...(windowed ? { x: bounds.x + 40, y: bounds.y + 40, width: 640, height: 360 } : bounds),
    frame: windowed,
    fullscreen: !windowed,
    show: false,
    backgroundColor: "#0b0d0c",
    autoHideMenuBar: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
}

function holdingScreen(config: Config): HoldingScreen {
  const window = fullScreenWindow(config.monitor);
  const page = path.join(__dirname, "holding.html");
  const show = (reason: string) => {
    void window.loadFile(page, { query: { event: config.eventName, room: config.roomName, reason } });
    window.showInactive();
    if (!windowed) window.setFullScreen(true);
  };
  return { show, hide: () => window.hide() };
}

function mediaPlayer(): MediaPlayer {
  let window: BrowserWindow | null = null;
  return {
    async play(file, monitor) {
      window?.destroy();
      window = fullScreenWindow(monitor);
      if (file.toLowerCase().endsWith(".pdf")) await window.loadURL(pathToFileURL(file).href);
      else await window.loadFile(path.join(__dirname, "media.html"), { query: { src: pathToFileURL(file).href } });
      window.show();
    },
    async stop() {
      window?.destroy();
      window = null;
    },
  };
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body ? (JSON.parse(body) as Record<string, unknown>) : {};
}

function controlServer(supervisor: Supervisor, config: Config) {
  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const server = createServer((req, res) => {
    void (async () => {
      try {
        if (req.method === "GET" && req.url === "/status") {
          return send(res, 200, { state: supervisor.state, current: supervisor.current, pid: process.pid });
        }
        if (req.method === "POST" && req.url === "/launch") {
          const body = await readJson(req);
          const input: LaunchInput = {
            file: String(body.file ?? ""),
            monitor: Number(body.monitor ?? config.monitor),
            presenterView: body.presenterView === true,
            ...(typeof body.sha256 === "string" ? { sha256: body.sha256 } : {}),
            ...(typeof body.launchId === "string" ? { launchId: body.launchId } : {}),
          };
          return send(res, 200, await supervisor.launch(input));
        }
        // The monitors as Windows numbers them, for the monitor-targeting evidence (item 3).
        if (req.method === "GET" && req.url === "/displays") {
          const displays = [...screen.getAllDisplays()].sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
          return send(res, 200, displays.map((d, i) => ({ monitor: i + 1, bounds: d.bounds, scaleFactor: d.scaleFactor })));
        }
        // Where the slideshow window is right now (points, from PowerPoint), for item 3.
        if (req.method === "GET" && req.url === "/show") {
          return send(res, 200, await supervisor.showStatus());
        }
        // Quits PowerPoint and ends leftovers — the end of the process-cleanup check (item 15).
        if (req.method === "POST" && req.url === "/reset") {
          await supervisor.reset();
          return send(res, 200, { state: supervisor.state });
        }
        // Restart the agent (the watchdog starts it again with fresh settings). Loopback only,
        // like every route here: a remote session can't end a desktop program on Windows.
        if (req.method === "POST" && req.url === "/restart") {
          send(res, 200, { restarting: true });
          setTimeout(() => app.exit(0), 200);
          return;
        }
        if (req.method === "POST" && req.url === "/stop") {
          await supervisor.stop();
          return send(res, 200, { state: supervisor.state });
        }
        send(res, 404, { error: "not found" });
      } catch (caught) {
        send(res, 500, { error: caught instanceof Error ? caught.message : String(caught) });
      }
    })();
  });
  // Loopback only: nothing off this PC can drive the room.
  server.listen(config.controlPort, "127.0.0.1");
  return server;
}

// Its own data folder (%APPDATA%\DXG Room Agent), not Electron's default.
app.setName("DXG Room Agent");

// One agent per PC: a second copy exits at once (never two agents fighting over PowerPoint).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    const config = loadConfig();
    const dataDir = app.getPath("userData");
    const supervisor = new Supervisor({
      driver: driverFor(config.driver, { helperScript: path.join(__dirname, "helper", "ppt-helper.ps1") }),
      holding: holdingScreen(config),
      media: mediaPlayer(),
      log: new LaunchLog(path.join(dataDir, "logs")),
      processes: processTable(),
      libraryRoot: config.libraryRoot,
      stateDir: path.join(dataDir, "state"),
    });
    await supervisor.start();
    const server = controlServer(supervisor, config);
    app.on("before-quit", () => {
      server.close();
      void supervisor.dispose();
    });
  });
  // Closing a window never ends the agent; only the watchdog or the technician does.
  app.on("window-all-closed", () => undefined);
}
