import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";
import {
  verifySnsMessage,
  stringToSign,
  isTrustedCertificateUrl,
  parseSesEvent,
  SES_EVENT_STATUS,
} from "./sns.ts";
import type { SnsMessage } from "./sns.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const attacker = generateKeyPairSync("rsa", { modulusLength: 2048 });

const PEM = publicKey.export({ type: "spki", format: "pem" }).toString();
const CERT_URL = "https://sns.us-east-2.amazonaws.com/SimpleNotificationService-abc123.pem";
const TOPIC = "arn:aws:sns:us-east-2:123456789012:pmp-email-events";

/** Signs a message the way SNS does, so verification is tested against real bytes. */
function sign(message: Omit<SnsMessage, "Signature">, key = privateKey): SnsMessage {
  const signer = createSign("RSA-SHA256");
  signer.update(stringToSign({ ...message, Signature: "" } as SnsMessage), "utf8");
  return { ...message, Signature: signer.sign(key, "base64") } as SnsMessage;
}

const notification = (overrides: Partial<SnsMessage> = {}): Omit<SnsMessage, "Signature"> => ({
  Type: "Notification",
  MessageId: "11111111-2222-3333-4444-555555555555",
  TopicArn: TOPIC,
  Message: JSON.stringify({ eventType: "Delivery", mail: { messageId: "ses-1" } }),
  Timestamp: new Date().toISOString(),
  SignatureVersion: "2",
  SigningCertURL: CERT_URL,
  ...overrides,
});

const options = {
  fetchCertificate: async () => PEM,
  allowedTopicArns: [TOPIC],
};

describe("SNS signature verification", () => {
  test("a properly signed message verifies", async () => {
    const result = await verifySnsMessage(sign(notification()), options);
    assert.deepEqual(result, { valid: true });
  });

  test("a message signed by someone else is refused", async () => {
    const result = await verifySnsMessage(sign(notification(), attacker.privateKey), options);
    assert.equal(result.valid, false);
  });

  test("tampering with the payload invalidates the signature", async () => {
    const signed = sign(notification());
    const tampered = {
      ...signed,
      Message: JSON.stringify({ eventType: "Bounce", mail: { messageId: "ses-1" } }),
    };
    const result = await verifySnsMessage(tampered, options);
    assert.equal(result.valid, false);
  });

  test("a certificate URL that is not an SNS endpoint is refused before any fetch", async () => {
    let fetched = false;
    const result = await verifySnsMessage(
      sign(notification({ SigningCertURL: "https://evil.example.com/cert.pem" })),
      {
        ...options,
        fetchCertificate: async () => {
          fetched = true;
          return PEM;
        },
      },
    );
    assert.equal(result.valid, false);
    assert.equal(fetched, false, "an untrusted URL must never be fetched");
  });

  test("a message from an unexpected topic is refused", async () => {
    const result = await verifySnsMessage(
      sign(notification({ TopicArn: "arn:aws:sns:us-east-2:999999999999:someone-elses-topic" })),
      options,
    );
    assert.equal(result.valid, false);
  });

  test("an old but validly signed message is refused as a replay", async () => {
    const stale = sign(notification({ Timestamp: new Date(Date.now() - 4 * 3600_000).toISOString() }));
    const result = await verifySnsMessage(stale, options);
    assert.equal(result.valid, false);
  });

  test("subscription confirmations are signed over their own field set", async () => {
    const confirmation = sign({
      Type: "SubscriptionConfirmation",
      MessageId: "abc",
      TopicArn: TOPIC,
      Message: "You have chosen to subscribe",
      SubscribeURL: "https://sns.us-east-2.amazonaws.com/?Action=ConfirmSubscription",
      Token: "token-value",
      Timestamp: new Date().toISOString(),
      SignatureVersion: "2",
      SigningCertURL: CERT_URL,
    });
    assert.deepEqual(await verifySnsMessage(confirmation, options), { valid: true });
  });

  test("the signed string omits absent optional fields rather than signing blanks", () => {
    const withSubject = stringToSign({ ...notification({ Subject: "hello" }), Signature: "" } as SnsMessage);
    const without = stringToSign({ ...notification(), Signature: "" } as SnsMessage);
    assert.ok(withSubject.includes("Subject\nhello\n"));
    assert.ok(!without.includes("Subject"));
  });
});

describe("certificate URL checks", () => {
  test("accepts a genuine SNS certificate URL", () => {
    assert.equal(isTrustedCertificateUrl(CERT_URL), true);
  });

  test("rejects lookalikes, other schemes and non-PEM paths", () => {
    for (const url of [
      "http://sns.us-east-2.amazonaws.com/cert.pem",
      "https://sns.us-east-2.amazonaws.com.evil.example/cert.pem",
      "https://evil.example/sns.us-east-2.amazonaws.com/cert.pem",
      "https://sns.us-east-2.amazonaws.com/cert.txt",
      "not a url",
    ]) {
      assert.equal(isTrustedCertificateUrl(url), false, `${url} should be rejected`);
    }
  });
});

describe("SES event parsing", () => {
  test("maps the event types the platform records", () => {
    assert.equal(SES_EVENT_STATUS.Delivery, "delivered");
    assert.equal(SES_EVENT_STATUS.Bounce, "bounced");
    assert.equal(SES_EVENT_STATUS.Complaint, "complained");
  });

  test("reads the communication id from the message tag", () => {
    const event = parseSesEvent(
      JSON.stringify({
        eventType: "Delivery",
        mail: { messageId: "ses-42", tags: { communication_id: ["comm-7"] } },
      }),
    );
    assert.equal(event?.status, "delivered");
    assert.equal(event?.communicationId, "comm-7");
    assert.equal(event?.messageId, "ses-42");
  });

  test("falls back to the SES message id when there is no tag", () => {
    const event = parseSesEvent(JSON.stringify({ eventType: "Open", mail: { messageId: "ses-9" } }));
    assert.equal(event?.communicationId, null);
    assert.equal(event?.messageId, "ses-9");
  });

  test("keeps why a bounce happened", () => {
    const event = parseSesEvent(
      JSON.stringify({
        eventType: "Bounce",
        mail: { messageId: "ses-3" },
        bounce: { bounceType: "Permanent", bounceSubType: "NoEmail" },
      }),
    );
    assert.equal(event?.status, "bounced");
    assert.equal(event?.detail.bounce_type, "Permanent");
    assert.equal(event?.detail.bounce_subtype, "NoEmail");
  });

  test("unknown or unparseable events are ignored rather than guessed at", () => {
    assert.equal(parseSesEvent("not json"), null);
    assert.equal(parseSesEvent(JSON.stringify({ eventType: "SomethingNew" })), null);
    assert.equal(parseSesEvent(JSON.stringify({ mail: {} })), null);
  });
});
