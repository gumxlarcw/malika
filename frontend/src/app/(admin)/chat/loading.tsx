import React from "react";

export default function ChatLoading() {
  return (
    <div className="flex h-full w-full overflow-hidden bg-white dark:bg-gray-900">
      {/* Sidebar skeleton - hidden on mobile */}
      <div className="hidden lg:flex w-[320px] flex-col border-r border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="space-y-1">
            <div className="h-4 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
            <div className="h-3 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
          </div>
          <div className="h-8 w-20 animate-pulse rounded-lg bg-brand-200 dark:bg-brand-900/50" />
        </div>
        <div className="space-y-2 mt-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-3/4 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                </div>
                <div className="h-3 w-10 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* Chat area skeleton */}
      <div className="flex flex-1 flex-col">
        {/* Header skeleton */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 animate-pulse rounded bg-gray-200 dark:bg-gray-800 lg:hidden" />
            <div className="space-y-1">
              <div className="h-4 w-28 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
              <div className="h-3 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-8 w-16 animate-pulse rounded-lg bg-brand-200 dark:bg-brand-900/50 lg:hidden" />
            <div className="h-8 w-20 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-800" />
          </div>
        </div>
        {/* Messages skeleton */}
        <div className="flex-1 flex flex-col justify-end p-4">
          <div className="flex justify-end mb-3">
            <div className="max-w-[70%] rounded-2xl bg-brand-500/10 dark:bg-brand-900/30 px-4 py-3">
              <div className="h-3 w-24 animate-pulse rounded bg-brand-300/50 dark:bg-brand-700/50" />
            </div>
          </div>
          <div className="flex justify-start mb-3">
            <div className="max-w-[70%] rounded-2xl bg-gray-100 dark:bg-gray-800 px-4 py-3 space-y-2">
              <div className="h-3 w-40 animate-pulse rounded bg-gray-300 dark:bg-gray-700" />
              <div className="h-3 w-32 animate-pulse rounded bg-gray-300 dark:bg-gray-700" />
              <div className="h-3 w-20 animate-pulse rounded bg-gray-300 dark:bg-gray-700" />
            </div>
          </div>
          <div className="flex justify-end mb-3">
            <div className="max-w-[70%] rounded-2xl bg-brand-500/10 dark:bg-brand-900/30 px-4 py-3">
              <div className="h-3 w-20 animate-pulse rounded bg-brand-300/50 dark:bg-brand-700/50" />
            </div>
          </div>
          <div className="flex justify-start">
            <div className="max-w-[70%] rounded-2xl bg-gray-100 dark:bg-gray-800 px-4 py-3 space-y-2">
              <div className="h-3 w-36 animate-pulse rounded bg-gray-300 dark:bg-gray-700" />
              <div className="h-3 w-28 animate-pulse rounded bg-gray-300 dark:bg-gray-700" />
            </div>
          </div>
        </div>
        {/* Composer skeleton */}
        <div className="border-t border-gray-200 dark:border-gray-700 p-3">
          <div className="h-10 w-full animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
        </div>
      </div>
    </div>
  );
}
