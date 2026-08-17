"use client";

import React, { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { BORDER, MONO, SURFACE, TEXT, TEXT_4, TEXT_5 } from "@/lib/surfaceTokens";
import { IndicatorRow } from "./IndicatorRow";
import type { DashboardCategory } from "../_lib/types";

/**
 * The long tail, as an index rather than a wall of cards.
 *
 * Most indicators have no provincial figure, and an empty column reads as
 * information — "no province-level number for this one" — where an empty card
 * reads as broken. This is the second of the page's two registers: cards carry
 * figures, rows carry everything else.
 */
export function IndicatorIndex({ categories }: { categories: DashboardCategory[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categories;
    return categories
      .map((c) => ({ ...c, indicators: c.indicators.filter((i) => i.name.toLowerCase().includes(q)) }))
      .filter((c) => c.indicators.length > 0);
  }, [categories, query]);

  const total = categories.reduce((n, c) => n + c.indicators.length, 0);

  return (
    <div className="col-span-12 flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-gray-200 pb-2 dark:border-[#2b3648]">
        <h2 className={cn("text-xs font-semibold uppercase tracking-[0.08em]", TEXT_4)}>
          Indeks indikator
          <span className={cn("ml-2 font-normal tabular-nums", MONO, TEXT_5)}>{total}</span>
        </h2>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari indikator…"
          aria-label="Cari indikator"
          className={cn(
            "h-9 w-full rounded-lg border px-3 text-sm outline-none focus:border-brand-400 md:w-72",
            BORDER,
            SURFACE,
            TEXT
          )}
        />
      </div>

      {filtered.length === 0 ? (
        <p className={cn("text-sm", TEXT_4)}>Tidak ada indikator yang cocok dengan pencarian.</p>
      ) : (
        filtered.map((category) => (
          <section key={category.name} aria-label={category.name}>
            <div className={cn("mb-1 flex items-baseline justify-between gap-4 border-b pb-2", BORDER)}>
              <h3 className={cn("text-xs font-semibold uppercase tracking-[0.08em]", TEXT_4)}>{category.name}</h3>
              <span className={cn("text-xs tabular-nums", MONO, TEXT_5)}>{category.indicators.length}</span>
            </div>
            <div>
              {category.indicators.map((card) => (
                <IndicatorRow key={card.sourceId} card={card} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
