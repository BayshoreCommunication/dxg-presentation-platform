"use client";

import { useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/copy";

/**
 * When the browser won't let the page copy (D-117): the text stays on screen, selected,
 * with its own Copy button (a fresh click, so it usually works now) and, for links, Open.
 * It replaces a toast that showed the link for a few seconds and took it away.
 */
export function CopyFallback({
  label,
  text,
  onCopied,
  onClose,
}: {
  label: string;
  text: string;
  onCopied: () => void;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [failed, setFailed] = useState(false);
  const isLink = /^https?:\/\//.test(text);

  useEffect(() => {
    input.current?.select();
  }, []);

  return (
    <div className="confirm-inline" role="group" aria-label={label}>
      <b>Copy {label}</b>
      <div className="note">Your browser didn&apos;t allow copying automatically. Copy it here, or open it.</div>
      <input
        ref={input}
        readOnly
        value={text}
        onFocus={(event) => event.currentTarget.select()}
        aria-label={label}
        style={{ width: "100%", marginTop: 8 }}
      />
      {failed && <div className="note">Select the text above and press Ctrl+C (⌘C on a Mac).</div>}
      <div className="confirm-inline-actions">
        <button
          type="button"
          className="btn pri"
          onClick={() => void copyText(text).then((copied) => (copied ? onCopied() : setFailed(true)))}
        >
          Copy
        </button>
        {isLink && (
          <a className="btn" href={text} target="_blank" rel="noreferrer">
            Open
          </a>
        )}
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
