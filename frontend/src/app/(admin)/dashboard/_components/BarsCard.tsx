"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { MONO, TEXT_4, TEXT_5 } from "@/lib/surfaceTokens";
import { barScale } from "../_lib/chart";
import { formatValue } from "../_lib/format";
import { Panel, PanelAction, PanelEmpty, ExpandIcon } from "./Panel";
import type { IndicatorCardData } from "../_lib/types";

/**
 * A second indicator as bars, period by period.
 *
 * Bars are drawn about a zero line rather than from the floor. Monthly
 * inflation is routinely negative, and scaling by magnitude alone would render
 * a −1,92 deflation as a tall bar pointing the same way as a +2,77 rise.
 */
export function BarsCard({
  card,
  onExpand,
}: {
  card: IndicatorCardData | null;
  onExpand?: (card: IndicatorCardData) => void;
}) {
  const points = card?.trend.points ?? [];
  const values = points.map((p) => p.value);
  const { pct, hasNegative } = barScale(values);

  return (
    <Panel
      title={card ? card.name : "Perbandingan periode"}
      subtitle={card ? `Per periode${card.metricLabel ? ` · ${card.metricLabel}` : ""}` : undefined}
      className="col-span-12 xl:col-span-6"
      actions={
        card && onExpand ? (
          <PanelAction label={`Lihat rincian ${card.name}`} onClick={() => onExpand(card)}>
            <ExpandIcon />
          </PanelAction>
        ) : null
      }
    >
      {!points.length ? (
        <PanelEmpty>Belum ada deret waktu provinsi untuk indikator ini.</PanelEmpty>
      ) : (
        <>
          <div className="flex h-[196px] items-stretch gap-1.5 border-b border-gray-200 pt-1.5 dark:border-[#2b3648]">
            {points.map((p) => {
              const height = `${pct(p.value)}%`;
              const negative = p.value < 0;
              return (
                <div key={`${p.year}-${p.month_no}`} className="flex min-w-0 flex-1 flex-col" title={p.periodLabel}>
                  <div className="flex flex-1 flex-col justify-end">
                    {!negative ? (
                      <>
                        <span className={cn("truncate text-center text-[10px] leading-[14px]", MONO, TEXT_4)}>
                          {formatValue(p.value, card?.decimalPlaces ?? 2)}
                        </span>
                        <div className="w-full rounded-t-md bg-brand-500" style={{ height }} />
                      </>
                    ) : null}
                  </div>
                  {hasNegative ? (
                    <div className="flex flex-1 flex-col justify-start">
                      {negative ? (
                        <>
                          <div className="w-full rounded-b-md bg-brand-300 dark:bg-brand-500/50" style={{ height }} />
                          <span className={cn("truncate text-center text-[10px] leading-[14px]", MONO, TEXT_4)}>
                            {formatValue(p.value, card?.decimalPlaces ?? 2)}
                          </span>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="flex gap-1.5">
            {points.map((p) => (
              <span
                key={`${p.year}-${p.month_no}`}
                className={cn("min-w-0 flex-1 truncate text-center text-[10px] leading-[15px]", TEXT_5)}
              >
                {p.periodLabel}
              </span>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}
