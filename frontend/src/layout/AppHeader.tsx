"use client";
import { ThemeToggleButton } from "@/components/common/ThemeToggleButton";
import NotificationDropdown from "@/components/header/NotificationDropdown";
import { useSidebar } from "@/context/SidebarContext";
import Image from "next/image";
import Link from "next/link";
import React, { useState ,useEffect,useRef} from "react";
import { useRouter } from "next/navigation";
import { filterEximColumnsForQuery } from "@/lib/eximQueryIntent";
import { applyTableRowOrdering } from "@/lib/tableRowOrdering";
import { trackAnalyticsEvent } from "@/hooks/useAnalytics";

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

/** Strip query parameter from data link so list items open without filtering */
function stripQueryFromLink(link: string): string {
  if (!link || typeof link !== 'string') return link;
  try {
    // Handle both /data?... and full URLs
    const url = new URL(link, 'http://localhost');
    url.searchParams.delete('q');
    return url.pathname + (url.search || '');
  } catch {
    // Fallback: simple regex removal
    return link.replace(/([?&])q=[^&]*(&|$)/g, (_, p1, p2) => p2 && p1 === '?' ? '?' : p1 === '&' && !p2 ? '' : p2 ? p1 : '');
  }
}

function formatPreviewFetchErrorMessage(code: string, typeNorm: string) {
  const t = String(typeNorm || "dynamic").toLowerCase();
  if (code === "DATA_BPS_NOT_AVAILABLE") {
    return t === "exim"
      ? "Data indikator EXIM belum tersedia di data_bps (belum direplikasi)."
      : "Data indikator belum tersedia di data_bps (belum direplikasi).";
  }
  if (code === "DB_BPS_DISABLED") {
    return t === "exim"
      ? "DB data_bps belum dikonfigurasi. Endpoint EXIM hanya melayani data dari data_bps."
      : "DB data_bps belum dikonfigurasi.";
  }
  return "";
}

function monthNameFromNo(monthNo: number) {
  const map: Record<number, string> = {
    1: "Januari",
    2: "Februari",
    3: "Maret",
    4: "April",
    5: "Mei",
    6: "Juni",
    7: "Juli",
    8: "Agustus",
    9: "September",
    10: "Oktober",
    11: "November",
    12: "Desember",
  };
  return map[monthNo] || null;
}

function detectEximModeFromQuery(q: string): "impor" | "ekspor" | null {
  const raw = String(q || "").toLowerCase();
  if (!raw) return null;
  if (raw.includes("impor")) return "impor";
  if (raw.includes("ekspor")) return "ekspor";
  return null;
}

function extractEximQueryFacets(q: string): { ctr?: string; pod?: string; code_hs?: string } {
  const raw = String(q || "").toLowerCase();
  if (!raw) return {};

  const monthNames = new Set([
    "januari",
    "jan",
    "februari",
    "feb",
    "maret",
    "mar",
    "april",
    "apr",
    "mei",
    "juni",
    "jun",
    "juli",
    "jul",
    "agustus",
    "agu",
    "ags",
    "september",
    "sep",
    "oktober",
    "okt",
    "november",
    "nov",
    "desember",
    "des",
  ]);
  const stop = new Set([
    "negara",
    "pelabuhan",
    "komoditas",
    "hs",
    "hs2",
    "kode",
    "kodehs",
    "nilai",
    "volume",
    "berat",
    "kg",
    "usd",
    "us$",
    "bulan",
    "tahun",
    "dan",
    "sampai",
    "sd",
    "s/d",
    "hingga",
    "to",
  ]);

  const tokens = raw
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/g)
    .filter(Boolean);

  const takeAfter = (key: string) => {
    const idx = tokens.indexOf(key);
    if (idx < 0) return "";
    const out: string[] = [];
    for (let i = idx + 1; i < tokens.length; i++) {
      const t = tokens[i];
      if (!t) break;
      if (stop.has(t)) break;
      if (monthNames.has(t)) break;
      if (/^(19\d{2}|20\d{2}|2100)$/.test(t)) break;
      out.push(t);
      if (out.length >= 3) break;
    }
    return out.join(" ").trim();
  };

  const ctr = takeAfter("negara");
  const pod = takeAfter("pelabuhan");

  let code_hs: string | undefined;
  const hsMatch = raw.match(/\bhs\s*([0-9]{2,6})\b/i);
  if (hsMatch && hsMatch[1]) {
    const d = hsMatch[1].replace(/\D/g, "");
    if (d.length >= 2) code_hs = d.slice(0, 2);
  }

  const res: { ctr?: string; pod?: string; code_hs?: string } = {};
  if (ctr) res.ctr = ctr;
  if (pod) res.pod = pod;
  if (code_hs) res.code_hs = code_hs;
  return res;
}

