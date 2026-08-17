"use client";

import React, { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { BORDER, BRAND_TEXT, MONO, SURFACE, SURFACE_BRAND, TEXT_2, TEXT_4, TEXT_5 } from "@/lib/surfaceTokens";
import { formatValue } from "../_lib/format";
import type { RegionValue } from "../_lib/regions";
import { Panel, PanelEmpty } from "./Panel";

export type RegionColumn = {
  sourceId: number;
  name: string;
  decimalPlaces: number | null;
  values: RegionValue[];
  /** Same indicator at the previous published year — only fetched when the
   *  reader asks to compare, so the default view costs one request per column. */
  previousValues?: RegionValue[];
};

type SortKey = "name" | number;

/**
 * Every kabupaten/kota against the tab's indicators, side by side.
 *
 * Columns are whichever of the tab's indicators peta-tematik can serve per
 * region, so the table gains and loses columns with the data rather than
 * promising four fixed ones. Regions the source has no value for show an em
 * dash: a blank cell reads as a rendering fault, and a zero would be a figure
 * BPS never published.
 */
export function RegionTable({
  columns,
  year,
  previousYear,
  selectedRegion,
  onSelectRegion,
  onDownload,
}: {
  columns: RegionColumn[];
  year: number | null;
  /** Label for the compared year; null when comparison is off or unavailable. */
  previousYear?: number | null;
  selectedRegion: string | null;
  onSelectRegion: (region: string | null) => void;
  onDownload: (csv: string, filename: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [descending, setDescending] = useState(false);

  const rows = useMemo(() => {
    const byRegion = new Map<
      string,
      { kdkab: string; nama_kab: string; cells: Array<number | null>; prev: Array<number | null> }
    >();
    const ensure = (kdkab: string, nama_kab: string) => {
      if (!byRegion.has(kdkab)) {
        byRegion.set(kdkab, {
          kdkab,
          nama_kab,
          cells: columns.map(() => null),
          prev: columns.map(() => null),
        });
      }
      return byRegion.get(kdkab)!;
    };
    columns.forEach((col, index) => {
      for (const v of col.values) ensure(v.kdkab, v.nama_kab).cells[index] = v.value;
      // A region present only in the earlier year still gets a row, so a
      // kabupaten that stopped being published does not silently vanish.
      for (const v of col.previousValues ?? []) ensure(v.kdkab, v.nama_kab).prev[index] = v.value;
    });

    const list = [...byRegion.values()];
    list.sort((a, b) => {
      if (sortKey === "name") {
        return descending ? b.nama_kab.localeCompare(a.nama_kab, "id") : a.nama_kab.localeCompare(b.nama_kab, "id");
      }
      const av = a.cells[sortKey];
      const bv = b.cells[sortKey];
      // Regions without a value sort last either way — they are not "lowest".
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return descending ? bv - av : av - bv;
    });
    return list;
  }, [columns, sortKey, descending]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setDescending((d) => !d);
    } else {
      setSortKey(key);
      setDescending(key !== "name");
    }
  };

  const caret = (key: SortKey) => (key === sortKey ? (descending ? " ↓" : " ↑") : "");

  const comparing = previousYear != null && columns.some((c) => c.previousValues?.length);

  const download = () => {
    const header = [
      "Kode",
      "Kabupaten/kota",
      ...columns.flatMap((c) => (comparing ? [c.name, `${c.name} (${previousYear})`] : [c.name])),
    ];
    const body = rows.map((r) => [
      r.kdkab,
      r.nama_kab,
      ...columns.flatMap((c, i) => {
        const now = r.cells[i] == null ? "" : formatValue(r.cells[i] as number, c.decimalPlaces);
        if (!comparing) return [now];
        return [now, r.prev[i] == null ? "" : formatValue(r.prev[i] as number, c.decimalPlaces)];
      }),
    ]);
    const escape = (cell: string) => (/[";\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
    // Semicolon-delimited: values are formatted id-ID, where the decimal mark is
    // a comma, so a comma delimiter would split every number in half in Excel.
    const csv = [header, ...body].map((line) => line.map(escape).join(";")).join("\r\n");
    onDownload(csv, `indikator-kabkota-${year ?? "terbaru"}.csv`);
  };

  return (
    <Panel
      title="Tabel indikator kabupaten/kota"
      subtitle={
        columns.length
          ? `${rows.length} wilayah · ${columns.length} indikator${year ? ` · ${year}` : ""}${
              comparing ? ` · dibandingkan ${previousYear}` : ""
            }`
          : undefined
      }
      className="col-span-12"
      actions={
        columns.length ? (
          <button
            type="button"
            onClick={download}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors hover:bg-gray-100 dark:hover:bg-gray-800",
              BORDER,
              SURFACE,
              TEXT_2
            )}
          >
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M10 3.5v9M6.5 9.5L10 13l3.5-3.5M4 16h12" />
            </svg>
            Unduh CSV
          </button>
        ) : null
      }
    >
      {!columns.length || !rows.length ? (
        <PanelEmpty>Tidak ada indikator tab ini yang tersedia per kabupaten/kota.</PanelEmpty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className={cn("border-b", BORDER)}>
                <th scope="col" className="pb-2.5 pl-1">
                  <button
                    type="button"
                    onClick={() => toggleSort("name")}
                    className={cn(
                      "text-[11px] font-semibold uppercase tracking-[0.03em]",
                      sortKey === "name" ? BRAND_TEXT : TEXT_4
                    )}
                  >
                    Kabupaten/kota{caret("name")}
                  </button>
                </th>
                {columns.map((c, i) => (
                  <th key={c.sourceId} scope="col" className="pb-2.5 pl-3 text-right">
                    <button
                      type="button"
                      onClick={() => toggleSort(i)}
                      title={c.name}
                      className={cn(
                        "line-clamp-2 text-[11px] font-semibold uppercase tracking-[0.03em]",
                        sortKey === i ? BRAND_TEXT : TEXT_4
                      )}
                    >
                      {c.name}
                      {caret(i)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const selected = selectedRegion === r.nama_kab;
                return (
                  <tr
                    key={r.kdkab}
                    onClick={() => onSelectRegion(selected ? null : r.nama_kab)}
                    className={cn("cursor-pointer border-b transition-colors", BORDER, selected ? SURFACE_BRAND : "hover:bg-gray-50 dark:hover:bg-gray-800/60")}
                  >
                    <th scope="row" className="py-2.5 pl-1 text-left font-normal">
                      <span className="flex items-center gap-2">
                        <span className={cn("text-[11px] tabular-nums", MONO, TEXT_5)}>{r.kdkab}</span>
                        <span className={cn("text-[13px] font-medium leading-5", TEXT_2)}>{r.nama_kab}</span>
                      </span>
                    </th>
                    {r.cells.map((v, i) => {
                      const prev = r.prev[i];
                      const diff = comparing && v != null && prev != null ? v - prev : null;
                      return (
                        <td key={columns[i].sourceId} className={cn("py-2.5 pl-3 text-right text-[13px] tabular-nums", MONO, v == null ? TEXT_5 : TEXT_2)}>
                          {v == null ? "—" : formatValue(v, columns[i].decimalPlaces)}
                          {comparing ? (
                            <span className={cn("mt-0.5 block text-[11px] leading-4", TEXT_5)}>
                              {/* Direction only, never a good/bad colour: falling
                                  unemployment and falling output are the same
                                  arrow, and MALIKA stores no polarity to tell
                                  them apart. */}
                              {diff == null
                                ? "—"
                                : `${diff > 0 ? "▲" : diff < 0 ? "▼" : "•"} ${formatValue(Math.abs(diff), columns[i].decimalPlaces)}`}
                            </span>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
