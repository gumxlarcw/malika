"use client";

import React, { useEffect, useRef, useState } from "react";

/**
 * UnifiedThinkingCard
 *
 * Single bubble that combines what used to be two separate elements:
 * - the step list ("4 langkah selesai" dropdown)
 * - the typing pill ("Berpikir…" with elapsed timer)
 *
 * Ported from Claude Design's "Chat MALIKA" handoff bundle (chat-thinking.jsx).
 *
 * States:
 *   - `isStreaming = true` (the pipeline is running): full card with timeline
 *     showing every step, brand rail glow on the left edge, active step
 *     pulsing inline.
 *   - `isStreaming = false` (the response is streaming text or complete):
 *     auto-collapses to a compact "✓ N langkah selesai · X.Xs" chip after
 *     ~700ms. Click to re-expand and review what happened.
 *
 * Steps are sourced from ChatProcessContext.processSteps which is fed by
 * the SSE 'status' events from streaming.service.js.
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
}

const ChevronDown = ({ className = "" }: { className?: string }) => (
  <svg className={className} width="13" height="13" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
  </svg>
);

const Check = ({ size = 12, stroke = 3 }: { size?: number; stroke?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 10l4 4 8-8" />
  </svg>
);

export const UnifiedThinkingCard: React.FC<UnifiedThinkingCardProps> = ({ steps, isStreaming, onStop }) => {
  const [expanded, setExpanded] = useState(true);

  const isDone = !isStreaming;
  const totalDoneMs = steps.reduce((sum, s) =>
    sum + (s.doneAt && s.startedAt ? s.doneAt - s.startedAt : 0), 0);
  const completedCount = steps.filter((s) => s.status === "done").length;
  const activeStep = steps.find((s) => s.status !== "done");

  // Auto-collapse to chip ~700ms after pipeline finishes
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (isDone) {
      collapseTimerRef.current = setTimeout(() => setExpanded(false), 700);
      return () => {
        if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
      };
    }
  }, [isDone]);

  // Live elapsed time for active step (ticks every 200ms while streaming)
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!activeStep || isDone) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [activeStep, isDone]);

  // Done + collapsed = compact chip
  if (isDone && !expanded) {
    return (
      <div className="mb-3">
        <button
          onClick={() => setExpanded(true)}
          className="group inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1.5 transition hover:bg-gray-200 dark:bg-white/5 dark:hover:bg-white/10"
        >
          <span className="grid place-items-center w-4 h-4 rounded-full bg-emerald-500 text-white">
            <Check size={10} />
          </span>
          <span className="text-[12px] font-medium text-gray-700 dark:text-gray-300">
            {steps.length} langkah selesai
          </span>
          {totalDoneMs > 0 && (
            <span className="text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
              · {(totalDoneMs / 1000).toFixed(1)}s
            </span>
          )}
          <ChevronDown className="text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300" />
        </button>
      </div>
    );
  }

  return (
    <div className="mb-4">
      <div
        className={
          "relative overflow-hidden rounded-2xl ring-1 transition " +
          (isDone
            ? "bg-white ring-gray-200/80 dark:bg-gray-900 dark:ring-white/10"
            : "bg-gradient-to-br from-brand-25 via-white to-white ring-brand-200/60 dark:from-brand-950/40 dark:via-gray-900 dark:to-gray-900 dark:ring-brand-500/20")
        }
      >
        {/* Animated brand-rail accent on the left when active */}
        {!isDone && (
          <span
            aria-hidden="true"
            className="malika-rail-glow absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-b from-brand-300 via-brand-500 to-brand-700"
          />
        )}

        {/* Header row */}
        <div className="flex items-center gap-2.5 px-4 pt-3 pb-2">
          <div className="relative">
            {isDone ? (
              <span className="grid place-items-center w-5 h-5 rounded-full bg-emerald-500 text-white shadow-sm">
                <Check size={12} />
              </span>
            ) : (
              <span className="relative grid place-items-center w-5 h-5">
                <span className="malika-pulse absolute inset-0 rounded-full bg-brand-500/30" />
                <span className="relative w-2 h-2 rounded-full bg-brand-500" />
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-semibold text-gray-900 dark:text-white">
              {isDone
                ? "Berpikir selesai"
                : (activeStep?.message?.replace(/[…\.]+$/, "") || "Memproses") + "…"}
            </div>
            <div className="text-[11.5px] text-gray-500 dark:text-gray-400 truncate">
              {isDone
                ? `${steps.length} langkah · ${(totalDoneMs / 1000).toFixed(1)}s`
                : activeStep?.detail || "Sedang berlangsung"}
            </div>
          </div>
          {/* Live elapsed timer for active step */}
          {!isDone && activeStep && (
            <span className="font-mono tabular-nums text-[11px] text-gray-500 dark:text-gray-400 shrink-0">
              {((now - activeStep.startedAt) / 1000).toFixed(1)}s
            </span>
          )}
          {/* Stop button (when streaming) */}
          {!isDone && onStop && (
            <button
              type="button"
              onClick={onStop}
              className="shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10"
              aria-label="Hentikan"
              title="Hentikan"
            >
              <span className="inline-block w-2 h-2 bg-rose-500 rounded-[1px]" />
              Hentikan
            </button>
          )}
          {/* Collapse toggle */}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 w-7 h-7 grid place-items-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/5 dark:hover:text-gray-300"
            aria-label={expanded ? "Sembunyikan langkah" : "Lihat langkah"}
            aria-expanded={expanded}
          >
            <ChevronDown className={"transition-transform " + (expanded ? "" : "-rotate-90")} />
          </button>
        </div>

        {/* Steps timeline */}
        <div
          className={
            "grid transition-[grid-template-rows,opacity] duration-300 " +
            (expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")
          }
        >
          <div className="overflow-hidden">
            <div className="px-4 pb-3 pt-1">
              <ol className="relative">
                {/* Connecting line */}
                <span aria-hidden="true" className="absolute left-[7px] top-2 bottom-2 w-px bg-gray-200 dark:bg-white/10" />
                {steps.map((s, i) => {
                  const stepDone = s.status === "done";
                  const stepActive = !isDone && s.status !== "done";
                  const stepPending = false; // we don't have pending steps in this implementation
                  const elapsed =
                    stepDone && s.doneAt && s.startedAt
                      ? `${((s.doneAt - s.startedAt) / 1000).toFixed(1)}s`
                      : null;

                  return (
                    <li key={`${s.stage}-${i}`} className="relative pl-7 py-1.5 first:pt-0 last:pb-0">
                      <span
                        className={
                          "absolute left-0 top-2 grid place-items-center w-[15px] h-[15px] rounded-full transition " +
                          (stepDone
                            ? "bg-emerald-500 text-white"
                            : stepActive
                              ? "bg-brand-500 text-white shadow shadow-brand-500/40"
                              : "bg-white ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-white/15")
                        }
                      >
                        {stepDone && <Check size={9} />}
                        {stepActive && <span className="malika-pulse-inner w-1.5 h-1.5 rounded-full bg-white" />}
                      </span>
                      <div className="flex items-baseline gap-2">
                        <span
                          className={
                            "text-[12.5px] font-medium " +
                            (stepDone
                              ? "text-gray-700 dark:text-gray-300"
                              : stepActive
                                ? "text-brand-700 dark:text-brand-300"
                                : "text-gray-400 dark:text-gray-500")
                          }
                        >
                          {s.message}
                        </span>
                        {stepActive && (
                          <span className="inline-flex items-center gap-1 text-[10.5px] text-brand-600 dark:text-brand-300">
                            <span className="malika-dot" />
                            <span className="malika-dot" />
                            <span className="malika-dot" />
                          </span>
                        )}
                        {elapsed && (
                          <span className="ml-auto font-mono tabular-nums text-[10px] text-gray-400 dark:text-gray-500">
                            {elapsed}
                          </span>
                        )}
                      </div>
                      {(stepDone || stepActive) && s.detail && (
                        <div
                          className={
                            "text-[11.5px] mt-0.5 " +
                            (stepActive
                              ? "text-gray-700 dark:text-gray-400"
                              : "text-gray-500 dark:text-gray-500")
                          }
                        >
                          {s.detail}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
