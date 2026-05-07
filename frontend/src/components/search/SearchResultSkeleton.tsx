"use client";

import React from "react";

/**
 * Skeleton card for search result items.
 * Shows a shimmer animation while loading.
 */
export function SearchResultCardSkeleton() {
  return (
    <div className="flex w-72 flex-shrink-0 flex-col rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      {/* Avatar placeholder */}
      <div className="mb-3 flex justify-center">
        <div className="h-12 w-12 animate-pulse rounded-full bg-gray-200 dark:bg-gray-800" />
      </div>
      
      {/* Title placeholder */}
      <div className="space-y-2">
        <div className="h-4 w-full animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
        <div className="h-4 w-3/4 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
      </div>
      
      {/* Subtitle placeholder */}
      <div className="mt-3">
        <div className="h-3 w-1/2 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
      </div>
      
      {/* Button placeholder */}
      <div className="mt-4">
        <div className="h-9 w-full animate-pulse rounded-lg bg-gray-200 dark:bg-gray-800" />
      </div>
    </div>
  );
}

/**
 * Skeleton row for search results - shows 3-4 skeleton cards
 */
export function SearchResultRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="mt-4 flex gap-4 overflow-hidden">
      {Array.from({ length: count }).map((_, i) => (
        <SearchResultCardSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * Skeleton for table data preview
 */
export function TablePreviewSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800">
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-white dark:bg-gray-900">
            <tr className="border-b border-gray-200 dark:border-gray-800">
              {Array.from({ length: cols }).map((_, i) => (
                <th key={i} className="px-4 py-3">
                  <div className="h-4 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, rowIdx) => (
              <tr key={rowIdx} className="border-b border-gray-100 dark:border-gray-800">
                {Array.from({ length: cols }).map((_, colIdx) => (
                  <td key={colIdx} className="px-4 py-3">
                    <div 
                      className="h-4 animate-pulse rounded bg-gray-200 dark:bg-gray-800" 
                      style={{ width: `${60 + Math.random() * 40}%` }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Skeleton for quick result header info
 */
export function QuickResultHeaderSkeleton() {
  return (
    <div className="space-y-2">
      <div className="h-3 w-48 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
      <div className="h-3 w-64 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
    </div>
  );
}

/**
 * Skeleton for interpretation panel loading
 */
export function InterpretationSkeleton() {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-2">
          <div className="h-4 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
          <div className="h-3 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
        </div>
        <div className="h-5 w-16 animate-pulse rounded-full bg-gray-200 dark:bg-gray-800" />
      </div>
      
      {/* Headline */}
      <div className="mt-4 space-y-2">
        <div className="h-4 w-full animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
        <div className="h-4 w-3/4 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
      </div>
      
      {/* Bullet points */}
      <div className="mt-4 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="mt-1 h-4 w-4 flex-shrink-0 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
            <div className="flex-1 space-y-1">
              <div className="h-3 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
              <div className="h-3 w-full animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Skeleton for chart loading
 */
export function ChartSkeleton({ height = 300 }: { height?: number }) {
  return (
    <div 
      className="flex items-center justify-center rounded-2xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-800/50"
      style={{ height }}
    >
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-gray-600 dark:border-gray-700 dark:border-t-gray-300" />
        <div className="text-sm text-gray-500 dark:text-gray-400">Memuat grafik...</div>
      </div>
    </div>
  );
}
