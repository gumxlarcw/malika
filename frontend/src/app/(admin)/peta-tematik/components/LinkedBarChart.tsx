"use client";

import { useState, useMemo } from "react";
import { ArrowUpDown } from "lucide-react";
import { fmtNumber, colorForValue, computeBins, getPalette, type BinningMethod, type Palette } from "../colorScale";
import type { DataPoint } from "../types";

interface Props {
  data: DataPoint[];
  binning: BinningMethod;
  palette?: Palette;
  hoveredKdkab: string | null;
  onHover: (kdkab: string | null) => void;
  onSelect: (kdkab: string, namaKab: string) => void;
}

type SortMode = "value-desc" | "value-asc" | "name";

/**
 * Horizontal bar chart of all 10 kab/kota. Linked to map via hoveredKdkab:
 *  - Hovering polygon highlights matching bar
 *  - Hovering bar dispatches hover up to parent → map can highlight polygon
 * Sortable: by value (high→low default), value (low→high), or name.
 * Click bar = open drawer (same as click polygon).
 */
export default function LinkedBarChart({
  data, binning, palette = getPalette("blue"), hoveredKdkab, onHover, onSelect,
}: Props) {
  const [sortMode, setSortMode] = useState<SortMode>("value-desc");

  const sorted = useMemo(() => {
    const valid = data.filter((d) => d.value != null) as Array<DataPoint & { value: number }>;
    const nullOnes = data.filter((d) => d.value == null);
    let arr: DataPoint[];
    switch (sortMode) {
      case "value-desc":
        arr = [...valid].sort((a, b) => b.value - a.value);
        break;
      case "value-asc":
        arr = [...valid].sort((a, b) => a.value - b.value);
        break;
      case "name":
        arr = [...valid, ...nullOnes].sort((a, b) =>
          a.nama_kab.localeCompare(b.nama_kab, "id"),
        );
        break;
    }
    if (sortMode !== "name") arr = [...arr, ...nullOnes];
    return arr;
  }, [data, sortMode]);

  const breaks = useMemo(() => {
    return computeBins(
      data.filter((d) => d.value != null).map((d) => d.value as number),
      binning,
    );
  }, [data, binning]);

  const max = useMemo(
    () => Math.max(...data.filter((d) => d.value != null).map((d) => d.value as number), 0),
    [data],
  );

  const cycleSort = () => {
    setSortMode((m) =>
      m === "value-desc" ? "value-asc" : m === "value-asc" ? "name" : "value-desc",
    );
  };

  return (
    <div className="bg-[var(--pt-canvas-elevated)] border border-[var(--pt-border)] rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="pt-eyebrow">Peringkat 10 Kab/Kota</span>
        <button
          onClick={cycleSort}
          className="flex items-center gap-1 px-2 py-1 pt-mono text-[10px] uppercase tracking-wider hover:bg-[var(--pt-canvas-deep)] rounded-xl transition-colors text-[var(--pt-ink-soft)]"
          aria-label="Ganti urutan"
        >
          <ArrowUpDown className="w-3 h-3" />
          {sortMode === "value-desc" && "Tertinggi"}
          {sortMode === "value-asc" && "Terendah"}
          {sortMode === "name" && "Abjad"}
        </button>
      </div>

      <ul className="space-y-1">
        {sorted.map((d) => {
          const isHovered = hoveredKdkab === d.kdkab;
          const pct = d.value != null && max > 0 ? (d.value / max) * 100 : 0;
          const fillColor = d.value == null ? palette.noData : colorForValue(d.value, breaks, palette);

          return (
            <li
              key={d.kdkab}
              onMouseEnter={() => onHover(d.kdkab)}
              onMouseLeave={() => onHover(null)}
              onClick={() => d.value != null && onSelect(d.kdkab, d.nama_kab)}
              style={isHovered ? { boxShadow: `inset 3px 0 0 ${palette.hoverOutline}` } : undefined}
              className={`relative cursor-pointer rounded-xl py-1.5 px-2 transition-colors ${
                isHovered ? "bg-[var(--pt-canvas-deep)]" : ""
              } ${d.value != null ? "hover:bg-[var(--pt-canvas-deep)]" : "cursor-default opacity-60"}`}
            >
              <div className="flex items-baseline gap-2 text-xs mb-0.5">
                <span
                  className={`pt-body truncate ${
                    isHovered ? "text-[var(--pt-ink)] font-medium" : "text-[var(--pt-ink)]"
                  }`}
                >
                  {d.nama_kab.replace(/^(Kabupaten|Kota)\s+/i, "")}
                </span>
                <span className="pt-dotted-leader" />
                <span className="pt-mono text-[var(--pt-ink)] tabular-nums shrink-0">
                  {d.value == null ? "—" : fmtNumber(d.value)}
                </span>
              </div>
              <div className="h-1 bg-[var(--pt-border)] rounded-full overflow-hidden relative">
                <div
                  className="absolute inset-y-0 left-0 transition-all duration-300"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: fillColor,
                    opacity: d.value == null ? 0.3 : isHovered ? 1 : 0.85,
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