function formatNumberId(input: unknown) {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function eximColumnLabel(col: string, mode: "impor" | "ekspor" | null) {
  const key = String(col || "").trim().toLowerCase();
  if (key === "pod") return "Pelabuhan";
  if (key === "ctr") return mode === "impor" ? "Negara Asal" : mode === "ekspor" ? "Negara Tujuan" : "Negara";
  if (key === "kodehs") return "Komoditas";
  if (key === "value") return "Nilai (US$)";
  if (key === "netweight") return "Volume (Kg)";
  return col;
}

function eximCellValue(col: string, value: unknown) {
  const key = String(col || "").trim().toLowerCase();
  const raw = String(value ?? "").trim();

  if (key === "pod") {
    if (raw === "-" || raw === "") return "Semua Pelabuhan";
    return raw;
  }
  if (key === "ctr") {
    if (raw === "-" || raw === "") return "Semua Negara";
    return raw;
  }
  if (key === "kodehs") {
    if (/^all\s*hs/i.test(raw)) return "Semua Komoditas";
    if (raw === "-" || raw === "") return "Semua Komoditas";
    return raw;
  }
  if (key === "value" || key === "netweight") {
    const formatted = formatNumberId(value);
    return formatted ?? (raw || "-");
  }

  return raw || "-";
}

function matchesMonthCell(cell: unknown, monthNo: number) {
  const name = monthNameFromNo(monthNo);
  if (!name) return false;
  if (typeof cell === "number" && Number.isFinite(cell)) {
    return Math.trunc(cell) === monthNo;
  }

  const raw = String(cell ?? "").trim();
  if (!raw) return false;

  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    return Math.trunc(numeric) === monthNo;
  }

  const c = raw.toLowerCase();
  const target = name.toLowerCase();
  return c === target || c.includes(target);
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

function extractQueryYears(q: string) {
  const raw = String(q || '').toLowerCase();
  const years = Array.from(raw.matchAll(/\b(19\d{2}|20\d{2}|2100)\b/g))
    .map((m) => String(m[1] || '').trim())
    .filter(Boolean);
  return Array.from(new Set(years));
}

function extractSingleQueryMonthNo(q: string): string {
  const raw = String(q || '').toLowerCase();
  const monthMap: Record<string, string> = {
    januari: '1',
    februari: '2',
    maret: '3',
    april: '4',
    mei: '5',
    juni: '6',
    juli: '7',
    agustus: '8',
    september: '9',
    oktober: '10',
    november: '11',
    desember: '12',
  };
  const hits = Array.from(raw.matchAll(/\b(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\b/g))
    .map((m) => monthMap[String(m[1] || '')])
    .filter(Boolean);
  const uniq = Array.from(new Set(hits));
  return uniq.length === 1 ? uniq[0] : '';
}

function extractQueryMonthNosAll(q: string): string[] {
  const raw = String(q || '').toLowerCase();
  const monthMap: Record<string, string> = {
    januari: '1',
    jan: '1',
    februari: '2',
    feb: '2',
    maret: '3',
    mar: '3',
    april: '4',
    apr: '4',
    mei: '5',
    juni: '6',
    jun: '6',
    juli: '7',
    jul: '7',
    agustus: '8',
    agu: '8',
    ags: '8',
    september: '9',
    sep: '9',
    oktober: '10',
    okt: '10',
    november: '11',
    nov: '11',
    desember: '12',
    des: '12',
  };

  const hits = Array.from(
    raw.matchAll(/\b(januari|jan|februari|feb|maret|mar|april|apr|mei|juni|jun|juli|jul|agustus|agu|ags|september|sep|oktober|okt|november|nov|desember|des)\b/g)
  )
    .map((m) => monthMap[String(m[1] || '')])
    .filter(Boolean);

  return Array.from(new Set(hits));
}

function extractQueryMonthYearPairs(q: string): Array<{ year: string; monthNo: number }> {
  const raw = String(q || '').toLowerCase();
  if (!raw) return [];

  const monthMap: Record<string, number> = {
    januari: 1,
    jan: 1,
    februari: 2,
    feb: 2,
    maret: 3,
    mar: 3,
    april: 4,
    apr: 4,
    mei: 5,
    juni: 6,
    jun: 6,
    juli: 7,
    jul: 7,
    agustus: 8,
    agu: 8,
    ags: 8,
    september: 9,
    sep: 9,
    oktober: 10,
    okt: 10,
    november: 11,
    nov: 11,
    desember: 12,
    des: 12,
  };

  const out: Array<{ year: string; monthNo: number }> = [];
  const rangeSep = '(?:-|–|—|sampai|sd|s\\/d|hingga|to)';
  const monthToken = '(?:januari|jan|februari|feb|maret|mar|april|apr|mei|juni|jun|juli|jul|agustus|agu|ags|september|sep|oktober|okt|november|nov|desember|des)';
  const yearToken = '(?:19\\d{2}|20\\d{2}|2100)';

  const reSameYearRange = new RegExp(`\\b(${monthToken})\\b\\s*${rangeSep}\\s*\\b(${monthToken})\\b\\s*\\b(${yearToken})\\b`, 'g');
  for (const m of raw.matchAll(reSameYearRange)) {
    const m1 = monthMap[String(m[1] || '')];
    const m2 = monthMap[String(m[2] || '')];
    const y = String(m[3] || '').trim();
    if (Number.isInteger(m1)) out.push({ year: y, monthNo: m1 });
    if (Number.isInteger(m2)) out.push({ year: y, monthNo: m2 });
  }

  const reFullRange = new RegExp(`\\b(${monthToken})\\b\\s*\\b(${yearToken})\\b\\s*${rangeSep}\\s*\\b(${monthToken})\\b\\s*\\b(${yearToken})\\b`, 'g');
  for (const m of raw.matchAll(reFullRange)) {
    const m1 = monthMap[String(m[1] || '')];
    const y1 = String(m[2] || '').trim();
    const m2 = monthMap[String(m[3] || '')];
    const y2 = String(m[4] || '').trim();
    if (Number.isInteger(m1)) out.push({ year: y1, monthNo: m1 });
    if (Number.isInteger(m2)) out.push({ year: y2, monthNo: m2 });
  }

  const reMonthYear = new RegExp(`\\b(${monthToken})\\b\\s*\\b(${yearToken})\\b`, 'g');
  for (const m of raw.matchAll(reMonthYear)) {
    const mo = monthMap[String(m[1] || '')];
    const y = String(m[2] || '').trim();
    if (Number.isInteger(mo)) out.push({ year: y, monthNo: mo });
  }

  const reYm = new RegExp(`\\b(${yearToken})\\s*[-\\/]\\s*(0?[1-9]|1[0-2])\\b`, 'g');
  for (const m of raw.matchAll(reYm)) {
    const y = String(m[1] || '').trim();
    const mo = Number(m[2]);
    if (Number.isInteger(mo) && mo >= 1 && mo <= 12) out.push({ year: y, monthNo: mo });
  }

  const reMy = new RegExp(`\\b(0?[1-9]|1[0-2])\\s*[-\\/]\\s*(${yearToken})\\b`, 'g');
  for (const m of raw.matchAll(reMy)) {
    const mo = Number(m[1]);
    const y = String(m[2] || '').trim();
    if (Number.isInteger(mo) && mo >= 1 && mo <= 12) out.push({ year: y, monthNo: mo });
  }

  const seen = new Set<string>();
  return out.filter((x) => {
    const key = `${x.year}:${x.monthNo}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function highlightMonthsForYearFromQuery(q: string, year: string) {
  const y = String(year || '').trim();
  if (!/^(19\d{2}|20\d{2}|2100)$/.test(y)) return [] as number[];

  const raw = String(q || '').toLowerCase();
  const months = new Set<number>();

  // Discrete month-year mentions (including endpoints)
  const pairs = extractQueryMonthYearPairs(raw);
  for (const p of pairs) {
    if (String(p.year) !== y) continue;
    if (Number.isInteger(p.monthNo) && p.monthNo >= 1 && p.monthNo <= 12) months.add(p.monthNo);
  }

  const addRange = (y1: number, m1: number, y2: number, m2: number) => {
    if (!Number.isInteger(y1) || !Number.isInteger(y2)) return;
    if (!Number.isInteger(m1) || !Number.isInteger(m2)) return;
    if (m1 < 1 || m1 > 12 || m2 < 1 || m2 > 12) return;

    let start = new Date(y1, m1 - 1, 1);
    let end = new Date(y2, m2 - 1, 1);
    if (start.getTime() > end.getTime()) {
      const tmp = start;
      start = end;
      end = tmp;
    }

    // guardrail: max 240 months (20 years)
    for (let i = 0; i < 240; i++) {
      const yy = String(start.getFullYear());
      const mm = start.getMonth() + 1;
      if (yy === y) months.add(mm);
      if (start.getTime() === end.getTime()) break;
      start.setMonth(start.getMonth() + 1);
      if (start.getTime() > end.getTime()) break;
    }
  };

  // Expand ranges only for dash/sampai/sd/s/d/etc (NOT for commas/"dan")
  const rangeSep = '(?:-|–|—|sampai|sd|s\\/d|hingga|to)';
  const monthToken = '(?:januari|jan|februari|feb|maret|mar|april|apr|mei|juni|jun|juli|jul|agustus|agu|ags|september|sep|oktober|okt|november|nov|desember|des)';
  const yearToken = '(?:19\\d{2}|20\\d{2}|2100)';
  const monthMap: Record<string, number> = {
    januari: 1,
    jan: 1,
    februari: 2,
    feb: 2,
    maret: 3,
    mar: 3,
    april: 4,
    apr: 4,
    mei: 5,
    juni: 6,
    jun: 6,
    juli: 7,
    jul: 7,
    agustus: 8,
    agu: 8,
    ags: 8,
    september: 9,
    sep: 9,
    oktober: 10,
    okt: 10,
    november: 11,
    nov: 11,
    desember: 12,
    des: 12,
  };

  // month year - month year
  const reFullRange = new RegExp(
    `\\b(${monthToken})\\b\\s*\\b(${yearToken})\\b\\s*${rangeSep}\\s*\\b(${monthToken})\\b\\s*\\b(${yearToken})\\b`,
    'g'
  );
  for (const m of raw.matchAll(reFullRange)) {
    const m1 = monthMap[String(m[1] || '')];
    const y1 = Number(String(m[2] || '').trim());
    const m2 = monthMap[String(m[3] || '')];
    const y2 = Number(String(m[4] || '').trim());
    if (Number.isInteger(m1) && Number.isInteger(m2) && Number.isFinite(y1) && Number.isFinite(y2)) {
      addRange(y1, m1, y2, m2);
    }
  }

  // month - month year (same-year)
  const reSameYearRange = new RegExp(
    `\\b(${monthToken})\\b\\s*${rangeSep}\\s*\\b(${monthToken})\\b\\s*\\b(${yearToken})\\b`,
    'g'
  );
  for (const m of raw.matchAll(reSameYearRange)) {
    const m1 = monthMap[String(m[1] || '')];
    const m2 = monthMap[String(m[2] || '')];
    const yy = Number(String(m[3] || '').trim());
    if (Number.isInteger(m1) && Number.isInteger(m2) && Number.isFinite(yy)) {
      addRange(yy, m1, yy, m2);
    }
  }

  // YYYY-MM - YYYY-MM (numeric)
  const reYmRange = new RegExp(
    `\\b(${yearToken})\\s*[-\\/]\\s*(0?[1-9]|1[0-2])\\b\\s*${rangeSep}\\s*\\b(${yearToken})\\s*[-\\/]\\s*(0?[1-9]|1[0-2])\\b`,
    'g'
  );
  for (const m of raw.matchAll(reYmRange)) {
    const y1 = Number(String(m[1] || '').trim());
    const m1 = Number(m[2]);
    const y2 = Number(String(m[3] || '').trim());
    const m2 = Number(m[4]);
    if (Number.isFinite(y1) && Number.isFinite(y2) && Number.isInteger(m1) && Number.isInteger(m2)) {
      addRange(y1, m1, y2, m2);
    }
  }

  // MM-YYYY - MM-YYYY (numeric)
  const reMyRange = new RegExp(
    `\\b(0?[1-9]|1[0-2])\\s*[-\\/]\\s*(${yearToken})\\b\\s*${rangeSep}\\s*\\b(0?[1-9]|1[0-2])\\s*[-\\/]\\s*(${yearToken})\\b`,
    'g'
  );
  for (const m of raw.matchAll(reMyRange)) {
    const m1 = Number(m[1]);
    const y1 = Number(String(m[2] || '').trim());
    const m2 = Number(m[3]);
    const y2 = Number(String(m[4] || '').trim());
    if (Number.isFinite(y1) && Number.isFinite(y2) && Number.isInteger(m1) && Number.isInteger(m2)) {
      addRange(y1, m1, y2, m2);
    }
  }

  return Array.from(months).sort((a, b) => a - b);
}

function pickYearFromQuery(availableYears: string[], q: string) {
  const years = Array.isArray(availableYears) ? availableYears.slice() : [];
  years.sort((a, b) => Number(b) - Number(a));
  if (years.length === 0) return '';
  const qYears = extractQueryYears(q)
    .filter((y) => /^(19\d{2}|20\d{2}|2100)$/.test(y))
    .sort((a, b) => Number(b) - Number(a));
  for (const y of qYears) {
    if (years.includes(y)) return y;
  }
  return years[0];
}

function parseDataLink(link: string) {
  if (!link || typeof link !== "string") return null;
  if (!link.startsWith("/data?")) return null;
  const qs = link.slice("/data?".length);
  const sp = new URLSearchParams(qs);
  const sourceId = sp.get("source_id");
  if (!sourceId) return null;

  const typeRaw = String(sp.get("type") || "").trim().toLowerCase();
  const hasEximMarkers =
    !!String(sp.get("metric") || "").trim() ||
    !!String(sp.get("code_hs") || "").trim() ||
    !!String(sp.get("ctr") || "").trim() ||
    !!String(sp.get("pod") || "").trim() ||
    !!String(sp.get("group") || "").trim();
  const type = (typeRaw === "" && hasEximMarkers) || (typeRaw === "dynamic" && hasEximMarkers)
    ? "exim"
    : (typeRaw || "dynamic");

  return {
    source_id: sourceId,
    period: sp.get("period") || "",
    type,
    month: sp.get("month") || "",
    geo: sp.get("geo") || "",
    q: sp.get("q") || "",
    group: sp.get("group") || "",
    code_hs: sp.get("code_hs") || "",
    pod: sp.get("pod") || "",
    ctr: sp.get("ctr") || "",
    metric: sp.get("metric") || "",
  };
}

// Helper to highlight matching text in search results
function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query || query.length < 2) return text;
  
  // Split query into words and escape regex special chars
  const words = query.trim().toLowerCase().split(/\s+/).filter(w => w.length >= 2);
  if (words.length === 0) return text;
  
  // Build regex pattern that matches any word
  const pattern = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const regex = new RegExp(`(${pattern})`, 'gi');
  
  const parts = text.split(regex);
  if (parts.length === 1) return text;
  
  return (
    <>
      {parts.map((part, i) => {
        const isMatch = words.some(w => part.toLowerCase() === w);
        return isMatch ? (
          <mark key={i} className="bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300 rounded px-0.5">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        );
      })}
    </>
  );
}

// Helper to detect if query looks like a question (for Chat MALIKA suggestion)
function isQuestionQuery(query: string): boolean {
  const q = query.toLowerCase().trim();
  // Indonesian question words
  const questionPatterns = [
    /^siapa\b/, /^apa\b/, /^bagaimana\b/, /^mengapa\b/, /^kenapa\b/,
    /^kapan\b/, /^dimana\b/, /^berapa\b/, /^apakah\b/, /^bisakah\b/,
    /\?$/, // ends with question mark
  ];
  return questionPatterns.some(p => p.test(q));
}

const AppHeader: React.FC = () => {
  const router = useRouter();
  const [installReady, setInstallReady] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<{
    datasources: Array<{ id: number; title: string; subtitle?: string; link: string; unit?: string | null }>;
    publications: Array<{ id: string; title: string; subtitle?: string; link: string }>;
    brs: Array<{ id: number; title: string; subtitle?: string; link: string }>;
    knowledge: Array<{ id: number; title: string; content: string; category: string | null; similarity: number }>;
  }>({ datasources: [], publications: [], brs: [], knowledge: [] });
  const searchCacheRef = useRef<
    Map<string, { ts: number; data: {
      datasources: Array<{ id: number; title: string; subtitle?: string; link: string }>;
      publications: Array<{ id: string; title: string; subtitle?: string; link: string }>;
      brs: Array<{ id: number; title: string; subtitle?: string; link: string }>;
      knowledge: Array<{ id: number; title: string; content: string; category: string | null; similarity: number }>;
    } }>
  >(new Map());
  const SEARCH_CACHE_TTL = 1000 * 60 * 5;

  const [searchPreviewLoading, setSearchPreviewLoading] = useState(false);
  const [searchPreviewError, setSearchPreviewError] = useState<string | null>(null);
  const [searchPreviewPayload, setSearchPreviewPayload] = useState<DynamicResponse | null>(null);
  const [searchPreviewPayloadByYear, setSearchPreviewPayloadByYear] = useState<Record<string, DynamicResponse> | null>(null);
  const [searchPreviewActiveYear, setSearchPreviewActiveYear] = useState<string | null>(null);
  const [searchPreviewParams, setSearchPreviewParams] = useState<ReturnType<typeof parseDataLink> | null>(null);
  const [searchPreviewLink, setSearchPreviewLink] = useState<string | null>(null);
  const [searchPreviewAvailableYears, setSearchPreviewAvailableYears] = useState<string[]>([]);
  const [searchPreviewPeriodWasMissing, setSearchPreviewPeriodWasMissing] = useState(false);
  const [searchPreviewNeedsConfirmYear, setSearchPreviewNeedsConfirmYear] = useState(false);
  const [searchPreviewConfirmYearMessage, setSearchPreviewConfirmYearMessage] = useState<string | null>(null);

  // Recent searches from localStorage
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const RECENT_SEARCHES_KEY = "malika_recent_searches";
  const MAX_RECENT_SEARCHES = 5;

  // Load recent searches from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setRecentSearches(parsed.slice(0, MAX_RECENT_SEARCHES));
        }
      }
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  // Listen for mobile search trigger from bottom nav
  useEffect(() => {
    const handleOpenMobileSearch = () => {
      setMobileSearchOpen(true);
      setSearchOpen(true);
      if (searchQuery.trim().length < 2) loadFavorites();
      window.setTimeout(() => inputRef.current?.focus(), 0);
      // Notify bottom nav that search is open
      window.dispatchEvent(new CustomEvent("mobile-search-opened"));
    };
    window.addEventListener("open-mobile-search", handleOpenMobileSearch);
    return () => {
      window.removeEventListener("open-mobile-search", handleOpenMobileSearch);
    };
  }, [searchQuery]);

  // Notify bottom nav when mobile search closes
  useEffect(() => {
    if (!mobileSearchOpen) {
      window.dispatchEvent(new CustomEvent("mobile-search-closed"));
    }
  }, [mobileSearchOpen]);

  // Save recent search to localStorage
  const saveRecentSearch = (query: string) => {
    try {
      const trimmed = query.trim();
      if (trimmed.length < 2) return;
      const updated = [trimmed, ...recentSearches.filter((s) => s.toLowerCase() !== trimmed.toLowerCase())].slice(0, MAX_RECENT_SEARCHES);
      setRecentSearches(updated);
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
    } catch {
      // Ignore localStorage errors
    }
  };

  // Clear recent searches
  const clearRecentSearches = () => {
    try {
      setRecentSearches([]);
      localStorage.removeItem(RECENT_SEARCHES_KEY);
    } catch {
      // Ignore localStorage errors
    }
  };

  const { isMobileOpen, isExpanded, isHovered, toggleSidebar, toggleMobileSidebar } = useSidebar();

  const handleToggle = () => {
    if (window.innerWidth >= 1024) {
      toggleSidebar();
    } else {
      toggleMobileSidebar();
    }
  };

  const submitSearch = (opts?: { closeMobile?: boolean }) => {
    const qq = searchQuery.trim();
    if (qq.length < 2) return;
    saveRecentSearch(qq);
    setSearchOpen(false);
    if (opts?.closeMobile) setMobileSearchOpen(false);
    router.push(`/search?q=${encodeURIComponent(qq)}`);
  };

  const canSubmitSearch = searchQuery.trim().length >= 2;

  const loadFavorites = async () => {
    try {
      setSearchOpen(true);
      setSearchLoading(true);
      const res = await fetch(`/api/search?mode=favorites`, { cache: "no-store" });
      const data = (await res.json()) as {
        datasources?: Array<{ id: number; title: string; subtitle?: string; link: string }>
      };
      const next = {
        datasources: Array.isArray(data?.datasources) ? data.datasources : [],
        publications: [],
        brs: [],
        knowledge: [],
      };
      setSearchResults(next);
      setSearchOpen(true);
    } catch {
      setSearchResults({ datasources: [], publications: [], brs: [], knowledge: [] });
      setSearchOpen(true);
    } finally {
      setSearchLoading(false);
    }
  };

  const trackDatasourceClick = (sourceId: number) => {
    try {
      fetch("/api/search/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_id: sourceId }),
        cache: "no-store",
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      // best-effort
    }
  };

  const inputRef = useRef<HTMLInputElement>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!searchOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = searchWrapRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [searchOpen]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q || q.length < 2) {
      setSearchLoading(false);
      setSearchPreviewLoading(false);
      setSearchPreviewError(null);
      setSearchPreviewPayload(null);
      setSearchPreviewPayloadByYear(null);
      setSearchPreviewActiveYear(null);
      setSearchPreviewParams(null);
      setSearchPreviewLink(null);
      setSearchPreviewNeedsConfirmYear(false);
      setSearchPreviewConfirmYearMessage(null);

      // If user has focused the search input, show favorites (Top 5) instead of closing.
      if (searchOpen) {
        loadFavorites();
      } else {
        setSearchResults({ datasources: [], publications: [], brs: [], knowledge: [] });
      }
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    searchAbortRef.current?.abort();
    searchAbortRef.current = controller;
    setSearchLoading(true);
    setSearchOpen(true);

    const cached = searchCacheRef.current.get(q);
    if (cached && Date.now() - cached.ts < SEARCH_CACHE_TTL) {
      setSearchResults(cached.data);
      setSearchLoading(false);
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    // Small debounce (150ms) to avoid hammering API on every keystroke while staying responsive
    const debounceTimer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = (await res.json()) as {
          datasources?: Array<{ id: number; title: string; subtitle?: string; link: string }>;
          publications?: Array<{ id: string; title: string; subtitle?: string; link: string }>;
          brs?: Array<{ id: number; title: string; subtitle?: string; link: string }>;
          knowledge?: Array<{ id: number; title: string; content: string; category: string | null; similarity: number }>;
        };
        if (cancelled || controller.signal.aborted) return;
        const next = {
          datasources: Array.isArray(data?.datasources) ? data.datasources : [],
          publications: Array.isArray(data?.publications) ? data.publications : [],
          brs: Array.isArray(data?.brs) ? data.brs : [],
          knowledge: Array.isArray(data?.knowledge) ? data.knowledge : [],
        };
        setSearchResults(next);
        searchCacheRef.current.set(q, { ts: Date.now(), data: next });
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setSearchResults({ datasources: [], publications: [], brs: [], knowledge: [] });
      } finally {
        if (!cancelled && !controller.signal.aborted) setSearchLoading(false);
      }
    }, 150);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(debounceTimer);
    };
  }, [searchQuery]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setSearchPreviewError(null);
      setSearchPreviewPayload(null);
      setSearchPreviewPayloadByYear(null);
      setSearchPreviewActiveYear(null);
      setSearchPreviewParams(null);
      setSearchPreviewLink(null);
      setSearchPreviewAvailableYears([]);
      setSearchPreviewPeriodWasMissing(false);
      setSearchPreviewNeedsConfirmYear(false);
      setSearchPreviewConfirmYearMessage(null);

      if (searchLoading) return;
      if (!searchOpen) return;

      const qq = searchQuery.trim();

      const first = Array.isArray(searchResults.datasources)
        ? searchResults.datasources.find((it) => typeof it?.link === "string" && it.link.startsWith("/data?"))
        : null;
      if (!first) return;

      const parsed = parseDataLink(first.link);
      if (!parsed) return;

      const originalMissingPeriod = !String(parsed.period || '').trim();
      setSearchPreviewPeriodWasMissing(originalMissingPeriod);

      // Keep the original link (may omit period) so /data can auto-pick latest year + show year tabs.
      setSearchPreviewParams(parsed);
      setSearchPreviewLink(first.link);
      setSearchPreviewLoading(true);

      setSearchPreviewNeedsConfirmYear(false);
      setSearchPreviewConfirmYearMessage(null);

      // Resolve period if missing (same as SearchPageClient logic)
      let effectivePeriod = String(parsed.period || "").trim();
      const qYears = extractQueryYears(qq)
        .map((y) => String(y || '').trim())
        .filter((y) => /^(19\d{2}|20\d{2}|2100)$/.test(y));
      const shouldResolveToQueryYear =
        qYears.length > 0 && (!effectivePeriod || !qYears.includes(effectivePeriod) || qYears.length > 1);

      // Local (non-state) to drive year tabs + prefetch decisions.
      let yearsForTabs: string[] = [];

      // IMPORTANT: always validate availability when user specifies a year.
      const shouldFetchPeriodsForValidation = !effectivePeriod || shouldResolveToQueryYear || qYears.length > 0;

      if (shouldFetchPeriodsForValidation) {
        try {
          const periodRes = await fetch(`/api/periods?source_id=${encodeURIComponent(parsed.source_id)}`, {
            cache: "no-store",
          });
          if (cancelled) return;
          if (periodRes.ok) {
            const periodData = (await periodRes.json()) as {
              source_id: number;
              periods: Array<{ th_id: string; year: string }>;
            };
            const years = Array.isArray(periodData?.periods)
              ? periodData.periods
                  .map((p) => String(p?.year || "").trim())
                  .filter((y) => /^(19\d{2}|20\d{2}|2100)$/.test(y))
              : [];
            const uniq = Array.from(new Set(years)).sort((a, b) => Number(b) - Number(a));

            // Single explicit year: if unavailable, require user confirmation (like SearchPageClient).
            if (qYears.length === 1) {
              const target = qYears[0];
              if (target && !uniq.includes(target)) {
                setSearchPreviewNeedsConfirmYear(true);
                setSearchPreviewConfirmYearMessage(
                  uniq.length > 0
                    ? `Periode ${target} belum tersedia untuk indikator ini. Pilih tahun yang tersedia untuk menampilkan preview.`
                    : `Periode ${target} belum tersedia untuk indikator ini.`
                );
                setSearchPreviewAvailableYears(uniq);
                setSearchPreviewPeriodWasMissing(true);
                setSearchPreviewPayload(null);
                setSearchPreviewPayloadByYear(null);
                setSearchPreviewActiveYear(null);

                // Prefetch all available years in the background so tab clicks are instant.
                const typeNorm = String(parsed.type || 'dynamic').toLowerCase();
                const facets = typeNorm === 'exim' ? extractEximQueryFacets(qq) : {};
                const yearsToFetch = uniq.slice();
                void (async () => {
                  try {
                    const map: Record<string, DynamicResponse> = {};
                    let idx = 0;
                    const workerCount = Math.max(1, Math.min(4, yearsToFetch.length));

                    const fetchOne = async (y: string) => {
                      const monthsForYear = highlightMonthsForYearFromQuery(qq, y);
                      const nextMonth = monthsForYear.length === 1 ? String(monthsForYear[0]) : "";
                      const nextParams = {
                        ...parsed,
                        period: y,
                        month: nextMonth,
                        pod: parsed.pod || facets.pod || '',
                        ctr: parsed.ctr || facets.ctr || '',
                        code_hs: parsed.code_hs || facets.code_hs || '',
                      };

                      const url = `/api/data-preview?source_id=${encodeURIComponent(nextParams.source_id)}&period=${encodeURIComponent(y)}${nextParams.type ? `&type=${encodeURIComponent(nextParams.type)}` : ""}${nextMonth ? `&month=${encodeURIComponent(nextMonth)}` : ""}${nextParams.group ? `&group=${encodeURIComponent(nextParams.group)}` : ""}${nextParams.code_hs ? `&code_hs=${encodeURIComponent(nextParams.code_hs)}` : ""}${nextParams.pod ? `&pod=${encodeURIComponent(nextParams.pod)}` : ""}${nextParams.ctr ? `&ctr=${encodeURIComponent(nextParams.ctr)}` : ""}${nextParams.metric ? `&metric=${encodeURIComponent(nextParams.metric)}` : ""}`;
                      const res = await fetch(url, { cache: "no-store" });
                      const json = (await res.json()) as any;
                      if (!res.ok) return;
                      map[y] = json as DynamicResponse;
                    };

                    await Promise.all(
                      new Array(workerCount).fill(0).map(async () => {
                        while (idx < yearsToFetch.length) {
                          const y = yearsToFetch[idx++];
                          if (!/^(19\d{2}|20\d{2}|2100)$/.test(String(y || '').trim())) continue;
                          await fetchOne(String(y || '').trim());
                        }
                      })
                    );

                    if (cancelled) return;
                    if (Object.keys(map).length > 0) {
                      setSearchPreviewPayloadByYear(map);
                    }
                  } catch {
                    // best-effort
                  }
                })();

                if (!cancelled) setSearchPreviewLoading(false);
                return;
              }
            }

            // If user query already specifies year(s), don't show the whole year list in dropdown preview.
            const qYearsForTabs = qYears
              .map((yy) => String(yy || '').trim())
              .filter((yy) => /^(19\d{2}|20\d{2}|2100)$/.test(yy));
            const computedYearsForTabs =
              qYearsForTabs.length > 0
                ? uniq.filter((yy) => qYearsForTabs.includes(yy))
                : uniq;

            yearsForTabs = computedYearsForTabs;
            if (!cancelled) setSearchPreviewAvailableYears(computedYearsForTabs);
            effectivePeriod = pickYearFromQuery(uniq, qq);
          }
        } catch {
          // fall through
        }
      }

      if (!effectivePeriod) {
        if (!cancelled) {
          setSearchPreviewError("Missing period");
          setSearchPreviewLoading(false);
        }
        return;
      }

      // Update displayed preview period once resolved.
      const typeNorm = String(parsed.type || 'dynamic').toLowerCase();
      const monthsForYear = highlightMonthsForYearFromQuery(qq, effectivePeriod);
      const shouldClearMonth = monthsForYear.length > 1;
      const shouldSetMonth = monthsForYear.length === 1;
      const resolvedMonth = shouldClearMonth
        ? ''
        : shouldSetMonth
          ? String(monthsForYear[0])
          : '';

      const facets = typeNorm === 'exim' ? extractEximQueryFacets(qq) : {};
      const nextParams = {
        ...parsed,
        period: effectivePeriod,
        month: resolvedMonth,
        // Fill missing EXIM facets from the user's query so preview rows can be filtered.
        pod: parsed.pod || facets.pod || '',
        ctr: parsed.ctr || facets.ctr || '',
        code_hs: parsed.code_hs || facets.code_hs || '',
      };
      setSearchPreviewParams(nextParams);

      // Multi-year mode: if we have tabs, preload all years once.
      const shouldPrefetchAllYears = yearsForTabs.length > 1 && (originalMissingPeriod || qYears.length > 1);
      if (shouldPrefetchAllYears) {
        const yearsToFetch = yearsForTabs.slice();
        const activeYear = yearsToFetch.includes(effectivePeriod) ? effectivePeriod : yearsToFetch[0];
        void (async () => {
          try {
            const map: Record<string, DynamicResponse> = {};
            let idx = 0;
            const workerCount = Math.max(1, Math.min(4, yearsToFetch.length));

            const fetchOne = async (y: string) => {
              const monthsForYear = highlightMonthsForYearFromQuery(qq, y);
              const nextMonth = monthsForYear.length === 1 ? String(monthsForYear[0]) : "";
              const url = `/api/data-preview?source_id=${encodeURIComponent(nextParams.source_id)}&period=${encodeURIComponent(y)}${nextParams.type ? `&type=${encodeURIComponent(nextParams.type)}` : ""}${nextMonth ? `&month=${encodeURIComponent(nextMonth)}` : ""}${nextParams.group ? `&group=${encodeURIComponent(nextParams.group)}` : ""}${nextParams.code_hs ? `&code_hs=${encodeURIComponent(nextParams.code_hs)}` : ""}${nextParams.pod ? `&pod=${encodeURIComponent(nextParams.pod)}` : ""}${nextParams.ctr ? `&ctr=${encodeURIComponent(nextParams.ctr)}` : ""}${nextParams.metric ? `&metric=${encodeURIComponent(nextParams.metric)}` : ""}`;
              const res = await fetch(url, { cache: "no-store" });
              const json = (await res.json()) as any;
              if (!res.ok) return;
              map[y] = json as DynamicResponse;
            };

            await Promise.all(
              new Array(workerCount).fill(0).map(async () => {
                while (idx < yearsToFetch.length) {
                  const y = yearsToFetch[idx++];
                  if (!/^(19\d{2}|20\d{2}|2100)$/.test(String(y || '').trim())) continue;
                  await fetchOne(String(y || '').trim());
                }
              })
            );

            if (cancelled) return;
            if (Object.keys(map).length > 0) {
              setSearchPreviewPayloadByYear(map);
              setSearchPreviewActiveYear(activeYear);
              setSearchPreviewPayload(map[activeYear] || Object.values(map)[0]);
              setSearchPreviewParams({ ...nextParams, period: activeYear });
            }
          } catch {
            // best-effort
          }
        })();
      }

      try {
        const url = `/api/data-preview?source_id=${encodeURIComponent(nextParams.source_id)}&period=${encodeURIComponent(effectivePeriod)}${nextParams.type ? `&type=${encodeURIComponent(nextParams.type)}` : ""}${resolvedMonth ? `&month=${encodeURIComponent(resolvedMonth)}` : ""}${nextParams.group ? `&group=${encodeURIComponent(nextParams.group)}` : ""}${nextParams.code_hs ? `&code_hs=${encodeURIComponent(nextParams.code_hs)}` : ""}${nextParams.pod ? `&pod=${encodeURIComponent(nextParams.pod)}` : ""}${nextParams.ctr ? `&ctr=${encodeURIComponent(nextParams.ctr)}` : ""}${nextParams.metric ? `&metric=${encodeURIComponent(nextParams.metric)}` : ""}`;
        const res = await fetch(url, { cache: "no-store" });
        const json = (await res.json()) as any;
        if (cancelled) return;
        if (!res.ok) {
          const code = typeof json?.code === 'string' ? json.code : '';
          const msg = formatPreviewFetchErrorMessage(code, String(nextParams.type || 'dynamic'));
          if (msg) setSearchPreviewError(msg);
          else setSearchPreviewError(typeof json?.message === "string" ? json.message : "Gagal memuat data.");
          return;
        }
        setSearchPreviewPayload(json as DynamicResponse);
      } catch {
        if (cancelled) return;
        setSearchPreviewError("Gagal memuat data.");
      } finally {
        if (!cancelled) setSearchPreviewLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [searchResults, searchLoading, searchOpen]);

  const onSearchPreviewYearClick = async (y: string) => {
    const yy = String(y || '').trim();
    if (!/^(19\d{2}|20\d{2}|2100)$/.test(yy)) return;
    if (!searchPreviewParams) return;

    // Multi-year mode: switch locally without refetch.
    if (searchPreviewPayloadByYear && searchPreviewPayloadByYear[yy]) {
      const qq = searchQuery.trim();
      const monthsForYear = highlightMonthsForYearFromQuery(qq, yy);
      const resolvedMonth = monthsForYear.length === 1 ? String(monthsForYear[0]) : '';
      setSearchPreviewActiveYear(yy);
      setSearchPreviewPayload(searchPreviewPayloadByYear[yy]);
      setSearchPreviewParams((prev) => (prev ? { ...prev, period: yy, month: resolvedMonth } : prev));
      setSearchPreviewNeedsConfirmYear(false);
      setSearchPreviewConfirmYearMessage(null);
      return;
    }

    const qq = searchQuery.trim();
    const typeNorm = String(searchPreviewParams.type || 'dynamic').toLowerCase();
    const monthsForYear = highlightMonthsForYearFromQuery(qq, yy);
    const resolvedMonth = monthsForYear.length === 1 ? String(monthsForYear[0]) : '';

    setSearchPreviewParams((prev) =>
      prev
        ? {
            ...prev,
            period: yy,
            month: resolvedMonth,
          }
        : prev
    );

    try {
      setSearchPreviewError(null);
      setSearchPreviewPayload(null);
      setSearchPreviewLoading(true);

      const url = `/api/data-preview?source_id=${encodeURIComponent(searchPreviewParams.source_id)}&period=${encodeURIComponent(yy)}${searchPreviewParams.type ? `&type=${encodeURIComponent(searchPreviewParams.type)}` : ""}${resolvedMonth ? `&month=${encodeURIComponent(resolvedMonth)}` : ""}${searchPreviewParams.group ? `&group=${encodeURIComponent(searchPreviewParams.group)}` : ""}${searchPreviewParams.code_hs ? `&code_hs=${encodeURIComponent(searchPreviewParams.code_hs)}` : ""}${searchPreviewParams.pod ? `&pod=${encodeURIComponent(searchPreviewParams.pod)}` : ""}${searchPreviewParams.ctr ? `&ctr=${encodeURIComponent(searchPreviewParams.ctr)}` : ""}${searchPreviewParams.metric ? `&metric=${encodeURIComponent(searchPreviewParams.metric)}` : ""}`;
      const res = await fetch(url, { cache: 'no-store' });
      const json = (await res.json()) as any;
      if (!res.ok) {
        const code = typeof json?.code === 'string' ? json.code : '';
        const msg = formatPreviewFetchErrorMessage(code, String(searchPreviewParams.type || 'dynamic'));
        if (msg) setSearchPreviewError(msg);
        else setSearchPreviewError(typeof json?.message === 'string' ? json.message : 'Gagal memuat data.');
        return;
      }
      setSearchPreviewPayload(json as DynamicResponse);

      setSearchPreviewPayloadByYear((prev) => ({ ...(prev || {}), [yy]: json as DynamicResponse }));
    } catch {
      setSearchPreviewError('Gagal memuat data.');
    } finally {
      setSearchPreviewLoading(false);
    }
  };

  const renderSearchPreview = () => {
    if (!searchPreviewParams) return null;

    const qYearsAll = extractQueryYears(searchQuery);
    const showYearTabs =
      (searchPreviewNeedsConfirmYear || searchPreviewPeriodWasMissing || qYearsAll.length > 1) && searchPreviewAvailableYears.length > 1;

    const d = searchPreviewPayload?.data;
    const previewSourceId = Number(searchPreviewParams.source_id);
    const previewUnit = searchResults.datasources.find(ds => ds.id === previewSourceId)?.unit || null;
    const columns = Array.isArray(d?.columns) ? d!.columns! : [];
    const rowsRaw = Array.isArray(d?.data) ? d!.data! : [];
    const monthNo = Number(searchPreviewParams.month || "");
    const monthFromParam = Number.isFinite(monthNo) && monthNo >= 1 && monthNo <= 12 ? monthNo : null;
    const qFromLink = String((searchPreviewParams as any)?.q || "").trim();
    const qEffective = qFromLink || searchQuery;
    const typeNorm = String((searchPreviewParams as any)?.type || "dynamic").toLowerCase();
    const eximMode = detectEximModeFromQuery(qEffective);
    const queryMonthsForYear = searchPreviewParams.period
      ? highlightMonthsForYearFromQuery(qEffective, String(searchPreviewParams.period))
      : [];
    const highlightMonthNos =
      queryMonthsForYear.length > 0
        ? queryMonthsForYear
        : monthFromParam
          ? [monthFromParam]
          : [];
    const showMonthLabel = highlightMonthNos.length === 1;
    const columnsShown = typeNorm === 'exim' ? filterEximColumnsForQuery(columns, qEffective, searchPreviewParams) : columns;

    const monthKeyCol =
      columnsShown.find((c) => /^(bulan|month)$/i.test(String(c).trim())) ||
      columnsShown.find((c) => /(bulan|month)/i.test(String(c).trim())) ||
      columnsShown[0];

    const geo = searchPreviewParams.geo ? String(searchPreviewParams.geo) : "";
    const geoNorm = normGeo(geo);
    const geoKeyCol = geoNorm ? findGeoColumn(columns) : null;
    const rowsGeo = geoNorm && geoKeyCol
      ? rowsRaw.filter((r) => matchesGeoCell((r as any)?.[geoKeyCol], geoNorm))
      : rowsRaw;
    const terms = typeNorm === "exim" ? [] : extractQueryTerms(qEffective);
    const rowsByTerms = terms.length > 0
      ? rowsGeo.filter((r) => rowMatchesTerms(r as any, terms, columns))
      : rowsGeo;
    // Guardrail: if term filtering removes everything (common when the query contains geo text
    // but the table itself doesn't have geo columns), fall back to the unfiltered rows.
    let rows = terms.length > 0 && rowsByTerms.length === 0 ? rowsGeo : rowsByTerms;

    // EXIM-only: if query specifies month(s) for the selected year, show only those months.
    if (typeNorm === 'exim' && highlightMonthNos.length > 0 && monthKeyCol) {
      rows = rows.filter((r) => highlightMonthNos.some((m) => matchesMonthCell((r as any)?.[monthKeyCol], m)));
    }

    // Kab/Kota production ordering (Maluku Utara): BPS standard order with province last.
    // Also applies PDRB aggregate ordering.
    if (typeNorm !== 'exim') {
      rows = applyTableRowOrdering({
        rows,
        columns: columnsShown,
        title: String(d?.source || ''),
      });
    }

    const numericCols = (() => {
      const out = new Set<string>();
      if (typeNorm === 'exim') return out;

      const isAxisCol = (c: string) => /^(bulan|month|tahun|year|periode|period|tanggal|date)$/i.test(String(c).trim());
      const looksLikeCode = (c: string) => /(kode|code|id|no\b|nomor|rank)/i.test(String(c));
      const looksLikeLabel = (c: string) => /(kategori|lapangan.*usaha|nama|wilayah|daerah|label)/i.test(String(c));

      for (const col of columnsShown) {
        if (!col) continue;
        if (col === columnsShown[0]) continue;
        if (isAxisCol(col)) continue;
        if (looksLikeCode(col)) continue;
        if (looksLikeLabel(col)) continue;

        let seen = 0;
        let numeric = 0;
        for (const rr of rows.slice(0, 80)) {
          const v = (rr as any)?.[col];
          if (v === null || v === undefined || String(v).trim() === '') continue;
          seen++;
          if (formatNumberId(v) !== null) numeric++;
        }
        if (seen > 0 && numeric / seen >= 0.8) out.add(col);
      }
      return out;
    })();

    const toCell = (col: string, row: any) => {
      const v = row?.[col];
      if (typeNorm === 'exim') return eximCellValue(col, v);
      if (v === null || v === undefined || String(v).trim() === '') return '-';
      if (numericCols.has(col)) return formatNumberId(v) ?? String(v);
      return String(v);
    };

    return (
      <div className="px-2 pb-2">
        <div className="mx-1 rounded-xl border border-gray-200 bg-white p-3 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Preview • Data Statistik</div>
              <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {d?.period || searchPreviewParams.period}
                {geoNorm ? ` • ${geo}` : ""}
                {showMonthLabel ? ` • ${monthNameFromNo(highlightMonthNos[0])}` : ""}
                {previewUnit ? ` • Satuan: ${previewUnit}` : ""}
              </div>
            </div>
            <Link
              href="#"
              className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
              onClick={(e) => {
                e.preventDefault();
                submitSearch({ closeMobile: true });
              }}
            >
              Buka
            </Link>
          </div>
          <div className="mt-3">
            {showYearTabs ? (
              <div className="mb-3 flex flex-wrap gap-2">
                {searchPreviewAvailableYears.map((y) => {
                  const active = String(searchPreviewParams?.period || '').trim() === String(y || '').trim();
                  return (
                    <button
                      key={y}
                      type="button"
                      onClick={() => onSearchPreviewYearClick(y)}
                      disabled={searchPreviewLoading}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        active
                          ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
                          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-white/[0.05]'
                      }`}
                    >
                      {y}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {searchPreviewNeedsConfirmYear && !searchPreviewLoading && !searchPreviewPayload ? (
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {searchPreviewConfirmYearMessage || "Tahun yang diminta belum tersedia. Pilih salah satu tahun yang tersedia untuk menampilkan preview."}
              </div>
            ) : searchPreviewLoading ? (
              <div className="text-xs text-gray-500 dark:text-gray-400">Loading...</div>
            ) : searchPreviewError ? (
              <div className="text-xs text-gray-500 dark:text-gray-400">{searchPreviewError}</div>
            ) : columnsShown.length === 0 ? (
              <div className="text-xs text-gray-500 dark:text-gray-400">Format data tidak didukung.</div>
            ) : rows.length === 0 ? (
              <div className="text-xs text-gray-500 dark:text-gray-400">Tidak ada data.</div>
            ) : (
              <div className="max-h-64 overflow-auto rounded-xl border border-gray-200 dark:border-gray-800">
                <table className="min-w-full border-collapse text-xs">
                  <thead className="sticky top-0 z-10 bg-white dark:bg-gray-900">
                    <tr className="border-b border-gray-200 dark:border-gray-800">
                      {columnsShown.map((c) => (
                        <th
                          key={c}
                          className={`px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 ${
                            (typeNorm === 'exim' && /^(value|netweight)$/i.test(String(c).trim())) ||
                            (typeNorm !== 'exim' && numericCols.has(c))
                              ? 'text-right'
                              : ''
                          }`}
                        >
                          {typeNorm === "exim" ? eximColumnLabel(c, eximMode) : c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, idx) => {
                      const monthHit =
                        highlightMonthNos.length > 0 && monthKeyCol
                          ? highlightMonthNos.some((m) => matchesMonthCell((r as any)?.[monthKeyCol], m))
                          : false;
                      return (
                        <tr
                          key={idx}
                          className={`border-b border-gray-100 dark:border-gray-800 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50 ${monthHit ? "bg-brand-50/70 dark:bg-brand-500/10" : ""}`}
                        >
                          {columnsShown.map((c) => (
                            <td
                              key={c}
                              className={`px-3 py-2 text-gray-800 dark:text-white/90 ${
                                monthHit
                                  ? `font-semibold ${c === monthKeyCol ? "border-l-4 border-brand-500 pl-2" : ""}`
                                  : ""
                              } ${
                                (typeNorm === 'exim' && /^(value|netweight)$/i.test(String(c).trim())) ||
                                (typeNorm !== 'exim' && numericCols.has(c))
                                  ? 'text-right'
                                  : ''
                              }`}
                            >
                              {toCell(c, r)}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  useEffect(() => {
    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      (window as any).__MALIKA_PWA_PROMPT__ = e;
      setInstallReady(true);
      void trackAnalyticsEvent("pwa_install_prompt_ready_header");
    };
    const onInstalled = () => {
      (window as any).__MALIKA_PWA_PROMPT__ = null;
      setInstallReady(false);
      void trackAnalyticsEvent("pwa_install_completed");
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const onInstallClick = async () => {
    const ev = (window as any).__MALIKA_PWA_PROMPT__ as
      | undefined
      | { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
    if (!ev) return;
    try {
      void trackAnalyticsEvent("pwa_install_prompt_opened_header");
      await ev.prompt();
      const choice = await ev.userChoice;
      void trackAnalyticsEvent("pwa_install_prompt_choice_header", {
        outcome: choice.outcome,
      });
      if (choice && choice.outcome === "accepted") setInstallReady(false);
    } catch {
      // ignore
    }
  };

  // Dynamic header left position based on sidebar state (for desktop lg+)
  const desktopLeftOffset = isExpanded || isHovered ? 290 : 90;

  return (
    <header 
      className="fixed top-0 right-0 flex bg-white border-gray-200 z-[99999] dark:border-gray-800 dark:bg-gray-900 lg:border-b transition-[left] duration-300 ease-in-out left-0 lg:left-[var(--sidebar-width)]"
      style={{ 
        '--sidebar-width': `${desktopLeftOffset}px`
      } as React.CSSProperties}
      role="banner"
      aria-label="Header navigasi"
    >
      <div className="flex flex-col items-center justify-between grow lg:flex-row lg:px-6">
        <div className="flex items-center justify-between w-full gap-2 px-3 py-3 border-b border-gray-200 dark:border-gray-800 sm:gap-4 lg:justify-normal lg:border-b-0 lg:px-0 lg:py-4">
          {/* Hamburger - hidden on mobile, uses bottom nav instead */}
          <button
            className="hidden lg:flex items-center justify-center w-10 h-10 text-gray-500 border-gray-200 rounded-lg z-[99999] dark:border-gray-800 dark:text-gray-400 lg:h-11 lg:w-11 lg:border focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            onClick={handleToggle}
            aria-label={isMobileOpen ? "Tutup sidebar" : "Buka sidebar"}
            aria-expanded={isMobileOpen}
            aria-controls="sidebar"
          >
            {isMobileOpen ? (
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M6.21967 7.28131C5.92678 6.98841 5.92678 6.51354 6.21967 6.22065C6.51256 5.92775 6.98744 5.92775 7.28033 6.22065L11.999 10.9393L16.7176 6.22078C17.0105 5.92789 17.4854 5.92788 17.7782 6.22078C18.0711 6.51367 18.0711 6.98855 17.7782 7.28144L13.0597 12L17.7782 16.7186C18.0711 17.0115 18.0711 17.4863 17.7782 17.7792C17.4854 18.0721 17.0105 18.0721 16.7176 17.7792L11.999 13.0607L7.28033 17.7794C6.98744 18.0722 6.51256 18.0722 6.21967 17.7794C5.92678 17.4865 5.92678 17.0116 6.21967 16.7187L10.9384 12L6.21967 7.28131Z"
                  fill="currentColor"
                />
              </svg>
            ) : (
              <svg
                width="16"
                height="12"
                viewBox="0 0 16 12"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M0.583252 1C0.583252 0.585788 0.919038 0.25 1.33325 0.25H14.6666C15.0808 0.25 15.4166 0.585786 15.4166 1C15.4166 1.41421 15.0808 1.75 14.6666 1.75L1.33325 1.75C0.919038 1.75 0.583252 1.41422 0.583252 1ZM0.583252 11C0.583252 10.5858 0.919038 10.25 1.33325 10.25L14.6666 10.25C15.0808 10.25 15.4166 10.5858 15.4166 11C15.4166 11.4142 15.0808 11.75 14.6666 11.75L1.33325 11.75C0.919038 11.75 0.583252 11.4142 0.583252 11ZM1.33325 5.25C0.919038 5.25 0.583252 5.58579 0.583252 6C0.583252 6.41421 0.919038 6.75 1.33325 6.75L7.99992 6.75C8.41413 6.75 8.74992 6.41421 8.74992 6C8.74992 5.58579 8.41413 5.25 7.99992 5.25L1.33325 5.25Z"
                  fill="currentColor"
                />
              </svg>
            )}
            {/* Cross Icon */}
          </button>

          {!mobileSearchOpen ? (
            <>
              <Link href="/" className="lg:hidden">
                <span className="flex items-center gap-2">
                  <Image
                    src="/images/logo/logo-icon.svg"
                    alt="Logo"
                    width={32}
                    height={32}
                  />
                  <span className="text-lg font-semibold text-gray-900 dark:text-white/90">
                    MALIKA
                  </span>
                </span>
              </Link>

              {/* Mobile actions inline (single row): search + theme + install + settings + notifications */}
              <div className="flex items-center gap-2 lg:hidden">
                {/* Search button - triggers mobile search overlay */}
                <button
                  type="button"
                  onClick={() => setMobileSearchOpen(true)}
                  className="relative flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
                  aria-label="Buka pencarian"
                  data-tour="mobile-search-button"
                >
                  <svg
                    className="h-5 w-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </button>

                <ThemeToggleButton />

                {installReady ? (
                  <button
                    type="button"
                    onClick={onInstallClick}
                    className="inline-flex items-center justify-center rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
                  >
                    Install
                  </button>
                ) : null}

                <Link
                  href="/settings"
                  className="relative flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
                >
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </Link>
                <NotificationDropdown />
              </div>
            </>
          ) : (
            <div ref={searchWrapRef} className="relative flex w-full items-center gap-2 lg:hidden">
              <div className="relative flex-1">
                <span className="absolute -translate-y-1/2 left-4 top-1/2 pointer-events-none">
                  <svg
                    className="fill-gray-500 dark:fill-gray-400"
                    width="20"
                    height="20"
                    viewBox="0 0 20 20"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      fillRule="evenodd"
                      clipRule="evenodd"
                      d="M3.04175 9.37363C3.04175 5.87693 5.87711 3.04199 9.37508 3.04199C12.8731 3.04199 15.7084 5.87693 15.7084 9.37363C15.7084 12.8703 12.8731 15.7053 9.37508 15.7053C5.87711 15.7053 3.04175 12.8703 3.04175 9.37363ZM9.37508 1.54199C5.04902 1.54199 1.54175 5.04817 1.54175 9.37363C1.54175 13.6991 5.04902 17.2053 9.37508 17.2053C11.2674 17.2053 13.003 16.5344 14.357 15.4176L17.177 18.238C17.4699 18.5309 17.9448 18.5309 18.2377 18.238C18.5306 17.9451 18.5306 17.4703 18.2377 17.1774L15.418 14.3573C16.5365 13.0033 17.2084 11.2669 17.2084 9.37363C17.2084 5.04817 13.7011 1.54199 9.37508 1.54199Z"
                    />
                  </svg>
                </span>

                <input
                  ref={inputRef}
                  type="search"
                  placeholder="Search smarter with Malika..."
                  aria-label="Cari data statistik, publikasi, atau berita"
                  aria-autocomplete="list"
                  aria-controls="search-results-mobile"
                  aria-expanded={searchOpen}
                  autoComplete="off"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => {
                    setSearchOpen(true);
                    if (searchQuery.trim().length < 2) loadFavorites();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submitSearch({ closeMobile: true });
                    }
                  }}
                  className="dark:bg-dark-900 h-11 w-full rounded-lg border border-gray-200 bg-transparent py-2.5 pl-12 pr-10 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-800 dark:bg-gray-900 dark:bg-white/[0.03] dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800"
                />

                {/* Clear search button */}
                {searchQuery.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      inputRef.current?.focus();
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                    aria-label="Clear search"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 20 20"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        fillRule="evenodd"
                        clipRule="evenodd"
                        d="M6.21967 6.21967C6.51256 5.92678 6.98744 5.92678 7.28033 6.21967L10 8.93934L12.7197 6.21967C13.0126 5.92678 13.4874 5.92678 13.7803 6.21967C14.0732 6.51256 14.0732 6.98744 13.7803 7.28033L11.0607 10L13.7803 12.7197C14.0732 13.0126 14.0732 13.4874 13.7803 13.7803C13.4874 14.0732 13.0126 14.0732 12.7197 13.7803L10 11.0607L7.28033 13.7803C6.98744 14.0732 6.51256 14.0732 6.21967 13.7803C5.92678 13.4874 5.92678 13.0126 6.21967 12.7197L8.93934 10L6.21967 7.28033C5.92678 6.98744 5.92678 6.51256 6.21967 6.21967Z"
                        fill="currentColor"
                      />
                    </svg>
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => submitSearch({ closeMobile: true })}
                disabled={!canSubmitSearch}
                className="inline-flex h-11 items-center justify-center rounded-full border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Submit search"
              >
                Enter
              </button>

              <button
                type="button"
                onClick={() => setMobileSearchOpen(false)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
                aria-label="Close search"
              >
                <svg
                  className="fill-current"
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M5.21967 5.21967C5.51256 4.92678 5.98744 4.92678 6.28033 5.21967L10 8.93934L13.7197 5.21967C14.0126 4.92678 14.4874 4.92678 14.7803 5.21967C15.0732 5.51256 15.0732 5.98744 14.7803 6.28033L11.0607 10L14.7803 13.7197C15.0732 14.0126 15.0732 14.4874 14.7803 14.7803C14.4874 15.0732 14.0126 15.0732 13.7197 14.7803L10 11.0607L6.28033 14.7803C5.98744 15.0732 5.51256 15.0732 5.21967 14.7803C4.92678 14.4874 4.92678 14.0126 5.21967 13.7197L8.93934 10L5.21967 6.28033C4.92678 5.98744 4.92678 5.51256 5.21967 5.21967Z"
                  />
                </svg>
              </button>

              {searchOpen ? (
                <div className="absolute left-0 right-0 top-full mt-2 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-lg dark:border-gray-800 dark:bg-gray-900">
                  <div className="max-h-[420px] overflow-y-auto">
                    {searchLoading ? (
                      <div className="p-4 text-sm text-gray-500 dark:text-gray-400">Loading...</div>
                    ) : null}

                    {/* Recent Searches */}
                    {!searchLoading && searchQuery.trim().length < 2 && recentSearches.length > 0 && (
                      <div className="border-b border-gray-100 py-2 dark:border-gray-800">
                        <div className="flex items-center justify-between px-3 py-2">
                          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Pencarian Terakhir</span>
                          <button
                            type="button"
                            onClick={clearRecentSearches}
                            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                          >
                            Hapus
                          </button>
                        </div>
                        {recentSearches.map((recent, idx) => (
                          <button
                            key={`recent-m-${idx}`}
                            type="button"
                            onClick={() => {
                              setSearchQuery(recent);
                              submitSearch({ closeMobile: true });
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-white/[0.05]"
                          >
                            <svg className="h-4 w-4 text-gray-400" viewBox="0 0 20 20" fill="none">
                              <path d="M10 4V10L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5" />
                            </svg>
                            <span className="text-sm text-gray-700 dark:text-gray-300">{recent}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* If query is a question, show only the smart banner (skip data results) */}
                    {!searchLoading && searchQuery.trim().length >= 2 && isQuestionQuery(searchQuery) ? (
                      <div className="p-3">
                        <button
                          type="button"
                          onClick={() => {
                            setSearchOpen(false);
                            setMobileSearchOpen(false);
                            router.push(`/chat?q=${encodeURIComponent(searchQuery.trim())}`);
                          }}
                          className="flex w-full items-center gap-3 rounded-lg bg-brand-50 px-3 py-3 text-left hover:bg-brand-100 dark:bg-brand-900/20 dark:hover:bg-brand-900/30"
                        >
                          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-500 text-white">
                            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
                            </svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-brand-700 dark:text-brand-300">
                              Tanya MALIKA
                            </div>
                            <div className="text-xs text-brand-600/70 dark:text-brand-400/70">
                              Dapatkan jawaban untuk &quot;{searchQuery.trim()}&quot;
                            </div>
                          </div>
                          <svg className="h-5 w-5 flex-shrink-0 text-brand-500" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                          </svg>
                        </button>
                      </div>
                    ) : !searchLoading &&
                    searchResults.datasources.length === 0 &&
                    searchResults.publications.length === 0 &&
                    searchResults.brs.length === 0 &&
                    searchResults.knowledge.length === 0 ? (
                      <div className="p-4 text-sm text-gray-500 dark:text-gray-400">
                        Tidak ada hasil.
                      </div>
                    ) : (
                      <div className="py-2">
                        {/* Search suggestion - show when user has typed a query */}
                        {searchQuery.trim().length >= 2 && (
                          <div className="border-b border-gray-100 px-2 pb-2 dark:border-gray-800">
                            <button
                              type="button"
                              onClick={() => submitSearch({ closeMobile: true })}
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-brand-50 dark:hover:bg-brand-900/20"
                            >
                              <svg className="h-4 w-4 text-brand-500" viewBox="0 0 20 20" fill="none">
                                <path fillRule="evenodd" clipRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" fill="currentColor" />
                              </svg>
                              <span className="text-sm text-gray-700 dark:text-gray-300">
                                Cari &quot;<span className="font-medium text-brand-600 dark:text-brand-400">{searchQuery.trim()}</span>&quot;
                              </span>
                              <span className="ml-auto text-xs text-gray-400">Enter</span>
                            </button>
                          </div>
                        )}
                        {renderSearchPreview()}
                        {searchResults.datasources.length > 0 ? (
                          <div className="px-2">
                            <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
                              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd" />
                              </svg>
                              Data Statistik
                            </div>
                            {searchResults.datasources.map((it) => (
                              <Link
                                key={`ds-m-${it.id}`}
                                href={stripQueryFromLink(it.link)}
                                className="block rounded-lg px-3 py-2 hover:bg-gray-50 dark:hover:bg-white/[0.05]"
                                                onClick={() => {
                                                  trackDatasourceClick(it.id);
                                                  setSearchOpen(false);
                                                }}
                              >
                                <div className="text-sm font-medium text-gray-800 dark:text-white/90">
                                  {highlightMatch(it.title, searchQuery)}
                                </div>
                                {it.subtitle ? (
                                  <div className="text-xs text-gray-500 dark:text-gray-400">
                                    {highlightMatch(it.subtitle, searchQuery)}
                                  </div>
                                ) : null}
                                {it.unit ? (
                                  <div className="text-[11px] text-gray-400 dark:text-gray-500">
                                    Satuan: {it.unit}
                                  </div>
                                ) : null}
                              </Link>
                            ))}
                          </div>
                        ) : null}

                        {searchResults.publications.length > 0 ? (
                          <div className="mt-2 px-2">
                            <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
                              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
                              </svg>
                              Publikasi
                            </div>
                            {searchResults.publications.map((it) => (
                              <Link
                                key={`pub-m-${it.id}`}
                                href={it.link}
                                className="block rounded-lg px-3 py-2 hover:bg-gray-50 dark:hover:bg-white/[0.05]"
                                onClick={() => setSearchOpen(false)}
                              >
                                <div className="text-sm font-medium text-gray-800 dark:text-white/90">
                                  {highlightMatch(it.title, searchQuery)}
                                </div>
                                {it.subtitle ? (
                                  <div className="text-xs text-gray-500 dark:text-gray-400">
                                    {highlightMatch(it.subtitle, searchQuery)}
                                  </div>
                                ) : null}
                              </Link>
                            ))}
                          </div>
                        ) : null}

                        {searchResults.brs.length > 0 ? (
                          <div className="mt-2 px-2">
                            <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
                              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M2 5a2 2 0 012-2h8a2 2 0 012 2v10a2 2 0 002 2H4a2 2 0 01-2-2V5zm3 1h6v4H5V6zm6 6H5v2h6v-2z" clipRule="evenodd" />
                                <path d="M15 7h1a2 2 0 012 2v5.5a1.5 1.5 0 01-3 0V7z" />
                              </svg>
                              Berita Resmi Statistik
                            </div>
                            {searchResults.brs.map((it) => (
                              <Link
                                key={`brs-m-${it.id}`}
                                href={it.link}
                                className="block rounded-lg px-3 py-2 hover:bg-gray-50 dark:hover:bg-white/[0.05]"
                                onClick={() => setSearchOpen(false)}
                              >
                                <div className="text-sm font-medium text-gray-800 dark:text-white/90">
                                  {highlightMatch(it.title, searchQuery)}
                                </div>
                                {it.subtitle ? (
                                  <div className="text-xs text-gray-500 dark:text-gray-400">
                                    {highlightMatch(it.subtitle, searchQuery)}
                                  </div>
                                ) : null}
                              </Link>
                            ))}
                          </div>
                        ) : null}

                        {/* Knowledge Base (RAG) Results - Mobile */}
                        {searchResults.knowledge.length > 0 ? (
                          <div className="mt-2 border-t border-gray-100 px-2 pt-2 dark:border-gray-800">
                            <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-brand-600 dark:text-brand-400">
                              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.715-5.349L11 6.477V16h2a1 1 0 110 2H7a1 1 0 110-2h2V6.477L6.237 7.582l1.715 5.349a1 1 0 01-.285 1.05A3.989 3.989 0 015 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.788l1.599.799L9 4.323V3a1 1 0 011-1z" />
                              </svg>
                              Rekomendasi AI
                            </div>
                            {searchResults.knowledge.slice(0, 3).map((kb) => {
                              const isBrs = kb.category?.toLowerCase() === 'brs';
                              const isPub = kb.category?.toLowerCase() === 'publikasi';
                              const link = isBrs
                                ? `/brs?kb_id=${kb.id}`
                                : isPub
                                ? `/publikasi?kb_id=${kb.id}`
                                : `/chat?q=${encodeURIComponent(kb.title)}`;
                              return (
                                <Link
                                  key={`kb-m-${kb.id}`}
                                  href={link}
                                  className="block rounded-lg px-3 py-2 hover:bg-brand-50 dark:hover:bg-brand-900/20"
                                  onClick={() => { setSearchOpen(false); setMobileSearchOpen(false); }}
                                >
                                  <div className="flex items-start gap-2">
                                    {isBrs ? (
                                      <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400">
                                        <svg className="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor">
                                          <path fillRule="evenodd" d="M2 5a2 2 0 012-2h8a2 2 0 012 2v10a2 2 0 002 2H4a2 2 0 01-2-2V5zm3 1h6v4H5V6zm6 6H5v2h6v-2z" clipRule="evenodd" />
                                        </svg>
                                      </span>
                                    ) : isPub ? (
                                      <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
                                        <svg className="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor">
                                          <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
                                        </svg>
                                      </span>
                                    ) : (
                                      <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                                        <svg className="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor">
                                          <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                                        </svg>
                                      </span>
                                    )}
                                    <div className="min-w-0 flex-1">
                                      <div className="text-sm font-medium text-gray-800 dark:text-white/90">
                                        {highlightMatch(kb.title, searchQuery)}
                                      </div>
                                      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                                        <span className="capitalize">{kb.category || 'Dokumen'}</span>
                                        <span className="text-gray-300 dark:text-gray-600">•</span>
                                        <span className="text-brand-500">{Math.round((kb.similarity || 0) * 100)}% relevan</span>
                                      </div>
                                    </div>
                                  </div>
                                </Link>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* Mobile: always show actions; no '...' overflow menu */}

          <div className="hidden lg:block" data-tour="search-bar">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitSearch();
              }}
            >
              <div ref={searchWrapRef} className="relative">
                <span className="absolute -translate-y-1/2 left-4 top-1/2 pointer-events-none">
                  <svg
                    className="fill-gray-500 dark:fill-gray-400"
                    width="20"
                    height="20"
                    viewBox="0 0 20 20"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      fillRule="evenodd"
                      clipRule="evenodd"
                      d="M3.04175 9.37363C3.04175 5.87693 5.87711 3.04199 9.37508 3.04199C12.8731 3.04199 15.7084 5.87693 15.7084 9.37363C15.7084 12.8703 12.8731 15.7053 9.37508 15.7053C5.87711 15.7053 3.04175 12.8703 3.04175 9.37363ZM9.37508 1.54199C5.04902 1.54199 1.54175 5.04817 1.54175 9.37363C1.54175 13.6991 5.04902 17.2053 9.37508 17.2053C11.2674 17.2053 13.003 16.5344 14.357 15.4176L17.177 18.238C17.4699 18.5309 17.9448 18.5309 18.2377 18.238C18.5306 17.9451 18.5306 17.4703 18.2377 17.1774L15.418 14.3573C16.5365 13.0033 17.2084 11.2669 17.2084 9.37363C17.2084 5.04817 13.7011 1.54199 9.37508 1.54199Z"
                      fill=""
                    />
                  </svg>
                </span>
                <input
                  ref={inputRef}
                  type="search"
                  placeholder="Search smarter with Malika..."
                  aria-label="Cari data statistik, publikasi, atau berita"
                  aria-autocomplete="list"
                  aria-controls="search-results-desktop"
                  aria-expanded={searchOpen}
                  autoComplete="off"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => {
                    setSearchOpen(true);
                    if (searchQuery.trim().length < 2) loadFavorites();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submitSearch();
                    }
                  }}
                  className="dark:bg-dark-900 h-11 w-full rounded-lg border border-gray-200 bg-transparent py-2.5 pl-12 pr-28 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-800 dark:bg-gray-900 dark:bg-white/[0.03] dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800 xl:w-[430px]"
                />

                {/* Clear search button (desktop) */}
                {searchQuery.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      inputRef.current?.focus();
                    }}
                    className="absolute right-16 top-1/2 -translate-y-1/2 rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                    aria-label="Clear search"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 20 20"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        fillRule="evenodd"
                        clipRule="evenodd"
                        d="M6.21967 6.21967C6.51256 5.92678 6.98744 5.92678 7.28033 6.21967L10 8.93934L12.7197 6.21967C13.0126 5.92678 13.4874 5.92678 13.7803 6.21967C14.0732 6.51256 14.0732 6.98744 13.7803 7.28033L11.0607 10L13.7803 12.7197C14.0732 13.0126 14.0732 13.4874 13.7803 13.7803C13.4874 14.0732 13.0126 14.0732 12.7197 13.7803L10 11.0607L7.28033 13.7803C6.98744 14.0732 6.51256 14.0732 6.21967 13.7803C5.92678 13.4874 5.92678 13.0126 6.21967 12.7197L8.93934 10L6.21967 7.28033C5.92678 6.98744 5.92678 6.51256 6.21967 6.21967Z"
                        fill="currentColor"
                      />
                    </svg>
                  </button>
                )}

                <button
                  type="submit"
                  disabled={!canSubmitSearch}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Submit search"
                >
                  Enter
                </button>

                {searchOpen ? (
                  <div className="absolute left-0 right-0 top-full mt-2 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-lg dark:border-gray-800 dark:bg-gray-900">
                    <div className="max-h-[420px] overflow-y-auto">
                      {searchLoading ? (
                        <div className="p-4 text-sm text-gray-500 dark:text-gray-400">Loading...</div>
                      ) : null}

                      {/* Recent Searches (Desktop) */}
                      {!searchLoading && searchQuery.trim().length < 2 && recentSearches.length > 0 && (
                        <div className="border-b border-gray-100 py-2 dark:border-gray-800">
                          <div className="flex items-center justify-between px-3 py-2">
                            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Pencarian Terakhir</span>
                            <button
                              type="button"
                              onClick={clearRecentSearches}
                              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                            >
                              Hapus
                            </button>
                          </div>
                          {recentSearches.map((recent, idx) => (
                            <button
                              key={`recent-d-${idx}`}
                              type="button"
                              onClick={() => {
                                setSearchQuery(recent);
                                saveRecentSearch(recent);
                                setSearchOpen(false);
                                router.push(`/search?q=${encodeURIComponent(recent)}`);
                              }}
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-white/[0.05]"
                            >
                              <svg className="h-4 w-4 text-gray-400" viewBox="0 0 20 20" fill="none">
                                <path d="M10 4V10L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5" />
                              </svg>
                              <span className="text-sm text-gray-700 dark:text-gray-300">{recent}</span>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* If query is a question, show only the smart banner (skip data results) */}
                      {!searchLoading && searchQuery.trim().length >= 2 && isQuestionQuery(searchQuery) ? (
                        <div className="p-3">
                          <button
                            type="button"
                            onClick={() => {
                              setSearchOpen(false);
                              router.push(`/chat?q=${encodeURIComponent(searchQuery.trim())}`);
                            }}
                            className="flex w-full items-center gap-3 rounded-lg bg-brand-50 px-3 py-3 text-left hover:bg-brand-100 dark:bg-brand-900/20 dark:hover:bg-brand-900/30"
                          >
                            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-500 text-white">
                              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
                              </svg>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-brand-700 dark:text-brand-300">
                                Tanya MALIKA
                              </div>
                              <div className="text-xs text-brand-600/70 dark:text-brand-400/70">
                                Dapatkan jawaban untuk &quot;{searchQuery.trim()}&quot;
                              </div>
                            </div>
                            <svg className="h-5 w-5 flex-shrink-0 text-brand-500" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                            </svg>
                          </button>
                        </div>
                      ) : !searchLoading &&
                      searchResults.datasources.length === 0 &&
                      searchResults.publications.length === 0 &&
                      searchResults.brs.length === 0 &&
                      searchResults.knowledge.length === 0 ? (
                        <div className="p-4 text-sm text-gray-500 dark:text-gray-400">
                          Tidak ada hasil.
                        </div>
                      ) : (
                        <div className="py-2">
                          {/* Search suggestion - show when user has typed a query */}
                          {searchQuery.trim().length >= 2 && (
                            <div className="border-b border-gray-100 px-2 pb-2 dark:border-gray-800">
                              <button
                                type="button"
                                onClick={() => submitSearch()}
                                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-brand-50 dark:hover:bg-brand-900/20"
                              >
                                <svg className="h-4 w-4 text-brand-500" viewBox="0 0 20 20" fill="none">
                                  <path fillRule="evenodd" clipRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" fill="currentColor" />
                                </svg>
                                <span className="text-sm text-gray-700 dark:text-gray-300">
                                  Cari &quot;<span className="font-medium text-brand-600 dark:text-brand-400">{searchQuery.trim()}</span>&quot;
                                </span>
                                <span className="ml-auto text-xs text-gray-400">Enter</span>
                              </button>
                            </div>
                          )}
                          {renderSearchPreview()}
                          {searchResults.datasources.length > 0 ? (
                            <div className="px-2">
                              <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
                                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                  <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd" />
                                </svg>
                                Data Statistik
                              </div>
                              {searchResults.datasources.map((it) => (
                                <Link
                                  key={`ds-${it.id}`}
                                  href={stripQueryFromLink(it.link)}
                                  className="block rounded-lg px-3 py-2 hover:bg-gray-50 dark:hover:bg-white/[0.05]"
                                  onClick={() => {
                                    trackDatasourceClick(it.id);
                                    setSearchOpen(false);
                                  }}
                                >
                                  <div className="text-sm font-medium text-gray-800 dark:text-white/90">
                                    {highlightMatch(it.title, searchQuery)}
                                  </div>
                                  {it.subtitle ? (
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                      {highlightMatch(it.subtitle, searchQuery)}
                                    </div>
                                  ) : null}
                                  {it.unit ? (
                                    <div className="text-[11px] text-gray-400 dark:text-gray-500">
                                      Satuan: {it.unit}
                                    </div>
                                  ) : null}
                                </Link>
                              ))}
                            </div>
                          ) : null}

                          {searchResults.publications.length > 0 ? (
                            <div className="mt-2 px-2">
                              <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
                                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                  <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
                                </svg>
                                Publikasi
                              </div>
                              {searchResults.publications.map((it) => (
                                <Link
                                  key={`pub-${it.id}`}
                                  href={it.link}
                                  className="block rounded-lg px-3 py-2 hover:bg-gray-50 dark:hover:bg-white/[0.05]"
                                  onClick={() => setSearchOpen(false)}
                                >
                                  <div className="text-sm font-medium text-gray-800 dark:text-white/90">
                                    {highlightMatch(it.title, searchQuery)}
                                  </div>
                                  {it.subtitle ? (
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                      {highlightMatch(it.subtitle, searchQuery)}
                                    </div>
                                  ) : null}
                                </Link>
                              ))}
                            </div>
                          ) : null}

                          {searchResults.brs.length > 0 ? (
                            <div className="mt-2 px-2">
                              <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
                                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                  <path fillRule="evenodd" d="M2 5a2 2 0 012-2h8a2 2 0 012 2v10a2 2 0 002 2H4a2 2 0 01-2-2V5zm3 1h6v4H5V6zm6 6H5v2h6v-2z" clipRule="evenodd" />
                                  <path d="M15 7h1a2 2 0 012 2v5.5a1.5 1.5 0 01-3 0V7z" />
                                </svg>
                                Berita Resmi Statistik
                              </div>
                              {searchResults.brs.map((it) => (
                                <Link
                                  key={`brs-${it.id}`}
                                  href={it.link}
                                  className="block rounded-lg px-3 py-2 hover:bg-gray-50 dark:hover:bg-white/[0.05]"
                                  onClick={() => setSearchOpen(false)}
                                >
                                  <div className="text-sm font-medium text-gray-800 dark:text-white/90">
                                    {highlightMatch(it.title, searchQuery)}
                                  </div>
                                  {it.subtitle ? (
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                      {highlightMatch(it.subtitle, searchQuery)}
                                    </div>
                                  ) : null}
                                </Link>
                              ))}
                            </div>
                          ) : null}

                          {/* Knowledge Base (RAG) Results - AI-powered semantic search */}
                          {searchResults.knowledge.length > 0 ? (
                            <div className="mt-2 border-t border-gray-100 px-2 pt-2 dark:border-gray-800">
                              <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-brand-600 dark:text-brand-400">
                                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                  <path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.715-5.349L11 6.477V16h2a1 1 0 110 2H7a1 1 0 110-2h2V6.477L6.237 7.582l1.715 5.349a1 1 0 01-.285 1.05A3.989 3.989 0 015 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.788l1.599.799L9 4.323V3a1 1 0 011-1z" />
                                </svg>
                                Rekomendasi AI
                              </div>
                              {searchResults.knowledge.slice(0, 3).map((kb) => {
                                const isBrs = kb.category?.toLowerCase() === 'brs';
                                const isPub = kb.category?.toLowerCase() === 'publikasi';
                                const link = isBrs
                                  ? `/brs?kb_id=${kb.id}`
                                  : isPub
                                  ? `/publikasi?kb_id=${kb.id}`
                                  : `/chat?q=${encodeURIComponent(kb.title)}`;
                                return (
                                  <Link
                                    key={`kb-${kb.id}`}
                                    href={link}
                                    className="block rounded-lg px-3 py-2 hover:bg-brand-50 dark:hover:bg-brand-900/20"
                                    onClick={() => setSearchOpen(false)}
                                  >
                                    <div className="flex items-start gap-2">
                                      {isBrs ? (
                                        <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400">
                                          <svg className="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M2 5a2 2 0 012-2h8a2 2 0 012 2v10a2 2 0 002 2H4a2 2 0 01-2-2V5zm3 1h6v4H5V6zm6 6H5v2h6v-2z" clipRule="evenodd" />
                                          </svg>
                                        </span>
                                      ) : isPub ? (
                                        <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
                                          <svg className="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor">
                                            <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
                                          </svg>
                                        </span>
                                      ) : (
                                        <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                                          <svg className="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                                          </svg>
                                        </span>
                                      )}
                                      <div className="min-w-0 flex-1">
                                        <div className="text-sm font-medium text-gray-800 dark:text-white/90">
                                          {highlightMatch(kb.title, searchQuery)}
                                        </div>
                                        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                                          <span className="capitalize">{kb.category || 'Dokumen'}</span>
                                          <span className="text-gray-300 dark:text-gray-600">•</span>
                                          <span className="text-brand-500">{Math.round((kb.similarity || 0) * 100)}% relevan</span>
                                        </div>
                                      </div>
                                    </div>
                                  </Link>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </form>
          </div>
        </div>
        <div className="hidden items-center justify-between w-full gap-4 px-5 py-4 lg:flex shadow-theme-md lg:justify-end lg:px-0 lg:shadow-none">
          <div className="flex items-center gap-2 2xsm:gap-3">
            {/* <!-- Dark Mode Toggler --> */}
            <div data-tour="theme-toggle-desktop">
              <ThemeToggleButton />
            </div>
            {/* <!-- Dark Mode Toggler --> */}

            {installReady ? (
              <button
                type="button"
                onClick={onInstallClick}
                className="inline-flex items-center justify-center rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
              >
                Install
              </button>
            ) : null}

            <Link
              href="/settings"
              className="relative flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </Link>
           <NotificationDropdown /> 
            {/* <!-- Notification Menu Area --> */}
          </div>
        </div>
      </div>
    </header>
  );
};

export default AppHeader;
