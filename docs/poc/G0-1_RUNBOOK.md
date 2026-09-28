# G0-1 runbook — running the Room Agent matrix on Windows

Plan: `docs/poc/G0-1_PLAN.md` (this is Phase B). Report: `docs/poc/ROOM_AGENT_POC.md`. Gate: `docs/PHASE0_GATE.md` §G0-1.

Do this once on the **Windows 11** PC, then again on the **Windows 10** machine. Every command below runs in
PowerShell as the **standard (non-admin) test account** unless it says otherwise.

## 1. Set up the PC (once)

1. Sign in to Microsoft 365 and open PowerPoint once by hand: accept the first-run screens, then close it.
   Turn off "Show the Start screen" (File → Options → General) so it never waits on a screen nobody sees.
2. Install **Node 24.4.1** (x64) and **Git**. Installing for the current user only is fine.
3. Get the repo and install:

   ```powershell
   git clone https://github.com/BayshoreCommunication/dxg-presentation-platform.git
   cd dxg-presentation-platform
   npm ci
   ```

4. Install the COM bridge for the in-process driver, built for Electron (it is not in the repo's dependencies):

   ```powershell
   cd apps/room-agent
   npm i --no-save winax
   npx electron-rebuild -f -w winax     # or: npx @electron/rebuild -f -w winax
   ```

   This needs the Visual Studio Build Tools ("Desktop development with C++"). If the build fails, note the error
   in the report and use the helper driver (it needs nothing extra) — that failure is itself G0-1 evidence.

5. Build the agent: `npm run build` (writes `dist/`).
6. Tell the agent where the test files are. Create `%APPDATA%\DXG Room Agent\agent.config.json`:

   ```json
   {
     "driver": "com",
     "libraryRoot": "C:\\Users\\<you>\\dxg-presentation-platform\\tests\\fixtures\\g0-1",
     "monitor": 1,
     "eventName": "G0-1 test",
     "roomName": "Test room"
   }
   ```

   `driver` is `com` (winax, in-process) or `helper` (PowerShell helper, one process per launch).
7. Make the few corpus files that need PowerPoint itself (see `tests/fixtures/g0-1/MANIFEST.md`, "made on
   Windows"), and the large deck if you need it: `scripts/g0-1-corpus/README.md`.
8. Start the agent under the watchdog, and register it to start at sign-in (items 10 and 13 need both):

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
   node scripts\watchdog.mjs
   ```

   The holding screen should cover monitor 1. `curl http://127.0.0.1:47800/status` answers `{"state":"idle",...}`.

9. Record the versions (the report's first table): `node harness/run.ts versions --os win11`.

## 2. Run the matrix

From `apps/room-agent`, one command per item. Each writes `docs/poc/evidence/<os>/item-NN/result.json`. Items that
need eyes ask a yes/no question in the terminal — answer `y` or `n` followed by a short note.

| Item | Command | Needs a person? | Time |
|---|---|---|---|
| 1 launch reliability | `node harness/run.ts 1 --os win11` | no | ~10 min |
| 2 presenter view | `node harness/run.ts 2 --os win11` | yes (2 monitors) | 2 min |
| 3 monitor targeting | `node harness/run.ts 3 --os win11` | yes; run with 2 **and** 3 monitors | 5 min |
| 4 animations fidelity | `node harness/run.ts 4 --os win11` | yes; record the screen | 30 min |
| 5 media | `node harness/run.ts 5 --os win11` | yes | 10 min |
| 6 fonts | `node harness/run.ts 6 --os win11` | yes | 5 min |
| 7 file types | `node harness/run.ts 7 --os win11` | yes | 5 min |
| 8 macros / links | `node harness/run.ts 8 --os win11` | yes | 3 min |
| 9 PowerPoint crash | `node harness/run.ts 9 --os win11` | no | 3 min |
| 10 agent crash | `node harness/run.ts 10 --os win11` | no (watchdog running) | 2 min |
| 11 holding screen | `node harness/run.ts 11 --os win11` | yes | 5 min |
| 12 offline restart | `node harness/run.ts 12 --os win11` | yes (unplug network) | 5 min |
| 13 reboot | `node harness/run.ts 13 --os win11`, reboot, then `… 13 --os win11 --after-reboot` | yes | 10 min |
| 14 72-hour soak | `node harness/run.ts 14 --os win11` (network unplugged) | no | 72 h |
| 15 process cleanup | `node harness/run.ts 15 --os win11` | no | ~8 min |
| 16 concurrent launches | `node harness/run.ts 16 --os win11` | no | 1 min |

Then `node harness/run.ts report --os win11` writes `docs/poc/evidence/win11/SUMMARY.md` — copy its table into the
report.

Useful options: `--cycles N` (items 1, 15; below 100 records NEEDS_REVIEW), `--hours N` and
`--launch-every-min N` (item 14; below 72 hours records NEEDS_REVIEW), `--port`, `--corpus`.

### Fidelity items (4, 5, 6)

For each deck, record two short screen captures (Win+Alt+R with Xbox Game Bar, or OBS): the agent playing it, and
the same deck opened by hand in PowerPoint and started with F5. Save them next to that item's `result.json` as
`<deck>-agent.mp4` and `<deck>-native.mp4`. DXG signs off on these.

### When an item fails with `com`

1. Save the failing `result.json` (rename it `result-com.json`).
2. Change `driver` to `helper` in `agent.config.json`, restart the agent (end it in Task Manager; the watchdog
   restarts it) and run the item again.
3. Both results go in the report. The outcome rules are in the plan.

## 3. Where to look when something is odd

- Launch log: `%APPDATA%\DXG Room Agent\logs\launch-log.jsonl` — one line per launch, crash, relaunch and reset.
- Watchdog log: `apps\room-agent\watchdog.log`.
- What is on screen right now: `curl http://127.0.0.1:47800/show` and `/status`.
- Stuck PowerPoint: `curl -X POST http://127.0.0.1:47800/reset` quits it and ends any leftovers.
- Which monitor is which: `curl http://127.0.0.1:47800/displays` (monitor numbers go left to right).

## 4. After the run

Copy `docs/poc/evidence/<os>/` off the PC (it is the evidence; the recordings can go to shared storage instead of
the repo if they are large), fill in `ROOM_AGENT_POC.md`, and remove the scheduled task:
`Unregister-ScheduledTask -TaskName "DXG Room Agent"`.
