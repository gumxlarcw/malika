"use client";

import React, { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { BORDER, SURFACE, TEXT, TEXT_4 } from "@/lib/surfaceTokens";
import { IndicatorCard } from "./IndicatorCard";
import type { DashboardSummary } from "../_lib/types";

export default function DashboardClient({ summary }: { summary: DashboardSummary | null }) {
  const [query, setQuery] = useState("");

  const categories = useMemo(() => {
    if (!summary) return [];
    const q = query.trim().toLowerCase();
    if (!q) return summary.categories;
    return summary.categories
      .map((c) => ({ ...c, indicators: c.indicators.filter((i) => i.name.toLowerCase().includes(q)) }))
      .filter((c) => c.indicators.length > 0);
  }, [summary, query]);

  if (!summary) {
    return (
      <div className={cn("rounded-2xl border p-6", BORDER, SURFACE)}>
        <h1 className={cn("text-lg font-semibold", TEXT)}>Dashboard</h1>
        <p className={cn("mt-2 text-sm", TEXT_4)}>
          Data dashboard sedang tidak tersedia. Coba muat ulang beberapa saat lagi.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className={cn("text-2xl font-semibold leading-8", TEXT)}>Indikator Strategis</h1>
          <p className={cn("mt-1 text-sm", TEXT_4)}>
            Maluku Utara · {summary.categories.reduce((n, c) => n + c.indicators.length, 0)} indikator
            dari Badan Pusat Statistik
          </p>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari indikator…"
          aria-label="Cari indikator"
          className={cn(
            "h-10 w-full rounded-lg border px-3 text-sm outline-none focus:border-brand-400 md:w-72",
            BORDER,
            SURFACE,
            TEXT
          )}
        />
      </header>

      {summary.headline.length > 0 && !query ? (
        <section aria-label="Angka utama">
          <h2 className={cn("mb-3 text-sm font-semibold uppercase tracking-wide", TEXT_4)}>
            Angka utama
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {summary.headline.map((card) => (
              <IndicatorCard key={`headline-${card.sourceId}`} card={card} />
            ))}
          </div>
        </section>
      ) : null}

      {categories.length === 0 ? (
        <p className={cn("text-sm", TEXT_4)}>Tidak ada indikator yang cocok dengan pencarian.</p>
      ) : (
        categories.map((category) => (
          <section key={category.name} aria-label={category.name}>
            <h2 className={cn("mb-3 text-sm font-semibold uppercase tracking-wide", TEXT_4)}>
              {category.name}
              <span className="ml-2 font-normal normal-case">({category.indicators.length})</span>
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {category.indicators.map((card) => (
                <IndicatorCard key={card.sourceId} card={card} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
