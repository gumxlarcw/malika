"use client";

import React, { useEffect, useState } from "react";

export type SearchStage = "idle" | "searching" | "preview" | "insights" | "complete";

export interface SearchProgress {
  stage: SearchStage;
  message: string;
  resultCount?: number;
  subMessage?: string;
}

interface StepInfo {
  key: SearchStage;
  label: string;
  shortLabel: string;
}

const STEPS: StepInfo[] = [
  { key: "searching", label: "Mencari Data", shortLabel: "Mencari" },
  { key: "preview", label: "Memuat Preview", shortLabel: "Preview" },
  { key: "insights", label: "Analisis", shortLabel: "Analisis" },
  { key: "complete", label: "Selesai", shortLabel: "Selesai" },
];

const STAGE_WEIGHTS: Record<SearchStage, number> = {
  idle: 0,
  searching: 25,
  preview: 55,
  insights: 85,
  complete: 100,
};

interface Props {
  progress: SearchProgress;
  className?: string;
}

export default function SearchLoadingProgress({ progress, className }: Props) {
  const [animatedPct, setAnimatedPct] = useState(0);
  const [showSubMessage, setShowSubMessage] = useState(false);

  const targetPct = STAGE_WEIGHTS[progress.stage] || 0;

  // Animate percentage smoothly
  useEffect(() => {
    if (progress.stage === "complete") {
      setAnimatedPct(100);
      return;
    }

    const interval = setInterval(() => {
      setAnimatedPct((prev) => {
        if (prev >= targetPct - 2) return prev;
        const diff = targetPct - prev;
        const step = Math.max(1, Math.floor(diff * 0.15));
        return Math.min(prev + step, targetPct - 2);
      });
    }, 50);

    return () => clearInterval(interval);
  }, [targetPct, progress.stage]);

  // Show sub-message with slight delay for smoother transition
  useEffect(() => {
    if (progress.subMessage) {
      const timer = setTimeout(() => setShowSubMessage(true), 200);
      return () => clearTimeout(timer);
    }
    setShowSubMessage(false);
  }, [progress.subMessage]);

  const currentStepIndex = STEPS.findIndex((s) => s.key === progress.stage);

  const isStepCompleted = (stepKey: SearchStage) => {
    const stepIndex = STEPS.findIndex((s) => s.key === stepKey);
    return currentStepIndex > stepIndex;
  };

  const isStepActive = (stepKey: SearchStage) => {
    return progress.stage === stepKey;
  };

  if (progress.stage === "idle") return null;

  return (
    <div className={`w-full ${className || ""}`}>
      {/* Steps indicator */}
      <div className="mb-4 flex items-center justify-between">
        {STEPS.map((step, idx) => {
          const completed = isStepCompleted(step.key);
          const active = isStepActive(step.key);
          const isLast = idx === STEPS.length - 1;

          return (
            <React.Fragment key={step.key}>
              <div className="flex flex-col items-center">
                {/* Circle */}
                <div
                  className={`
                    flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-all duration-300
                    ${completed
                      ? "bg-brand-500 text-white"
                      : active
                        ? "border-2 border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300"
                        : "border-2 border-gray-200 bg-gray-50 text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-500"
                    }
                  `}
                >
                  {completed ? (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : active ? (
                    <span className="h-2 w-2 animate-pulse rounded-full bg-brand-500" />
                  ) : (
                    <span>{idx + 1}</span>
                  )}
                </div>
                {/* Label */}
                <span
                  className={`
                    mt-1.5 text-[10px] font-medium transition-colors duration-300
                    ${completed || active
                      ? "text-brand-600 dark:text-brand-400"
                      : "text-gray-400 dark:text-gray-500"
                    }
                  `}
                >
                  <span className="hidden sm:inline">{step.label}</span>
                  <span className="sm:hidden">{step.shortLabel}</span>
                </span>
              </div>

              {/* Connector line */}
              {!isLast && (
                <div className="mx-1 h-0.5 flex-1 sm:mx-2">
                  <div
                    className={`
                      h-full rounded-full transition-all duration-500
                      ${completed
                        ? "bg-brand-500"
                        : "bg-gray-200 dark:bg-gray-700"
                      }
                    `}
                  />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Progress bar */}
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-all duration-300 ease-out"
          style={{ width: `${animatedPct}%` }}
        />
        {/* Shimmer effect */}
        {progress.stage !== "complete" && (
          <div
            className="absolute top-0 h-full w-20 animate-shimmer bg-gradient-to-r from-transparent via-white/30 to-transparent"
            style={{ left: `${Math.max(0, animatedPct - 10)}%` }}
          />
        )}
      </div>

      {/* Status message */}
      <div className="mt-3 flex items-center justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {progress.message}
          </p>
          {showSubMessage && progress.subMessage && (
            <p className="mt-0.5 animate-fadeIn text-xs text-gray-500 dark:text-gray-400">
              {progress.subMessage}
            </p>
          )}
        </div>
        <span className="ml-3 text-sm font-semibold tabular-nums text-brand-600 dark:text-brand-400">
          {animatedPct}%
        </span>
      </div>

      {/* Result count badge */}
      {progress.resultCount !== undefined && progress.resultCount > 0 && (
        <div className="mt-2 animate-fadeIn">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Ditemukan {progress.resultCount} hasil
          </span>
        </div>
      )}
    </div>
  );
}
