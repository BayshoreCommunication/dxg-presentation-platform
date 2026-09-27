/**
 * Malware scanning (NFR-SEC-04, invariant I-2). Production uses the ClamAV
 * container (M2-5). `DevSignatureScanner` is a real scanner with a one-entry
 * signature database (the EICAR test string) — it is NOT a bypass: every file
 * still passes through a scanner and a scanner error still fails closed.
 */
export type ScanVerdict = "clean" | "infected" | "error";

export interface Scanner {
  readonly name: string;
  scan(body: Buffer): Promise<{ verdict: ScanVerdict; signature?: string }>;
}

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

export class DevSignatureScanner implements Scanner {
  readonly name = "dev-signature-scanner";

  async scan(body: Buffer): Promise<{ verdict: ScanVerdict; signature?: string }> {
    if (body.includes(Buffer.from(EICAR))) {
      return { verdict: "infected", signature: "Eicar-Test-Signature" };
    }
    return { verdict: "clean" };
  }
}

/**
 * The real scanner (NFR-SEC-04, production readiness): ClamAV's clamd over TCP, using its
 * INSTREAM command — the file is streamed in chunks, clamd answers `stream: OK` or
 * `stream: <signature> FOUND`. It fails **closed**: a timeout, a refused connection, a
 * size limit or any other answer is `error`, and the caller stores nothing.
 */
export class ClamdScanner implements Scanner {
  readonly name = "clamd";
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;

  constructor(host: string, port = 3310, timeoutMs = 120_000) {
    this.host = host;
    this.port = port;
    this.timeoutMs = timeoutMs;
  }

  async scan(body: Buffer): Promise<{ verdict: ScanVerdict; signature?: string }> {
    const { createConnection } = await import("node:net");
    return new Promise((resolve) => {
      const socket = createConnection({ host: this.host, port: this.port });
      const chunks: Buffer[] = [];
      let settled = false;
      const finish = (result: { verdict: ScanVerdict; signature?: string }) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(result);
      };
      socket.setTimeout(this.timeoutMs, () => finish({ verdict: "error", signature: "clamd timed out" }));
      socket.on("error", (error) => finish({ verdict: "error", signature: `clamd unreachable: ${error.message}` }));
      socket.on("data", (data) => chunks.push(data));
      socket.on("end", () => {
        const reply = Buffer.concat(chunks).toString("utf8").replace(/\0/g, "").trim();
        if (/^stream: OK$/.test(reply)) return finish({ verdict: "clean" });
        const found = /^stream: (.+) FOUND$/.exec(reply);
        if (found) return finish({ verdict: "infected", signature: found[1] ?? "unknown" });
        finish({ verdict: "error", signature: reply || "no answer from clamd" });
      });
      socket.on("connect", () => {
        socket.write("zINSTREAM\0");
        const CHUNK = 64 * 1024;
        for (let offset = 0; offset < body.length; offset += CHUNK) {
          const piece = body.subarray(offset, offset + CHUNK);
          const size = Buffer.alloc(4);
          size.writeUInt32BE(piece.length);
          socket.write(size);
          socket.write(piece);
        }
        socket.write(Buffer.alloc(4)); // a zero-length chunk ends the stream
      });
    });
  }
}

/** clamd when CLAMAV_HOST is set (production), the signature scanner otherwise. */
export function scannerFromEnv(env: NodeJS.ProcessEnv = process.env): Scanner {
  if (!env.CLAMAV_HOST) {
    if (env.NODE_ENV === "production") {
      throw new Error("CLAMAV_HOST is required in production — uploads must be scanned by ClamAV.");
    }
    return new DevSignatureScanner();
  }
  return new ClamdScanner(env.CLAMAV_HOST, Number(env.CLAMAV_PORT ?? 3310));
}
