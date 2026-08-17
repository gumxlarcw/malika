"use client";

import { useMemo } from "react";
import { MAP_H, MAP_W, REGION_SHAPES } from "@/lib/malutGeometry";
import { computeBins, colorForValue, getPalette, type BinningMethod, type PaletteId } from "../colorScale";
import type { YearMatrix } from "../panelData";

interface Props {
  matrix: YearMatrix;
  activeYear: number;
  onPickYear: (year: number) => void;
  binning: BinningMethod;
  paletteId: PaletteId;
  nBins?: number;
  /** Highlighted region, drawn with an outline in every year. */
  selectedKode?: string | null;
}

/**
 * One small map per period, so a change over time is a thing you see rather
 * than a thing you remember.
 *
 * Every period is classified against **the active year's breaks**, not its own.
 * Re-classifying each panel separately would give each one the same spread of
 * colours regardless of the values behind it, which makes a decade of progress
 * look like a decade of nothing — the single most common way a small-multiple
 * choropleth misleads.
 *
 * Draws the pre-projected 100×95 geometry rather than ten Leaflet instances:
 * these are thumbnails, and the detail a zoomable map needs is exactly what a
 * thumbnail should drop.
 */
export default function MiniMapGrid({
  matrix,
  activeYear,
  onPickYear,
  binning,
  paletteId,
  nBins = 5,
  selectedKode = null,
}: Props) {
  const palette = getPalette(paletteId);

  const breaks = useMemo(() => {
    const yi = matrix.years.indexOf(activeYear);
    const values = matrix.rows.map((r) => r.cells[yi]).filter((v): v is number => v != null);
    return values.length ? computeBins(values, binning, nBins) : [];
  }, [matrix, activeYear, binning, nBins]);

  const byYear = useMemo(
    () =>
      matrix.years.map((year, yi) => ({
        year,
        fill: new Map(matrix.rows.map((r) => [r.kode, r.cells[yi]])),
        populated: matrix.rows.some((r) => r.cells[yi] != null),
      })),
    [matrix]
  );

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {byYear.map(({ year, fill, populated }) => {
        const active = year === activeYear;
        return (
          <button
            key={year}
            type="button"
            onClick={() => onPickYear(year)}
            aria-pressed={active}
            aria-label={`Tampilkan peta ${year}`}
            className={`group rounded-xl border p-2 text-left transition-colors ${
              active
                ? "border-[var(--pt-accent)] bg-[var(--pt-canvas-elevated)]"
                : "border-[var(--pt-border)] bg-[var(--pt-canvas)] hover:border-[var(--pt-border-strong)]"
            }`}
          >
            <svg
              viewBox={`0 0 ${MAP_W} ${MAP_H}`}
              className="block h-auto w-full"
              stroke="var(--pt-canvas)"
              strokeWidth="0.35"
              strokeLinejoin="round"
              role="img"
              aria-label={`Peta ${year}`}
            >
              {REGION_SHAPES.map((shape) => {
                const value = fill.get(shape.kode) ?? null;
                return (
                  <path
                    key={shape.kode}
                    d={shape.d}
                    fill={breaks.length ? colorForValue(value, breaks, palette) : palette.noData}
                    opacity={selectedKode && selectedKode !== shape.kode ? 0.45 : 1}
                  />
                );
              })}
              {/* Selection is redrawn last so its outline is never overpainted. */}
              {selectedKode
                ? REGION_SHAPES.filter((s) => s.kode === selectedKode).map((s) => (
                    <path
                      key={`sel-${s.kode}`}
                      d={s.d}
                      fill="none"
                      stroke="var(--pt-ink)"
                      strokeWidth="0.7"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))
                : null}
            </svg>
            <span
              className={`pt-mono mt-1 block text-center text-[11px] ${
                active ? "text-[var(--pt-ink)]" : "text-[var(--pt-ink-faint)]"
              }`}
            >
              {year}
              {!populated ? " ·" : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}
