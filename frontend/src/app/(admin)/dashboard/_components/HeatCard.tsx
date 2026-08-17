"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { MONO, TEXT_2, TEXT_3, TEXT_5 } from "@/lib/surfaceTokens";
import { formatValue } from "../_lib/format";
import { inflationRowLabel } from "../_lib/select";
import { Panel, PanelEmpty } from "./Panel";
import type { Series } from "../_lib/series";

const periodKey = (year: number, monthNo: number) => `${year}-${monthNo}`;

/**
 * Inflation by IHK city and month.
 *
 * Rows are separate indicators, not one indicator's dimension — MALIKA stores
 * each IHK city in its own table — so columns are aligned by (year, month_no)
 * rather than by position. Two cities whose series start in different months
 * would otherwise sit one cell out of step and quietly compare August with
 * September.
 */
export function HeatCard({ series }: { series: Series[] }) {
  const rows = series.filter((s) => s.points.length > 0);

  // The longest series defines the columns; shorter rows leave gaps rather than
  // shifting left, so every column is the same month across every row.
  const spine = rows.reduce<Series | null>((best, s) => (!best || s.points.length > best.points.length ? s : best), null);
  const columns = spine?.points ?? [];

  const all = rows.flatMap((s) => s.points.map((p) => p.value));
  const lo = all.length ? Math.min(...all) : 0;
  const hi = all.length ? Math.max(...all) : 1;
  const span = hi - lo || 1;

  const decimals = rows[0]?.decimalPlaces ?? 2;

  return (
    <Panel
      title="Inflasi bulanan menurut kota IHK"
      subtitle={
        columns.length
          ? `${columns.length} bulan terakhir · makin gelap makin tinggi`
          : undefined
      }
      className="col-span-12"
    >
      {!rows.length || !columns.length ? (
        <PanelEmpty>Deret inflasi bulanan belum tersedia.</PanelEmpty>
      ) : (
        <div className="flex flex-col gap-2 overflow-x-auto">
          <div className="flex min-w-[560px] gap-1 pl-[116px]">
            {columns.map((c) => (
              <span key={periodKey(c.year, c.month_no)} className={cn("flex-1 text-center text-[10px] leading-[14px]", TEXT_5)}>
                {c.periodLabel.replace(/\s+\d{4}$/, "")}
              </span>
            ))}
          </div>

          {rows.map((row) => {
            const byPeriod = new Map(row.points.map((p) => [periodKey(p.year, p.month_no), p.value]));
            return (
              <div key={row.sourceId} className="flex min-w-[560px] items-center gap-1">
                <span className={cn("w-[112px] shrink-0 truncate text-xs leading-[18px]", TEXT_3)} title={row.name}>
                  {inflationRowLabel(row.name)}
                </span>
                {columns.map((c) => {
                  const key = periodKey(c.year, c.month_no);
                  const value = byPeriod.get(key);
                  if (value == null) {
                    return (
                      <span
                        key={key}
                        className={cn("flex h-10 flex-1 items-center justify-center rounded-md bg-gray-100 text-[10px] dark:bg-gray-800", TEXT_5)}
                        title={`${inflationRowLabel(row.name)} · ${c.periodLabel} · tidak tersedia`}
                      >
                        —
                      </span>
                    );
                  }
                  const intensity = (value - lo) / span;
                  return (
                    <span
                      key={key}
                      className={cn(
                        "flex h-10 flex-1 items-center justify-center rounded-md text-[10px] tabular-nums",
                        MONO,
                        intensity > 0.55 ? "text-white" : TEXT_2
                      )}
                      style={{ background: `rgba(70, 95, 255, ${(0.1 + intensity * 0.78).toFixed(2)})` }}
                      title={`${inflationRowLabel(row.name)} · ${c.periodLabel} · ${formatValue(value, decimals)}`}
                    >
                      {formatValue(value, decimals)}
                    </span>
                  );
                })}
              </div>
            );
          })}

          <div className={cn("flex items-center gap-2.5 border-t border-gray-200 pt-3 text-xs dark:border-[#2b3648]", TEXT_5)}>
            <span className={cn("tabular-nums", MONO)}>{formatValue(lo, decimals)}</span>
            <span
              className="h-2 flex-1 rounded-full"
              style={{ background: "linear-gradient(90deg, rgba(70,95,255,0.10), rgba(70,95,255,0.88))" }}
              aria-hidden
            />
            <span className={cn("tabular-nums", MONO)}>{formatValue(hi, decimals)}</span>
          </div>
        </div>
      )}
    </Panel>
  );
}
