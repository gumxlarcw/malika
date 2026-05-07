"use client";

import React, { useMemo } from "react";

/* ------------------------------------------------------------------ */
/*  Shared stage → color + label configuration                        */
/*  Covers BOTH live pipeline stages AND historical timing keys.      */
/*  Aliases (e.g. dnaLookup, intentAndKnowledge, stream) map to the  */
/*  same visual as their canonical counterpart.                        */
/* ------------------------------------------------------------------ */
export const TIMING_STAGE_CONFIG: Record<string, { label: string; color: string }> = {
  normalize:           { label: "Topik",        color: "bg-blue-400 dark:bg-blue-500" },
  dna:                 { label: "DNA",          color: "bg-emerald-400 dark:bg-emerald-500" },
  dnaLookup:           { label: "DNA",          color: "bg-emerald-400 dark:bg-emerald-500" },
  search:              { label: "Cari",         color: "bg-cyan-400 dark:bg-cyan-500" },
  intentAndKnowledge:  { label: "Cari",         color: "bg-cyan-400 dark:bg-cyan-500" },
  preview:             { label: "Data",         color: "bg-teal-400 dark:bg-teal-500" },
  fallback:            { label: "Fallback",     color: "bg-orange-400 dark:bg-orange-500" },
  analyst:             { label: "Analisis",     color: "bg-amber-400 dark:bg-amber-500" },
  model:               { label: "Konteks",      color: "bg-indigo-400 dark:bg-indigo-500" },
  orchestrator:        { label: "Orchestrator", color: "bg-purple-400 dark:bg-purple-500" },
  thinking:            { label: "Pikir",        color: "bg-violet-400 dark:bg-violet-500" },
  generate:            { label: "Generate",     color: "bg-rose-400 dark:bg-rose-500" },
  stream:              { label: "Generate",     color: "bg-rose-400 dark:bg-rose-500" },
  composing:           { label: "Susun",        color: "bg-gray-400 dark:bg-gray-500" },
  knowledgeMode:       { label: "Knowledge",    color: "bg-purple-400 dark:bg-purple-500" },
};

/* ------------------------------------------------------------------ */
/*  Segment types                                                      */
/* ------------------------------------------------------------------ */
export interface TimingSegment {
  key: string;
  label: string;
  ms: number;
  color: string;
}

/* ------------------------------------------------------------------ */
/*  Builders — convert different data shapes into uniform segments     */
/* ------------------------------------------------------------------ */

/** Live pipeline: ProcessStep[] → segments (from startedAt/doneAt) */
export function buildSegmentsFromSteps(
  steps: Array<{ stage: string; startedAt?: number; doneAt?: number }>,
): TimingSegment[] {
  const segments: TimingSegment[] = [];
  for (const s of steps) {
    if (!s.startedAt || !s.doneAt) continue;
    const ms = s.doneAt - s.startedAt;
    if (ms <= 0) continue;
    const cfg = TIMING_STAGE_CONFIG[s.stage];
    segments.push({
      key: s.stage,
      label: cfg?.label || s.stage,
      ms,
      color: cfg?.color || "bg-gray-300 dark:bg-gray-600",
    });
  }
  return segments;
}

/** Historical: Record<string, number> → segments (from pipeline_ms) */
export function buildSegmentsFromTimings(
  pipelineMs: Record<string, number>,
): TimingSegment[] {
  const segments: TimingSegment[] = [];
  for (const [key, ms] of Object.entries(pipelineMs)) {
    if (ms <= 0) continue;
    const cfg = TIMING_STAGE_CONFIG[key];
    if (!cfg) continue; // skip unknown stages
    segments.push({ key, label: cfg.label, ms, color: cfg.color });
  }
  return segments;
}

/* ------------------------------------------------------------------ */
/*  Format helper                                                      */
/* ------------------------------------------------------------------ */
function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/* ------------------------------------------------------------------ */
/*  TimingBar — renders a coloured segmented bar + labels              */
/* ------------------------------------------------------------------ */
const TimingBar = React.memo(function TimingBar({
  segments,
  minSegments = 2,
  minTotalMs = 500,
}: {
  segments: TimingSegment[];
  /** Minimum number of completed segments to render (default 2) */
  minSegments?: number;
  /** Minimum total ms to render (default 500) */
  minTotalMs?: number;
}) {
  const totalMs = useMemo(() => segments.reduce((s, i) => s + i.ms, 0), [segments]);

  if (segments.length < minSegments || totalMs < minTotalMs) return null;

  return (
    <div className="mx-2 mb-1.5">
      {/* Segmented bar */}
      <div className="flex h-[5px] overflow-hidden rounded-full bg-gray-100/50 dark:bg-gray-800/40">
        {segments.map((seg) => (
          <div
            key={seg.key}
            className={`${seg.color} transition-[width] duration-500`}
            style={{ width: `${Math.max((seg.ms / totalMs) * 100, 1.5)}%` }}
            title={`${seg.label}: ${fmtMs(seg.ms)}`}
          />
        ))}
      </div>
      {/* Labels — only for segments >8% of total */}
      <div className="mt-0.5 flex justify-between text-[8px] tabular-nums text-gray-400 dark:text-gray-500">
        {segments
          .filter((s) => s.ms / totalMs > 0.08)
          .map((seg) => (
            <span key={seg.key} className="inline-flex items-center gap-0.5 truncate">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${seg.color.split(" ")[0]}`} />
              {seg.label} {fmtMs(seg.ms)}
            </span>
          ))}
      </div>
    </div>
  );
});

export default TimingBar;
