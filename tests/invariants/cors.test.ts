import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";

/*
 * The two web apps are served from :3000 and :3001 and call the API on :4000, so every
 * request they make is cross-origin and every non-simple header has to be named in the
 * preflight response. `Access-Control-Allow-Headers` listed only "content-type,
 * authorization", so `x-file-name` — which is how an upload tells the API what the
 * file was called — was refused by the browser before the request was ever sent.
 *
 * Schedule import was therefore impossible from the browser on both the standalone
 * screen and the create-event wizard, while working perfectly from any script. Nothing
 * in the suite could see it, because nothing in the suite was a browser.
 */
const ROOT = process.env.API_BASE?.replace("/api/v1", "") ?? "http://localhost:4000";
const WEB_ORIGIN = process.env.STAFF_BASE ?? "http://localhost:3000";

let up = false;
before(async () => {
  try {
    up = (await fetch(`${ROOT}/ops/health`)).ok;
  } catch {
    up = false;
  }
});

const preflight = (path: string, headers: string) =>
  fetch(`${ROOT}${path}`, {
    method: "OPTIONS",
    headers: {
      origin: WEB_ORIGIN,
      "access-control-request-method": "POST",
      "access-control-request-headers": headers,
    },
  });

/** Every custom header the web apps actually send. Add to this when one is added. */
const SENT_BY_THE_WEB_APPS = ["x-file-name"];

describe("the browser is allowed to send what the web apps actually send", () => {
  for (const header of SENT_BY_THE_WEB_APPS) {
    test(`preflight permits ${header}`, async (t: TestContext) => {
      if (!up) return t.skip("API not running");
      const response = await preflight("/api/v1/events/any/imports", `content-type,${header}`);
      const allowed = (response.headers.get("access-control-allow-headers") ?? "").toLowerCase();
      assert.ok(
        allowed.split(",").map((entry) => entry.trim()).includes(header),
        `${header} is missing from Access-Control-Allow-Headers ("${allowed}") — the browser will refuse the request before it is sent`,
      );
    });
  }

  test("credentials are still allowed, since the session is a cookie", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await preflight("/api/v1/events", "content-type");
    assert.equal(response.headers.get("access-control-allow-credentials"), "true");
    assert.equal(response.headers.get("access-control-allow-origin"), WEB_ORIGIN);
  });
});
