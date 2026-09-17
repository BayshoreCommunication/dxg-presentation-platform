"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * M0 stand-in for the SSE stream (BUILD_SPEC §6.6, built in M0-5): re-fetches the
 * server components on an interval so derived statuses stay live across screens.
 */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const handle = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(handle);
  }, [router, seconds]);
  return null;
}
