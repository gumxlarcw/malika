"use client";

import React from "react";
import Link from "next/link";
import MiniSparkline from "@/components/chat/MiniSparkline";
import { cn } from "@/lib/utils";
import {
  BORDER,
  BRAND_TEXT,
  CARD_HOVER,
  MONO,
  SURFACE,
  TEXT,
  TEXT_4,
  TEXT_5,
} from "@/lib/surfaceTokens";
import { formatDelta, formatValue, parseUnit } from "../_lib/format";
import type { IndicatorCardData } from "../_lib/types";

function Unit({ unit }: { unit: string | null }) {
  const parts = parseUnit(unit);
  if (!parts.length) return null;
  return (
    <span className={cn("ml-1 text-sm font-normal", TEXT_4)}>
      {parts.map((p, i) => (p.sup ? <sup key={i}>{p.text}</sup> : <span key={i}>{p.text}</span>))}
    </span>
  );
}

export function IndicatorCard({ card }: { card: IndicatorCardData }) {
  const delta = formatDelta(card.trend.delta, card.decimalPlaces);
  const href = card.shape === "regional" ? "/peta-tematik" : `/data?source=${card.sourceId}`;

  return (
    <Link
      href={href}
      className={cn("flex flex-col gap-3 rounded-2xl border p-5", BORDER, SURFACE, CARD_HOVER)}
    >
      <span className={cn("line-clamp-2 text-sm font-medium leading-5", TEXT)}>{card.name}</span>

      {card.error ? (
        <span className={cn("text-sm", TEXT_5)}>Data tidak tersedia</span>
      ) : card.shape === "province" && card.latest ? (
        <>
          <span className="flex items-baseline">
            <span className={cn("text-2xl font-medium leading-8", MONO, TEXT)}>
              {formatValue(card.latest.value, card.decimalPlaces)}
            </span>
            <Unit unit={card.unit} />
          </span>
          <span className="flex flex-wrap items-center gap-2">
            {delta ? (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  delta.direction === "up"
                    ? "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400"
                    : delta.direction === "down"
                      ? "bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-400"
                      : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                )}
              >
                {delta.direction === "up" ? "▲" : delta.direction === "down" ? "▼" : "="} {delta.text}
              </span>
            ) : null}
            <span className={cn("text-xs", TEXT_4)}>{card.latest.periodLabel}</span>
          </span>
          {card.trend.points.length > 1 ? (
            <MiniSparkline
              values={card.trend.points.map((p) => p.value)}
              labels={card.trend.points.map((p) => p.periodLabel)}
              width={180}
              height={36}
              showArea
            />
          ) : null}
        </>
      ) : (
        <>
          <span className={cn("text-sm", TEXT_4)}>
            {card.shape === "regional"
              ? "Tersedia per kabupaten/kota"
              : card.dimKey
                ? `Rincian menurut ${card.dimKey}`
                : "Rincian tersedia"}
          </span>
          <span className={cn("text-xs", TEXT_5)}>{card.periodCount} periode</span>
        </>
      )}

      <span className={cn("mt-auto text-xs font-medium", BRAND_TEXT)}>
        {card.shape === "regional" ? "Lihat peta" : "Lihat data"}
      </span>
    </Link>
  );
}
