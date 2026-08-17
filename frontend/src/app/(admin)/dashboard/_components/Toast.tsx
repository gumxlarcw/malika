"use client";

import React, { useEffect } from "react";

/**
 * Transient confirmation for actions with no visible result of their own.
 *
 * Announced politely rather than assertively: copying a link is not urgent
 * enough to interrupt whatever a screen reader is already saying.
 */
export function Toast({ message, onDone, ms = 2400 }: { message: string | null; onDone: () => void; ms?: number }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, ms);
    return () => clearTimeout(t);
  }, [message, ms, onDone]);

  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-6 left-1/2 z-[95] -translate-x-1/2">
      {message ? (
        <span className="flex items-center gap-2.5 rounded-lg bg-gray-900 px-4 py-2.5 text-sm leading-5 text-gray-50 shadow-theme-lg dark:bg-gray-800">
          <span className="h-[7px] w-[7px] rounded-full bg-success-500" aria-hidden />
          {message}
        </span>
      ) : null}
    </div>
  );
}
