"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import LoadingProgressBar from "@/components/LoadingProgressBar";
import SearchLoadingProgress, { type SearchProgress, type SearchStage } from "@/components/search/SearchLoadingProgress";
import { DocsIcon, PieChartIcon } from "@/icons";
import { filterEximColumnsForQuery } from "@/lib/eximQueryIntent";
import { SEARCH_INSIGHT_ENABLED } from "@/lib/featureFlags";
import InterpretationPanel, { type InsightResponse } from "@/components/search/InterpretationPanel";
import SearchInsightsChart from "@/components/search/SearchInsightsChart";
import { SearchResultRowSkeleton, TablePreviewSkeleton, QuickResultHeaderSkeleton, InterpretationSkeleton, ChartSkeleton } from "@/components/search/SearchResultSkeleton";
import EmptyState from "@/components/common/EmptyState";
import { normalizeTableData, extractUnitFromTitle } from "@/lib/tableRowOrdering";

const ReactPdfPreview = dynamic(() => import("@/components/brs/ReactPdfPreview"), {
  ssr: false,
});

type Hit = { id: string | number; title: string; subtitle?: string; link: string; score: number; thumbnail?: string; unit?: string | null };

type KnowledgeHit = {
  id: number;
  title: string;
  content: string;
  category: string | null;
  similarity: number;
};

type ApiResponse = {
  q: string;
  exact?: { datasources?: Hit[]; publications?: Hit[]; brs?: Hit[] };
  suggestions?: { datasources?: Hit[]; publications?: Hit[]; brs?: Hit[] };
  knowledge?: KnowledgeHit[];
};

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

type ResultKind = "datasource" | "publication" | "brs";
type MixedHit = Hit & { kind: ResultKind };

type BrsDetail = {
  brs_id: number;
  title: string;
  abstract?: string;
  rl_date: string;
  pdf?: string;
  thumbnail?: string;
};

type PublicationDetail = {
  pub_id: string;
  title: string;
  abstract?: string;
  rl_date?: string;
  cover?: string;
  pdf?: string;
  size?: string;
};

function decodeBasicEntities(input: string) {
  return input
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function sanitizeText(input: string, opts?: { preserveNewlines?: boolean }) {
  let text = String(input || "");
  const preserveNewlines = opts?.preserveNewlines === true;

  text = decodeBasicEntities(text);
  text = text.replace(/<\s*br\s*\/?>/gi, "\n");
  text = text.replace(/<\s*\/\s*(p|div|li|ul|ol|h\d)\s*>/gi, "\n");
  text = text.replace(/<[^>]+>/g, " ");

  if (/[ÃÂâ€]/.test(text)) {
    try {
      const bytes = new Uint8Array(Array.from(text, (c) => c.charCodeAt(0)));
      const decoded = new TextDecoder("utf-8").decode(bytes);
      if (decoded && decoded !== text && !decoded.includes("\uFFFD")) {
        text = decoded;
      }
    } catch {
      // ignore
    }
  }

  if (preserveNewlines) {
    text = text.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, " ");
    text = text.replace(/\n\s+/g, "\n");
    text = text.replace(/[ \t\f\v]+/g, " ");
    text = text.replace(/\n{3,}/g, "\n\n");
    text = text
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n");
  } else {
    text = text.replace(/[\u0000-\u001F\u007F]/g, " ");
    text = text.replace(/\s+/g, " ").trim();
  }

  return text;
}

