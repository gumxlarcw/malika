import React, { Suspense } from "react";
import KategoriDetailClient from "./KategoriDetailClient";

export const dynamic = "force-dynamic";

// Generate metadata dynamically based on the slug
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // Convert slug back to a more readable format for the title
  const title = slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  return {
    title: `${title} | Kategori Data | MALIKA`,
    description: `Data statistik kategori ${title} - Maluku Utara dalam Angka`,
  };
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <div className="h-4 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        <span className="text-gray-300">/</span>
        <div className="h-4 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
      </div>
      <div className="flex items-center gap-4">
        <div className="h-14 w-14 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700" />
        <div>
          <div className="h-6 w-48 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          <div className="mt-2 h-4 w-24 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
        </div>
      </div>
      <div className="space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900"
          />
        ))}
      </div>
    </div>
  );
}

export default function KategoriDetailPage() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <KategoriDetailClient />
    </Suspense>
  );
}
