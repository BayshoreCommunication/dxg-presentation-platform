"use client";

import { useEffect } from "react";

/** Opens the browser's print dialog — once on arrival when `auto`, and on demand. */
export function PrintButton({ auto = false }: { auto?: boolean }) {
  useEffect(() => {
    if (!auto) return;
    // After the page has painted, so the dialog previews the finished receipt.
    const timer = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(timer);
  }, [auto]);
  return (
    <button type="button" className="btn pri" onClick={() => window.print()}>
      Print
    </button>
  );
}
