"use client";

/**
 * FeedComponents — All visual/row components used by UnifiedActivityFeed.
 *
 * Extracted from UnifiedActivityFeed.tsx to reduce main file size.
 * Each component is individually React.memo'd for optimal re-rendering.
 */

import React, { useEffect, useRef, useState } from "react";
import { ChevronRightIcon, RetryIcon } from "@/components/chat/icons";
import type { ThinkingItem } from "@/types/chat";
import type { TrackedToolCall } from "@/context/ChatProcessContext";
import {
  type ProcessStep,
  PIPELINE_STAGES,
  STAGE_FRIENDLY,
  STEP_COLORS,
  DEFAULT_STEP_COLORS,
  TOOL_META,
  DEFAULT_TOOL_META,
  TYPE_BADGE_COLORS,
  fmtMs,
  fmtToolElapsed,
  formatToolArgs,
  isDeepModel,
  isTerminalStatus,
} from "./feedTypes";

/* ================================================================== */
/*  Progress Bar (from pipeline steps)                                 */
/* ================================================================== */
export const ProgressBar = React.memo(function ProgressBar({
  steps,
  modelId,
}: {
  steps: ProcessStep[];
  modelId?: string;
}) {
  const totalStages = PIPELINE_STAGES.length;
  const done = steps.filter((s) => isTerminalStatus(s.status)).length;
  const hasActive = steps.some((s) => s.status === "active");
  const pct = Math.min(((done + (hasActive ? 0.5 : 0)) / Math.max(totalStages, 1)) * 100, 100);
  const deep = isDeepModel(modelId);

  return (
    <div className="h-[2px] overflow-hidden rounded-full bg-gray-200/40 dark:bg-gray-700/30">
      <div
        className={`h-full rounded-full transition-[width] duration-700 ease-out ${
          deep
            ? "bg-gradient-to-r from-purple-400/80 to-purple-500/80"
            : "bg-gradient-to-r from-brand-400/80 to-brand-500/80"
        }`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
});

/* ================================================================== */
/*  Total elapsed timer                                                */
/* ================================================================== */
export const TotalElapsed = React.memo(function TotalElapsed({ steps }: { steps: ProcessStep[] }) {
  const [, forceUpdate] = useState(0);
  const labelRef = useRef("");
  const firstStart = steps.length > 0 ? steps[0].startedAt : 0;
  const allTerminal = steps.length > 0 && steps.every((s) => isTerminalStatus(s.status));
  const lastDoneAt = allTerminal ? Math.max(...steps.map((s) => s.doneAt ?? s.startedAt)) : 0;

  useEffect(() => {
    if (allTerminal || !firstStart) return;
    const id = setInterval(() => {
      const next = fmtMs(Date.now() - firstStart);
      if (next !== labelRef.current) {
        labelRef.current = next;
        forceUpdate((c) => c + 1);
      }
    }, 500);
    return () => clearInterval(id);
  }, [allTerminal, firstStart]);

  if (!firstStart) return null;
  const elapsed = (allTerminal ? lastDoneAt : Date.now()) - firstStart;
  if (elapsed < 800) return null;
  const label = allTerminal ? fmtMs(elapsed) : labelRef.current || fmtMs(elapsed);

  return (
    <span className="shrink-0 select-none text-[10px] tabular-nums text-gray-400/70 dark:text-gray-500/60">
      {label}
    </span>
  );
});

/* ================================================================== */
/*  Elapsed Badge (per-item)                                           */
/* ================================================================== */
export function ElapsedBadge({ ms }: { ms: number }) {
  if (ms <= 0) return null;
  const label = ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 100) * 100}ms`;
  return (
    <span className="ml-auto shrink-0 select-none rounded-full bg-gray-100 px-1.5 py-px text-[9px] tabular-nums text-gray-400 dark:bg-gray-800/60 dark:text-gray-500">
      {label}
    </span>
  );
}

/* ================================================================== */
/*  Thinking Item Row                                                  */
/* ================================================================== */
export const ThinkingRow = React.memo(function ThinkingRow({
  item,
  isLast,
  isStreaming,
  idx,
}: {
  item: ThinkingItem;
  isLast: boolean;
  isStreaming: boolean;
  idx: number;
}) {
  const colors = STEP_COLORS[item.step ?? ""] || DEFAULT_STEP_COLORS;

  return (
    <div
      className="relative flex items-start gap-2.5 pl-0.5"
      role="listitem"
      style={{
        animation: isStreaming ? `fadeSlideIn 0.3s ease-out ${Math.min(idx * 0.08, 0.6)}s both` : "none",
      }}
    >
      {/* Timeline icon circle */}
      <div
        className={`relative z-10 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px] ${colors.bg} ${colors.border} border ${
          isStreaming && isLast ? "animate-pulse ring-2 ring-violet-300/40 dark:ring-violet-600/25" : ""
        }`}
      >
        {item.icon || "•"}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 pb-0.5">
        <div className={`flex items-center gap-1.5 text-[11px] font-semibold leading-[22px] ${colors.text}`}>
          <span className="min-w-0 flex-1">{item.label}</span>
          {item.elapsedMs != null && item.elapsedMs > 0 && <ElapsedBadge ms={item.elapsedMs} />}
        </div>
        {item.detail && (
          <div className="mt-0.5 text-[10px] leading-snug text-gray-500 dark:text-gray-400 line-clamp-2">
            {item.detail}
          </div>
        )}
        {/* Knowledge count badges */}
        {item.step === "knowledge" && (item.brsCount || item.pubCount) ? (
          <div className="mt-1 flex gap-1.5">
            {item.brsCount ? (
              <span className="inline-flex items-center gap-0.5 rounded-md bg-green-100/80 px-1.5 py-0.5 text-[9px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300">
                📰 {item.brsCount} BRS
              </span>
            ) : null}
            {item.pubCount ? (
              <span className="inline-flex items-center gap-0.5 rounded-md bg-purple-100/80 px-1.5 py-0.5 text-[9px] font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                📕 {item.pubCount} Pub
              </span>
            ) : null}
          </div>
        ) : null}
        {/* Tags (for orchestrator-sub, etc.) */}
        {item.tags && item.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {item.tags.map((tag, i) => (
              <span key={i} className="inline-flex items-center rounded-md bg-amber-100/80 px-1.5 py-0.5 text-[9px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

/* ================================================================== */
/*  Pipeline Step Row — live stepper with spinner/check & detail       */
/* ================================================================== */

/** Spinner SVG for active steps */
const StepSpinner = () => (
  <svg className="h-3 w-3 animate-spin text-brand-500 dark:text-brand-400" viewBox="0 0 24 24" fill="none">
    <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" />
    <path className="opacity-90" d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

/** Checkmark SVG for done steps */
const StepCheck = () => (
  <svg className="h-2.5 w-2.5 text-emerald-500 process-check-enter" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
  </svg>
);

/** Live elapsed counter for active steps — updates every 500ms */
const LiveElapsed = React.memo(function LiveElapsed({ startedAt }: { startedAt: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((c) => c + 1), 500);
    return () => clearInterval(id);
  }, []);
  const elapsed = Date.now() - startedAt;
  if (elapsed < 800) return null;
  return <ElapsedBadge ms={elapsed} />;
});

/** Detail status icon */
function DetailStatusIcon({ status }: { status?: "ok" | "warn" | "empty" }) {
  if (status === "ok" || !status) {
    return <span className="shrink-0 text-[9px] text-emerald-400">●</span>;
  }
  if (status === "warn") {
    return <span className="shrink-0 text-[9px] text-amber-400">●</span>;
  }
  return <span className="shrink-0 text-[9px] text-gray-300 dark:text-gray-600">○</span>;
}

export const PipelineStepRow = React.memo(function PipelineStepRow({
  step,
  isLast,
  idx,
  skipAnimation = false,
  children,
}: {
  step: ProcessStep;
  isLast: boolean;
  idx: number;
  skipAnimation?: boolean;
  children?: React.ReactNode;
}) {
  const friendly = STAGE_FRIENDLY[step.stage] || STAGE_FRIENDLY.fallback || { icon: "⚙️", label: step.message };
  const isDone = step.status === "done";
  const isPending = step.status === "pending";
  const isActive = step.status === "active";
  const isError = step.status === "error";
  const isSkipped = step.status === "skipped";
  const dimmed = isPending || isSkipped;
  const elapsedMs = (isDone || isError) && step.doneAt ? step.doneAt - step.startedAt : 0;

  return (
    <div
      className={`relative transition-opacity duration-300 ${dimmed ? "opacity-40" : "opacity-100"}`}
      role="listitem"
      style={{ animation: skipAnimation ? "none" : `fadeSlideIn 0.3s ease-out ${Math.min(idx * 0.06, 0.5)}s both` }}
    >
      {/* Main step row */}
      <div className="flex items-center gap-2.5 pl-0.5">
        {/* Status indicator */}
        <div
          className={`relative z-10 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px] border transition-all duration-300 ${
            isError
              ? "bg-red-50 border-red-200/80 dark:bg-red-950/30 dark:border-red-700/40"
              : isDone
                ? "bg-emerald-50 border-emerald-200/80 dark:bg-emerald-950/30 dark:border-emerald-700/40"
                : isSkipped
                  ? "bg-gray-50 border-gray-200/60 dark:bg-gray-800/30 dark:border-gray-700/30"
                  : isPending
                    ? "bg-gray-50 border-gray-200/60 dark:bg-gray-800/30 dark:border-gray-700/30"
                    : "bg-brand-50 border-brand-200/80 dark:bg-brand-950/30 dark:border-brand-700/40"
          } ${isActive && isLast ? "ring-2 ring-brand-300/50 dark:ring-brand-600/30" : ""}`}
        >
          {isError ? (
            <svg className="h-2.5 w-2.5 text-red-500" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          ) : isSkipped ? (
            <svg className="h-2.5 w-2.5 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
            </svg>
          ) : isDone ? <StepCheck /> : (isActive && isLast ? <StepSpinner /> : <span className={`text-[10px] ${isPending ? "grayscale" : ""}`}>{friendly.icon}</span>)}
        </div>

        {/* Label + detail + elapsed */}
        <div className="min-w-0 flex-1">
          <div className={`flex items-center gap-1.5 text-[11px] font-semibold leading-[22px] transition-colors duration-200 ${
            isError ? "text-red-600 dark:text-red-400"
              : isDone ? "text-emerald-600 dark:text-emerald-400"
              : isSkipped ? "text-gray-400 dark:text-gray-600 line-through"
              : isPending ? "text-gray-400 dark:text-gray-600"
              : "text-brand-600 dark:text-brand-400"
          }`}>
            <span className={`min-w-0 flex-1 truncate ${isActive && isLast ? "shimmer-text" : ""}`}>
              {friendly.label}
            </span>
            {(isDone || isError) && elapsedMs > 0 ? <ElapsedBadge ms={elapsedMs} /> : (isActive && isLast ? <LiveElapsed startedAt={step.startedAt} /> : null)}
          </div>
        </div>
      </div>

      {/* Error message */}
      {isError && step.errorMessage && (
        <div
          className="mt-0.5 ml-[34px] flex items-start gap-1.5"
          style={{ animation: "fadeSlideIn 0.2s ease-out both" }}
        >
          <span className="shrink-0 text-[9px] text-red-400">●</span>
          <span className="text-[10px] leading-snug text-red-500 dark:text-red-400 line-clamp-2">
            {step.errorMessage}
          </span>
        </div>
      )}

      {/* Detail text — shows search results, data info, etc. */}
      {step.detail && !isError && (
        <div
          className="mt-0.5 ml-[34px] flex items-start gap-1.5"
          style={{ animation: "fadeSlideIn 0.2s ease-out both" }}
        >
          <DetailStatusIcon status={step.detailStatus} />
          <span className="text-[10px] leading-snug text-gray-500 dark:text-gray-400 line-clamp-2">
            {step.detail}
          </span>
        </div>
      )}

      {/* Nested children (thinking items, tool calls nested under this stage) */}
      {children && (
        <div className="mt-1 ml-[34px] space-y-1">
          {children}
        </div>
      )}
    </div>
  );
});

/* ================================================================== */
/*  Parallel Group Row — shows Layer 2 stages as visually parallel     */
/* ================================================================== */

/** Live elapsed for the group — max of all children */
const ParallelGroupElapsed = React.memo(function ParallelGroupElapsed({
  stages,
}: {
  stages: Array<{ type: string; step?: ProcessStep }>;
}) {
  const pipeSteps = stages.filter((s): s is { type: "pipeline-step"; step: ProcessStep } => s.type === "pipeline-step");
  const allDone = pipeSteps.length > 0 && pipeSteps.every((s) => isTerminalStatus(s.step.status));

  const [, tick] = useState(0);
  useEffect(() => {
    if (allDone) return; // No interval needed when all done
    const id = setInterval(() => tick((c) => c + 1), 500);
    return () => clearInterval(id);
  }, [allDone]);

  if (pipeSteps.length === 0) return null;

  const firstStart = Math.min(...pipeSteps.map((s) => s.step.startedAt).filter(Boolean));
  const lastEnd = allDone ? Math.max(...pipeSteps.map((s) => s.step.doneAt ?? s.step.startedAt)) : Date.now();
  const elapsed = lastEnd - firstStart;
  if (elapsed < 800) return null;

  return <ElapsedBadge ms={elapsed} />;
});

export const ParallelGroupRow = React.memo(function ParallelGroupRow({
  label,
  stages,
  isTyping,
  isLastGroup,
  skipAnimation = false,
  renderChildren,
}: {
  label: string;
  stages: Array<{ type: string; step?: ProcessStep; idx?: number; thinkingChildren?: any[]; toolChildren?: any[]; orchChildren?: any[] }>;
  isTyping: boolean;
  isLastGroup: boolean;
  skipAnimation?: boolean;
  renderChildren: (seg: any, isLast: boolean) => React.ReactNode;
}) {
  const pipeSteps = stages.filter((s): s is { type: "pipeline-step"; step: ProcessStep } => s.type === "pipeline-step");
  const allDone = pipeSteps.every((s) => isTerminalStatus(s.step.status));
  const hasActive = pipeSteps.some((s) => s.step.status === "active");

  return (
    <div
      className="relative"
      role="group"
      aria-label={label}
      style={{ animation: skipAnimation ? "none" : "fadeSlideIn 0.3s ease-out both" }}
    >
      {/* Group header row */}
      <div className="flex items-center gap-2.5 pl-0.5 mb-0.5">
        <div
          className={`relative z-10 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px] border transition-all duration-300 ${
            allDone
              ? "bg-emerald-50 border-emerald-200/80 dark:bg-emerald-950/30 dark:border-emerald-700/40"
              : hasActive
                ? "bg-brand-50 border-brand-200/80 dark:bg-brand-950/30 dark:border-brand-700/40 ring-2 ring-brand-300/50 dark:ring-brand-600/30"
                : "bg-gray-50 border-gray-200/60 dark:bg-gray-800/30 dark:border-gray-700/30"
          }`}
        >
          {allDone ? (
            <svg className="h-2.5 w-2.5 text-emerald-500 process-check-enter" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          ) : hasActive ? (
            <svg className="h-3 w-3 animate-spin text-brand-500 dark:text-brand-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" />
              <path className="opacity-90" d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          ) : (
            <span className="text-[10px]">⚡</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className={`flex items-center gap-1.5 text-[11px] font-semibold leading-[22px] transition-colors duration-200 ${
            allDone ? "text-emerald-600 dark:text-emerald-400"
              : hasActive ? "text-brand-600 dark:text-brand-400"
              : "text-gray-400 dark:text-gray-600"
          }`}>
            <span className={`min-w-0 flex-1 truncate ${hasActive ? "shimmer-text" : ""}`}>
              {label}
            </span>
            <ParallelGroupElapsed stages={stages} />
          </div>
        </div>
      </div>

      {/* Child stages with left bracket connector */}
      <div className="relative ml-[10px] pl-[24px] space-y-1">
        {/* Vertical connector bar */}
        <div className="absolute left-[4px] top-0 bottom-0 w-[2px] rounded-full bg-gradient-to-b from-brand-200/80 via-brand-300/50 to-brand-200/30 dark:from-brand-700/50 dark:via-brand-600/30 dark:to-brand-700/20" />
        {stages.map((seg, i) => (
          <div key={i} className="relative">
            {/* Horizontal tick mark connecting to the vertical bar */}
            <div className="absolute left-[-20px] top-[10px] h-[2px] w-[14px] rounded-full bg-brand-200/60 dark:bg-brand-700/40" />
            {renderChildren(seg, i === stages.length - 1 && isLastGroup)}
          </div>
        ))}
      </div>
    </div>
  );
});

/* ================================================================== */
/*  Orchestrator Sub-Analysis Card                                     */
/* ================================================================== */
export const OrchestratorCard = React.memo(function OrchestratorCard({
  items,
  isStreaming,
}: {
  items: ThinkingItem[];
  isStreaming: boolean;
}) {
  return (
    <div className="relative ml-0.5 rounded-lg border border-indigo-200/80 bg-gradient-to-br from-indigo-50/80 to-violet-50/60 px-3 py-2.5 dark:border-indigo-700/40 dark:from-indigo-950/40 dark:to-violet-950/30">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="text-[13px]">🔬</span>
        <span className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300">Sub-Analisis</span>
        <span className="rounded-full bg-indigo-200/70 px-1.5 py-px text-[9px] tabular-nums font-medium text-indigo-600 dark:bg-indigo-800/50 dark:text-indigo-300">
          {items.length}
        </span>
        {isStreaming && (
          <span className="ml-auto inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400 dark:bg-indigo-500" />
        )}
      </div>
      <div className="space-y-1.5">
        {items.map((sq, i) => {
          const typeLabel = sq.tags?.[0] || "analisis";
          const badgeColor = TYPE_BADGE_COLORS[typeLabel] || TYPE_BADGE_COLORS.analisis;
          return (
            <div
              key={i}
              className="flex items-start gap-2 rounded-md bg-white/60 px-2.5 py-1.5 dark:bg-gray-900/40"
              style={{ animation: isStreaming ? `fadeSlideIn 0.3s ease-out ${i * 0.1}s both` : "none" }}
            >
              <span className="mt-px shrink-0 text-[12px]">{sq.icon || "📋"}</span>
              <div className="min-w-0 flex-1">
                <span className="text-[10.5px] font-medium leading-snug text-gray-700 dark:text-gray-200">{sq.label}</span>
              </div>
              <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide ${badgeColor}`}>
                {typeLabel}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

