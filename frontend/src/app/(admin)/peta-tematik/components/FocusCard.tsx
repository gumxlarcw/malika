"use client";

import { useMemo } from "react";
import { fmtNumber } from "../colorScale";
import { rankRows, sparklinePoints, type YearMatrix } from "../panelData";

interface Props {
  matrix: YearMatrix;
  activeYear: number;
  /** Pinned region, or null to describe the province as a whole. */
  selectedKode: string | null;
  indicatorName: string;
  unit?: string | null;
}

/**
 * The figure behind whatever is currently in focus.
 *
 * With no region pinned it describes the spread across all ten; pin one and it
 * becomes that region's card. Either way it carries the value, its rank, and
 * the series behind it, because a single number on a map answers "how much"
 * without ever answering "compared to what".
 *
 * The change chip states direction and size only — never good or bad. Falling
 * unemployment and falling school enrolment are the same arrow, and this page
 * maps ~196 indicators whose polarity MALIKA does not record.
 */
export default function FocusCard({ matrix, activeYear, selectedKode, indicatorName, unit }: Props) {
  const yi = matrix.years.indexOf(activeYear);

  const focus = useMemo(() => {
    if (yi < 0) return null;
    const ranked = rankRows(matrix, yi);
    if (!ranked.length) return null;

    if (selectedKode) {
      const hit = ranked.find((r) => r.row.kode === selectedKode);
      if (!hit) return null;
      return {
        kind: "Wilayah terpilih",
        name: hit.row.nama_kab,
        code: hit.row.kode,
        value: hit.value,
        rankLabel: `Peringkat ${hit.rank} dari ${ranked.length}`,
        cells: hit.row.cells,
      };
    }

    const top = ranked[0];
    const bottom = ranked[ranked.length - 1];
    return {
      kind: "Sebaran provinsi",
      name: `${ranked.length} kabupaten/kota`,
      code: `${fmtNumber(bottom.value)} – ${fmtNumber(top.value)}`,
      value: null as number | null,
      rankLabel: `Tertinggi ${top.row.nama_kab} · terendah ${bottom.row.nama_kab}`,
      cells: matrix.years.map((_, i) => {
        // Provincial line is the median across regions, which survives one
        // outlying regency in a way a mean does not.
        const vals = matrix.rows.map((r) => r.cells[i]).filter((v): v is number => v != null).sort((a, b) => a - b);
        if (!vals.length) return null;
        const mid = Math.floor(vals.length / 2);
        return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
      }),
    };
  }, [matrix, yi, selectedKode]);

  if (!focus) {
    return (
      <div className="rounded-2xl border border-[var(--pt-border)] bg-[var(--pt-canvas)] p-4">
        <p className="pt-body text-sm text-[var(--pt-ink-faint)]">
          Tidak ada nilai untuk periode ini.
        </p>
      </div>
    );
  }

  const spark = sparklinePoints(focus.cells);
  const current = focus.value ?? focus.cells[yi];
  const previous = yi > 0 ? focus.cells[yi - 1] : null;
  const delta = current != null && previous != null ? current - previous : null;

  return (
    <div className="rounded-2xl border border-[var(--pt-border)] bg-[var(--pt-canvas)] p-4">
      <div className="flex items-start justify-between gap-2.5">
        <div className="min-w-0">
          <div className="pt-eyebrow">{focus.kind}</div>
          <div className="pt-display mt-0.5 truncate text-[17px] font-semibold text-[var(--pt-ink)]">
            {focus.name}
          </div>
          <div className="pt-mono text-[11px] text-[var(--pt-ink-faint)]">{focus.code}</div>
        </div>
        {delta != null ? (
          <span className="pt-mono shrink-0 rounded-full bg-[var(--pt-canvas-deep)] px-2 py-0.5 text-[11px] font-semibold text-[var(--pt-ink-soft)]">
            {delta > 0 ? "↑" : delta < 0 ? "↓" : "="} {fmtNumber(Math.abs(delta))}
          </span>
        ) : null}
      </div>

      {current != null ? (
        <div className="mt-3 flex items-end gap-2">
          <span className="pt-mono text-[32px] font-medium leading-9 tracking-tight text-[var(--pt-ink)]">
            {fmtNumber(current)}
          </span>
          {unit ? <span className="pt-body pb-1 text-[13px] text-[var(--pt-ink-faint)]">{unit}</span> : null}
        </div>
      ) : null}

      <p className="pt-body mt-1 text-[12px] text-[var(--pt-ink-soft)]">{focus.rankLabel}</p>

      {spark ? (
        <div className="mt-3">
          <svg viewBox="0 0 100 34" width="100%" height="42" preserveAspectRatio="none" className="block overflow-visible" aria-hidden>
            <polyline
              points={spark.points}
              fill="none"
              stroke="var(--pt-accent)"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={spark.lastX} cy={spark.lastY} r="2.2" fill="var(--pt-accent)" stroke="var(--pt-canvas)" strokeWidth="1.2" />
          </svg>
          <div className="pt-mono flex justify-between text-[10px] text-[var(--pt-ink-faint)]">
            <span>{matrix.years[0]}</span>
            <span>{matrix.years[matrix.years.length - 1]}</span>
          </div>
        </div>
      ) : null}

      <p className="pt-body mt-3 border-t border-[var(--pt-border)] pt-2 text-[11px] text-[var(--pt-ink-faint)]">
        {indicatorName}
      </p>
    </div>
  );
}
