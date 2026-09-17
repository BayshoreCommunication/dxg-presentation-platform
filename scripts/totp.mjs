/** Prints the current code for the development authenticator secret. */
import { totp } from "../packages/auth/src/totp.ts";

const secret = process.env.DEV_MFA_SECRET ?? "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const seconds = 30 - Math.floor((Date.now() / 1000) % 30);
console.log(`${totp(secret)}  (valid for ${seconds}s)`);
