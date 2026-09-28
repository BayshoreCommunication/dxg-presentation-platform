import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FakeDriver } from "../drivers/fakeDriver.ts";
import { LaunchLog } from "./launchLog.ts";
import { sha256Of } from "./launchRules.ts";
import type { ProcessTable } from "./processes.ts";
import { Supervisor } from "./supervisor.ts";

/** G0-1 supervisor rules, proved against the fake driver (items 9, 10, 11, 15, 16). */

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class Holding {
  visible = false;
  reasons: string[] = [];
  show(reason: string) {
    this.visible = true;
    this.reasons.push(reason);
  }
  hide() {
    this.visible = false;
  }
}

class Processes implements ProcessTable {
  alive: number[] = [];
  killed: number[] = [];
  async powerPoint() {
    return this.alive.map((pid) => ({ pid, memoryKb: 100_000 }));
  }
  async kill(pid: number) {
    this.killed.push(pid);
    this.alive = this.alive.filter((alive) => alive !== pid);
  }
}

let dir = "";
let deck = "";
let driver: FakeDriver;
let holding: Holding;
let processes: Processes;
let log: LaunchLog;

const supervisor = (extra: Partial<ConstructorParameters<typeof Supervisor>[0]> = {}) =>
  new Supervisor({
    driver,
    holding,
    log,
    processes,
    libraryRoot: path.join(dir, "library"),
    stateDir: path.join(dir, "state"),
    pollMs: 20,
    statusTimeoutMs: 30,
    launchTimeoutMs: 500,
    ...extra,
  });

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "room-agent-"));
  const library = path.join(dir, "library");
  await import("node:fs/promises").then((fs) => fs.mkdir(library, { recursive: true }));
  deck = path.join(library, "keynote.pptx");
  await writeFile(deck, "PK fake deck");
  driver = new FakeDriver();
  holding = new Holding();
  processes = new Processes();
  log = new LaunchLog(path.join(dir, "logs"));
});

const kinds = async () => (await log.entries()).map((entry) => entry.kind);

describe("launching", () => {
  test("a verified file shows, and the holding screen comes down", async () => {
    const s = supervisor();
    await s.start();
    assert.equal(holding.visible, true, "holding screen up before anything shows");
    const result = await s.launch({ file: deck, sha256: await sha256Of(deck), monitor: 2 });
    assert.equal(result.outcome, "showing");
    assert.equal(holding.visible, false);
    assert.equal(s.state, "showing");
    await s.dispose();
  });

  test("a second launch while one is showing is refused cleanly (item 16)", async () => {
    const s = supervisor();
    await s.launch({ file: deck, monitor: 1 });
    const second = await s.launch({ file: deck, monitor: 1 });
    assert.equal(second.outcome, "busy");
    assert.equal(driver.starts, 1, "never a second PowerPoint");
    await s.dispose();
  });

  test("a launch while one is still starting is refused too", async () => {
    driver.faults.startDelayMs = 100;
    const s = supervisor();
    const first = s.launch({ file: deck, monitor: 1 });
    await wait(10);
    assert.equal((await s.launch({ file: deck, monitor: 1 })).outcome, "busy");
    assert.equal((await first).outcome, "showing");
    await s.dispose();
  });

  for (const [label, input, code] of [
    ["a file outside the library", { file: "/etc/hosts", monitor: 1 }, "outside_library"],
    ["a file that isn't there", { file: "MISSING", monitor: 1 }, "missing"],
    ["a Keynote file", { file: "KEY", monitor: 1 }, "unsupported_type"],
    ["a copy that doesn't match the approved checksum", { file: "DECK", sha256: "0".repeat(64), monitor: 1 }, "checksum_mismatch"],
  ] as const) {
    test(`${label} is refused and the holding screen stays up`, async () => {
      const s = supervisor();
      const file =
        input.file === "MISSING"
          ? path.join(dir, "library", "gone.pptx")
          : input.file === "KEY"
            ? path.join(dir, "library", "talk.key")
            : input.file === "DECK"
              ? deck
              : input.file;
      if (input.file === "KEY") await writeFile(file, "keynote");
      const result = await s.launch({ ...input, file });
      assert.equal(result.outcome, "refused");
      assert.equal(result.outcome === "refused" && result.code, code);
      assert.equal(holding.visible, true);
      assert.equal(driver.starts, 0);
      await s.dispose();
    });
  }

  test("a start that fails leaves the holding screen up and cleans up PowerPoint", async () => {
    driver.faults.failStart = "open_failed";
    processes.alive = [900];
    const s = supervisor();
    const result = await s.launch({ file: deck, monitor: 1 });
    assert.equal(result.outcome, "failed");
    assert.equal(holding.visible, true);
    assert.deepEqual(processes.killed, [900], "leftover PowerPoint ended");
    assert.equal(s.state, "idle", "ready for the next launch");
    await s.dispose();
  });

  test("a start that never answers times out into the holding screen", async () => {
    driver.faults.startDelayMs = 2000;
    const s = supervisor({ launchTimeoutMs: 80 });
    const result = await s.launch({ file: deck, monitor: 1 });
    assert.equal(result.outcome, "failed");
    assert.equal(result.outcome === "failed" && result.code, "timeout");
    assert.equal(holding.visible, true);
    await s.dispose();
  });
});

