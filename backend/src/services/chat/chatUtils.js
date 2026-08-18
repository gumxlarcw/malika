/**
 * Chat utility functions — extracted from chat.service.js (Phase 44)
 *
 * Small, stateless utility functions used by both sendMessage (non-streaming)
 * and the streaming pipeline.
 */

'use strict';

const { expandGeoShorthand } = require('../../utils/geoAnalysis');

/**
 * Detects if a query is clearly NOT about statistical data.
 */
function isNonStatisticalQuery(text) {
  const t = String(text || '').toLowerCase().trim();
  if (t.length < 5) return true;

  const greetings = /^(hi|halo|hai|hello|hey|pagi|siang|sore|malam|selamat|assalamu|salam|terima\s*kasih|makasih|thanks?|thank\s*you)\b/;
  if (greetings.test(t)) return true;

  const aboutAi = /\b(model\s*(apa|yang|kamu)|siapa\s*(kamu|nama|yang\s*buat)|kamu\s*(siapa|apa)|dibuat\s*(oleh|dengan)|nama\s*kamu|namamu)\b/;
  if (aboutAi.test(t)) return true;

  const generalKnowledge = /\b(presiden|menteri|gubernur|bupati|walikota|ibukota|bendera|lagu\s*kebangsaan|hari\s*kemerdekaan|sejarah\s*(indonesia|dunia))\b/i;
  if (generalKnowledge.test(t) && !t.includes('data') && !t.includes('statistik')) {
    const statSignal = /\b(jumlah|persentase|angka|data|statistik|grafik|tabel|perkembangan|tren|pertumbuhan)\b/;
    if (!statSignal.test(t)) return true;
  }

  const askingList = /\b(siapa\s*saja|daftar\s*(presiden|menteri|gubernur|bupati|walikota))\b/;
  if (askingList.test(t) && !t.includes('data') && !t.includes('statistik')) return true;

  return false;
}

/**
 * Parse quarter/triwulan from query text.
 * Returns { quarter: 1-4, monthStart, monthEnd } or { semester: 1-2, monthStart, monthEnd } or null
 */
function parseQuarterFromText(text) {
  const t = String(text || '').toLowerCase();

  const triwulanMatch = t.match(/\btriwulan\s*(i{1,3}v?|iv|[1-4])\b/i);
  const quarterMatch = t.match(/\bq([1-4])\b/i);
  const kuartalMatch = t.match(/\bku?artal\s*(i{1,3}v?|iv|[1-4])\b/i);

  let qNum = null;
  if (triwulanMatch) {
    const raw = triwulanMatch[1].toLowerCase();
    if (raw === '1' || raw === 'i') qNum = 1;
    else if (raw === '2' || raw === 'ii') qNum = 2;
    else if (raw === '3' || raw === 'iii') qNum = 3;
    else if (raw === '4' || raw === 'iv' || raw === 'iiii') qNum = 4;
  } else if (quarterMatch) {
    qNum = parseInt(quarterMatch[1], 10);
  } else if (kuartalMatch) {
    const raw = kuartalMatch[1].toLowerCase();
    if (raw === '1' || raw === 'i') qNum = 1;
    else if (raw === '2' || raw === 'ii') qNum = 2;
    else if (raw === '3' || raw === 'iii') qNum = 3;
    else if (raw === '4' || raw === 'iv' || raw === 'iiii') qNum = 4;
  }

  const semesterMatch = t.match(/\bsemester\s*(i{1,2}|[1-2])\b/i);
  if (semesterMatch) {
    const raw = semesterMatch[1].toLowerCase();
    if (raw === '1' || raw === 'i') return { semester: 1, monthStart: 1, monthEnd: 6 };
    else if (raw === '2' || raw === 'ii') return { semester: 2, monthStart: 7, monthEnd: 12 };
  }

  if (!qNum || qNum < 1 || qNum > 4) return null;

  const quarterMonths = {
    1: { monthStart: 1, monthEnd: 3 },
    2: { monthStart: 4, monthEnd: 6 },
    3: { monthStart: 7, monthEnd: 9 },
    4: { monthStart: 10, monthEnd: 12 },
  };

  return { quarter: qNum, ...quarterMonths[qNum] };
}

