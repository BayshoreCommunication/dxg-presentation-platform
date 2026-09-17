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