/* ================================================================== */
/*  Tool Call Card (enhanced with animations)                          */
/* ================================================================== */
export const ToolCallCard = React.memo(function ToolCallCard({ tc }: { tc: TrackedToolCall }) {
  const meta = TOOL_META[tc.toolName] || DEFAULT_TOOL_META;
  const hasResult = !!tc.result;
  const argsStr = formatToolArgs(tc.toolName, tc.args);

  // Live elapsed timer
  const [liveElapsed, setLiveElapsed] = useState("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (hasResult) {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      return;
    }
    intervalRef.current = setInterval(() => {
      setLiveElapsed(fmtToolElapsed(Date.now() - tc.startedAt));
    }, 200);
    return () => { if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; } };
  }, [hasResult, tc.startedAt]);

  const elapsed = hasResult && tc.result!.elapsedMs != null
    ? fmtToolElapsed(tc.result!.elapsedMs)
    : liveElapsed;

  return (
    <div
      className={`tool-call-card process-step-enter rounded-lg border px-3 py-2 transition-all duration-400 ${
        hasResult
          ? `border-gray-200/60 ${meta.bgLight} ${meta.bgDark} dark:border-gray-700/40`
          : `border-brand-300/50 bg-brand-50/40 dark:border-brand-700/40 dark:bg-brand-950/20 ring-1 ring-brand-200/30 dark:ring-brand-700/20 animate-pulse`
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className={`text-sm leading-none ${!hasResult ? "animate-bounce" : ""}`}>{meta.icon}</span>
        <span className={`text-[11px] font-semibold leading-tight ${meta.color}`}>{meta.label}</span>
        {!hasResult && (
          <svg className="h-3 w-3 animate-spin text-brand-500 dark:text-brand-400" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" />
            <path className="opacity-90" d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        )}
        {hasResult && (
          <svg className="h-3 w-3 text-emerald-500 process-check-enter" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        )}
        {elapsed && (
          <span className="ml-auto shrink-0 select-none rounded-full bg-gray-100 px-1.5 py-px text-[9px] tabular-nums text-gray-400 dark:bg-gray-800 dark:text-gray-500">
            {elapsed}
          </span>
        )}
      </div>

      {/* Args */}
      {argsStr && (
        <div className="mt-1 ml-[26px]">
          <span className="text-[10px] leading-snug text-gray-500 dark:text-gray-400">{argsStr}</span>
        </div>
      )}

      {/* Result */}
      {hasResult && tc.result && (
        <div className="mt-1 ml-[26px] flex items-center gap-1.5">
          {tc.result.found ? (
            <svg className="h-2.5 w-2.5 shrink-0 text-emerald-500" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg className="h-2.5 w-2.5 shrink-0 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
            </svg>
          )}
          <span className={`text-[10px] leading-snug ${tc.result.found ? "text-gray-600 dark:text-gray-300" : "text-gray-400 dark:text-gray-500"}`}>
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

/* ================================================================== */
/*  Stop / Retry / Edit Buttons                                        */
/* ================================================================== */
const StopIcon = () => (
  <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

export const ActionButtons = React.memo(function ActionButtons({
  isTyping,
  wasStopped,
  onStop,
  onRetry,
  onEdit,
}: {
  isTyping: boolean;
  wasStopped: boolean;
  onStop?: () => void;
  onRetry?: () => void;
  onEdit?: () => void;
}) {
  return (
    <>
      {isTyping && onStop && (
        <div className="mt-1.5 flex items-center">
          <button
            type="button"
            onClick={onStop}
            className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-[11px] font-medium text-red-600 transition-all hover:bg-red-100 active:scale-95 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-400 dark:hover:bg-red-900/50"
          >
            <StopIcon />
            <span>Hentikan</span>
          </button>
        </div>
      )}
      {wasStopped && !isTyping && (onRetry || onEdit) && (
        <div className="mt-1.5 flex items-center gap-2 process-step-enter">
          {onRetry && (
            <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-[11px] font-medium text-brand-600 transition-all hover:bg-brand-100 active:scale-95 dark:border-brand-800/60 dark:bg-brand-950/40 dark:text-brand-400 dark:hover:bg-brand-900/50">
              <RetryIcon className="h-3 w-3" />
              <span>Coba lagi</span>
            </button>
          )}
          {onEdit && (
            <button type="button" onClick={onEdit} className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-600 transition-all hover:bg-gray-100 active:scale-95 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700">
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
              <span>Edit</span>
            </button>
          )}
        </div>
      )}
    </>
  );
});

/* ================================================================== */
/*  Streaming Header                                                   */
/* ================================================================== */
export const StreamingHeader = React.memo(function StreamingHeader({
  steps,
  thinkingItems,
  isTyping,
  isExpanded,
  onToggle,
  modelId,
}: {
  steps: ProcessStep[];
  thinkingItems: ThinkingItem[];
  isTyping: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  modelId?: string;
}) {
  const allTerminal = steps.length > 0 && steps.every((s) => isTerminalStatus(s.status));
  const doneCount = steps.filter((s) => isTerminalStatus(s.status)).length;
  const totalCount = PIPELINE_STAGES.length;
  const deep = isDeepModel(modelId);

  // Find current active stage for the header label
  const activeStep = steps.find((s) => s.status === "active");
  const activeStageFriendly = activeStep ? (STAGE_FRIENDLY[activeStep.stage]?.label || activeStep.message) : null;
  const lastThinking = [...thinkingItems].reverse().find((i) => i.step && i.step !== "orchestrator-sub");
  const hasErrors = steps.some((s) => s.status === "error");
  const label = isTyping && !allTerminal
    ? (activeStageFriendly || lastThinking?.label || "Memproses...")
    : hasErrors ? "Selesai (dengan error)" : "Selesai memproses";

  const stepCountLabel = totalCount > 0 ? `${doneCount}/${totalCount}` : "";

  return (
    <button
      type="button"
      onClick={onToggle}
      className="group flex w-full items-center gap-1.5 px-2 py-1.5 text-left transition-colors hover:bg-gray-200/40 dark:hover:bg-white/5"
      aria-expanded={isExpanded}
    >
      <ChevronRightIcon
        className={`h-2.5 w-2.5 shrink-0 text-gray-400 transition-transform duration-200 dark:text-gray-500 ${isExpanded ? "rotate-90" : ""}`}
        strokeWidth={2.5}
      />
      {isTyping && !allTerminal ? (
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-50 ${deep ? "bg-purple-400" : "bg-brand-400"}`} />
          <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${deep ? "bg-purple-500" : "bg-brand-500"}`} />
        </span>
      ) : (
        <svg className="h-3 w-3 shrink-0 text-emerald-500 process-check-enter" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      )}
      <span className="min-w-0 flex-1 truncate text-[11px] text-gray-500 dark:text-gray-400">
        {label}
      </span>
      {modelId && (
        <span className={`shrink-0 rounded-full px-1.5 py-px text-[9px] font-semibold ${
          deep
            ? "bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-300"
            : "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300"
        }`}>
          {deep ? "Deep" : "Flash"}
        </span>
      )}
      {stepCountLabel && (
        <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-px text-[9px] tabular-nums font-medium text-gray-400 dark:bg-gray-800/60 dark:text-gray-500">
          {stepCountLabel}
        </span>
      )}
      <TotalElapsed steps={steps} />
    </button>
  );
});

/* ================================================================== */
/*  Historical Header (collapsed toggle)                               */
/* ================================================================== */
export const HistoricalHeader = React.memo(function HistoricalHeader({
  thinkingItems,
  isExpanded,
  onToggle,
  pipelineMs,
  modelId,
}: {
  thinkingItems: ThinkingItem[];
  isExpanded: boolean;
  onToggle?: () => void;
  pipelineMs?: Record<string, number> | null;
  modelId?: string;
}) {
  const structuredCount = thinkingItems.filter((i) => i.step).length;
  const reasoningChars = thinkingItems.reduce((sum, i) => sum + (i.content?.length || 0), 0);
  const reasoningTokens = Math.round(reasoningChars / 4);
  const deep = isDeepModel(modelId);

  // Calculate total pipeline time
  const totalMs = pipelineMs ? Object.values(pipelineMs).reduce((s, v) => s + v, 0) : 0;

  return (
    <button
      type="button"
      onClick={onToggle}
      className="group flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[12px] font-medium transition-all duration-200 bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:bg-gray-800/60 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-300"
      aria-expanded={isExpanded}
    >
      <ChevronRightIcon
        className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform duration-200 group-hover:text-gray-600 dark:text-gray-500 dark:group-hover:text-gray-300 ${isExpanded ? "rotate-90" : ""}`}
      />
      <span>{isExpanded ? "Sembunyikan proses berpikir" : "Lihat proses berpikir"}</span>
      <span className="ml-auto flex items-center gap-2 text-[10px] opacity-60">
        {modelId && (
          <span className={`rounded-full px-1.5 py-px text-[9px] font-semibold opacity-100 ${
            deep
              ? "bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-300"
              : "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300"
          }`}>
            {deep ? "Deep" : "Flash"}
          </span>
        )}
        {structuredCount > 0 && <span>{structuredCount} langkah</span>}
        {reasoningTokens > 0 && (
          <span className="tabular-nums" title={`~${reasoningTokens} reasoning token`}>
            {reasoningTokens >= 1000 ? `${(reasoningTokens / 1000).toFixed(1)}k` : reasoningTokens} tok
          </span>
        )}
        {totalMs > 0 && (
          <span className="tabular-nums">{fmtMs(totalMs)}</span>
        )}
      </span>
    </button>
  );
});

/* ================================================================== */
/*  Initial Loader (before any events arrive)                          */
/* ================================================================== */
export const InitialLoader = ({ label }: { label: string }) => (
  <div className="process-step-enter flex items-center gap-2 py-0.5">
    <span className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center">
      <span className="absolute h-3.5 w-3.5 animate-ping rounded-full bg-brand-400/20" />
      <span className="h-1.5 w-1.5 rounded-full bg-brand-500 dark:bg-brand-400" />
    </span>
    <span className="shimmer-text text-xs text-gray-500 dark:text-gray-400">{label}</span>
  </div>
);