/** Remove ```malika_ui ... ``` blocks from content */
/**
 * Read the reporting period out of a knowledge document's title.
 *
 * knowledge_base carries no publication date — `created_at` is the ingest
 * timestamp, not the period the document reports on. The period survives only in
 * the title, which 97% of chunks carry (measured over a 4000-title sample:
 * 2657 month+year, 1227 year-only, 116 undated).
 *
 * A title may name a range ("Maret 2012–September 2017"). The document is about
 * its newest period, so the latest mention wins — taking the first would date a
 * 2017 release to 2012.
 *
 * @returns {{year:number, month:number, key:number, label:string}|null}
 *   `month` is 0 when only a year was found; `key` is year*100+month so periods
 *   compare as plain numbers.
 */
const ID_MONTHS = ['januari', 'februari', 'maret', 'april', 'mei', 'juni',
  'juli', 'agustus', 'september', 'oktober', 'november', 'desember'];

function parseDocPeriod(titleRaw) {
  const title = String(titleRaw || '');
  if (!title.trim()) return null;

  let best = null;
  const consider = (year, month, label) => {
    const key = year * 100 + month;
    if (!best || key > best.key) best = { year, month, key, label };
  };

  const monthRe = new RegExp(`\\b(${ID_MONTHS.join('|')})\\s+(20\\d{2})\\b`, 'gi');
  for (const m of title.matchAll(monthRe)) {
    const monthNo = ID_MONTHS.indexOf(m[1].toLowerCase()) + 1;
    const year = Number(m[2]);
    consider(year, monthNo, `${m[1].charAt(0).toUpperCase()}${m[1].slice(1).toLowerCase()} ${year}`);
  }
  if (best) return best;

  // Year alone. Restricted to 20xx so chunk counters like "(12/30)" and figures
  // inside a title cannot masquerade as a period.
  for (const m of title.matchAll(/\b(20\d{2})\b/g)) {
    const year = Number(m[1]);
    consider(year, 0, String(year));
  }
  return best;
}

/**
 * Order knowledge documents so the model reads the right period first.
 *
 * Relevance still leads: recency only breaks near-ties, because a clearly better
 * match should not lose to a newer but weaker one. The live failure this exists
 * for was 0.884 vs 0.880 — a four-thousandth gap that decided which year's
 * figures the answer quoted.
 *
 * `requestedYear` outranks everything. A question about 2017 must never be
 * answered with 2025 figures just because they are newer.
 *
 * Undated documents keep their relative position — unknown is not evidence of
 * being old, so they are neither promoted nor demoted.
 */
function orderKnowledgeDocsByPeriod(docs, { requestedYear = null, band = 0.05 } = {}) {
  const list = Array.isArray(docs) ? docs : [];
  if (list.length < 2) return [...list];

  const periods = list.map((doc) => parseDocPeriod(doc && doc.title));
  const sims = list.map((doc) => (doc && doc.similarity) || 0);

  if (requestedYear) {
    const wanted = Number(requestedYear);
    return list
      .map((doc, index) => ({ doc, index, hit: periods[index] && periods[index].year === wanted ? 1 : 0 }))
      .sort((a, b) => (b.hit - a.hit) || (a.index - b.index))
      .map((x) => x.doc);
  }

  // Only near-ties are reordered, and only among documents that actually carry a
  // period. Dated documents swap places with each other; undated ones keep the
  // slot they were in, because an unknown period is not evidence of being old.
  // Sorting all four cases with one comparator produced an intransitive order
  // (older < undated < newer < older) and therefore an unpredictable result.
  const top = Math.max(...sims);
  const slots = [];
  for (let i = 0; i < list.length; i += 1) {
    if (periods[i] && top - sims[i] <= band) slots.push(i);
  }
  if (slots.length < 2) return [...list];

  const ordered = slots
    .slice()
    .sort((a, b) => (periods[b].key - periods[a].key) || (a - b));

  const out = [...list];
  slots.forEach((slot, n) => { out[slot] = list[ordered[n]]; });
  return out;
}

/**
 * Clean one line of the model's reasoning before it is shown to the public.
 *
 * The reasoning trace renders in the chat UI, so it must not read our own system
 * prompt back to the user. The prompt already asks the model to keep the trace
 * free of internal instructions and in Indonesian — measured over 8 queries that
 * held for language (0/8 English) and markdown (0/8), but 2/8 still quoted our
 * answer-shape constraints. This is the net under that residual.
 *
 * Deliberately narrow: it drops lines that name prompt plumbing or restate the
 * answer-shape rules, and nothing else. A line is not internal merely for
 * mentioning a table or the data — that is the reasoning we want people to see.
 *
 * @returns {string} the cleaned line, or null when the line should be dropped
 */
