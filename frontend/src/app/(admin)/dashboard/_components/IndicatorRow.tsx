"use client";

import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { BORDER, MONO, TEXT, TEXT_2, TEXT_4, TEXT_5 } from "@/lib/surfaceTokens";
import { formatValue, parseUnit } from "../_lib/format";
import type { IndicatorCardData } from "../_lib/types";

/**
 * One line of the indicator index.
 *
 * Rows, not cards, for the long tail. Most indicators have no provincial figure,
 * and an empty column reads as information — "no province-level number for this
 * one" — where an empty card reads as broken. Aligned columns also let the eye
 * scan the period down the page, which is what a statistics reader checks first.
 */
export function IndicatorRow({ card }: { card: IndicatorCardData }) {
  // `source_id`, not `source` — /data reads `searchParams.source_id` and renders
  // "Parameter `source_id` tidak valid" for anything else.
  const href = card.shape === "regional" ? "/peta-tematik" : `/data?source_id=${card.sourceId}`;
  const unit = parseUnit(card.unit);

  return (
    <Link
      href={href}
      className={cn(
        "group grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-1 border-b px-1 py-2.5 transition-colors duration-100 last:border-b-0 hover:bg-brand-25 dark:hover:bg-[#141a33]",
        BORDER,
        "sm:grid-cols-[1fr_7rem_9rem]"
      )}
    >
      <span className={cn("text-sm leading-5", TEXT_2, "group-hover:text-brand-600 dark:group-hover:text-brand-300")}>
        {card.name}
        {card.metricLabel ? (
          <span className={cn("ml-2 text-[11px]", MONO, TEXT_5)}>{card.metricLabel}</span>
        ) : null}
      </span>

      {/* Figure column — deliberately empty when the source has no province row. */}
      <span className={cn("text-sm tabular-nums sm:text-right", MONO, card.latest ? TEXT : TEXT_5)}>
        {card.latest ? (
          <>
            {formatValue(card.latest.value, card.decimalPlaces)}
            {unit.length ? (
              <span className={cn("ml-1 text-xs", TEXT_5)}>
                {unit.map((p, i) => (p.sup ? <sup key={i}>{p.text}</sup> : <span key={i}>{p.text}</span>))}
              </span>
            ) : null}
          </>
        ) : (
          "—"
        )}
      </span>

      {/* Period stamp, or what the row offers instead of a figure. */}
      <span className={cn("hidden text-xs tabular-nums sm:block sm:text-right", MONO, TEXT_5)}>
        {card.latest
          ? card.latest.periodLabel
          : card.shape === "regional"
            ? "per kab/kota"
            : `${card.periodCount} periode`}
      </span>
    </Link>
  );
}
