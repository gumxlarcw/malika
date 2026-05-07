"use client";

import React, { useState, useEffect, useRef } from "react";
import type { TrackedToolCall } from "@/context/ChatProcessContext";

/* ------------------------------------------------------------------ */
/*  Tool metadata: icon, color, label per tool                         */
/* ------------------------------------------------------------------ */
const TOOL_META: Record<string, { icon: string; label: string; color: string; bgLight: string; bgDark: string }> = {
  search_data:          { icon: "🔍", label: "Pencarian Indikator",     color: "text-blue-600 dark:text-blue-400",   bgLight: "bg-blue-50",   bgDark: "dark:bg-blue-950/30" },
  get_data_preview:     { icon: "📊", label: "Ambil Data Tabel",        color: "text-emerald-600 dark:text-emerald-400", bgLight: "bg-emerald-50", bgDark: "dark:bg-emerald-950/30" },
  search_knowledge:     { icon: "📚", label: "Pencarian Dokumen BPS",   color: "text-purple-600 dark:text-purple-400", bgLight: "bg-purple-50", bgDark: "dark:bg-purple-950/30" },
  search_document_table:{ icon: "📋", label: "Cari Tabel Dokumen",      color: "text-amber-600 dark:text-amber-400",  bgLight: "bg-amber-50",  bgDark: "dark:bg-amber-950/30" },
  get_exim_data:        { icon: "🚢", label: "Data Perdagangan",        color: "text-teal-600 dark:text-teal-400",   bgLight: "bg-teal-50",   bgDark: "dark:bg-teal-950/30" },
  recall_memory:        { icon: "🧠", label: "Riwayat Percakapan",      color: "text-pink-600 dark:text-pink-400",   bgLight: "bg-pink-50",   bgDark: "dark:bg-pink-950/30" },
};

const DEFAULT_META = { icon: "⚙️", label: "Tool", color: "text-gray-600 dark:text-gray-400", bgLight: "bg-gray-50", bgDark: "dark:bg-gray-800/30" };

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = (ms / 1000).toFixed(1);
  return `${s}s`;
}

/** Pretty-print tool args for display */
function formatArgs(toolName: string, args: Record<string, unknown>): string {
  if (!args || Object.keys(args).length === 0) return "";
  switch (toolName) {
    case "search_data":
    case "search_knowledge":
    case "recall_memory":
      return args.query ? `"${String(args.query).slice(0, 80)}"` : "";
    case "get_data_preview":
      return [
        args.source_id ? `ID: ${args.source_id}` : null,
        args.year ? `Tahun: ${args.year}` : null,
        args.geo ? `${args.geo}` : null,
      ].filter(Boolean).join(" · ");
    case "search_document_table":
      return [
        args.doc_id ? `Doc: ${args.doc_id}` : null,
        args.table_query ? `"${String(args.table_query).slice(0, 60)}"` : null,
        args.table_number ? `Tabel: ${args.table_number}` : null,
      ].filter(Boolean).join(" · ");
    case "get_exim_data":
      return [
        args.mode ? String(args.mode).charAt(0).toUpperCase() + String(args.mode).slice(1) : null,
        args.year ? `${args.year}` : null,
        args.month ? `Bulan: ${args.month}` : null,
        args.group ? `(${args.group})` : null,
      ].filter(Boolean).join(" · ");
    default:
      return Object.entries(args)
        .slice(0, 3)
        .map(([k, v]) => `${k}: ${String(v).slice(0, 40)}`)
        .join(" · ");
  }
}

/* ------------------------------------------------------------------ */
/*  Spinner (tiny)                                                     */
/* ------------------------------------------------------------------ */
const TinySpinner = () => (
  <svg className="h-3 w-3 animate-spin text-current opacity-60" viewBox="0 0 24 24" fill="none">
    <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" />
    <path className="opacity-90" d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

/* ------------------------------------------------------------------ */
/*  Single Tool Call Card                                              */
/* ------------------------------------------------------------------ */
const ToolCallCardItem = React.memo(function ToolCallCardItem({
  tc,
}: {
  tc: TrackedToolCall;
}) {
  const meta = TOOL_META[tc.toolName] || DEFAULT_META;
  const hasResult = !!tc.result;
  const argsStr = formatArgs(tc.toolName, tc.args);

  // Live elapsed timer
  const [liveElapsed, setLiveElapsed] = useState("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (hasResult) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      setLiveElapsed(formatElapsed(Date.now() - tc.startedAt));
    }, 200);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [hasResult, tc.startedAt]);

  const elapsed = hasResult && tc.result!.elapsedMs != null
    ? formatElapsed(tc.result!.elapsedMs)
    : liveElapsed;

  return (
    <div className={`tool-call-card process-step-enter rounded-lg border px-2.5 py-1.5 transition-all duration-300 ${
      hasResult
        ? `border-gray-200/60 ${meta.bgLight} ${meta.bgDark} dark:border-gray-700/40`
        : `border-brand-200/60 bg-brand-50/30 dark:border-brand-800/40 dark:bg-brand-950/20`
    }`}>
      {/* Header row: icon + label + elapsed */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs leading-none">{meta.icon}</span>
        <span className={`text-[11px] font-medium leading-tight ${meta.color}`}>
          {meta.label}
        </span>
        {!hasResult && <TinySpinner />}
        {elapsed && (
          <span className="ml-auto shrink-0 select-none rounded-full bg-gray-100 px-1.5 py-px text-[9px] tabular-nums text-gray-400 dark:bg-gray-800 dark:text-gray-500">
            {elapsed}
          </span>
        )}
      </div>

      {/* Args row */}
      {argsStr && (
        <div className="mt-0.5 ml-[22px]">
          <span className="text-[10px] leading-snug text-gray-500 dark:text-gray-400">
            {argsStr}
          </span>
        </div>
      )}

      {/* Result row */}
      {hasResult && tc.result && (
        <div className="mt-0.5 ml-[22px] flex items-center gap-1">
          {tc.result.found ? (
            <svg className="h-2.5 w-2.5 shrink-0 text-emerald-500 dark:text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg className="h-2.5 w-2.5 shrink-0 text-gray-400 dark:text-gray-500" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
            </svg>
          )}
          <span className={`text-[10px] leading-snug ${
            tc.result.found
              ? "text-gray-600 dark:text-gray-300"
              : "text-gray-400 dark:text-gray-500"
          }`}>
            {tc.result.summary}
          </span>
          {tc.result.cached && (
            <span className="shrink-0 rounded px-1 py-px text-[8px] font-medium uppercase tracking-wide text-amber-500/80 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400/60">
              cache
            </span>
          )}
        </div>
      )}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Tool Calls Section — shows all tool calls for current processing   */
/* ------------------------------------------------------------------ */
export interface ToolCallsSectionProps {
  toolCalls: TrackedToolCall[];
}

export const ToolCallsSection = React.memo(function ToolCallsSection({
  toolCalls,
}: ToolCallsSectionProps) {
  if (toolCalls.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 mt-0.5 mb-1">
      {toolCalls.map((tc) => (
        <ToolCallCardItem key={tc.callId} tc={tc} />
      ))}
    </div>
  );
});

export default ToolCallsSection;
