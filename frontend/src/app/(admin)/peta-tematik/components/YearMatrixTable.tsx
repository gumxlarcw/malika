"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { fmtNumber, getPalette, colorForValue, computeBins, type BinningMethod, type PaletteId } from "../colorScale";
import { matrixToCsv, type YearMatrix } from "../panelData";

interface Props {
  matrix: YearMatrix;
  activeYear: number;
  indicatorName: string;
  unit?: string | null;
  binning: BinningMethod;
  paletteId: PaletteId;
  nBins?: number;
  selectedKode: string | null;
  onPickRegion: (kode: string | null) => void;
}

type SortKey = "name" | number;

/**
 * Every region against every period, as numbers.
 *
 * The map answers "where"; this answers "exactly how much, and since when".
 * Cells are tinted on the active year's classes so the table and the map tell
 * the same story, and a region with no published value shows an em dash — a
 * blank cell reads as a rendering fault and a zero would be a figure BPS never
 * published.
 */
export default function YearMatrixTable({
  matrix,
  activeYear,
  indicatorName,
  unit,
  binning,
  paletteId,
  nBins = 5,
  selectedKode,
  onPickRegion,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [descending, setDescending] = useState(false);
  const palette = getPalette(paletteId);
  const activeIndex = matrix.years.indexOf(activeYear);

  const breaks = useMemo(() => {
    if (activeIndex < 0) return [];
    const values = matrix.rows.map((r) => r.cells[activeIndex]).filter((v): v is number => v != null);
    return values.length ? computeBins(values, binning, nBins) : [];
  }, [matrix, activeIndex, binning, nBins]);

  const rows = useMemo(() => {
    const list = [...matrix.rows];
    list.sort((a, b) => {
      if (sortKey === "name") {
        return descending
          ? b.nama_kab.localeCompare(a.nama_kab, "id")
          : a.nama_kab.localeCompare(b.nama_kab, "id");
      }
      const av = a.cells[sortKey];
      const bv = b.cells[sortKey];
      // Regions without a value sort last either way — absent is not "lowest".
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return descending ? bv - av : av - bv;
    });
    return list;
  }, [matrix, sortKey, descending]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setDescending((d) => !d);
    else {
      setSortKey(key);
      setDescending(key !== "name");
    }
  };
  const caret = (key: SortKey) => (key === sortKey ? (descending ? " ↓" : " ↑") : "");

  const download = () => {
    const csv = matrixToCsv(matrix, `${indicatorName}${unit ? ` (${unit})` : ""}`, (v) => fmtNumber(v));
    // BOM so Excel opens the id-ID decimal commas as numbers, not text.
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `peta-tematik-${matrix.years[0]}-${matrix.years[matrix.years.length - 1]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="rounded-2xl border border-[var(--pt-border)] bg-[var(--pt-canvas)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="pt-display text-[15px] font-semibold text-[var(--pt-ink)]">Tabel nilai per wilayah</h2>
          <p className="pt-body mt-0.5 text-[12px] text-[var(--pt-ink-faint)]">
            {indicatorName}
            {unit ? ` · ${unit}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={download}
          className="pt-mono inline-flex items-center gap-2 rounded-xl border border-[var(--pt-border-strong)] px-3 py-1.5 text-[11px] uppercase tracking-wider text-[var(--pt-ink-soft)] transition-colors hover:border-[var(--pt-accent)] hover:text-[var(--pt-accent)]"
        >
          <Download className="h-3.5 w-3.5" />
          Unduh CSV
        </button>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-left">
          <thead>
            <tr className="border-b border-[var(--pt-border)]">
              <th scope="col" className="pb-2 pl-2">
                <button type="button" onClick={() => toggleSort("name")} className="pt-eyebrow">
                  Wilayah{caret("name")}
                </button>
              </th>
              {matrix.years.map((y, i) => (
                <th key={y} scope="col" className="pb-2 pl-3 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort(i)}
                    className={`pt-mono text-[11px] ${
                      y === activeYear ? "text-[var(--pt-ink)]" : "text-[var(--pt-ink-faint)]"
                    }`}
                  >
                    {y}
                    {caret(i)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const on = selectedKode === r.kode;
              return (
                <tr
                  key={r.kode}
                  onClick={() => onPickRegion(on ? null : r.kode)}
                  className={`cursor-pointer border-b border-[var(--pt-border)] transition-colors ${
                    on ? "bg-[var(--pt-canvas-deep)]" : "hover:bg-[var(--pt-canvas-deep)]"
                  }`}
                >
                  <th scope="row" className="py-2 pl-2 text-left font-normal">
                    <span className="pt-body truncate text-[13px] text-[var(--pt-ink-soft)]">{r.nama_kab}</span>
                  </th>
                  {r.cells.map((v, i) => (
                    <td key={matrix.years[i]} className="py-2 pl-3 text-right">
                      <span
                        className="pt-mono inline-block rounded px-1.5 py-0.5 text-[12px] text-[var(--pt-ink)]"
                        style={
                          v != null && breaks.length && i === activeIndex
                            ? { background: colorForValue(v, breaks, palette) }
                            : undefined
                        }
                      >
                        {v == null ? "—" : fmtNumber(v)}
                      </span>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
