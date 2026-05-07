"use client";

/**
 * ThinkingFeed — Unified thinking stream with post-completion recap.
 *
 * During streaming: natural text flow (pipeline + reasoning) word-by-word.
 * After completion: structured recap (pipeline stats + collapsible reasoning).
 */

import React, { useEffect, useRef, useState, useMemo } from "react";
import type { ThinkingItem } from "@/types/chat";

/* ================================================================== */
/*  Props                                                              */
/* ================================================================== */
export interface ThinkingFeedProps {
  thinkingItems?: ThinkingItem[];
  pipelineText?: string;
  reasoningText: string;
  isStreaming: boolean;
  isThinkingActive: boolean;
  isExpanded?: boolean;
  onToggle?: () => void;
  onStop?: () => void;
}

/* ================================================================== */
/*  Smooth word-by-word streaming                                      */
/* ================================================================== */
function useSmoothText(raw: string, isActive: boolean) {
  const [displayed, setDisplayed] = useState("");
  const tokensRef = useRef<string[]>([]);
  const indexRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Update token array when raw changes — don't touch the interval
  useEffect(() => {
    if (!raw) { tokensRef.current = []; indexRef.current = 0; setDisplayed(""); return; }
    tokensRef.current = raw.split(/(\s+)/);
  }, [raw]);

  // Start/stop interval based on isActive only — not on raw changes
  useEffect(() => {
    if (!isActive) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      if (raw) setDisplayed(raw);
      return;
    }
    if (!timerRef.current) {
      timerRef.current = setInterval(() => {
        const tokens = tokensRef.current;
        if (indexRef.current < tokens.length) {
          // Adaptive catch-up: if lagging behind by >20 tokens, skip ahead
          const remaining = tokens.length - indexRef.current;
          const step = remaining > 20 ? Math.min(Math.ceil(remaining / 10), 5) : 1;
          indexRef.current = Math.min(indexRef.current + step, tokens.length);
          setDisplayed(tokens.slice(0, indexRef.current).join(""));
        }
      }, 30);
    }
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  // When isActive becomes false and there's raw text, show it all immediately
  useEffect(() => {
    if (!isActive && raw) setDisplayed(raw);
  }, [isActive, raw]);

  return displayed;
}

/* ================================================================== */
/*  Elapsed timer                                                      */
/* ================================================================== */
function useElapsed(active: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);
  useEffect(() => {
    if (active) {
      if (!startRef.current) startRef.current = Date.now();
      const t = setInterval(() => {
        setElapsed(Math.floor((Date.now() - (startRef.current || Date.now())) / 1000));
      }, 1000);
      return () => clearInterval(t);
    }
    // Freeze: snapshot final elapsed value when deactivating
    if (startRef.current) {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }
  }, [active]);
  return elapsed;
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtSec(s: number): string {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/* ================================================================== */
/*  Build pipeline recap from thinkingItems                            */
/* ================================================================== */
interface RecapItem { icon: string; label: string; elapsedMs?: number }

function buildRecap(items: ThinkingItem[]): RecapItem[] {
  const recap: RecapItem[] = [];
  for (const t of items) {
    if (!t.step || t.step === "thinking-delta" || t.step === "parse-error") continue;
    let label = "";
    let icon = "•";
    if (t.step === "query") { icon = "📝"; label = t.detail || t.label || "Pertanyaan dianalisis"; }
    else if (t.step === "sources") { icon = "📊"; label = `${t.count || ""} sumber data ditemukan`; }
    else if (t.step === "knowledge") {
      icon = "📚";
      const p: string[] = [];
      if (t.brsCount) p.push(`${t.brsCount} BRS`);
      if (t.pubCount) p.push(`${t.pubCount} Publikasi`);
      label = p.length ? `${p.join(" + ")} referensi dimuat` : (t.label || "");
    }
    else if (t.step === "data") { icon = "📋"; label = `${t.count || ""} baris data tabel dimuat`; }
    else if (t.step === "reasoning") { icon = "🧠"; label = t.detail || t.label || ""; }
    else if (t.step === "strategy") { icon = "📐"; label = t.label || ""; }
    else if (t.step === "orchestrator-sub") { icon = "🔍"; label = t.label || ""; }
    else { icon = t.icon || "•"; label = t.label || t.step; }
    if (label) recap.push({ icon, label, elapsedMs: t.elapsedMs });
  }
  return recap;
}

/* ================================================================== */
/*  Icons                                                              */
/* ================================================================== */
const Spinner = () => (
  <svg className="h-3.5 w-3.5 animate-spin text-violet-500 dark:text-violet-400 shrink-0" viewBox="0 0 24 24" fill="none">
    <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" />
    <path className="opacity-90" d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

const CheckIcon = () => (
  <svg className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
  </svg>
);

/* ================================================================== */
/*  ThinkingFeed                                                       */
/* ================================================================== */
export const ThinkingFeed: React.FC<ThinkingFeedProps> = ({
  thinkingItems = [],
  pipelineText = "",
  reasoningText,
  isStreaming,
  isThinkingActive,
  isExpanded: controlledExpanded,
  onToggle,
  onStop,
}) => {
  const [reasoningVisible, setReasoningVisible] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);
  const elapsed = useElapsed(isThinkingActive || (isStreaming && !reasoningText && !pipelineText));
  // Combine pipeline + reasoning for streaming display (pipeline first, then reasoning)
  const combinedStreamText = pipelineText && reasoningText
    ? `${pipelineText}\n\n---\n\n${reasoningText}`
    : pipelineText || reasoningText;
  const smoothText = useSmoothText(combinedStreamText, isThinkingActive);

  const recap = useMemo(() => buildRecap(thinkingItems), [thinkingItems]);

  // Auto-scroll during streaming
  useEffect(() => {
    if ((isThinkingActive || isStreaming) && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [smoothText, isThinkingActive, isStreaming]);

  const hasContent = Boolean(reasoningText || pipelineText);
  const isDone = !isStreaming && !isThinkingActive;

  // Historical collapsed
  const isHistorical = controlledExpanded !== undefined;
  if (isHistorical && !controlledExpanded) {
    if (!hasContent && recap.length === 0) return null;
    return (
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors py-1"
      >
        <svg className="h-3 w-3 shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M7.293 4.707a1 1 0 011.414 0L14.414 10l-5.707 5.293a1 1 0 01-1.414-1.414L11.586 10 7.293 5.707a1 1 0 010-1z" clipRule="evenodd" />
        </svg>
        <span>Lihat proses berpikir</span>
      </button>
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  //  STREAMING MODE — smooth word-by-word text
  // ═══════════════════════════════════════════════════════════════════
  if (!isDone) {
    // Waiting state (before any content)
    if (!hasContent) {
      return (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/30 px-3 py-2">
          <div className="flex items-center gap-2">
            <Spinner />
            <span className="text-xs text-violet-600 dark:text-violet-300 font-medium">Berpikir...</span>
            <span className="text-[10px] font-mono tabular-nums text-gray-400 dark:text-gray-500 ml-auto">{fmtSec(elapsed)}</span>
            {onStop && (
              <button type="button" onClick={onStop} className="text-[10px] text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 shrink-0">■ Hentikan</button>
            )}
          </div>
        </div>
      );
    }

    // Active streaming
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/30 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2">
          <Spinner />
          <span className="flex-1 text-xs text-violet-600 dark:text-violet-300 font-medium">Berpikir...</span>
          <span className="text-[10px] font-mono tabular-nums text-gray-400 dark:text-gray-500 shrink-0">{fmtSec(elapsed)}</span>
          {onStop && (
            <button type="button" onClick={onStop} className="text-[10px] text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 shrink-0">■ Hentikan</button>
          )}
        </div>
        <div
          ref={contentRef}
          className="px-3 pb-3 pt-0 overflow-y-auto max-h-[60vh] border-t border-gray-200/60 dark:border-gray-700/60 text-[12.5px] leading-[1.7] whitespace-pre-wrap break-words font-mono text-gray-700 dark:text-gray-200"
        >
          {smoothText}
          {isThinkingActive && (
            <span className="inline-block w-[3px] h-[15px] ml-0.5 -mb-0.5 bg-violet-500 dark:bg-violet-400 animate-pulse rounded-[1px]" />
          )}
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  //  DONE MODE — structured recap
  // ═══════════════════════════════════════════════════════════════════
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/30 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <CheckIcon />
        <span className="flex-1 text-xs text-gray-600 dark:text-gray-400">
          Berpikir selama {fmtSec(elapsed)}
        </span>
      </div>

      {/* Pipeline recap */}
      {recap.length > 0 && (
        <div className="px-3 pb-2 border-t border-gray-200/60 dark:border-gray-700/60 pt-2 space-y-0.5">
          {recap.map((r, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
              <span className="shrink-0 w-4 text-center">{r.icon}</span>
              <span className="flex-1">{r.label}</span>
              {r.elapsedMs != null && r.elapsedMs > 0 && (
                <span className="text-[9px] font-mono text-gray-400 dark:text-gray-500 shrink-0">{fmtMs(r.elapsedMs)}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Reasoning text — collapsible */}
      {reasoningText && (
        <>
          <div className="flex items-center gap-2 px-3 py-1.5 border-t border-gray-200/60 dark:border-gray-700/60">
            <span className="text-[11px] text-gray-500 dark:text-gray-400 flex-1">Penalaran</span>
            <button
              type="button"
              onClick={() => setReasoningVisible(v => !v)}
              className="text-[10px] text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
            >
              {reasoningVisible ? "Sembunyikan" : "Tampilkan"}
            </button>
          </div>
          {reasoningVisible && (
            <div className="px-3 pb-3 overflow-y-auto max-h-[40vh] text-[12px] leading-[1.7] whitespace-pre-wrap break-words font-mono text-gray-600 dark:text-gray-300">
              {reasoningText}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ThinkingFeed;
