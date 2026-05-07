import { NextRequest } from "next/server";
import { inferEximGroupFromQuery } from "@/lib/eximQueryIntent";
import { ensureDataLinkQuery, ensureDataLinkType, upsertParam } from "@/lib/dataLink";
import { extractGeoFromQuery } from "@/lib/geoIntent";
import { expandBpsKeywordVariants } from "@/lib/bpsKeyword";

type ChartConfig = {
  chart_type?: 'line' | 'bar';
  period_type?: 'monthly' | 'quarterly' | 'yearly' | 'unknown';
  data_type?: 'simple' | 'geo' | 'geo-categorical' | 'categorical';
  facet_column?: string | null;
  available_metrics?: string[];
  default_metric?: string | null;
  has_geo_dimension?: boolean;
  has_facet_dimension?: boolean;
  year_range?: { min?: number | null; max?: number | null };
};

type DatasourceHit = {
  id: number;
  name: string;
  type: string;
  category: string | null;
  score?: number;
  periodHit?: boolean;
  chart_config?: ChartConfig | string | null;
  unit?: string | null;
};

type PublicationHit = {
  pub_id: string;
  title: string;
  rl_date?: string;
  cover?: string;
};

type BrsHit = {
  brs_id: number;
  title: string;
  rl_date?: string;
  thumbnail?: string;
};

type KnowledgeItem = {
  id: number;
  title: string;
  content: string;
  category: string | null;
  similarity: number;
};

type SearchResponse = {
  q: string;
  // Backward-compatible flat lists (dropdown)
  datasources: Array<{ id: number; title: string; subtitle?: string; link: string; chart_config?: ChartConfig | string | null; unit?: string | null }>;
  publications: Array<{ id: string; title: string; subtitle?: string; link: string; thumbnail?: string }>;
  brs: Array<{ id: number; title: string; subtitle?: string; link: string; thumbnail?: string }>;
  knowledge: KnowledgeItem[];
  // New: split into exact + suggestions
  exact: {
    datasources: Array<{ id: number; title: string; subtitle?: string; link: string; score: number; chart_config?: ChartConfig | string | null; unit?: string | null }>;
    publications: Array<{ id: string; title: string; subtitle?: string; link: string; score: number; thumbnail?: string }>;
    brs: Array<{ id: number; title: string; subtitle?: string; link: string; score: number; thumbnail?: string }>;
  };
  suggestions: {
    datasources: Array<{ id: number; title: string; subtitle?: string; link: string; score: number; chart_config?: ChartConfig | string | null; unit?: string | null }>;
    publications: Array<{ id: string; title: string; subtitle?: string; link: string; score: number; thumbnail?: string }>;
    brs: Array<{ id: number; title: string; subtitle?: string; link: string; score: number; thumbnail?: string }>;
  };
};

type FavoritesResponse = {
  items?: Array<{ id: number; name: string; type: string; category: string | null; search_count?: number }>;
};

type SearchIntentResponse = {
  ok: boolean;
  query?: string;
  query_builder?: unknown;
  datasource?: {
    source_id: number | null;
    strategy?: string;
    periodExists?: boolean | null;
  };
  plan?: {
    action: "deeplink" | "search";
    href: string;
    reason?: string;
  };
  candidates?: {
    items?: DatasourceHit[];
  };
};

function getApiKey() {
  return (
    process.env.BPS_API_KEY ||
    process.env.NEXT_PUBLIC_BPS_API_KEY ||
    "e5d1be11320576d466bdeb2f7f210387"
  );
}

function backendBaseUrl() {
  // Prefer explicit env, fall back to local backend port.
  return (
    process.env.BACKEND_BASE_URL ||
    process.env.BACKEND_INTERNAL_API_URL ||
    process.env.INTERNAL_BACKEND_API_URL ||
    process.env.BACKEND_API_URL ||
    process.env.NEXT_PUBLIC_BACKEND_API_URL ||
    "http://127.0.0.1:5000"
  );
}

