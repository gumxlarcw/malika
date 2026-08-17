import type { Metadata } from "next";
import React from "react";
import DataPageClient from "./DataPageClient";
import EmptyState from "@/components/common/EmptyState";
import { applyTableRowOrdering } from "@/lib/tableRowOrdering";
import { fetchParentCategory } from "./_lib/parentCategory";
import { backendBaseUrl } from "@/lib/backendBaseUrl";

export const metadata: Metadata = {
  title: "Data Statistik",
  description: "Data Statistik",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ProcessedDynamic = {
  period: string;
  columns: string[];
  data: Array<Record<string, any>>;
  source: string;
  last_update: string | null;
};

type DynamicResponse = {
  cached: boolean;
  updated: boolean;
  data: ProcessedDynamic;
};

type PeriodAvailability = {
  source_id: number;
  periods: Array<{ th_id?: string; year?: string } | string>;
  unit?: string | null;
};

// Type for all years data passed to client
type YearData = {
  year: string;
  columns: string[];
  rows: Array<Record<string, any>>;
  lastUpdate: string | null;
  source: string | null;
};

function normalizeDynamicPeriod(period: string) {
  const m = String(period || "").trim().match(/^(19\d{2}|20\d{2}|2100)$/);
  if (!m) return period;
  const year = Number(m[1]);
  if (!Number.isFinite(year) || year < 1900 || year > 2999) return period;
  return String(year - 1900).padStart(3, "0");
}


function normGeo(input: unknown) {
  return String(input ?? "")
    .toLowerCase()
    .replace(/[\.,/\\()\[\]{}\-]+/g, " ")
    .replace(/\b(kabupaten|kab|kab\.|kota)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findGeoColumn(columns: string[]) {
  const preferred = columns.find((c) => /kabupaten\s*\/\s*kota/i.test(String(c))) || null;
  if (preferred) return preferred;
  return (
    columns.find((c) => /^(kabupaten|kota|kab\/kota|wilayah|daerah)$/i.test(String(c).trim())) ||
    columns.find((c) => /(kabupaten|kota|kab\/kota|wilayah|daerah)/i.test(String(c).trim())) ||
    null
  );
}

function matchesGeoCell(cell: unknown, geo: string) {
  const g = normGeo(geo);
  if (!g) return false;
  const c = normGeo(cell);
  if (!c) return false;
  if (c === g) return true;
  return c.includes(g) || g.includes(c);
}

function normText(input: unknown) {
  return String(input ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractQueryTerms(q: string) {
  const cleaned = normText(q)
    .replace(/\b(19\d{2}|20\d{2}|2100)\b/g, " ")
    .replace(
      /\b(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\b/g,
      " "
    )
    .replace(/\b(bulan|tahun|triwulan|kuartal|semester)\b/g, " ")
    .replace(/\b(kabupaten|kab|kota|provinsi)\b/g, " ")
    .replace(/\b(ekspor|impor|exim)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = cleaned
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .slice(0, 8);

  return Array.from(new Set(tokens));
}

function rowMatchesTerms(row: Record<string, any>, terms: string[], columns: string[]) {
  if (!terms || terms.length === 0) return true;
  const hay = normText(`${Array.isArray(columns) ? columns.join(" ") : ""} ${Object.values(row || {}).join(" ")}`);
  if (!hay) return false;
  return terms.every((t) => hay.includes(t));
}

export default async function DataPage({
  searchParams,
}: {
  searchParams?:
    | Record<string, string | string[] | undefined>
    | Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = (await Promise.resolve(searchParams)) as
    | Record<string, string | string[] | undefined>
    | undefined;

  const sourceIdRaw = resolvedSearchParams?.source_id;
  const periodRaw = resolvedSearchParams?.period;
  const monthRaw = resolvedSearchParams?.month;
  const typeRaw = resolvedSearchParams?.type;
  const codeHsRaw = resolvedSearchParams?.code_hs;
  const groupRaw = resolvedSearchParams?.group;
  const podRaw = resolvedSearchParams?.pod;
  const ctrRaw = resolvedSearchParams?.ctr;
  const metricRaw = resolvedSearchParams?.metric;
  const geoRaw = resolvedSearchParams?.geo;
  const qRaw = resolvedSearchParams?.q;

  const sourceId = Number(Array.isArray(sourceIdRaw) ? sourceIdRaw[0] : sourceIdRaw);
  const period = String(Array.isArray(periodRaw) ? periodRaw[0] : periodRaw || "").trim();
  const monthNo = Number(Array.isArray(monthRaw) ? monthRaw[0] : monthRaw);
  const hasMonth = Number.isFinite(monthNo) && monthNo >= 1 && monthNo <= 12;
  const dsType = String(Array.isArray(typeRaw) ? typeRaw[0] : typeRaw || "dynamic")
    .trim()
    .toLowerCase();
  const codeHs = String(Array.isArray(codeHsRaw) ? codeHsRaw[0] : codeHsRaw || "").trim();
  const group = String(Array.isArray(groupRaw) ? groupRaw[0] : groupRaw || "").trim().toLowerCase();
  const groupWanted = group === "hs2" ? "hs2" : "";
  const pod = String(Array.isArray(podRaw) ? podRaw[0] : podRaw || "").trim();
  const ctr = String(Array.isArray(ctrRaw) ? ctrRaw[0] : ctrRaw || "").trim();
  const metric = String(Array.isArray(metricRaw) ? metricRaw[0] : metricRaw || "").trim().toLowerCase();
  const metricWanted = metric === "value" || metric === "netweight" ? metric : "";
  const geo = String(Array.isArray(geoRaw) ? geoRaw[0] : geoRaw || "").trim();
  const geoNorm = normGeo(geo);
  const q = String(Array.isArray(qRaw) ? qRaw[0] : qRaw || "").trim();
  const qIndicatesKomoditas = /\bkomoditas\b/i.test(q);

  if (!Number.isFinite(sourceId) || sourceId <= 0) {
    return (
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white/90">Data Statistik</h1>
        <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
          <p className="text-sm text-gray-500 dark:text-gray-400">Parameter `source_id` tidak valid.</p>
        </div>
      </div>
    );
  }

  const endpoint = dsType === "exim" ? "exim" : dsType === "interop" ? "interop" : dsType === "static" ? "static" : "dynamic";
  const needsPeriod = endpoint !== "static";

  let availableYears: string[] = [];
  let selectedYear = period;
  let indicatorUnit: string | null = null;
  if (needsPeriod) {
    try {
      const res = await fetch(`${backendBaseUrl()}/period/public/${encodeURIComponent(String(sourceId))}`, { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as PeriodAvailability;
        const raw = Array.isArray(json?.periods) ? json.periods : [];
        indicatorUnit = json?.unit || null;
        const years = raw
          .map((p: any) => {
            if (typeof p === "string") return p;
            return p?.year || p?.th || p?.th_id || null;
          })
          .map((y) => String(y || "").trim())
          .filter((y) => /^(19\d{2}|20\d{2}|2100)$/.test(y));

        const unique = Array.from(new Set(years));
        availableYears = unique.sort((a, b) => Number(b) - Number(a));
        if (!selectedYear || selectedYear.length < 2) {
          selectedYear = availableYears[0] || "";
        }
      }
    } catch {
      // ignore
    }

    if (!selectedYear) {
      return (
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white/90">Data Statistik</h1>
          <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
            <p className="text-sm text-gray-500 dark:text-gray-400">Periode belum tersedia untuk indikator ini.</p>
          </div>
        </div>
      );
    }
  }

  // Fetch ALL years data in parallel for client-side switching
  const base = `${backendBaseUrl()}/${endpoint}/${encodeURIComponent(String(sourceId))}`;
  const groupWantedEffective = endpoint === "exim" && !groupWanted && !codeHs && qIndicatesKomoditas ? "hs2" : groupWanted;
  
  const buildUrl = (year: string) => {
    const periodParam = endpoint === "dynamic" ? normalizeDynamicPeriod(year) : year;
    return endpoint === "static"
      ? base
      : `${base}?period=${encodeURIComponent(periodParam)}${endpoint === "exim" && groupWantedEffective ? `&group=${encodeURIComponent(groupWantedEffective)}` : ""}${endpoint === "exim" && codeHs ? `&code_hs=${encodeURIComponent(codeHs)}` : ""}${endpoint === "exim" && hasMonth ? `&month=${encodeURIComponent(String(monthNo))}` : ""}${endpoint === "exim" && pod ? `&pod=${encodeURIComponent(pod)}` : ""}${endpoint === "exim" && ctr ? `&ctr=${encodeURIComponent(ctr)}` : ""}${endpoint === "exim" && metricWanted ? `&metric=${encodeURIComponent(metricWanted)}` : ""}`;
  };

  // Fetch all years in parallel
  const yearsToFetch = needsPeriod ? availableYears : [selectedYear];
  const fetchPromises = yearsToFetch.map(async (year): Promise<YearData | null> => {
    try {
      const url = buildUrl(year);
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return null;
      const payload = (await res.json()) as DynamicResponse;
      if (!payload?.data) return null;
      
      const data = payload.data;
      const columns = Array.isArray(data.columns) ? data.columns : [];
      let rowsRaw = Array.isArray(data.data) ? data.data : [];
      
      // Apply geo filtering
      const geoKeyCol = geoNorm ? findGeoColumn(columns) : null;
      let rowsGeo = rowsRaw;
      if (geoNorm && geoKeyCol) {
        const filtered = rowsRaw.filter((r) => matchesGeoCell((r as any)?.[geoKeyCol], geoNorm));
        if (filtered.length > 0) {
          rowsGeo = filtered;
        }
      }
      
      // Apply query term filtering
      const queryTerms = endpoint === "exim" ? [] : extractQueryTerms(q);
      const rowsByTerms = queryTerms.length > 0
        ? rowsGeo.filter((r) => rowMatchesTerms(r as any, queryTerms, columns))
        : rowsGeo;
      let rows = queryTerms.length > 0 && rowsByTerms.length === 0 ? rowsGeo : rowsByTerms;
      
      // Apply row ordering
      if (endpoint !== "exim") {
        rows = applyTableRowOrdering({
          rows,
          columns,
          title: String(data.source || ''),
        });
      }
      
      return {
        year,
        columns,
        rows,
        lastUpdate: data.last_update || null,
        source: data.source || null,
      };
    } catch {
      return null;
    }
  });

  // Parallelize: years data + parent-category resolution + peta-tematik
  // eligibility (so Hero can render a "Lihat di Peta Tematik" shortcut chip
  // without a second client-side round-trip).
  const [allYearsDataRaw, parentCategory, petaTematikEligible] = await Promise.all([
    Promise.all(fetchPromises),
    fetchParentCategory(sourceId),
    checkPetaTematikEligible(sourceId),
  ]);
  const allYearsData = allYearsDataRaw.filter((d): d is YearData => d !== null);

  if (allYearsData.length === 0) {
    return (
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white/90">Data Statistik</h1>
        <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
          <EmptyState 
            variant="error"
            title="Gagal memuat data"
            description="Tidak dapat mengambil data untuk indikator ini."
          />
        </div>
      </div>
    );
  }

  // Source name is already in `allYearsData` — pull it from the entry matching
  // the selected year, falling back to the first entry, then to "Data Statistik".
  // (Audit C5: previously this issued a second identical fetch just to extract
  // `source`, costing a per-request round-trip.)
  const sourceName =
    allYearsData.find((d) => d.year === selectedYear)?.source ??
    allYearsData[0]?.source ??
    "Data Statistik";

  // Determine source type for client component
  const sourceTypeMap: Record<string, "dynamic" | "interop" | "exim" | "static"> = {
    dynamic: "dynamic",
    interop: "interop",
    exim: "exim",
    static: "static",
  };
  const sourceType = sourceTypeMap[endpoint] || "dynamic";

  // Check if geo was actually applied (check first year's data)
  const geoApplied = geoNorm ? (() => {
    const firstYear = allYearsData[0];
    if (!firstYear) return false;
    const geoKeyCol = findGeoColumn(firstYear.columns);
    return !!geoKeyCol;
  })() : false;

  return (
    <div className="min-w-0">
      <DataPageClient
        allYearsData={allYearsData}
        sourceId={sourceId}
        sourceType={sourceType}
        sourceName={sourceName}
        initialYear={selectedYear}
        availableYears={availableYears}
        monthNo={hasMonth ? monthNo : null}
        geo={geo || null}
        geoApplied={geoApplied}
        q={q || undefined}
        unit={indicatorUnit}
        parentCategoryName={parentCategory?.name ?? null}
        parentCategorySlug={parentCategory?.slug ?? null}
        petaTematikEligible={petaTematikEligible}
      />
    </div>
  );
}

/**
 * Server-side check: is this sourceId in the peta-tematik eligible list?
 * Backend caches /indikator-list (LRU), so this is effectively a fast lookup.
 * Returns `false` on any error — peta-tematik link just won't show, which is
 * the safe degradation since map view is optional for the data page.
 */
async function checkPetaTematikEligible(sourceId: number): Promise<boolean> {
  try {
    const r = await fetch(`${backendBaseUrl()}/peta-tematik/public/indikator-list`, {
      cache: "no-store",
    });
    if (!r.ok) return false;
    const data = await r.json() as { ok?: boolean; kategori?: Record<string, Array<{ sourceId: number }>> };
    if (!data?.kategori) return false;
    for (const items of Object.values(data.kategori)) {
      if (items.some((it) => it.sourceId === sourceId)) return true;
    }
    return false;
  } catch {
    return false;
  }
}
