"use client";

import React, { useEffect, useRef } from "react";

/**
 * UnifiedThinkingCard
 *
 * Shows the model's own reasoning trace while it works — nothing else.
 *
 * This used to render the whole pipeline: a six-step timeline, per-step elapsed
 * timers, and a "N langkah selesai" chip, with the reasoning tucked behind a
 * click. That was internal machinery on display. Now the trace is the content,
 * open by default, and the pipeline steps are gone (2026-08-18).
 *
 * Reasoning does not start until the retrieval stages finish (~13-18s in), so
 * until the first token arrives the card shows a single line naming the current
 * stage. Without it those opening seconds look like a hang, which is the exact
 * problem this card exists to prevent.
 *
 * Steps still arrive from ChatProcessContext.processSteps, fed by the SSE
 * 'status' events in streaming.service.js — they just aren't drawn as a list.
 */

export interface ProcessStepLike {
  message: string;
  stage: string;
  status: "active" | "done" | "pending" | "error" | "skipped";
  startedAt: number;
  doneAt?: number;
  detail?: string;
}

interface UnifiedThinkingCardProps {
  steps: ProcessStepLike[];
  /** True while the pipeline is running (before first text chunk) */
  isStreaming: boolean;
  /** Optional: stop button — if provided, shows a Hentikan affordance */
  onStop?: () => void;
  /**
   * The model's thinking trace. Empty on the greeting tier, which does not
   * reason — there the status line carries the card on its own.
   */
  reasoningText?: string;
}

export const UnifiedThinkingCard: React.FC<UnifiedThinkingCardProps> = ({
  steps,
  isStreaming,
  onStop,
  reasoningText = "",
}) => {
  const trace = reasoningText.trim();
  const hasTrace = trace.length > 0;
  const activeStep = steps.find((s) => s.status !== "done");

  // Follow the trace as it grows, but stop fighting the reader the moment they
  // scroll up to re-read something.
  const boxRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [trace]);

  const onScroll = () => {
    const el = boxRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  return (
    <div className="mb-4">
      <div className="relative overflow-hidden rounded-2xl bg-white ring-1 ring-gray-200/80 dark:bg-gray-900 dark:ring-white/10">
        {isStreaming && (
          <span
            aria-hidden="true"
            className="malika-rail-glow absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-b from-brand-300 via-brand-500 to-brand-700"
          />
        )}

        <div className="flex items-center gap-2 px-4 pt-3 pb-1.5">
          <span aria-hidden="true" className="text-[13px]">🧠</span>
          <span className="text-[12.5px] font-medium text-gray-700 dark:text-gray-300">
            Proses berpikir
          </span>
          {isStreaming && onStop && (
            <button
              type="button"
              onClick={onStop}
              className="ml-auto shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10"
              aria-label="Hentikan"
              title="Hentikan"
            >
              <span className="inline-block w-2 h-2 bg-rose-500 rounded-[1px]" />
              Hentikan
            </button>
          )}
        </div>

        <div className="px-4 pb-3">
          {hasTrace ? (
            <div
              ref={boxRef}
              onScroll={onScroll}
              aria-live="polite"
              className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 font-mono text-[11.5px] leading-relaxed text-gray-600 dark:bg-white/5 dark:text-gray-400"
            >
              {trace}
            </div>
          ) : (
            // Pre-reasoning: one line, no timeline, no timers.
            <div className="flex items-center gap-2 text-[12px] text-gray-500 dark:text-gray-400">
              <span className="relative grid place-items-center w-3.5 h-3.5 shrink-0">
                <span className="malika-pulse absolute inset-0 rounded-full bg-brand-500/30" />
                <span className="relative w-1.5 h-1.5 rounded-full bg-brand-500" />
              </span>
              <span className="truncate">
                {activeStep?.message?.replace(/[….]+$/, "") || "Memproses"}…
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default UnifiedThinkingCard;