const REASONING_INTERNAL_PATTERNS = [
  /\bconstraint\s*:/i,
  /\bmax(?:imal|imum)?\s+\d+[-–\s]*\d*\s*(sentence|kalimat)/i,
  /\bbatas\s*:\s*maksimal\s+\d/i,
  /\bdo not list\b/i,
  /\bdata\s*preview\b/i,
  /\bsystem\s*message\b/i,
  /\bknowledge\s*base\b/i,
  /\binstruksi\s+penting\b/i,
];

function sanitizeReasoningLine(lineRaw) {
  if (typeof lineRaw !== 'string') return '';
  if (!lineRaw.trim()) return lineRaw === '' ? '' : lineRaw;
  if (REASONING_INTERNAL_PATTERNS.some((re) => re.test(lineRaw))) return null;
  // Markdown leaks through as literal asterisks in the plain-text panel: emphasis
  // markers, and list bullets that render as a stray "*" at the start of a line.
  return lineRaw
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|\s)\*(?!\s)([^*]+?)\*(?=\s|$)/g, '$1$2')
    .replace(/^(\s*)[*+-]\s{2,}/, '$1');
}

function stripMalikaUiBlock(content) {
  return String(content || '').replace(/```\s*malika_ui\s*[\s\S]*?```/gi, '').trim();
}

/** Remove raw URLs, markdown links → plain label */
function stripRawUrlsFromText(textRaw) {
  let out = String(textRaw || '');
  out = out.replace(/\[([^\]]+)]\((https?:\/\/[^)]+)\)/gi, '$1');
  out = out.replace(/\bhttps?:\/\/[^\s<>()]+/gi, '');
  out = out.replace(/\bwww\.[^\s<>()]+/gi, '');
  out = out.replace(/\/data\?[^\s]+/gi, 'halaman data');
  out = out.replace(/\/search\?q=[^\s]+/gi, 'halaman pencarian');
  out = out.replace(/\/backend\/?[^\s]*/gi, '');
  out = out.replace(/\s{2,}/g, ' ');
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

/**
 * Enforce response rhythm/length limits.
 */
function clampChatRhythm(textRaw) {
  let out = String(textRaw || '').trim();
  if (!out) return out;

  const maxLines = Number(process.env.MALIKA_MAX_LINES) || 25;
  const maxChars = Number(process.env.MALIKA_MAX_CHARS) || 3000;
  const maxQuestions = Number(process.env.MALIKA_MAX_QUESTIONS) || 2;

  out = out.replace(/\n{3,}/g, '\n\n').trim();
  const lines = out.split('\n');
  if (lines.length > maxLines) out = lines.slice(0, maxLines).join('\n').trim();
  if (out.length > maxChars) out = out.slice(0, maxChars).trim();

  const idxs = [];
  for (let i = 0; i < out.length; i++) if (out[i] === '?') idxs.push(i);
  if (idxs.length > maxQuestions) {
    const chars = out.split('');
    for (const i of idxs.slice(maxQuestions)) chars[i] = '.';
    out = chars.join('');
  }

  return out.replace(/\s{2,}/g, ' ').replace(/\n\s+\n/g, '\n\n').trim();
}

function safeParseInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeYearValue(v) {
  const n = safeParseInt(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n >= 1900 && n <= 2100) return n;
  if (n >= 0 && n <= 999) {
    const y = 1900 + n;
    return y >= 1900 && y <= 2100 ? y : null;
  }
  return null;
}

function normalizeType(raw) {
  const t = String(raw || '').toLowerCase();
  if (t === 'dynamic' || t === 'interop' || t === 'static' || t === 'exim' || t === 'pressrelease') return t;
  return '';
}

function buildPeriodCandidates({ year, month }) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 1900 || y > 2100) return [];

  const out = [];
  out.push(String(y));
  const three = y - 1900;
  if (three >= 0 && three <= 999) out.push(String(three));

  const m = Number(month);
  if (Number.isInteger(m) && m >= 1 && m <= 12) {
    const mm = String(m).padStart(2, '0');
    out.push(`${y}${mm}`);
    out.push(`${three}${mm}`);
  }

  return out;
}

