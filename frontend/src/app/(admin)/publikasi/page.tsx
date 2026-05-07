import type { Metadata } from "next";
import React, { Suspense } from "react";
import PublikasiCard from "@/components/publikasi/PublikasiCard";
import LoadingProgressBar from "@/components/LoadingProgressBar";

export const metadata: Metadata = {
  title: "Publikasi",
  description: "Publikasi",
};

export default function PublikasiPage() {
  return (
    <div className="min-w-0">
      <h1 className="text-xl font-semibold text-gray-900 dark:text-white/90">
        Publikasi
      </h1>

      <div className="mt-6">
        <Suspense
          fallback={
            <LoadingProgressBar className="mt-4" label="Loading" />
          }
        >
          <PublikasiCard />
        </Suspense>
      </div>
    </div>
  );
}
