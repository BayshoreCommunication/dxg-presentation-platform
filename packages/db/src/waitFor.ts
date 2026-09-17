import { getPool, closePool } from "./pool.ts";

const deadline = Date.now() + 60_000;
let lastError: unknown;

while (Date.now() < deadline) {
  try {
    await getPool().query("SELECT 1");
    console.log("postgres ready");
    await closePool();
    process.exit(0);
  } catch (error) {
    lastError = error;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

console.error("postgres did not become ready in 60s:", lastError);
process.exit(1);