/**
 * Filter data rows by geo term.
 * @returns {{ filtered: Array, geoMatched: boolean, geoMatchCount: number }}
 */
function filterDataByGeo(data, geo) {
  if (!geo || !Array.isArray(data) || data.length === 0) {
    return { filtered: data, geoMatched: false, geoMatchCount: 0 };
  }

  const geoNorm = String(geo).toLowerCase().replace(/[^a-z]/g, '');
  const geoExpanded = expandGeoShorthand(geoNorm);

  const filtered = data.filter(row => {
    const rowValues = Object.values(row).map(v => String(v || '').toLowerCase());
    return rowValues.some(v => v.includes(geoNorm) || (geoExpanded && v.includes(geoExpanded)));
  });

  return {
    filtered: filtered.length > 0 ? filtered : data,
    geoMatched: filtered.length > 0,
    geoMatchCount: filtered.length,
  };
}

/**
 * Filter data rows by quarter (triwulan).
 * @returns {{ filtered: Array, quarterMatched: boolean, quarterMatchCount: number }}
 */
function filterDataByQuarter(data, quarterNum) {
  if (!quarterNum || !Array.isArray(data) || data.length === 0) {
    return { filtered: data, quarterMatched: false, quarterMatchCount: 0 };
  }

  const quarterLabels = {
    1: /triwulan\s*i\b/i,
    2: /triwulan\s*ii\b/i,
    3: /triwulan\s*iii\b/i,
    4: /triwulan\s*iv\b/i,
  };
  const pattern = quarterLabels[quarterNum];
  if (!pattern) return { filtered: data, quarterMatched: false, quarterMatchCount: 0 };

  const filtered = data.filter(row => {
    const quarterCol = row.Bulan || row.bulan || row.Periode || row.periode || row.Triwulan || row.triwulan;
    if (quarterCol) return pattern.test(String(quarterCol));
    return Object.values(row).some(v => typeof v === 'string' && pattern.test(v));
  });

  return {
    filtered: filtered.length > 0 ? filtered : data,
    quarterMatched: filtered.length > 0,
    quarterMatchCount: filtered.length,
  };
}

function isKabKotaLevelName(nameRaw) {
  const s = String(nameRaw || '').toLowerCase();
  if (!s) return false;
  return /kabupaten\s*\/\s*kota|kab\s*\/\s*kota|\bkabupaten\b|\bkota\b/.test(s);
}

function isProvinceLevelName(nameRaw) {
  const s = String(nameRaw || '').toLowerCase();
  if (!s) return false;
  return /\bprovinsi\b/.test(s);
}

function buildDataHref({ sourceId, type, period, month, geo }) {
  const qp = new URLSearchParams();
  qp.set('source_id', String(sourceId));
  const t = normalizeType(type);
  if (t && t !== 'pressrelease') qp.set('type', t);
  if (period) qp.set('period', String(period));
  if (month && Number.isFinite(Number(month)) && Number(month) >= 1 && Number(month) <= 12) qp.set('month', String(month));
  if (geo && t !== 'static') qp.set('geo', String(geo));
  return `/data?${qp.toString()}`;
}

function buildDeterministicSuggestions({ qb, hasGeoCandidate }) {
  const type = normalizeType(qb?.type);
  const year = qb?.params?.year;
  const month = qb?.params?.month;

  const tips = [];
  if (!year) tips.push('Tambah tahun/periode (contoh: 2024).');
  if (!month) tips.push('Tambah bulan jika perlu (contoh: Januari).');
  if (hasGeoCandidate && !qb?.params?.geo) tips.push('Tambah wilayah (contoh: Maluku Utara / Ternate / Halmahera Barat).');
  if (!type || type === 'pressrelease') tips.push('Sebutkan jenis data: dynamic / interop / static / exim.');
  if (type === 'exim') {
    tips.push('Untuk EXIM: bisa tambah "kode HS2 02", "menurut negara", atau "menurut pelabuhan".');
  }
  return tips.slice(0, 5);
}

