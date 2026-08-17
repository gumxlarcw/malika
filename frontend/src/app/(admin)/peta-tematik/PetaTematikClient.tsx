"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Command } from "cmdk";
import { BarChart3, ChevronDown, Search } from "lucide-react";
import ChoroplethMap from "./ChoroplethMap";
import EditorialHeader from "./components/EditorialHeader";
import AutoInsights from "./components/AutoInsights";
import KabkotaDetailDrawer from "./components/KabkotaDetailDrawer";
import TimeScrubber from "./components/TimeScrubber";
import ShareBar from "./components/ShareBar";
import LinkedBarChart from "./components/LinkedBarChart";
import CompareMode from "./components/CompareMode";
import CommandPalette from "./components/CommandPalette";
import EmbedModal from "./components/EmbedModal";
import ActiveIndikatorBanner from "./components/ActiveIndikatorBanner";
import BinningSelector from "./components/BinningSelector";
import MiniMapGrid from "./components/MiniMapGrid";
import MapLegend from "./components/MapLegend";
import FocusCard from "./components/FocusCard";
import YearMatrixTable from "./components/YearMatrixTable";
import { useYearMatrix } from "./useYearMatrix";
import { sparklinePoints } from "./panelData";
import { readUrlState, useSyncUrl } from "./useUrlState";
import { fmtNumber, computeBins, type BinningMethod, type PaletteId, PALETTES, DEFAULT_PALETTE, getPalette } from "./colorScale";
import "./styles.css";
import type {
  IndikatorList, YearsResponse, MetricsResponse,
  DataResponse, SummaryResponse, FilterState, IndikatorItem,
} from "./types";

// 13 Indikator Inti — shortcut group surfaced at the LEFT of META_GROUPS so
// reviewers can hit the canonical KPIs without hunting through kategori.
// Items are NOT removed from their original kategori; this is a curated view.
// IDs resolved 2026-05-20 from /peta-tematik/public/indikator-list:
//   450 = Persentase Penduduk Miskin (P0)
//   428 = Indeks Pembangunan Manusia (IPM)
//   201 = Tingkat Pengangguran Terbuka (TPT)
//   202 = Tingkat Partisipasi Angkatan Kerja (TPAK)
//   296 = PDRB per Kapita Atas Dasar Harga Berlaku
//     8 = Gini Rasio
//   251 = Pengeluaran Perkapita Riil Disesuaikan
//    13 = Harapan Lama Sekolah
//    16 = Rata-rata Lama Sekolah
//    11 = Umur Harapan Hidup (UHH)
//   182 = Kepadatan Penduduk
//   183 = Laju Pertumbuhan Penduduk
//   172 = Jumlah Perjalanan Wisatawan Nusantara (Kabupaten Asal)
const INDIKATOR_INTI_IDS: number[] = [450, 428, 201, 202, 296, 8, 251, 13, 16, 11, 182, 183, 172];

// Mega-groups — 1:1 mapping to backend's 8 kategori (from indicator_meta.kategori_pwa).
// `kategoris` is the list of backend kategori names that feed this mega-group;
// for the curated Inti, `sourceIds` overrides and filters by exact IDs.
// Order is semantic: demographic baseline → human development → economy → catch-all.
// `label` is the short display text in the chip; `fullLabel` is the full name
// shown as tooltip + used in screen reader / aria-label. Shortening keeps the
// chip row fitting in one line on common desktop widths without scrolling.
const META_GROUPS: { key: string; label: string; fullLabel?: string; emoji: string; kategoris: string[]; sourceIds?: number[] }[] = [
  { key: "indikator-inti", label: "13 Inti", fullLabel: "13 Indikator Inti", emoji: "⭐",
    kategoris: [], sourceIds: INDIKATOR_INTI_IDS },
  { key: "kependudukan", label: "Kependudukan", emoji: "👥", kategoris: ["Kependudukan"] },
  { key: "pendidikan", label: "Pendidikan", emoji: "🎓", kategoris: ["Pendidikan"] },
  { key: "kesehatan", label: "Kesehatan", emoji: "🏥", kategoris: ["Kesehatan"] },
  { key: "pembangunan-sosial", label: "Pembangunan", fullLabel: "Pembangunan & Sosial", emoji: "📊", kategoris: ["Pembangunan & Sosial"] },
  { key: "ekonomi", label: "Ekonomi", emoji: "💰", kategoris: ["Ekonomi"] },
  { key: "ketenagakerjaan", label: "Tenaga Kerja", fullLabel: "Ketenagakerjaan", emoji: "💼", kategoris: ["Ketenagakerjaan"] },
  { key: "pariwisata", label: "Pariwisata", fullLabel: "Pariwisata & Akomodasi", emoji: "🏖️", kategoris: ["Pariwisata & Akomodasi"] },
  { key: "lainnya", label: "Lainnya", emoji: "📦", kategoris: ["Lainnya"] },
];

const KAT_TO_META: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const meta of META_GROUPS) for (const k of meta.kategoris) m[k] = meta.key;
  return m;
})();
const metaForKategori = (k: string | undefined): string =>
  !k ? "lainnya" : KAT_TO_META[k] ?? "lainnya";

