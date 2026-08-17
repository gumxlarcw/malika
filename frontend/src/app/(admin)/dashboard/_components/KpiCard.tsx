"use client";

import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { BORDER, MONO, SURFACE, SURFACE_2, TEXT, TEXT_3, TEXT_4, TEXT_5 } from "@/lib/surfaceTokens";
import { formatDelta, formatValue, parseUnit } from "../_lib/format";
import { sparkPath } from "../_lib/chart";
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
    <span className={cn("text-sm", TEXT_5)}>
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
  if (n <= 7) return "text-[30px] leading-9";
  if (n <= 10) return "text-[26px] leading-8";
  if (n <= 14) return "text-[21px] leading-7";
  if (n <= 18) return "text-[17px] leading-6";
  return "text-[14px] leading-5";
}

export function KpiCard({
  card,
  onExpand,
}: {
  card: IndicatorCardData;
  onExpand?: (card: IndicatorCardData) => void;
}) {
  const delta = formatDelta(card.trend.delta, card.decimalPlaces);
  const figure = card.latest ? formatValue(card.latest.value, card.decimalPlaces) : null;
  const href = card.shape === "regional" ? "/peta-tematik" : `/data?source=${card.sourceId}`;
  const values = card.trend.points.map((p) => p.value);

  return (
    <article
      className={cn(
        // h-full so a two-line title does not leave its neighbours short; the
        // period footer is pushed to the bottom so all four align on one line.
        "flex h-full flex-col gap-3.5 rounded-2xl border p-[18px] shadow-theme-xs transition-colors duration-150 hover:border-brand-300 dark:hover:border-brand-500/60",
        BORDER,
        SURFACE
      )}
    >
      <div className="flex items-start justify-between gap-2.5">
        <Link
          href={href}
          className={cn(
            "line-clamp-2 min-w-0 text-sm leading-5 transition-colors hover:text-brand-600 dark:hover:text-brand-300",
            TEXT_4
          )}
        >
          {card.name}
        </Link>
        {onExpand && card.trend.points.length > 0 ? (
          <button
            type="button"
            onClick={() => onExpand(card)}
            aria-label={`Lihat rincian ${card.name}`}
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-gray-100 dark:hover:bg-gray-800",
              TEXT_5
            )}
          >
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 3.5h4.5V8M8 16.5H3.5V12M16.5 3.5L11 9M3.5 16.5L9 11" />
            </svg>
          </button>
        ) : null}
      </div>

      {/* Several measures exist for this indicator; say which one this is. */}
      {card.metricLabel ? (
        <span className={cn("-mt-2 text-[11px] uppercase tracking-wide", MONO, TEXT_5)}>{card.metricLabel}</span>
      ) : null}

      {figure == null ? (
        <span className={cn("text-sm", TEXT_5)}>Angka provinsi tidak tersedia</span>
      ) : (
        <>
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span
              data-figure
              className={cn("font-semibold tracking-tight tabular-nums break-all", figureSizeClass(figure), MONO, TEXT)}
            >
              {figure}
            </span>
            <Unit unit={card.unit} />
          </div>

          <div className="flex items-center justify-between gap-2.5">
            {delta ? (
              /*
               * Deliberately not colour-coded good/bad. Direction alone does not
               * carry a verdict across indicators — TPT falling is good news,
               * inflation falling can be bad — and MALIKA holds no polarity flag
               * to tell them apart, so a green arrow would be an editorial claim
               * the data does not support. The arrow states direction; the
               * reader supplies the judgement.
               */
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
                  MONO,
                  SURFACE_2,
                  TEXT_3
                )}
              >
                {delta.direction === "up" ? "↑" : delta.direction === "down" ? "↓" : "="} {delta.text}
              </span>
            ) : (
              <span />
            )}

            {values.length > 1 ? (
              <svg width="88" height="30" viewBox="0 0 88 30" fill="none" className="shrink-0" aria-hidden>
                <path d={sparkPath(values, true)} className="fill-brand-500/10" />
                <path
                  d={sparkPath(values, false)}
                  className="stroke-brand-500"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
            ) : null}
          </div>

          <span className={cn("mt-auto border-t pt-2.5 text-xs leading-[18px]", BORDER, TEXT_5)}>
            {card.latest?.periodLabel}
            {card.trend.delta ? ` · sebelumnya ${card.trend.delta.previousLabel}` : null}
          </span>
        </>
      )}
    </article>
  );
}
