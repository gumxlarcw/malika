"use client";

import React, { useEffect, useRef, useState } from "react";
import ProgressRail, { fmtSecs } from "./ProgressRail";

/**
 * UnifiedThinkingCard
 *
 * Two layers, per the "Rel Terukur" direction: the nine-step rail is always
 * visible, the model's reasoning trace collapses beneath it.
 *
 * History worth knowing before changing this again. The card once drew a
 * six-step timeline with per-step timers; on 2026-08-18 all of it was removed
 * because it showed internal machinery and hid the reasoning behind a click.
 * That fix over-corrected: the nine `status` events the backend sends went
 * undrawn, so the ~13-18s before the first reasoning token showed one line of
 * text and read as a hang.
 *
 * The rail restores the steps without the old faults — no emoji, no per-step
 * machinery names, reasoning still open by default, and every row backed by a
 * real SSE event rather than inferred from timing.
 */

export interface ProcessStepLike {
  message: string;
  stage: string;
  status: "active" | "done" | "pending" | "error" | "skipped";
  startedAt: number;
  doneAt?: number;
  detail?: string;
  /** Server-measured stage duration; preferred over doneAt - startedAt. */
  elapsedMs?: number;
}

interface UnifiedThinkingCardProps {
  steps: ProcessStepLike[];
  /** True while the pipeline is running (before first text chunk) */
  isStreaming: boolean;
  /** Optional: stop button — if provided, shows a Hentikan affordance */
  onStop?: () => void;
  /**
   * The model's thinking trace. Empty on the greeting tier, which does not
   * reason — there the rail carries the card on its own.
   */
  reasoningText?: string;
}

/** Rough token count for the trace chip; the backend does not send one. */
function tokenChip(text: string): string {
  const n = Math.round(text.length / 4);
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(".", ",")}k token` : `${n} token`;
}

export const UnifiedThinkingCard: React.FC<UnifiedThinkingCardProps> = ({
  steps,
  isStreaming,
  onStop,
  reasoningText = "",
}) => {
  const trace = reasoningText.trim();
  const hasTrace = trace.length > 0;

  // Reasoning is the thing worth reading, so it stays open while it streams and
  // folds away once the answer is done — the 2026-08-18 auto-collapse was removed
  // for hiding itself mid-read, so this only fires when streaming stops.
  const [open, setOpen] = useState(true);
  const wasStreaming = useRef(isStreaming);
  useEffect(() => {
    if (wasStreaming.current && !isStreaming) setOpen(false);
    wasStreaming.current = isStreaming;
  }, [isStreaming]);

  // Elapsed clock for the header. Ticks only while streaming.
  const startRef = useRef<number>(Date.now());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!isStreaming) return;
    if (!startRef.current) startRef.current = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - startRef.current), 100);
    return () => clearInterval(id);
  }, [isStreaming]);

  // Follow the trace as it grows, but stop fighting the reader the moment they
  // scroll up to re-read something.
  const boxRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [trace, open]);

  const onScroll = () => {
    const el = boxRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  return (
    <div className="mb-4">
      <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-gray-200/80 dark:bg-gray-900 dark:ring-white/10">
        <ProgressRail
          steps={steps}
          isStreaming={isStreaming}
          onStop={onStop}
          elapsedMs={elapsed}
        />

        {hasTrace && (
          <div style={{ borderTop: "1px solid #e4e7ec" }}>
            <div className="flex items-center gap-2 px-4 pt-2.5 pb-1.5">
              <span
                style={{ font: "500 12.5px/18px Outfit, system-ui, sans-serif", color: "#344054" }}
              >
                Proses berpikir
              </span>
              <span style={{ font: "400 11px/18px 'IBM Plex Mono', monospace", color: "#98a2b3" }}>
                {tokenChip(trace)}
              </span>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="rounded-md px-2 py-0.5 hover:bg-gray-50 dark:hover:bg-white/5"
                style={{ font: "500 11.5px/18px Outfit, system-ui, sans-serif", color: "#3641f5" }}
                aria-expanded={open}
              >
                {open ? "Sembunyikan" : "Lihat rincian"}
              </button>
            </div>

            {open && (
              <div className="px-4 pb-3">
                <div
                  ref={boxRef}
                  onScroll={onScroll}
                  aria-live="polite"
                  className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 dark:bg-white/5"
                  style={{
                    font: "400 11.5px/1.75 'IBM Plex Mono', monospace",
                    color: "#475467",
                  }}
                >
                  {trace}
                </div>
              </div>
            )}
          </div>
        )}

        {!isStreaming && !hasTrace && (
          <div
            className="px-4 pb-3"
            style={{ font: "400 11.5px/16px Outfit, system-ui, sans-serif", color: "#98a2b3" }}
          >
            Selesai dalam {fmtSecs(elapsed) || "—"}.
          </div>
        )}
      </div>
    </div>
  );
};

export default UnifiedThinkingCard;