function cleanAssistantTextAgainstDb({ text, requestedYear, anyCandidateHasYear, hasDataPreview }) {
  let out = String(text || '').trim();
  if (!out) return out;

  if (requestedYear && anyCandidateHasYear) {
    out = out
      .replace(/\bbelum\s+tersedia\b[^.。\n]*[.。]?/gi, '')
      .replace(/\b(proyeksi|perkiraan)\b[^.。\n]*[.。]?/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  return out;
}

function buildRoutingAppendix({ intentResult, candidates, latestBySource }) {
  const lines = [];

  const pickedSourceId = intentResult?.datasource?.source_id;
  const periodExists = intentResult?.datasource?.periodExists;
  const pickedLatest = pickedSourceId ? latestBySource?.get(Number(pickedSourceId)) : null;
  if (pickedSourceId && periodExists === false && pickedLatest?.year) {
    const t = normalizeType(intentResult?.query_builder?.type);
    const fallbackHref = buildDataHref({
      sourceId: pickedSourceId,
      type: t || 'dynamic',
      period: pickedLatest.year,
      month: pickedLatest.month || null,
      geo: intentResult?.query_builder?.params?.geo || null,
    });
    lines.push(
      `Periode yang diminta belum ada di database untuk indikator ini. Periode terbaru: ${pickedLatest.month ? `${pickedLatest.year}-${String(pickedLatest.month).padStart(2, '0')}` : String(pickedLatest.year)} → ${fallbackHref}`
    );
  }

  const tips = buildDeterministicSuggestions({
    qb: intentResult?.query_builder,
    hasGeoCandidate: true,
  });

  if (tips.length) {
    lines.push('');
    lines.push('Supaya lebih spesifik, coba:');
    for (const t of tips) lines.push(`- ${t}`);
  }

  const out = lines.join('\n').trim();
  return out ? `\n\n${out}` : '';
}

function buildDbFirstHeader({ intentResult, candidates, latestBySource }) {
  const qb = intentResult?.query_builder;
  const year = qb?.params?.year ? normalizeYearValue(qb.params.year) : null;
  const month = qb?.params?.month ? Number(qb.params.month) : null;
  const geo = qb?.params?.geo ? String(qb.params.geo).trim() : '';

  const lines = [];
  lines.push('Ringkasan dari database:');
  if (year) lines.push(`- Tahun/periode diminta: ${year}${month ? `-${String(month).padStart(2, '0')}` : ''}`);
  if (!geo) lines.push('- Wilayah: (default) Maluku Utara (jika ingin spesifik, sebutkan kab/kota).');

  const plan = intentResult?.plan;
  if (plan?.href) {
    if (plan.action === 'deeplink') lines.push(`- Link data: ${plan.href}`);
    else if (plan.action === 'search') lines.push(`- Link pencarian: ${plan.href}`);
  }

  const list = Array.isArray(candidates) ? candidates : [];
  if (list.length) {
    lines.push('');
    lines.push('Top indikator terkait:');
    for (const it of list.slice(0, 3)) {
      const sid = Number(it?.id);
      const name = String(it?.name || '').trim() || `Sumber ${sid}`;
      const t = normalizeType(it?.type) || 'dynamic';
      const latest = latestBySource?.get(sid) || null;
      const latestLabel = latest?.year
        ? latest.month
          ? `${latest.year}-${String(latest.month).padStart(2, '0')}`
          : String(latest.year)
        : '—';
      const link = latest?.year
        ? buildDataHref({ sourceId: sid, type: t, period: latest.year, month: latest.month || null, geo: null })
        : `/search?q=${encodeURIComponent(name)}`;
      lines.push(`- ${name} (id=${sid}, ${t}, terbaru ${latestLabel}) → ${link}`);
    }
  }

  return lines.join('\n').trim();
}

module.exports = {
  sanitizeReasoningLine,
  parseDocPeriod,
  orderKnowledgeDocsByPeriod,
  isNonStatisticalQuery,
  parseQuarterFromText,
  stripMalikaUiBlock,
  stripRawUrlsFromText,
  clampChatRhythm,
  safeParseInt,
  normalizeYearValue,
  normalizeType,
  buildPeriodCandidates,
  filterDataByGeo,
  filterDataByQuarter,
  isKabKotaLevelName,
  isProvinceLevelName,
  buildDataHref,
  buildDeterministicSuggestions,
  cleanAssistantTextAgainstDb,
  buildRoutingAppendix,
  buildDbFirstHeader,
};
