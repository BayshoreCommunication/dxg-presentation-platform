import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { HelperDriver } from "./helperDriver.ts";
import { parseTasklist } from "../core/processes.ts";

const fakeHelper = fileURLToPath(new URL("./fakeHelper.mjs", import.meta.url));
const request = { file: "C:\\library\\deck.pptx", monitor: 2, presenterView: false, launchId: "t1" };
const helper = (mode = "") => {
  process.env.FAKE_HELPER = mode;
  return new HelperDriver({ command: process.execPath, args: [fakeHelper] });
};

describe("helper driver protocol", () => {
  test("start, status, stop and shutdown round-trip, ignoring non-JSON noise", async () => {
    const driver = helper();
    const started = await driver.start(request);
    assert.equal(started.firstSlideMs, 12);
    assert.equal(started.pid, 777);
    assert.equal((await driver.status()).running, true);
    await driver.stop();
    assert.equal((await driver.status()).running, false);
    await driver.shutdown();
  });

  test("a refusal from PowerPoint becomes a PlaybackError with its code", async () => {
    const driver = helper();
    await assert.rejects(driver.start({ ...request, file: "C:\\library\\broken.pptx" }), (error: unknown) => {
      return (error as { code?: string }).code === "com_error";
    });
    await driver.shutdown();
  });

  test("the helper dying is reported as a crash", async () => {
    const driver = helper("crash-on-start");
    const crashes: string[] = [];
    driver.onEvent((event) => {
      if (event.kind === "crashed") crashes.push(event.detail);
    });
    await assert.rejects(driver.start(request));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(crashes.length, 1);
  });

  test("a hung helper is killed by shutdown and a fresh one serves the next start", async () => {
    const driver = helper("hang-status");
    await driver.start(request);
    const status = driver.status();
    const outcome = await Promise.race([status.then(() => "answered"), new Promise((r) => setTimeout(() => r("hung"), 100))]);
    assert.equal(outcome, "hung");
    await driver.shutdown();
    await assert.rejects(status, "the stuck call is released, not left hanging");
    process.env.FAKE_HELPER = "";
    assert.equal((await driver.start(request)).firstSlideMs, 12);
    await driver.shutdown();
  });
});

describe("process table", () => {
  test("reads PowerPoint processes and memory from tasklist CSV", () => {
    const csv = [
      '"POWERPNT.EXE","5120","Console","1","183,456 K"',
      '"explorer.exe","100","Console","1","90,000 K"',
      '"POWERPNT.EXE","6200","Console","1","1.024 K"',
    ].join("\r\n");
    assert.deepEqual(parseTasklist(csv), [
      { pid: 5120, memoryKb: 183456 },
      { pid: 6200, memoryKb: 1024 },
    ]);
  });
});
