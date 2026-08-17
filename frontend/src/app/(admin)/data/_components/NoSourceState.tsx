import React from "react";
import Link from "next/link";
import EmptyState from "@/components/common/EmptyState";

/**
 * What `/data` shows when it has no dataset to show.
 *
 * The page is a viewer for one indicator, reached from `/kategori` or from
 * search — arriving without a `source_id` is a navigation dead end, not a
 * fault. It used to print "Parameter `source_id` tidak valid.", which reads as
 * a broken page and leaves the reader nowhere to go.
 *
 * The two cases are told apart deliberately: a missing parameter is the reader
 * arriving early and needs a doorway, while a malformed one means a link
 * somewhere is wrong, and saying so is what lets it get reported.
 *
 * The chrome and the `EmptyState` body match the two sibling branches in
 * `page.tsx`. The navigation sits outside it because `EmptyState.action` is an
 * `onClick` button: routing through it would make this whole server component a
 * client one, and turn three crawlable, prefetchable links into script.
 */
export default function NoSourceState({ reason }: { reason: "missing" | "invalid" }) {
  const invalid = reason === "invalid";

  return (
    <div className="min-w-0">
      <h1 className="text-xl font-semibold text-gray-900 dark:text-white/90">Data Statistik</h1>

      <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
        <EmptyState
          variant={invalid ? "error" : "no-data"}
          title={invalid ? "Indikator tidak dikenali" : "Pilih indikator dulu"}
          description={
            invalid
              ? "Tautan yang Anda buka menyebut indikator yang tidak ada."
              : "Halaman ini menampilkan satu indikator sekaligus — tabel per wilayah, tren antar tahun, dan unduhannya."
          }
        />

        <div className="mt-1 flex flex-wrap items-center justify-center gap-2.5">
          <Link
            href="/kategori"
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-500 px-4 text-[13px] font-medium text-white transition-colors hover:bg-brand-600"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="3" width="6" height="6" rx="1.5" />
              <rect x="11" y="3" width="6" height="6" rx="1.5" />
              <rect x="3" y="11" width="6" height="6" rx="1.5" />
              <rect x="11" y="11" width="6" height="6" rx="1.5" />
            </svg>
            Jelajahi kategori
          </Link>

          <Link
            href="/dashboard"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
              <path d="M4 15.5V9M8 15.5V4.5M12 15.5v-4M16 15.5V7" />
            </svg>
            Angka utama
          </Link>
        </div>

        <p className="mt-4 text-center text-[12px] text-gray-400 dark:text-gray-500">
          Atau tanyakan langsung lewat{" "}
          <Link href="/chat" className="font-medium text-brand-500 hover:underline dark:text-brand-400">
            Chat MALIKA
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
