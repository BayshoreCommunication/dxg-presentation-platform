import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { survivePoolErrors } from "./pool.ts";

// No database needed: a pool emits `error` itself when an idle client's connection drops.

test("an unheard pool error throws, which is what used to kill the API", () => {
  const pool = new pg.Pool();
  assert.throws(() => pool.emit("error", new Error("Connection terminated unexpectedly")));
});

test("a pool error is logged and survived once the pool is guarded", (t) => {
  const logged = t.mock.method(console, "error", () => undefined);
  const pool = survivePoolErrors(new pg.Pool(), "app");
  assert.doesNotThrow(() => pool.emit("error", new Error("Connection terminated unexpectedly")));
  assert.equal(logged.mock.callCount(), 1);
  assert.match(String(logged.mock.calls[0]?.arguments[0]), /app pool/);
});
