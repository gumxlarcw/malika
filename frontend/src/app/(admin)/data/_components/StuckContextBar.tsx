"use client";

import React, { useEffect, useState } from "react";
import {
  asSourceType,
  SOURCE_TYPE_PALETTE,
  type SourceType,
} from "../_lib/sourceTypePalette";

const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

export default function StuckContextBar({
  sourceName,
  sourceType,
  selectedYear,
  monthNo,
  geo,
  geoApplied,
  onCopyLink,
  onDownload,
}: {
  sourceName: string;
  sourceType: SourceType;
  selectedYear: string;
  monthNo: number | null;
  geo: string | null;
  geoApplied: boolean;
  onCopyLink: () => void;
  onDownload: () => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Show the bar once the user has scrolled past the hero region (~140px down).
    // The scroll container is the (admin) layout's <main>, not document — find it.
    const main = document.querySelector("main");
    const target: HTMLElement | Window = main ?? window;
    const onScroll = () => {
      const top = target instanceof Window ? window.scrollY : (target as HTMLElement).scrollTop;
      setVisible(top > 160);
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => target.removeEventListener("scroll", onScroll);
  }, []);

  const stype = SOURCE_TYPE_PALETTE[asSourceType(sourceType)];

  return (
    <div
      aria-hidden={!visible}
      // Offsets track the site header (60px, 68px from `md`) and the shell's
      // gutters. They were 76/89 and -mx-4/-mx-6 for the old sidebar shell.
      className={`sticky top-[60px] z-30 -mx-[18px] transition-all duration-200 md:-mx-8 md:top-[68px] ${
        visible ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-2 opacity-0"
      }`}
    >
      <div className="flex items-center gap-3 border-b border-gray-200/60 bg-white/85 px-[18px] py-2.5 backdrop-blur-md dark:border-gray-800/60 dark:bg-gray-900/85 md:px-8">
        <span className="h-5 w-1 shrink-0 rounded" style={{ background: stype.bar }} aria-hidden />
        <div className="min-w-0 flex-1 truncate text-[12px] font-semibold text-gray-900 dark:text-white md:text-[13px]">
          {sourceName}
        </div>
        <span className="shrink-0 rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-gray-700 dark:bg-gray-800 dark:text-gray-200">
          {selectedYear}
        </span>
        {geo && geoApplied && (
          <span className="hidden shrink-0 items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700 dark:bg-gray-800 dark:text-gray-300 sm:inline-flex">
            📍 {geo}
          </span>
        )}
        {monthNo && (
          <span className="hidden shrink-0 rounded-md bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 sm:inline">
            {MONTHS[monthNo - 1]}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onCopyLink}
            className="hidden rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800 md:inline-block"
          >
            Salin tautan
          </button>
          <button
            type="button"
            onClick={onDownload}
            className="rounded-md px-2 py-1 text-[11px] font-medium text-white shadow-sm transition-[filter] hover:brightness-110"
            style={{ background: stype.bar }}
          >
            Unduh
          </button>
        </div>
      </div>
    </div>
  );
}
