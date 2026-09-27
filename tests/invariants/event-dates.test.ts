import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { signInStaff } from "../helpers/signIn.ts";
import { removeTestEvents } from "../helpers/cleanup.ts";

/**
 * A new event starts tomorrow at the earliest, in its own time zone (D-101). The date
 * picker offers nothing earlier; the API holds the rule for anything that calls it directly.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const ZONE = "America/New_York";
const PREFIX = "probe-dates-";

let up = false;
let admin = "";

/** `YYYY-MM-DD` in the event's zone, `offset` days from today. */
const day = (offset: number) => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(new Date());
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

const create = (starts_on: string, ends_on = starts_on) =>
  fetch(`${API}/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: admin },
    body: JSON.stringify({
      client_id: "11111111-1111-4111-8111-111111111111",
      name: `${PREFIX}${Date.now()}-${starts_on}`,
      timezone: ZONE,
      starts_on,
      ends_on,
    }),
  });

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  admin = await signInStaff(API, "admin@example.invalid", "dxg-development-password");
});

describe("an event starts in the future (D-101)", () => {
  for (const [label, offset] of [["yesterday", -1], ["today", 0]] as const) {
    test(`an event starting ${label} is refused`, async (t: TestContext) => {
      if (!up || !admin) return t.skip("API not running");
      const response = await create(day(offset), day(1));
      assert.equal(response.status, 422);
      assert.equal(((await response.json()) as { code: string }).code, "events.bad_dates");
    });
  }

  test("an event starting tomorrow is accepted", async (t: TestContext) => {
    if (!up || !admin) return t.skip("API not running");
    const response = await create(day(1), day(2));
    assert.equal(response.status, 201);
  });
});

after(async () => {
  if (!up) return;
  await removeTestEvents([PREFIX]);
});