const MONTH_NAMES = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

interface ProcessedList {
  /** Map keyed by backend kategori name → eligible IndikatorItems. */
  kategoriMap: Record<string, IndikatorItem[]>;
  /** Reverse lookup: source ID → backend kategori name. */
  idToKategori: Map<number, string>;
  idToName: Map<number, string>;
  totalEligible: number;
}

function processList(elig: IndikatorList): ProcessedList {
  // Backend /indikator-list already groups by kategori; just normalize & sort.
  const kategoriMap: Record<string, IndikatorItem[]> = {};
  const idToKategori = new Map<number, string>();
  const idToName = new Map<number, string>();
  for (const [kat, items] of Object.entries(elig.kategori)) {
    const sorted = [...items].sort((a, b) => a.sourceName.localeCompare(b.sourceName, "id"));
    kategoriMap[kat] = sorted;
    for (const it of sorted) {
      idToKategori.set(it.sourceId, kat);
      idToName.set(it.sourceId, it.sourceName);
    }
  }
  return { kategoriMap, idToKategori, idToName, totalEligible: elig.totalEligible };
}

function metaCount(p: ProcessedList, metaKey: string): number {
  const meta = META_GROUPS.find((m) => m.key === metaKey);
  if (!meta) return 0;
  if (meta.sourceIds) {
    // Inti view: count IDs that survived eligibility filtering (some may have
    // dropped out of the eligible list, so the visible count can be < 13).
    return meta.sourceIds.filter((id) => p.idToKategori.has(id)).length;
  }
  return meta.kategoris.reduce((sum, k) => sum + (p.kategoriMap[k]?.length ?? 0), 0);
}

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export default function PetaTematikClient() {
  const [list, setList] = useState<IndikatorList | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedMeta, setSelectedMeta] = useState<string>(META_GROUPS[0].key);
  const [filters, setFilters] = useState<FilterState>({ indikator: null, year: null, month: null, metric: null });
  const [yearsResp, setYearsResp] = useState<YearsResponse | null>(null);
  const [metricsResp, setMetricsResp] = useState<MetricsResponse | null>(null);
  const [data, setData] = useState<DataResponse | null>(null);
  const [prevData, setPrevData] = useState<DataResponse | null>(null);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [yearsError, setYearsError] = useState<string | null>(null);
  const [yearsAttempt, setYearsAttempt] = useState(0);
  // Classification is the reader's choice again. It had been pinned to quantile
  // "per simplification", but quantile guarantees a roughly even spread of
  // colours whatever the data does — on a skewed indicator that invents a
  // gradient where the values have none. All three methods were already
  // implemented in colorScale; only the control had been taken away.
  const [binning, setBinning] = useState<BinningMethod>("quantile");
  const [paletteId, setPaletteId] = useState<PaletteId>(DEFAULT_PALETTE);
  /*
   * Legend class currently isolated on the map, stored with the classification
   * it was chosen under. "Class 3" means nothing once the method, indicator or
   * year changes, so the selection is derived away rather than reset in an
   * effect — which would leave one render showing the wrong regions highlighted.
   */
  const [bucketSel, setBucketSel] = useState<{ key: string; bucket: number | null }>({ key: "", bucket: null });
  const palette = useMemo(() => getPalette(paletteId), [paletteId]);

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerKab, setDrawerKab] = useState<{ kdkab: string; nama: string } | null>(null);

  // Linked hover (between map + bar chart)
  const [hoveredKdkab, setHoveredKdkab] = useState<string | null>(null);

  // URL state sync — write filters to URL on change (deep-linkable)
  useSyncUrl(filters, binning, paletteId);

  const processed = useMemo(() => (list ? processList(list) : null), [list]);

  useEffect(() => {
    fetchJson<IndikatorList>("/api/peta-tematik/indikator-list").then((d) => {
      setList(d);
      const proc = processList(d);

      // First check if URL has explicit state — that takes precedence over defaults
      const urlState = readUrlState();
      if (urlState?.palette) setPaletteId(urlState.palette);
      if (urlState?.filters?.indikator && proc.idToKategori.has(urlState.filters.indikator)) {
        setFilters((f) => ({ ...f, ...urlState.filters }));
        setSelectedMeta(metaForKategori(proc.idToKategori.get(urlState.filters.indikator)));
        return;
      }

      /*
       * No indicator is chosen for the reader.
       *
       * This used to fall back to the first item of the first non-empty group,
       * which meant the page opened on an arbitrary indicator — a real map, with
       * real figures, that nobody asked to see. On a portal of 196 indicators
       * that reads as an editorial claim about which one matters. The map stays
       * empty until a choice is made; a URL that names one still deep-links
       * straight to it, handled above.
       */
    }).catch((e) => {
      console.error(e);
      setListError("Gagal memuat daftar indikator.");
    });
  }, []);

  useEffect(() => {
    if (!filters.indikator) return;
    // Stale-guard: rapid indikator switches must not let an earlier response
    // overwrite the current selection's state.
    const currentIndikator = filters.indikator;
    let cancelled = false;
    setYearsResp(null); setMetricsResp(null); setYearsError(null);
    Promise.all([
      fetchJson<YearsResponse>(`/api/peta-tematik/years?indikator=${currentIndikator}`),
      fetchJson<MetricsResponse>(`/api/peta-tematik/metrics?indikator=${currentIndikator}`),
    ]).then(([y, m]) => {
      if (cancelled) return;
      setYearsResp(y); setMetricsResp(m);
      const latest = y.years[y.years.length - 1];
      const preferred = m.metrics.includes("value") ? "value" : m.metrics[0];
      setFilters((f) =>
        f.indikator !== currentIndikator
          ? f
          : { ...f, year: latest ?? null, month: y.has_monthly ? 12 : null, metric: preferred ?? null },
      );
    }).catch((e) => {
      if (cancelled) return;
      console.error(e);
      setYearsError("Gagal memuat data tahun untuk indikator ini.");
    });
    return () => { cancelled = true; };
  }, [filters.indikator, yearsAttempt]);

  const filterKey = `${filters.indikator}-${filters.year}-${filters.month ?? 0}-${filters.metric ?? "*"}`;
  useEffect(() => {
    if (!filters.indikator || !filters.year) return;
    setLoadingData(true);
    const qs = new URLSearchParams({ indikator: String(filters.indikator), year: String(filters.year) });
    if (filters.month != null) qs.set("month", String(filters.month));
    if (filters.metric) qs.set("metric", filters.metric);
    const prevQs = new URLSearchParams(qs);
    prevQs.set("year", String(filters.year - 1));
    Promise.all([
      fetchJson<DataResponse>(`/api/peta-tematik/data?${qs}`),
      fetchJson<SummaryResponse>(`/api/peta-tematik/summary?${qs}`),
      fetchJson<DataResponse>(`/api/peta-tematik/data?${prevQs}`).catch(() => null),
    ]).then(([d, s, p]) => { setData(d); setSummary(s); setPrevData(p); })
      .catch((e) => console.error(e))
      .finally(() => setLoadingData(false));
  }, [filterKey, filters.indikator, filters.year, filters.month, filters.metric]);

  const handlePolygonClick = useCallback((kdkab: string, nama: string) => {
    setDrawerKab({ kdkab, nama });
    setDrawerOpen(true);
  }, []);

  const indikatorName = filters.indikator && processed ? processed.idToName.get(filters.indikator) ?? "" : "";

  /*
   * Periods for the comparison panels.
   *
   * Capped at the five most recent published years: each one is a separate
   * query, and a source with twenty years of history would otherwise fan out to
   * twenty requests to draw thumbnails. `years_empty` is excluded because a year
   * that is listed but holds nothing renders as a blank map for no stated reason.
   */
  const panelYears = useMemo(() => {
    if (!yearsResp?.years?.length) return [];
    const empty = new Set(yearsResp.years_empty ?? []);
    return yearsResp.years.filter((y) => !empty.has(y)).slice(-5);
  }, [yearsResp]);

  const { matrix } = useYearMatrix(filters.indikator, panelYears, filters.metric);

  /** Breaks for the active year, shared by the legend and the map. */
  const legendBreaks = useMemo(() => {
    const values = (data?.data ?? []).map((d) => d.value).filter((v): v is number => v != null);
    return values.length ? computeBins(values, binning, 5) : [];
  }, [data, binning]);

  const activeYearValues = useMemo(() => (data?.data ?? []).map((d) => d.value ?? null), [data]);
  const selectedKode = drawerKab ? `82${drawerKab.kdkab}` : null;

  const bucketKey = `${binning}|${filters.indikator}|${filters.year}`;
  const activeBucket = bucketSel.key === bucketKey ? bucketSel.bucket : null;
  const setActiveBucket = (bucket: number | null) => setBucketSel({ key: bucketKey, bucket });

  if (listError) {
    return (
      <div className="peta-tematik-page min-w-0">
        <div className="rounded-2xl border border-red-200 bg-red-50/50 p-6 text-sm text-red-700">
          {listError}
        </div>
      </div>
    );
  }

  if (!processed) {
    return (
      <div className="peta-tematik-page min-w-0">
        <div className="h-[60vh] bg-gray-100 dark:bg-gray-800 animate-pulse rounded-2xl" />
      </div>
    );
  }

  const toolbar = filters.indikator && filters.year && data?.data && yearsResp ? (
    <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
      {yearsResp.years.length >= 2 && (
        <CompareMode filters={filters} years={yearsResp.years} dataA={data.data} />
      )}
      <EmbedModal filters={filters} binning={binning} indikatorName={indikatorName} />
      <ShareBar
        filters={filters}
        binning={binning}
        palette={palette}
        data={data.data}
        meta={data.meta ?? null}
        indikatorName={indikatorName}
        kategori={processed.idToKategori.get(filters.indikator) ?? "Lainnya"}
      />
    </div>
  ) : null;

  return (
    <div className="peta-tematik-page min-w-0">
      <EditorialHeader totalIndikator={processed.totalEligible} actions={toolbar} />

      {/* Filter card — mega chips + indikator + waktu */}
      <section className="mb-6 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-theme-xs overflow-hidden">
        {/* Row 1: mega-group chips — wraps to next line on narrow viewports
            instead of horizontal scroll. Labels were also shortened (e.g.
            "Pariwisata & Akomodasi" → "Pariwisata") so 9 chips fit one row on
            common desktop widths (≥1100px content area). */}
        <div className="px-4 pt-4 pb-3 border-b border-gray-100 dark:border-gray-700">
          <div className="flex flex-wrap items-center gap-1.5">
            {META_GROUPS.map((meta) => {
              const count = metaCount(processed, meta.key);
              if (count === 0) return null;
              const active = selectedMeta === meta.key;
              const isInti = meta.key === "indikator-inti";
              // Inti chip uses amber to distinguish the curated shortcut from
              // regular kategori chips (blue). Active/inactive states differ.
              const chipClass = active
                ? isInti
                  ? "bg-amber-500 text-white border-amber-500 shadow-sm"
                  : "bg-[#465fff] text-white border-[#465fff] shadow-sm"
                : isInti
                  ? "bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/40"
                  : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700";
              const tooltip = isInti
                ? "13 indikator inti pembangunan daerah — shortcut tidak menghapus dari kategori asli"
                : meta.fullLabel ?? undefined;
              return (
                <button
                  key={meta.key}
                  onClick={() => setSelectedMeta(meta.key)}
                  className={`flex-shrink-0 inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full text-[12px] font-medium transition-all border ${chipClass}`}
                  title={tooltip}
                  aria-label={meta.fullLabel ?? meta.label}
                >
                  <span className="opacity-90">{meta.emoji}</span>
                  <span>{meta.label}</span>
                  <span
                    className={`ml-0.5 text-[10px] tabular-nums px-1.5 py-0 rounded-full ${
                      active
                        ? "bg-white/20 text-white"
                        : isInti
                          ? "bg-amber-200 dark:bg-amber-800/50 text-amber-900 dark:text-amber-100"
                          : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Row 2: indikator (own row, full width for truncate) → row 3: tahun + filters
            Vertical stack avoids height-mismatch alignment issues between the
            indikator picker (h-12) and the slimmer year/month/metric/palette
            controls (h-10), and gives the year pills a `flex-1 min-w-0` parent
            so its `overflow-x-auto` actually engages when there are many years. */}
        <div className="p-4 space-y-3">
          <div className="min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5">
              Indikator
            </div>
            <IndikatorPicker
              processed={processed}
              value={filters.indikator}
              metaKey={selectedMeta}
              onChange={(id) => {
                setFilters((f) => ({ ...f, indikator: id, year: null, month: null, metric: null }));
                // Preserve "Indikator Inti" view if the picked id is one of them.
                // Otherwise switch the chips back to the indikator's home kategori
                // so the picker dropdown lists relevant peers next time.
                const inIntiView = selectedMeta === "indikator-inti" && INDIKATOR_INTI_IDS.includes(id);
                if (!inIntiView) {
                  setSelectedMeta(metaForKategori(processed.idToKategori.get(id)));
                }
              }}
            />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            {filters.indikator && (
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5">
                  Tahun
                </div>
                {yearsError ? (
                  <div className="inline-flex items-center gap-2 h-10 px-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-[12.5px] text-red-700 dark:text-red-300">
                    <span>{yearsError}</span>
                    <button
                      type="button"
                      onClick={() => setYearsAttempt((n) => n + 1)}
                      className="px-2 py-0.5 rounded bg-red-100 dark:bg-red-900/50 hover:bg-red-200 dark:hover:bg-red-800/50 text-red-700 dark:text-red-200 text-[11px] font-medium"
                    >
                      Coba lagi
                    </button>
                  </div>
                ) : !yearsResp ? (
                  <div className="h-10 w-56 rounded-lg bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 animate-pulse" />
                ) : yearsResp.years.length > 0 ? (
                  <YearPills
                    years={yearsResp.years}
                    emptyYears={yearsResp.years_empty ?? []}
                    value={filters.year}
                    onChange={(y) => setFilters((f) => ({ ...f, year: y }))}
                  />
                ) : (
                  <div className="h-10 px-3 inline-flex items-center text-[12.5px] text-gray-500 italic">
                    Tidak ada data tahun
                  </div>
                )}
              </div>
            )}
            {yearsResp?.has_monthly && filters.year && (
              <div>
                <div className="text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5">
                  Bulan
                </div>
                <select
                  value={filters.month ?? ""}
                  onChange={(e) => setFilters((f) => ({ ...f, month: Number(e.target.value) }))}
                  className="h-10 px-3 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 text-[12.5px] font-medium text-gray-700 dark:text-gray-200"
                >
                  <option value="" disabled>Bulan…</option>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>{MONTH_NAMES[m]}</option>
                  ))}
                </select>
              </div>
            )}
            {(metricsResp?.metrics.length ?? 0) > 1 && metricsResp && (
              <div className="min-w-0">
                <div className="text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5">
                  Komoditi
                </div>
                <select
                  value={filters.metric ?? ""}
                  onChange={(e) => setFilters((f) => ({ ...f, metric: e.target.value }))}
                  className="h-10 px-3 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 text-[12.5px] font-medium text-gray-700 dark:text-gray-200 max-w-[14rem]"
                >
                  {metricsResp.metrics.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            )}
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5">
                Warna
              </div>
              <PalettePicker value={paletteId} onChange={setPaletteId} />
            </div>
          </div>
        </div>
      </section>

      {/* Active Indikator Banner — anchor visual untuk state saat ini */}
      {filters.indikator && indikatorName && (
        <div className="mb-4">
          <ActiveIndikatorBanner
            kategori={processed.idToKategori.get(filters.indikator) ?? "Lainnya"}
            indikatorName={indikatorName}
            year={filters.year}
            month={filters.month}
            metric={filters.metric}
            totalKabkota={data?.data?.length}
            validCount={data?.data?.filter((d) => d.value != null).length}
            yearsRange={
              yearsResp && yearsResp.years.length >= 2
                ? { min: yearsResp.years[0], max: yearsResp.years[yearsResp.years.length - 1] }
                : null
            }
            satuan={data?.meta?.unit ?? null}
            responsibleParty={data?.meta?.responsible_party ?? null}
          />
        </div>
      )}

      {/* Auto Insights */}
      {data && summary && filters.year && (
        <section className="mb-6">
          <AutoInsights data={data.data} summary={summary} year={filters.year} />
        </section>
      )}

      {/* Map + Provinsi panel */}
      <div id="peta-tematik-export-area" className="space-y-4">
        {filters.indikator && filters.year ? (
          <>
          {/*
            Reading order: what the province as a whole did, then how it is
            spread, then the key to the colours — all before the map that uses
            them. The map then sits beside the ranking it is a picture of, so
            "which shape is that?" and "where does it place?" are one glance
            apart instead of stacked in a rail.
          */}
          {/* Stretched, not items-start: each card fills the row and distributes
              its own content, so the three end level with no white below. */}
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            <ProvinsiTotalCard summary={summary} year={filters.year} />

            {matrix && (
              <FocusCard
                matrix={matrix}
                activeYear={filters.year}
                selectedKode={selectedKode}
                indicatorName={indikatorName}
                unit={data?.meta?.unit ?? null}
              />
            )}

            {legendBreaks.length > 0 && (
              /* Three cards in a two-column grid leave the third alone with an
                 empty cell beside it, so at `md` the legend takes the whole row. */
              <div className="flex flex-col rounded-2xl border border-[var(--pt-border)] bg-[var(--pt-canvas)] p-4 md:col-span-2 lg:col-span-1">
                <MapLegend
                  values={activeYearValues}
                  breaks={legendBreaks}
                  paletteId={paletteId}
                  binning={binning}
                  unit={data?.meta?.unit ?? null}
                  activeBucket={activeBucket}
                  onPickBucket={setActiveBucket}
                  noDataCount={activeYearValues.filter((v) => v == null).length}
                />
              </div>
            )}
          </div>

          {/* Stretched: the ranking fills the map's height and spreads its ten
              rows through the slack. The map's own height is clamped so it
              cannot outrun the ranking on a tall screen — see ChoroplethMap. */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-theme-xs overflow-hidden">
              {/* Map header bar */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-700">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[#3641f5] dark:text-blue-400">
                    Distribusi Spasial
                  </div>
                  <div className="text-[12.5px] text-gray-500 dark:text-gray-400 truncate">
                    10 kabupaten/kota Provinsi Maluku Utara
                  </div>
                </div>
                <div className="hidden sm:block text-[11px] text-gray-400 dark:text-gray-500 italic">
                  Klik wilayah untuk detail
                </div>
              </div>
              {/* Map area */}
              <div className="relative">
                <ChoroplethMap
                  data={data?.data ?? []}
                  prevData={prevData?.data ?? []}
                  filterKey={filterKey}
                  binning={binning}
                  palette={palette}
                  hoveredKdkab={hoveredKdkab}
                  activeBucket={activeBucket}
                  onPolygonClick={handlePolygonClick}
                  onPolygonHover={setHoveredKdkab}
                />
                {loadingData && (
                  <div className="absolute inset-0 bg-white/60 dark:bg-gray-900/60 backdrop-blur-sm flex items-center justify-center pointer-events-none">
                    <div className="text-xs uppercase tracking-wider text-gray-600 dark:text-gray-300">Memuat…</div>
                  </div>
                )}
                {!loadingData && data?.data && data.data.every((d) => d.value == null) && (
                  <div className="absolute top-3 right-3 z-[1000] bg-amber-50 border border-amber-200 text-amber-700 text-xs px-3 py-2 rounded-lg shadow">
                    Tidak ada data BPS untuk kombinasi ini. Coba tahun lain.
                  </div>
                )}
              </div>
            </div>
            <aside className="lg:col-span-1">
              <LinkedBarChart
                data={data?.data ?? []}
                binning={binning}
                palette={palette}
                hoveredKdkab={hoveredKdkab}
                onHover={setHoveredKdkab}
                onSelect={handlePolygonClick}
              />
            </aside>
          </div>
          </>
        ) : (
          <div className="rounded-xl border border-[var(--pt-border)] bg-[var(--pt-canvas-elevated)] p-8 text-center pt-body text-[var(--pt-ink-soft)]">
            Pilih indikator dan tahun untuk menampilkan peta.
          </div>
        )}
      </div>

      {/* Toolbar */}
      {/* Time scrubber — animated year navigation */}
      {yearsResp && yearsResp.years.length >= 2 && filters.year != null && (
        <div className="mt-5">
          <TimeScrubber
            years={yearsResp.years}
            value={filters.year}
            onChange={(y) => setFilters((f) => ({ ...f, year: y }))}
          />
        </div>
      )}

      {filters.indikator && legendBreaks.length > 0 && (
        <div className="mt-5">
          <BinningSelector value={binning} onChange={setBinning} />
        </div>
      )}

      {matrix && matrix.years.length >= 2 && filters.year != null && (
        <section className="mt-6 rounded-2xl border border-[var(--pt-border)] bg-[var(--pt-canvas)] p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 className="pt-display text-[15px] font-semibold text-[var(--pt-ink)]">Perubahan antar tahun</h2>
              <p className="pt-body mt-0.5 text-[12px] text-[var(--pt-ink-faint)]">
                Satu peta per periode, klasifikasi mengikuti tahun aktif. Klik untuk pindah periode.
              </p>
            </div>
            <span className="pt-mono text-[11px] text-[var(--pt-ink-faint)]">{indikatorName}</span>
          </div>
          <div className="mt-3">
            <MiniMapGrid
              matrix={matrix}
              activeYear={filters.year}
              onPickYear={(y) => setFilters((f) => ({ ...f, year: y }))}
              binning={binning}
              paletteId={paletteId}
              selectedKode={selectedKode}
            />
          </div>
        </section>
      )}

      {matrix && matrix.rows.length > 0 && filters.year != null && (
        <div className="mt-6">
          <YearMatrixTable
            matrix={matrix}
            activeYear={filters.year}
            indicatorName={indikatorName}
            unit={data?.meta?.unit ?? null}
            binning={binning}
            paletteId={paletteId}
            selectedKode={selectedKode}
            onPickRegion={(kode) => {
              if (!kode) {
                setDrawerOpen(false);
                return;
              }
              const row = matrix.rows.find((r) => r.kode === kode);
              if (row) handlePolygonClick(kode.slice(2), row.nama_kab);
            }}
          />
        </div>
      )}

      {/* Footer attribution — single line per design app.jsx */}
      <footer className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700 flex flex-wrap items-center justify-between gap-3 text-[11.5px] text-gray-500 dark:text-gray-400">
        <div>
          Sumber data:{" "}
          <span className="font-medium text-gray-700 dark:text-gray-200">BPS Provinsi Maluku Utara</span>
          {" · "}Disajikan oleh MALIKA AI Assistant
        </div>
        <div className="flex items-center gap-3">
          <a href="https://malukuutara.bps.go.id" target="_blank" rel="noreferrer" className="hover:text-gray-700 dark:hover:text-gray-200">
            BPS Maluku Utara
          </a>
          <a href="/data" className="hover:text-gray-700 dark:hover:text-gray-200">Statistik Lengkap</a>
          <a href="/" className="hover:text-gray-700 dark:hover:text-gray-200">Tentang MALIKA</a>
        </div>
      </footer>

      {/* Click-polygon detail drawer */}
      <KabkotaDetailDrawer
        open={drawerOpen}
        kdkab={drawerKab?.kdkab ?? null}
        namaKab={drawerKab?.nama ?? null}
        indikator={filters.indikator}
        indikatorName={indikatorName}
        year={filters.year}
        month={filters.month}
        metric={filters.metric}
        availableYears={yearsResp?.years ?? []}
        onClose={() => setDrawerOpen(false)}
      />

      {/* Cmd+K command palette — global keyboard shortcut */}
      <CommandPalette
        processed={processed}
        years={yearsResp?.years ?? []}
        onPickIndikator={(id) => {
          setFilters((f) => ({ ...f, indikator: id, year: null, month: null, metric: null }));
          setSelectedMeta(metaForKategori(processed.idToKategori.get(id)));
        }}
        onPickYear={(y) => setFilters((f) => ({ ...f, year: y }))}
      />
    </div>
  );
}

interface PalettePickerProps {
  value: PaletteId;
  onChange: (id: PaletteId) => void;
}

function PalettePicker({ value, onChange }: PalettePickerProps) {
  const ids = Object.keys(PALETTES) as PaletteId[];
  return (
    <div
      role="radiogroup"
      aria-label="Pilih warna peta"
      className="flex items-center gap-1 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-1"
    >
      {ids.map((id) => {
        const p = PALETTES[id];
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={p.label}
            title={p.label}
            onClick={() => onChange(id)}
            className={`h-8 w-8 rounded-md flex items-center justify-center transition-all ${
              active
                ? "ring-2 ring-offset-1 ring-offset-white dark:ring-offset-gray-900 ring-gray-900 dark:ring-white shadow-sm"
                : "hover:scale-105"
            }`}
            style={{
              background: `linear-gradient(135deg, ${p.colors[0]} 0%, ${p.colors[2]} 50%, ${p.colors[4]} 100%)`,
            }}
          >
            <span className="sr-only">{p.label}</span>
          </button>
        );
      })}
    </div>
  );
}

interface YearPillsProps {
  years: number[];
  emptyYears?: number[];
  value: number | null;
  onChange: (y: number) => void;
}

function YearPills({ years, emptyYears = [], value, onChange }: YearPillsProps) {
  const emptySet = new Set(emptyYears);
  return (
    <div className="flex items-center gap-1 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-1 max-w-full overflow-x-auto">
      {years.map((y) => {
        const active = value === y;
        const empty = emptySet.has(y);
        // Empty years: red-tinted button. Active state still wins visually so
        // user sees they've selected an empty year (with red ring/text accent).
        const className = active
          ? empty
            ? "flex-shrink-0 h-8 px-2.5 rounded-md text-[12.5px] font-medium tabular-nums transition-colors bg-red-500 text-white shadow-sm ring-2 ring-red-300"
            : "flex-shrink-0 h-8 px-2.5 rounded-md text-[12.5px] font-medium tabular-nums transition-colors bg-[#465fff] text-white shadow-sm"
          : empty
            ? "flex-shrink-0 h-8 px-2.5 rounded-md text-[12.5px] font-medium tabular-nums transition-colors bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/50"
            : "flex-shrink-0 h-8 px-2.5 rounded-md text-[12.5px] font-medium tabular-nums transition-colors text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-gray-800";
        return (
          <button
            key={y}
            type="button"
            onClick={() => onChange(y)}
            className={className}
            title={empty ? "Tahun ini tidak punya data untuk kabupaten/kota" : undefined}
          >
            {y}
          </button>
        );
      })}
    </div>
  );
}

function ProvinsiTotalCard({ summary, year }: { summary: SummaryResponse | null; year: number }) {
  if (!summary) {
    return <div className="h-24 bg-[var(--pt-canvas-deep)] animate-pulse rounded-xl" />;
  }
  const total = summary.provinsi_total;
  const prevTotal = summary.trend.length >= 2 ? summary.trend[summary.trend.length - 2].provinsi_total : null;
  let deltaEl = null;
  if (total != null && prevTotal != null && prevTotal !== 0) {
    const delta = total - prevTotal;
    const pct = (delta / prevTotal) * 100;
    const arrow = delta >= 0 ? "▲" : "▼";
    const color = delta >= 0 ? "var(--pt-delta-pos)" : "var(--pt-delta-neg)";
    deltaEl = (
      <div className="pt-mono mt-2 text-xs" style={{ color }}>
        {arrow} {fmtNumber(delta)} ({pct.toFixed(1)}%) dari {year - 1}
      </div>
    );
  }
  /*
   * The provincial series, already in the summary payload.
   *
   * Without it this card held a label, a number and a change line, and pinning
   * the change line to the floor to match the row's height just moved the empty
   * space into the middle. The five-year line is the figure's own context and
   * costs no extra request.
   */
  const trendValues = summary.trend.map((t) => t.provinsi_total);
  const spark = sparklinePoints(trendValues);

  return (
    <div className="flex h-full flex-col bg-[var(--pt-canvas-elevated)] border border-[var(--pt-border)] rounded-xl p-5">
      <div className="pt-eyebrow mb-2">Provinsi · Maluku Utara</div>
      <div className="pt-display text-4xl text-[var(--pt-ink)] font-light tracking-tight tabular-nums">
        {total != null ? fmtNumber(total) : "—"}
      </div>
      <div className="pt-mono text-[11px] text-[var(--pt-ink-faint)] mt-1">tahun {year}</div>
      {deltaEl}

      {spark ? (
        <div className="mt-auto pt-3">
          <svg viewBox="0 0 100 34" width="100%" height="40" preserveAspectRatio="none" className="block overflow-visible" aria-hidden>
            <polyline
              points={spark.points}
              fill="none"
              stroke="var(--pt-accent)"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={spark.lastX} cy={spark.lastY} r="2.2" fill="var(--pt-accent)" stroke="var(--pt-canvas-elevated)" strokeWidth="1.2" />
          </svg>
          <div className="pt-mono flex justify-between text-[10px] text-[var(--pt-ink-faint)]">
            <span>{summary.trend[0]?.year}</span>
            <span>{summary.trend[summary.trend.length - 1]?.year}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface PickerProps {
  processed: ProcessedList;
  value: number | null;
  metaKey: string;
  onChange: (id: number) => void;
}

function IndikatorPicker({ processed, value, metaKey, onChange }: PickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [mounted, setMounted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const update = () => {
      const r = buttonRef.current!.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  // Build the kategori → items view for the active meta-group. For curated
  // groups with `sourceIds` (Indikator Inti), surface ONLY the listed IDs but
  // keep them grouped under their original kategori — that preserves context
  // without removing items from where they natively belong.
  const viewKategoriMap = useMemo(() => {
    const meta = META_GROUPS.find((m) => m.key === metaKey);
    if (!meta) return {} as Record<string, IndikatorItem[]>;
    if (meta.sourceIds) {
      const idSet = new Set(meta.sourceIds);
      const map: Record<string, IndikatorItem[]> = {};
      for (const [kat, items] of Object.entries(processed.kategoriMap)) {
        const matched = items.filter((it) => idSet.has(it.sourceId));
        if (matched.length > 0) map[kat] = matched;
      }
      return map;
    }
    const map: Record<string, IndikatorItem[]> = {};
    for (const kat of meta.kategoris) {
      if (processed.kategoriMap[kat]?.length) map[kat] = processed.kategoriMap[kat];
    }
    return map;
  }, [processed, metaKey]);

  const selectedName = useMemo(() => {
    for (const items of Object.values(processed.kategoriMap)) {
      const f = items.find((it) => it.sourceId === value);
      if (f) return f.sourceName;
    }
    return "Pilih indikator…";
  }, [processed, value]);

  const popup = open && pos && mounted ? createPortal(
    <div className="peta-tematik-page">
      <div className="fixed inset-0 z-[9998]" onClick={() => setOpen(false)} />
      <Command
        className="fixed z-[9999] bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl shadow-2xl overflow-hidden"
        style={{ top: pos.top, left: pos.left, width: pos.width, maxWidth: "calc(100vw - 24px)" }}
      >
        <div className="flex items-center gap-2 px-3 border-b border-[var(--pt-border)]">
          <Search className="w-4 h-4 text-[var(--pt-ink-faint)]" />
          <Command.Input
            placeholder="Cari indikator…"
            value={query}
            onValueChange={setQuery}
            className="w-full py-2.5 pt-body text-sm bg-transparent outline-none text-[var(--pt-ink)] placeholder:text-[var(--pt-ink-faint)]"
            autoFocus
          />
        </div>
        <Command.List className="max-h-[400px] overflow-y-auto py-2">
          <Command.Empty className="py-4 text-center text-sm pt-body text-[var(--pt-ink-faint)]">
            Tidak ada hasil.
          </Command.Empty>
          {Object.keys(viewKategoriMap).map((kategori) => (
            <Command.Group
              key={kategori}
              heading={`${kategori} · ${viewKategoriMap[kategori].length}`}
              className="
                [&_[cmdk-group-heading]]:px-3
                [&_[cmdk-group-heading]]:py-2
                [&_[cmdk-group-heading]]:mt-1
                [&_[cmdk-group-heading]]:text-[11px]
                [&_[cmdk-group-heading]]:font-semibold
                [&_[cmdk-group-heading]]:uppercase
                [&_[cmdk-group-heading]]:tracking-wider
                [&_[cmdk-group-heading]]:text-[var(--pt-accent)]
                [&_[cmdk-group-heading]]:bg-blue-50
                dark:[&_[cmdk-group-heading]]:bg-blue-950/40
                [&_[cmdk-group-heading]]:border-l-2
                [&_[cmdk-group-heading]]:border-[var(--pt-accent)]
                [&_[cmdk-group-heading]]:sticky
                [&_[cmdk-group-heading]]:top-0
                [&_[cmdk-group-heading]]:z-10
              "
            >
              {viewKategoriMap[kategori].map((item) => (
                <Command.Item
                  key={item.sourceId}
                  value={item.sourceName}
                  onSelect={() => {
                    onChange(item.sourceId);
                    setOpen(false);
                    setQuery("");
                  }}
                  className="px-3 py-2 pt-body text-sm cursor-pointer text-[var(--pt-ink)] aria-selected:bg-[var(--pt-canvas-deep)] aria-selected:text-[var(--pt-accent)]"
                >
                  {item.sourceName}
                </Command.Item>
              ))}
            </Command.Group>
          ))}
        </Command.List>
      </Command>
    </div>,
    document.body,
  ) : null;

  return (
    <div className="relative w-full">
      <button
        ref={buttonRef}
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 h-12 px-3 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 text-left hover:border-gray-300 dark:hover:border-gray-500 transition-colors focus:border-[#7592ff] focus:ring-2 focus:ring-[#ecf3ff] dark:focus:ring-blue-950/40 focus:outline-none"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-md bg-[#ecf3ff] dark:bg-blue-950/40 text-[#3641f5] dark:text-blue-400 flex items-center justify-center flex-shrink-0">
            <BarChart3 className="w-4 h-4" />
          </div>
          <div className="min-w-0 truncate text-[13.5px] font-semibold text-gray-900 dark:text-white">
            {selectedName}
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 flex-shrink-0 text-gray-400 dark:text-gray-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {popup}
    </div>
  );
}
