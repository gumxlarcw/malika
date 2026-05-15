import type { Metadata } from "next";
import React, { Suspense } from "react";
import ArchiveBrowser from "@/components/archive/ArchiveBrowser";
import LoadingProgressBar from "@/components/LoadingProgressBar";

export const metadata: Metadata = {
  title: "Publikasi",
  description: "Publikasi",
};

export default function PublikasiPage() {
  return (
    <Suspense
      fallback={<LoadingProgressBar className="mt-4" label="Loading" />}
    >
      <ArchiveBrowser defaultKind="publication" />
    </Suspense>
  );
}
