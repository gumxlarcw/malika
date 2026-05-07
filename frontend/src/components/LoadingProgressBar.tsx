"use client";

import React, { useEffect, useState } from "react";

type Props = {
  label?: string;
  className?: string;
  done?: boolean;
  variant?: "simulated" | "indeterminate";
  duration?: number; // milliseconds for simulated progress
};

export default function LoadingProgressBar({
  label = "Loading",
  className,
  done = false,
  variant = "simulated",
  duration = 900, // default duration in ms
}: Props) {
  const [pct, setPct] = useState(8);

  useEffect(() => {
    if (variant === "indeterminate") return;
    if (done) {
      setPct(100);
      return;
    }

    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      // Simulated progress that feels responsive without getting stuck at 95%.
      // It asymptotically approaches 99% until `done` flips true.
      const eased = 1 - Math.exp(-elapsed / duration);
      const next = Math.min(99, Math.round(8 + eased * 91));
      setPct((p) => (next > p ? next : p));
    }, 80);

    return () => window.clearInterval(interval);
  }, [done, variant, duration]);

  if (variant === "indeterminate") {
    return (
      <div className={`flex min-h-40 w-full items-center justify-center ${className || ""}`.trim()}>
        <div className="flex flex-col items-center justify-center gap-3 py-8">
          <span className="h-7 w-7 animate-spin rounded-full border-2 border-gray-200 border-t-gray-700 dark:border-gray-800 dark:border-t-gray-200" />
          <div className="text-theme-sm text-gray-500 dark:text-gray-400">{label}</div>
        </div>
      </div>
    );
  }

  const size = 56;
  const strokeWidth = 6;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedPct = Math.max(0, Math.min(100, pct));
  const dashOffset = circumference * (1 - clampedPct / 100);

  return (
    <div className={`flex min-h-40 w-full items-center justify-center ${className || ""}`.trim()}>
      <div className="flex flex-col items-center justify-center gap-3 py-8">
        <div className="relative" style={{ width: size, height: size }}>
          <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            className="block"
          >
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              strokeWidth={strokeWidth}
              className="stroke-gray-200 dark:stroke-gray-800"
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              className="stroke-gray-900 transition-[stroke-dashoffset] duration-200 dark:stroke-white"
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          </svg>

          <div className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-gray-700 dark:text-gray-200">
            {clampedPct}%
          </div>
        </div>

        <div className="text-theme-sm text-gray-500 dark:text-gray-400">{label}</div>
      </div>
    </div>
  );
}
