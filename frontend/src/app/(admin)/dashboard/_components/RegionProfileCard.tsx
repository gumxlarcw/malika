"use client";

import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { BORDER, BRAND_TEXT, MONO, SURFACE_2, TEXT, TEXT_4, TEXT_5 } from "@/lib/surfaceTokens";
import { formatValue } from "../_lib/format";
import { rankRegions } from "../_lib/regions";
import { Panel, PanelEmpty } from "./Panel";
import type { RegionColumn } from "./RegionTable";

/**
 * The selected kabupaten/kota, or the spread across all of them.
 *
 * This is the slot the source design gave to a list of saved SQL questions.
 * MALIKA has no saved-question feature, and a card of plausible-looking
 * "dijalankan 2 jam lalu" entries would be furniture pretending to be a
 * product. The space goes to the regional read the data actually supports.
 */

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className={cn("flex flex-col gap-0.5 rounded-xl px-3.5 py-3", SURFACE_2)}>
      <span className={cn("text-[11px] leading-4", TEXT_5)}>{label}</span>
      <span className={cn("text-[19px] font-semibold leading-7 tabular-nums", MONO, TEXT)}>{value}</span>
      {note ? <span className={cn("text-[11px] leading-4", TEXT_4)}>{note}</span> : null}
    </div>
  );
}

export function RegionProfileCard({
  columns,
  region,
  onSelectRegion,
}: {
  columns: RegionColumn[];
  region: string | null;
  onSelectRegion: (region: string | null) => void;
}) {
  const usable = columns.filter((c) => c.values.some((v) => v.value != null));
  const lead = usable[0];
  const names = lead ? rankRegions(lead.values).map((v) => v.nama_kab) : [];

  const stats: Array<{ label: string; value: string; note?: string }> = [];

  if (region && usable.length) {
    for (const col of usable) {
      const ranked = rankRegions(col.values);
      const index = ranked.findIndex((v) => v.nama_kab === region);
      const hit = index >= 0 ? ranked[index] : null;
      stats.push({
        label: col.name,
        value: hit ? formatValue(hit.value, col.decimalPlaces) : "—",
        note: hit ? `peringkat ${index + 1} dari ${ranked.length}` : "tidak tersedia",
      });
    }
    const code = lead?.values.find((v) => v.nama_kab === region)?.kdkab;
    if (code) stats.push({ label: "Kode wilayah", value: code, note: "BPS" });
  } else if (lead) {
    const ranked = rankRegions(lead.values);
    if (ranked.length) {
      const top = ranked[0];
      const bottom = ranked[ranked.length - 1];
      stats.push({ label: "Tertinggi", value: formatValue(top.value, lead.decimalPlaces), note: top.nama_kab });
      stats.push({ label: "Terendah", value: formatValue(bottom.value, lead.decimalPlaces), note: bottom.nama_kab });
      stats.push({
        label: "Selisih",
        value: formatValue(top.value - bottom.value, lead.decimalPlaces),
        note: "tertinggi − terendah",
      });
      stats.push({ label: "Wilayah terisi", value: `${ranked.length}`, note: `dari ${lead.values.length}` });
    }
  }

  return (
    <Panel
      title={region ?? "Sebaran antarwilayah"}
      subtitle={region ? "Posisi wilayah terpilih pada indikator tab ini" : lead?.name}
      className="col-span-12 xl:col-span-4"
    >
      {!stats.length ? (
        <PanelEmpty>Pilih indikator yang tersedia per kabupaten/kota.</PanelEmpty>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            {stats.map((s) => (
              <Stat key={s.label} {...s} />
            ))}
          </div>

          {names.length ? (
            <div className="flex flex-wrap gap-1.5">
              {names.map((n) => {
                const active = n === region;
                return (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSelectRegion(active ? null : n)}
                    className={cn(
                      "h-7 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors",
                      active
                        ? cn("border-brand-200 bg-brand-25 dark:border-brand-500/45 dark:bg-[#141a33]", BRAND_TEXT)
                        : cn(BORDER, TEXT_4, "hover:bg-gray-50 dark:hover:bg-gray-800/60")
                    )}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          ) : null}

          <Link
            href="/chat"
            className={cn("inline-flex items-center gap-1.5 border-t pt-3 text-[13px] font-medium", BORDER, BRAND_TEXT)}
          >
            Tanya MALIKA tentang angka ini
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 10h11M11 6l4 4-4 4" />
            </svg>
          </Link>
        </>
      )}
    </Panel>
  );
}
