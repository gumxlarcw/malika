import type { Metadata } from "next";
import React, { Suspense } from "react";
import ArchiveBrowser from "@/components/archive/ArchiveBrowser";
import LoadingProgressBar from "@/components/LoadingProgressBar";

export const metadata: Metadata = {
  title: "Berita Resmi Statistik",
  description: "Berita Resmi Statistik",
};

export default function BeritaResmiStatistikPage() {
  return (
    <Suspense
      fallback={<LoadingProgressBar className="mt-4" label="Loading" />}
    >
      <ArchiveBrowser defaultKind="report" />
    </Suspense>
  );
}
