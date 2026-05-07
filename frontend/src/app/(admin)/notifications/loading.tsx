import React from "react";

export default function NotificationsLoading() {
  return (
    <div className="space-y-6">
      <div>
        <div className="h-8 w-48 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
        <div className="mt-2 h-4 w-64 animate-pulse rounded bg-gray-100 dark:bg-gray-800/50" />
      </div>
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
          >
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-3/4 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
