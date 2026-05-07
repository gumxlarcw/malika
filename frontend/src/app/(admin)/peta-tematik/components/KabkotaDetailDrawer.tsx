"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { fmtNumber } from "../colorScale";
import type { DataResponse } from "../types";

interface Props {
  open: boolean;
  kdkab: string | null;
  namaKab: string | null;
  indikator: number | null;
  indikatorName: string;
  year: number | null;
  month: number | null;
  metric: string | null;
  onClose: () => void;
}

interface KabHistoryPoint {
  year: number;
  value: number | null;
  rank: number | null;
  totalKab: number;
}

/**
 * Slide-out drawer with kab/kota-specific data. Fetches recent years
 * for the selected indicator and computes per-year ranking.
 */
export default function KabkotaDetailDrawer({
  open, kdkab, namaKab, indikator, indikatorName, year, month, metric, onClose,
}: Props) {
  const [history, setHistory] = useState<KabHistoryPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Fetch last ~6 years of data for this kabkota
  useEffect(() => {
    if (!open || !kdkab || !indikator || !year) return;
    setLoading(true);
    setErr(null);
    (async () => {
      try {
        const yearsToFetch = [year - 5, year - 4, year - 3, year - 2, year - 1, year];
        const results = await Promise.all(
          yearsToFetch.map(async (y) => {
            const qs = new URLSearchParams({
              indikator: String(indikator),
              year: String(y),
            });
            if (month != null) qs.set("month", String(month));
            if (metric) qs.set("metric", metric);
            const r = await fetch(`/api/peta-tematik/data?${qs}`, { cache: "no-store" });
            if (!r.ok) return null;
            return r.json() as Promise<DataResponse>;
          }),
        );
        const points: KabHistoryPoint[] = [];
        for (let i = 0; i < yearsToFetch.length; i++) {
          const yr = yearsToFetch[i];
          const res = results[i];
          if (!res || !res.data) {
            points.push({ year: yr, value: null, rank: null, totalKab: 0 });
            continue;
          }
          const valid = res.data.filter((d) => d.value != null) as Array<{ kdkab: string; value: number }>;
          const sorted = [...valid].sort((a, b) => b.value - a.value);
          const rank = sorted.findIndex((d) => d.kdkab === kdkab);
          const found = res.data.find((d) => d.kdkab === kdkab);
          points.push({
            year: yr,
            value: found?.value ?? null,
            rank: rank >= 0 ? rank + 1 : null,
            totalKab: valid.length,
          });
        }
        setHistory(points);
      } catch (e) {
        console.error("drawer fetch:", e);
        setErr("Gagal memuat detail.");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, kdkab, indikator, year, month, metric]);

  // Block body scroll when open
  useEffect(() => {
    if (!open) return;
    const orig = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = orig; };
  }, [open]);

  // ESC key closes
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="peta-tematik-page">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-gray-900/40 backdrop-blur-[2px] z-[1500]"
          />
          {/* Drawer */}
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
            className="fixed top-0 right-0 bottom-0 w-full sm:w-[480px] bg-white dark:bg-gray-900 z-[1501]
                       border-l border-gray-300 dark:border-gray-700 shadow-2xl overflow-y-auto"
            role="dialog"
            aria-label={`Detail ${namaKab}`}
          >
            <DrawerContent
              namaKab={namaKab}
              indikatorName={indikatorName}
              history={history}
              year={year}
              loading={loading}
              err={err}
              onClose={onClose}
            />
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}

function DrawerContent({ namaKab, indikatorName, history, year, loading, err, onClose }: any) {
  const validHistory = history.filter((h: KabHistoryPoint) => h.value != null);
  const cur = history.find((h: KabHistoryPoint) => h.year === year);

  return (
    <div className="p-6 sm:p-8">
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 hover:bg-[var(--pt-canvas-deep)] rounded-xl transition-colors"
        aria-label="Tutup"
      >
        <X className="w-5 h-5 text-[var(--pt-ink-soft)]" />
      </button>

      {/* Header */}
      <div className="pt-eyebrow mb-2">Profil Kabupaten/Kota</div>
      <h2 className="pt-display text-3xl sm:text-4xl text-[var(--pt-ink)] font-light leading-tight">
        {namaKab}
      </h2>
      <div className="pt-mono text-xs text-[var(--pt-ink-faint)] mt-2 leading-relaxed">
        {indikatorName}
      </div>

      <hr className="my-6 border-t border-[var(--pt-border)]" />

      {loading && (
        <div className="space-y-3">
          <div className="h-24 bg-[var(--pt-canvas-deep)] animate-pulse rounded-xl" />
          <div className="h-32 bg-[var(--pt-canvas-deep)] animate-pulse rounded-xl" />
        </div>
      )}

      {err && (
        <div className="text-sm text-[var(--pt-delta-neg)] pt-body">{err}</div>
      )}

      {!loading && !err && (
        <>
          {/* Current year value */}
          {cur?.value != null ? (
            <div className="bg-[var(--pt-canvas-elevated)] border border-[var(--pt-border)] rounded-xl p-5">
              <div className="pt-eyebrow mb-2">Tahun {year}</div>
              <div className="pt-display text-5xl text-[var(--pt-ink)] tracking-tight font-light">
                {fmtNumber(cur.value)}
              </div>
              {cur.rank && (
                <div className="pt-body text-sm text-[var(--pt-ink-soft)] mt-3">
                  Peringkat <span className="pt-mono font-medium text-[var(--pt-accent)]">#{cur.rank}</span> dari {cur.totalKab} kab/kota
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-[var(--pt-ink-faint)] italic pt-body">Tidak ada data tahun ini.</div>
          )}

          {/* Historical timeline */}
          {validHistory.length >= 2 && (
            <div className="mt-6">
              <div className="pt-eyebrow mb-3">Riwayat 6 Tahun</div>
              <HistoryTable history={history} />
            </div>
          )}

          {/* Sparkline */}
          {validHistory.length >= 2 && <Sparkline history={history} />}
        </>
      )}

      {/* Footer link */}
      <div className="mt-8 pt-6 border-t border-[var(--pt-border)]">
        <div className="pt-eyebrow text-[10px]">Lihat juga</div>
        <a
          href="/kategori"
          className="block mt-2 pt-body text-sm text-[var(--pt-accent)] hover:underline"
        >
          → Data Statistik lengkap untuk indikator ini
        </a>
      </div>
    </div>
  );
}

function HistoryTable({ history }: { history: KabHistoryPoint[] }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {history.map((h, i) => {
          const prev = i > 0 ? history[i - 1] : null;
          let delta: number | null = null;
          if (h.value != null && prev?.value != null && prev.value !== 0) {
            delta = ((h.value - prev.value) / prev.value) * 100;
          }
          return (
            <tr key={h.year} className="border-b border-[var(--pt-border)] last:border-b-0">
              <td className="py-2.5 pt-mono text-[var(--pt-ink-soft)] tabular-nums">{h.year}</td>
              <td className="py-2.5 pt-mono text-[var(--pt-ink)] tabular-nums text-right pr-3">
                {h.value != null ? fmtNumber(h.value) : "—"}
              </td>
              <td className="py-2.5 pt-mono text-xs text-right w-20">
                {h.rank ? <span className="text-[var(--pt-ink-faint)]">#{h.rank}/{h.totalKab}</span> : <span className="text-[var(--pt-ink-faint)]">—</span>}
              </td>
              <td className="py-2.5 pt-mono text-xs text-right w-20">
                {delta != null ? (
                  <span style={{ color: delta >= 0 ? "var(--pt-delta-pos)" : "var(--pt-delta-neg)" }}>
                    {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
                  </span>
                ) : <span className="text-[var(--pt-ink-faint)]">—</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Sparkline({ history }: { history: KabHistoryPoint[] }) {
  const valid = history.filter((h) => h.value != null) as Array<{ year: number; value: number }>;
  if (valid.length < 2) return null;
  const W = 400, H = 80, P = 8;
  const xs = valid.map((p) => p.year);
  const ys = valid.map((p) => p.value);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const sx = (x: number) => P + ((x - xMin) / (xMax - xMin || 1)) * (W - 2 * P);
  const sy = (y: number) => H - P - ((y - yMin) / (yMax - yMin || 1)) * (H - 2 * P);
  const path = valid.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.year).toFixed(1)},${sy(p.value).toFixed(1)}`).join(" ");
  // Area fill under line
  const area = path + ` L${sx(xMax).toFixed(1)},${H - P} L${sx(xMin).toFixed(1)},${H - P} Z`;

  return (
    <div className="mt-6">
      <div className="pt-eyebrow mb-3">Tren Visual</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20">
        <defs>
          <linearGradient id="sparkArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--pt-accent)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--pt-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#sparkArea)" />
        <path d={path} stroke="var(--pt-accent)" strokeWidth="1.5" fill="none" />
        {valid.map((p) => (
          <circle key={p.year} cx={sx(p.year)} cy={sy(p.value)} r="2.5" fill="var(--pt-accent)" />
        ))}
      </svg>
    </div>
  );
}
