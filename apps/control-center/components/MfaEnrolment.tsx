"use client";

import { copyText } from "@/lib/copy";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { startMfaEnrolment, confirmMfaEnrolment, ApiError } from "@/lib/api";
import type { Enrolment } from "@/lib/api";
import { SECURITY } from "@pmp/format";
import { QrCode } from "./QrCode";

/** A24: backup codes as a plain-text file, so they can be kept somewhere other than this screen. */
function downloadCodes(codes: string[], account: string | undefined) {
  const text = [
    `DXG·PM ${SECURITY.recoveryCodes}${account ? ` for ${account}` : ""}`,
    "Each code works once. Use one to sign in if you don't have your phone.",
    "",
    ...codes,
    "",
  ].join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  link.download = "dxg-backup-codes.txt";
  link.click();
  URL.revokeObjectURL(link.href);
}

/**
 * Enrolment in three visible steps: take the secret, prove the app works, keep
 * the backup codes (recovery codes in the API). Nothing is switched on until the middle step succeeds, so
 * a mistyped secret cannot lock anyone out.
 */
export function MfaEnrolment() {
  const router = useRouter();
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function begin() {
    setBusy(true);
    setError(null);
    setErrorCode(null);
    try {
      setEnrolment(await startMfaEnrolment());
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Couldn't start setting up your sign-in app. Please try again.");
      setErrorCode(caught instanceof ApiError ? caught.code : null);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await confirmMfaEnrolment(code);
      setCodes(result.recovery_codes);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not confirm the code.");
    } finally {
      setBusy(false);
    }
  }

  if (codes) {
    return (
      <div className="login">
        <div className="box" style={{ width: 460 }}>
          <b>Save your {SECURITY.recoveryCodes}</b>
          <div style={{ fontSize: 13, margin: "4px 0 14px" }}>
            Each code works once. They are the only way back in if you lose your phone — this is the
            only time they are shown.
          </div>
          <div
            className="mono"
            style={{
              background: "var(--ink)",
              border: "1px solid #2A3B46",
              borderRadius: 6,
              padding: 14,
              lineHeight: 1.9,
              color: "var(--white)",
              columnCount: 2,
            }}
          >
            {codes.map((entry) => (
              <div key={entry}>{entry}</div>
            ))}
          </div>
          {/* A24: shown once, so make keeping them easy — copy, a .txt file, or paper. */}
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn"
              onClick={() =>
                void copyText(codes.join("\n")).then(setCopied)
              }
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" className="btn" onClick={() => downloadCodes(codes, enrolment?.account)}>
              Download
            </button>
            <button type="button" className="btn" onClick={() => window.print()}>
              Print
            </button>
          </div>
          <div className="note" style={{ marginTop: 8, color: "var(--dim)" }}>
            Keep them somewhere safe that isn&apos;t your phone — a password manager, or a printed copy in
            your desk.
          </div>
          <button
            className="btn pri"
            style={{ width: "100%", padding: 9, marginTop: 14 }}
            onClick={() => {
              router.replace("/");
              router.refresh();
            }}
          >
            I have saved them — continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login">
      <div className="box" style={{ width: 460 }}>
        <b>Step 2 of 2 · Set up your sign-in app</b>
        <div style={{ fontSize: 13, margin: "4px 0 14px" }}>
          For security, DXG accounts ask for a 6-digit code from an app on your phone each time you
          sign in. Any sign-in app works — Google Authenticator, Microsoft Authenticator, 1Password or
          Authy.
        </div>

        {error && (
          <div className="err" style={{ marginBottom: 12 }} role="alert">
            {error}
          </div>
        )}

        {/*
          Refusing to replace a working second factor is correct — otherwise anyone
          who borrowed a signed-in screen could quietly swap it for their own. But
          the refusal alone is a dead end: the only button on this screen is the one
          that just failed. Say who can unblock them instead.
        */}
        {errorCode === "mfa.already_enrolled" && (
          <div className="note" style={{ marginBottom: 14, lineHeight: 1.6, color: "var(--dim)" }}>
            Your sign-in app is already set up, so there is nothing to do here. Lost your phone? Ask
            a DXG administrator to open <strong>Staff accounts</strong>, find your name and choose{" "}
            <strong>reset sign-in app</strong>. That clears the old one and lets you set up a new one
            — it can&apos;t be done from this screen, by design.
          </div>
        )}

        {!enrolment ? (
          <button
            className="btn pri"
            style={{ width: "100%", padding: 9 }}
            disabled={busy || errorCode === "mfa.already_enrolled"}
            onClick={() => void begin()}
          >
            {busy ? "Preparing…" : "Start setup"}
          </button>
        ) : (
          <form onSubmit={confirm}>
            <div className="field">
              <label>1 · Add this account to your sign-in app</label>

              <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ padding: 8, background: "#FFFFFF", borderRadius: 8, lineHeight: 0 }}>
                  <QrCode value={enrolment.otpauth_uri} />
                </div>

                <div style={{ flex: "1 1 200px", minWidth: 200 }}>
                  <div className="note" style={{ color: "var(--dim)", marginBottom: 8 }}>
                    Scan this with 1Password, Authy, Google Authenticator or similar.
                  </div>

                  <div className="note" style={{ color: "var(--dim)", marginBottom: 4 }}>
                    No camera to hand? Choose &ldquo;enter a setup key&rdquo; and type this instead:
                  </div>
                  <div
                    className="mono"
                    style={{
                      background: "var(--ink)",
                      border: "1px solid #2A3B46",
                      borderRadius: 6,
                      padding: "10px 12px",
                      color: "var(--white)",
                      wordBreak: "break-all",
                      fontSize: 12.5,
                    }}
                  >
                    {enrolment.secret_grouped}
                  </div>
                </div>
              </div>

              <div className="note" style={{ marginTop: 8, color: "var(--dim)" }}>
                Account: {enrolment.account}
              </div>
            </div>

            <div className="field">
              <label htmlFor="code">2 · Enter the code your app shows</label>
              <input
                id="code"
                className="mono"
                autoComplete="one-time-code"
                autoFocus
                required
                style={{ width: "100%", letterSpacing: "0.2em" }}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="000000"
              />
            </div>

            <button className="btn pri" style={{ width: "100%", padding: 9 }} disabled={busy} type="submit">
              {busy ? "Checking…" : "Turn on sign-in app"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
