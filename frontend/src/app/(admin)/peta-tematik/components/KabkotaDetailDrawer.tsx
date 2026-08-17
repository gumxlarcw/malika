"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import DOMPurify from "dompurify";
import { X, BookOpen, Calculator, Building2, FileText } from "lucide-react";

// BPS metadata HTML (judul, sumber, formula) is already sanitized server-side
// by htmlUtils.sanitizeKeepInline. We sanitize again client-side as
// defense-in-depth — DOMPurify is fast enough that double-checking is free.
const SAFE_INLINE_TAGS = ["sup", "sub", "b", "strong", "i", "em", "br", "p"];
function safeHtml(html: string | null | undefined): string {
  if (!html) return "";
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: SAFE_INLINE_TAGS,
    ALLOWED_ATTR: [],
  });
}
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
  availableYears: number[];
  onClose: () => void;
}

interface KabHistoryPoint {
  year: number;
  value: number | null;
  rank: number | null;
  totalKab: number;
}

// Shape of /api/peta-tematik/indikator-meta/:id response — mirrors what the
// backend service `metadataLookup.getFullMeta` actually returns. Fields are
// often null for a given indikator; renderers must check before showing.
interface MetricMeta {
  metric_key: string;
  bps_column_id: string | null;
  metric_label_id: string | null;
  metric_label_en: string | null;
  metric_type: string;
  unit_id: string | null;
  unit_multiplier: number | null;
  unit_multiplier_desc: string | null;
  decimal_places: number;
  definition: string | null;
  utility: string | null;
  notes: string | null;
  interpretation: string | null;
  formula_html: string | null;
  cutoff_date: string | null;
}

interface IndikatorMeta {
  source_id: number;
  source_type: string;
  title_id_html: string | null;
  title_en_html: string | null;
  title_clean: string | null;
  subject_id: string | null;
  subject_label: string | null;
  bab: string | null;
  mms_subject: string | null;
  unit_id: string | null;
  unit_en: string | null;
  decimal_places: number | null;
  responsible_party: string | null;
  produced_by: string | null;
  source_citation_html: string | null;
  data_legend: Record<string, string> | null;
  bps_table_id: string | null;
  bps_var_id: number | null;
  cutoff_date: string | null;
  bps_last_update: string | null;
  fetched_at: string | null;
  definition: string | null;
  utility: string | null;
  notes: string | null;
  interpretation: string | null;
  metrics: MetricMeta[];
}

/**
 * Slide-out drawer with kab/kota-specific data. Fetches recent years
 * for the selected indicator and computes per-year ranking.
 */
