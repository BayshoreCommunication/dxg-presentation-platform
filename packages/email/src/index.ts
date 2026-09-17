import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type Message = {
  to: string;
  subject: string;
  body: string;
  /** What produced it, for the delivery log and for debugging. */
  kind: string;
  ref?: string | undefined;
};

export type Delivery = { id: string; accepted: boolean; detail?: Record<string, unknown> };

export interface EmailSender {
  readonly name: string;
  send(message: Message): Promise<Delivery>;
}

/**
 * Development sender: writes each message to disk and prints its subject and
 * recipient. Nothing leaves the machine, and a developer can read exactly what a
 * speaker would have received — including the links inside it.
 */
export class FileSender implements EmailSender {
  readonly name = "file";
  private readonly directory: string;

  constructor(directory = path.join(process.env.FILE_ROOT ?? ".data", "mail")) {
    this.directory = directory;
  }

  async send(message: Message): Promise<Delivery> {
    await mkdir(this.directory, { recursive: true });
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const file = path.join(this.directory, `${id}.json`);
    await writeFile(file, JSON.stringify({ ...message, written_at: new Date().toISOString() }, null, 2));
    console.error(`[mail] ${message.to} · ${message.subject} → ${file}`);
    return { id, accepted: true, detail: { file } };
  }
}

/**
 * Production sender. Deliberately unimplemented rather than silently succeeding:
 * a no-op here would look like working email while every speaker heard nothing.
 * Wiring SES is M3-5.
 */
export class SesSender implements EmailSender {
  readonly name = "ses";

  async send(): Promise<Delivery> {
    throw new Error(
      "The SES sender is not implemented yet (M3-5). Set MAIL_TRANSPORT=file for local development.",
    );
  }
}

export function senderFromEnv(): EmailSender {
  const transport = process.env.MAIL_TRANSPORT ?? (process.env.NODE_ENV === "production" ? "ses" : "file");
  return transport === "ses" ? new SesSender() : new FileSender();
}
