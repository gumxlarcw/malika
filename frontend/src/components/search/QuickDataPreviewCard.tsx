"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import LoadingProgressBar from "@/components/LoadingProgressBar";
import { filterEximColumnsForQuery } from "@/lib/eximQueryIntent";
import { SEARCH_INSIGHT_ENABLED } from "@/lib/featureFlags";
import InterpretationPanel, { type InsightResponse } from "@/components/search/InterpretationPanel";
import SearchInsightsChart from "@/components/search/SearchInsightsChart";
import { applyAggregateOrdering, looksLikePdrbTable, normalizeTableData, extractUnitFromTitle } from "@/lib/tableRowOrdering";

type Hit = { id: string | number; title: string; subtitle?: string; link: string; score: number; thumbnail?: string };

type ApiResponse = {
  q: string;
  exact?: { datasources?: Hit[]; publications?: Hit[]; brs?: Hit[] };
  suggestions?: { datasources?: Hit[]; publications?: Hit[]; brs?: Hit[] };
};

type ProcessedDynamic = {
  period: string;
  columns: string[];
  data: Array<Record<string, any>>;
  source: string;
  last_update: string | null;
  unit?: string | null;
};

type DynamicResponse = {
  cached: boolean;
  updated: boolean;
  data: ProcessedDynamic;
};

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

function formatNumberId(input: unknown) {
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
  const g = String(geoNorm || "").trim();
  return g === "maluku utara" || g === "malut";
}

function looksKabKotaBreakdown(title: string, columns: string[]) {
  const t = String(title || "");
  const cols = Array.isArray(columns) ? columns : [];
  const colsJoined = cols.join(" ");
  // Check title/columns for explicit kab/kota patterns
  if (/(menurut\s+kabupaten\s*\/\s*kota|kabupaten\s*\/\s*kota|kab\s*\/\s*kota|kab\s*kota)/i.test(t + " " + colsJoined)) {
    return true;
  }
  // Also detect if first column is "Wilayah" (common in interop tables)
  const firstCol = String(cols[0] || "").trim().toLowerCase();
  if (firstCol === "wilayah") {
    return true;
  }
  return false;
}