export default function KabkotaDetailDrawer({
  open, kdkab, namaKab, indikator, indikatorName, year, month, metric, availableYears, onClose,
}: Props) {
  const [history, setHistory] = useState<KabHistoryPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [indikatorMeta, setIndikatorMeta] = useState<IndikatorMeta | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);

  // Fetch indicator metadata once per (open, indikator) combo. Independent of
  // history fetch because the data is per-indicator, not per-kab — caching it
  // separately avoids re-fetching when user pans across kab/kota.
  useEffect(() => {
    if (!open || !indikator) {
      setIndikatorMeta(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/peta-tematik/indikator-meta/${indikator}`, { cache: "no-store" });
        if (!r.ok) return;
        const data = await r.json();
        if (!cancelled && data?.meta) setIndikatorMeta(data.meta);
      } catch (e) {
        // Non-fatal — drawer still works without metadata, just shows less context
        console.warn("indikator-meta fetch:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [open, indikator]);

  // Fetch all available years for this kabkota — `availableYears` comes from
  // /api/peta-tematik/years (DISTINCT year FROM indikator_NNN), so we get the
  // indicator's full range, not just a fixed 6-year window. Fallback to the
  // 6-year window if the parent didn't supply years (e.g. years fetch failed).
  useEffect(() => {
    if (!open || !kdkab || !indikator || !year) return;
    setLoading(true);
    setErr(null);
    (async () => {
      try {
        const yearsToFetch = availableYears.length > 0
          ? [...availableYears].sort((a, b) => a - b)
          : [year - 5, year - 4, year - 3, year - 2, year - 1, year];
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
  }, [open, kdkab, indikator, year, month, metric, availableYears]);

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

  // Focus trap: keep Tab cycling inside drawer + auto-focus first control on
  // open. Selectors are re-queried per Tab so dynamically loaded content
  // (history, meta) gets included as soon as it renders.
  useEffect(() => {
    if (!open) return;
    const drawer = drawerRef.current;
    if (!drawer) return;
    const selectors = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const initial = drawer.querySelectorAll<HTMLElement>(selectors);
    initial[0]?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = Array.from(drawer.querySelectorAll<HTMLElement>(selectors));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    drawer.addEventListener("keydown", trap);
    return () => drawer.removeEventListener("keydown", trap);
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <div className="peta-tematik-page">
          {/* Backdrop — z above AppSidebar (z-[100000]) and AppHeader (z-[99999])
              so dim covers the chrome instead of being painted under it. */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-gray-900/50 backdrop-blur-[2px] z-[100001]"
          />
          {/* Drawer — sits one step above backdrop. Together they form a modal
              layer above the entire app shell. */}
          <motion.aside
            ref={drawerRef}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
            className="fixed top-0 right-0 bottom-0 w-full sm:w-[480px] bg-white dark:bg-gray-900 z-[100002]
                       border-l border-gray-300 dark:border-gray-700 shadow-2xl overflow-y-auto"
            role="dialog"
            aria-modal="true"
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
              indikatorMeta={indikatorMeta}
              activeMetric={metric}
              indikator={indikator}
              month={month}
            />
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}

function DrawerContent({
  namaKab, indikatorName, history, year, loading, err, onClose,
  indikatorMeta, activeMetric, indikator, month,
}: any) {
  const validHistory = history.filter((h: KabHistoryPoint) => h.value != null);
  const cur = history.find((h: KabHistoryPoint) => h.year === year);

  // Deep-link to the exact table — `/data?source_id=...` is the canonical route
  // (see app/(admin)/data/page.tsx). Mirror current filter state so the table
  // lands on the same period/metric the user was looking at on the map.
  const dataUrl = (() => {
    if (!indikator) return "/data";
    const params = new URLSearchParams({
      source_id: String(indikator),
      type: indikatorMeta?.source_type || "dynamic",
    });
    if (year) params.set("period", String(year));
    if (month != null) params.set("month", String(month));
    if (activeMetric) params.set("metric", activeMetric);
    return `/data?${params.toString()}`;
  })();

  // Resolve which metric to highlight in the metadata section. For
  // multi-metric indicators (interop with kolom, dynamic with turvar), match
  // by metric_key. For single-metric, just take the first non-text metric.
  const meta: IndikatorMeta | null = indikatorMeta;
  const metricRow: MetricMeta | null = (() => {
    if (!meta?.metrics?.length) return null;
    if (activeMetric && activeMetric !== "value") {
      const found = meta.metrics.find(
        (m: MetricMeta) =>
          m.metric_key === activeMetric ||
          (m.metric_label_id || "").toLowerCase() === activeMetric.toLowerCase(),
      );
      if (found) return found;
    }
    // Fallback: first numeric metric (skip text-typed columns like "Tahun SK")
    return meta.metrics.find((m: MetricMeta) => m.metric_type !== "text") || meta.metrics[0];
  })();

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

          {/* Historical timeline — label reflects actual count, not a hardcoded 6 */}
          {validHistory.length >= 2 && (
            <div className="mt-6">
              <div className="pt-eyebrow mb-3">
                Riwayat {history.length} Tahun
                {history.length > 0 && history[0].year && history[history.length - 1].year && (
                  <span className="text-[var(--pt-ink-faint)] font-normal normal-case ml-1">
                    ({history[0].year}–{history[history.length - 1].year})
                  </span>
                )}
              </div>
              <HistoryTable history={history} />
            </div>
          )}

          {/* Sparkline */}
          {validHistory.length >= 2 && <Sparkline history={history} />}

          {/* BPS-supplied metadata — definition, formula, legend, attribution */}
          {meta && <IndikatorMetaSection meta={meta} metric={metricRow} />}
        </>
      )}

      {/* Footer link — deep-link to the exact table for this indikator+period */}
      <div className="mt-8 pt-6 border-t border-[var(--pt-border)]">
        <div className="pt-eyebrow text-[10px]">Lihat juga</div>
        <a
          href={dataUrl}
          className="block mt-2 pt-body text-sm text-[var(--pt-accent)] hover:underline"
        >
          → Buka tabel lengkap indikator ini
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

/**
 * BPS-supplied metadata for the active indikator. Renders only what BPS
 * actually populated — empty sections are dropped so the drawer doesn't show
 * empty headers. HTML content is sanitized via DOMPurify (defense-in-depth).
 */
function IndikatorMetaSection({
  meta, metric,
}: {
  meta: IndikatorMeta;
  metric: MetricMeta | null;
}) {
  const hasIndDef = !!(meta.definition || meta.utility);
  const hasIndNotes = !!(meta.notes || meta.interpretation);
  const hasMetricDef = !!(metric?.definition || metric?.utility || metric?.notes || metric?.interpretation);
  const hasFormula = !!metric?.formula_html;
  const hasLegend = meta.data_legend && Object.keys(meta.data_legend).length > 0;
  const hasAttribution = !!(meta.responsible_party || meta.produced_by || meta.source_citation_html);
  const hasRefs = !!(meta.bps_table_id || meta.bps_var_id);
  const hasTimestamps = !!(meta.bps_last_update || meta.fetched_at || meta.cutoff_date);
  const topUnit = meta.unit_id || (!metric ? null : null);

  if (
    !hasIndDef && !hasIndNotes && !hasMetricDef && !hasFormula && !hasLegend &&
    !hasAttribution && !hasRefs && !hasTimestamps && !topUnit
  ) {
    return null;
  }

  return (
    <div className="mt-8 pt-6 border-t border-[var(--pt-border)] space-y-5">
      <div className="pt-eyebrow">Metadata BPS</div>

      {(meta.subject_label || meta.bab || meta.mms_subject) && (
        <div className="flex flex-wrap items-center gap-2">
          {meta.subject_label && (
            <span className="px-2 py-1 text-[11px] rounded-md bg-[var(--pt-canvas-deep)] text-[var(--pt-ink)] pt-mono">
              {meta.subject_label}
            </span>
          )}
          {meta.bab && meta.bab !== meta.subject_label && (
            <span className="px-2 py-1 text-[11px] rounded-md bg-[var(--pt-canvas-deep)] text-[var(--pt-ink-soft)] pt-mono">
              {meta.bab}
            </span>
          )}
          {meta.mms_subject && meta.mms_subject !== meta.subject_label && (
            <span className="px-2 py-1 text-[11px] rounded-md bg-[var(--pt-canvas-deep)] text-[var(--pt-ink-faint)] pt-mono">
              {meta.mms_subject}
            </span>
          )}
        </div>
      )}

      {/* Top-level unit (when no metric block — single-metric indikators may
          have unit_id at top instead of inside metrics[]) */}
      {meta.unit_id && !metric?.unit_id && (
        <div>
          <div className="pt-mono text-[10px] text-[var(--pt-ink-faint)] uppercase">Satuan</div>
          <div className="pt-body text-sm text-[var(--pt-ink)] mt-0.5">{meta.unit_id}</div>
        </div>
      )}

      {hasIndDef && (
        <div>
          <div className="flex items-center gap-2 pt-eyebrow mb-2">
            <BookOpen className="w-3 h-3" />
            Definisi
          </div>
          {meta.definition && (
            <p className="pt-body text-sm text-[var(--pt-ink)] leading-relaxed">{meta.definition}</p>
          )}
          {meta.utility && (
            <p className="pt-body text-sm text-[var(--pt-ink-soft)] leading-relaxed mt-2">
              <span className="pt-mono text-[11px] text-[var(--pt-ink-faint)] uppercase">Kegunaan:</span>{" "}
              {meta.utility}
            </p>
          )}
        </div>
      )}

      {/* Top-level catatan & interpretasi — often filled even when definition
          is null (e.g. indikator 184 has notes about Sensus Penduduk basis) */}
      {hasIndNotes && (
        <div>
          <div className="flex items-center gap-2 pt-eyebrow mb-2">
            <FileText className="w-3 h-3" />
            Catatan & Interpretasi
          </div>
          {meta.notes && (
            <p className="pt-body text-sm text-[var(--pt-ink)] leading-relaxed whitespace-pre-wrap">{meta.notes}</p>
          )}
          {meta.interpretation && (
            <p className="pt-body text-sm text-[var(--pt-ink-soft)] leading-relaxed mt-2">
              <span className="pt-mono text-[11px] text-[var(--pt-ink-faint)] uppercase">Cara membaca:</span>{" "}
              {meta.interpretation}
            </p>
          )}
        </div>
      )}

      {metric && (
        <div className="bg-[var(--pt-canvas-elevated)] border border-[var(--pt-border)] rounded-xl p-4 space-y-3">
          <div className="pt-eyebrow flex items-center gap-2">
            <Calculator className="w-3 h-3" />
            Komoditi: <span className="text-[var(--pt-accent)]">{metric.metric_label_id || metric.metric_key}</span>
          </div>

          <div className="grid grid-cols-3 gap-3 text-xs">
            <div>
              <div className="pt-mono text-[10px] text-[var(--pt-ink-faint)] uppercase">Satuan</div>
              <div className="pt-body text-[var(--pt-ink)] mt-0.5">{metric.unit_id || "—"}</div>
            </div>
            <div>
              <div className="pt-mono text-[10px] text-[var(--pt-ink-faint)] uppercase">Skala</div>
              <div className="pt-body text-[var(--pt-ink)] mt-0.5">
                {metric.unit_multiplier
                  ? `× 10${superscript(metric.unit_multiplier)}${metric.unit_multiplier_desc ? ` (${metric.unit_multiplier_desc})` : ""}`
                  : "—"}
              </div>
            </div>
            <div>
              <div className="pt-mono text-[10px] text-[var(--pt-ink-faint)] uppercase">Desimal</div>
              <div className="pt-body text-[var(--pt-ink)] mt-0.5">{metric.decimal_places}</div>
            </div>
          </div>

          {hasMetricDef && (
            <div className="pt-2 border-t border-[var(--pt-border)] space-y-2 text-sm pt-body text-[var(--pt-ink)]">
              {metric.definition && <p className="leading-relaxed">{metric.definition}</p>}
              {metric.utility && (
                <p className="text-[var(--pt-ink-soft)] leading-relaxed">
                  <span className="pt-mono text-[11px] uppercase text-[var(--pt-ink-faint)]">Kegunaan:</span>{" "}
                  {metric.utility}
                </p>
              )}
              {metric.notes && (
                <p className="text-[var(--pt-ink-soft)] leading-relaxed whitespace-pre-wrap">
                  <span className="pt-mono text-[11px] uppercase text-[var(--pt-ink-faint)]">Catatan:</span>{" "}
                  {metric.notes}
                </p>
              )}
              {metric.interpretation && (
                <p className="text-[var(--pt-ink-soft)] leading-relaxed">
                  <span className="pt-mono text-[11px] uppercase text-[var(--pt-ink-faint)]">Cara membaca:</span>{" "}
                  {metric.interpretation}
                </p>
              )}
            </div>
          )}

          {(metric.bps_column_id || metric.cutoff_date) && (
            <div className="pt-2 border-t border-[var(--pt-border)] flex flex-wrap gap-3 text-[11px] pt-mono text-[var(--pt-ink-faint)]">
              {metric.bps_column_id && (
                <span>
                  <span className="uppercase">Kolom BPS:</span>{" "}
                  <span className="text-[var(--pt-ink)]">{metric.bps_column_id}</span>
                </span>
              )}
              {metric.cutoff_date && (
                <span>
                  <span className="uppercase">Cutoff:</span>{" "}
                  <span className="text-[var(--pt-ink)]">{formatDateId(metric.cutoff_date)}</span>
                </span>
              )}
            </div>
          )}

          {hasFormula && (
            <div className="pt-2 border-t border-[var(--pt-border)]">
              <div className="pt-mono text-[11px] text-[var(--pt-ink-faint)] uppercase mb-1">Rumus</div>
              <div
                className="pt-body text-sm text-[var(--pt-ink)] leading-relaxed"
                dangerouslySetInnerHTML={{ __html: safeHtml(metric.formula_html) }}
              />
            </div>
          )}
        </div>
      )}

      {hasLegend && (
        <div>
          <div className="flex items-center gap-2 pt-eyebrow mb-2">
            <FileText className="w-3 h-3" />
            Catatan superscript
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            {Object.entries(meta.data_legend!).slice(0, 9).map(([code, desc]) => (
              <div key={code} className="contents">
                <dt className="pt-mono text-[var(--pt-accent)] tabular-nums">{code}</dt>
                <dd className="pt-body text-[var(--pt-ink-soft)]">{desc}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {hasAttribution && (
        <AttributionBlock meta={meta} />
      )}

      {/* BPS reference IDs — useful for citing or cross-referencing the table */}
      {hasRefs && (
        <div className="flex flex-wrap items-center gap-2">
          {meta.bps_table_id && (
            <span className="px-2 py-1 text-[11px] rounded-md border border-[var(--pt-border)] pt-mono text-[var(--pt-ink-soft)]">
              <span className="text-[var(--pt-ink-faint)]">Tabel BPS:</span>{" "}
              <span className="text-[var(--pt-ink)] tabular-nums">{meta.bps_table_id}</span>
            </span>
          )}
          {meta.bps_var_id != null && (
            <span className="px-2 py-1 text-[11px] rounded-md border border-[var(--pt-border)] pt-mono text-[var(--pt-ink-soft)]">
              <span className="text-[var(--pt-ink-faint)]">Var BPS:</span>{" "}
              <span className="text-[var(--pt-ink)] tabular-nums">{meta.bps_var_id}</span>
            </span>
          )}
          <span className="px-2 py-1 text-[11px] rounded-md border border-[var(--pt-border)] pt-mono text-[var(--pt-ink-soft)]">
            <span className="text-[var(--pt-ink-faint)]">ID MALIKA:</span>{" "}
            <span className="text-[var(--pt-ink)] tabular-nums">{meta.source_id}</span>
          </span>
        </div>
      )}

      {/* Freshness — bps_last_update is when BPS published; fetched_at is when
          MALIKA synced. cutoff_date is the data's reporting period cutoff. */}
      {hasTimestamps && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-mono text-[11px]">
          {meta.bps_last_update && (
            <div>
              <div className="text-[var(--pt-ink-faint)] uppercase">Update BPS</div>
              <div className="text-[var(--pt-ink)] mt-0.5">{formatDateId(meta.bps_last_update)}</div>
            </div>
          )}
          {meta.fetched_at && (
            <div>
              <div className="text-[var(--pt-ink-faint)] uppercase">Sinkronisasi MALIKA</div>
              <div className="text-[var(--pt-ink)] mt-0.5">{formatDateId(meta.fetched_at)}</div>
            </div>
          )}
          {meta.cutoff_date && (
            <div>
              <div className="text-[var(--pt-ink-faint)] uppercase">Cutoff data</div>
              <div className="text-[var(--pt-ink)] mt-0.5">{formatDateId(meta.cutoff_date)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Attribution block — separated so DOMPurify-sanitized HTML stays adjacent to
    its sanitizer call, makes future audits easier. */
function AttributionBlock({ meta }: { meta: IndikatorMeta }) {
  return (
    <div>
      <div className="flex items-center gap-2 pt-eyebrow mb-2">
        <Building2 className="w-3 h-3" />
        Sumber data
      </div>
      {meta.responsible_party && (
        <div className="pt-body text-sm text-[var(--pt-ink)] mb-1">{meta.responsible_party}</div>
      )}
      {meta.produced_by && meta.produced_by !== meta.responsible_party && (
        <div className="pt-body text-xs text-[var(--pt-ink-soft)] mb-1">
          <span className="pt-mono text-[10px] uppercase text-[var(--pt-ink-faint)]">Diproduksi oleh:</span>{" "}
          {meta.produced_by}
        </div>
      )}
      {meta.source_citation_html && (
        <div
          className="pt-body text-xs text-[var(--pt-ink-soft)] leading-relaxed [&_i]:italic"
          dangerouslySetInnerHTML={{ __html: safeHtml(meta.source_citation_html) }}
        />
      )}
    </div>
  );
}

function superscript(n: number): string {
  if (!Number.isFinite(n) || n < 0) return String(n);
  const map: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
  return String(n).split("").map((d) => map[d] ?? d).join("");
}

function formatDateId(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("id-ID", {
      day: "numeric", month: "long", year: "numeric",
    });
  } catch {
    return iso;
  }
}
