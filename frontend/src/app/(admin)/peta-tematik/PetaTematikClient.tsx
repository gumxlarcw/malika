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
import { readUrlState, useSyncUrl } from "./useUrlState";
import { fmtNumber, type BinningMethod, type PaletteId, PALETTES, DEFAULT_PALETTE, getPalette } from "./colorScale";
import "./styles.css";
import type {
  IndikatorList, YearsResponse, MetricsResponse,
  DataResponse, SummaryResponse, FilterState, IndikatorItem,
} from "./types";

// 6 mega-groups dari kategori PWA
const META_GROUPS: { key: string; label: string; emoji: string; pwaKategori: string[] }[] = [
  { key: "pertanian", label: "Pertanian & Pangan", emoji: "🌾",
    pwaKategori: ["Pertanian, Kehutanan, Perikanan","Hortikultura, Perkebunan, Peternakan","Hortikultura, Khutanan, Perikanan, Perkebunan, Peternakan, Tanaman Pangan"] },
  { key: "pendidikan-kesehatan", label: "Pendidikan & Kesehatan", emoji: "🎓",
    pwaKategori: ["Pendidikan", "Kesehatan"] },
  { key: "kependudukan-sosial", label: "Kependudukan & Sosial", emoji: "👥",
    pwaKategori: ["Kependudukan dan Migrasi","Gender dan Kelompok Populasi Khusus","Pemukiman dan Perumahan","Budaya","Aktivitas Politik dan Komunitas Lainnya","Perlindungan Sosial","Peradilan Dan Kriminal","Kondisi Tempat Tinggal, Kemiskinan, dan Permasalahan Sosial Lintas Sektor","Kondisi Tempat Tinggal, Kemiskinan Dan Isu Sosial Lintas Sektor"] },
  { key: "ekonomi", label: "Ekonomi & Industri", emoji: "💰",
    pwaKategori: ["Neraca Ekonomi","Konsumsi dan Pendapatan","Keuangan Pemerintah, Fiskal dan Statistik Sektor Publik","Keuangan Pemerintah","Pertambangan, Manufaktur, Konstruksi","Pertambangan, Industri, Konstruksi","Energi","Statistik Regional dan Statistik Area Kecil","Harga-Harga","Statistik Bisnis","Perdagangan Internasional dan Neraca Pembayaran"] },
  { key: "tenaga-kerja", label: "Ketenagakerjaan", emoji: "💼",
    pwaKategori: ["Ketenagakerjaan", "Tenaga Kerja", "Penduduk dan Ketenagakerjaan"] },
  { key: "infra-lingkungan", label: "Infrastruktur & Lingkungan", emoji: "🚛",
    pwaKategori: ["Transportasi", "Lingkungan", "Pariwisata", "Masyarakat Informasi"] },
  { key: "lainnya", label: "Lainnya", emoji: "📦",
    pwaKategori: ["Lainnya", "Berita Resmi Statistik", "EXIM Ekspor", "EXIM Impor"] },
];

const PWA_KAT_TO_META: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const meta of META_GROUPS) for (const k of meta.pwaKategori) m[k] = meta.key;
  return m;
})();
const metaForPwaKat = (k: string | undefined): string =>
  !k ? "lainnya" : PWA_KAT_TO_META[k] ?? "lainnya";

const MONTH_NAMES = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

interface PwaCategoriesResponse {
  categories: { name: string; count: number; slug: string; sources: { id: number; name: string; type: string }[] }[];
}
interface ProcessedList {
  pwaKategoriMap: Record<string, IndikatorItem[]>;
  idToPwaKat: Map<number, string>;
  idToName: Map<number, string>;
  totalEligible: number;
}

function processList(elig: IndikatorList, pwa: PwaCategoriesResponse): ProcessedList {
  const eligibleItems = new Map<number, IndikatorItem>();
  for (const items of Object.values(elig.kategori)) for (const it of items) eligibleItems.set(it.sourceId, it);
  const pwaKategoriMap: Record<string, IndikatorItem[]> = {};
  const idToPwaKat = new Map<number, string>();
  const idToName = new Map<number, string>();
  for (const cat of pwa.categories) {
    for (const src of cat.sources) {
      if (eligibleItems.has(src.id)) {
        if (!pwaKategoriMap[cat.name]) pwaKategoriMap[cat.name] = [];
        pwaKategoriMap[cat.name].push(eligibleItems.get(src.id)!);
        idToPwaKat.set(src.id, cat.name);
        idToName.set(src.id, eligibleItems.get(src.id)!.sourceName);
      }
    }
  }
  for (const k of Object.keys(pwaKategoriMap)) {
    pwaKategoriMap[k].sort((a, b) => a.sourceName.localeCompare(b.sourceName, "id"));
  }
  return { pwaKategoriMap, idToPwaKat, idToName, totalEligible: elig.totalEligible };
}

