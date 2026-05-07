import type { Metadata } from "next";
import React, { Suspense } from "react";
import BRSCard from "@/components/brs/BRSCard";
import LoadingProgressBar from "@/components/LoadingProgressBar";

export const metadata: Metadata = {
  title: "Berita Resmi Statistik",
  description: "Berita Resmi Statistik",
};

export default function BeritaResmiStatistikPage() {
  return (
    <div className="min-w-0">
      <h1 className="text-xl font-semibold text-gray-900 dark:text-white/90">
        Berita Resmi Statistik
      </h1>

      <div className="mt-6">
        <Suspense
          fallback={
            <LoadingProgressBar className="mt-4" label="Loading" />
          }
        >
          <BRSCard />
        </Suspense>
      </div>
    </div>
  );
}
