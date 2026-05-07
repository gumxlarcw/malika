import React from "react";

export default function DashboardLoading() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="h-12 w-12 animate-spin rounded-full border-3 border-gray-200 border-t-brand-500 dark:border-gray-700 dark:border-t-brand-400" />
        <p className="text-sm text-gray-500 dark:text-gray-400">Memuat Dashboard...</p>
      </div>
    </div>
  );
}
