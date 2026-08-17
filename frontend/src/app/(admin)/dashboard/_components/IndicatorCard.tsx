"use client";

import React from "react";
import Link from "next/link";
import MiniSparkline from "@/components/chat/MiniSparkline";
import { cn } from "@/lib/utils";
import { BORDER, MONO, SURFACE, TEXT, TEXT_4, TEXT_5 } from "@/lib/surfaceTokens";
import { formatDelta, formatValue, parseUnit } from "../_lib/format";
import type { IndicatorCardData } from "../_lib/types";

/**
 * Headline figure — the page's thesis, used only for the curated few.
 *
 * Everything else is an IndicatorRow. A card is a container for a value, and
 * most indicators have no provincial figure to put in one; giving them cards
 * produced a screen of bordered boxes reading "Rincian tersedia".
 */

function Unit({ unit }: { unit: string | null }) {
  const parts = parseUnit(unit);
  if (!parts.length) return null;
  return (
    <span className={cn("ml-1.5 text-base font-normal", TEXT_4)}>
      {parts.map((p, i) => (p.sup ? <sup key={i}>{p.text}</sup> : <span key={i}>{p.text}</span>))}
    </span>
  );
}

/**
 * Figures range from "0,299" to "1.525.405.628.617,00". Official statistics must
 * stay exact, so long values are never truncated or abbreviated — the type scales
 * down instead and the number is always readable in full.
 */
function figureSizeClass(text: string): string {
  const n = text.length;
  if (n <= 7) return "text-[38px]";
  if (n <= 10) return "text-[30px]";
  if (n <= 14) return "text-[23px]";
  if (n <= 18) return "text-[18px]";
  return "text-[15px]";
}

export function IndicatorCard({ card }: { card: IndicatorCardData }) {
  const delta = formatDelta(card.trend.delta, card.decimalPlaces);
  const figure = card.latest ? formatValue(card.latest.value, card.decimalPlaces) : "";
  const href = card.shape === "regional" ? "/peta-tematik" : `/data?source=${card.sourceId}`;

  return (
    <Link
      href={href}
      className={cn(
        "group flex flex-col gap-4 rounded-2xl border p-6 transition-colors duration-150 hover:border-brand-300 dark:hover:border-brand-500/60",
        BORDER,
        SURFACE
      )}
    >
      <span className="flex flex-col gap-0.5">
        <span className={cn("line-clamp-2 text-sm leading-5", TEXT_4)}>{card.name}</span>
        {/* Several measures exist for this indicator; say which one this is. */}
        {card.metricLabel ? (
          <span className={cn("text-[11px] uppercase tracking-wide", MONO, TEXT_5)}>{card.metricLabel}</span>
        ) : null}
      </span>

      {card.error || !card.latest ? (
        <span className={cn("text-sm", TEXT_5)}>Angka provinsi tidak tersedia</span>
      ) : (
        <>
          {/* The figure is the point of the card, so it gets the weight. */}
          <span className="flex min-w-0 flex-wrap items-baseline">
            <span
              data-figure
              className={cn(
                "font-medium leading-none tabular-nums break-all",
                figureSizeClass(figure),
                MONO,
                TEXT
              )}
            >
              {figure}
            </span>
            <Unit unit={card.unit} />
          </span>

          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {delta ? (
              <span
                className={cn(
                  "text-sm font-medium tabular-nums break-all",
                  MONO,
                  delta.direction === "up"
                    ? "text-success-700 dark:text-success-400"
                    : delta.direction === "down"
                      ? "text-error-700 dark:text-error-400"
                      : TEXT_4
                )}
              >
                {delta.direction === "up" ? "▲" : delta.direction === "down" ? "▼" : "="} {delta.text}
              </span>
            ) : null}
            {/* Period stamp: the thing a statistics reader checks first. */}
            <span className={cn("text-xs tabular-nums", MONO, TEXT_5)}>{card.latest.periodLabel}</span>
          </span>

          {card.trend.points.length > 1 ? (
            <MiniSparkline
              values={card.trend.points.map((p) => p.value)}
              width={220}
              height={40}
              showArea
              bare
            />
          ) : null}
        </>
      )}
    </Link>
  );
}
