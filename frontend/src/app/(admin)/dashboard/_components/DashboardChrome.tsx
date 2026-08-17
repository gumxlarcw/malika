"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { BORDER, BRAND_BORDER, BRAND_TEXT, MONO, SURFACE, SURFACE_2, SURFACE_BRAND, TEXT, TEXT_4, TEXT_5 } from "@/lib/surfaceTokens";
import { TABS, type TabKey } from "../_lib/tabs";

/**
 * Page chrome: identity, tabs, and the two actions that do something here.
 *
 * The source design carried a full application header — logo, breadcrumb,
 * theme toggle, notification and account controls. All of those already exist
 * one level up in the admin shell, so reproducing them would give the page two
 * of each. What is left is what belongs to the dashboard itself.
 */

function formatStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jayapura",
  }).format(d);
}

export function DashboardChrome({
  tab,
  onTab,
  generatedAt,
  indicatorCount,
  onRefresh,
  onShare,
  refreshing,
}: {
  tab: TabKey;
  onTab: (tab: TabKey) => void;
  generatedAt: string;
  indicatorCount: number;
  onRefresh: () => void;
  onShare: () => void;
  refreshing: boolean;
}) {
  const stamp = formatStamp(generatedAt);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className={cn("text-xl font-semibold leading-8 tracking-tight sm:text-2xl", TEXT)}>
              Indikator Strategis
            </h1>
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold leading-[18px]",
                SURFACE_BRAND,
                BRAND_BORDER,
                BRAND_TEXT
              )}
            >
              Dasbor resmi
            </span>
          </div>
          <p className={cn("text-xs leading-5 sm:text-sm", TEXT_4)}>
            Maluku Utara · {indicatorCount} indikator dari Badan Pusat Statistik
            {stamp ? <> · dimuat {stamp} WIT</> : null}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Muat ulang data"
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-lg border transition-colors hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-800",
              BORDER,
              SURFACE,
              TEXT_4
            )}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={refreshing ? "animate-spin" : undefined}
              aria-hidden
            >
              <path d="M16.5 8.4A6.8 6.8 0 004.6 5.7M3.5 11.6a6.8 6.8 0 0011.9 2.7" />
              <path d="M15.6 3.6v4.6h-4.6M4.4 16.4v-4.6h4.6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onShare}
            aria-label="Salin tautan dasbor"
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-lg border transition-colors hover:bg-gray-100 dark:hover:bg-gray-800",
              BORDER,
              SURFACE,
              TEXT_4
            )}
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="15" cy="4.8" r="2.3" />
              <circle cx="5" cy="10" r="2.3" />
              <circle cx="15" cy="15.2" r="2.3" />
              <path d="M7 8.9l6-2.9M7 11.1l6 2.9" />
            </svg>
          </button>
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Kelompok indikator"
        className={cn("flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border p-1", BORDER, SURFACE_2)}
      >
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onTab(t.key)}
              className={cn(
                "h-8 whitespace-nowrap rounded-lg px-3.5 text-[13px] transition-colors",
                active ? cn("font-semibold shadow-theme-xs", SURFACE, TEXT) : cn("font-medium", TEXT_4)
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Monospace meta line describing what the current filters actually select. */
export function FilterSummary({ children }: { children: React.ReactNode }) {
  return <span className={cn("text-[11px] leading-[18px]", MONO, TEXT_5)}>{children}</span>;
}
