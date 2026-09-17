import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
// Type-only: erased at build time, so the SDK is loaded lazily and only when
// the SES transport is actually used.
import type { SESv2Client } from "@aws-sdk/client-sesv2";

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

export type SesConfig = {
  region: string;
  from: string;
  /** Required for delivery events: SES only publishes them for a configuration set. */
  configurationSet?: string | undefined;
  replyTo?: string | undefined;
};

/**
 * Reads SES configuration from the environment, refusing to start on anything
 * missing. Failing at boot is better than discovering at the first send that
 * nobody has been receiving anything.
 */
export function sesConfigFromEnv(): SesConfig {
  const region = process.env.AWS_REGION ?? process.env.SES_REGION;
  const from = process.env.MAIL_FROM;
  const missing = [!region && "AWS_REGION (or SES_REGION)", !from && "MAIL_FROM"].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`SES transport is missing required configuration: ${missing.join(", ")}`);
  }
  if (!process.env.SES_CONFIGURATION_SET) {
    console.error(
      "[mail] SES_CONFIGURATION_SET is not set — mail will send, but SES will publish no delivery, bounce or complaint events.",
    );
  }
  return {
    region: region!,
    from: from!,
    configurationSet: process.env.SES_CONFIGURATION_SET,
    replyTo: process.env.MAIL_REPLY_TO,
  };
}

/**
 * Production sender. Every message is tagged with the communication it belongs
 * to, so the delivery events SES publishes can be matched back to a speaker
 * without relying on the message id alone.
 */
export class SesSender implements EmailSender {
  readonly name = "ses";
  private readonly config: SesConfig;
  private client: SESv2Client | undefined;

  constructor(config: SesConfig = sesConfigFromEnv()) {
    this.config = config;
  }

  private async clientFor(): Promise<SESv2Client> {
    if (!this.client) {
      const { SESv2Client } = await import("@aws-sdk/client-sesv2");
      this.client = new SESv2Client({ region: this.config.region });
    }
    return this.client;
  }

  async send(message: Message): Promise<Delivery> {
    const { SendEmailCommand } = await import("@aws-sdk/client-sesv2");
    const client = await this.clientFor();

    // SES tag values allow only letters, digits, underscores and dashes.
    const tags = [
      { Name: "kind", Value: message.kind.replace(/[^A-Za-z0-9_-]/g, "_") },
      ...(message.ref ? [{ Name: "communication_id", Value: message.ref }] : []),
    ];

    const response = await client.send(
      new SendEmailCommand({
        FromEmailAddress: this.config.from,
        Destination: { ToAddresses: [message.to] },
        ...(this.config.replyTo ? { ReplyToAddresses: [this.config.replyTo] } : {}),
        ...(this.config.configurationSet ? { ConfigurationSetName: this.config.configurationSet } : {}),
        EmailTags: tags,
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: "UTF-8" },
            Body: { Text: { Data: message.body, Charset: "UTF-8" } },
          },
        },
      }),
    );

    if (!response.MessageId) {
      throw new Error("SES accepted the request but returned no MessageId");
    }
    return { id: response.MessageId, accepted: true, detail: { transport: "ses" } };
  }
}

export function senderFromEnv(): EmailSender {
  const transport = process.env.MAIL_TRANSPORT ?? (process.env.NODE_ENV === "production" ? "ses" : "file");
  return transport === "ses" ? new SesSender() : new FileSender();
}

export * from "./sns.ts";