async function tryJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return null;
  }
  if (!res.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function norm(input: string) {
  return String(input || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function inferExplicitEximMetric(q: string): '' | 'value' | 'netweight' {
  const raw = norm(q);
  if (!raw) return '';
  const hasNilai = /\b(nilai|value)\b/i.test(raw);
  const hasVolume = /\b(volume|berat|netweight)\b/i.test(raw);
  if (hasNilai && !hasVolume) return 'value';
  if (hasVolume && !hasNilai) return 'netweight';
  return '';
}

function extractKeywords(q: string) {
  const nq = norm(q);
  const monthMap: Record<string, number> = {
    januari: 1,
    februari: 2,
    maret: 3,
    april: 4,
    mei: 5,
    juni: 6,
    juli: 7,
    agustus: 8,
    september: 9,
    oktober: 10,
    november: 11,
    desember: 12,
  };

  // For BRS/publication keyword search, EXIM queries often include facets (negara/pelabuhan/hs)
  // that make the keyword too specific and return empty results. Build a "core" topic by
  // stripping EXIM jargon/facets while still keeping the original topic as a fallback.
  const isEximLike = /\b(ekspor|impor|hs2|hs|kodehs|kode\s*hs|komoditas|pelabuhan|negara)\b/i.test(nq);
  const stripped = isEximLike
    ? nq
        .replace(/\bnegara\s+[a-z]+(?:\s+[a-z]+)?(?:\s+[a-z]+)?\b/gi, " ")
        .replace(/\bpelabuhan\s+[a-z]+(?:\s+[a-z]+)?(?:\s+[a-z]+)?\b/gi, " ")
        .replace(/\b(komoditas|hs2|hs|kodehs|kode\s*hs)\s*[0-9]{1,6}\b/gi, " ")
        .replace(/\b(komoditas|hs2|hs|kodehs|kode\s*hs)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
    : nq;

  const tokens = stripped.split(" ").filter(Boolean);
  const monthNames = new Set(Object.keys(monthMap));
  const stopwords = new Set([
    "bulan",
    "tahun",
    "triwulan",
    "kuartal",
    "di",
    "pada",
    "untuk",
    "dan",
    // EXIM jargon/facets (keep them out of keyword queries)
    "ekspor",
    "impor",
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
  ]);
  const topic = tokens
    .filter((t) => t.length >= 2)
    .filter((t) => !stopwords.has(t))
    .filter((t) => !monthNames.has(t))
    .filter((t) => !/^\d+$/.test(t))
    .join(" ")
    .trim();

  const variants = new Set<string>();
  if (topic) variants.add(topic);

  // Also include the original (unstripped) topic as a fallback variant.
  const tokensRaw = nq.split(" ").filter(Boolean);
  const topicRaw = tokensRaw
    .filter((t) => t.length >= 2)
    .filter((t) => !stopwords.has(t))
    .filter((t) => !monthNames.has(t))
    .filter((t) => !/^\d+$/.test(t))
    .join(" ")
    .trim();
  if (topicRaw && topicRaw !== topic) variants.add(topicRaw);

  // If this looks like an EXIM query and the remaining topic is too "facet-like"
  // (often just a country name), add generic trade keywords so BRS/pubs don't go empty.
  const isFacetOnly = isEximLike && (!topic || topic.split(' ').length <= 1);
  if (isFacetOnly) {
    variants.add('perdagangan luar negeri');
    if (nq.includes('ekspor')) variants.add('ekspor');
    if (nq.includes('impor')) variants.add('impor');
  }

  const hasInflasi = nq.includes("inflasi");
  const hasIhk = nq.includes("ihk") || nq.includes("indeks harga konsumen") || topic.includes("ihk") || topic.includes("indeks harga konsumen");
  if (hasInflasi || hasIhk) {
    variants.add("inflasi");
    variants.add("ihk");
    variants.add("indeks harga konsumen");
  }

  const hasTpk = nq.includes("tpk") || topic.includes("tpk");
  if (hasTpk) {
    variants.add("tpk");
    variants.add("tingkat penghunian kamar");
  }

  const hasNtp = nq.includes("ntp") || topic.includes("ntp") || nq.includes("nilai tukar petani") || topic.includes("nilai tukar petani");
  if (hasNtp) {
    variants.add("ntp");
    variants.add("nilai tukar petani");
  }

  const keywordVariants = Array.from(variants)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)
    .slice(0, 3);

  return {
    topic: topic || nq,
    keywordVariants,
  };
}

function extractEximFacetStrings(q: string): { ctr?: string; pod?: string } {
  const raw = norm(q);
  if (!raw) return {};
  const tokens = raw.split(' ').filter(Boolean);

  const monthNames = new Set([
    'januari','jan','februari','feb','maret','mar','april','apr','mei','juni','jun','juli','jul',
    'agustus','agu','ags','september','sep','oktober','okt','november','nov','desember','des'
  ]);

  const stop = new Set([
    'negara',
    'pelabuhan',
    'komoditas',
    'hs',
    'hs2',
    'kode',
    'kodehs',
    'nilai',
    'volume',
    'berat',
    // Range / time separators
    '-',
    '–',
    '—',
    'bulan',
    'tahun',
    'dan',
    'sampai',
    'sd',
    's/d',
    'hingga',
    'to',
  ]);

  const takeAfter = (key: string) => {
    const idx = tokens.indexOf(key);
    if (idx < 0) return '';
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
    return out.join(' ').trim();
  };

  const ctr = takeAfter('negara');
  const pod = takeAfter('pelabuhan');
  const res: { ctr?: string; pod?: string } = {};
  if (ctr) res.ctr = ctr;
  if (pod) res.pod = pod;
  return res;
}

function extractEximCommodityTerm(q: string) {
  const raw = norm(q);
  if (!raw) return '';

  const monthNames = new Set([
    'januari','jan','februari','feb','maret','mar','april','apr','mei','juni','jun','juli','jul',
    'agustus','agu','ags','september','sep','oktober','okt','november','nov','desember','des'
  ]);

  // Remove facet phrases first.
  const stripped = raw
    .replace(/\bnegara\s+[a-z]+(?:\s+[a-z]+){0,2}\b/gi, ' ')
    .replace(/\bpelabuhan\s+[a-z]+(?:\s+[a-z]+){0,2}\b/gi, ' ')
    .replace(/\b(komoditas|hs2|hs|kodehs|kode\s*hs)\s*[0-9]{1,6}\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const stop = new Set([
    'ekspor','impor','negara','pelabuhan','komoditas','hs','hs2','kode','kodehs','nilai','volume','berat',
    'bulan','tahun','triwulan','kuartal','di','pada','untuk','dan','sampai','sd','s/d','hingga','to'
  ]);

  const tokens = stripped
    .split(' ')
    .filter(Boolean)
    .filter((t) => t.length >= 2)
    .filter((t) => !stop.has(t))
    .filter((t) => !monthNames.has(t))
    .filter((t) => !/^\d+$/.test(t));

  return tokens.slice(0, 3).join(' ').trim();
}

function extractYearMonthFromQuery(q: string): { year: number | null; month: number | null } {
  const nq = norm(q);

  const yearMatch = nq.match(/\b(19\d{2}|20\d{2}|2100)\b/);
  const year = yearMatch ? Number(yearMatch[1]) : null;

  const monthMap: Record<string, number> = {
    januari: 1,
    februari: 2,
    maret: 3,
    april: 4,
    mei: 5,
    juni: 6,
    juli: 7,
    agustus: 8,
    september: 9,
    oktober: 10,
    november: 11,
    desember: 12,
  };
  const monthNameMatch = nq.match(/\b(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\b/);
  const month = monthNameMatch ? monthMap[monthNameMatch[1]] : null;

  return {
    year: Number.isInteger(year) ? year : null,
    month: Number.isInteger(month) ? month : null,
  };
}

function extractPeriodTargetsFromQuery(q: string): { months: number[]; years: number[] } {
  const nq = norm(q);
  if (!nq) return { months: [], years: [] };

  const months = new Set<number>();
  const years = new Set<number>();

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

  function addMonthYear(year: number, month: number) {
    if (!Number.isInteger(year) || year < 1900 || year > 2100) return;
    if (!Number.isInteger(month) || month < 1 || month > 12) return;
    years.add(year);
    months.add(year * 12 + (month - 1));
  }

  function addYear(year: number) {
    if (!Number.isInteger(year) || year < 1900 || year > 2100) return;
    years.add(year);
  }

  function expandMonthRange(y1: number, m1: number, y2: number, m2: number) {
    if (!Number.isInteger(y1) || !Number.isInteger(y2) || !Number.isInteger(m1) || !Number.isInteger(m2)) return;
    if (m1 < 1 || m1 > 12 || m2 < 1 || m2 > 12) return;
    if (y1 < 1900 || y1 > 2100 || y2 < 1900 || y2 > 2100) return;
    const start = y1 * 12 + (m1 - 1);
    const end = y2 * 12 + (m2 - 1);
    const step = start <= end ? 1 : -1;
    const span = Math.abs(end - start) + 1;
    const max = Math.min(span, 72);
    for (let i = 0; i < max; i++) {
      const idx = start + i * step;
      const y = Math.floor(idx / 12);
      const mo = (idx % 12) + 1;
      addMonthYear(y, mo);
    }
  }

  const monthToken = '(?:januari|jan|februari|feb|maret|mar|april|apr|mei|juni|jun|juli|jul|agustus|agu|ags|september|sep|oktober|okt|november|nov|desember|des)';
  const monthCap = `(${monthToken})`;
  const yearToken = '(?:19\\d{2}|20\\d{2}|2100)';
  const yearCap = `(${yearToken})`;
  const rangeSep = '(?:-|–|—|sampai|sd|s\\/d|hingga|to)';

  // Range: month-month same year (e.g. "feb-apr 2024")
  const reSameYearRange = new RegExp(`\\b${monthCap}\\b\\s*${rangeSep}\\s*\\b${monthCap}\\b\\s*\\b${yearCap}\\b`, 'g');
  for (const m of nq.matchAll(reSameYearRange)) {
    const m1 = monthMap[String(m[1] || '')];
    const m2 = monthMap[String(m[2] || '')];
    const y = Number(m[3]);
    if (Number.isInteger(y) && Number.isInteger(m1) && Number.isInteger(m2)) {
      expandMonthRange(y, m1, y, m2);
    }
  }

  // Range: month year -> month year (e.g. "feb 2024 - apr 2024")
  const reFullRange = new RegExp(`\\b${monthCap}\\b\\s*\\b${yearCap}\\b\\s*${rangeSep}\\s*\\b${monthCap}\\b\\s*\\b${yearCap}\\b`, 'g');
  for (const m of nq.matchAll(reFullRange)) {
    const m1 = monthMap[String(m[1] || '')];
    const y1 = Number(m[2]);
    const m2 = monthMap[String(m[3] || '')];
    const y2 = Number(m[4]);
    if (Number.isInteger(y1) && Number.isInteger(y2) && Number.isInteger(m1) && Number.isInteger(m2)) {
      expandMonthRange(y1, m1, y2, m2);
    }
  }

  // Range: YYYY-MM -> YYYY-MM
  const reYmRange = new RegExp(`\\b${yearCap}\\s*[-\\/]\\s*(0?[1-9]|1[0-2])\\b\\s*${rangeSep}\\s*\\b${yearCap}\\s*[-\\/]\\s*(0?[1-9]|1[0-2])\\b`, 'g');
  for (const m of nq.matchAll(reYmRange)) {
    const y1 = Number(m[1]);
    const mo1 = Number(m[2]);
    const y2 = Number(m[3]);
    const mo2 = Number(m[4]);
    if (Number.isInteger(y1) && Number.isInteger(y2) && Number.isInteger(mo1) && Number.isInteger(mo2)) {
      expandMonthRange(y1, mo1, y2, mo2);
    }
  }

  // Range: MM-YYYY -> MM-YYYY
  const reMyRange = new RegExp(`\\b(0?[1-9]|1[0-2])\\s*[-\\/]\\s*${yearCap}\\b\\s*${rangeSep}\\s*\\b(0?[1-9]|1[0-2])\\s*[-\\/]\\s*${yearCap}\\b`, 'g');
  for (const m of nq.matchAll(reMyRange)) {
    const mo1 = Number(m[1]);
    const y1 = Number(m[2]);
    const mo2 = Number(m[3]);
    const y2 = Number(m[4]);
    if (Number.isInteger(y1) && Number.isInteger(y2) && Number.isInteger(mo1) && Number.isInteger(mo2)) {
      expandMonthRange(y1, mo1, y2, mo2);
    }
  }

  // Discrete: month year (also catches "feb 2024")
  const reMonthYear = new RegExp(`\\b${monthCap}\\b\\s*\\b${yearCap}\\b`, 'g');
  for (const m of nq.matchAll(reMonthYear)) {
    const mo = monthMap[String(m[1] || '')];
    const y = Number(m[2]);
    if (Number.isInteger(y) && Number.isInteger(mo)) addMonthYear(y, mo);
  }

  // Discrete: YYYY-MM or YYYY/MM
  const reYm = new RegExp(`\\b${yearCap}\\s*[-\\/]\\s*(0?[1-9]|1[0-2])\\b`, 'g');
  for (const m of nq.matchAll(reYm)) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    if (Number.isInteger(y) && Number.isInteger(mo)) addMonthYear(y, mo);
  }

  // Discrete: MM-YYYY or MM/YYYY
  const reMy = new RegExp(`\\b(0?[1-9]|1[0-2])\\s*[-\\/]\\s*${yearCap}\\b`, 'g');
  for (const m of nq.matchAll(reMy)) {
    const mo = Number(m[1]);
    const y = Number(m[2]);
    if (Number.isInteger(y) && Number.isInteger(mo)) addMonthYear(y, mo);
  }

  // Year range (e.g. "2023-2024")
  const reYearRange = new RegExp(`\\b${yearCap}\\b\\s*${rangeSep}\\s*\\b${yearCap}\\b`, 'g');
  for (const m of nq.matchAll(reYearRange)) {
    const y1 = Number(m[1]);
    const y2 = Number(m[2]);
    if (!Number.isInteger(y1) || !Number.isInteger(y2)) continue;
    const step = y1 <= y2 ? 1 : -1;
    const span = Math.abs(y2 - y1) + 1;
    const max = Math.min(span, 20);
    for (let i = 0; i < max; i++) addYear(y1 + i * step);
  }

  // Year mentions (when user only types a year)
  const reYear = new RegExp(`\\b${yearToken}\\b`, 'g');
  for (const m of nq.matchAll(reYear)) {
    const y = Number(m[0]);
    if (Number.isInteger(y)) addYear(y);
  }

  return {
    months: Array.from(months.values()),
    years: Array.from(years.values()),
  };
}

function scoreTitle(q: string, title: string) {
  const nq = norm(q);
  const nt = norm(title);
  if (!nq || !nt) return 0;
  if (nt === nq) return 100;
  if (nt.startsWith(nq)) return 92;
  if (nt.includes(nq)) return 82;
  const terms = nq.split(" ").filter((t) => t.length >= 2);
  if (terms.length > 0 && terms.every((t) => nt.includes(t))) return 74;
  return 55;
}

function scoreTitleHybrid(fullQ: string, topicQ: string, title: string) {
  const s1 = scoreTitle(fullQ, title);
  const s2 = topicQ ? Math.max(0, scoreTitle(topicQ, title) - 10) : 0;
  return Math.max(s1, s2);
}

function splitExact<T extends { score: number }>(items: T[]) {
  if (items.length === 0) return { exact: [], suggestions: [] };
  const exact = items.filter((x) => x.score >= 92).slice(0, 3);
  const used = new Set(exact.map((x) => (x as any).id));
  const suggestions = items.filter((x) => !used.has((x as any).id)).slice(0, 12);
  return { exact, suggestions };
}

function asInt(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function resolveYearFromQueryAndQb(q: string, qb: any): { yearResolved: number | null; hasYear: boolean } {
  const year = asInt(qb?.params?.year);
  const isValidYear = (y: number | null) => typeof y === 'number' && Number.isInteger(y) && y >= 1900 && y <= 2100;
  const yearFallback = (() => {
    const m = norm(q).match(/\b(19\d{2}|20\d{2}|2100)\b/);
    const y = m ? Number(m[1]) : null;
    return isValidYear(y) ? (y as number) : null;
  })();
  const yearResolved = isValidYear(year) ? (year as number) : yearFallback;
  return { yearResolved, hasYear: isValidYear(yearResolved) };
}

function resolveGeoFromQueryAndQb(q: string, qb: any): string {
  const geoRaw = qb?.params?.geo ? String(qb.params.geo).trim() : '';
  const geoFromText = extractGeoFromQuery(q);
  const geoRawNorm = norm(geoRaw);
  const geoTextNorm = norm(geoFromText);

  // If QB only provides province-level geo but the query text has a more specific kab/kota,
  // prefer the more specific one.
  const geo = (geoRawNorm && geoRawNorm !== 'maluku utara')
    ? geoRaw
    : (geoTextNorm ? geoFromText : geoRaw);

  return String(geo || '').trim();
}

function isProvinceGeoMalukuUtara(geo: string): boolean {
  const g = norm(geo);
  return g === 'maluku utara' || g === 'malut';
}

function indicatesKabKotaDimensionFromText(input: string): boolean {
  const s = norm(input);
  if (!s) return false;
  if (/(kabupaten\s*\/\s*kota|kab\s*\/\s*kota)\b/.test(s)) return true;
  if (/menurut\s+(kabupaten|kab)\s*\/\s*kota\b/.test(s)) return true;
  if (/\bmenurut\s+kabupaten\s*kota\b/.test(s)) return true;
  // Allow the common "kabupaten dan kota" phrasing.
  if (/\bkabupaten\b/.test(s) && /\bkota\b/.test(s)) return true;
  return false;
}

function indicatesKabKotaDimensionFromColumns(columns: unknown): boolean {
  const list = Array.isArray(columns) ? (columns as unknown[]) : [];
  const joined = norm(list.map((c) => String(c || '')).join(' | '));
  if (!joined) return false;
  return indicatesKabKotaDimensionFromText(joined);
}

function monthNoToIdName(monthNo: number | null) {
  const names = [
    "januari",
    "februari",
    "maret",
    "april",
    "mei",
    "juni",
    "juli",
    "agustus",
    "september",
    "oktober",
    "november",
    "desember",
  ];
  if (typeof monthNo !== 'number') return null;
  if (!Number.isInteger(monthNo) || monthNo < 1 || monthNo > 12) return null;
  return names[monthNo - 1];
}

function parseRlDate(input: unknown): { year: number | null; month: number | null } {
  const raw = String(input || '').trim();
  if (!raw) return { year: null, month: null };

  // Common BPS formats: YYYY-MM-DD, YYYY/MM/DD
  const m1 = raw.match(/\b(19\d{2}|20\d{2}|2100)[-\/](\d{1,2})[-\/](\d{1,2})\b/);
  if (m1) {
    const y = Number(m1[1]);
    const mo = Number(m1[2]);
    return {
      year: Number.isInteger(y) ? y : null,
      month: Number.isInteger(mo) && mo >= 1 && mo <= 12 ? mo : null,
    };
  }

  // Fallback: just a year
  const m2 = raw.match(/\b(19\d{2}|20\d{2}|2100)\b/);
  if (m2) {
    const y = Number(m2[1]);
    return { year: Number.isInteger(y) ? y : null, month: null };
  }

  return { year: null, month: null };
}

function parseDateToMs(input: unknown): number | null {
  const raw = String(input || '').trim();
  if (!raw) return null;

  const t = Date.parse(raw);
  if (Number.isFinite(t)) return t;

  // Handle YYYY-MM and YYYY/MM
  const m1 = raw.match(/\b(19\d{2}|20\d{2}|2100)[-\/](\d{1,2})\b/);
  if (m1) {
    const y = Number(m1[1]);
    const mo = Number(m1[2]);
    if (Number.isInteger(y) && Number.isInteger(mo) && mo >= 1 && mo <= 12) {
      const d = new Date(Date.UTC(y, mo - 1, 1));
      return d.getTime();
    }
  }

  // Handle YYYY
  const m2 = raw.match(/\b(19\d{2}|20\d{2}|2100)\b/);
  if (m2) {
    const y = Number(m2[1]);
    if (Number.isInteger(y)) {
      const d = new Date(Date.UTC(y, 0, 1));
      return d.getTime();
    }
  }

  return null;
}

function recencyBonusFromNowMs(ts: number | null): number {
  if (!Number.isFinite(ts as number)) return 0;
  const now = Date.now();
  const ageMs = Math.max(0, now - (ts as number));
  const ageMonths = ageMs / (1000 * 60 * 60 * 24 * 30);
  // Small, bounded bonus so relevance still dominates.
  // 0 months => +10, 6 months => +6, 12 months => +2, older => 0.
  const b = 10 - ageMonths * (8 / 12);
  return Math.max(0, Math.min(10, b));
}

function sortByScoreThenNewest<T extends { score: number; ts?: number | null }>(a: T, b: T) {
  const ds = (b.score - a.score);
  if (ds !== 0) return ds;
  const ta = Number.isFinite(a.ts as number) ? (a.ts as number) : -Infinity;
  const tb = Number.isFinite(b.ts as number) ? (b.ts as number) : -Infinity;
  return tb - ta;
}

function parsePeriodFromTitle(input: unknown): { year: number | null; month: number | null } {
  const raw = String(input || '').toLowerCase();
  if (!raw) return { year: null, month: null };

  const monthMap: Record<string, number> = {
    januari: 1,
    februari: 2,
    maret: 3,
    april: 4,
    mei: 5,
    juni: 6,
    juli: 7,
    agustus: 8,
    september: 9,
    oktober: 10,
    november: 11,
    desember: 12,
  };

  const m = raw.match(/\b(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\b\s*(19\d{2}|20\d{2}|2100)\b/);
  if (!m) return { year: null, month: null };
  const mo = monthMap[m[1]];
  const y = Number(m[2]);
  return {
    year: Number.isInteger(y) ? y : null,
    month: Number.isInteger(mo) ? mo : null,
  };
}

function periodRelevanceBonusFromPeriod(args: {
  itemYear: number | null;
  itemMonth: number | null;
  queryYear: number | null;
  queryMonth: number | null;
  hasYear: boolean;
}) {
  if (!args.hasYear || !Number.isInteger(args.queryYear)) return 0;
  if (!Number.isInteger(args.itemYear)) return -5;

  const iy = args.itemYear as number;
  const dy = Math.abs(iy - (args.queryYear as number));
  if (dy === 0) {
    let bonus = 20;
    if (Number.isInteger(args.queryMonth) && Number.isInteger(args.itemMonth)) {
      const im = args.itemMonth as number;
      const dm = Math.abs(im - (args.queryMonth as number));
      if (dm === 0) bonus += 110;
      else bonus += Math.max(-80, 10 - dm * 25);
    }
    return bonus;
  }

  return -40 - Math.min(80, dy * 20);
}

function periodRelevanceBonusFromTargets(args: {
  itemYear: number | null;
  itemMonth: number | null;
  targetsMonths: number[];
  targetsYears: number[];
}) {
  const hasTargets = args.targetsMonths.length > 0 || args.targetsYears.length > 0;
  if (!hasTargets) return 0;
  if (!Number.isInteger(args.itemYear)) return -5;

  const iy = args.itemYear as number;

  if (Number.isInteger(args.itemMonth) && args.targetsMonths.length > 0) {
    const im = args.itemMonth as number;
    const itemIdx = iy * 12 + (im - 1);
    let minDist = Infinity;
    for (const t of args.targetsMonths) {
      const d = Math.abs(t - itemIdx);
      if (d < minDist) minDist = d;
      if (minDist === 0) break;
    }
    const base = 20;
    if (minDist === 0) return base + 110;
    return base + Math.max(-80, 10 - minDist * 25);
  }

  const yearCandidates = new Set<number>();
  for (const y of args.targetsYears) if (Number.isInteger(y)) yearCandidates.add(y);
  if (yearCandidates.size === 0 && args.targetsMonths.length > 0) {
    for (const mi of args.targetsMonths) {
      const y = Math.floor(mi / 12);
      if (Number.isInteger(y)) yearCandidates.add(y);
    }
  }

  if (yearCandidates.size === 0) return 0;

  let minDy = Infinity;
  for (const y of yearCandidates.values()) {
    const dy = Math.abs(iy - y);
    if (dy < minDy) minDy = dy;
    if (minDy === 0) break;
  }

  if (minDy === 0) return 20;
  return -40 - Math.min(80, minDy * 20);
}

function periodRelevanceBonus(args: {
  rl_date?: unknown;
  queryYear: number | null;
  queryMonth: number | null;
  hasYear: boolean;
}) {
  if (!args.hasYear || !Number.isInteger(args.queryYear)) return 0;
  const parsed = parseRlDate(args.rl_date);
  return periodRelevanceBonusFromPeriod({
    itemYear: parsed.year,
    itemMonth: parsed.month,
    queryYear: args.queryYear,
    queryMonth: args.queryMonth,
    hasYear: args.hasYear,
  });
}

function buildSubtitle(args: {
  category: string | null;
  typeNorm: string;
  periodHit?: boolean;
  qb: any;
  isPrimary: boolean;
  q: string;
}) {
  const category = args.category || "Data Statistik";
  const typeNorm = String(args.typeNorm || '').toLowerCase();
  const qb = args.qb || null;
  const q = String(args.q || '');

  const intent = String(qb?.intent || '').toLowerCase();
  const yearQb = asInt(qb?.params?.year);
  const month = asInt(qb?.params?.month);
  const monthName = monthNoToIdName(month);

  const isValidYear = (y: number | null) => typeof y === 'number' && Number.isInteger(y) && y >= 1900 && y <= 2100;
  const yearFallback = (() => {
    const m = norm(q).match(/\b(19\d{2}|20\d{2}|2100)\b/);
    const y = m ? Number(m[1]) : null;
    return isValidYear(y) ? (y as number) : null;
  })();
  const yearResolved = isValidYear(yearQb) ? (yearQb as number) : yearFallback;

  // Subtitle should reflect the user's query year even when intent isn't classified as "data".
  const hasYear = isValidYear(yearResolved);
  const hasMonth = hasYear && Number.isInteger(month) && month! >= 1 && month! <= 12;

  if (!hasYear && (typeNorm === 'dynamic' || typeNorm === 'exim')) {
    return `${category} • tambahkan tahun (mis. 2025)`;
  }

  const periodLabel = hasYear
    ? hasMonth && monthName
      ? `${monthName} ${yearResolved}`
      : String(yearResolved)
    : null;

  if (typeNorm === 'exim' && hasYear) {
    const parts: string[] = [category];
    if (periodLabel) parts.push(periodLabel);

    // Only show detailed intent facets for the chosen datasource.
    if (args.isPrimary) {
      const direction = String(qb?.params?.direction || '').toLowerCase();
      const metric = String(qb?.params?.metric || '').toLowerCase();
      const group = String(qb?.params?.group || '').toLowerCase();
      const code_hs_raw = String(qb?.params?.code_hs || '').trim();
      const code_hs = code_hs_raw.replace(/\D/g, '').slice(0, 2);

      if (direction === 'impor') parts.push('impor');
      else if (direction === 'ekspor') parts.push('ekspor');

      if (metric === 'netweight') parts.push('berat');
      else if (metric === 'value') parts.push('nilai');

      if (group === 'hs2') parts.push('hs2');
      if (code_hs.length === 2) parts.push(`hs ${code_hs}`);
    }

    return parts.join(' • ');
  }

  if ((typeNorm === 'dynamic' || typeNorm === 'interop') && hasYear) {
    return periodLabel ? `${category} • ${periodLabel}` : category;
  }

  if (typeNorm === 'static') return category;
  if (typeNorm === 'pressrelease') return category;

  if (args.periodHit) {
    return `${category} • periode cocok${periodLabel ? ` (${periodLabel})` : ''}`;
  }
  return category;
}

function buildDatasourceLink(args: {
  dsId: number;
  dsType: string;
  dsName?: string;
  forceGeo?: boolean;
  q: string;
  intent: SearchIntentResponse | null;
}) {
  const { dsId, dsType, dsName, q, intent } = args;
  const plan = intent?.plan;
  const qb: any = intent?.query_builder || null;

  const monthQb = asInt(qb?.params?.month);
  const { yearResolved, hasYear } = resolveYearFromQueryAndQb(q, qb);
  const isDataIntent = String(qb?.intent || '').toLowerCase() === 'data';

  // Only include `month` in deeplinks when the query targets exactly one month for the resolved year.
  // This avoids broken links for ranges like "mei 2024 - maret 2025".
  let month: number | null = null;
  if (hasYear) {
    const targets = extractPeriodTargetsFromQuery(q);
    const monthsForYear = new Set<number>();
    for (const idx of targets.months) {
      const y = Math.floor(idx / 12);
      const mo = (idx % 12) + 1;
      if (y === yearResolved) monthsForYear.add(mo);
    }
    if (monthsForYear.size === 1) month = Array.from(monthsForYear)[0];
    else if (monthsForYear.size > 1) month = null;
    else month = monthQb;
  } else {
    month = monthQb;
  }

  const qParam = q ? `&q=${encodeURIComponent(q)}` : '';

  const geo = resolveGeoFromQueryAndQb(q, qb);
  const t = String(dsType || '').toLowerCase();

  const shouldAttachGeo = (() => {
    if (!geo) return false;
    if (t === 'static' || t === 'pressrelease' || t === 'exim') return false;
    // Guardrail: province-level "maluku utara" geo collapses kab/kota breakdown tables.
    // Only attach geo when it is a specific kab/kota (e.g. Ternate), not the province.
    if (isProvinceGeoMalukuUtara(geo)) return false;
    // Attach geo only when the datasource likely has a *filterable* wilayah dimension (kab/kota),
    // or when the caller proved it via columns.
    if (args.forceGeo === true) return true;
    const nameNorm = norm(String(dsName || ''));
    if (!nameNorm) return false;

    return indicatesKabKotaDimensionFromText(nameNorm);
  })();

  const patchEximHref = (href: string) => {
    try {
      if (!href || typeof href !== 'string' || !href.startsWith('/data?')) return href;
      const qs = href.slice('/data?'.length);
      const sp = new URLSearchParams(qs);
      sp.set('type', 'exim');

       // Repair invalid/placeholder period values from upstream plans (e.g. period=0)
       if (hasYear) {
         const pRaw = sp.get('period');
         const p = pRaw ? Number(pRaw) : null;
         if (!Number.isInteger(p) || (p as number) < 1900 || (p as number) > 2100) {
           sp.set('period', String(yearResolved));
         }
       }

      const metricSafe = inferExplicitEximMetric(q);
      const groupRaw = String(qb?.params?.group || '').toLowerCase();
      const group =
        groupRaw === 'hs2' ? 'hs2'
        : groupRaw === 'pod' ? 'pod'
        : groupRaw === 'ctr' ? 'ctr'
        : groupRaw === 'detail' ? 'detail'
        : groupRaw === 'hs2ctr' ? 'hs2ctr'
        : groupRaw === 'hs2pod' ? 'hs2pod'
        : '';
      const inferredGroup = inferEximGroupFromQuery(q);
      // Prefer explicit query phrasing over upstream group guesses.
      const desiredGroup = inferredGroup || group;
      const code_hs_raw = String(qb?.params?.code_hs || '').trim();
      const code_hs = code_hs_raw.replace(/\D/g, '').slice(0, 2);
      const pod = qb?.params?.pod ? String(qb.params.pod).trim() : '';
      const ctr = qb?.params?.ctr ? String(qb.params.ctr).trim() : '';

      if (metricSafe && !sp.get('metric')) sp.set('metric', metricSafe);
      // IMPORTANT: explicit query phrasing must override backend plan's group.
      if (desiredGroup) sp.set('group', desiredGroup);
      if (code_hs.length === 2 && !sp.get('code_hs')) sp.set('code_hs', code_hs);
      if (pod && !sp.get('pod')) sp.set('pod', pod);
      if (ctr && !sp.get('ctr')) sp.set('ctr', ctr);
      if (typeof month === 'number' && month >= 1 && month <= 12 && !sp.get('month')) sp.set('month', String(month));

      return `/data?${sp.toString()}`;
    } catch {
      return href;
    }
  };

  // If the query doesn't include a year yet, still open the data page and let it
  // render year tabs + pick a default year.
  if (!isDataIntent || !hasYear) {
    if (t === 'pressrelease') return '/brs';

    const sp = new URLSearchParams();
    sp.set('source_id', String(dsId));
    if (t === 'exim') {
      sp.set('type', 'exim');

      // If we can confidently resolve a year, include it (even when intent isn't "data").
      if (hasYear) sp.set('period', String(yearResolved));

      const metricSafe = inferExplicitEximMetric(q);
      if (metricSafe) sp.set('metric', metricSafe);

      const groupRaw = String(qb?.params?.group || '').toLowerCase();
      const group =
        groupRaw === 'hs2' ? 'hs2'
        : groupRaw === 'pod' ? 'pod'
        : groupRaw === 'ctr' ? 'ctr'
        : groupRaw === 'detail' ? 'detail'
        : groupRaw === 'hs2ctr' ? 'hs2ctr'
        : groupRaw === 'hs2pod' ? 'hs2pod'
        : '';
      const inferredGroup = inferEximGroupFromQuery(q);
      const desiredGroup = inferredGroup || group;
      if (desiredGroup) sp.set('group', desiredGroup);

      const code_hs_raw = String(qb?.params?.code_hs || '').trim();
      const code_hs = code_hs_raw.replace(/\D/g, '').slice(0, 2);
      if (code_hs.length === 2) sp.set('code_hs', code_hs);

      const pod = qb?.params?.pod ? String(qb.params.pod).trim() : '';
      const ctr = qb?.params?.ctr ? String(qb.params.ctr).trim() : '';
      if (pod) sp.set('pod', pod);
      if (ctr) sp.set('ctr', ctr);

      if (typeof month === 'number' && month >= 1 && month <= 12) sp.set('month', String(month));
    } else {
      // non-EXIM deeplinks (dynamic/interop/static)
      if (t === 'interop') sp.set('type', 'interop');
      else if (t === 'static') sp.set('type', 'static');
      else sp.set('type', 'dynamic');

      if (shouldAttachGeo) sp.set('geo', geo);

      // If we resolved a year from the query text, keep it in the link.
      if (hasYear && t !== 'static') {
        sp.set('period', String(yearResolved));
        if (typeof month === 'number' && month >= 1 && month <= 12) sp.set('month', String(month));
      }
    }

    const href = `/data?${sp.toString()}`;
    return qParam ? `${href}${qParam}` : href;
  }

  // Ensure the top chosen datasource uses the backend-computed plan href.
  if (plan?.action === 'deeplink' && intent?.datasource?.source_id === dsId && plan.href) {
    const href = String(plan.href);
    if (t === 'exim') return patchEximHref(href);
    if (t === 'pressrelease') return '/brs';
    const typeWanted = t === 'interop' ? 'interop' : t === 'static' ? 'static' : 'dynamic';
    const withType = ensureDataLinkType(href, typeWanted);
    const withGeo = shouldAttachGeo ? upsertParam(withType, 'geo', geo) : withType;
    return ensureDataLinkQuery(withGeo, q);
  }

  if (t === 'exim') {
    const metricSafe = inferExplicitEximMetric(q);
    const groupRaw = String(qb?.params?.group || '').toLowerCase();
    const group =
      groupRaw === 'hs2' ? 'hs2'
      : groupRaw === 'pod' ? 'pod'
      : groupRaw === 'ctr' ? 'ctr'
      : groupRaw === 'detail' ? 'detail'
      : groupRaw === 'hs2ctr' ? 'hs2ctr'
      : groupRaw === 'hs2pod' ? 'hs2pod'
      : '';
    const inferredGroup = inferEximGroupFromQuery(q);
    // Prefer explicit query phrasing over upstream group guesses.
    const desiredGroup = inferredGroup || group;
    const code_hs_raw = String(qb?.params?.code_hs || '').trim();
    const code_hs = code_hs_raw.replace(/\D/g, '').slice(0, 2);
    const pod = qb?.params?.pod ? String(qb.params.pod).trim() : '';
    const ctr = qb?.params?.ctr ? String(qb.params.ctr).trim() : '';

    const sp = new URLSearchParams();
    sp.set('source_id', String(dsId));
    sp.set('type', 'exim');
    sp.set('period', String(yearResolved));
    if (metricSafe) sp.set('metric', metricSafe);
    if (typeof month === 'number' && month >= 1 && month <= 12) sp.set('month', String(month));
    if (desiredGroup) sp.set('group', desiredGroup);
    if (code_hs.length === 2) sp.set('code_hs', code_hs);
    if (pod) sp.set('pod', pod);
    if (ctr) sp.set('ctr', ctr);
    const href = `/data?${sp.toString()}`;
    return qParam ? `${href}${qParam}` : href;
  }

  if (t === 'interop') {
    const sp = new URLSearchParams();
    sp.set('source_id', String(dsId));
    sp.set('type', 'interop');
    sp.set('period', String(yearResolved));
    if (shouldAttachGeo) sp.set('geo', geo);
    const href = `/data?${sp.toString()}`;
    return qParam ? `${href}${qParam}` : href;
  }

  if (t === 'static') {
    const sp = new URLSearchParams();
    sp.set('source_id', String(dsId));
    sp.set('type', 'static');
    const href = `/data?${sp.toString()}`;
    return qParam ? `${href}${qParam}` : href;
  }

  if (t === 'pressrelease') return '/brs';

  // dynamic (default)
  const sp = new URLSearchParams();
  sp.set('source_id', String(dsId));
  sp.set('type', 'dynamic');
  sp.set('period', String(yearResolved));
  if (typeof month === 'number' && month >= 1 && month <= 12) sp.set('month', String(month));
  if (shouldAttachGeo) sp.set('geo', geo);
  const href = `/data?${sp.toString()}`;
  return qParam ? `${href}${qParam}` : href;
}

export async function GET(req: NextRequest) {
  const qRaw = (req.nextUrl.searchParams.get("q") || "").trim();
  const q = qRaw.slice(0, 80);
  const mode = String(req.nextUrl.searchParams.get("mode") || "").trim().toLowerCase();
  const dbOnly = String(req.nextUrl.searchParams.get("dbOnly") || "").trim() === "1";

  if (mode === 'favorites' || !q || q.length < 2) {
    const fav = await tryJson<FavoritesResponse>(
      `${backendBaseUrl()}/search/favorites?limit=5`,
      { cache: "no-store" }
    );
    const items = Array.isArray(fav?.items) ? fav!.items! : [];

    const datasources = items.slice(0, 5).map((it) => ({
      id: it.id,
      title: it.name,
      subtitle: it.category || "Data Statistik",
      link: `/search?q=${encodeURIComponent(it.name)}`,
    }));

    const resp: SearchResponse = {
      q,
      datasources,
      publications: [],
      brs: [],
      knowledge: [],
      exact: { datasources: datasources.map((d) => ({ ...d, score: 0 })), publications: [], brs: [] },
      suggestions: { datasources: [], publications: [], brs: [] },
    };
    return Response.json(resp, { headers: { "Cache-Control": "no-store" } });
  }

  const apiKey = getApiKey();

  // Backend-first intent (OpenAI query builder + deterministic datasource mapping)
  // Backend also returns ranked datasource candidates, so we don't need multiple /search/datasource calls.
  const intent = await tryJson<SearchIntentResponse>(
    `${backendBaseUrl()}/search/intent?q=${encodeURIComponent(q)}&includeCandidates=1&limit=25`,
    { cache: "no-store" }
  );
  const qb: any = intent?.query_builder || null;
  const topic = extractKeywords(q);
  // EXIM facet fallback (ctr/pod/HS2) for queries that the QB doesn't fully capture.
  const isLikelyEximQuery = /\b(ekspor|impor)\b/i.test(q);
  if (isLikelyEximQuery && qb && typeof qb === 'object') {
    if (!qb.params || typeof qb.params !== 'object') qb.params = {};

    const facets = extractEximFacetStrings(q);
    if (!qb.params.ctr && facets.ctr) qb.params.ctr = facets.ctr;
    if (!qb.params.pod && facets.pod) qb.params.pod = facets.pod;

    const inferredGroup = inferEximGroupFromQuery(q);
    if (inferredGroup === 'detail') {
      qb.params.group = 'detail';
    } else if (inferredGroup) {
      // Explicit query phrasing should win over any stale/incorrect QB group.
      qb.params.group = inferredGroup;
    }

    // If query asks "menurut pelabuhan" but doesn't specify a concrete port after "pelabuhan",
    // and the query-builder put a token into `pod` (often a country like "china"), prefer treating
    // it as `ctr` to avoid empty results.
    const rawQ = norm(q);
    const hasExplicitPod = /\bpelabuhan\s+[a-z]{2,}(?:\s+[a-z]{2,}){0,2}\b/i.test(rawQ);
    const hasExplicitCtr = /\bnegara\s+[a-z]{2,}(?:\s+[a-z]{2,}){0,2}\b/i.test(rawQ);
    if (inferredGroup === 'pod' && !hasExplicitPod && qb.params.pod) {
      if (!qb.params.ctr) qb.params.ctr = qb.params.pod;
      delete qb.params.pod;
    }
    if (inferredGroup === 'ctr' && !hasExplicitCtr && qb.params.ctr) {
      delete qb.params.ctr;
    }

    const codeHsRaw = String(qb?.params?.code_hs || '').trim();
    const hasCodeHs = codeHsRaw.replace(/\D/g, '').slice(0, 2).length === 2;
    if (!hasCodeHs) {
      const commodity = extractEximCommodityTerm(q);
      if (commodity && commodity.length >= 3) {
        const hs2 = await tryJson<{ items?: Array<{ hs2digit: string; name?: string }> }>(
          `${backendBaseUrl()}/exim/hs2?q=${encodeURIComponent(commodity)}`,
          { cache: 'no-store' }
        );
        const first = Array.isArray(hs2?.items) ? hs2!.items![0] : null;
        const hs2digit = String(first?.hs2digit || '').trim().replace(/\D/g, '').slice(0, 2);
        if (hs2digit.length === 2) qb.params.code_hs = hs2digit;
      }
    }
  }

  const topicQ = topic.topic;

  // Resolve datasource candidates early so we can expand keyword variants for
  // BRS/publication suggestions using category hints.
  let dsItemsMerged: DatasourceHit[] = Array.isArray(intent?.candidates?.items)
    ? (intent!.candidates!.items as DatasourceHit[])
    : [];

  // Resilience: if intent endpoint is unavailable (e.g. OpenAI disabled) or returns no candidates,
  // fall back to deterministic backend datasource search (single call).
  if (dsItemsMerged.length === 0) {
    const fallback = await tryJson<{ items?: DatasourceHit[] }>(
      `${backendBaseUrl()}/search/datasource?q=${encodeURIComponent(q)}&limit=25`,
      { cache: "no-store" }
    );
    const items = Array.isArray(fallback?.items) ? (fallback!.items as DatasourceHit[]) : [];
    dsItemsMerged = items;
  }

  const kwBase = topic.keywordVariants.length > 0 ? topic.keywordVariants : [q];
  const kw = expandBpsKeywordVariants({
    q,
    base: kwBase,
    datasourceCategories: dsItemsMerged.slice(0, 8).map((d) => d.category),
  });

  const isDataIntent = String(qb?.intent || '').toLowerCase() === 'data';
  const yearQb = asInt(qb?.params?.year);
  const monthQb = asInt(qb?.params?.month);
  const ymFromQuery = extractYearMonthFromQuery(q);
  const year = (isDataIntent && Number.isInteger(yearQb)) ? yearQb : ymFromQuery.year;
  const month = (isDataIntent && Number.isInteger(monthQb)) ? monthQb : ymFromQuery.month;
  const hasYear = Number.isInteger(year);

  const extractedTargets = extractPeriodTargetsFromQuery(q);
  const targetsMonthsSet = new Set<number>(extractedTargets.months);
  const targetsYearsSet = new Set<number>(extractedTargets.years);

  // Merge QB-derived period into targets as well (when available)
  if (Number.isInteger(yearQb) && Number.isInteger(monthQb) && (monthQb as number) >= 1 && (monthQb as number) <= 12) {
    targetsMonthsSet.add((yearQb as number) * 12 + ((monthQb as number) - 1));
  } else if (Number.isInteger(yearQb)) {
    targetsYearsSet.add(yearQb as number);
  }
  if (Number.isInteger(year) && Number.isInteger(month) && (month as number) >= 1 && (month as number) <= 12) {
    targetsMonthsSet.add((year as number) * 12 + ((month as number) - 1));
  } else if (Number.isInteger(year)) {
    targetsYearsSet.add(year as number);
  }

  const periodTargets = {
    months: Array.from(targetsMonthsSet.values()),
    years: Array.from(targetsYearsSet.values()),
  };
  const hasPeriodQuery = periodTargets.months.length > 0 || periodTargets.years.length > 0;

  let maxBpsPages = hasPeriodQuery ? 5 : 1;
  if (hasPeriodQuery) {
    const currentYear = new Date().getFullYear();
    const yearsFromMonths = periodTargets.months.map((mi) => Math.floor(mi / 12));
    const allYears = [...periodTargets.years, ...yearsFromMonths].filter((y) => Number.isInteger(y));
    const oldestYear = allYears.length > 0 ? Math.min(...allYears) : currentYear;
    // If query targets older periods, fetch more pages so older items are in candidate set.
    if (oldestYear <= currentYear - 2) maxBpsPages = 10;
  }

  let pubItems: PublicationHit[] = [];
  let brsItemsUnique: BrsHit[] = [];

  if (!dbOnly) {
    const brsUrls = kw.flatMap((k) =>
      Array.from({ length: maxBpsPages }, (_, i) =>
        `https://webapi.bps.go.id/v1/api/list/model/pressrelease/domain/8200/page/${i + 1}/keyword/${encodeURIComponent(k)}/key/${apiKey}/`
      )
    );

    // Publication keyword endpoint is not guaranteed; try keyword URL first, fallback to page list + filter.
    const pubKeywordUrls = kw.flatMap((k) =>
      Array.from({ length: maxBpsPages }, (_, i) =>
        `https://webapi.bps.go.id/v1/api/list/model/publication/domain/8200/page/${i + 1}/keyword/${encodeURIComponent(k)}/key/${apiKey}/`
      )
    );

    const pubListUrls = Array.from({ length: maxBpsPages }, (_, i) =>
      `https://webapi.bps.go.id/v1/api/list/model/publication/domain/8200/key/${apiKey}/page/${i + 1}`
    );

    const all = await Promise.all([
      ...brsUrls.map((u) => tryJson<{ data?: [unknown, BrsHit[]] }>(u, { cache: "no-store" })),
      ...pubKeywordUrls.map((u) => tryJson<{ data?: [unknown, PublicationHit[]] }>(u, { cache: "no-store" })),
    ]);

    const brsRawList = all.slice(0, brsUrls.length) as Array<{ data?: [unknown, BrsHit[]] } | null>;
    const pubRawList = all.slice(brsUrls.length) as Array<{ data?: [unknown, PublicationHit[]] } | null>;

    pubItems = pubRawList.flatMap((r) => (Array.isArray(r?.data?.[1]) ? ((r!.data![1] as any) as PublicationHit[]) : []));

    const pubDedup = new Map<string, PublicationHit>();
    for (const p of pubItems) pubDedup.set(String(p?.pub_id), p);
    pubItems = Array.from(pubDedup.values());

    if (pubItems.length === 0) {
      const fallbackPages = await Promise.all(
        pubListUrls.map((u) => tryJson<{ data?: [unknown, PublicationHit[]] }>(u, { cache: "no-store" }))
      );
      const list = fallbackPages.flatMap((r) => (Array.isArray(r?.data?.[1]) ? (r!.data![1] as PublicationHit[]) : []));
      const qLower = q.toLowerCase();
      const topicLower = topicQ.toLowerCase();
      const keywordsLower = Array.from(new Set([qLower, topicLower, ...kw.map((k) => String(k || "").toLowerCase())]))
        .map((s) => String(s || "").trim())
        .filter((s) => s.length >= 2);
      pubItems = list.filter((it) => {
        const t = String(it?.title || "").toLowerCase();
        return keywordsLower.some((k) => k && t.includes(k));
      });
    }

    const brsItems = brsRawList.flatMap((r) => (Array.isArray(r?.data?.[1]) ? ((r!.data![1] as any) as BrsHit[]) : []));
    const brsDedup = new Map<number, BrsHit>();
    for (const b of brsItems) brsDedup.set(Number((b as any)?.brs_id), b);
    brsItemsUnique = Array.from(brsDedup.values());

    // Fallback: for trade-intent queries (impor/ekspor)
    try {
      const qNorm = norm(q);
      const wantEkspor = /\bekspor\b/i.test(qNorm);
      const wantImpor = /\bimpor\b/i.test(qNorm);
      const isTradeQuery = wantEkspor || wantImpor;
      if (isTradeQuery) {
        const hasNeracaOrTrade = brsItemsUnique.some((b) => {
          const t = String((b as any)?.title || "").toLowerCase();
          return t.includes("neraca perdagangan") || t.includes("perdagangan luar negeri");
        });
        const hasEkspor = brsItemsUnique.some((b) => String((b as any)?.title || "").toLowerCase().includes("ekspor"));
        const hasImpor = brsItemsUnique.some((b) => String((b as any)?.title || "").toLowerCase().includes("impor"));

        const needsFallback = (wantImpor && !hasImpor && !hasNeracaOrTrade) || (wantEkspor && !hasEkspor && !hasNeracaOrTrade);

        if (needsFallback) {
          const fallbackKw = "neraca perdagangan";
          const fallbackUrls = Array.from({ length: maxBpsPages }, (_, i) =>
            `https://webapi.bps.go.id/v1/api/list/model/pressrelease/domain/8200/page/${i + 1}/keyword/${encodeURIComponent(fallbackKw)}/key/${apiKey}/`
          );
          const fallbackPages = await Promise.all(
            fallbackUrls.map((u) => tryJson<{ data?: [unknown, BrsHit[]] }>(u, { cache: "no-store" }))
          );
          const fallbackItems = fallbackPages.flatMap((r) => (Array.isArray(r?.data?.[1]) ? ((r!.data![1] as any) as BrsHit[]) : []));
          for (const b of fallbackItems) brsDedup.set(Number((b as any)?.brs_id), b);
          brsItemsUnique = Array.from(brsDedup.values());
        }
      }
    } catch {
      // ignore
    }
  }

  // Column-based geo support probing (limited):
  // For some indicators, the title may not clearly mention kab/kota even though the table has a
  // wilayah dimension. In those cases, detect it from the replicated data_bps columns.
  // Keep this bounded to avoid too many backend calls.
  const { yearResolved: probeYearResolved, hasYear: probeHasYear } = resolveYearFromQueryAndQb(q, qb);
  const probeGeo = resolveGeoFromQueryAndQb(q, qb);
  const geoSupportById = new Map<number, boolean>();

  const probeDatasourceGeoSupport = async (ds: { id: number; typeNorm: string; name: string }): Promise<boolean> => {
    if (!probeGeo || !probeHasYear) return false;
    const t = String(ds.typeNorm || '').toLowerCase();
    if (t !== 'dynamic' && t !== 'interop') return false;

    // If title already signals kab/kota, no need to probe.
    if (indicatesKabKotaDimensionFromText(ds.name)) return true;

    const url = `${backendBaseUrl()}/${encodeURIComponent(t)}/${encodeURIComponent(String(ds.id))}?period=${encodeURIComponent(String(probeYearResolved))}`;
    const resp = await tryJson<any>(url, { cache: 'no-store' });
    const cols = resp?.data?.columns;
    return indicatesKabKotaDimensionFromColumns(cols);
  };

  const dsScored = dsItemsMerged
    .map((d) => {
      const hasBackendScore = typeof d.score === "number";
      let score = hasBackendScore ? (d.score as number) : scoreTitle(q, d.name);
      // Only apply periodHit bonus when we computed score locally.
      // Backend /search/datasource already includes periodHit in its score.
      if (!hasBackendScore && hasYear && d.periodHit) score += 8;

      const qNorm = norm(q);
      const wantEkspor = /\bekspor\b/i.test(qNorm);
      const wantImpor = /\bimpor\b/i.test(qNorm);
      const typeNorm = String((d as any).type || "").toLowerCase();
      const isDynamic = typeNorm === "dynamic";
      const isExim = typeNorm === "exim";
      const isPressrelease = typeNorm === "pressrelease";
      const isInterop = typeNorm === "interop";
      const isStatic = typeNorm === "static";

      let dirBias = 0;

      if (isExim && (wantEkspor || wantImpor) && !(wantEkspor && wantImpor)) {
        const titleNorm = norm(d.name);
        if (wantEkspor) {
          if (titleNorm.includes('ekspor')) score += 15;
          if (titleNorm.includes('impor')) score -= 8;
          if (titleNorm.includes('ekspor')) dirBias = 1;
          if (titleNorm.includes('impor')) dirBias = -1;
        } else if (wantImpor) {
          if (titleNorm.includes('impor')) score += 15;
          if (titleNorm.includes('ekspor')) score -= 8;
          if (titleNorm.includes('impor')) dirBias = 1;
          if (titleNorm.includes('ekspor')) dirBias = -1;
        }
      }

      return {
        id: d.id,
        title: d.name,
        dsType: typeNorm,
        subtitle: buildSubtitle({
          category: d.category || null,
          typeNorm,
          periodHit: Boolean(d.periodHit),
          qb,
          isPrimary: Boolean(intent?.ok && typeof intent.datasource?.source_id === 'number' && intent.datasource.source_id === d.id),
          q,
        }),
        score,
        dirBias,
        chart_config: d.chart_config || null,
        unit: (d as any).unit || null,
      };
    })
    .sort((a, b) => (b.score - a.score) || (b.dirBias - a.dirBias));

  const dsRankedDeduped: typeof dsScored = [];
  {
    const seen = new Set<number>();
    for (const it of dsScored) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      dsRankedDeduped.push(it);
    }
  }

  // Probe only a few top candidates to decide whether geo should be attached.
  if (probeGeo && probeHasYear) {
    const probeList = dsRankedDeduped
      .slice(0, 6)
      .map((d) => ({ id: d.id, typeNorm: d.dsType, name: d.title }));

    const needsProbe = probeList.filter((d) => {
      const t = String(d.typeNorm || '').toLowerCase();
      if (t !== 'dynamic' && t !== 'interop') return false;
      // If the title already signals kab/kota, no need to probe.
      if (indicatesKabKotaDimensionFromText(d.name)) return false;
      return true;
    });

    const probed = await Promise.all(
      needsProbe.map(async (d) => {
        const ok = await probeDatasourceGeoSupport(d);
        return { id: d.id, ok };
      })
    );
    for (const r of probed) {
      if (r.ok) geoSupportById.set(r.id, true);
    }
  }

  const dsRankedWithLinks = dsRankedDeduped.map((d) => {
    const forceGeo = geoSupportById.get(d.id) === true;
    const link = buildDatasourceLink({
      dsId: d.id,
      dsType: d.dsType,
      dsName: d.title,
      forceGeo,
      q,
      intent: intent?.ok ? intent : null,
    });
    const { dsType, ...rest } = d as any;
    return { ...rest, link };
  });

  const pubRanked = pubItems
    .map((p) => {
      const title = String(p.title || "(Tanpa judul)");
      const cover = p.cover ? String(p.cover) : "";
      const base = scoreTitleHybrid(q, topicQ, title);
      const parsed = parseRlDate(p.rl_date);
      const ts = parseDateToMs(p.rl_date);
      let score = base + periodRelevanceBonusFromTargets({
        itemYear: parsed.year,
        itemMonth: parsed.month,
        targetsMonths: periodTargets.months,
        targetsYears: periodTargets.years,
      });
      // If query doesn't specify a period, gently prefer newer items.
      if (!hasPeriodQuery) score += recencyBonusFromNowMs(ts);
      return {
        id: String(p.pub_id),
        title,
        subtitle: p.rl_date ? String(p.rl_date) : "Publikasi",
        thumbnail: cover ? `/api/thumbnail?url=${encodeURIComponent(cover)}` : "",
        link: `/publikasi?pub_id=${encodeURIComponent(String(p.pub_id))}`,
        score,
        ts,
      };
    })
    .sort(sortByScoreThenNewest);

  const brsRanked = brsItemsUnique
    .map((b) => {
      const title = String((b as any).title || "(Tanpa judul)");
      const thumb = (b as any).thumbnail ? String((b as any).thumbnail) : "";
      const base = scoreTitleHybrid(q, topicQ, title);
      const titlePeriod = parsePeriodFromTitle(title);
      const datePeriod = parseRlDate((b as any).rl_date);
      const ts = parseDateToMs((b as any).rl_date);
      let score = base + periodRelevanceBonusFromTargets({
        itemYear: titlePeriod.year ?? datePeriod.year,
        itemMonth: titlePeriod.month ?? datePeriod.month,
        targetsMonths: periodTargets.months,
        targetsYears: periodTargets.years,
      });
      if (!hasPeriodQuery) score += recencyBonusFromNowMs(ts);

      // Trade intent boost: ensure "impor" queries surface impor/neraca BRS, not unrelated high-volume BRS.
      {
        const qNorm = norm(q);
        const wantEkspor = /\bekspor\b/i.test(qNorm);
        const wantImpor = /\bimpor\b/i.test(qNorm);
        const t = title.toLowerCase();
        const hasNeraca = t.includes('neraca perdagangan') || t.includes('perdagangan luar negeri');
        const hasE = t.includes('ekspor');
        const hasI = t.includes('impor');
        if (wantImpor && !wantEkspor) {
          if (hasI) score += 16;
          if (hasNeraca) score += 12;
          if (hasE && !hasI && !hasNeraca) score -= 8;
        } else if (wantEkspor && !wantImpor) {
          if (hasE) score += 16;
          if (hasNeraca) score += 12;
          if (hasI && !hasE && !hasNeraca) score -= 8;
        } else if (wantEkspor && wantImpor) {
          if (hasE || hasI || hasNeraca) score += 10;
        }
      }

      return {
        id: Number((b as any).brs_id),
        title,
        subtitle: (b as any).rl_date ? String((b as any).rl_date) : "Berita Resmi Statistik",
        thumbnail: thumb ? `/api/thumbnail?url=${encodeURIComponent(thumb)}` : "",
        link: `/brs?brs_id=${encodeURIComponent(String((b as any).brs_id))}`,
        score,
        ts,
      };
    })
    .sort(sortByScoreThenNewest);

  // Fetch knowledge base results (RAG)
  let knowledgeItems: KnowledgeItem[] = [];
  if (!dbOnly) {
    const knowledgeRes = await tryJson<{ items?: KnowledgeItem[] }>(
      `${backendBaseUrl()}/search/knowledge?q=${encodeURIComponent(q)}&limit=5`,
      { cache: "no-store" }
    );
    if (Array.isArray(knowledgeRes?.items)) {
      knowledgeItems = knowledgeRes!.items!;
    }
  }

  const dsSplit = splitExact(dsRankedWithLinks);
  const pubSplit = splitExact(pubRanked);
  const brsSplit = splitExact(brsRanked);

  const response: SearchResponse = {
    q,
    datasources: dsRankedWithLinks.slice(0, 8).map(({ score, dirBias, ...x }) => x),
    publications: pubRanked.slice(0, 8).map(({ score, ...x }) => x),
    brs: brsRanked.slice(0, 8).map(({ score, ...x }) => x),
    knowledge: knowledgeItems.slice(0, 5),
    exact: {
      datasources: dsSplit.exact.map(({ dirBias, ...x }) => x),
      publications: pubSplit.exact,
      brs: brsSplit.exact,
    },
    suggestions: {
      datasources: dsSplit.suggestions.map(({ dirBias, ...x }) => x),
      publications: pubSplit.suggestions,
      brs: brsSplit.suggestions,
    },
  };

  return Response.json(response, { headers: { "Cache-Control": "no-store" } });
}
