import React, { Suspense } from "react";
import SearchPageClient from "./SearchPageClient";

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900 sm:p-6">
          <div className="flex min-h-40 items-center justify-center text-sm text-gray-500 dark:text-gray-400">
            Loading...
          </div>
        </div>
      }
    >
      <SearchPageClient />
    </Suspense>
  );
}