describe("while showing (item 9)", () => {
  test("a crash puts the holding screen up and restarts the show once", async () => {
    driver.faults.crashAfterMs = 30;
    const s = supervisor();
    await s.launch({ file: deck, monitor: 1 });
    delete driver.faults.crashAfterMs; // the relaunch does not crash
    await wait(150);
    assert.ok(holding.reasons.some((reason) => reason.includes("restarting")));
    assert.equal(driver.starts, 2, "relaunched once");
    assert.equal(s.state, "showing");
    assert.ok((await kinds()).includes("show.relaunched"));
    await s.dispose();
  });

  test("crashing again after the relaunch gives up on the holding screen", async () => {
    driver.faults.crashAfterMs = 30;
    const s = supervisor();
    await s.launch({ file: deck, monitor: 1 });
    await wait(250);
    assert.equal(s.state, "idle");
    assert.equal(holding.visible, true, "never a bare desktop");
    assert.ok((await kinds()).includes("show.gave_up"));
    await s.dispose();
  });

  test("PowerPoint that stops answering is treated as a crash", async () => {
    driver.faults.hangAfterMs = 20;
    const s = supervisor({ relaunchesPerShow: 0 });
    await s.launch({ file: deck, monitor: 1 });
    await wait(200);
    assert.equal(holding.visible, true);
    const entries = await log.entries();
    assert.ok(entries.some((entry) => entry.kind === "show.crashed" && String(entry.detail.detail).includes("answering")));
    await s.dispose();
  });

  test("a show that ends by itself returns to the holding screen", async () => {
    const s = supervisor();
    await s.launch({ file: deck, monitor: 1 });
    driver.endShow();
    await wait(30);
    assert.equal(s.state, "idle");
    assert.equal(holding.visible, true);
    await s.dispose();
  });

  test("stop ends the show and returns to the holding screen", async () => {
    const s = supervisor();
    await s.launch({ file: deck, monitor: 1 });
    await s.stop();
    assert.equal(s.state, "idle");
    assert.equal(holding.visible, true);
    assert.equal((await s.launch({ file: deck, monitor: 1 })).outcome, "showing", "ready again");
    await s.dispose();
  });
});

describe("restarts (items 10, 13, 15)", () => {
  test("an agent restarted mid-show resumes the same show", async () => {
    const first = supervisor();
    const shown = await first.launch({ file: deck, monitor: 2 });
    await first.dispose(); // the agent process dies here

    driver = new FakeDriver();
    const second = supervisor();
    await second.start();
    assert.equal(second.state, "showing");
    assert.equal(second.current?.monitor, 2);
    assert.equal(second.current?.launchId, shown.launchId);
    await second.dispose();
  });

  test("an agent that starts with PowerPoint left over ends it first", async () => {
    processes.alive = [11, 12];
    const s = supervisor();
    await s.start();
    assert.deepEqual(processes.killed.sort(), [11, 12]);
    await s.dispose();
  });

  test("a show that was stopped is not resumed after a restart", async () => {
    const first = supervisor();
    await first.launch({ file: deck, monitor: 1 });
    await first.stop();
    await first.dispose();
    const second = supervisor();
    await second.start();
    assert.equal(second.state, "idle");
    await second.dispose();
  });
});

describe("linked media (item 5)", () => {
  test("a deck linking to a video that isn't on the PC still shows, and the gap is reported", async () => {
    const { writeZip } = await import("../../../../packages/files/src/zipWrite.ts");
    const linked = path.join(dir, "library", "linked.pptx");
    await writeFile(path.join(dir, "library", "present.mp4"), "video");
    await writeFile(
      linked,
      writeZip([
        { name: "[Content_Types].xml", body: Buffer.from("<Types/>") },
        { name: "ppt/presentation.xml", body: Buffer.from("<p:presentation/>") },
        {
          name: "ppt/slides/_rels/slide1.xml.rels",
          body: Buffer.from(
            '<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/video" Target="present.mp4" TargetMode="External"/>' +
              '<Relationship Id="rId3" Type="http://schemas.microsoft.com/office/2007/relationships/media" Target="clips/gone.mp4" TargetMode="External"/>' +
              '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://dxg.example" TargetMode="External"/></Relationships>',
          ),
        },
      ]),
    );
    const s = supervisor();
    const result = await s.launch({ file: linked, monitor: 1 });
    assert.equal(result.outcome, "showing");
    assert.deepEqual(result.outcome === "showing" && result.missingLinkedMedia, ["clips/gone.mp4"]);
    assert.ok((await kinds()).includes("launch.missing_linked_media"));
    await s.dispose();
  });
});
