"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { MONO, TEXT_3, TEXT_5 } from "@/lib/surfaceTokens";
import { PLOT, TICK_FRACTIONS, linePath, scaleOf, tickValues, tickY } from "../_lib/chart";
import { formatValue } from "../_lib/format";
import { Panel, PanelAction, PanelEmpty, ExpandIcon } from "./Panel";
import type { IndicatorCardData } from "../_lib/types";

/**
 * The tab's lead series over time.
 *
 * A single line, not the two the source design showed. Its second series was a
 * national comparator, and MALIKA replicates Maluku Utara only — drawing a
 * national line would mean inventing one. The period axis carries the
 * comparison instead.
 */
export function TrendCard({
  card,
  showGridLines = true,
  onExpand,
}: {
  card: IndicatorCardData | null;
  showGridLines?: boolean;
  onExpand?: (card: IndicatorCardData) => void;
}) {
  const points = card?.trend.points ?? [];
  const values = points.map((p) => p.value);
  const scale = scaleOf(values);
  const ticks = tickValues(scale);

  return (
    <Panel
      title={card ? card.name : "Perkembangan indikator"}
      subtitle={
        card
          ? `${points.length} periode terakhir${card.metricLabel ? ` · ${card.metricLabel}` : ""}`
          : undefined
      }
      className="col-span-12 xl:col-span-8"
      actions={
        card && onExpand ? (
          <PanelAction label={`Lihat rincian ${card.name}`} onClick={() => onExpand(card)}>
            <ExpandIcon />
          </PanelAction>
        ) : null
      }
    >
      {values.length < 2 ? (
        <PanelEmpty>Belum ada deret waktu provinsi untuk indikator ini.</PanelEmpty>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
            width="100%"
            className="block h-auto overflow-visible"
            role="img"
            aria-label={`Grafik ${card?.name}`}
          >
            {showGridLines
              ? TICK_FRACTIONS.map((_, i) => (
                  <line
                    key={i}
                    x1={PLOT.left}
                    y1={tickY(i)}
                    x2={PLOT.width}
                    y2={tickY(i)}
                    className="stroke-gray-200 dark:stroke-[#2b3648]"
                    strokeWidth="1"
                  />
                ))
              : null}

            <g className="fill-gray-400 dark:fill-[#7d8799]" fontSize="11" textAnchor="end">
              {ticks.map((v, i) => (
                <text key={i} x={PLOT.left - 8} y={tickY(i) + 4} className={MONO}>
                  {formatValue(v, card?.decimalPlaces ?? 1)}
                </text>
              ))}
            </g>

            <path d={linePath(values, scale, true)} className="fill-brand-500/10" />
            <path
              d={linePath(values, scale)}
              fill="none"
              className="stroke-brand-500"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>

          <div className="flex justify-between gap-1 overflow-hidden" style={{ paddingLeft: PLOT.left }}>
            {points.map((p) => (
              <span key={`${p.year}-${p.month_no}`} className={cn("truncate text-[10px] leading-4", MONO, TEXT_5)}>
                {p.periodLabel}
              </span>
            ))}
          </div>

          {card?.trend.delta ? (
            <p className={cn("border-t pt-2.5 text-xs leading-[18px] border-gray-200 dark:border-[#2b3648]", TEXT_3)}>
              Perubahan terhadap {card.trend.delta.previousLabel}:{" "}
              <span className={cn("tabular-nums", MONO)}>
                {card.trend.delta.absolute > 0 ? "+" : ""}
                {formatValue(card.trend.delta.absolute, card.decimalPlaces)}
              </span>
            </p>
          ) : null}
        </>
      )}
    </Panel>
  );
}
