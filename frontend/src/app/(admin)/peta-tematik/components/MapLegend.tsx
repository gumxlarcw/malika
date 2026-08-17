"use client";

import { useMemo } from "react";
import { getPalette, fmtNumber, BINNING_LABELS, type BinningMethod, type PaletteId } from "../colorScale";
import { legendBuckets } from "../panelData";

interface Props {
  values: Array<number | null>;
  breaks: number[];
  paletteId: PaletteId;
  binning: BinningMethod;
  unit?: string | null;
  /** Class currently isolated on the map, or null for all. */
  activeBucket: number | null;
  onPickBucket: (bucket: number | null) => void;
  noDataCount?: number;
}

/**
 * The legend, with how many regions sit in each class.
 *
 * The count is the point. A choropleth's classes are chosen by an algorithm the
 * reader cannot see, and a quantile scale in particular guarantees roughly equal
 * counts whatever the data does — showing the counts is what lets someone notice
 * that eight of ten regions crowd into one class, which is the difference
 * between a real pattern and an artefact of the binning.
 *
 * Clicking a class isolates it; the counts come from the same comparison
 * `colorForValue` uses, so a row can never disagree with the map beside it.
 */
export default function MapLegend({
  values,
  breaks,
  paletteId,
  binning,
  unit,
  activeBucket,
  onPickBucket,
  noDataCount = 0,
}: Props) {
  const palette = getPalette(paletteId);
  const buckets = useMemo(
    () => legendBuckets(values, breaks, palette.colors),
    [values, breaks, palette]
  );

  if (!breaks.length) {
    return (
      <p className="pt-body text-xs text-[var(--pt-ink-faint)]">
        Tidak ada nilai untuk diklasifikasikan pada periode ini.
      </p>
    );
  }

  return (
    // The class list takes the slack (`flex-1`, rows spread evenly) so this card
    // ends level with its neighbours instead of leaving white below the last class.
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2">
        <span className="pt-eyebrow">Legenda</span>
        <span className="pt-mono text-[11px] text-[var(--pt-ink-faint)]">
          {BINNING_LABELS[binning]} · {buckets.length} kelas
        </span>
      </div>

      <div className="mt-2 flex flex-1 flex-col justify-evenly gap-0.5">
        {buckets.map((b, i) => {
          const on = activeBucket === i;
          return (
            <button
              key={i}
              type="button"
              aria-pressed={on}
              onClick={() => onPickBucket(on ? null : i)}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                on ? "bg-[var(--pt-canvas-deep)]" : "hover:bg-[var(--pt-canvas-deep)]"
              } ${activeBucket != null && !on ? "opacity-55" : ""}`}
            >
              <span
                className="h-3.5 w-3.5 shrink-0 rounded"
                style={{ background: b.color }}
                aria-hidden
              />
              <span className="pt-mono flex-1 text-[12px] text-[var(--pt-ink-soft)]">
                {fmtNumber(b.min)} – {fmtNumber(b.max)}
              </span>
              <span className="pt-mono text-[11px] text-[var(--pt-ink-faint)]">{b.count}</span>
            </button>
          );
        })}

        {noDataCount > 0 ? (
          <span className="flex items-center gap-2 px-2 py-1.5">
            <span
              className="h-3.5 w-3.5 shrink-0 rounded border border-[var(--pt-border-strong)]"
              style={{ background: palette.noData }}
              aria-hidden
            />
            <span className="pt-body flex-1 text-[12px] text-[var(--pt-ink-faint)]">Tidak tersedia</span>
            <span className="pt-mono text-[11px] text-[var(--pt-ink-faint)]">{noDataCount}</span>
          </span>
        ) : null}
      </div>

      {unit ? (
        <p className="pt-body mt-2 text-[11px] text-[var(--pt-ink-faint)]">Satuan: {unit}</p>
      ) : null}
    </div>
  );
}
