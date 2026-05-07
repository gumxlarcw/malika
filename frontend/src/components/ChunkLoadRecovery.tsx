"use client";

import { useEffect } from "react";

function shouldAttemptRecovery(error: any): boolean {
  const message = String(error?.message || error || "");
  if (!message) return false;
  return (
    message.includes("Failed to load chunk") ||
    message.includes("Loading chunk") ||
    message.includes("ChunkLoadError") ||
    message.includes("Failed to load chunk")
  );
}

/**
 * Best-effort recovery for stale Next.js/Turbopack chunk references.
 *
 * Root causes are usually CDN/proxy caching old HTML or non-atomic deployments.
 * This client-side handler limits the blast radius by forcing one hard reload.
 */
export default function ChunkLoadRecovery() {
  useEffect(() => {
    const key = "__malika_chunk_recovery__";

    const handler = (event: any) => {
      const err = event?.error || event?.reason || event;
      if (!shouldAttemptRecovery(err)) return;

      try {
        const already = sessionStorage.getItem(key);
        if (already) return;
        sessionStorage.setItem(key, "1");
      } catch {
        // ignore
      }

      // Bust caches and force browser to re-fetch HTML.
      const url = new URL(window.location.href);
      url.searchParams.set("r", String(Date.now()));
      window.location.replace(url.toString());
    };

    window.addEventListener("error", handler);
    window.addEventListener("unhandledrejection", handler);
    return () => {
      window.removeEventListener("error", handler);
      window.removeEventListener("unhandledrejection", handler);
    };
  }, []);

  return null;
}
