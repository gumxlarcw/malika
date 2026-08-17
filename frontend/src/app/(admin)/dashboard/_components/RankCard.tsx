"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { BORDER, MONO, SURFACE_2, SURFACE_BRAND, TEXT_2, TEXT_3 } from "@/lib/surfaceTokens";
import { formatValue } from "../_lib/format";
import { rankRegions, type RegionValue } from "../_lib/regions";
import { Panel, PanelAction, PanelEmpty, ExpandIcon } from "./Panel";

/**
 * Kabupaten/kota ranked on one indicator, highest first.
 *
 * Bars are measured from zero — or from the minimum when a value goes negative,
 * as growth rates do — rather than from the smallest value. Anchoring at the
 * smallest makes the lowest region a zero-width sliver and exaggerates the
 * spread, which is the classic way a ranking chart overstates its own story.
 */
export function RankCard({
  title,
  subtitle,
  values,
  decimalPlaces,
  selectedRegion,
  onSelectRegion,
  onExpand,
}: {
  title: string;
  subtitle?: string;
  values: RegionValue[];
  decimalPlaces: number | null;
  selectedRegion: string | null;
  onSelectRegion: (name: string | null) => void;
  onExpand?: () => void;
}) {
  const ranked = rankRegions(values);
  const max = ranked.length ? ranked[0].value : 0;
  const min = ranked.length ? ranked[ranked.length - 1].value : 0;
  const floor = Math.min(0, min);
  const span = max - floor || 1;

  return (
    <Panel
      title={title}
      subtitle={subtitle}
      className="col-span-12 xl:col-span-6"
      actions={
        onExpand && ranked.length ? (
          <PanelAction label={`Lihat rincian ${title}`} onClick={onExpand}>
            <ExpandIcon />
          </PanelAction>
        ) : null
      }
    >
      {!ranked.length ? (
        <PanelEmpty>Indikator ini tidak menyediakan angka per kabupaten/kota.</PanelEmpty>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {ranked.map((r) => {
            const selected = selectedRegion === r.nama_kab;
            return (
              <li key={r.kdkab}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelectRegion(selected ? null : r.nama_kab)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-1 py-0.5 text-left transition-colors",
                    selected ? SURFACE_BRAND : "hover:bg-gray-50 dark:hover:bg-gray-800/60"
                  )}
                >
                  <span className={cn("w-[124px] shrink-0 truncate text-xs leading-[18px]", TEXT_3)}>{r.nama_kab}</span>
                  <span className={cn("flex h-[22px] min-w-0 flex-1 overflow-hidden rounded-md", SURFACE_2)}>
                    <span
                      className={cn("rounded-md", selected ? "bg-brand-600" : "bg-brand-500")}
                      style={{ width: `${Math.max(2, Math.round(((r.value - floor) / span) * 100))}%` }}
                    />
                  </span>
                  <span className={cn("w-14 shrink-0 text-right text-xs tabular-nums", MONO, TEXT_2)}>
                    {formatValue(r.value, decimalPlaces)}
                  </span>
                </button>
              </li>
            );
          })}
          {ranked.length < values.length ? (
            <li className={cn("border-t pt-2 text-xs", BORDER, TEXT_3)}>
              {values.length - ranked.length} wilayah tanpa angka pada periode ini.
            </li>
          ) : null}
        </ul>
      )}
    </Panel>
  );
}
