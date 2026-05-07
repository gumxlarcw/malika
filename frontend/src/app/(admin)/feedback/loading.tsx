import React from "react";

export default function FeedbackLoading() {
  return (
    <div className="space-y-6">
      <div>
        <div className="h-8 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
        <div className="mt-2 h-4 w-56 animate-pulse rounded bg-gray-100 dark:bg-gray-800/50" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <div className="space-y-3">
            <div className="h-5 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            <div className="flex justify-center gap-2 py-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-10 w-10 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700" />
              ))}
            </div>
            <div className="h-24 w-full animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
            <div className="h-10 w-full animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <div className="space-y-3">
            <div className="h-5 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 w-full animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