function findWilayahCodeColumn(columns: string[]) {
  const cols = Array.isArray(columns) ? columns : [];
  const exact =
    cols.find((c) =>
      /^(kode|kode_wilayah|kode_kabkota|kode_kab_kota|id_wilayah|idkab|id_kab|id_kabkota|id_kab_kota)$/i.test(
        String(c || "").trim()
      )
    ) || null;
  if (exact) return exact;
  return cols.find((c) => /(kode|id).*(wilayah|kab|kota)/i.test(String(c || "").trim())) || null;
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

  const orderCodes = [8201, 8202, 8203, 8204, 8205, 8206, 8207, 8208, 8271, 8272, 8200];
  const orderPos = new Map<number, number>();
  orderCodes.forEach((code, idx) => orderPos.set(code, idx));

  const normName = (v: unknown) => String(v || "").toLowerCase().replace(/\s+/g, " ").trim();
  const nameToCode: Record<string, number> = {
    "halmahera barat": 8201,
    "halmahera tengah": 8202,
    "kepulauan sula": 8203,
    "halmahera selatan": 8204,
    "halmahera utara": 8205,
    "halmahera timur": 8206,
    "pulau morotai": 8207,
    "pulau taliabu": 8208,
    "kota ternate": 8271,
    "kota tidore kepulauan": 8272,
    // Without "Kota" prefix (dynamic API uses these)
    "ternate": 8271,
    "tidore kepulauan": 8272,
    "maluku utara": 8200,
  };

  const parseCode = (v: unknown): number | null => {
    if (v == null) return null;
    if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
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
      if (name && typeof nameToCode[name] === "number") return nameToCode[name];
    }
    return null;
  };

  const hasAnyKnown = rows.some((r) => {
    const code = getRowCode(r);
    return typeof code === "number" && orderPos.has(code);
  });
  if (!hasAnyKnown) return rows;

  const decorated = rows.map((r, idx) => {
    const code = getRowCode(r);
    const pos = typeof code === "number" ? orderPos.get(code) : undefined;
    return { r, idx, pos: typeof pos === "number" ? pos : null };
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

function shouldApplyGeoFilter(opts: { geoNorm: string; filteredLen: number; totalLen: number; title: string; columns: string[] }) {
  const { geoNorm, filteredLen, totalLen, title, columns } = opts;
  if (filteredLen <= 0) return false;
  if (filteredLen >= totalLen) return true;

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
    .replace(/\b(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\b/g, " ")
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
  const raw = String(q || "").toLowerCase();
  const years = Array.from(raw.matchAll(/\b(19\d{2}|20\d{2}|2100)\b/g))
    .map((m) => String(m[1] || "").trim())
    .filter(Boolean);
  return Array.from(new Set(years));
}

function queryHasRangeHint(q: string) {
  const raw = String(q || "").toLowerCase();
  if (!raw) return false;
  return /(\b(sampai|hingga|sd|s\/d|s\.d|to)\b|\s[-–—]\s)/i.test(raw);
}

function expandYearsInclusive(years: string[]) {
  const nums = (Array.isArray(years) ? years : [])
    .map((y) => Number(String(y || "").trim()))
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
  let s = String(q || "").toLowerCase();
  if (!s) return s;

  s = s
    .replace(/\bjanuary\b/g, "januari")
    .replace(/\bjan\b/g, "jan")
    .replace(/\bjan\.\b/g, "jan")
    .replace(/\bfebruary\b/g, "februari")
    .replace(/\bfeb\b/g, "feb")
    .replace(/\bfeb\.\b/g, "feb")
    .replace(/\bfebr\b/g, "feb")
    .replace(/\bmarch\b/g, "maret")
    .replace(/\bmar\b/g, "mar")
    .replace(/\bmar\.\b/g, "mar")
    .replace(/\bmrt\b/g, "mar")
    .replace(/\bapril\b/g, "april")
    .replace(/\bapr\b/g, "apr")
    .replace(/\bapr\.\b/g, "apr")
    .replace(/\bmay\b/g, "mei")
    .replace(/\bjune\b/g, "juni")
    .replace(/\bjun\b/g, "jun")
    .replace(/\bjun\.\b/g, "jun")
    .replace(/\bjuly\b/g, "juli")
    .replace(/\bjul\b/g, "jul")
    .replace(/\bjul\.\b/g, "jul")
    .replace(/\baugust\b/g, "agustus")
    .replace(/\baug\b/g, "ags")
    .replace(/\bseptember\b/g, "september")
    .replace(/\bsept\b/g, "sep")
    .replace(/\bsep\.\b/g, "sep")
    .replace(/\boctober\b/g, "oktober")
    .replace(/\boct\b/g, "okt")
    .replace(/\bnovember\b/g, "november")
    .replace(/\bnov\b/g, "nov")
    .replace(/\bdecember\b/g, "desember")
    .replace(/\bdec\b/g, "des");

  s = s
    .replace(/\bjanuar(i)+\b/g, "januari")
    .replace(/\bjanuri\b/g, "januari")
    .replace(/\bjanwari\b/g, "januari")
    .replace(/\bfebruar(i)+\b/g, "februari")
    .replace(/\bfebuari\b/g, "februari")
    .replace(/\bfebuary\b/g, "februari")
    .replace(/\bpebruari\b/g, "februari")
    .replace(/\bagt\b/g, "ags")
    .replace(/\bags\b/g, "ags")
    .replace(/\bagst\b/g, "ags")
    .replace(/\bagus\b/g, "agustus")
    .replace(/\bagu\b/g, "ags")
    .replace(/\bnopember\b/g, "november")
    .replace(/\bnovembar\b/g, "november")
    .replace(/\bnovem\b/g, "nov")
    .replace(/\bdessember\b/g, "desember");

  return s;
}

function extractSingleQueryMonthNo(q: string): string {
  const raw = normalizeMonthQuery(q);
  const monthMap: Record<string, string> = {
    januari: "1",
    februari: "2",
    maret: "3",
    april: "4",
    mei: "5",
    juni: "6",
    juli: "7",
    agustus: "8",
    september: "9",
    oktober: "10",
    november: "11",
    desember: "12",
  };
  const hits = Array.from(raw.matchAll(/\b(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\b/g))
    .map((m) => monthMap[String(m[1] || "")])
    .filter(Boolean);
  const uniq = Array.from(new Set(hits));
  return uniq.length === 1 ? uniq[0] : "";
}

function extractQueryMonthNosAll(q: string): string[] {
  const raw = normalizeMonthQuery(q);
  const monthMap: Record<string, string> = {
    januari: "1",
    jan: "1",
    februari: "2",
    feb: "2",
    maret: "3",
    mar: "3",
    april: "4",
    apr: "4",
    mei: "5",
    juni: "6",
    jun: "6",
    juli: "7",
    jul: "7",
    agustus: "8",
    agu: "8",
    ags: "8",
    september: "9",
    sep: "9",
    oktober: "10",
    okt: "10",
    november: "11",
    nov: "11",
    desember: "12",
    des: "12",
  };

  const hits = Array.from(
    raw.matchAll(/\b(januari|jan|februari|feb|maret|mar|april|apr|mei|juni|jun|juli|jul|agustus|agu|ags|september|sep|oktober|okt|november|nov|desember|des)\b/g)
  )
    .map((m) => monthMap[String(m[1] || "")])
    .filter(Boolean);

  for (const m of raw.matchAll(/\b(19\d{2}|20\d{2}|2100)\s*[-\/]\s*(0?[1-9]|1[0-2])\b/g)) {
    const mo = Number(m[2]);
    if (Number.isInteger(mo) && mo >= 1 && mo <= 12) hits.push(String(mo));
  }

  const uniq = Array.from(new Set(hits));
  uniq.sort((a, b) => Number(a) - Number(b));
  return uniq;
}

function highlightMonthsForYearFromQuery(q: string, year: string) {
  const yy = String(year || "").trim();
  if (!/^(19\d{2}|20\d{2}|2100)$/.test(yy)) return [];
  const raw = normalizeMonthQuery(q);

  const yearToken = "(?:19\\d{2}|20\\d{2}|2100)";
  const monthToken = "(?:januari|jan|februari|feb|maret|mar|april|apr|mei|juni|jun|juli|jul|agustus|agu|ags|september|sep|oktober|okt|november|nov|desember|des)";
  const rangeSep = "(?:-|–|—|sampai|hingga|sd|s/d|s\\.d|to)";

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

  const months = new Set<number>();

  const addRange = (y1: number, m1: number, y2: number, m2: number) => {
    const start = new Date(y1, m1 - 1, 1);
    const end = new Date(y2, m2 - 1, 1);
    if (!(start instanceof Date) || !(end instanceof Date)) return;
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return;

    const forward = start <= end;
    const cur = new Date(start);
    for (let i = 0; i < 240; i++) {
      const y = cur.getFullYear();
      const m = cur.getMonth() + 1;
      if (String(y) === yy) months.add(m);
      if (cur.getFullYear() === end.getFullYear() && cur.getMonth() === end.getMonth()) break;
      cur.setMonth(cur.getMonth() + (forward ? 1 : -1));
    }
  };

  // month year
  const reMonthYear = new RegExp(`\\b(${monthToken})\\b\\s*\\b(${yearToken})\\b`, "g");
  for (const m of raw.matchAll(reMonthYear)) {
    const mo = monthMap[String(m[1] || "")];
    const yy0 = String(m[2] || "").trim();
    if (yy0 === yy && Number.isInteger(mo)) months.add(mo);
  }

  // YYYY-MM
  const reYm = new RegExp(`\\b(${yearToken})\\s*[-\\/]\\s*(0?[1-9]|1[0-2])\\b`, "g");
  for (const m of raw.matchAll(reYm)) {
    const yy0 = String(m[1] || "").trim();
    const mo = Number(m[2]);
    if (yy0 === yy && Number.isInteger(mo)) months.add(mo);
  }

  // MM-YYYY
  const reMy = new RegExp(`\\b(0?[1-9]|1[0-2])\\s*[-\\/]\\s*(${yearToken})\\b`, "g");
  for (const m of raw.matchAll(reMy)) {
    const mo = Number(m[1]);
    const yy0 = String(m[2] || "").trim();
    if (yy0 === yy && Number.isInteger(mo)) months.add(mo);
  }

  // month year - month year
  const reFullRange = new RegExp(`\\b(${monthToken})\\b\\s*\\b(${yearToken})\\b\\s*${rangeSep}\\s*\\b(${monthToken})\\b\\s*\\b(${yearToken})\\b`, "g");
  for (const m of raw.matchAll(reFullRange)) {
    const m1 = monthMap[String(m[1] || "")];
    const y1 = Number(String(m[2] || "").trim());
    const m2 = monthMap[String(m[3] || "")];
    const y2 = Number(String(m[4] || "").trim());
    if (Number.isInteger(m1) && Number.isInteger(m2) && Number.isFinite(y1) && Number.isFinite(y2)) {
      addRange(y1, m1, y2, m2);
    }
  }

  // month - month year (same-year)
  const reSameYearRange = new RegExp(`\\b(${monthToken})\\b\\s*${rangeSep}\\s*\\b(${monthToken})\\b\\s*\\b(${yearToken})\\b`, "g");
  for (const m of raw.matchAll(reSameYearRange)) {
    const m1 = monthMap[String(m[1] || "")];
    const m2 = monthMap[String(m[2] || "")];
    const y = Number(String(m[3] || "").trim());
    if (Number.isInteger(m1) && Number.isInteger(m2) && Number.isFinite(y)) {
      addRange(y, m1, y, m2);
    }
  }

  // YYYY-MM - YYYY-MM
  const reYmRange = new RegExp(`\\b(${yearToken})\\s*[-\\/]\\s*(0?[1-9]|1[0-2])\\b\\s*${rangeSep}\\s*\\b(${yearToken})\\s*[-\\/]\\s*(0?[1-9]|1[0-2])\\b`, "g");
  for (const m of raw.matchAll(reYmRange)) {
    const y1 = Number(String(m[1] || "").trim());
    const m1 = Number(m[2]);
    const y2 = Number(String(m[3] || "").trim());
    const m2 = Number(m[4]);
    if (Number.isFinite(y1) && Number.isFinite(y2) && Number.isInteger(m1) && Number.isInteger(m2)) {
      addRange(y1, m1, y2, m2);
    }
  }

  // MM-YYYY - MM-YYYY
  const reMyRange = new RegExp(`\\b(0?[1-9]|1[0-2])\\s*[-\\/]\\s*(${yearToken})\\b\\s*${rangeSep}\\s*\\b(0?[1-9]|1[0-2])\\s*[-\\/]\\s*(${yearToken})\\b`, "g");
  for (const m of raw.matchAll(reMyRange)) {
    const m1 = Number(m[1]);
    const y1 = Number(String(m[2] || "").trim());
    const m2 = Number(m[3]);
    const y2 = Number(String(m[4] || "").trim());
    if (Number.isFinite(y1) && Number.isFinite(y2) && Number.isInteger(m1) && Number.isInteger(m2)) {
      addRange(y1, m1, y2, m2);
    }
  }

  return Array.from(months).sort((a, b) => a - b);
}

function pickYearFromQuery(availableYears: string[], q: string) {
  const years = Array.isArray(availableYears) ? availableYears.slice() : [];
  years.sort((a, b) => Number(b) - Number(a));
  if (years.length === 0) return "";
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
  const type = (typeRaw === "" && hasEximMarkers) || (typeRaw === "dynamic" && hasEximMarkers) ? "exim" : typeRaw || "dynamic";

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

type Props = {
  q: string;
  preferredDataLink?: string | null;
  dbOnly?: boolean;
  /** When true, only render the table preview—no InterpretationPanel or chart. */
  tableOnly?: boolean;
};

export default function QuickDataPreviewCard({ q, preferredDataLink, dbOnly, tableOnly }: Props) {
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [data, setData] = useState<ApiResponse | null>(null);

  const [previewPayload, setPreviewPayload] = useState<DynamicResponse | null>(null);
  const [previewPayloadByYear, setPreviewPayloadByYear] = useState<Record<string, DynamicResponse> | null>(null);
  const [previewActiveYear, setPreviewActiveYear] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewParams, setPreviewParams] = useState<ReturnType<typeof parseDataLink> | null>(null);
  const [previewPendingParams, setPreviewPendingParams] = useState<ReturnType<typeof parseDataLink> | null>(null);
  const [previewNeedsConfirmYear, setPreviewNeedsConfirmYear] = useState(false);
  const [previewConfirmYearMessage, setPreviewConfirmYearMessage] = useState<string | null>(null);
  const [previewLink, setPreviewLink] = useState<string | null>(null);
  const [previewUnavailable, setPreviewUnavailable] = useState<string | null>(null);
  const [previewIndicator, setPreviewIndicator] = useState<string | null>(null);
  const [previewAvailableYears, setPreviewAvailableYears] = useState<string[]>([]);
  const [previewPeriodWasMissing, setPreviewPeriodWasMissing] = useState(false);
  const [previewGeneratedAt, setPreviewGeneratedAt] = useState<string | null>(null);

  const insightsCacheRef = useRef<Map<string, InsightResponse>>(new Map());

  const [previewLoading, setPreviewLoading] = useState(false);

  const [downloadOpen, setDownloadOpen] = useState(false);
  const downloadMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const el = downloadMenuRef.current;
      if (!el) return;
      if (el.contains(e.target as any)) return;
      setDownloadOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const qq = String(q || "").trim();
      if (!qq || qq.length < 2) {
        setData({ q: qq, exact: { datasources: [], publications: [], brs: [] }, suggestions: { datasources: [], publications: [], brs: [] } });
        setLoadingSearch(false);
        return;
      }

      setLoadingSearch(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(qq)}${dbOnly ? "&dbOnly=1" : ""}`, { cache: "no-store" });
        const json = (await res.json()) as ApiResponse;
        if (cancelled) return;
        setData(json);
      } catch {
        if (cancelled) return;
        setData({ q: qq, exact: { datasources: [], publications: [], brs: [] }, suggestions: { datasources: [], publications: [], brs: [] } });
      } finally {
        if (!cancelled) setLoadingSearch(false);
      }
    };

    load();
    return () => {
      cancelled = true;
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
      setPreviewNeedsConfirmYear(false);
      setPreviewConfirmYearMessage(null);
      setPreviewLink(null);
      setPreviewUnavailable(null);
      setPreviewIndicator(null);
      setPreviewAvailableYears([]);
      setPreviewPeriodWasMissing(false);
      setPreviewGeneratedAt(null);
      setDownloadOpen(false);

      if (loadingSearch) return;

      const exactDs = Array.isArray(data?.exact?.datasources) ? data!.exact!.datasources! : [];
      const sugDs = Array.isArray(data?.suggestions?.datasources) ? data!.suggestions!.datasources! : [];

      const candidates = [...exactDs, ...sugDs];
      if (candidates.length === 0 && !preferredDataLink) return;

      const bestCandidate = candidates.slice().sort((a, b) => (b.score || 0) - (a.score || 0))[0];
      if (bestCandidate?.title) setPreviewIndicator(bestCandidate.title || null);

      const preferredParsed = preferredDataLink ? parseDataLink(preferredDataLink) : null;
      const bestParsed = preferredParsed
        ? ({ it: bestCandidate || { id: 0, title: "", link: preferredDataLink, score: 0 }, parsed: preferredParsed } as any)
        : (candidates
            .map((it) => ({ it, parsed: parseDataLink(it?.link) }))
            .filter((x) => !!x.parsed)
            .sort((a, b) => (b.it.score || 0) - (a.it.score || 0))[0] || null);

      if (!bestParsed?.parsed) {
        const bestLink = typeof bestCandidate?.link === "string" ? bestCandidate.link : "";
        const subtitle = typeof bestCandidate?.subtitle === "string" ? bestCandidate.subtitle : "";

        if (bestLink.startsWith("/search?") && subtitle) {
          setPreviewUnavailable(`Preview belum bisa ditampilkan: ${subtitle}.`);
        } else if (bestLink.startsWith("/search?")) {
          setPreviewUnavailable(
            "Preview belum bisa ditampilkan. Tambahkan tahun (mis. 2025) pada kata kunci agar sistem bisa membuka halaman data dan menampilkan preview."
          );
        } else {
          setPreviewUnavailable(
            "Preview tabel hanya tersedia untuk Data Statistik. Untuk EXIM, tambahkan komoditas/HS2 (mis. nikel / HS 75) agar bisa menampilkan data."
          );
        }
        return;
      }

      const parsed = bestParsed.parsed;
      setPreviewPendingParams(parsed);

      const originalMissingPeriod = !String(parsed.period || "").trim();
      setPreviewPeriodWasMissing(originalMissingPeriod);
      setPreviewIndicator(bestParsed.it.title || null);
      setPreviewLoading(true);

      try {
        let effectivePeriod = String(parsed.period || "").trim();
        const qYears = extractQueryYearsExpanded(q)
          .map((y) => String(y || "").trim())
          .filter((y) => /^(19\d{2}|20\d{2}|2100)$/.test(y));

        let yearsForTabs: string[] = [];

        const shouldResolveToQueryYear = qYears.length > 0 && (!effectivePeriod || !qYears.includes(effectivePeriod) || qYears.length > 1);
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
              return;
            }
          }

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
            effectivePeriod = pickYearFromQuery(years, q);
            yearsForTabs = [];
            setPreviewAvailableYears([]);
          } else {
            yearsForTabs = [];
            setPreviewAvailableYears([]);
          }
        }

        if (!originalMissingPeriod && qYears.length <= 1) {
          setPreviewAvailableYears([]);
          setPreviewPeriodWasMissing(false);
        }

        if (!effectivePeriod) {
          setPreviewError("Periode belum tersedia untuk indikator ini.");
          return;
        }

        // Period is valid; allow preview rendering.
        setPreviewNeedsConfirmYear(false);
        setPreviewConfirmYearMessage(null);

        const shouldPrefetchAllYearsWhenNoPeriod = originalMissingPeriod && qYears.length === 0 && yearsForTabs.length > 0;
        console.log('[Fetch DEBUG] originalMissingPeriod=', originalMissingPeriod, 'qYears=', qYears, 'yearsForTabs=', yearsForTabs, 'shouldPrefetchAllYearsWhenNoPeriod=', shouldPrefetchAllYearsWhenNoPeriod);
        if ((qYears.length > 1 && yearsForTabs.length > 0) || shouldPrefetchAllYearsWhenNoPeriod) {
          const yearsToFetch = yearsForTabs.slice();
          console.log('[Fetch DEBUG] Will fetch multiple years:', yearsToFetch);
          const year0 = String(effectivePeriod || yearsToFetch[0] || "").trim();
          const activeYear = yearsToFetch.includes(year0) ? year0 : yearsToFetch[0];

          const typeNorm = String(parsed.type || "dynamic").toLowerCase();
          const facets = typeNorm === "exim" ? {} : {};

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
                pod: (nextParams as any).pod || (facets as any).pod || "",
                ctr: (nextParams as any).ctr || (facets as any).ctr || "",
                code_hs: (nextParams as any).code_hs || (facets as any).code_hs || "",
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
          console.log('[Fetch DEBUG] Fetched years map keys=', Object.keys(map), 'total rows=', Object.values(map).reduce((s,p:any)=>s+(p?.data?.data?.length||0),0));

          if (Object.keys(map).length === 0) {
            setPreviewError("Gagal memuat data.");
            return;
          }

          setPreviewPayloadByYear(map);
          setPreviewActiveYear(activeYear);
          setPreviewPayload(map[activeYear] || Object.values(map)[0]);
          setPreviewGeneratedAt(new Date().toISOString());

          const sp = new URLSearchParams();
          sp.set("source_id", String(parsed.source_id));
          sp.set("period", activeYear);
          if (parsed.type) sp.set("type", String(parsed.type));
          setPreviewLink(`/data?${sp.toString()}`);

          setPreviewParams({ ...parsed, period: activeYear });
          return;
        }

        const monthsForYear = highlightMonthsForYearFromQuery(q, effectivePeriod);
        const monthNoFromQuery = extractSingleQueryMonthNo(q);
        const shouldClearMonth = monthsForYear.length > 1;
        const shouldSetSingleMonthFromYear = monthsForYear.length === 1;
        const shouldFallbackSetMonth = monthsForYear.length === 0 && monthNoFromQuery && qYears.includes(String(effectivePeriod));

        const nextParams = {
          ...parsed,
          period: effectivePeriod,
          month: shouldClearMonth ? "" : shouldSetSingleMonthFromYear ? String(monthsForYear[0]) : shouldFallbackSetMonth ? monthNoFromQuery : "",
        };

        setPreviewParams(nextParams as any);

        const sp = new URLSearchParams();
        sp.set("source_id", String(nextParams.source_id));
        if (nextParams.period) sp.set("period", String(nextParams.period));
        if ((nextParams as any).type) sp.set("type", String((nextParams as any).type));
        if ((nextParams as any).month) sp.set("month", String((nextParams as any).month));
        if ((nextParams as any).geo) sp.set("geo", String((nextParams as any).geo));
        if ((nextParams as any).q) sp.set("q", String((nextParams as any).q));
        if ((nextParams as any).group) sp.set("group", String((nextParams as any).group));
        if ((nextParams as any).code_hs) sp.set("code_hs", String((nextParams as any).code_hs));
        if ((nextParams as any).pod) sp.set("pod", String((nextParams as any).pod));
        if ((nextParams as any).ctr) sp.set("ctr", String((nextParams as any).ctr));
        if ((nextParams as any).metric) sp.set("metric", String((nextParams as any).metric));
        setPreviewLink(`/data?${sp.toString()}`);

        const url = `/api/data-preview?source_id=${encodeURIComponent(nextParams.source_id)}&period=${encodeURIComponent(effectivePeriod)}${(nextParams as any).type ? `&type=${encodeURIComponent((nextParams as any).type)}` : ""}${(nextParams as any).month ? `&month=${encodeURIComponent((nextParams as any).month)}` : ""}${(nextParams as any).group ? `&group=${encodeURIComponent((nextParams as any).group)}` : ""}${(nextParams as any).code_hs ? `&code_hs=${encodeURIComponent((nextParams as any).code_hs)}` : ""}${(nextParams as any).pod ? `&pod=${encodeURIComponent((nextParams as any).pod)}` : ""}${(nextParams as any).ctr ? `&ctr=${encodeURIComponent((nextParams as any).ctr)}` : ""}${(nextParams as any).metric ? `&metric=${encodeURIComponent((nextParams as any).metric)}` : ""}`;

        const res = await fetch(url, { cache: "no-store" });
        const json = (await res.json()) as any;
        if (cancelled) return;

        if (!res.ok) {
          const code = typeof json?.code === "string" ? json.code : "";
          if (code === "DB_BPS_DISABLED") {
            setPreviewError("DB data_bps belum dikonfigurasi. Endpoint EXIM hanya melayani data dari data_bps.");
          } else {
            setPreviewError(typeof json?.message === "string" ? json.message : "Gagal memuat data.");
          }
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

    run();
    return () => {
      cancelled = true;
    };
  }, [data, loadingSearch, preferredDataLink, q]);

  const previewData = previewPayload?.data;
  const previewColumns = Array.isArray(previewData?.columns) ? previewData!.columns! : [];
  const previewRowsRaw = Array.isArray(previewData?.data) ? previewData!.data! : [];
  const previewYearStr = String(previewParams?.period || "").trim();
  const previewHighlightMonths = previewParams ? highlightMonthsForYearFromQuery(q, previewYearStr) : [];
  const eximMode = detectEximModeFromQuery(q);
  const previewFallbackMonthNo = Number(previewParams?.month || "");
  const previewFallbackMonths =
    Number.isFinite(previewFallbackMonthNo) && previewFallbackMonthNo >= 1 && previewFallbackMonthNo <= 12 ? [previewFallbackMonthNo] : [];
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
        title: String(previewData?.source || previewIndicator || ""),
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
    previewType === "exim" ? filterEximColumnsForQuery(previewColumns, previewQ, previewParams as any) : previewColumns;
  const previewTerms = previewType === "exim" ? [] : extractQueryTerms(previewQ);

  const previewRowsByTerms =
    previewTerms.length > 0 ? previewRowsGeo.filter((r) => rowMatchesTerms(r as any, previewTerms, previewColumns)) : previewRowsGeo;
  let previewRows = previewTerms.length > 0 && previewRowsByTerms.length === 0 ? previewRowsGeo : previewRowsByTerms;

  const previewMonthKeyCol =
    previewColumnsShown.find((c) => /^(bulan|month)$/i.test(String(c).trim())) ||
    previewColumnsShown.find((c) => /(bulan|month)/i.test(String(c).trim())) ||
    previewColumnsShown[0];

  if (previewType === "exim" && previewMonthsToHighlight.length > 0 && previewMonthKeyCol) {
    previewRows = previewRows.filter((r) => previewMonthsToHighlight.some((m) => matchesMonthCell((r as any)?.[previewMonthKeyCol], m)));
  }

  previewRows = applyMalutWilayahDefaultOrder({
    rows: previewRows,
    geoKeyCol: previewGeoKeyCol,
    wilayahCodeCol: previewWilayahCodeCol,
    title: String(previewData?.source || previewIndicator || ""),
    columns: previewColumns,
  });

  // PDRB/Growth table special ordering: move aggregate/total row to bottom.
  if (previewType !== "exim") {
    const previewTitle = String(previewData?.source || previewIndicator || "");
    previewRows = applyAggregateOrdering({
      rows: previewRows,
      labelCol: previewColumnsShown[0] || null,
      title: previewTitle,
    });
  }

  // Normalize data if there's a scale mismatch (e.g., 1282937 vs 1337.2 when unit is "ribu jiwa")
  const previewTitle = String(previewData?.source || previewIndicator || "");
  // Use API unit first (more reliable), fallback to extracting from title
  const previewUnit = previewData?.unit || extractUnitFromTitle(previewTitle);
  const normalizationResult = normalizeTableData(previewRows, previewUnit);
  if (normalizationResult.normalized) {
    previewRows = normalizationResult.rows as any[];
    console.log('[Normalization] Applied:', normalizationResult.details);
  }

  const qYearsForInsights = extractQueryYearsExpanded(q)
    .map((y) => String(y || "").trim())
    .filter((y) => /^(19\d{2}|20\d{2}|2100)$/.test(y));

  // Build raw data from all years
  let previewRowsAllRaw = previewPayloadByYear
    ? Object.entries(previewPayloadByYear).flatMap(([yy, payload]) => {
        const dd = (payload as any)?.data;
        const rows = Array.isArray(dd?.data) ? dd.data : [];
        return rows.map((r: any) => ({ ...r, __preview_year: yy }));
      })
    : previewRowsRaw.map((r: any) => {
        const yy = String(previewParams?.period || "").trim();
        if (/^(19\d{2}|20\d{2}|2100)$/.test(yy)) return { ...r, __preview_year: yy };
        return r;
      });

  // Normalize multi-year raw data EARLY so all downstream consumers (chart, table) get consistent values
  // This is critical for mixed-scale data like population (2020: 63452, 2024: 124.3)
  console.log('[Normalization Debug] previewRowsAllRaw.length:', previewRowsAllRaw.length, 'previewUnit:', previewUnit, 'previewTitle:', previewTitle?.slice(0, 50));
  if (previewRowsAllRaw.length > 0 && previewUnit) {
    const rawNormalization = normalizeTableData(previewRowsAllRaw as any, previewUnit);
    console.log('[Normalization Debug] Result:', rawNormalization.normalized, rawNormalization.details);
    if (rawNormalization.normalized) {
      previewRowsAllRaw = rawNormalization.rows as any[];
      console.log('[Normalization Multi-Year] Applied:', rawNormalization.details);
    }
  }

  let previewRowsAllGeo = previewRowsAllRaw;
  if (previewGeoNorm && previewGeoKeyCol) {
    const filtered = previewRowsAllRaw.filter((r) => matchesGeoCell((r as any)?.[previewGeoKeyCol], previewGeoNorm));
    if (
      shouldApplyGeoFilter({
        geoNorm: previewGeoNorm,
        filteredLen: filtered.length,
        totalLen: previewRowsAllRaw.length,
        title: String(previewData?.source || previewIndicator || ""),
        columns: previewColumns,
      })
    ) {
      previewRowsAllGeo = filtered;
    }
  }

  const previewRowsAllByTerms =
    previewTerms.length > 0 ? previewRowsAllGeo.filter((r) => rowMatchesTerms(r as any, previewTerms, previewColumns)) : previewRowsAllGeo;

  let previewRowsForInsights = previewTerms.length > 0 && previewRowsAllByTerms.length === 0 ? previewRowsAllGeo : previewRowsAllByTerms;

  // DEBUG
  const debugYearsInRows = new Set(previewRowsForInsights.map((r:any) => r?.__preview_year).filter(Boolean));
  console.log('[Preview DEBUG] previewRowsForInsights.length=', previewRowsForInsights.length, 'uniqueYears=', Array.from(debugYearsInRows), 'qYearsForInsights=', qYearsForInsights);

  const availableYearsForInsights = previewPayloadByYear
    ? Object.keys(previewPayloadByYear)
        .map((y) => String(y || "").trim())
        .filter((y) => /^(19\d{2}|20\d{2}|2100)$/.test(y))
    : [String(previewParams?.period || "").trim()].filter((y) => /^(19\d{2}|20\d{2}|2100)$/.test(y));

  const requestedYearsAvailableForInsights = qYearsForInsights.filter((y) => availableYearsForInsights.includes(y));

  // When user specifies NO years in query (qYearsForInsights.length === 0), keep ALL years for chart series.
  // Only filter to a single year if user specified some years but they're not available.
  const effectiveInsightsYear =
    previewPayloadByYear &&
    previewActiveYear &&
    /^(19\d{2}|20\d{2}|2100)$/.test(String(previewActiveYear).trim()) &&
    qYearsForInsights.length > 0 &&
    requestedYearsAvailableForInsights.length === 0
      ? String(previewActiveYear).trim()
      : null;

  // Only filter to single year if effectiveInsightsYear was set (meaning user wanted specific years but they weren't available)
  if (effectiveInsightsYear) {
    previewRowsForInsights = previewRowsForInsights.filter((r: any) => String(r?.__preview_year || "").trim() === effectiveInsightsYear);
  }

  if (!effectiveInsightsYear && qYearsForInsights.length >= 1 && previewMonthKeyCol) {
    previewRowsForInsights = previewRowsForInsights.filter((r: any) => {
      const yy = String(r?.__preview_year || "").trim();
      if (!yy) return false;
      if (qYearsForInsights.length > 0 && !qYearsForInsights.includes(yy)) return false;
      const allowedMonths = highlightMonthsForYearFromQuery(q, yy);
      if (allowedMonths.length === 0) return true;
      return allowedMonths.some((m) => matchesMonthCell(r?.[previewMonthKeyCol], m));
    });
  }

  // Normalize previewRowsForInsights for consistent data in interpretation
  const insightsNormalization = normalizeTableData(previewRowsForInsights, previewUnit);
  if (insightsNormalization.normalized) {
    previewRowsForInsights = insightsNormalization.rows as any[];
  }

  const insightsSampleRows = useMemo(() => {
    const max = 60;

    if (qYearsForInsights.length === 0 && previewPayloadByYear) {
      const buckets = new Map<string, any[]>();
      for (const r of previewRowsForInsights) {
        const yy = String((r as any)?.__preview_year || "").trim();
        if (!yy) continue;
        const arr = buckets.get(yy) || [];
        arr.push(r);
        buckets.set(yy, arr);
      }
      const years = Array.from(buckets.keys()).filter((y) => /^(19\d{2}|20\d{2}|2100)$/.test(y));
      years.sort((a, b) => Number(a) - Number(b));
      if (years.length === 0) return previewRowsForInsights.slice(0, max);

      const perYear = Math.max(4, Math.floor(max / years.length));
      const out: any[] = [];
      for (const y of years) {
        const rows = buckets.get(y) || [];
        if (rows.length <= perYear) {
          out.push(...rows);
        } else {
          const headCount = Math.min(2, perYear);
          const tailCount = Math.max(0, perYear - headCount);
          out.push(...rows.slice(0, headCount));
          if (tailCount > 0) out.push(...rows.slice(-tailCount));
        }
      }

      if (out.length < max) {
        const need = max - out.length;
        out.push(...previewRowsForInsights.slice(-need));
      }
      return out.slice(0, max);
    }

    return previewRowsForInsights.slice(0, max);
  }, [previewPayloadByYear, previewRowsForInsights, qYearsForInsights.length]);

  const previewMissingPeriodNote = useMemo(() => {
    if (!previewParams) return null;
    if (previewLoading || previewError) return null;

    const requestedYears = extractQueryYearsExpanded(q)
      .map((y) => String(y || "").trim())
      .filter((y) => /^(19\d{2}|20\d{2}|2100)$/.test(y));
    const uniqYears = Array.from(new Set(requestedYears));
    uniqYears.sort((a, b) => Number(a) - Number(b));

    const availableYearsInPayload = previewPayloadByYear
      ? Object.keys(previewPayloadByYear)
          .map((y) => String(y || "").trim())
          .filter((y) => /^(19\d{2}|20\d{2}|2100)$/.test(y))
      : [String(previewParams.period || "").trim()].filter((y) => /^(19\d{2}|20\d{2}|2100)$/.test(y));

    const parts: string[] = [];

    if (uniqYears.length > 1) {
      const missingYears = uniqYears.filter((y) => !availableYearsInPayload.includes(y));
      if (missingYears.length > 0) {
        parts.push(`Periode belum tersedia: ${missingYears.join(", ")}`);
      }
    }

    if (previewMonthKeyCol) {
      const yearsToCheck = (uniqYears.length > 0 ? uniqYears : [String(previewParams.period || "").trim()]).filter((y) =>
        availableYearsInPayload.includes(String(y || "").trim())
      );
      const missingMonthLabels: string[] = [];

      for (const yy of yearsToCheck) {
        if (!/^(19\d{2}|20\d{2}|2100)$/.test(yy)) continue;
        const requestedMonths = highlightMonthsForYearFromQuery(q, yy);
        if (requestedMonths.length === 0) continue;

        const presentMonths = new Set<number>();
        for (const r of previewRowsAllGeo) {
          const ry = String((r as any)?.__preview_year || "").trim();
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
  }, [previewError, previewLoading, previewMonthKeyCol, previewParams, previewPayloadByYear, previewRowsAllGeo, q]);

  const previewNumericColumns = useMemo(() => {
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
      if (c === cols[0]) continue;

      let seen = 0;
      let numeric = 0;
      for (const r of rows.slice(0, 80)) {
        const v = (r as any)?.[c];
        if (v === null || v === undefined || String(v).trim() === "") continue;
        seen++;
        if (formatNumberId(v) !== null) numeric++;
      }
      if (seen > 0 && numeric / seen >= 0.8) out.add(c);
    }
    return out;
  }, [previewColumnsShown, previewRows]);

  const canDownloadQuick = !previewLoading && !previewError && previewColumnsShown.length > 0 && previewRows.length > 0;

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
      const needs = /[\r\n\",]/.test(s);
      const out = s.replace(/\"/g, '""');
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
        const dataOut = previewRows.map((r: any) => {
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
          data: dataOut,
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
        const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
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

  const onPreviewYearClick = async (year: string) => {
    const yy = String(year || "").trim();
    if (!/^(19\d{2}|20\d{2}|2100)$/.test(yy)) return;

    const baseParams = previewParams || previewPendingParams;
    if (!baseParams) return;
    setPreviewNeedsConfirmYear(false);
    setPreviewConfirmYearMessage(null);

    if (previewPayloadByYear && previewPayloadByYear[yy]) {
      setPreviewActiveYear(yy);
      setPreviewPayload(previewPayloadByYear[yy]);
      setPreviewParams((p) => (p ? ({ ...p, period: yy } as any) : p));

      const sp = new URLSearchParams();
      sp.set("source_id", String((previewParams?.source_id || previewPendingParams?.source_id || "").toString()));
      sp.set("period", yy);
      const t = String(previewParams?.type || previewPendingParams?.type || "").trim();
      if (t) sp.set("type", t);
      setPreviewLink(`/data?${sp.toString()}`);
      return;
    }

    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const monthsForYear = highlightMonthsForYearFromQuery(q, yy);
      const nextMonth = monthsForYear.length === 1 ? String(monthsForYear[0]) : "";
      const url = `/api/data-preview?source_id=${encodeURIComponent(baseParams.source_id)}&period=${encodeURIComponent(yy)}${baseParams.type ? `&type=${encodeURIComponent(baseParams.type)}` : ""}${nextMonth ? `&month=${encodeURIComponent(nextMonth)}` : ""}${baseParams.group ? `&group=${encodeURIComponent(baseParams.group)}` : ""}${baseParams.code_hs ? `&code_hs=${encodeURIComponent(baseParams.code_hs)}` : ""}${baseParams.pod ? `&pod=${encodeURIComponent(baseParams.pod)}` : ""}${baseParams.ctr ? `&ctr=${encodeURIComponent(baseParams.ctr)}` : ""}${baseParams.metric ? `&metric=${encodeURIComponent(baseParams.metric)}` : ""}`;
      const res = await fetch(url, { cache: "no-store" });
      const json = (await res.json()) as any;
      if (!res.ok) {
        setPreviewError(typeof json?.message === "string" ? json.message : "Gagal memuat data.");
        return;
      }
      setPreviewPayload(json as DynamicResponse);
      setPreviewGeneratedAt(new Date().toISOString());
      setPreviewActiveYear(yy);
      setPreviewParams({ ...(baseParams as any), period: yy, month: nextMonth } as any);

      const sp = new URLSearchParams();
      sp.set("source_id", String(baseParams.source_id));
      sp.set("period", yy);
      if (baseParams.type) sp.set("type", String(baseParams.type));
      setPreviewLink(`/data?${sp.toString()}`);
    } catch {
      setPreviewError("Gagal memuat data.");
    } finally {
      setPreviewLoading(false);
    }
  };

  // Prefetch interpretation per available year so tab switching is instant and stable.
  useEffect(() => {
    if (!previewPayloadByYear) return;

    const baseParams = previewParams || previewPendingParams;
    if (!baseParams) return;

    const years = Object.keys(previewPayloadByYear)
      .map((y) => String(y || "").trim())
      .filter((y) => /^(19\d{2}|20\d{2}|2100)$/.test(y));
    if (years.length === 0) return;

    const availableYears = Array.from(new Set(years)).sort((a, b) => Number(a) - Number(b));
    const previewSource = String(previewPayload?.data?.source || previewIndicator || "").trim();
    const previewType = String(baseParams.type || "dynamic").trim().toLowerCase();

    const buildDatasetKey = (d: any) => {
      const periods = Array.isArray(d.periods)
        ? d.periods
            .map((p: any) => String(p || "").trim())
            .filter(Boolean)
            .sort((a: string, b: string) => {
              const na = Number(a);
              const nb = Number(b);
              if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
              return a.localeCompare(b);
            })
        : [];
      const period = String(d.period || "").trim();
      return JSON.stringify({
        source_id: String(d.source_id ?? "").trim(),
        type: String(d.type || "").trim().toLowerCase(),
        period,
        periods,
        month: d.month ?? null,
        geo: String(d.geo || "").trim().toLowerCase(),
        group: String(d.group || "").trim().toLowerCase(),
        code_hs: String(d.code_hs || "").trim().toLowerCase(),
        pod: String(d.pod || "").trim().toLowerCase(),
        ctr: String(d.ctr || "").trim().toLowerCase(),
        metric: String(d.metric || "").trim().toLowerCase(),
      });
    };

    const buildRequestKey = (qq: string, datasetKey: string) =>
      JSON.stringify({
        q: String(qq || "").trim(),
        datasetKey,
        source: String(previewSource || "").trim(),
        type: String(previewType || "").trim().toLowerCase(),
      });

    let cancelled = false;
    const prefetch = async () => {
      let idx = 0;
      const workerCount = Math.max(1, Math.min(2, availableYears.length));

      const fetchOne = async (y: string) => {
        const monthsForYear = highlightMonthsForYearFromQuery(q, y);
        const month = monthsForYear.length === 1 ? String(monthsForYear[0]) : null;

        const dataset = {
          source_id: baseParams.source_id,
          type: String(baseParams.type || "dynamic"),
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

        const res = await fetch("/api/insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            q,
            dataset,
            preview: {
              source: previewSource,
              period: y,
              last_update: null,
              type: String(baseParams.type || "dynamic"),
              geo: baseParams.geo ? String(baseParams.geo) : undefined,
              month: month ? Number(month) : null,
              availableYears,
              columns: [],
              sampleRows: [],
            },
          }),
        });
        const json = (await res.json()) as InsightResponse;
        if (cancelled) return;
        insightsCacheRef.current.set(requestKey, json);
      };

      await Promise.all(
        new Array(workerCount).fill(0).map(async () => {
          while (idx < availableYears.length) {
            const y = availableYears[idx++];
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

  if (loadingSearch) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900 sm:p-6">
        <LoadingProgressBar label="Memuat hasil cepat" variant="simulated" />
      </div>
    );
  }

  if (!previewParams) {
    if (previewNeedsConfirmYear && previewAvailableYears.length > 0) {
      return (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900 sm:p-6">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-white/90">Hasil Cepat • Data Statistik</h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
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
      );
    }

    if (!previewUnavailable) return null;
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900 sm:p-6">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-white/90">Hasil Cepat • Data Statistik</h2>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{previewUnavailable}</p>
      </div>
    );
  }

  // No limit - show all rows in preview table
  const previewRowsTable = Array.isArray(previewRows) ? previewRows : [];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-800 dark:text-white/90">Hasil Cepat • Data Statistik</h2>
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
              {previewData?.unit ? (
                <>
                  {" "}• Satuan: <span className="font-medium text-gray-800 dark:text-white/90">{previewData.unit}</span>
                </>
              ) : null}
            </p>
            {previewMissingPeriodNote ? <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{previewMissingPeriodNote}</p> : null}
          </div>

          <div className="flex items-center gap-2">
            {previewLink ? (
              <Link
                href={previewLink}
                className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-white/[0.05]"
              >
                Buka halaman data
              </Link>
            ) : null}

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
          </div>
        </div>

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

        <div className="mt-4">
          {previewLoading ? (
            <LoadingProgressBar label="Memuat hasil cepat" variant="simulated" />
          ) : previewError ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">{previewError}</p>
          ) : previewColumnsShown.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Format data tidak didukung.</p>
          ) : previewRowsTable.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Tidak ada data untuk periode yang diminta.</p>
          ) : (
            <div className="max-h-96 overflow-auto rounded-2xl border border-gray-200 dark:border-gray-800">
              <table className="min-w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-800">
                    {previewColumnsShown.map((c, colIdx) => (
                      <th
                        key={c}
                        className={`px-4 py-3 text-center text-xs font-semibold text-gray-600 dark:text-gray-300 ${
                          colIdx > 0 ? "border-l border-gray-200 dark:border-gray-800" : ""
                        }`}
                      >
                        {String(previewParams?.type || "dynamic").toLowerCase() === "exim" ? eximColumnLabel(c, eximMode) : c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRowsTable.map((r, idx) => {
                    const monthHit =
                      previewMonthsToHighlight.length > 0 && previewMonthKeyCol
                        ? previewMonthsToHighlight.some((m) => matchesMonthCell((r as any)?.[previewMonthKeyCol], m))
                        : false;
                    return (
                      <tr
                        key={idx}
                        className={`border-b border-gray-100 dark:border-gray-800 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50 ${monthHit ? "bg-brand-50/70 dark:bg-brand-500/10" : ""}`}
                      >
                        {previewColumnsShown.map((c, colIdx) => (
                          <td
                            key={c}
                            className={`px-4 py-3 text-gray-800 dark:text-white/90 ${
                              monthHit ? `font-semibold ${c === previewMonthKeyCol ? "border-l-4 border-brand-500 pl-3" : ""}` : ""
                            } ${
                              String(previewParams?.type || "dynamic").toLowerCase() === "exim" && /^(value|netweight)$/i.test(String(c).trim())
                                ? "text-right"
                                : ""
                            } ${
                              String(previewParams?.type || "dynamic").toLowerCase() !== "exim" && previewNumericColumns.has(c) ? "text-right" : ""
                            } ${colIdx > 0 && !(monthHit && c === previewMonthKeyCol) ? "border-l border-gray-100 dark:border-gray-800" : ""}`}
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

          {!previewLoading && !previewError && previewColumnsShown.length > 0 && previewRowsTable.length > 0 ? (
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
      </div>

      {!tableOnly && !previewLoading && previewParams && !previewError && previewColumnsShown.length > 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-gray-800 dark:text-white/90">Interpretasi & Grafik</h2>
          </div>

          {previewMissingPeriodNote ? <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{previewMissingPeriodNote}</p> : null}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {previewRowsForInsights.length === 0 ? (
              <div className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-white/90">Interpretasi</h3>
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Tidak ada data untuk periode yang diminta.</p>
              </div>
            ) : (
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
                          period: String(previewParams.period || "").trim(),
                          month: (previewParams as any).month ?? null,
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
                    period: previewData?.period || String(previewParams?.period || ""),
                    last_update: previewData?.last_update || null,
                    type: String(previewParams?.type || "dynamic"),
                    geo: previewGeoApplied ? previewGeo : undefined,
                    month: typeof previewPrimaryMonth === "number" ? previewPrimaryMonth : null,
                    availableYears: Array.isArray(previewAvailableYears) ? previewAvailableYears : [],
                    columns: previewColumnsShown,
                    sampleRows: insightsSampleRows,
                  }}
                />
                )}
              </div>
            )}

            {previewRowsForInsights.length === 0 ? (
              <div className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-white/90">Grafik</h3>
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Tidak ada data untuk periode yang diminta.</p>
              </div>
            ) : (
              <div className="min-w-0">
                <SearchInsightsChart
                  rows={previewRowsForInsights}
                  columns={previewColumnsShown}
                  sourceId={previewParams?.source_id ? Number(previewParams.source_id) : undefined}
                  sourceType={(String(previewParams?.type || "dynamic").toLowerCase()) as "dynamic" | "interop" | "exim"}
                  allowFullTimeRange={
                    extractQueryYearsExpanded(q)
                      .map((y) => String(y || '').trim())
                      .filter((y) => /^(19\d{2}|20\d{2}|2100)$/.test(y)).length === 0
                  }
                />
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
