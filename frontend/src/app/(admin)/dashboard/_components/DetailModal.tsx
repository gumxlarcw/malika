"use client";

import React, { useEffect, useId, useRef } from "react";
import { cn } from "@/lib/utils";
import { BORDER, MONO, SURFACE, SURFACE_2, TEXT, TEXT_2, TEXT_4, TEXT_5 } from "@/lib/surfaceTokens";

export type DetailTable = {
  title: string;
  subtitle: string;
  columns: [string, string, string];
  rows: Array<{ a: string; b: string; c: string }>;
};

/**
 * The figures behind a panel, as a plain table.
 *
 * Every chart on this page is a summary of numbers a statistics reader may need
 * exactly; this is where they can read them off. Only the backdrop and the
 * explicit close control dismiss it — the backdrop is inert to assistive
 * technology so the dialog announces one close action, not two.
 */
export function DetailModal({ detail, onClose }: { detail: DetailTable | null; onClose: () => void }) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!detail) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [detail, onClose]);

  if (!detail) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-gray-900/55 backdrop-blur-[3px]" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "relative flex max-h-[84vh] w-full max-w-3xl flex-col gap-4 rounded-2xl border p-5 shadow-theme-xl sm:p-6",
          BORDER,
          SURFACE
        )}
      >
        <div className="flex items-start justify-between gap-3.5">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 id={titleId} className={cn("text-lg font-semibold leading-[26px]", TEXT)}>
              {detail.title}
            </h2>
            <p className={cn("text-xs leading-[18px]", TEXT_5)}>{detail.subtitle}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors hover:bg-gray-100 dark:hover:bg-gray-800",
              BORDER,
              TEXT_4
            )}
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>

        <div className={cn("flex min-h-0 flex-col overflow-y-auto rounded-xl border", BORDER)}>
          <div
            className={cn(
              "sticky top-0 flex gap-2.5 border-b px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.03em]",
              BORDER,
              SURFACE_2,
              TEXT_4
            )}
          >
            <span className="flex-[2]">{detail.columns[0]}</span>
            <span className="flex-1 text-right">{detail.columns[1]}</span>
            <span className="flex-1 text-right">{detail.columns[2]}</span>
          </div>
          {detail.rows.map((row, i) => (
            <div key={i} className={cn("flex gap-2.5 border-b px-3.5 py-2.5 text-sm leading-5 last:border-b-0", BORDER)}>
              <span className={cn("min-w-0 flex-[2]", TEXT_2)}>{row.a}</span>
              <span className={cn("flex-1 text-right tabular-nums", MONO, TEXT)}>{row.b}</span>
              <span className={cn("flex-1 text-right tabular-nums", MONO, TEXT_4)}>{row.c}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
