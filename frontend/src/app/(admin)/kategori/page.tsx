import type { Metadata } from "next";
import React, { Suspense } from "react";
import KategoriPageClient from "./KategoriPageClient";

export const metadata: Metadata = {
  title: "Kategori Data | MALIKA",
  description:
    "Jelajahi data statistik berdasarkan kategori - Pertanian, Ekonomi, Pendidikan, Kesehatan, dan lainnya.",
};

export const dynamic = "force-dynamic";

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <div className="h-7 w-64 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        <div className="mt-2 h-4 w-48 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-2xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900"
          />
        ))}
      </div>
    </div>
  );
}

export default function KategoriPage() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <KategoriPageClient />
    </Suspense>
  );
}