function parseAbstractBullets(abstract?: string) {
  const text = sanitizeText(abstract || "", { preserveNewlines: true });
  if (!text) return [];

  const rawLines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const bulletPrefix = /^[\u25A0\u25AA\u25CF\u25D8\u2022\u25E6\u25FE\u25AA\-–—*]+\s*/;
  const hasBullets = rawLines.some((l) => bulletPrefix.test(l));
  if (hasBullets) {
    return rawLines
      .map((l) => l.replace(bulletPrefix, "").trim())
      .filter(Boolean)
      .slice(0, 6);
  }

  if (rawLines.length > 1) return rawLines.slice(0, 6);

  return text
    .split(/;|\.(?:\s+|$)/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function formatTanggal(tanggalStr: string) {
  const bulanIndo = [
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember",
  ];

  const parts = String(tanggalStr || "").split("-");
  if (parts.length !== 3) return tanggalStr;

  const [tahun, bulan, tanggal] = parts;
  const monthIndex = Number.parseInt(bulan, 10) - 1;
  const day = Number.parseInt(tanggal, 10);

  if (Number.isNaN(day) || monthIndex < 0 || monthIndex > 11) return tanggalStr;
  return `${day} ${bulanIndo[monthIndex]} ${tahun}`;
}

// Helper to detect if query looks like a question (for Chat MALIKA suggestion)
function isQuestionQuery(query: string): boolean {
  const q = query.toLowerCase().trim();
  const questionPatterns = [
    /^siapa\b/, /^apa\b/, /^bagaimana\b/, /^mengapa\b/, /^kenapa\b/,
    /^kapan\b/, /^dimana\b/, /^berapa\b/, /^apakah\b/, /^bisakah\b/,
    /\?$/, // ends with question mark
  ];
  return questionPatterns.some(p => p.test(q));
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query || query.length < 2) return text;

  const words = query.trim().toLowerCase().split(/\s+/).filter(w => w.length >= 2);
  if (words.length === 0) return text;

  const pattern = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const regex = new RegExp(`(${pattern})`, 'gi');
  const parts = text.split(regex);
  if (parts.length === 1) return text;

  return (
    <>
      {parts.map((part, i) => {
        const isMatch = words.some(w => part.toLowerCase() === w);
        return isMatch ? (
          <mark key={i} className="rounded bg-brand-100 px-0.5 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        );
      })}
    </>
  );
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

const REGION_OPTIONS = [
  "Kota Ternate",
  "Kota Tidore Kepulauan",
  "Kab. Halmahera Utara",
  "Kab. Halmahera Selatan",
  "Kab. Halmahera Tengah",
  "Kab. Halmahera Barat",
  "Kab. Halmahera Timur",
  "Kab. Kepulauan Sula",
  "Kab. Pulau Morotai",
  "Kab. Pulau Taliabu",
];

const REGION_ALIASES: Record<string, string> = {
  "ternate": "Kota Ternate",
  "kota ternate": "Kota Ternate",
  "tidore": "Kota Tidore Kepulauan",
  "tidore kepulauan": "Kota Tidore Kepulauan",
  "halmahera utara": "Kab. Halmahera Utara",
  "halut": "Kab. Halmahera Utara",
  "halmahera selatan": "Kab. Halmahera Selatan",
  "halsel": "Kab. Halmahera Selatan",
  "halmahera tengah": "Kab. Halmahera Tengah",
  "halteng": "Kab. Halmahera Tengah",
  "halmahera barat": "Kab. Halmahera Barat",
  "halbar": "Kab. Halmahera Barat",
  "halmahera timur": "Kab. Halmahera Timur",
  "haltim": "Kab. Halmahera Timur",
  "kepulauan sula": "Kab. Kepulauan Sula",
  "kepsul": "Kab. Kepulauan Sula",
  "pulau morotai": "Kab. Pulau Morotai",
  "morotai": "Kab. Pulau Morotai",
  "pulau taliabu": "Kab. Pulau Taliabu",
  "taliabu": "Kab. Pulau Taliabu",
};

function normalizeRegion(input: string) {
  const raw = String(input || "")
    .toLowerCase()
    .replace(/kab\.|kabupaten|kota|\s+/g, " ")
    .trim();
  if (!raw) return "";
  return REGION_ALIASES[raw] || REGION_ALIASES[raw.replace(/^kab\s+/, "")] || input;
}

function extractYearsFromText(input: string) {
  const years = new Set<string>();
  const matches = String(input || "").match(/\b(19\d{2}|20\d{2}|2100)\b/g);
  if (matches) {
    matches.forEach((y) => years.add(y));
  }
  return Array.from(years);
}

function extractYearFromLink(link: string) {
  const parsed = parseDataLink(link);
  if (parsed?.period && /^(19\d{2}|20\d{2}|2100)$/.test(parsed.period)) return parsed.period;
  return "";
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
  const toNumberLoose = (v: unknown): number | null => {
    if (v === null || v === undefined) return null;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    const s = String(v).trim();
    if (!s) return null;

    // Keep only digits, sign, and separators.
    let cleaned = s.replace(/[^0-9,\.\-+]/g, "");
    if (!cleaned) return null;

    const hasComma = cleaned.includes(",");
    const hasDot = cleaned.includes(".");

    // Helper: collapse multiple dots to a single decimal dot (keep last one).
    const normalizeSingleDecimalDot = (input: string) => {
      const idx = input.lastIndexOf(".");
      if (idx <= 0) return input;
      const head = input.slice(0, idx).replace(/\./g, "");
      const tail = input.slice(idx);
      return head + tail;
    };

    if (hasComma && hasDot) {
      const lastComma = cleaned.lastIndexOf(",");
      const lastDot = cleaned.lastIndexOf(".");
      const decimalSep = lastComma > lastDot ? "," : ".";
      const thousandSep = decimalSep === "," ? "." : ",";
      cleaned = cleaned.split(thousandSep).join("");
      if (decimalSep === ",") cleaned = cleaned.replace(/,/g, ".");
      cleaned = normalizeSingleDecimalDot(cleaned);
    } else if (hasComma) {
      const last = cleaned.lastIndexOf(",");
      const frac = cleaned.slice(last + 1);
      // If 1-2 digits after comma, treat comma as decimal; else comma as thousands.
      if (frac.length >= 1 && frac.length <= 2) {
        cleaned = cleaned.replace(/\./g, "").replace(/,/g, ".");
        cleaned = normalizeSingleDecimalDot(cleaned);
      } else {
        cleaned = cleaned.replace(/,/g, "");
      }
    } else if (hasDot) {
      const last = cleaned.lastIndexOf(".");
      const frac = cleaned.slice(last + 1);
      // If 1-2 digits after dot, treat dot as decimal; else dot as thousands.
      if (frac.length >= 1 && frac.length <= 2) {
        cleaned = cleaned.replace(/,/g, "");
        cleaned = normalizeSingleDecimalDot(cleaned);
      } else {
        cleaned = cleaned.replace(/\./g, "");
      }
    }

    const n = Number(cleaned);
    if (!Number.isFinite(n)) return null;
    return n;
  };

  const n = toNumberLoose(input);
  if (n === null) return null;
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

function extractMonthNo(cell: unknown): number | null {
  for (let m = 1; m <= 12; m++) {
    if (matchesMonthCell(cell, m)) return m;
  }
  return null;
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

function isProvinceGeoMalukuUtara(geoNorm: string) {
  const g = String(geoNorm || '').trim();
  return g === 'maluku utara' || g === 'malut';
}

function looksKabKotaBreakdown(title: string, columns: string[]) {
  const t = String(title || '');
  const cols = Array.isArray(columns) ? columns : [];
  const colsJoined = cols.join(' ');
  // Check title/columns for explicit kab/kota patterns
  if (/(menurut\s+kabupaten\s*\/\s*kota|kabupaten\s*\/\s*kota|kab\s*\/\s*kota|kab\s*kota)/i.test(t + ' ' + colsJoined)) {
    return true;
  }
  // Also detect if first column is "Wilayah" (common in interop tables)
  const firstCol = String(cols[0] || '').trim().toLowerCase();
  if (firstCol === 'wilayah') {
    return true;
  }
  return false;
}

function findWilayahCodeColumn(columns: string[]) {
  const cols = Array.isArray(columns) ? columns : [];
  const exact = cols.find((c) => /^(kode|kode_wilayah|kode_kabkota|kode_kab_kota|id_wilayah|idkab|id_kab|id_kabkota|id_kab_kota)$/i.test(String(c || '').trim()));
  if (exact) return exact;
  return cols.find((c) => /(kode|id).*(wilayah|kab|kota)/i.test(String(c || '').trim())) || null;
}

function applyMalutWilayahDefaultOrder(args: {
  rows: any[];
  geoKeyCol: string | null;
  wilayahCodeCol: string | null;
  title: string;
  columns: string[];
}) {
  const { rows, geoKeyCol, wilayahCodeCol, title, columns } = args;
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  if (!looksKabKotaBreakdown(title, columns)) return rows;

  // Desired production order for Maluku Utara kab/kota (BPS codes).
  const orderCodes = [8201, 8202, 8203, 8204, 8205, 8206, 8207, 8208, 8271, 8272, 8200];
  const orderPos = new Map<number, number>();
  orderCodes.forEach((code, idx) => orderPos.set(code, idx));

  const normName = (v: unknown) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const nameToCode: Record<string, number> = {
    'halmahera barat': 8201,
    'halmahera tengah': 8202,
    'kepulauan sula': 8203,
    'halmahera selatan': 8204,
    'halmahera utara': 8205,
    'halmahera timur': 8206,
    'pulau morotai': 8207,
    'pulau taliabu': 8208,
    'kota ternate': 8271,
    'kota tidore kepulauan': 8272,
    // Without "Kota" prefix (dynamic API uses these)
    'ternate': 8271,
    'tidore kepulauan': 8272,
    'maluku utara': 8200,
  };

  const parseCode = (v: unknown): number | null => {
    if (v == null) return null;
    if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
    const s = String(v).trim();
    const m = s.match(/\b\d{4}\b/);
    if (!m) return null;
    const n = Number(m[0]);
    return Number.isInteger(n) ? n : null;
  };

  const getRowCode = (r: any): number | null => {
    if (wilayahCodeCol) {
      const c = parseCode(r?.[wilayahCodeCol]);
      if (c != null) return c;
    }
    if (geoKeyCol) {
      const name = normName(r?.[geoKeyCol]);
      if (name && typeof nameToCode[name] === 'number') return nameToCode[name];
    }
    return null;
  };

  // Activate only when this table actually looks like Maluku Utara kab/kota.
  const hasAnyKnown = rows.some((r) => {
    const code = getRowCode(r);
    return typeof code === 'number' && orderPos.has(code);
  });
  if (!hasAnyKnown) return rows;

  // Stable sort: known codes first in desired order; unknown keep original relative order after.
  const decorated = rows.map((r, idx) => {
    const code = getRowCode(r);
    const pos = typeof code === 'number' ? orderPos.get(code) : undefined;
    return { r, idx, pos: typeof pos === 'number' ? pos : null };
  });

  decorated.sort((a, b) => {
    const ap = a.pos;
    const bp = b.pos;
    if (ap != null && bp != null) return ap - bp;
    if (ap != null && bp == null) return -1;
    if (ap == null && bp != null) return 1;
    return a.idx - b.idx;
  });

  return decorated.map((x) => x.r);
}

function shouldApplyGeoFilter(opts: {
  geoNorm: string;
  filteredLen: number;
  totalLen: number;
  title: string;
  columns: string[];
}) {
  const { geoNorm, filteredLen, totalLen, title, columns } = opts;
  if (filteredLen <= 0) return false;
  if (filteredLen >= totalLen) return true;

  // Heuristic: when the query geo is province-level ("maluku utara") and the datasource is a
  // kab/kota breakdown table, filtering by province name often matches only the aggregate row
  // and hides kab/kota rows. In this case, do NOT apply the filter.
  const isProv = isProvinceGeoMalukuUtara(geoNorm);
  const isKabKota = looksKabKotaBreakdown(title, columns);
  if (isProv && isKabKota && totalLen > 3 && filteredLen <= 1) return false;

  return true;
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

function queryHasRangeHint(q: string) {
  const raw = String(q || '').toLowerCase();
  if (!raw) return false;
  // Common Indonesian range markers + punctuation dashes.
  return /(\b(sampai|hingga|sd|s\/d|s\.d|to)\b|\s[-–—]\s)/i.test(raw);
}

function expandYearsInclusive(years: string[]) {
  const nums = (Array.isArray(years) ? years : [])
    .map((y) => Number(String(y || '').trim()))
    .filter((n) => Number.isFinite(n) && n >= 1900 && n <= 2100);
  const uniq = Array.from(new Set(nums)).sort((a, b) => a - b);
  if (uniq.length < 2) return Array.from(new Set(years));
  const minY = uniq[0];
  const maxY = uniq[uniq.length - 1];
  const out: string[] = [];
  for (let y = minY; y <= maxY; y++) out.push(String(y));
  return out;
}

function extractQueryYearsExpanded(q: string) {
  const base = extractQueryYears(q);
  if (base.length >= 2 && queryHasRangeHint(q)) return expandYearsInclusive(base);
  return base;
}

function normalizeMonthQuery(q: string) {
  let s = String(q || '').toLowerCase();
  if (!s) return s;

  // English -> Indonesian canonical
  s = s
    .replace(/\bjanuary\b/g, 'januari')
    .replace(/\bjan\b/g, 'jan')
    .replace(/\bjan\.\b/g, 'jan')
    .replace(/\bfebruary\b/g, 'februari')
    .replace(/\bfeb\b/g, 'feb')
    .replace(/\bfeb\.\b/g, 'feb')
    .replace(/\bfebr\b/g, 'feb')
    .replace(/\bmarch\b/g, 'maret')
    .replace(/\bmar\b/g, 'mar')
    .replace(/\bmar\.\b/g, 'mar')
    .replace(/\bmrt\b/g, 'mar')
    .replace(/\bapril\b/g, 'april')
    .replace(/\bapr\b/g, 'apr')
    .replace(/\bapr\.\b/g, 'apr')
    .replace(/\bmay\b/g, 'mei')
    .replace(/\bjune\b/g, 'juni')
    .replace(/\bjun\b/g, 'jun')
    .replace(/\bjun\.\b/g, 'jun')
    .replace(/\bjuly\b/g, 'juli')
    .replace(/\bjul\b/g, 'jul')
    .replace(/\bjul\.\b/g, 'jul')
    .replace(/\baugust\b/g, 'agustus')
    .replace(/\baug\b/g, 'ags')
    .replace(/\bseptember\b/g, 'september')
    .replace(/\bsept\b/g, 'sep')
    .replace(/\bsep\.\b/g, 'sep')
    .replace(/\boctober\b/g, 'oktober')
    .replace(/\boct\b/g, 'okt')
    .replace(/\bnovember\b/g, 'november')
    .replace(/\bnov\b/g, 'nov')
    .replace(/\bdecember\b/g, 'desember')
    .replace(/\bdec\b/g, 'des');

  // Common typos / local shorthand
  s = s
    .replace(/\bjanuar(i)+\b/g, 'januari')
    .replace(/\bjanuri\b/g, 'januari')
    .replace(/\bjanwari\b/g, 'januari')
    .replace(/\bfebruar(i)+\b/g, 'februari')
    .replace(/\bfebuari\b/g, 'februari')
    .replace(/\bfebuary\b/g, 'februari')
    .replace(/\bpebruari\b/g, 'februari')
    .replace(/\bagt\b/g, 'ags')
    .replace(/\bags\b/g, 'ags')
    .replace(/\bagst\b/g, 'ags')
    .replace(/\bagus\b/g, 'agustus')
    .replace(/\bagu\b/g, 'ags')
    .replace(/\bnopember\b/g, 'november')
    .replace(/\bnovembar\b/g, 'november')
    .replace(/\bnovem\b/g, 'nov')
    .replace(/\bdessember\b/g, 'desember');

  return s;
}

function extractSingleQueryMonthNo(q: string): string {
  const raw = normalizeMonthQuery(q);
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
  const raw = normalizeMonthQuery(q);
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
  const raw = normalizeMonthQuery(q);
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

  // month - month year (e.g. feb-apr 2024) => capture endpoints
  const reSameYearRange = new RegExp(`\\b(${monthToken})\\b\\s*${rangeSep}\\s*\\b(${monthToken})\\b\\s*\\b(${yearToken})\\b`, 'g');
  for (const m of raw.matchAll(reSameYearRange)) {
    const m1 = monthMap[String(m[1] || '')];
    const m2 = monthMap[String(m[2] || '')];
    const y = String(m[3] || '').trim();
    if (Number.isInteger(m1)) out.push({ year: y, monthNo: m1 });
    if (Number.isInteger(m2)) out.push({ year: y, monthNo: m2 });
  }

  // month year - month year
  const reFullRange = new RegExp(`\\b(${monthToken})\\b\\s*\\b(${yearToken})\\b\\s*${rangeSep}\\s*\\b(${monthToken})\\b\\s*\\b(${yearToken})\\b`, 'g');
  for (const m of raw.matchAll(reFullRange)) {
    const m1 = monthMap[String(m[1] || '')];
    const y1 = String(m[2] || '').trim();
    const m2 = monthMap[String(m[3] || '')];
    const y2 = String(m[4] || '').trim();
    if (Number.isInteger(m1)) out.push({ year: y1, monthNo: m1 });
    if (Number.isInteger(m2)) out.push({ year: y2, monthNo: m2 });
  }

  // Discrete month year
  const reMonthYear = new RegExp(`\\b(${monthToken})\\b\\s*\\b(${yearToken})\\b`, 'g');
  for (const m of raw.matchAll(reMonthYear)) {
    const mo = monthMap[String(m[1] || '')];
    const y = String(m[2] || '').trim();
    if (Number.isInteger(mo)) out.push({ year: y, monthNo: mo });
  }

  // Numeric YYYY-MM or YYYY/MM
  const reYm = new RegExp(`\\b(${yearToken})\\s*[-\\/]\\s*(0?[1-9]|1[0-2])\\b`, 'g');
  for (const m of raw.matchAll(reYm)) {
    const y = String(m[1] || '').trim();
    const mo = Number(m[2]);
    if (Number.isInteger(mo) && mo >= 1 && mo <= 12) out.push({ year: y, monthNo: mo });
  }

  // Numeric MM-YYYY or MM/YYYY
  const reMy = new RegExp(`\\b(0?[1-9]|1[0-2])\\s*[-\\/]\\s*(${yearToken})\\b`, 'g');
  for (const m of raw.matchAll(reMy)) {
    const mo = Number(m[1]);
    const y = String(m[2] || '').trim();
    if (Number.isInteger(mo) && mo >= 1 && mo <= 12) out.push({ year: y, monthNo: mo });
  }

  // Dedup
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

  const raw = normalizeMonthQuery(q);
  const months = new Set<number>();

  // Discrete month-year mentions (including endpoints detected by extractQueryMonthYearPairs)
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
  const period = sp.get("period") || "";
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
    period,
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

function ResultAvatar({ kind }: { kind: ResultKind }) {
  const wrapper = "relative block h-11 w-11 rounded-full";
  const base = "flex h-11 w-11 items-center justify-center rounded-full p-1.5";

  const className =
    kind === "publication"
      ? "bg-success-50 text-success-500 dark:bg-success-500/[0.12] dark:text-success-400"
      : kind === "brs"
        ? "bg-warning-50 text-warning-500 dark:bg-warning-500/[0.12] dark:text-warning-400"
        : "bg-brand-50 text-brand-500 dark:bg-brand-500/[0.12] dark:text-brand-400";

  return (
    <span className={wrapper}>
      <span className={`${base} ${className}`}>
        {kind === "publication" ? (
          <DocsIcon className="block h-8 w-8 overflow-visible flex-shrink-0" />
        ) : kind === "brs" ? (
          <DocsIcon className="block h-8 w-8 overflow-visible flex-shrink-0" />
        ) : (
          <PieChartIcon className="block h-8 w-8 overflow-visible flex-shrink-0" />
        )}
      </span>
    </span>
  );
}

function ResultCard({ it, onOpen, query }: { it: MixedHit; onOpen: (it: MixedHit) => void; query: string }) {
  const isDataStat = it.kind === "datasource";
  const hasThumb = it.kind !== "datasource" && !!it.thumbnail;
  const subtitle = it.subtitle ? String(it.subtitle) : "";
  const scoreLabel = typeof it.score === "number" ? `${Math.round(it.score)}%` : null;

  return (
    <button
      type="button"
      onClick={() => onOpen(it)}
      className="group relative flex w-64 shrink-0 flex-col rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs transition-transform duration-200 hover:scale-[1.02] hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-white/[0.05]"
    >
      <div className="absolute right-3 top-3 flex items-center gap-1">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
          it.kind === "publication"
            ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300"
            : it.kind === "brs"
              ? "bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-300"
              : "bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300"
        }`}>
          {it.kind === "publication" ? "Publikasi" : it.kind === "brs" ? "BRS" : "Data"}
        </span>
        {scoreLabel ? (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-300">
            {scoreLabel}
          </span>
        ) : null}
      </div>

      <div className="flex justify-center">
        <ResultAvatar kind={it.kind} />
      </div>

      {hasThumb ? (
        <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-white/[0.03]">
          {/* Use <img> (not next/image) to avoid remote domain config. */}
          <img
            src={it.thumbnail}
            alt=""
            className="h-auto w-full object-contain"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        </div>
      ) : null}

      <div
        className={`${isDataStat ? "mt-4" : hasThumb ? "mt-2" : "mt-3"} text-sm font-semibold text-gray-900 dark:text-white/90 line-clamp-3`}
      >
        {highlightMatch(it.title, query)}
      </div>
      {subtitle ? (
        <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
          {highlightMatch(subtitle, query)}
        </div>
      ) : null}
      {isDataStat && it.unit ? (
        <div className="mt-1 text-[11px] text-gray-400 dark:text-gray-500 truncate">
          Satuan: {it.unit}
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-x-3 bottom-3 rounded-xl border border-gray-200 bg-white/95 p-2 text-[11px] text-gray-600 opacity-0 shadow-theme-sm transition-opacity duration-200 group-hover:opacity-100 dark:border-gray-800 dark:bg-gray-900/90 dark:text-gray-300">
        <div className="flex items-center justify-between">
          <span className="font-medium">Pratinjau cepat</span>
          <span className="text-[10px] text-gray-400">Hover</span>
        </div>
        <p className="mt-1 line-clamp-2">
          {subtitle || (isDataStat ? "Klik untuk melihat preview data." : "Klik untuk detail dokumen.")}
        </p>
      </div>
    </button>
  );
}

export default function SearchPageClient() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // Do not memoize with `[params]`: `useSearchParams()` can be referentially stable,
  // which would prevent updates when only the query string changes.
  const q = (params?.get("q") || "").trim();

  const [activeKinds, setActiveKinds] = useState<ResultKind[]>(["datasource", "publication", "brs"]);
  const [regionFilter, setRegionFilter] = useState<string>("all");
  const [yearStart, setYearStart] = useState<string>("");
  const [yearEnd, setYearEnd] = useState<string>("");
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const RECENT_SEARCHES_KEY = "malika_recent_searches";

  const searchCacheRef = useRef<Map<string, { ts: number; data: ApiResponse }>>(new Map());
  const SEARCH_CACHE_TTL = 1000 * 60 * 5;
  const [visibleCount, setVisibleCount] = useState(6);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const apiKey = useMemo(() => {
    return process.env.NEXT_PUBLIC_BPS_API_KEY || "e5d1be11320576d466bdeb2f7f210387";
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) setRecentSearches(parsed.slice(0, 6));
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const typeParam = params?.get("type") || "";
    const regionParam = params?.get("region") || "all";
    const startParam = params?.get("start") || "";
    const endParam = params?.get("end") || "";

    const kinds = typeParam
      .split(",")
      .map((t) => t.trim())
      .filter((t): t is ResultKind => t === "datasource" || t === "publication" || t === "brs");

    setActiveKinds(kinds.length > 0 ? kinds : ["datasource", "publication", "brs"]);
    setRegionFilter(regionParam || "all");
    setYearStart(startParam);
    setYearEnd(endParam);
  }, [params]);

  const updateFilters = (next: {
    kinds?: ResultKind[];
    region?: string;
    start?: string;
    end?: string;
  }) => {
    const sp = new URLSearchParams(params?.toString());
    if (next.kinds) {
      if (next.kinds.length >= 3) sp.delete("type");
      else sp.set("type", next.kinds.join(","));
    }
    if (typeof next.region === "string") {
      if (!next.region || next.region === "all") sp.delete("region");
      else sp.set("region", next.region);
    }
    if (typeof next.start === "string") {
      if (!next.start) sp.delete("start");
      else sp.set("start", next.start);
    }
    if (typeof next.end === "string") {
      if (!next.end) sp.delete("end");
      else sp.set("end", next.end);
    }
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  };

  const [clientPdfMode, setClientPdfMode] = useState<"unknown" | "iframe" | "pdfjs">("unknown");
  useEffect(() => {
    if (typeof navigator === "undefined") {
      setClientPdfMode("iframe");
      return;
    }

    const ua = navigator.userAgent || "";
    const isSafari = /safari/i.test(ua) && !/chrome|chromium|crios|android/i.test(ua);
    const isAndroid = /android/i.test(ua);
    const iOSDevice = /iPad|iPhone|iPod/i.test(ua);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const iPadOS13Plus = (navigator as any).platform === "MacIntel" && navigator.maxTouchPoints > 1;
    const isIOS = iOSDevice || iPadOS13Plus;

    setClientPdfMode(isIOS || isSafari || isAndroid ? "pdfjs" : "iframe");
  }, []);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ApiResponse | null>(null);

  // Enhanced progress tracking
  const [searchProgress, setSearchProgress] = useState<SearchProgress>({
    stage: "idle",
    message: "",
  });

  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewPayload, setPreviewPayload] = useState<DynamicResponse | null>(null);
  const [previewPayloadByYear, setPreviewPayloadByYear] = useState<Record<string, DynamicResponse> | null>(null);
  const [previewActiveYear, setPreviewActiveYear] = useState<string | null>(null);
  const [previewParams, setPreviewParams] = useState<ReturnType<typeof parseDataLink> | null>(null);
  const [previewPendingParams, setPreviewPendingParams] = useState<ReturnType<typeof parseDataLink> | null>(null);
  const [previewLink, setPreviewLink] = useState<string | null>(null);
  const [previewUnavailable, setPreviewUnavailable] = useState<string | null>(null);
  const [previewIndicator, setPreviewIndicator] = useState<string | null>(null);
  const [previewUnit, setPreviewUnit] = useState<string | null>(null);
  const [previewChartConfig, setPreviewChartConfig] = useState<any | null>(null);
  const [previewAvailableYears, setPreviewAvailableYears] = useState<string[]>([]);
  const [previewPeriodWasMissing, setPreviewPeriodWasMissing] = useState(false);
  const [previewNeedsConfirmYear, setPreviewNeedsConfirmYear] = useState(false);
  const [previewConfirmYearMessage, setPreviewConfirmYearMessage] = useState<string | null>(null);
  const [previewGeneratedAt, setPreviewGeneratedAt] = useState<string | null>(null);

  const [downloadOpen, setDownloadOpen] = useState(false);
  const downloadMenuRef = useRef<HTMLDivElement | null>(null);
  const [previewColumnMenuOpen, setPreviewColumnMenuOpen] = useState(false);
  const previewColumnMenuRef = useRef<HTMLDivElement | null>(null);
  const [previewHiddenColumns, setPreviewHiddenColumns] = useState<string[]>([]);
  const [previewColumnWidths, setPreviewColumnWidths] = useState<Record<string, number>>({});

  const insightsCacheRef = useRef<Map<string, InsightResponse>>(new Map());

  const [modalHit, setModalHit] = useState<MixedHit | null>(null);
  const [modalDoc, setModalDoc] = useState<BrsDetail | PublicationDetail | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const [modalDataPayload, setModalDataPayload] = useState<DynamicResponse | null>(null);
  const [modalDataLoading, setModalDataLoading] = useState(false);
  const [modalDataError, setModalDataError] = useState<string | null>(null);
  const [modalDataParams, setModalDataParams] = useState<ReturnType<typeof parseDataLink> | null>(null);

  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfProgress, setPdfProgress] = useState(0);

  const shouldUsePdfJs = clientPdfMode === "pdfjs";

  useEffect(() => {
    const pdf = modalDoc ? String((modalDoc as any).pdf || "") : "";
    if (!modalHit || modalHit.kind === "datasource") return;
    if (!pdf) {
      setPdfLoading(false);
      setPdfProgress(0);
      return;
    }

    if (shouldUsePdfJs) {
      setPdfLoading(false);
      setPdfProgress(0);
      return;
    }

    setPdfLoading(true);
    setPdfProgress(0);
    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const eased = 1 - Math.exp(-elapsed / 600);
      const next = Math.min(90, Math.round(eased * 90));
      setPdfProgress((p) => (next > p ? next : p));
    }, 80);

    return () => window.clearInterval(interval);
  }, [modalDoc, modalHit, shouldUsePdfJs]);

  function PdfJsPreview({ url }: { url: string }) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [rendering, setRendering] = useState(false);
    const [totalPages, setTotalPages] = useState(0);
    const [renderedPages, setRenderedPages] = useState(0);
    const [downloadPct, setDownloadPct] = useState<number | null>(null);
    const [containerWidth, setContainerWidth] = useState<number>(0);

    useEffect(() => {
      let resizeObserver: ResizeObserver | null = null;

      const updateWidth = () => {
        const el = containerRef.current;
        if (!el) return;
        const next = Math.floor(el.clientWidth || 0);
        if (!next) return;
        setContainerWidth((prev) => (Math.abs(prev - next) >= 12 ? next : prev));
      };

      updateWidth();

      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => updateWidth());
        if (containerRef.current) resizeObserver.observe(containerRef.current);
      }

      return () => {
        if (resizeObserver) resizeObserver.disconnect();
      };
    }, [url]);

    useEffect(() => {
      setError(null);
      setTotalPages(0);
      setRenderedPages(0);
      setDownloadPct(null);
      setRendering(true);
    }, [url]);

    return (
      <div className="pdfjs-scroll h-full w-full overflow-y-auto overscroll-contain bg-white pb-16 [-webkit-overflow-scrolling:touch] dark:bg-gray-900">
        {error ? (
          <div className="flex h-full w-full items-center justify-center px-4 text-theme-sm text-gray-500 dark:text-gray-400">
            {error}
          </div>
        ) : null}

        {rendering ? (
          <div className="px-4 py-3">
            <div className="flex items-center justify-between text-theme-sm text-gray-700 dark:text-gray-200">
              <span>Memuat PDF{typeof downloadPct === "number" ? ` (${downloadPct}%)` : "..."}</span>
              {totalPages > 0 ? (
                <span className="text-theme-xs text-gray-500 dark:text-gray-400">
                  {Math.min(Math.max(renderedPages, 1), totalPages)}/{totalPages} halaman
                </span>
              ) : null}
            </div>

            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
              <div
                className="h-full rounded-full bg-gray-900 transition-[width] duration-200 dark:bg-white"
                style={{ width: `${typeof downloadPct === "number" ? downloadPct : 10}%` }}
              />
            </div>
          </div>
        ) : null}

        <div ref={containerRef} className="mx-auto w-full max-w-[900px]">
          <ReactPdfPreview
            url={url}
            width={containerWidth}
            onLoadProgressAction={(p) => {
              const total = p?.total || 0;
              const loaded = p?.loaded || 0;
              if (total > 0) {
                const pct = Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
                setDownloadPct(pct);
              }
            }}
            onLoadSuccessAction={(numPages) => {
              setTotalPages(numPages || 0);
            }}
            onPageRenderAction={(pageNo) => {
              setRenderedPages((p) => (pageNo > p ? pageNo : p));
              if (pageNo === 1) setRendering(false);
            }}
            onErrorAction={(message) => {
              setError(message || "Gagal memuat PDF");
              setRendering(false);
            }}
          />
        </div>
      </div>
    );
  }

  const closeAnyModal = () => {
    setModalHit(null);
    setModalDoc(null);
    setModalError(null);
    setModalLoading(false);
    setModalDataPayload(null);
    setModalDataError(null);
    setModalDataLoading(false);
    setModalDataParams(null);
    setPdfLoading(false);
    setPdfProgress(0);
  };

  useEffect(() => {
    if (!downloadOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = downloadMenuRef.current;
      if (!el) return;
      const target = e.target as Node | null;
      if (target && el.contains(target)) return;
      setDownloadOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [downloadOpen]);

  useEffect(() => {
    if (!previewColumnMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = previewColumnMenuRef.current;
      if (!el) return;
      const target = e.target as Node | null;
      if (target && el.contains(target)) return;
      setPreviewColumnMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [previewColumnMenuOpen]);

  useEffect(() => {
    if (!modalHit) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAnyModal();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [modalHit]);

  useEffect(() => {
    if (!modalHit) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [modalHit]);

  const openHitModal = async (it: MixedHit) => {
    setModalHit(it);
    setModalDoc(null);
    setModalError(null);
    setModalLoading(false);
    setModalDataPayload(null);
    setModalDataError(null);
    setModalDataLoading(false);
    setModalDataParams(null);
    setPdfLoading(false);
    setPdfProgress(0);

    if (it.kind === "datasource") {
      const parsed = parseDataLink(it.link);
      setModalDataParams(parsed);
      if (!parsed) {
        setModalDataError("Preview tabel hanya tersedia untuk link /data.");
        return;
      }

      setModalDataLoading(true);
      try {
        let effectivePeriod = String(parsed.period || "").trim();
        if (!effectivePeriod) {
          const pr = await fetch(`/api/periods?source_id=${encodeURIComponent(parsed.source_id)}`, { cache: "no-store" });
          const pj = (await pr.json()) as any;
          const raw = Array.isArray(pj?.periods) ? pj.periods : [];
          const years = raw
            .map((p: any) => {
              if (typeof p === "string") return p;
              return p?.year || p?.th || p?.th_id || null;
            })
            .map((y: any) => String(y || "").trim())
            .filter((y: string) => /^(19\d{2}|20\d{2}|2100)$/.test(y));
          years.sort((a: string, b: string) => Number(b) - Number(a));

          // IMPORTANT: don't rely on React state immediately after setPreviewAvailableYears.
          // Use a local variable for prefetch decisions.
          let yearsForTabs: string[] = [];
          effectivePeriod = pickYearFromQuery(years, q);
        }

        if (!effectivePeriod) {
          setModalDataError("Periode belum tersedia untuk indikator ini.");
          return;
        }

        const monthNoFromQuery = extractSingleQueryMonthNo(q);
        const qYears = extractQueryYears(q);
        const shouldSetMonth =
          !String(parsed.month || '').trim() &&
          monthNoFromQuery &&
          qYears.includes(String(effectivePeriod)) &&
          ['dynamic', 'interop'].includes(String(parsed.type || 'dynamic').toLowerCase());
        const monthParam = shouldSetMonth ? monthNoFromQuery : String(parsed.month || '');

        const typeNorm = String(parsed.type || 'dynamic').toLowerCase();
        const facets = typeNorm === 'exim' ? extractEximQueryFacets(q) : {};
        const nextParams = {
          ...parsed,
          period: effectivePeriod,
          month: monthParam,
          pod: parsed.pod || facets.pod || '',
          ctr: parsed.ctr || facets.ctr || '',
          code_hs: parsed.code_hs || facets.code_hs || '',
        };
        setModalDataParams(nextParams);

        const url = `/api/data-preview?source_id=${encodeURIComponent(nextParams.source_id)}&period=${encodeURIComponent(effectivePeriod)}${nextParams.type ? `&type=${encodeURIComponent(nextParams.type)}` : ""}${monthParam ? `&month=${encodeURIComponent(monthParam)}` : ""}${nextParams.group ? `&group=${encodeURIComponent(nextParams.group)}` : ""}${nextParams.code_hs ? `&code_hs=${encodeURIComponent(nextParams.code_hs)}` : ""}${nextParams.pod ? `&pod=${encodeURIComponent(nextParams.pod)}` : ""}${nextParams.ctr ? `&ctr=${encodeURIComponent(nextParams.ctr)}` : ""}${nextParams.metric ? `&metric=${encodeURIComponent(nextParams.metric)}` : ""}`;
        const res = await fetch(url, { cache: "no-store" });
        const json = (await res.json()) as any;
        if (!res.ok) {
          const code = typeof json?.code === 'string' ? json.code : '';
          const msg = formatPreviewFetchErrorMessage(code, String(nextParams.type || 'dynamic'));
          if (msg) setModalDataError(msg);
          else setModalDataError(typeof json?.message === "string" ? json.message : "Gagal memuat data.");
          return;
        }
        setModalDataPayload(json as DynamicResponse);
      } catch {
        setModalDataError("Gagal memuat data.");
      } finally {
        setModalDataLoading(false);
      }
      return;
    }

    // BRS / Publikasi: load detail from BPS view endpoint so modal matches their pages.
    setModalLoading(true);
    try {
      if (it.kind === "publication") {
        const pubId = String(it.id || "").trim();
        const url = `https://webapi.bps.go.id/v1/api/view/domain/8200/model/publication/lang/ind/id/${encodeURIComponent(pubId)}/key/${apiKey}/`;
        const res = await fetch(url, { cache: "no-store" });
        const raw = (await res.json()) as { data?: Record<string, unknown> };
        const d = raw?.data && typeof raw.data === "object" ? raw.data : null;
        if (!d) throw new Error("Data tidak ditemukan");

        const mapped: PublicationDetail = {
          pub_id: pubId,
          title: String((d as any)?.title || it.title || ""),
          abstract: (d as any)?.abstract != null ? String((d as any).abstract) : undefined,
          rl_date: (d as any)?.rl_date != null ? String((d as any).rl_date) : undefined,
          cover: (d as any)?.cover != null ? String((d as any).cover) : undefined,
          pdf: (d as any)?.pdf != null ? String((d as any).pdf) : undefined,
          size: (d as any)?.size != null ? String((d as any).size) : undefined,
        };
        setModalDoc(mapped);
      } else {
        const brsId = Number(it.id);
        const url = `https://webapi.bps.go.id/v1/api/view/domain/8200/model/pressrelease/lang/ind/id/${encodeURIComponent(String(brsId))}/key/${apiKey}/`;
        const res = await fetch(url, { cache: "no-store" });
        const raw = (await res.json()) as { data?: Record<string, unknown> };
        const d = raw?.data && typeof raw.data === "object" ? raw.data : null;
        if (!d) throw new Error("Data tidak ditemukan");

        const mapped: BrsDetail = {
          brs_id: brsId,
          title: String((d as any)?.title || it.title || ""),
          abstract: (d as any)?.abstract != null ? String((d as any).abstract) : undefined,
          rl_date: String((d as any)?.rl_date || ""),
          pdf:
            (d as any)?.pdf != null
              ? String((d as any).pdf)
              : (d as any)?.pdf_url != null
                ? String((d as any).pdf_url)
                : undefined,
          thumbnail:
            (d as any)?.thumbnail != null
              ? String((d as any).thumbnail)
              : (d as any)?.thumbnail_url != null
                ? String((d as any).thumbnail_url)
                : undefined,
        };
        setModalDoc(mapped);
      }
    } catch (e) {
      setModalError(e instanceof Error ? e.message : "Gagal memuat detail.");
    } finally {
      setModalLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const qq = q;
    const controller = new AbortController();
    if (!qq || qq.length < 2) {
      setData({
        q: qq,
        exact: { datasources: [], publications: [], brs: [] },
        suggestions: { datasources: [], publications: [], brs: [] },
      });
      setLoading(false);
      setSearchProgress({ stage: "idle", message: "" });
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    try {
      const trimmed = qq.trim();
      setRecentSearches((prev) => {
        const updated = [trimmed, ...prev.filter((s) => s.toLowerCase() !== trimmed.toLowerCase())].slice(0, 6);
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
        return updated;
      });
    } catch {
      // ignore
    }

    const cached = searchCacheRef.current.get(qq);
    if (cached && Date.now() - cached.ts < SEARCH_CACHE_TTL) {
      setData(cached.data);
      setLoading(false);
      // Count results from cache
      const dsCount = (cached.data.exact?.datasources?.length || 0) + (cached.data.suggestions?.datasources?.length || 0);
      const pubCount = (cached.data.exact?.publications?.length || 0) + (cached.data.suggestions?.publications?.length || 0);
      const brsCount = (cached.data.exact?.brs?.length || 0) + (cached.data.suggestions?.brs?.length || 0);
      const totalCount = dsCount + pubCount + brsCount;
      setSearchProgress({
        stage: "preview",
        message: "Memuat preview data...",
        resultCount: totalCount,
        subMessage: `${dsCount} data statistik, ${pubCount} publikasi, ${brsCount} BRS`,
      });
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    setLoading(true);
    setSearchProgress({
      stage: "searching",
      message: "Mencari data statistik...",
      subMessage: "Memproses data Badan Pusat Statistik",
    });

    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(qq)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const json = (await res.json()) as ApiResponse;
        if (cancelled || controller.signal.aborted) return;
        setData(json);
        searchCacheRef.current.set(qq, { ts: Date.now(), data: json });
        
        // Count results
        const dsCount = (json.exact?.datasources?.length || 0) + (json.suggestions?.datasources?.length || 0);
        const pubCount = (json.exact?.publications?.length || 0) + (json.suggestions?.publications?.length || 0);
        const brsCount = (json.exact?.brs?.length || 0) + (json.suggestions?.brs?.length || 0);
        const totalCount = dsCount + pubCount + brsCount;
        
        setSearchProgress({
          stage: "preview",
          message: "Memuat preview data...",
          resultCount: totalCount,
          subMessage: `${dsCount} data statistik, ${pubCount} publikasi, ${brsCount} BRS`,
        });
      } catch {
        if (cancelled || controller.signal.aborted) return;
        setData({
          q: q,
          exact: { datasources: [], publications: [], brs: [] },
          suggestions: { datasources: [], publications: [], brs: [] },
        });
        setSearchProgress({ stage: "idle", message: "" });
      } finally {
        if (!cancelled && !controller.signal.aborted) setLoading(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [q]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setPreviewPayload(null);
      setPreviewPayloadByYear(null);
      setPreviewActiveYear(null);
      setPreviewError(null);
      setPreviewParams(null);
      setPreviewPendingParams(null);
      setPreviewLink(null);
      setPreviewUnavailable(null);
      setPreviewIndicator(null);
      setPreviewUnit(null);
      setPreviewChartConfig(null);
      setPreviewAvailableYears([]);
      setPreviewPeriodWasMissing(false);
      setPreviewNeedsConfirmYear(false);
      setPreviewConfirmYearMessage(null);
      setPreviewGeneratedAt(null);
      setDownloadOpen(false);

      if (loading) return;

      const exactDs = Array.isArray(data?.exact?.datasources) ? data!.exact!.datasources! : [];
      const sugDs = Array.isArray(data?.suggestions?.datasources) ? data!.suggestions!.datasources! : [];

      const candidates = [...exactDs, ...sugDs];
      if (candidates.length === 0) return;

      const bestCandidate = candidates
        .slice()
        .sort((a, b) => ((b.score || 0) - (a.score || 0)))[0];
      if (bestCandidate?.title) setPreviewIndicator(bestCandidate.title || null);
      // Set unit from best candidate
      setPreviewUnit((bestCandidate as any)?.unit || null);
      // Set chart config from best candidate
      setPreviewChartConfig((bestCandidate as any)?.chart_config || null);

      const bestParsed = candidates
        .map((it) => ({ it, parsed: parseDataLink(it?.link) }))
        .filter((x) => !!x.parsed)
        .sort((a, b) => ((b.it.score || 0) - (a.it.score || 0)))
        [0] || null;

      if (!bestParsed?.parsed) {
        const bestLink = typeof bestCandidate?.link === "string" ? bestCandidate.link : "";
        const subtitle = typeof bestCandidate?.subtitle === "string" ? bestCandidate.subtitle : "";

        if (bestLink.startsWith("/search?") && subtitle) {
          setPreviewUnavailable(`Preview belum bisa ditampilkan: ${subtitle}.`);
        } else if (bestLink.startsWith("/search?")) {
          setPreviewUnavailable("Preview belum bisa ditampilkan. Tambahkan tahun (mis. 2025) pada kata kunci agar sistem bisa membuka halaman data dan menampilkan preview.");
        } else {
          setPreviewUnavailable(
            "Preview tabel hanya tersedia untuk Data Statistik. Untuk EXIM, tambahkan komoditas/HS2 (mis. nikel / HS 75) agar bisa menampilkan data."
          );
        }
        return;
      }

      const parsed = bestParsed.parsed;

      // Keep a copy even when we require year confirmation.
      setPreviewPendingParams(parsed);

      const originalMissingPeriod = !String(parsed.period || "").trim();
      setPreviewPeriodWasMissing(originalMissingPeriod);

      // For preview fetching/display, resolve a concrete year if missing.
      // Also keep a canonical link for "Buka halaman data" that matches the currently shown year.
      setPreviewIndicator(bestParsed.it.title || null);
      setPreviewLoading(true);
      try {
        let effectivePeriod = String(parsed.period || "").trim();
        const qYears = extractQueryYearsExpanded(q)
          .map((y) => String(y || '').trim())
          .filter((y) => /^(19\d{2}|20\d{2}|2100)$/.test(y));

        // Used to drive multi-year tabs + prefetch without relying on async state.
        let yearsForTabs: string[] = [];

        const shouldResolveToQueryYear =
          qYears.length > 0 && (!effectivePeriod || !qYears.includes(effectivePeriod) || qYears.length > 1);

        // IMPORTANT: if user explicitly requests a year (or year range), we must validate availability
        // and must NOT silently fall back to the newest year.
        const shouldFetchPeriodsForValidation = originalMissingPeriod || shouldResolveToQueryYear || qYears.length > 0;

        if (shouldFetchPeriodsForValidation) {
          const pr = await fetch(`/api/periods?source_id=${encodeURIComponent(parsed.source_id)}`, { cache: "no-store" });
          const pj = (await pr.json()) as any;
          const raw = Array.isArray(pj?.periods) ? pj.periods : [];
          const years = raw
            .map((p: any) => {
              if (typeof p === "string") return p;
              return p?.year || p?.th || p?.th_id || null;
            })
            .map((y: any) => String(y || "").trim())
            .filter((y: string) => /^(19\d{2}|20\d{2}|2100)$/.test(y));
          years.sort((a: string, b: string) => Number(b) - Number(a));

          // Year validation rules
          if (qYears.length === 1) {
            const target = qYears[0];
            if (target && !years.includes(target)) {
              setPreviewNeedsConfirmYear(true);
              setPreviewConfirmYearMessage(
                years.length > 0
                  ? `Periode ${target} belum tersedia untuk indikator ini. Pilih tahun yang tersedia untuk menampilkan preview.`
                  : `Periode ${target} belum tersedia untuk indikator ini.`
              );
              setPreviewAvailableYears(years);
              setPreviewPeriodWasMissing(true);
              setPreviewParams(null);
              setPreviewPayload(null);
              setPreviewPayloadByYear(null);
              setPreviewActiveYear(null);
              setPreviewLink(null);
              setPreviewError(null);

              // Prefetch all available years in the background so tab clicks are instant.
              const typeNorm = String(parsed.type || 'dynamic').toLowerCase();
              const facets = typeNorm === 'exim' ? extractEximQueryFacets(q) : {};
              const yearsToFetch = years.slice();
              void (async () => {
                try {
                  const map: Record<string, DynamicResponse> = {};
                  let idx = 0;
                  const workerCount = Math.max(1, Math.min(4, yearsToFetch.length));

                  const fetchOne = async (y: string) => {
                    const monthsForYear = highlightMonthsForYearFromQuery(q, y);
                    const nextMonth = monthsForYear.length === 1 ? String(monthsForYear[0]) : "";
                    const nextParams = {
                      ...parsed,
                      period: y,
                      month: nextMonth,
                    };
                    const nextParamsWithFacets = {
                      ...nextParams,
                      pod: nextParams.pod || facets.pod || '',
                      ctr: nextParams.ctr || facets.ctr || '',
                      code_hs: nextParams.code_hs || facets.code_hs || '',
                    };

                    const url = `/api/data-preview?source_id=${encodeURIComponent(nextParamsWithFacets.source_id)}&period=${encodeURIComponent(y)}${nextParamsWithFacets.type ? `&type=${encodeURIComponent(nextParamsWithFacets.type)}` : ""}${nextMonth ? `&month=${encodeURIComponent(nextMonth)}` : ""}${nextParamsWithFacets.group ? `&group=${encodeURIComponent(nextParamsWithFacets.group)}` : ""}${nextParamsWithFacets.code_hs ? `&code_hs=${encodeURIComponent(nextParamsWithFacets.code_hs)}` : ""}${nextParamsWithFacets.pod ? `&pod=${encodeURIComponent(nextParamsWithFacets.pod)}` : ""}${nextParamsWithFacets.ctr ? `&ctr=${encodeURIComponent(nextParamsWithFacets.ctr)}` : ""}${nextParamsWithFacets.metric ? `&metric=${encodeURIComponent(nextParamsWithFacets.metric)}` : ""}`;
                    const res = await fetch(url, { cache: "no-store" });
                    const json = (await res.json()) as any;
                    if (!res.ok) return;
                    map[y] = json as DynamicResponse;
                  };

                  await Promise.all(
                    new Array(workerCount).fill(0).map(async () => {
                      // simple concurrency limiter
                      while (idx < yearsToFetch.length) {
                        const y = yearsToFetch[idx++];
                        if (!/^(19\d{2}|20\d{2}|2100)$/.test(String(y || '').trim())) continue;
                        await fetchOne(String(y || '').trim());
                      }
                    })
                  );

                  if (cancelled) return;
                  if (Object.keys(map).length > 0) {
                    setPreviewPayloadByYear(map);
                    setPreviewGeneratedAt(new Date().toISOString());
                  }
                } catch {
                  // best-effort
                }
              })();

              return;
            }
          }

          // If query includes multiple years (range), show tabs for only the relevant years.
          if (qYears.length > 1) {
            const relevant = years.filter((y: string) => qYears.includes(y));
            relevant.sort((a: string, b: string) => Number(b) - Number(a));
            if (relevant.length === 0) {
              setPreviewNeedsConfirmYear(true);
              setPreviewConfirmYearMessage(
                years.length > 0
                  ? `Periode yang diminta belum tersedia untuk indikator ini. Pilih tahun yang tersedia untuk menampilkan preview.`
                  : `Periode yang diminta belum tersedia untuk indikator ini.`
              );
              setPreviewAvailableYears(years);
              setPreviewPeriodWasMissing(true);
              setPreviewParams(null);
              setPreviewPayload(null);
              setPreviewPayloadByYear(null);
              setPreviewActiveYear(null);
              setPreviewLink(null);
              setPreviewError(null);
              return;
            }
            yearsForTabs = relevant;
            setPreviewAvailableYears(relevant);
            setPreviewPeriodWasMissing(true);
            effectivePeriod = pickYearFromQuery(relevant, q);
          } else if (originalMissingPeriod) {
            yearsForTabs = years;
            setPreviewAvailableYears(years);
            setPreviewPeriodWasMissing(true);
            effectivePeriod = pickYearFromQuery(years, q);
          } else if (shouldResolveToQueryYear) {
            // Single explicit year exists: align effective period to query.
            effectivePeriod = pickYearFromQuery(years, q);
            yearsForTabs = [];
            setPreviewAvailableYears([]);
          } else {
            yearsForTabs = [];
            setPreviewAvailableYears([]);
          }
        }

        if (!originalMissingPeriod && qYears.length <= 1) {
          // Default: keep tabs hidden unless it's the "no year" case or explicit multi-year query.
          setPreviewAvailableYears([]);
          setPreviewPeriodWasMissing(false);
        }

        if (!effectivePeriod) {
          setPreviewError("Periode belum tersedia untuk indikator ini.");
          return;
        }

        // Valid period; allow preview rendering.
        setPreviewNeedsConfirmYear(false);
        setPreviewConfirmYearMessage(null);

        // If query explicitly spans multiple years (range), prefetch all relevant years once
        // so switching year tabs does not refetch/reload chart + interpretation.
        const shouldPrefetchAllYearsWhenNoPeriod = originalMissingPeriod && qYears.length === 0 && yearsForTabs.length > 0;
        if ((qYears.length > 1 && yearsForTabs.length > 0) || shouldPrefetchAllYearsWhenNoPeriod) {
          const yearsToFetch = yearsForTabs.slice();
          const year0 = String(effectivePeriod || yearsToFetch[0] || "").trim();
          const activeYear = yearsToFetch.includes(year0) ? year0 : yearsToFetch[0];

          const typeNorm = String(parsed.type || 'dynamic').toLowerCase();
          const facets = typeNorm === 'exim' ? extractEximQueryFacets(q) : {};

          const results = await Promise.all(
            yearsToFetch.map(async (y) => {
              const monthsForYear = highlightMonthsForYearFromQuery(q, y);
              const nextMonth = monthsForYear.length === 1 ? String(monthsForYear[0]) : "";
              const nextParams = {
                ...parsed,
                period: y,
                month: nextMonth,
              };
              const nextParamsWithFacets = {
                ...nextParams,
                pod: nextParams.pod || facets.pod || '',
                ctr: nextParams.ctr || facets.ctr || '',
                code_hs: nextParams.code_hs || facets.code_hs || '',
              };

              const url = `/api/data-preview?source_id=${encodeURIComponent(nextParamsWithFacets.source_id)}&period=${encodeURIComponent(y)}${nextParamsWithFacets.type ? `&type=${encodeURIComponent(nextParamsWithFacets.type)}` : ""}${nextMonth ? `&month=${encodeURIComponent(nextMonth)}` : ""}${nextParamsWithFacets.group ? `&group=${encodeURIComponent(nextParamsWithFacets.group)}` : ""}${nextParamsWithFacets.code_hs ? `&code_hs=${encodeURIComponent(nextParamsWithFacets.code_hs)}` : ""}${nextParamsWithFacets.pod ? `&pod=${encodeURIComponent(nextParamsWithFacets.pod)}` : ""}${nextParamsWithFacets.ctr ? `&ctr=${encodeURIComponent(nextParamsWithFacets.ctr)}` : ""}${nextParamsWithFacets.metric ? `&metric=${encodeURIComponent(nextParamsWithFacets.metric)}` : ""}`;
              const res = await fetch(url, { cache: "no-store" });
              const json = (await res.json()) as any;
              if (!res.ok) return { year: y, ok: false as const, json };
              return { year: y, ok: true as const, json: json as DynamicResponse };
            })
          );

          const map: Record<string, DynamicResponse> = {};
          for (const r of results) {
            if (r.ok) map[r.year] = r.json;
          }

          if (Object.keys(map).length === 0) {
            setPreviewError("Gagal memuat data.");
            return;
          }

          setPreviewPayloadByYear(map);
          setPreviewActiveYear(activeYear);
          setPreviewPayload(map[activeYear] || Object.values(map)[0]);
          setPreviewGeneratedAt(new Date().toISOString());

          // Keep "Buka halaman data" consistent with the selected year.
          const sp = new URLSearchParams();
          sp.set("source_id", String(parsed.source_id));
          sp.set("period", activeYear);
          if (parsed.type) sp.set("type", String(parsed.type));
          setPreviewLink(`/data?${sp.toString()}`);

          // Ensure previewParams reflects the active year (for header text + month highlight),
          // but the chart/interpretation will use the multi-year combined rows.
          setPreviewParams({ ...parsed, period: activeYear });

          // Preview loaded, move to insights stage
          setPreviewLoading(false);
          setSearchProgress((prev) => {
            if (prev.stage === "preview") {
              return {
                ...prev,
                stage: "insights",
                message: "Menghasilkan analisis...",
                subMessage: "Memproses interpretasi dan grafik",
              };
            }
            return prev;
          });
          return;
        }

        // Update displayed preview period once resolved.
        const monthsForYear = highlightMonthsForYearFromQuery(q, effectivePeriod);
        const monthNoFromQuery = extractSingleQueryMonthNo(q);
        const shouldClearMonth = monthsForYear.length > 1;
        const shouldSetSingleMonthFromYear = monthsForYear.length === 1;
        const shouldFallbackSetMonth =
          monthsForYear.length === 0 &&
          monthNoFromQuery &&
          qYears.includes(String(effectivePeriod));
        const nextParams = {
          ...parsed,
          period: effectivePeriod,
          month: shouldClearMonth
            ? ''
            : shouldSetSingleMonthFromYear
              ? String(monthsForYear[0])
              : (shouldFallbackSetMonth ? monthNoFromQuery : ''),
        };

        const typeNorm = String(parsed.type || 'dynamic').toLowerCase();
        const facets = typeNorm === 'exim' ? extractEximQueryFacets(q) : {};
        const nextParamsWithFacets = {
          ...nextParams,
          pod: nextParams.pod || facets.pod || '',
          ctr: nextParams.ctr || facets.ctr || '',
          code_hs: nextParams.code_hs || facets.code_hs || '',
        };
        setPreviewParams(nextParamsWithFacets);

        // Build a deterministic /data link that matches the visible preview period.
        const sp = new URLSearchParams();
        sp.set("source_id", String(nextParamsWithFacets.source_id));
        if (nextParamsWithFacets.period) sp.set("period", String(nextParamsWithFacets.period));
        if (nextParamsWithFacets.type) sp.set("type", String(nextParamsWithFacets.type));
        if (nextParamsWithFacets.month) sp.set("month", String(nextParamsWithFacets.month));
        if (nextParamsWithFacets.geo) sp.set("geo", String(nextParamsWithFacets.geo));
        if (nextParamsWithFacets.q) sp.set("q", String(nextParamsWithFacets.q));
        if (nextParamsWithFacets.group) sp.set("group", String(nextParamsWithFacets.group));
        if (nextParamsWithFacets.code_hs) sp.set("code_hs", String(nextParamsWithFacets.code_hs));
        if (nextParamsWithFacets.pod) sp.set("pod", String(nextParamsWithFacets.pod));
        if (nextParamsWithFacets.ctr) sp.set("ctr", String(nextParamsWithFacets.ctr));
        if (nextParamsWithFacets.metric) sp.set("metric", String(nextParamsWithFacets.metric));
        setPreviewLink(`/data?${sp.toString()}`);

        const url = `/api/data-preview?source_id=${encodeURIComponent(nextParamsWithFacets.source_id)}&period=${encodeURIComponent(effectivePeriod)}${nextParamsWithFacets.type ? `&type=${encodeURIComponent(nextParamsWithFacets.type)}` : ""}${nextParamsWithFacets.month ? `&month=${encodeURIComponent(nextParamsWithFacets.month)}` : ""}${nextParamsWithFacets.group ? `&group=${encodeURIComponent(nextParamsWithFacets.group)}` : ""}${nextParamsWithFacets.code_hs ? `&code_hs=${encodeURIComponent(nextParamsWithFacets.code_hs)}` : ""}${nextParamsWithFacets.pod ? `&pod=${encodeURIComponent(nextParamsWithFacets.pod)}` : ""}${nextParamsWithFacets.ctr ? `&ctr=${encodeURIComponent(nextParamsWithFacets.ctr)}` : ""}${nextParamsWithFacets.metric ? `&metric=${encodeURIComponent(nextParamsWithFacets.metric)}` : ""}`;
        const res = await fetch(url, { cache: "no-store" });
        const json = (await res.json()) as any;
        if (cancelled) return;
        if (!res.ok) {
          const code = typeof json?.code === 'string' ? json.code : '';
          const msg = formatPreviewFetchErrorMessage(code, String(nextParamsWithFacets.type || 'dynamic'));
          if (msg) setPreviewError(msg);
          else setPreviewError(typeof json?.message === "string" ? json.message : "Gagal memuat data.");
          return;
        }
        setPreviewPayload(json as DynamicResponse);
        setPreviewGeneratedAt(new Date().toISOString());
      } catch {
        if (cancelled) return;
        setPreviewError("Gagal memuat data.");
      } finally {
        if (!cancelled) {
          setPreviewLoading(false);
          // Move to insights stage after preview data is loaded
          setSearchProgress((prev) => {
            if (prev.stage === "preview") {
              return {
                ...prev,
                stage: "insights",
                message: "Menghasilkan analisis...",
                subMessage: "Memproses interpretasi dan grafik",
              };
            }
            return prev;
          });
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [data, loading]);

  const onPreviewYearClick = async (year: string) => {
    const y = String(year || "").trim();
    if (!/^(19\d{2}|20\d{2}|2100)$/.test(y)) return;
    const baseParams = previewParams || previewPendingParams;
    if (!baseParams) return;

    setPreviewNeedsConfirmYear(false);
    setPreviewConfirmYearMessage(null);

    // Multi-year mode: switch locally without refetch.
    if (previewPayloadByYear && previewPayloadByYear[y]) {
      const monthsForYear = highlightMonthsForYearFromQuery(q, y);
      const nextMonth = monthsForYear.length === 1 ? String(monthsForYear[0]) : "";
      setPreviewActiveYear(y);
      setPreviewPayload(previewPayloadByYear[y]);
      setPreviewGeneratedAt(new Date().toISOString());
      setPreviewParams({ ...(baseParams as any), period: y, month: nextMonth });
      setDownloadOpen(false);

      const sp = new URLSearchParams();
      sp.set("source_id", String(baseParams.source_id));
      sp.set("period", y);
      if (baseParams.type) sp.set("type", String(baseParams.type));
      if (nextMonth) sp.set("month", nextMonth);
      if ((baseParams as any).geo) sp.set("geo", String((baseParams as any).geo));
      if ((baseParams as any).q) sp.set("q", String((baseParams as any).q));
      if ((baseParams as any).group) sp.set("group", String((baseParams as any).group));
      if ((baseParams as any).code_hs) sp.set("code_hs", String((baseParams as any).code_hs));
      if ((baseParams as any).pod) sp.set("pod", String((baseParams as any).pod));
      if ((baseParams as any).ctr) sp.set("ctr", String((baseParams as any).ctr));
      if ((baseParams as any).metric) sp.set("metric", String((baseParams as any).metric));
      setPreviewLink(`/data?${sp.toString()}`);
      return;
    }

    setPreviewError(null);
    setPreviewLoading(true);
    const monthsForYear = highlightMonthsForYearFromQuery(q, y);
    const nextMonth = monthsForYear.length === 1 ? String(monthsForYear[0]) : "";
    setPreviewParams({ ...(baseParams as any), period: y, month: nextMonth });

    // Keep "Buka halaman data" consistent with the selected year.
    const sp = new URLSearchParams();
    sp.set("source_id", String(baseParams.source_id));
    sp.set("period", y);
    if (baseParams.type) sp.set("type", String(baseParams.type));
    if (nextMonth) sp.set("month", nextMonth);
    if ((baseParams as any).geo) sp.set("geo", String((baseParams as any).geo));
    if ((baseParams as any).q) sp.set("q", String((baseParams as any).q));
    if ((baseParams as any).group) sp.set("group", String((baseParams as any).group));
    if ((baseParams as any).code_hs) sp.set("code_hs", String((baseParams as any).code_hs));
    if ((baseParams as any).pod) sp.set("pod", String((baseParams as any).pod));
    if ((baseParams as any).ctr) sp.set("ctr", String((baseParams as any).ctr));
    if ((baseParams as any).metric) sp.set("metric", String((baseParams as any).metric));
    setPreviewLink(`/data?${sp.toString()}`);

    try {
      const url = `/api/data-preview?source_id=${encodeURIComponent(baseParams.source_id)}&period=${encodeURIComponent(y)}${baseParams.type ? `&type=${encodeURIComponent(baseParams.type)}` : ""}${nextMonth ? `&month=${encodeURIComponent(nextMonth)}` : ""}${(baseParams as any).group ? `&group=${encodeURIComponent((baseParams as any).group)}` : ""}${(baseParams as any).code_hs ? `&code_hs=${encodeURIComponent((baseParams as any).code_hs)}` : ""}${(baseParams as any).pod ? `&pod=${encodeURIComponent((baseParams as any).pod)}` : ""}${(baseParams as any).ctr ? `&ctr=${encodeURIComponent((baseParams as any).ctr)}` : ""}${(baseParams as any).metric ? `&metric=${encodeURIComponent((baseParams as any).metric)}` : ""}`;
      const res = await fetch(url, { cache: "no-store" });
      const json = (await res.json()) as any;
      if (!res.ok) {
        const code = typeof json?.code === 'string' ? json.code : '';
        const msg = formatPreviewFetchErrorMessage(code, String(baseParams.type || 'dynamic'));
        if (msg) setPreviewError(msg);
        else setPreviewError(typeof json?.message === "string" ? json.message : "Gagal memuat data.");
        return;
      }
      setPreviewPayload(json as DynamicResponse);
      setPreviewGeneratedAt(new Date().toISOString());
    } catch {
      setPreviewError("Gagal memuat data.");
    } finally {
      setPreviewLoading(false);
    }
  };

  useEffect(() => {
    if (!previewPayloadByYear) return;

    const baseParams = previewParams || previewPendingParams;
    if (!baseParams) return;

    const years = Object.keys(previewPayloadByYear)
      .map((y) => String(y || '').trim())
      .filter((y) => /^(19\d{2}|20\d{2}|2100)$/.test(y));
    if (years.length === 0) return;

    const previewSource = String(previewPayload?.data?.source || previewIndicator || '').trim();
    const previewType = String(baseParams.type || 'dynamic').trim().toLowerCase();

    const buildDatasetKey = (d: any) => {
      const periods = Array.isArray(d?.periods)
        ? d.periods
            .map((p: any) => String(p || '').trim())
            .filter(Boolean)
            .sort((a: string, b: string) => {
              const na = Number(a);
              const nb = Number(b);
              if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
              return a.localeCompare(b);
            })
        : [];
      const period = periods.length > 0 ? '' : String(d?.period || '').trim();
      return JSON.stringify({
        source_id: String(d?.source_id ?? '').trim(),
        type: String(d?.type || '').trim().toLowerCase(),
        period,
        periods,
        month: d?.month ?? null,
        geo: String(d?.geo || '').trim().toLowerCase(),
        group: String(d?.group || '').trim().toLowerCase(),
        code_hs: String(d?.code_hs || '').trim().toLowerCase(),
        pod: String(d?.pod || '').trim().toLowerCase(),
        ctr: String(d?.ctr || '').trim().toLowerCase(),
        metric: String(d?.metric || '').trim().toLowerCase(),
      });
    };

    const buildRequestKey = (qq: string, datasetKey: string) => {
      return JSON.stringify({
        q: String(qq || '').trim(),
        datasetKey,
        source: String(previewSource || '').trim(),
        type: String(previewType || '').trim().toLowerCase(),
      });
    };

    let cancelled = false;

    const prefetch = async () => {
      let idx = 0;
      const workerCount = Math.max(1, Math.min(3, years.length));

      const fetchOne = async (y: string) => {
        const monthsForYear = highlightMonthsForYearFromQuery(q, y);
        const month = monthsForYear.length === 1 ? String(monthsForYear[0]) : null;

        const dataset = {
          source_id: baseParams.source_id,
          type: String(baseParams.type || 'dynamic'),
          periods: undefined,
          period: y,
          month,
          geo: baseParams.geo ? String(baseParams.geo) : undefined,
          group: (baseParams as any).group,
          code_hs: (baseParams as any).code_hs,
          pod: (baseParams as any).pod,
          ctr: (baseParams as any).ctr,
          metric: (baseParams as any).metric,
        };

        const datasetKey = buildDatasetKey(dataset);
        const requestKey = buildRequestKey(q, datasetKey);
        if (insightsCacheRef.current.has(requestKey)) return;

        const body = {
          q,
          dataset,
          preview: {
            source: previewSource,
            period: y,
            last_update: null,
            type: String(baseParams.type || 'dynamic'),
            geo: baseParams.geo ? String(baseParams.geo) : undefined,
            month: month ? Number(month) : null,
            columns: [],
            sampleRows: [],
          },
        };

        const res = await fetch('/api/insights', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = (await res.json()) as InsightResponse;
        if (cancelled) return;
        insightsCacheRef.current.set(requestKey, json);
      };

      await Promise.all(
        new Array(workerCount).fill(0).map(async () => {
          while (idx < years.length) {
            const y = years[idx++];
            try {
              await fetchOne(y);
            } catch {
              // best-effort
            }
          }
        })
      );
    };

    void prefetch();
    return () => {
      cancelled = true;
    };
  }, [previewPayloadByYear, previewParams, previewPendingParams, previewPayload, previewIndicator, q]);

  const exactDs = Array.isArray(data?.exact?.datasources) ? data!.exact!.datasources! : [];
  const exactPub = Array.isArray(data?.exact?.publications) ? data!.exact!.publications! : [];
  const exactBrs = Array.isArray(data?.exact?.brs) ? data!.exact!.brs! : [];

  const sugDs = Array.isArray(data?.suggestions?.datasources) ? data!.suggestions!.datasources! : [];
  const sugPub = Array.isArray(data?.suggestions?.publications) ? data!.suggestions!.publications! : [];
  const sugBrs = Array.isArray(data?.suggestions?.brs) ? data!.suggestions!.brs! : [];

  const hasAny =
    exactDs.length + exactPub.length + exactBrs.length + sugDs.length + sugPub.length + sugBrs.length > 0;
  const hasExact = exactDs.length + exactPub.length + exactBrs.length > 0;

  const mixed: MixedHit[] = useMemo(() => {
    const list: MixedHit[] = [];

    // Keep earlier relevance: exact first, then suggestions; within each keep type groups.
    for (const it of exactDs) list.push({ ...it, kind: "datasource" });
    for (const it of exactPub) list.push({ ...it, kind: "publication" });
    for (const it of exactBrs) list.push({ ...it, kind: "brs" });
    for (const it of sugDs) list.push({ ...it, kind: "datasource" });
    for (const it of sugPub) list.push({ ...it, kind: "publication" });
    for (const it of sugBrs) list.push({ ...it, kind: "brs" });

    // Remove duplicates by (kind,id)
    const seen = new Set<string>();
    const deduped = list.filter((x) => {
      const key = `${x.kind}:${String(x.id)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Order by relevance (left-to-right): highest score first.
    return deduped.sort((a, b) => (Number(b.score || 0) - Number(a.score || 0)));
  }, [exactDs, exactPub, exactBrs, sugDs, sugPub, sugBrs]);

  const yearOptions = useMemo(() => {
    const years = new Set<string>();
    for (const it of mixed) {
      const textYears = extractYearsFromText(`${it.title} ${it.subtitle || ""}`);
      textYears.forEach((y) => years.add(y));
      const linkYear = extractYearFromLink(String(it.link || ""));
      if (linkYear) years.add(linkYear);
    }
    return Array.from(years).sort((a, b) => Number(a) - Number(b));
  }, [mixed]);

  const filteredMixed = useMemo(() => {
    return mixed.filter((it) => {
      if (!activeKinds.includes(it.kind)) return false;

      if (regionFilter && regionFilter !== "all") {
        const region = normalizeRegion(regionFilter);
        const hay = `${it.title} ${it.subtitle || ""}`.toLowerCase();
        if (!hay.includes(String(region).toLowerCase())) return false;
      }

      if (yearStart || yearEnd) {
        const years = new Set<string>();
        extractYearsFromText(`${it.title} ${it.subtitle || ""}`).forEach((y) => years.add(y));
        const linkYear = extractYearFromLink(String(it.link || ""));
        if (linkYear) years.add(linkYear);

        if (years.size === 0) return false;

        const start = yearStart ? Number(yearStart) : Number.MIN_SAFE_INTEGER;
        const end = yearEnd ? Number(yearEnd) : Number.MAX_SAFE_INTEGER;
        const within = Array.from(years).some((y) => {
          const n = Number(y);
          return Number.isFinite(n) && n >= start && n <= end;
        });
        if (!within) return false;
      }

      return true;
    });
  }, [activeKinds, mixed, regionFilter, yearStart, yearEnd]);

  const groupedResults = useMemo(() => {
    return {
      datasource: filteredMixed.filter((it) => it.kind === "datasource"),
      publication: filteredMixed.filter((it) => it.kind === "publication"),
      brs: filteredMixed.filter((it) => it.kind === "brs"),
    };
  }, [filteredMixed]);

  const didYouMeanItems = useMemo(() => {
    if (hasExact) return [] as MixedHit[];
    const list: MixedHit[] = [];
    for (const it of sugDs) list.push({ ...it, kind: "datasource" });
    for (const it of sugPub) list.push({ ...it, kind: "publication" });
    for (const it of sugBrs) list.push({ ...it, kind: "brs" });
    return list.slice(0, 6);
  }, [hasExact, sugDs, sugPub, sugBrs]);

  useEffect(() => {
    setVisibleCount(6);
  }, [q, activeKinds, regionFilter, yearStart, yearEnd]);

  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((v) => v + 6);
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [sentinelRef, filteredMixed]);

  const previewData = previewPayload?.data;
  const previewColumns = Array.isArray(previewData?.columns) ? previewData!.columns! : [];
  const previewRowsRaw = Array.isArray(previewData?.data) ? previewData!.data! : [];
  const previewYearStr = String(previewParams?.period || "").trim();
  const previewHighlightMonths = previewParams ? highlightMonthsForYearFromQuery(q, previewYearStr) : [];
    const eximMode = detectEximModeFromQuery(q);
  const previewFallbackMonthNo = Number(previewParams?.month || "");
  const previewFallbackMonths =
    Number.isFinite(previewFallbackMonthNo) && previewFallbackMonthNo >= 1 && previewFallbackMonthNo <= 12
      ? [previewFallbackMonthNo]
      : [];
  const previewMonthsToHighlight = previewHighlightMonths.length > 0 ? previewHighlightMonths : previewFallbackMonths;
  const previewPrimaryMonth = previewMonthsToHighlight.length === 1 ? previewMonthsToHighlight[0] : null;

  const previewGeneratedAtLabel = useMemo(() => {
    if (!previewGeneratedAt) return "-";
    try {
      return new Date(previewGeneratedAt).toLocaleString("id-ID", {
        day: "2-digit",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return previewGeneratedAt;
    }
  }, [previewGeneratedAt]);

  const previewGeo = previewParams?.geo ? String(previewParams.geo) : "";
  const previewGeoNorm = normGeo(previewGeo);
  // Always try to detect the wilayah/name column so ordering can work even when `geo` is not set.
  const previewGeoKeyCol = findGeoColumn(previewColumns);
  const previewWilayahCodeCol = findWilayahCodeColumn(previewColumns);
  let previewGeoApplied = false;
  let previewRowsGeo = previewRowsRaw;
  if (previewGeoNorm && previewGeoKeyCol) {
    const filtered = previewRowsRaw.filter((r) => matchesGeoCell((r as any)?.[previewGeoKeyCol], previewGeoNorm));
    if (
      shouldApplyGeoFilter({
        geoNorm: previewGeoNorm,
        filteredLen: filtered.length,
        totalLen: previewRowsRaw.length,
        title: String(previewData?.source || previewIndicator || ''),
        columns: previewColumns,
      })
    ) {
      previewRowsGeo = filtered;
      previewGeoApplied = true;
    }
  }

  const previewQ = String(previewParams?.q || q || "").trim();
  const previewType = String(previewParams?.type || "dynamic").toLowerCase();
  const previewColumnsShown =
    previewType === 'exim'
      ? filterEximColumnsForQuery(previewColumns, previewQ, previewParams)
      : previewColumns;
  const previewVisibleColumns = previewColumnsShown.filter((c) => !previewHiddenColumns.includes(c));
  useEffect(() => {
    setPreviewHiddenColumns((prev) => prev.filter((c) => previewColumnsShown.includes(c)));
    setPreviewColumnWidths((prev) => {
      const next: Record<string, number> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (previewColumnsShown.includes(k)) next[k] = v;
      }
      return next;
    });
  }, [previewColumnsShown.join("|")]);
  const previewTerms = previewType === "exim" ? [] : extractQueryTerms(previewQ);
  const previewRowsByTerms = previewTerms.length > 0
    ? previewRowsGeo.filter((r) => rowMatchesTerms(r as any, previewTerms, previewColumns))
    : previewRowsGeo;
  // Guardrail: if strict term matching removes everything, show the table anyway.
  let previewRows = previewTerms.length > 0 && previewRowsByTerms.length === 0 ? previewRowsGeo : previewRowsByTerms;
  const previewMonthKeyCol =
    previewColumnsShown.find((c) => /^(bulan|month)$/i.test(String(c).trim())) ||
    previewColumnsShown.find((c) => /(bulan|month)/i.test(String(c).trim())) ||
    previewColumnsShown[0];

  // EXIM-only: if user query specifies a month/range, show only those months for the selected year
  // to avoid dumping the whole year's rows (can be very large in group-by-komoditas mode).
  if (previewType === 'exim' && previewMonthsToHighlight.length > 0 && previewMonthKeyCol) {
    previewRows = previewRows.filter((r) =>
      previewMonthsToHighlight.some((m) => matchesMonthCell((r as any)?.[previewMonthKeyCol], m))
    );
  }

  // Kab/Kota production ordering (Maluku Utara): deterministic row order by BPS wilayah code.
  previewRows = applyMalutWilayahDefaultOrder({
    rows: previewRows,
    geoKeyCol: previewGeoKeyCol,
    wilayahCodeCol: previewWilayahCodeCol,
    title: String(previewData?.source || previewIndicator || ''),
    columns: previewColumns,
  });

  // PDRB/Growth table special ordering: move aggregate/total row ("PRODUK DOMESTIK REGIONAL BRUTO") to bottom.
  previewRows = (() => {
    const isPdrbLikeTable = /\bpdrb\b|\bproduk\s*domestik\s*regional\s*bruto\b/i.test(
      String(previewData?.source || previewIndicator || '')
    );
    if (!isPdrbLikeTable) return previewRows;

    const labelCol = previewColumnsShown[0];
    if (!labelCol) return previewRows;

    const aggregateRows: typeof previewRows = [];
    const regularRows: typeof previewRows = [];

    for (const r of previewRows) {
      const label = String((r as any)?.[labelCol] || '').trim();
      if (/^PRODUK\s*DOMESTIK\s*REGIONAL\s*BRUTO$/i.test(label)) {
        aggregateRows.push(r);
      } else {
        regularRows.push(r);
      }
    }

    return [...regularRows, ...aggregateRows];
  })();

  // Normalize data if there's a scale mismatch (e.g., 1282937 vs 1337.2 when unit is "ribu jiwa")
  const previewUnitFromTitle = previewUnit || extractUnitFromTitle(String(previewData?.source || previewIndicator || ''));
  const normalizationResult = normalizeTableData(previewRows, previewUnitFromTitle);
  if (normalizationResult.normalized) {
    previewRows = normalizationResult.rows as any[];
    console.log('[Normalization] Applied:', normalizationResult.details);
  }

  // Build multi-year rows for chart + interpretation (stable across year-tab clicks).
  const qYearsForInsights = extractQueryYearsExpanded(q)
    .map((y) => String(y || '').trim())
    .filter((y) => /^(19\d{2}|20\d{2}|2100)$/.test(y));

  const previewRowsAllRaw = previewPayloadByYear
    ? Object.entries(previewPayloadByYear).flatMap(([yy, payload]) => {
        const dd = (payload as any)?.data;
        const rows = Array.isArray(dd?.data) ? dd.data : [];
        return rows.map((r: any) => ({ ...r, __preview_year: yy }));
      })
    : previewRowsRaw.map((r: any) => {
        const yy = String(previewParams?.period || '').trim();
        if (/^(19\d{2}|20\d{2}|2100)$/.test(yy)) return { ...r, __preview_year: yy };
        return r;
      });

  let previewRowsAllGeo = previewRowsAllRaw;
  if (previewGeoNorm && previewGeoKeyCol) {
    const filtered = previewRowsAllRaw.filter((r) => matchesGeoCell((r as any)?.[previewGeoKeyCol], previewGeoNorm));
    if (
      shouldApplyGeoFilter({
        geoNorm: previewGeoNorm,
        filteredLen: filtered.length,
        totalLen: previewRowsAllRaw.length,
        title: String(previewData?.source || previewIndicator || ''),
        columns: previewColumns,
      })
    ) {
      previewRowsAllGeo = filtered;
    }
  }

  const previewRowsAllByTerms = previewTerms.length > 0
    ? previewRowsAllGeo.filter((r) => rowMatchesTerms(r as any, previewTerms, previewColumns))
    : previewRowsAllGeo;

  let previewRowsForInsights = previewTerms.length > 0 && previewRowsAllByTerms.length === 0
    ? previewRowsAllGeo
    : previewRowsAllByTerms;

  const availableYearsForInsights = previewPayloadByYear
    ? Object.keys(previewPayloadByYear)
        .map((y) => String(y || '').trim())
        .filter((y) => /^(19\d{2}|20\d{2}|2100)$/.test(y))
    : [String(previewParams?.period || '').trim()].filter((y) => /^(19\d{2}|20\d{2}|2100)$/.test(y));

  const requestedYearsAvailableForInsights = qYearsForInsights.filter((y) => availableYearsForInsights.includes(y));

  // CHANGED: Only filter to active year tab if user explicitly specified year(s) in query
  // but those years are not available. If no year in query, show ALL available years.
  const effectiveInsightsYear =
    previewPayloadByYear &&
    previewActiveYear &&
    /^(19\d{2}|20\d{2}|2100)$/.test(String(previewActiveYear).trim()) &&
    qYearsForInsights.length > 0 && // User DID specify year(s) in query
    requestedYearsAvailableForInsights.length === 0 // But none are available
      ? String(previewActiveYear).trim()
      : null;

  if (effectiveInsightsYear) {
    previewRowsForInsights = previewRowsForInsights.filter((r: any) => String(r?.__preview_year || '').trim() === effectiveInsightsYear);
  }

  // If query specifies month(s), filter rows to only those months
  // so chart + interpretation don't drift outside the intended period.
  // When the requested year is unavailable (effectiveInsightsYear is used), do not filter by query-year.
  if (!effectiveInsightsYear && qYearsForInsights.length >= 1 && previewMonthKeyCol) {
    previewRowsForInsights = previewRowsForInsights.filter((r: any) => {
      const yy = String(r?.__preview_year || '').trim();
      if (!yy) return false;
      // If query includes explicit year(s), keep only those.
      if (qYearsForInsights.length > 0 && !qYearsForInsights.includes(yy)) return false;
      const allowedMonths = highlightMonthsForYearFromQuery(q, yy);
      if (allowedMonths.length === 0) return true;
      return allowedMonths.some((m) => matchesMonthCell(r?.[previewMonthKeyCol], m));
    });
  }

  // Normalize previewRowsForInsights for consistent data in interpretation
  const insightsNormalization = normalizeTableData(previewRowsForInsights, previewUnitFromTitle);
  if (insightsNormalization.normalized) {
    previewRowsForInsights = insightsNormalization.rows as any[];
  }

  const previewMissingPeriodNote = useMemo(() => {
    if (!previewParams) return null;
    if (previewLoading || previewError) return null;

    const requestedYears = extractQueryYearsExpanded(q)
      .map((y) => String(y || '').trim())
      .filter((y) => /^(19\d{2}|20\d{2}|2100)$/.test(y));
    const uniqYears = Array.from(new Set(requestedYears));
    uniqYears.sort((a, b) => Number(a) - Number(b));

    const availableYearsInPayload = previewPayloadByYear
      ? Object.keys(previewPayloadByYear).map((y) => String(y || '').trim()).filter((y) => /^(19\d{2}|20\d{2}|2100)$/.test(y))
      : [String(previewParams.period || '').trim()].filter((y) => /^(19\d{2}|20\d{2}|2100)$/.test(y));

    const parts: string[] = [];

    if (uniqYears.length > 1) {
      const missingYears = uniqYears.filter((y) => !availableYearsInPayload.includes(y));
      if (missingYears.length > 0) {
        parts.push(`Periode belum tersedia: ${missingYears.join(", ")}`);
      }
    }

    // Month-level missing detection within requested range
    if (previewMonthKeyCol) {
      // Only compute missing months for years that we actually have rows for.
      const yearsToCheck = (uniqYears.length > 0 ? uniqYears : [String(previewParams.period || '').trim()]).filter((y) =>
        availableYearsInPayload.includes(String(y || '').trim())
      );
      const missingMonthLabels: string[] = [];

      for (const yy of yearsToCheck) {
        if (!/^(19\d{2}|20\d{2}|2100)$/.test(yy)) continue;
        const requestedMonths = highlightMonthsForYearFromQuery(q, yy);
        if (requestedMonths.length === 0) continue;

        const presentMonths = new Set<number>();
        for (const r of previewRowsAllGeo) {
          const ry = String((r as any)?.__preview_year || '').trim();
          if (ry !== yy) continue;
          const m = extractMonthNo((r as any)?.[previewMonthKeyCol]);
          if (m) presentMonths.add(m);
        }

        const missing = requestedMonths.filter((m) => !presentMonths.has(m));
        for (const m of missing) {
          const label = monthNameFromNo(m);
          if (label) missingMonthLabels.push(`${label} ${yy}`);
        }
      }

      if (missingMonthLabels.length > 0) {
        const show = missingMonthLabels.slice(0, 8);
        const more = missingMonthLabels.length - show.length;
        parts.push(`Bulan belum tersedia: ${show.join(", ")}${more > 0 ? ` (+${more} lainnya)` : ""}`);
      }
    }

    if (parts.length === 0) return null;
    return `Catatan: ${parts.join(" • ")}. Menampilkan data yang tersedia sesuai rentang yang diminta.`;
  }, [previewParams, previewLoading, previewError, q, previewPayloadByYear, previewMonthKeyCol, previewRowsAllGeo]);

  const previewNumericColumns = useMemo(() => {
    // Determine numeric-ish columns so we can format + right-align consistently.
    // Keep it conservative to avoid formatting IDs/codes/labels.
    const cols = Array.isArray(previewColumnsShown) ? previewColumnsShown : [];
    const rows = Array.isArray(previewRows) ? previewRows : [];

    const isAxisCol = (c: string) => /^(bulan|month|tahun|year|periode|period|tanggal|date)$/i.test(String(c).trim());
    const looksLikeCode = (c: string) => /(kode|code|id|no\b|nomor|rank)/i.test(String(c));
    const looksLikeLabel = (c: string) => /(kategori|lapangan.*usaha|nama|wilayah|daerah|label)/i.test(String(c));

    const out = new Set<string>();
    for (const c of cols) {
      if (!c) continue;
      if (isAxisCol(c)) continue;
      if (looksLikeCode(c)) continue;
      if (looksLikeLabel(c)) continue;
      // IMPORTANT: Never treat the first column as numeric (it's typically a label/category).
      if (c === cols[0]) continue;

      let seen = 0;
      let numeric = 0;
      for (const r of rows.slice(0, 80)) {
        const v = (r as any)?.[c];
        if (v === null || v === undefined || String(v).trim() === "") continue;
        seen++;
        if (formatNumberId(v) !== null) numeric++;
      }
      // Require at least 80% of non-empty values to be numeric to avoid false positives.
      if (seen > 0 && numeric / seen >= 0.8) out.add(c);
    }
    return out;
  }, [previewColumnsShown, previewRows]);

  const canDownloadQuick = !previewLoading && !previewError && previewColumnsShown.length > 0 && previewRows.length > 0;

  const startPreviewResize = (column: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const th = (e.currentTarget as HTMLElement).parentElement as HTMLElement | null;
    const startWidth = previewColumnWidths[column] || th?.getBoundingClientRect().width || 120;

    const onMove = (evt: MouseEvent) => {
      const nextWidth = Math.max(80, Math.min(520, startWidth + (evt.clientX - startX)));
      setPreviewColumnWidths((prev) => ({ ...prev, [column]: nextWidth }));
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handlePrintPreview = () => {
    if (previewVisibleColumns.length === 0 || previewRows.length === 0) return;
    const typeNorm = String(previewParams?.type || "dynamic").toLowerCase();
    const isExim = typeNorm === "exim";

    const header = previewVisibleColumns.map((c) => (isExim ? eximColumnLabel(c, eximMode) : c));
    const rows = previewRows.map((r: any) =>
      previewVisibleColumns.map((c) => {
        if (isExim) return eximCellValue(c, r?.[c]);
        const v = r?.[c];
        if (v === null || v === undefined || String(v).trim() === "") return "-";
        if (previewNumericColumns.has(c)) return formatNumberId(v) ?? String(v);
        return String(v);
      })
    );

    const title = String(previewData?.source || previewIndicator || "Data Statistik").trim();
    const period = String(previewData?.period || previewParams?.period || "").trim();
    const win = window.open("", "print-preview");
    if (!win) return;
    win.document.write(`<!doctype html><html><head><title>${title}</title>`);
    win.document.write(`
      <style>
        body { font-family: Arial, sans-serif; padding: 24px; color: #111827; }
        h1 { font-size: 16px; margin-bottom: 4px; }
        .meta { font-size: 12px; color: #6b7280; margin-bottom: 12px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th, td { border: 1px solid #e5e7eb; padding: 6px 8px; text-align: left; }
        th { background: #f9fafb; font-weight: 600; }
      </style>
    `);
    win.document.write(`</head><body>`);
    win.document.write(`<h1>${title}</h1>`);
    win.document.write(`<div class="meta">Periode: ${period || "-"}</div>`);
    win.document.write(`<table><thead><tr>${header.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>`);
    rows.forEach((row) => {
      win.document.write(`<tr>${row.map((cell) => `<td>${String(cell)}</td>`).join("")}</tr>`);
    });
    win.document.write(`</tbody></table></body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  const downloadQuick = async (format: "excel" | "csv" | "pdf" | "json") => {
    if (!canDownloadQuick) return;

    const typeNorm = String(previewParams?.type || "dynamic").toLowerCase();
    const isExim = typeNorm === "exim";
    const headers = previewColumnsShown.map((c) => (isExim ? eximColumnLabel(c, eximMode) : c));

    const toCellDisplay = (c: string, row: any) => {
      const v = row?.[c];
      if (isExim) return eximCellValue(c, v);
      if (v === null || v === undefined || String(v).trim() === "") return "-";
      if (previewNumericColumns.has(c)) return formatNumberId(v) ?? String(v);
      return String(v);
    };

    const rows = previewRows.map((r: any) => previewColumnsShown.map((c) => toCellDisplay(c, r)));

    const indicatorLabel = String(previewData?.source || previewIndicator || "-").trim() || "-";
    const periodLabel = (() => {
      const base = String(previewData?.period || previewParams?.period || "-").trim() || "-";
      if (previewPeriodWasMissing && Array.isArray(previewAvailableYears) && previewAvailableYears.length > 0) {
        const sorted = previewAvailableYears
          .slice()
          .map((y) => String(y || "").trim())
          .filter((y) => /^(19\d{2}|20\d{2}|2100)$/.test(y))
          .sort((a, b) => Number(a) - Number(b));
        const y0 = sorted[0];
        const y1 = sorted[sorted.length - 1];
        if (y0 && y1 && y0 !== y1) return `${y0} - ${y1}`;
        if (y0) return y0;
      }
      return base;
    })();
    const lastUpdateLabel = String(previewData?.last_update || "").trim();
    const monthLabel = typeof previewPrimaryMonth === "number" ? monthNameFromNo(previewPrimaryMonth) : null;
    const geoLabel = previewGeoApplied ? String(previewGeo || "").trim() : "";
    const headerLineParts: string[] = [];
    headerLineParts.push(`Indikator: ${indicatorLabel}`);
    headerLineParts.push(`Periode: ${periodLabel}`);
    if (geoLabel) headerLineParts.push(`Kab/Kota: ${geoLabel}`);
    if (monthLabel) headerLineParts.push(`Bulan: ${monthLabel}`);
    if (lastUpdateLabel) headerLineParts.push(`Update: ${lastUpdateLabel}`);
    const headerLine = headerLineParts.join(" • ");

    const footerLine = `Sumber: ${indicatorLabel} • Dihasilkan: ${previewGeneratedAtLabel}`;

    const baseName = (() => {
      const sourceName = String(previewData?.source || previewIndicator || "data").trim() || "data";
      const periodName = String(previewData?.period || previewParams?.period || "").trim();
      const safe = (s: string) => s.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 80);
      return safe(`${sourceName}${periodName ? "_" + periodName : ""}`) || "data";
    })();

    const triggerBlobDownload = (blob: Blob, filename: string) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    };

    const escapeCsv = (s: string) => {
      const needs = /[\r\n",]/.test(s);
      const out = s.replace(/"/g, '""');
      return needs ? `"${out}"` : out;
    };

    const toNumberLoose = (v: unknown): number | null => {
      if (v === null || v === undefined) return null;
      if (typeof v === "number" && Number.isFinite(v)) return v;
      const s = String(v).trim();
      if (!s) return null;
      let cleaned = s.replace(/[^0-9,\.\-+]/g, "");
      if (!cleaned) return null;
      const hasComma = cleaned.includes(",");
      const hasDot = cleaned.includes(".");

      const normalizeSingleDecimalDot = (input: string) => {
        const idx = input.lastIndexOf(".");
        if (idx <= 0) return input;
        const head = input.slice(0, idx).replace(/\./g, "");
        const tail = input.slice(idx);
        return head + tail;
      };

      if (hasComma && hasDot) {
        const lastComma = cleaned.lastIndexOf(",");
        const lastDot = cleaned.lastIndexOf(".");
        const decimalSep = lastComma > lastDot ? "," : ".";
        const thousandSep = decimalSep === "," ? "." : ",";
        cleaned = cleaned.split(thousandSep).join("");
        if (decimalSep === ",") cleaned = cleaned.replace(/,/g, ".");
        cleaned = normalizeSingleDecimalDot(cleaned);
      } else if (hasComma) {
        const last = cleaned.lastIndexOf(",");
        const frac = cleaned.slice(last + 1);
        if (frac.length >= 1 && frac.length <= 2) {
          cleaned = cleaned.replace(/\./g, "").replace(/,/g, ".");
          cleaned = normalizeSingleDecimalDot(cleaned);
        } else {
          cleaned = cleaned.replace(/,/g, "");
        }
      } else if (hasDot) {
        const last = cleaned.lastIndexOf(".");
        const frac = cleaned.slice(last + 1);
        if (frac.length >= 1 && frac.length <= 2) {
          cleaned = cleaned.replace(/,/g, "");
          cleaned = normalizeSingleDecimalDot(cleaned);
        } else {
          cleaned = cleaned.replace(/\./g, "");
        }
      }

      const n = Number(cleaned);
      if (!Number.isFinite(n)) return null;
      return n;
    };

    try {
      if (format === "json") {
        const data = previewRows.map((r: any) => {
          const obj: Record<string, string> = {};
          previewColumnsShown.forEach((c, idx) => {
            obj[headers[idx]] = toCellDisplay(c, r);
          });
          return obj;
        });
        const payload = {
          header_line: headerLine,
          footer_line: footerLine,
          source: String(previewData?.source || previewIndicator || "").trim() || null,
          period: String(previewData?.period || previewParams?.period || "").trim() || null,
          last_update: String(previewData?.last_update || "").trim() || null,
          generated_at: previewGeneratedAt || null,
          columns: headers,
          data,
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
        triggerBlobDownload(blob, `${baseName}.json`);
      } else if (format === "csv") {
        const metaRow = (text: string) => {
          const row = new Array(headers.length).fill("");
          row[0] = text;
          return row;
        };
        const csvRows = [metaRow(headerLine), metaRow(""), headers, ...rows, metaRow(""), metaRow(footerLine)];
        const lines = csvRows.map((r) => r.map(escapeCsv).join(",")).join("\r\n");
        const blob = new Blob(["\ufeff", lines], { type: "text/csv;charset=utf-8" });
        triggerBlobDownload(blob, `${baseName}.csv`);
      } else if (format === "excel") {
        const ExcelJS = await import("exceljs");
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet("Data");

        const metaRow = (text: string) => {
          const row = new Array(headers.length).fill("");
          row[0] = text;
          return row;
        };

        // Add meta header
        worksheet.addRow(metaRow(headerLine));
        worksheet.addRow(metaRow(""));
        worksheet.addRow(headers);

        // Add data rows
        for (const r of previewRows) {
          const row: any[] = [];
          for (const c of previewColumnsShown) {
            const raw = (r as any)?.[c];
            const isEximNumeric = isExim && /^(value|netweight)$/i.test(String(c).trim());
            const shouldNumeric = isEximNumeric || (!isExim && previewNumericColumns.has(c));
            if (shouldNumeric) {
              const n = toNumberLoose(raw);
              row.push(n === null ? toCellDisplay(c, r) : n);
            } else {
              row.push(toCellDisplay(c, r));
            }
          }
          worksheet.addRow(row);
        }

        // Add footer
        worksheet.addRow(metaRow(""));
        worksheet.addRow(metaRow(footerLine));

        const buf = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buf], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        triggerBlobDownload(blob, `${baseName}.xlsx`);
      } else if (format === "pdf") {
        const { jsPDF } = await import("jspdf");
        const autoTableMod = await import("jspdf-autotable");
        const autoTable = (autoTableMod as any).default as any;

        const orientation = headers.length > 6 ? "landscape" : "portrait";
        const doc = new jsPDF({ orientation, unit: "pt", format: "a4" });
        const body = rows.slice(0, 200);
        const footerText = footerLine;
        const headerText = headerLine;
        const pageWidth = orientation === "landscape" ? 842 : 595;
        const marginX = 40;
        const maxWidth = pageWidth - marginX * 2;

        doc.setFontSize(10);
        doc.text(headerText, marginX, 28, { maxWidth });

        autoTable(doc, {
          head: [headers],
          body,
          startY: 54,
          styles: { fontSize: 8, cellPadding: 3 },
          headStyles: { fillColor: [245, 245, 245], textColor: 30 },
          didDrawPage: (data: any) => {
            // Footer on every page, below table area.
            const docAny = data.doc as any;
            docAny.setFontSize(9);
            docAny.text(footerText, marginX, docAny.internal.pageSize.getHeight() - 24, { maxWidth });
          },
        });

        doc.save(`${baseName}.pdf`);
      }
    } finally {
      setDownloadOpen(false);
    }
  };

  // Use all client-side filtered rows for interpretation - no limit
  // This ensures interpretation matches exactly what's displayed in the table
  const insightsSampleRows = previewRowsForInsights;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">Hasil Pencarian</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {q ? (
            <>
              Kata kunci: <span className="font-medium text-gray-800 dark:text-white/90">{q}</span>
            </>
          ) : (
            "Masukkan minimal 2 karakter untuk mencari."
          )}
        </p>
        {q.length < 2 && recentSearches.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {recentSearches.map((recent) => (
              <button
                key={recent}
                type="button"
                onClick={() => router.push(`/search?q=${encodeURIComponent(recent)}`)}
                className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200"
              >
                {recent}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Enhanced Search Loading Progress */}
      {q && q.length >= 2 && searchProgress.stage !== "idle" && searchProgress.stage !== "complete" ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900 sm:p-6">
          <SearchLoadingProgress progress={searchProgress} />
        </div>
      ) : null}

      {q && q.length >= 2 && didYouMeanItems.length > 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">Mungkin maksud Anda</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {didYouMeanItems.map((it) => (
              <button
                key={`dym-${it.kind}-${String(it.id)}`}
                type="button"
                onClick={() => router.push(`/search?q=${encodeURIComponent(it.title)}`)}
                className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200"
              >
                {it.title}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Hasil Cepat Card - only show for non-question queries */}
      {q && q.length >= 2 && !isQuestionQuery(q) ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900 sm:p-6 transition-opacity duration-300">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-800 dark:text-white/90">Hasil Cepat • Data Statistik</h2>
              {loading ? (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Mencari data terbaik...</p>
              ) : previewData || previewParams ? (
                <>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Indikator: <span className="font-medium text-gray-800 dark:text-white/90">{previewData?.source || previewIndicator || "-"}</span>
                    {" "}•{" "}
                    Periode:{" "}
                    <span className="font-medium text-gray-800 dark:text-white/90">
                      {(() => {
                        const base = previewData?.period || previewParams?.period || "-";
                        if (previewPeriodWasMissing && Array.isArray(previewAvailableYears) && previewAvailableYears.length > 0) {
                          const sorted = previewAvailableYears
                            .slice()
                            .map((y) => String(y || "").trim())
                            .filter((y) => /^(19\d{2}|20\d{2}|2100)$/.test(y))
                            .sort((a, b) => Number(a) - Number(b));
                          const y0 = sorted[0];
                          const y1 = sorted[sorted.length - 1];
                          if (y0 && y1 && y0 !== y1) return `${y0} - ${y1}`;
                          if (y0) return y0;
                        }
                        return base;
                      })()}
                    </span>
                    {previewGeoApplied ? (
                      <>
                        {" "}• Kab/Kota: <span className="font-medium text-gray-800 dark:text-white/90">{previewGeo}</span>
                      </>
                    ) : null}
                    {typeof previewPrimaryMonth === "number" ? (
                      <>
                        {" "}• Bulan: <span className="font-medium text-gray-800 dark:text-white/90">{monthNameFromNo(previewPrimaryMonth)}</span>
                      </>
                    ) : null}
                    {previewData?.last_update ? (
                      <>
                        {" "}• Update: <span className="font-medium text-gray-800 dark:text-white/90">{previewData.last_update}</span>
                      </>
                    ) : null}
                    {previewUnit ? (
                      <>
                        {" "}• Satuan: <span className="font-medium text-gray-800 dark:text-white/90">{previewUnit}</span>
                      </>
                    ) : null}
                  </p>
                  {previewMissingPeriodNote ? (
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{previewMissingPeriodNote}</p>
                  ) : null}
                </>
              ) : null}
            </div>
            {previewParams && !loading ? (
              <div className="flex flex-wrap items-center gap-2">
                <div ref={previewColumnMenuRef} className="relative">
                  <button
                    type="button"
                    disabled={previewColumnsShown.length === 0}
                    onClick={() => setPreviewColumnMenuOpen((v) => !v)}
                    className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-white/[0.05]"
                  >
                    Kolom
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
                      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>

                  {previewColumnMenuOpen ? (
                    <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
                      <div className="flex items-center justify-between px-4 py-2 text-[11px] text-gray-500 dark:text-gray-400">
                        <button
                          type="button"
                          onClick={() => setPreviewHiddenColumns([])}
                          className="hover:text-gray-700 dark:hover:text-gray-200"
                        >
                          Tampilkan semua
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewHiddenColumns(previewColumnsShown.slice())}
                          className="hover:text-gray-700 dark:hover:text-gray-200"
                        >
                          Sembunyikan semua
                        </button>
                      </div>
                      <div className="max-h-60 overflow-auto px-2 pb-2">
                        {previewColumnsShown.map((c) => {
                          const label = String(previewParams?.type || "dynamic").toLowerCase() === "exim"
                            ? eximColumnLabel(c, eximMode)
                            : c;
                          const checked = !previewHiddenColumns.includes(c);
                          return (
                            <label key={c} className="flex items-center gap-2 px-2 py-1 text-xs text-gray-700 dark:text-gray-200">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  setPreviewHiddenColumns((prev) =>
                                    checked ? prev.concat(c) : prev.filter((col) => col !== c)
                                  );
                                }}
                                className="h-3.5 w-3.5"
                              />
                              <span className="min-w-0 truncate" title={label}>{label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div ref={downloadMenuRef} className="relative">
                  <button
                    type="button"
                    disabled={!canDownloadQuick}
                    onClick={() => setDownloadOpen((v) => !v)}
                    className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-white/[0.05]"
                  >
                    Download data
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
                      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>

                  {downloadOpen ? (
                    <div className="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
                      <button
                        type="button"
                        onClick={() => downloadQuick("excel")}
                        className="block w-full px-4 py-2 text-left text-xs text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/[0.05]"
                      >
                        Excel (.xlsx)
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadQuick("csv")}
                        className="block w-full px-4 py-2 text-left text-xs text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/[0.05]"
                      >
                        CSV (.csv)
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadQuick("pdf")}
                        className="block w-full px-4 py-2 text-left text-xs text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/[0.05]"
                      >
                        PDF (.pdf)
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadQuick("json")}
                        className="block w-full px-4 py-2 text-left text-xs text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/[0.05]"
                      >
                        JSON (.json)
                      </button>
                    </div>
                  ) : null}
                </div>

                <button
                  type="button"
                  disabled={previewVisibleColumns.length === 0 || previewRows.length === 0}
                  onClick={handlePrintPreview}
                  className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-white/[0.05]"
                >
                  Cetak
                </button>
              </div>
            ) : null}
          </div>

          {loading ? (
            <div className="mt-4 transition-opacity duration-300">
              <QuickResultHeaderSkeleton />
              <div className="mt-4">
                <TablePreviewSkeleton rows={5} cols={4} />
              </div>
            </div>
          ) : !previewParams && previewNeedsConfirmYear && previewAvailableYears.length > 0 ? (
            <div className="mt-3">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {previewConfirmYearMessage || "Tahun yang diminta belum tersedia. Pilih salah satu tahun yang tersedia untuk menampilkan preview."}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {previewAvailableYears.slice(0, 12).map((y) => (
                  <button
                    key={y}
                    type="button"
                    onClick={() => onPreviewYearClick(String(y))}
                    disabled={previewLoading}
                    className="rounded-full border border-gray-200 bg-white px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-white/[0.05]"
                  >
                    {y}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {previewParams && previewPeriodWasMissing && previewAvailableYears.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {previewAvailableYears.map((y) => {
                const active = String(previewParams?.period || "").trim() === String(y || "").trim();
                return (
                  <button
                    key={y}
                    type="button"
                    onClick={() => onPreviewYearClick(y)}
                    disabled={previewLoading}
                    className={`rounded-full border px-3 py-1 text-sm ${
                      active
                        ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                        : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-white/[0.05]"
                    }`}
                  >
                    {y}
                  </button>
                );
              })}
            </div>
          ) : null}

          {!loading && (
            <div className="mt-4 transition-opacity duration-300">
              {!previewParams ? (
                previewUnavailable ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">{previewUnavailable}</p>
                ) : null
              ) : previewLoading ? (
              <TablePreviewSkeleton rows={5} cols={4} />
            ) : previewError ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 animate-fadeIn">{previewError}</p>
            ) : previewColumnsShown.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 animate-fadeIn">Format data tidak didukung.</p>
            ) : previewVisibleColumns.length === 0 ? (
              <div className="animate-fadeIn">
                <p className="text-sm text-gray-500 dark:text-gray-400">Semua kolom disembunyikan.</p>
                <button
                  type="button"
                  onClick={() => setPreviewHiddenColumns([])}
                  className="mt-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-white/[0.05]"
                >
                  Tampilkan semua kolom
                </button>
              </div>
            ) : previewRows.length === 0 ? (
              <div className="animate-fadeIn">
                <EmptyState 
                  variant="no-data" 
                  title="Tidak ada data"
                  description="Data untuk periode yang diminta belum tersedia. Coba pilih periode lain."
                />
              </div>
            ) : (
              <div className="max-h-96 overflow-auto rounded-2xl border border-gray-200 dark:border-gray-800 animate-fadeIn">
                <table className="min-w-full border-collapse text-sm">
                  <colgroup>
                    {previewVisibleColumns.map((c) => (
                      <col
                        key={`col-${c}`}
                        style={previewColumnWidths[c] ? { width: `${previewColumnWidths[c]}px` } : undefined}
                      />
                    ))}
                  </colgroup>
                  <thead className="sticky top-0 z-10 bg-white dark:bg-gray-900">
                    <tr className="border-b border-gray-200 dark:border-gray-800">
                      {previewVisibleColumns.map((c, colIdx) => (
                        <th
                          key={c}
                          className={`relative px-4 py-3 text-center text-xs font-semibold text-gray-600 dark:text-gray-300 ${
                            colIdx > 0 ? 'border-l border-gray-200 dark:border-gray-800' : ''
                          }`}
                        >
                          {String(previewParams?.type || "dynamic").toLowerCase() === "exim"
                            ? eximColumnLabel(c, eximMode)
                            : c}
                          <span
                            role="presentation"
                            onMouseDown={(e) => startPreviewResize(c, e)}
                            className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none"
                          />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((r, idx) => {
                      const monthHit =
                        previewMonthsToHighlight.length > 0 && previewMonthKeyCol
                          ? previewMonthsToHighlight.some((m) => matchesMonthCell((r as any)?.[previewMonthKeyCol], m))
                          : false;
                      return (
                        <tr
                          key={idx}
                          className={`border-b border-gray-100 dark:border-gray-800 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50 ${monthHit ? "bg-brand-50/70 dark:bg-brand-500/10" : ""}`}
                        >
                          {previewVisibleColumns.map((c, colIdx) => (
                            <td
                              key={c}
                              className={`px-4 py-3 text-gray-800 dark:text-white/90 ${
                                monthHit
                                  ? `font-semibold ${c === previewMonthKeyCol ? "border-l-4 border-brand-500 pl-3" : ""}`
                                  : ""
                              } ${
                                String(previewParams?.type || 'dynamic').toLowerCase() === 'exim' && /^(value|netweight)$/i.test(String(c).trim())
                                  ? 'text-right'
                                  : ''
                              } ${
                                String(previewParams?.type || 'dynamic').toLowerCase() !== 'exim' && previewNumericColumns.has(c)
                                  ? 'text-right'
                                  : ''
                              } ${
                                colIdx > 0 && !(monthHit && c === previewMonthKeyCol)
                                  ? 'border-l border-gray-100 dark:border-gray-800'
                                  : ''
                              }`}
                            >
                              {String(previewParams?.type || "dynamic").toLowerCase() === "exim"
                                ? eximCellValue(c, (r as any)?.[c])
                                : (() => {
                                    const v = (r as any)?.[c];
                                    if (v === null || v === undefined || String(v).trim() === "") return "-";
                                    if (previewNumericColumns.has(c)) {
                                      return formatNumberId(v) ?? String(v);
                                    }
                                    return String(v);
                                  })()}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {!previewLoading && !previewError && previewColumnsShown.length > 0 && previewRows.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
                <span>
                  Sumber: <span className="font-medium text-gray-800 dark:text-white/90">{previewData?.source || previewIndicator || "-"}</span>
                </span>
                <span>
                  Dihasilkan: <span className="font-medium text-gray-800 dark:text-white/90">{previewGeneratedAtLabel}</span>
                </span>
              </div>
            ) : null}
          </div>
          )}
        </div>
      ) : null}

      {/* Interpretasi & Grafik Card - only show for non-question queries */}
      {q && q.length >= 2 && !isQuestionQuery(q) ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900 sm:p-6 transition-opacity duration-300">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-gray-800 dark:text-white/90">Interpretasi & Grafik</h2>
          </div>

          {previewMissingPeriodNote && !loading ? (
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{previewMissingPeriodNote}</p>
          ) : null}

          {loading || !previewParams ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-2 transition-opacity duration-300">
              <InterpretationSkeleton />
              <ChartSkeleton height={280} />
            </div>
          ) : previewLoading || previewError ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-2 transition-opacity duration-300">
              <InterpretationSkeleton />
              <ChartSkeleton height={280} />
            </div>
          ) : previewColumnsShown.length === 0 ? (
            <div className="mt-4 animate-fadeIn">
              <p className="text-sm text-gray-500 dark:text-gray-400">Tidak ada data untuk periode yang diminta.</p>
            </div>
          ) : (
            <div className="mt-4 grid gap-4 lg:grid-cols-2 animate-fadeIn">
              {previewRowsForInsights.length === 0 ? (
                <>
                  <div className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
                    <h3 className="text-sm font-semibold text-gray-800 dark:text-white/90">Interpretasi</h3>
                    <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Tidak ada data untuk periode yang diminta.</p>
                  </div>
                  <div className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
                    <h3 className="text-sm font-semibold text-gray-800 dark:text-white/90">Grafik</h3>
                    <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Tidak ada data untuk periode yang diminta.</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="min-w-0">
                    {SEARCH_INSIGHT_ENABLED && (
                    <InterpretationPanel
                      q={q}
                      cacheRef={insightsCacheRef}
                      dataset={
                        previewParams
                          ? {
                              source_id: previewParams.source_id,
                              type: String(previewParams.type || "dynamic"),
                              // If year tabs are active (no year in query), follow the selected year.
                              periods: undefined,
                              period: effectiveInsightsYear ? effectiveInsightsYear : String(previewParams.period || "").trim(),
                              month: previewParams.month ?? null,
                              geo: previewGeoApplied ? previewGeo : undefined,
                              group: (previewParams as any).group,
                              code_hs: (previewParams as any).code_hs,
                              pod: (previewParams as any).pod,
                              ctr: (previewParams as any).ctr,
                              metric: (previewParams as any).metric,
                            }
                          : undefined
                      }
                      preview={{
                        source: previewData?.source || previewIndicator || "",
                        period:
                      (() => {
                        const yrs = extractQueryYearsExpanded(q)
                          .map((y) => String(y || '').trim())
                          .filter((y) => /^(19\d{2}|20\d{2}|2100)$/.test(y));
                        // If query has no year/period, cover the full available year span.
                        if (yrs.length === 0 && previewPeriodWasMissing && previewAvailableYears.length > 0) {
                          const sorted = previewAvailableYears
                            .slice()
                            .map((y) => String(y || '').trim())
                            .filter((y) => /^(19\d{2}|20\d{2}|2100)$/.test(y))
                            .sort((a, b) => Number(a) - Number(b));
                          const y0 = sorted[0];
                          const y1 = sorted[sorted.length - 1];
                          if (y0 && y1 && y0 !== y1) return `Tahun ${y0} - ${y1}`;
                          if (y0) return `Tahun ${y0}`;
                        }
                        if (yrs.length > 1) {
                          const sorted = yrs.slice().sort((a, b) => Number(a) - Number(b));
                          const y0 = sorted[0];
                          const y1 = sorted[sorted.length - 1];
                          const m0 = highlightMonthsForYearFromQuery(q, y0);
                          const m1 = highlightMonthsForYearFromQuery(q, y1);
                          const startM = m0.length > 0 ? Math.min(...m0) : 1;
                          const endM = m1.length > 0 ? Math.max(...m1) : 12;
                          return `${monthNameFromNo(startM)} ${y0} - ${monthNameFromNo(endM)} ${y1}`;
                        }
                        if (yrs.length === 1) {
                          const y0 = yrs[0];
                          const ms = highlightMonthsForYearFromQuery(q, y0);
                          if (ms.length > 0) {
                            const startM = Math.min(...ms);
                            const endM = Math.max(...ms);
                            return `${monthNameFromNo(startM)} ${y0} - ${monthNameFromNo(endM)} ${y0}`;
                          }
                        }
                        return previewData?.period || String(previewParams?.period || "");
                      })(),
                    last_update: previewData?.last_update || null,
                    type: String(previewParams?.type || "dynamic"),
                    geo: previewGeoApplied ? previewGeo : undefined,
                    availableYears: Array.isArray(previewAvailableYears) ? previewAvailableYears : [],
                    month:
                      (() => {
                        const yrs = extractQueryYearsExpanded(q)
                          .map((y) => String(y || '').trim())
                          .filter((y) => /^(19\d{2}|20\d{2}|2100)$/.test(y));
                        // If query doesn't specify a year/period, treat as multi-year range.
                        if (yrs.length === 0 && previewPeriodWasMissing && previewAvailableYears.length > 0) return null;
                        if (yrs.length > 1) return null;
                        if (yrs.length === 1) {
                          const ms = highlightMonthsForYearFromQuery(q, yrs[0]);
                          if (ms.length > 1) return null;
                        }
                        return typeof previewPrimaryMonth === "number" ? previewPrimaryMonth : null;
                      })(),
                    columns: previewColumnsShown,
                    // Provide enough rows to cover multi-year ranges (e.g., 24 months for 2 years)
                    // so server-side summarization doesn't incorrectly stick to the first year.
                    sampleRows: insightsSampleRows,
                    unit: previewUnit,
                  }}
                  onComplete={() => {
                    setSearchProgress((prev) => {
                      if (prev.stage === "insights") {
                        return {
                          ...prev,
                          stage: "complete",
                          message: "Selesai",
                          subMessage: undefined,
                        };
                      }
                      return prev;
                    });
                  }}
                />
                    )}
              </div>

              <div className="min-w-0">
                <SearchInsightsChart
                  rows={previewRowsForInsights}
                  columns={previewColumnsShown}
                  sourceId={previewParams?.source_id ? Number(previewParams.source_id) : undefined}
                  sourceType={(String(previewParams?.type || "dynamic").toLowerCase()) as "dynamic" | "interop" | "exim"}
                  chartConfig={previewChartConfig}
                  allowFullTimeRange={
                    extractQueryYearsExpanded(q)
                      .map((y) => String(y || '').trim())
                      .filter((y) => /^(19\d{2}|20\d{2}|2100)$/.test(y)).length === 0
                  }
                />
              </div>
            </>
          )}
          </div>
        )}
        </div>
      ) : null}

      {q && q.length >= 2 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-gray-800 dark:text-white/90">Hasil Lengkap</h2>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {filteredMixed.length} hasil
            </span>
          </div>

          {loading ? (
            <div className="mt-4">
              <SearchResultRowSkeleton count={4} />
            </div>
          ) : filteredMixed.length === 0 ? (
            <div className="mt-4 animate-fadeIn">
              <EmptyState
                variant="no-recommendations"
                title="Tidak ada hasil"
                description="Coba ubah filter atau kata kunci pencarian."
              />
            </div>
          ) : (
            <div className="mt-4 space-y-6">
              {(["datasource", "publication", "brs"] as ResultKind[]).map((kind) => {
                const items = groupedResults[kind].slice(0, visibleCount);
                if (items.length === 0) return null;
                return (
                  <div key={kind}>
                    <div className="mb-3 flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        kind === "publication"
                          ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300"
                          : kind === "brs"
                            ? "bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-300"
                            : "bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300"
                      }`}>
                        {kind === "datasource" ? "Data Statistik" : kind === "publication" ? "Publikasi" : "BRS"}
                      </span>
                      <span className="text-xs text-gray-400">{groupedResults[kind].length} item</span>
                    </div>
                    <div className="flex gap-4 overflow-x-auto pb-2 scroll-smooth snap-x snap-mandatory">
                      {items.map((it) => (
                        <div key={`${kind}-${String(it.id)}`} className="shrink-0" style={{ scrollSnapAlign: "start" }}>
                          <ResultCard it={it} onOpen={openHitModal} query={q} />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              <div ref={sentinelRef} className="h-6" />
            </div>
          )}
        </div>
      ) : null}

      {modalHit ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[2147483647] flex items-start justify-center overflow-y-auto bg-black/50 p-4 overscroll-contain [-webkit-overflow-scrolling:touch] lg:items-center lg:overflow-y-hidden"
          onClick={closeAnyModal}
        >
          <div
            className="relative w-full max-w-6xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-md dark:border-gray-800 dark:bg-gray-900 lg:h-[calc(100dvh-2rem)]"
            onClick={(e) => e.stopPropagation()}
          >
            {modalHit.kind === "datasource" ? (
              <div className="flex min-h-0 flex-col gap-0 lg:h-full lg:flex-row">
                <div className="w-full border-b border-gray-200 p-4 dark:border-gray-800 lg:flex lg:h-full lg:w-[420px] lg:flex-col lg:border-b-0 lg:border-r">
                  <div className="flex justify-center">
                    <ResultAvatar kind="datasource" />
                  </div>

                  <div className="mt-4 space-y-2 lg:flex-none">
                    <p className="line-clamp-3 text-sm font-semibold text-gray-900 dark:text-white/90">
                      {modalHit.title}
                    </p>

                    <p className="text-theme-sm text-gray-500 dark:text-gray-400">
                      Periode: {modalDataPayload?.data?.period || modalDataParams?.period || "-"}
                    </p>
                    {modalHit.unit ? (
                      <p className="text-theme-sm text-gray-500 dark:text-gray-400">
                        Satuan: {modalHit.unit}
                      </p>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={closeAnyModal}
                        className="rounded-lg border border-pink-500/50 bg-pink-500/35 px-3 py-2 text-sm font-medium text-pink-700 shadow-theme-sm backdrop-blur-sm transition-colors hover:bg-pink-500/45 dark:border-pink-400/40 dark:bg-pink-500/20 dark:text-pink-200"
                      >
                        Tutup
                      </button>
                      <Link
                        href={modalHit.link}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-theme-sm hover:bg-gray-50 dark:border-gray-800 dark:bg-white/[0.03] dark:text-white/90 dark:hover:bg-white/[0.05]"
                      >
                        Buka halaman data
                      </Link>
                    </div>
                  </div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col p-4">
                  <div className="relative w-full flex-1 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] lg:min-h-0">
                    {modalDataLoading ? (
                      <div className="p-4">
                        <LoadingProgressBar label="Loading" />
                      </div>
                    ) : modalDataError ? (
                      <div className="flex h-full w-full items-center justify-center px-4 text-theme-sm text-gray-500 dark:text-gray-400">
                        {modalDataError}
                      </div>
                    ) : (() => {
                        const d = modalDataPayload?.data;
                        const cols = Array.isArray(d?.columns) ? d!.columns : [];
                      const typeNorm = String(modalDataParams?.type || 'dynamic').toLowerCase();
                      const colsShown = typeNorm === 'exim' ? filterEximColumnsForQuery(cols, q, modalDataParams) : cols;
                        const rows = Array.isArray(d?.data) ? d!.data : [];
                        const yearNo = Number(modalDataParams?.period || "");
                        const monthNo = Number(modalDataParams?.month || "");
                        const hasMonth = Number.isFinite(monthNo) && monthNo >= 1 && monthNo <= 12;

                        const geo = modalDataParams?.geo ? String(modalDataParams.geo) : "";
                        const geoNorm = normGeo(geo);
                        const geoKeyCol = geoNorm ? findGeoColumn(cols) : null;

                        const monthKeyCol =
                          colsShown.find((c) => /^(bulan|month)$/i.test(String(c).trim())) ||
                          colsShown.find((c) => /(bulan|month)/i.test(String(c).trim())) ||
                          colsShown[0];

                        const yearKeyCol =
                          cols.find((c) => /^(tahun|year)$/i.test(String(c).trim())) ||
                          cols.find((c) => /(tahun|year)/i.test(String(c).trim())) ||
                          null;

                        if (colsShown.length === 0) {
                          return (
                            <div className="flex h-full w-full items-center justify-center px-4 text-theme-sm text-gray-500 dark:text-gray-400">
                              Format data tidak didukung.
                            </div>
                          );
                        }
                        if (rows.length === 0) {
                          return (
                            <div className="flex h-full w-full items-center justify-center px-4 text-theme-sm text-gray-500 dark:text-gray-400">
                              Tidak ada data.
                            </div>
                          );
                        }
                        return (
                          <div className="h-full w-full overflow-auto">
                            <table className="min-w-full border-collapse text-sm">
                              <thead className="sticky top-0 z-10 bg-white dark:bg-gray-900">
                                <tr className="border-b border-gray-200 dark:border-gray-800">
                                  {colsShown.map((c) => (
                                    <th
                                      key={c}
                                      className={`px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 ${
                                        typeNorm === 'exim' && /^(value|netweight)$/i.test(String(c).trim()) ? 'text-right' : ''
                                      }`}
                                    >
                                      {c}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map((r, idx) => {
                                  const monthHit =
                                    hasMonth && monthKeyCol
                                      ? matchesMonthCell((r as any)?.[monthKeyCol], monthNo)
                                      : false;

                                  const geoHit =
                                    geoNorm && geoKeyCol
                                      ? matchesGeoCell((r as any)?.[geoKeyCol], geoNorm)
                                      : false;

                                  const yearHit =
                                    Number.isFinite(yearNo) && yearKeyCol
                                      ? (() => {
                                          const raw = (r as any)?.[yearKeyCol];
                                          const n = Number(String(raw ?? "").replace(/\D/g, ""));
                                          return Number.isFinite(n) ? n === yearNo : String(raw ?? "") === String(yearNo);
                                        })()
                                      : false;

                                  const highlight = monthHit || geoHit || yearHit;
                                  const highlightKeyCol = monthHit ? monthKeyCol : geoHit ? geoKeyCol : yearHit ? yearKeyCol : null;

                                  return (
                                    <tr
                                      key={idx}
                                      className={`border-b border-gray-100 dark:border-gray-800 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50 ${highlight ? "bg-brand-50/70 dark:bg-brand-500/10" : ""}`}
                                    >
                                      {colsShown.map((c) => (
                                        <td
                                          key={c}
                                          className={`px-4 py-3 text-gray-800 dark:text-white/90 ${
                                            highlight
                                              ? `font-semibold ${highlightKeyCol && c === highlightKeyCol ? "border-l-4 border-brand-500 pl-3" : ""}`
                                              : ""
                                          } ${typeNorm === 'exim' && /^(value|netweight)$/i.test(String(c).trim()) ? 'text-right' : ''}`}
                                        >
                                          {(r as any)?.[c] === null || (r as any)?.[c] === undefined ? "-" : String((r as any)[c])}
                                        </td>
                                      ))}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        );
                      })()}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-col gap-0 lg:h-full lg:flex-row">
                <div className="w-full border-b border-gray-200 p-4 dark:border-gray-800 lg:flex lg:h-full lg:w-[520px] lg:flex-col lg:border-b-0 lg:border-r">
                  <div className="w-full overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-white/[0.03] lg:min-h-0 lg:flex-1">
                    {(() => {
                      const cover =
                        modalHit.kind === "publication"
                          ? ((modalDoc as PublicationDetail | null)?.cover || "")
                          : ((modalDoc as BrsDetail | null)?.thumbnail || "");

                      const thumb = cover ? `/api/thumbnail?url=${encodeURIComponent(cover)}` : "";
                      return thumb ? (
                        <img
                          src={thumb}
                          alt=""
                          className="block h-auto w-full lg:h-full lg:w-full lg:object-contain"
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="aspect-4/3 w-full lg:h-full" />
                      );
                    })()}
                  </div>

                  <div className="mt-4 space-y-2 lg:flex-none">
                    <p className="line-clamp-3 text-sm font-semibold text-gray-900 dark:text-white/90">
                      {sanitizeText(
                        (modalDoc && (modalDoc as any).title) ? String((modalDoc as any).title) : modalHit.title
                      ) || "(Tanpa judul)"}
                    </p>

                    {(() => {
                      const abs = modalDoc ? String((modalDoc as any).abstract || "") : "";
                      const bullets = parseAbstractBullets(abs);
                      return bullets.length > 0 ? (
                        <ul className="list-disc space-y-1 pl-5 text-theme-sm text-gray-700 dark:text-gray-300">
                          {bullets.map((b, i) => (
                            <li key={i}>{b}</li>
                          ))}
                        </ul>
                      ) : null;
                    })()}

                    <p className="text-theme-sm text-gray-500 dark:text-gray-400">
                      {(() => {
                        const d = modalDoc ? ((modalDoc as any).rl_date as string | undefined) : undefined;
                        return d ? formatTanggal(d) : (modalHit.subtitle ? String(modalHit.subtitle) : "-");
                      })()}
                    </p>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={closeAnyModal}
                        className="rounded-lg border border-pink-500/50 bg-pink-500/35 px-3 py-2 text-sm font-medium text-pink-700 shadow-theme-sm backdrop-blur-sm transition-colors hover:bg-pink-500/45 dark:border-pink-400/40 dark:bg-pink-500/20 dark:text-pink-200"
                      >
                        Tutup
                      </button>
                      <Link
                        href={modalHit.link}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-theme-sm hover:bg-gray-50 dark:border-gray-800 dark:bg-white/[0.03] dark:text-white/90 dark:hover:bg-white/[0.05]"
                      >
                        Buka halaman
                      </Link>
                    </div>
                  </div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col p-4">
                  <div className="relative w-full flex-1 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] lg:min-h-0">
                    <div className="w-full aspect-[210/297] lg:aspect-auto lg:h-full">
                      {modalLoading ? (
                        <div className="p-4">
                          <LoadingProgressBar label="Loading" />
                        </div>
                      ) : modalError ? (
                        <div className="flex h-full w-full items-center justify-center px-4 text-theme-sm text-gray-500 dark:text-gray-400">
                          {modalError}
                        </div>
                      ) : (() => {
                          const pdf = modalDoc ? String((modalDoc as any).pdf || "") : "";
                          const pdfPreviewUrl = pdf ? `/api/pdf?url=${encodeURIComponent(pdf)}` : "";

                          if (!pdfPreviewUrl) {
                            return (
                              <div className="flex h-full w-full items-center justify-center px-4 text-theme-sm text-gray-500 dark:text-gray-400">
                                Preview PDF tidak tersedia
                              </div>
                            );
                          }

                          return shouldUsePdfJs ? (
                            <PdfJsPreview url={pdfPreviewUrl} />
                          ) : (
                            <iframe
                              title="Preview PDF"
                              src={pdfPreviewUrl}
                              className="h-full w-full"
                              scrolling="yes"
                              allowFullScreen
                              onLoad={() => {
                                setPdfProgress(100);
                                window.setTimeout(() => setPdfLoading(false), 250);
                              }}
                            />
                          );
                        })()}
                    </div>

                    {!shouldUsePdfJs && modalDoc && (modalDoc as any).pdf ? (
                      <PdfLoadingOverlay active={pdfLoading} pct={pdfProgress} />
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );

  function PdfLoadingOverlay({ active, pct }: { active: boolean; pct: number }) {
    if (!active) return null;
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-white/70 dark:bg-gray-900/60">
        <div className="w-full max-w-md px-6">
          <div className="flex items-center justify-between text-sm font-medium text-gray-700 dark:text-gray-200">
            <span>Memuat PDF</span>
            <span>{pct}%</span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
            <div
              className="h-full rounded-full bg-gray-900 transition-[width] duration-200 dark:bg-white"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>
    );
  }
}
