import { createPublicKey, createVerify } from "node:crypto";

/**
 * SES delivery events arrive through SNS, and SNS messages are signed. Without
 * verification anyone could POST a fabricated bounce — and a bounce suppresses
 * future mail to that speaker, so spoofing one silently cuts a presenter off.
 */
export type SnsMessage = {
  Type: string;
  MessageId: string;
  TopicArn: string;
  Subject?: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL?: string;
  SigningCertUrl?: string;
  SubscribeURL?: string;
  Token?: string;
};

/** The fields AWS signs, in the order it signs them. */
const SIGNED_FIELDS: Record<string, string[]> = {
  Notification: ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"],
  SubscriptionConfirmation: ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"],
  UnsubscribeConfirmation: ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"],
};

export function stringToSign(message: SnsMessage): string {
  const fields = SIGNED_FIELDS[message.Type];
  if (!fields) throw new Error(`Unknown SNS message type "${message.Type}"`);

  let out = "";
  for (const field of fields) {
    const value = (message as unknown as Record<string, string | undefined>)[field];
    // Optional fields are omitted entirely rather than signed as empty.
    if (value === undefined || value === null) continue;
    out += `${field}\n${value}\n`;
  }
  return out;
}

/**
 * The certificate URL is attacker-controlled input: without this check a forged
 * message could point at a certificate the attacker owns and verify perfectly.
 */
export function isTrustedCertificateUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (!/^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(url.hostname)) return false;
  return url.pathname.endsWith(".pem");
}

export type VerifyOptions = {
  /** Returns the PEM for a certificate URL. Injected so it can be cached and tested. */
  fetchCertificate: (url: string) => Promise<string>;
  /** Only messages from these topics are accepted. */
  allowedTopicArns?: string[];
  maxAgeMs?: number;
  now?: () => number;
};

export type VerifyResult = { valid: true } | { valid: false; reason: string };

export async function verifySnsMessage(
  message: SnsMessage,
  options: VerifyOptions,
): Promise<VerifyResult> {
  const certUrl = message.SigningCertURL ?? message.SigningCertUrl;
  if (!certUrl || !isTrustedCertificateUrl(certUrl)) {
    return { valid: false, reason: "signing certificate URL is not an SNS endpoint" };
  }
  if (options.allowedTopicArns?.length && !options.allowedTopicArns.includes(message.TopicArn)) {
    return { valid: false, reason: "message is from an unexpected topic" };
  }

  // A valid signature on a very old message is a replay.
  const maxAge = options.maxAgeMs ?? 60 * 60 * 1000;
  const now = options.now?.() ?? Date.now();
  const sent = Date.parse(message.Timestamp);
  if (Number.isNaN(sent) || Math.abs(now - sent) > maxAge) {
    return { valid: false, reason: "message timestamp is outside the accepted window" };
  }

  const algorithm = message.SignatureVersion === "2" ? "RSA-SHA256" : "RSA-SHA1";
  let key;
  try {
    key = createPublicKey(await options.fetchCertificate(certUrl));
  } catch {
    return { valid: false, reason: "signing certificate could not be read" };
  }

  let payload: string;
  try {
    payload = stringToSign(message);
  } catch (error) {
    return { valid: false, reason: String(error) };
  }

  const verifier = createVerify(algorithm);
  verifier.update(payload, "utf8");
  const valid = verifier.verify(key, message.Signature, "base64");
  return valid ? { valid: true } : { valid: false, reason: "signature does not match" };
}

/** SES event types mapped onto the delivery states the platform records. */
export const SES_EVENT_STATUS: Record<string, string> = {
  Send: "sent",
  Delivery: "delivered",
  Open: "opened",
  Click: "clicked",
  Bounce: "bounced",
  Complaint: "complained",
  Reject: "failed",
  RenderingFailure: "failed",
  DeliveryDelay: "sent",
};

export type SesEvent = {
  status: string;
  messageId: string | null;
  communicationId: string | null;
  detail: Record<string, unknown>;
};

/**
 * Pulls what matters out of an SES event notification. The communication id is
 * read from the message tag set at send time, with the SES message id as the
 * fallback correlation.
 */
export function parseSesEvent(raw: string): SesEvent | null {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }

  const type = (body.eventType ?? body.notificationType) as string | undefined;
  if (!type) return null;
  const status = SES_EVENT_STATUS[type];
  if (!status) return null;

  const mail = (body.mail ?? {}) as { messageId?: string; tags?: Record<string, string[]> };
  const tag = mail.tags?.communication_id?.[0] ?? null;

  const detail: Record<string, unknown> = { event_type: type };
  if (type === "Bounce") {
    const bounce = (body.bounce ?? {}) as Record<string, unknown>;
    detail.bounce_type = bounce.bounceType;
    detail.bounce_subtype = bounce.bounceSubType;
  }
  if (type === "Complaint") {
    detail.complaint_type = ((body.complaint ?? {}) as Record<string, unknown>).complaintFeedbackType;
  }

  return { status, messageId: mail.messageId ?? null, communicationId: tag, detail };
}
