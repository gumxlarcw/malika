"use client";

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { ChevronRightIcon, RetryIcon } from "@/components/chat/icons";
import TimingBar, { buildSegmentsFromSteps } from "@/components/chat/TimingBar";
import { ToolCallsSection } from "@/components/chat/ToolCallCard";
import type { TrackedToolCall } from "@/context/ChatProcessContext";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
export interface ProcessStep {
  message: string;
  stage: string;
  status: "active" | "done";
  startedAt: number;
  doneAt?: number;
  detail?: string;
  /** Result quality indicator from backend: ok (default), warn (partial), empty (none) */
  detailStatus?: "ok" | "warn" | "empty";
}

interface ProcessIndicatorProps {
  steps: ProcessStep[];
  toolCalls?: TrackedToolCall[];
  isTyping: boolean;
  visible: boolean;
  fallbackLabel?: string;
  onStop?: () => void;
  onRetry?: () => void;
  onEdit?: () => void;
  wasStopped?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Pipeline stages                                                    */
/*  Core stages always shown. Conditional stages (analyst, orchestrator)*/
/*  only appear when the backend actually emits them.                   */
/* ------------------------------------------------------------------ */
const CORE_PIPELINE_STAGES: { stage: string; message: string }[] = [
  { stage: "normalize", message: "Mengenali topik & wilayah" },
  { stage: "dna", message: "Mengumpulkan metadata" },
  { stage: "search", message: "Mencocokkan sumber data" },
  { stage: "preview", message: "Memuat data tabel terbaru" },
  { stage: "model", message: "Merangkai konteks & referensi" },
  { stage: "generate", message: "Merangkum & menarasikan data" },
  { stage: "composing", message: "Menyusun jawaban" },
];

/** Conditional stages — inserted into timeline only when backend sends them */
const CONDITIONAL_STAGE_DEFS: Record<string, { message: string; after: string }> = {
  knowledge:    { message: "Mencari referensi BRS & Publikasi", after: "search" },
  fallback:     { message: "Penyesuaian data",        after: "preview" },
  analyst:      { message: "Menganalisis referensi",   after: "preview" },
  orchestrator: { message: "Analisis mendalam",        after: "model" },
  thinking:     { message: "Menganalisis data",        after: "model" },
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function formatElapsed(ms: number): string {
  if (ms < 1000) return "<1s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

const ElapsedBadge = React.memo(function ElapsedBadge({ startedAt, doneAt }: { startedAt: number; doneAt?: number }) {
  const [, forceUpdate] = useState(0);
  const elapsedRef = useRef("");
  useEffect(() => {
    if (doneAt) return;
    const id = setInterval(() => {
      const next = formatElapsed(Date.now() - startedAt);
      if (next !== elapsedRef.current) {
        elapsedRef.current = next;
        forceUpdate((c) => c + 1);
      }
    }, 500);
    return () => clearInterval(id);
  }, [doneAt, startedAt]);
  const elapsed = (doneAt ?? Date.now()) - startedAt;
  if (elapsed < 800) return null;
  const label = doneAt ? formatElapsed(elapsed) : elapsedRef.current || formatElapsed(elapsed);
  return (
    <span className="shrink-0 select-none rounded-full bg-gray-100 px-1.5 py-px text-[9px] tabular-nums text-gray-400 dark:bg-gray-800 dark:text-gray-500">
      {label}
    </span>
  );
});

const TotalElapsed = React.memo(function TotalElapsed({ steps }: { steps: ProcessStep[] }) {
  const [, forceUpdate] = useState(0);
  const labelRef = useRef("");
  const firstStart = steps.length > 0 ? steps[0].startedAt : 0;
  const allDone = steps.length > 0 && steps.every((s) => s.status === "done");
  const lastDoneAt = allDone ? Math.max(...steps.map((s) => s.doneAt ?? s.startedAt)) : 0;
  useEffect(() => {
    if (allDone || !firstStart) return;
    const id = setInterval(() => {
      const next = formatElapsed(Date.now() - firstStart);
      if (next !== labelRef.current) {
        labelRef.current = next;
        forceUpdate((c) => c + 1);
      }
    }, 500);
    return () => clearInterval(id);
  }, [allDone, firstStart]);
  if (!firstStart) return null;
  const elapsed = (allDone ? lastDoneAt : Date.now()) - firstStart;
  if (elapsed < 800) return null;
  const label = allDone ? formatElapsed(elapsed) : labelRef.current || formatElapsed(elapsed);
  return (
    <span className="shrink-0 select-none text-[10px] tabular-nums text-gray-400/60 dark:text-gray-500/50">
      {label}
    </span>
  );
});

/* ------------------------------------------------------------------ */
/*  Icons                                                              */
/* ------------------------------------------------------------------ */
const SpinnerIcon = () => (
  <svg className="h-3.5 w-3.5 animate-spin text-brand-500 dark:text-brand-400" viewBox="0 0 24 24" fill="none">
    <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" />
    <path className="opacity-90" d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

const CheckIcon = ({ variant = "ok" }: { variant?: "ok" | "warn" | "empty" }) => {
  if (variant === "empty") {
    // Gray dash — stage found nothing
    return (
      <svg className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500 process-check-enter" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
      </svg>
    );
  }
  if (variant === "warn") {
    // Amber check — partial/degraded result
    return (
      <svg className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400 process-check-enter" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
      </svg>
    );
  }
  return (
    <svg className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400 process-check-enter" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  );
};

const PendingDot = () => (
  <span className="h-1.5 w-1.5 rounded-full bg-gray-300 dark:bg-gray-600" />
);

const StopIcon = () => (
  <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

const ChevronIcon = ({ expanded }: { expanded: boolean }) => (
  <ChevronRightIcon
    className={`h-2.5 w-2.5 shrink-0 text-gray-400 transition-transform duration-200 ease-out dark:text-gray-500 ${
      expanded ? "rotate-90" : ""
    }`}
    strokeWidth={2.5}
  />
);

/* ------------------------------------------------------------------ */
/*  StreamingText — character-by-character typewriter reveal           */
/*  Uses displayedText state directly (not ref+counter) so the first  */
/*  render always shows content. Wrapped in React.memo so parent      */
/*  re-renders (from other steps updating) don't interrupt streaming. */
/* ------------------------------------------------------------------ */
const StreamingText = React.memo(function StreamingText({
  text,
  onComplete,
}: {
  text: string;
  onComplete?: () => void;
}) {
  // Start with first char visible immediately — no empty frame
  const [displayed, setDisplayed] = useState(() => text.slice(0, 1));
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  useEffect(() => {
    const len = text.length;
    if (len <= 1) {
      // Single char or empty — already fully displayed
      onCompleteRef.current?.();
      return;
    }

    // Start from char 1 (char 0 already shown via initial state)
    let pos = 1;
    // Adaptive speed: faster for long texts, slower for short
    const speed = len > 80 ? 6 : len > 40 ? 8 : 12;
    // Reveal 1-3 chars per tick depending on length
    const charsPerTick = len > 100 ? 3 : len > 50 ? 2 : 1;

    const id = setInterval(() => {
      pos = Math.min(pos + charsPerTick, len);
      setDisplayed(text.slice(0, pos));
      if (pos >= len) {
        clearInterval(id);
        onCompleteRef.current?.();
      }
    }, speed);

    return () => clearInterval(id);
  }, [text]);

  const isStreaming = displayed.length < text.length;

  return (
    <span>
      {displayed}
      {isStreaming && (
        <span className="inline-block w-[3px] h-[11px] ml-px align-middle bg-brand-400/70 dark:bg-brand-300/60 animate-pulse rounded-sm" />
      )}
    </span>
  );
});

/* ------------------------------------------------------------------ */
/*  Accordion Step Row — live expand while active, streaming text      */
/* ------------------------------------------------------------------ */
const AccordionStepRow = React.memo(function AccordionStepRow({
  step,
  status,
  isLast,
  expanded,
  onToggle,
  onStreamComplete,
  detailStatus,
}: {
  step: { message: string; stage: string; startedAt?: number; doneAt?: number; detail?: string };
  status: "active" | "done" | "pending";
  isLast: boolean;
  expanded: boolean;
  onToggle: () => void;
  onStreamComplete?: () => void;
  detailStatus?: "ok" | "warn" | "empty";
}) {
  const hasRealDetail = Boolean(step.detail);
  const hasAnyContent = hasRealDetail;
  // Clickable (chevron toggle) when real detail or thinking items exist
  const isClickable = hasAnyContent;
  // Panel opens when content exists and not collapsed
  const isOpen = hasAnyContent && expanded;

  return (
    <div className={`process-step-row relative ${status === "active" ? "process-step-enter sticky top-0 z-10 bg-white/95 backdrop-blur-sm dark:bg-gray-900/95" : ""}`}>
      {/* Vertical connector line */}
      {!isLast && (
        <div className="absolute left-[8px] top-[18px] h-[calc(100%-2px)] w-px bg-gray-200/60 dark:bg-gray-700/40" />
      )}

      {/* Main row */}
      <div
        className={`flex items-start gap-2 ${
          isClickable
            ? "cursor-pointer rounded-md -mx-1 px-1 transition-colors hover:bg-gray-100/60 dark:hover:bg-white/5"
            : ""
        }`}
        onClick={isClickable ? onToggle : undefined}
        role={isClickable ? "button" : undefined}
        tabIndex={isClickable ? 0 : undefined}
        onKeyDown={
          isClickable
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onToggle();
                }
              }
            : undefined
        }
      >
        {/* Icon column */}
        <div className="relative z-10 flex h-[18px] w-[18px] shrink-0 items-center justify-center">
          {status === "active" ? <SpinnerIcon /> : status === "done" ? <CheckIcon variant={detailStatus || "ok"} /> : <PendingDot />}
        </div>

        {/* Label + elapsed + chevron */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5 pb-1">
          {hasAnyContent && <ChevronIcon expanded={expanded} />}

          <span
            className={`text-xs leading-relaxed transition-colors duration-300 ${
              status === "active"
                ? "shimmer-text font-medium text-gray-700 dark:text-gray-200"
                : status === "done"
                  ? "text-gray-500 dark:text-gray-400"
                  : "text-gray-300/80 dark:text-gray-600/80"
            }`}
          >
            {step.message}
          </span>

          {status !== "pending" && step.startedAt && (
            <ElapsedBadge startedAt={step.startedAt} doneAt={step.doneAt} />
          )}
        </div>
      </div>

      {/* Expandable detail panel */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
        style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          {/* Detail panel: streaming char-by-char reveal after stage completes */}
          {hasRealDetail && (
            <div
              className={`ml-[26px] mr-1 mt-0.5 mb-1.5 max-h-32 overflow-y-auto custom-scrollbar rounded-md px-2.5 py-1.5 transition-all duration-500 ${
                status === "active"
                  ? "bg-brand-50/50 dark:bg-brand-950/20"
                  : "bg-gray-50/80 dark:bg-white/[0.03]"
              }`}
            >
              <p
                className={`break-words text-[11px] leading-relaxed transition-colors duration-300 ${
                  status === "active"
                    ? "text-gray-600 dark:text-gray-300"
                    : "text-gray-500 dark:text-gray-400"
                }`}
              >
                <StreamingText text={step.detail!} onComplete={onStreamComplete} />
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Progress Bar                                                       */
/* ------------------------------------------------------------------ */
const ProgressBar = React.memo(function ProgressBar({ steps, total }: { steps: ProcessStep[]; total: number }) {
  const done = steps.filter((s) => s.status === "done").length;
  const hasActive = steps.some((s) => s.status === "active");
  const pct = Math.min(((done + (hasActive ? 0.5 : 0)) / Math.max(total, 1)) * 100, 100);
  return (
    <div className="mx-2 mb-2 h-[3px] overflow-hidden rounded-full bg-gray-200/50 dark:bg-gray-700/40">
      <div
        className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-500 transition-[width] duration-700 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
});



/* ------------------------------------------------------------------ */
/*  Header                                                             */
/* ------------------------------------------------------------------ */
const Header = ({
  steps,
  isExpanded,
  onToggle,
  isTyping,
}: {
  steps: ProcessStep[];
  isExpanded: boolean;
  onToggle: () => void;
  isTyping: boolean;
}) => {
  const activeStep = steps.find((s) => s.status === "active");
  const allDone = steps.length > 0 && steps.every((s) => s.status === "done");
  const label = activeStep?.message ?? (allDone ? "Selesai memproses" : "Memproses...");
  return (
    <button
      type="button"
      onClick={onToggle}
      className="group flex w-full items-center gap-1.5 px-2 py-1.5 text-left transition-colors hover:bg-gray-200/40 dark:hover:bg-white/5"
      aria-expanded={isExpanded}
    >
      <ChevronIcon expanded={isExpanded} />
      {isTyping && !allDone ? (
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-50" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-500" />
        </span>
      ) : (
        <svg className="h-3 w-3 shrink-0 text-emerald-500 process-check-enter" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      )}
      <span className="min-w-0 flex-1 truncate text-[11px] text-gray-500 dark:text-gray-400">{label}</span>
      <TotalElapsed steps={steps} />
    </button>
  );
};

/* ------------------------------------------------------------------ */
/*  Initial Loader                                                     */
/* ------------------------------------------------------------------ */
const InitialLoader = ({ label }: { label: string }) => (
  <div className="process-step-enter flex items-center gap-2 py-0.5">
    <span className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center">
      <span className="absolute h-3.5 w-3.5 animate-ping rounded-full bg-brand-400/20" />
      <span className="h-1.5 w-1.5 rounded-full bg-brand-500 dark:bg-brand-400" />
    </span>
    <span className="shimmer-text text-xs text-gray-500 dark:text-gray-400">{label}</span>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */
export const ProcessIndicator: React.FC<ProcessIndicatorProps> = ({
  steps,
  toolCalls = [],
  isTyping,
  visible,
  fallbackLabel = "Memproses...",
  onStop,
  onRetry,
  onEdit,
  wasStopped = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  // INVERTED expansion model: track which stages have been COLLAPSED.
  // Panel is open when: hasDetail && !collapsedStages.has(stage)
  // This is DERIVED during render — no useEffect needed, so the panel
  // opens on the SAME render that detail arrives (fixes React 18 batching).
  const [collapsedStages, setCollapsedStages] = useState<Set<string>>(new Set());
  // Track which stages have FINISHED their StreamingText animation.
  // Steps with detail that haven't finished streaming show spinner ("active")
  // even when the data says "done" — this is the VISUAL OVERRIDE that solves
  // React 18 batching: user sees spinner+streaming, not green-check+streaming.
  const [streamDoneStages, setStreamDoneStages] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const prevLenRef = useRef(0);
  // Timer refs for staggered auto-collapse — keyed by stage name
  const collapseTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Track which stages have been scheduled for auto-collapse (prevents re-scheduling)
  const scheduledCollapseRef = useRef<Set<string>>(new Set());

  // Build full step list: real steps + pending core stages.
  // Conditional stages (analyst, orchestrator) only appear when backend emits them.
  const fullSteps = useMemo(() => {
    const realStages = new Set(steps.map((s) => s.stage));
    type PendingStep = { message: string; stage: string; status: "pending" };

    // Build effective pipeline: core stages + any conditional stages that were received
    const effectiveStages: { stage: string; message: string }[] = [];
    for (const ps of CORE_PIPELINE_STAGES) {
      effectiveStages.push(ps);
      // Insert conditional stages after their anchor if backend sent them
      for (const [cStage, cDef] of Object.entries(CONDITIONAL_STAGE_DEFS)) {
        if (cDef.after === ps.stage && realStages.has(cStage)) {
          effectiveStages.push({ stage: cStage, message: cDef.message });
        }
      }
    }

    const pending: PendingStep[] = [];
    if (steps.length > 0) {
      for (const ps of effectiveStages) {
        if (!realStages.has(ps.stage)) {
          pending.push({ message: ps.message, stage: ps.stage, status: "pending" as const });
        }
      }
    }

    // Order: place real steps in their effective pipeline position
    const stageOrder = new Map(effectiveStages.map((s, i) => [s.stage, i]));
    const allSteps = [
      ...steps.map((s) => ({ ...s, status: s.status as "active" | "done" | "pending" })),
      ...pending,
    ];
    allSteps.sort((a, b) => (stageOrder.get(a.stage) ?? 99) - (stageOrder.get(b.stage) ?? 99));
    return allSteps;
  }, [steps]);

  // Effective total stages for progress bar (core + any conditional that appeared)
  const effectiveTotalStages = useMemo(() => {
    const realStages = new Set(steps.map((s) => s.stage));
    let count = CORE_PIPELINE_STAGES.length;
    for (const cStage of Object.keys(CONDITIONAL_STAGE_DEFS)) {
      if (realStages.has(cStage)) count++;
    }
    return count;
  }, [steps]);

  // ── Auto-expand section when new steps arrive ──
  useEffect(() => {
    if (steps.length > prevLenRef.current) {
      setIsExpanded(true);
    }
    // Reset all visual state when steps are cleared (new conversation)
    if (steps.length === 0 && prevLenRef.current > 0) {
      setCollapsedStages(new Set());
      setStreamDoneStages(new Set());
      scheduledCollapseRef.current.clear();
      collapseTimersRef.current.forEach((t) => clearTimeout(t));
      collapseTimersRef.current.clear();
    }
    prevLenRef.current = steps.length;
  }, [steps.length]);

  // NO useEffect for per-step expansion! The panel state is DERIVED:
  //   isOpen = hasDetail && !collapsedStages.has(stage)
  // This opens the panel on the SAME render that detail arrives.

  // When StreamingText finishes: flip visual status to "done" + schedule auto-collapse
  const handleStreamComplete = useCallback((stage: string) => {
    // 1. Mark streaming as complete → effectiveStatus flips from "active" to "done"
    setStreamDoneStages((prev) => {
      const next = new Set(prev);
      next.add(stage);
      return next;
    });

    // 2. Schedule auto-collapse of the detail panel (skip if already scheduled)
    if (scheduledCollapseRef.current.has(stage)) return;
    scheduledCollapseRef.current.add(stage);
    const timer = setTimeout(() => {
      setCollapsedStages((prev) => {
        const next = new Set(prev);
        next.add(stage);
        return next;
      });
      collapseTimersRef.current.delete(stage);
    }, 2500); // 2.5s reading buffer after streaming finishes
    collapseTimersRef.current.set(stage, timer);
  }, []);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      collapseTimersRef.current.forEach((t) => clearTimeout(t));
    };
  }, []);

  // Auto-scroll to bottom when NEW steps arrive (length-based, not reference-based)
  const stepsLenRef = useRef(0);
  useEffect(() => {
    if (steps.length <= stepsLenRef.current) {
      stepsLenRef.current = steps.length;
      return;
    }
    stepsLenRef.current = steps.length;
    const el = containerRef.current;
    if (el) {
      requestAnimationFrame(() => {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      });
    }
  }, [steps.length]);

  // Auto-collapse entire section after all steps done + delay
  useEffect(() => {
    if (steps.length > 0 && steps.every((s) => s.status === "done") && !isTyping) {
      const t = setTimeout(() => setIsExpanded(false), 1500);
      return () => clearTimeout(t);
    }
  }, [steps, isTyping]);

  const toggleExpanded = useCallback(() => setIsExpanded((v) => !v), []);

  const toggleStepDetail = useCallback((stage: string) => {
    // Cancel any pending auto-collapse for this stage
    const existingTimer = collapseTimersRef.current.get(stage);
    if (existingTimer) {
      clearTimeout(existingTimer);
      collapseTimersRef.current.delete(stage);
    }
    // Also clear scheduled flag so re-opening can trigger auto-collapse again
    scheduledCollapseRef.current.delete(stage);
    setCollapsedStages((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage); // re-open
      else next.add(stage); // close
      return next;
    });
  }, []);

  // Per-step expanded state: DERIVED — open when content exists and not collapsed
  const isStepExpanded = useCallback(
    (step: { stage: string; detail?: string }) => {
      const hasContent = Boolean(step.detail);
      if (!hasContent) return false;
      return !collapsedStages.has(step.stage);
    },
    [collapsedStages],
  );

  // Compute EFFECTIVE visual status: override "done" → "active" while streaming.
  // This is the key fix: React 18 batches status_detail + next status into one
  // render, so step.status is already "done" when detail first appears. We keep
  // the spinner visible until StreamingText fires onComplete.
  const getEffectiveStatus = useCallback(
    (step: { stage: string; status: string; detail?: string }) => {
      if (step.status === "done" && step.detail && !streamDoneStages.has(step.stage)) {
        return "active"; // show spinner while text is still streaming
      }
      return step.status as "active" | "done" | "pending";
    },
    [streamDoneStages],
  );

  if (!visible && steps.length === 0) return null;
  const hasSteps = steps.length > 0;

  return (
    <div
      className={`process-indicator-wrapper transition-[opacity] duration-400 ease-out ${
        visible ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
      role="status"
      aria-live="polite"
    >
      {hasSteps ? (
        <div>
          <Header steps={steps} isExpanded={isExpanded} onToggle={toggleExpanded} isTyping={isTyping} />

          <div
            className="grid transition-[grid-template-rows,opacity] duration-300 ease-out"
            style={{ gridTemplateRows: isExpanded ? "1fr" : "0fr" }}
          >
            <div className="overflow-hidden">
              <ProgressBar steps={steps} total={effectiveTotalStages} />
              {steps.every((s) => s.status === "done") && <TimingBar segments={buildSegmentsFromSteps(steps)} />}
              <div ref={containerRef} className="custom-scrollbar max-h-[320px] overflow-y-auto px-2 pb-1.5">
                {fullSteps.map((step, i) => {
                  // Check if tool calls should be inserted AFTER this step
                  // Tool calls appear after the "model" stage (when LLM starts using tools)
                  const showToolsAfter = step.stage === "model" && toolCalls.length > 0;
                  return (
                    <React.Fragment key={step.stage}>
                      {/* Skip rendering tool_* stages as normal pipeline steps — they're shown as ToolCallCards instead */}
                      {!step.stage.startsWith("tool_") && (
                        <AccordionStepRow
                          step={step}
                          status={getEffectiveStatus(step)}
                          isLast={i === fullSteps.length - 1 && toolCalls.length === 0}
                          expanded={isStepExpanded(step)}
                          onToggle={() => toggleStepDetail(step.stage)}
                          onStreamComplete={() => handleStreamComplete(step.stage)}
                          detailStatus={(step as ProcessStep).detailStatus}
                        />
                      )}
                      {showToolsAfter && (
                        <ToolCallsSection toolCalls={toolCalls} />
                      )}
                    </React.Fragment>
                  );
                })}
                {/* Fallback: if no "model" step yet but tool calls exist, show them at the end */}
                {toolCalls.length > 0 && !fullSteps.some((s) => s.stage === "model") && (
                  <ToolCallsSection toolCalls={toolCalls} />
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <InitialLoader label={fallbackLabel} />
      )}

      {/* Stop button */}
      {isTyping && onStop && (
        <div className="mt-1.5 flex items-center">
          <button
            type="button"
            onClick={onStop}
            className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-[11px] font-medium text-red-600 transition-all hover:bg-red-100 active:scale-95 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-400 dark:hover:bg-red-900/50"
            title="Hentikan respons"
          >
            <StopIcon />
            <span>Hentikan</span>
          </button>
        </div>
      )}

      {/* Retry / Edit */}
      {wasStopped && !isTyping && (onRetry || onEdit) && (
        <div className="mt-1.5 flex items-center gap-2 process-step-enter">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-[11px] font-medium text-brand-600 transition-all hover:bg-brand-100 active:scale-95 dark:border-brand-800/60 dark:bg-brand-950/40 dark:text-brand-400 dark:hover:bg-brand-900/50"
            >
              <RetryIcon className="h-3 w-3" />
              <span>Coba lagi</span>
            </button>
          )}
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-600 transition-all hover:bg-gray-100 active:scale-95 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              <span>Edit</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default ProcessIndicator;