function metaCount(p: ProcessedList, metaKey: string): number {
  const meta = META_GROUPS.find((m) => m.key === metaKey);
  if (!meta) return 0;
  return meta.pwaKategori.reduce((sum, k) => sum + (p.pwaKategoriMap[k]?.length ?? 0), 0);
}

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export default function PetaTematikClient() {
  const [list, setList] = useState<IndikatorList | null>(null);
  const [pwaCats, setPwaCats] = useState<PwaCategoriesResponse | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedMeta, setSelectedMeta] = useState<string>(META_GROUPS[0].key);
  const [filters, setFilters] = useState<FilterState>({ indikator: null, year: null, month: null, metric: null });
  const [yearsResp, setYearsResp] = useState<YearsResponse | null>(null);
  const [metricsResp, setMetricsResp] = useState<MetricsResponse | null>(null);
  const [data, setData] = useState<DataResponse | null>(null);
  const [prevData, setPrevData] = useState<DataResponse | null>(null);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  // Binning method is fixed to quantile (5-bin equal population) — pakai angka
  // apa adanya tanpa expose user choice (Jenks/Equal removed per simplification)
  const binning: BinningMethod = "quantile";
  const [paletteId, setPaletteId] = useState<PaletteId>(DEFAULT_PALETTE);
  const palette = useMemo(() => getPalette(paletteId), [paletteId]);

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerKab, setDrawerKab] = useState<{ kdkab: string; nama: string } | null>(null);

  // Linked hover (between map + bar chart)
  const [hoveredKdkab, setHoveredKdkab] = useState<string | null>(null);

  // URL state sync — write filters to URL on change (deep-linkable)
  useSyncUrl(filters, binning, paletteId);

  const processed = useMemo(() => (list && pwaCats ? processList(list, pwaCats) : null), [list, pwaCats]);

  useEffect(() => {
    Promise.all([
      fetchJson<IndikatorList>("/api/peta-tematik/indikator-list"),
      fetchJson<PwaCategoriesResponse>("/api/categories"),
    ]).then(([d, c]) => {
      setList(d); setPwaCats(c);
      const proc = processList(d, c);

      // First check if URL has explicit state — that takes precedence over defaults
      const urlState = readUrlState();
      if (urlState?.palette) setPaletteId(urlState.palette);
      if (urlState?.filters?.indikator && proc.idToPwaKat.has(urlState.filters.indikator)) {
        setFilters((f) => ({ ...f, ...urlState.filters }));
        setSelectedMeta(metaForPwaKat(proc.idToPwaKat.get(urlState.filters.indikator)));
        return;
      }

      // Fallback: pick first eligible from first non-empty meta group
      let defaultId: number | null = null;
      for (const meta of META_GROUPS) {
        for (const pwaKat of meta.pwaKategori) {
          const items = proc.pwaKategoriMap[pwaKat];
          if (items?.length) { defaultId = items[0].sourceId; break; }
        }
        if (defaultId != null) { setSelectedMeta(meta.key); break; }
      }
      if (defaultId != null) setFilters((f) => ({ ...f, indikator: defaultId }));
    }).catch((e) => {
      console.error(e);
      setListError("Gagal memuat daftar indikator.");
    });
  }, []);

  useEffect(() => {
    if (!filters.indikator) return;
    setYearsResp(null); setMetricsResp(null);
    Promise.all([
      fetchJson<YearsResponse>(`/api/peta-tematik/years?indikator=${filters.indikator}`),
      fetchJson<MetricsResponse>(`/api/peta-tematik/metrics?indikator=${filters.indikator}`),
    ]).then(([y, m]) => {
      setYearsResp(y); setMetricsResp(m);
      const latest = y.years[y.years.length - 1];
      const preferred = m.metrics.includes("value") ? "value" : m.metrics[0];
      setFilters((f) => ({ ...f, year: latest ?? null, month: y.has_monthly ? 12 : null, metric: preferred ?? null }));
    }).catch((e) => console.error(e));
  }, [filters.indikator]);

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
        kategori={processed.idToPwaKat.get(filters.indikator) ?? "Lainnya"}
      />
    </div>
  ) : null;

  return (
    <div className="peta-tematik-page min-w-0">
      <EditorialHeader totalIndikator={processed.totalEligible} actions={toolbar} />

      {/* Filter card — mega chips + indikator + waktu */}
      <section className="mb-6 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-theme-xs overflow-hidden">
        {/* Row 1: mega-group chips, scrollable on mobile */}
        <div className="px-4 pt-4 pb-3 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1">
            {META_GROUPS.map((meta) => {
              const count = metaCount(processed, meta.key);
              if (count === 0) return null;
              const active = selectedMeta === meta.key;
              return (
                <button
                  key={meta.key}
                  onClick={() => setSelectedMeta(meta.key)}
                  className={`flex-shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-[12.5px] font-medium transition-all border ${
                    active
                      ? "bg-[#465fff] text-white border-[#465fff] shadow-sm"
                      : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700"
                  }`}
                >
                  <span className="opacity-90">{meta.emoji}</span>
                  <span>{meta.label}</span>
                  <span
                    className={`ml-0.5 text-[10.5px] tabular-nums px-1.5 py-0 rounded-full ${
                      active ? "bg-white/20 text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Row 2: indikator picker + year pills + (month/metric) */}
        <div className="p-4 grid grid-cols-12 gap-3 items-end">
          <div className="col-span-12 lg:col-span-5">
            <div className="text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5">
              Indikator
            </div>
            <IndikatorPicker
              processed={processed}
              value={filters.indikator}
              metaKey={selectedMeta}
              onChange={(id) => {
                setFilters((f) => ({ ...f, indikator: id, year: null, month: null, metric: null }));
                setSelectedMeta(metaForPwaKat(processed.idToPwaKat.get(id)));
              }}
            />
          </div>
          <div className="col-span-12 lg:col-span-7 flex flex-wrap items-end gap-3 lg:justify-end">
            {filters.indikator && yearsResp && yearsResp.years.length > 0 && (
              <div>
                <div className="text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5">
                  Tahun
                </div>
                <YearPills
                  years={yearsResp.years}
                  value={filters.year}
                  onChange={(y) => setFilters((f) => ({ ...f, year: y }))}
                />
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
            kategori={processed.idToPwaKat.get(filters.indikator) ?? "Lainnya"}
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
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
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
            <aside className="lg:col-span-1 space-y-4">
              <ProvinsiTotalCard summary={summary} year={filters.year} />
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
        onClose={() => setDrawerOpen(false)}
      />

      {/* Cmd+K command palette — global keyboard shortcut */}
      <CommandPalette
        processed={processed}
        years={yearsResp?.years ?? []}
        onPickIndikator={(id) => {
          setFilters((f) => ({ ...f, indikator: id, year: null, month: null, metric: null }));
          setSelectedMeta(metaForPwaKat(processed.idToPwaKat.get(id)));
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
  value: number | null;
  onChange: (y: number) => void;
}

function YearPills({ years, value, onChange }: YearPillsProps) {
  return (
    <div className="flex items-center gap-1 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-1 max-w-full overflow-x-auto">
      {years.map((y) => {
        const active = value === y;
        return (
          <button
            key={y}
            type="button"
            onClick={() => onChange(y)}
            className={`flex-shrink-0 h-8 px-2.5 rounded-md text-[12.5px] font-medium tabular-nums transition-colors ${
              active
                ? "bg-[#465fff] text-white shadow-sm"
                : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-gray-800"
            }`}
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
      <div className="pt-mono text-xs mt-2" style={{ color }}>
        {arrow} {fmtNumber(delta)} ({pct.toFixed(1)}%) dari {year - 1}
      </div>
    );
  }
  return (
    <div className="bg-[var(--pt-canvas-elevated)] border border-[var(--pt-border)] rounded-xl p-5">
      <div className="pt-eyebrow mb-2">Provinsi · Maluku Utara</div>
      <div className="pt-display text-4xl text-[var(--pt-ink)] font-light tracking-tight tabular-nums">
        {total != null ? fmtNumber(total) : "—"}
      </div>
      <div className="pt-mono text-[11px] text-[var(--pt-ink-faint)] mt-1">tahun {year}</div>
      {deltaEl}
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

  const allowedKategori = useMemo(
    () => META_GROUPS.find((m) => m.key === metaKey)?.pwaKategori ?? [],
    [metaKey],
  );

  const selectedName = useMemo(() => {
    for (const items of Object.values(processed.pwaKategoriMap)) {
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
          {allowedKategori.filter((k) => processed.pwaKategoriMap[k]?.length > 0).map((kategori) => (
            <Command.Group
              key={kategori}
              heading={`${kategori} · ${processed.pwaKategoriMap[kategori].length}`}
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
              {processed.pwaKategoriMap[kategori].map((item) => (
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
