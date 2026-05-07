"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GitCompare, X } from "lucide-react";
import { fmtNumber } from "../colorScale";
import type { DataPoint, FilterState } from "../types";

interface Props {
  filters: FilterState;
  years: number[];
  dataA: DataPoint[]; // current year
}

interface ComparisonRow {
  kdkab: string;
  nama_kab: string;
  valueA: number | null; // year B (older, baseline)
  valueB: number | null; // year A (current)
  delta: number | null;
  pct: number | null;
}

/**
 * Compare Mode — side-by-side comparison of two years for current indicator.
 * Pattern: when toggled, fetch baseline year data, compute delta, render table.
 * Less heavy than dual-map; gives clear "movement" narrative without splitting screen.
 */
export default function CompareMode({ filters, years, dataA }: Props) {
  const [open, setOpen] = useState(false);
  const [baselineYear, setBaselineYear] = useState<number | null>(null);
  const [dataBaseline, setDataBaseline] = useState<DataPoint[] | null>(null);
  const [loading, setLoading] = useState(false);

  // Default baseline: current year - 1 if available; else first available
  useEffect(() => {
    if (!filters.year || years.length === 0) return;
    const idx = years.indexOf(filters.year);
    if (baselineYear == null || !years.includes(baselineYear)) {
      setBaselineYear(idx > 0 ? years[idx - 1] : years[0]);
    }
  }, [filters.year, years, baselineYear]);

  // Fetch baseline data when open
  useEffect(() => {
    if (!open || !filters.indikator || baselineYear == null) return;
    setLoading(true);
    const qs = new URLSearchParams({
      indikator: String(filters.indikator),
      year: String(baselineYear),
    });
    if (filters.month != null) qs.set("month", String(filters.month));
    if (filters.metric) qs.set("metric", filters.metric);
    fetch(`/api/peta-tematik/data?${qs}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setDataBaseline(d.data ?? []))
      .catch(() => setDataBaseline([]))
      .finally(() => setLoading(false));
  }, [open, filters.indikator, baselineYear, filters.month, filters.metric]);

  const rows: ComparisonRow[] = (dataA ?? []).map((d) => {
    const baseline = dataBaseline?.find((b) => b.kdkab === d.kdkab);
    const valueB = d.value;
    const valueA = baseline?.value ?? null;
    let delta: number | null = null;
    let pct: number | null = null;
    if (valueA != null && valueB != null) {
      delta = valueB - valueA;
      pct = valueA !== 0 ? (delta / valueA) * 100 : null;
    }
    return {
      kdkab: d.kdkab,
      nama_kab: d.nama_kab.replace(/^(Kabupaten|Kota)\s+/i, ""),
      valueA, valueB, delta, pct,
    };
  });

  // Sort by absolute delta desc — most-changed kab on top
  const sortedRows = [...rows].sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0));

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 pt-mono text-[11px] uppercase tracking-wider border border-[var(--pt-border-strong)] hover:bg-[var(--pt-canvas-deep)] transition-colors rounded-xl"
      >
        <GitCompare className="w-3.5 h-3.5" />
        Bandingkan
      </button>

      <AnimatePresence>
        {open && (
          <div className="peta-tematik-page">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 bg-gray-900/40 backdrop-blur-[2px] z-[1500]"
            />
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.98 }}
              transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[1501]
                         w-[min(720px,calc(100vw-32px))] max-h-[85vh] overflow-y-auto
                         bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl
                         shadow-2xl p-6 sm:p-8"
              role="dialog"
              aria-label="Bandingkan tahun"
            >
              <button
                onClick={() => setOpen(false)}
                className="absolute top-4 right-4 p-2 hover:bg-[var(--pt-canvas-deep)] rounded-xl"
                aria-label="Tutup"
              >
                <X className="w-5 h-5 text-[var(--pt-ink-soft)]" />
              </button>

              <div className="pt-eyebrow mb-2">Bandingkan Tahun</div>
              <h2 className="pt-display text-2xl sm:text-3xl text-[var(--pt-ink)] font-light leading-tight mb-1">
                Perubahan dari{" "}
                <select
                  value={baselineYear ?? ""}
                  onChange={(e) => setBaselineYear(Number(e.target.value))}
                  className="pt-display italic text-[var(--pt-accent)] bg-transparent border-b border-[var(--pt-accent)] cursor-pointer focus:outline-none px-1"
                >
                  {years.filter((y) => y !== filters.year).map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>{" "}
                ke <span className="pt-display italic text-[var(--pt-accent)]">{filters.year}</span>
              </h2>
              <div className="pt-mono text-[11px] text-[var(--pt-ink-faint)] mb-5">
                Diurutkan berdasarkan magnitude perubahan terbesar
              </div>

              {loading ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-10 bg-[var(--pt-canvas-deep)] animate-pulse rounded-xl" />
                  ))}
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--pt-border-strong)]">
                      <th className="text-left pt-eyebrow py-2">Kab/Kota</th>
                      <th className="text-right pt-eyebrow py-2 pr-3">{baselineYear}</th>
                      <th className="text-right pt-eyebrow py-2 pr-3">{filters.year}</th>
                      <th className="text-right pt-eyebrow py-2">Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((r) => (
                      <tr key={r.kdkab} className="border-b border-[var(--pt-border)] last:border-0">
                        <td className="py-2.5 pt-body text-[var(--pt-ink)]">{r.nama_kab}</td>
                        <td className="py-2.5 pt-mono text-right pr-3 tabular-nums text-[var(--pt-ink-soft)]">
                          {r.valueA == null ? "—" : fmtNumber(r.valueA)}
                        </td>
                        <td className="py-2.5 pt-mono text-right pr-3 tabular-nums text-[var(--pt-ink)]">
                          {r.valueB == null ? "—" : fmtNumber(r.valueB)}
                        </td>
                        <td className="py-2.5 pt-mono text-right tabular-nums text-xs">
                          {r.delta == null ? (
                            <span className="text-[var(--pt-ink-faint)]">—</span>
                          ) : (
                            <span style={{ color: r.delta >= 0 ? "var(--pt-delta-pos)" : "var(--pt-delta-neg)" }}>
                              {r.delta >= 0 ? "▲" : "▼"} {fmtNumber(Math.abs(r.delta))}
                              {r.pct != null && (
                                <span className="ml-1 opacity-70">
                                  ({r.pct >= 0 ? "+" : ""}{r.pct.toFixed(1)}%)
                                </span>
                              )}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
