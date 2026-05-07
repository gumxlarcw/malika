/**
 * EXIM (Export/Import) Query Handler
 * 
 * Handles detection and processing of export/import related queries.
 * Mirrors logic from frontend/src/lib/eximQueryIntent.ts for consistency.
 */

const { MONTH_MAP_NUMERIC, extractMonthFromQuery } = require('../../../utils/queryAnalysis');

// ============================================================================
// PRE-COMPILED REGEX PATTERNS
// These are created once at module load, not on every query
// ============================================================================

const EXIM_REGEX = {
  hasMenurut: /\b(menurut|berdasarkan|berdasar|per)\b/i,
  hasByEn: /\bby\b/i,
  mentionsPod: /\b(pelabuhan|port|pod)\b/i,
  mentionsCtr: /\b(negara|country|ctr)\b/i,
  mentionsNegaraAsalTujuan: /\bnegara\s*(asal|tujuan)\b/i,
  mentionsAsalTujuan: /\b(asal|tujuan)\b/i,
  mentionsHs: /\b(komoditas|barang|hs2|hs\s*code|kode\s*hs|kodehs|\bhs\b)\b/i,
  hasDan: /(\bdan\b|&)/i,
  wantsPodSolo: /\b(menurut|berdasarkan|berdasar|per)\s+(pelabuhan|port|pod)\b/i,
  wantsPodByEn: /\bby\s+(pelabuhan|port|pod)\b/i,
  wantsCtrSolo: /\b(menurut|berdasarkan|berdasar|per)\s+(negara|country|ctr)\b/i,
  wantsCtrByEn: /\bby\s+(negara|country|ctr)\b/i,
  wantsCtrNegaraAsalTujuan: /\b(menurut|berdasarkan|berdasar|per)\s+negara\s*(asal|tujuan)\b/i,
  wantsHsSolo: /\b(menurut|berdasarkan|berdasar|per)\s+(komoditas|barang|hs2|hs)\b/i,
  wantsHsByEn: /\bby\s+(komoditas|barang|hs2|hs)\b/i,
  komoditasQuestion: /\b(komoditas|barang|hs)\s*(apa|mana|terbesar|terbanyak|tertinggi|terendah)/i,
  negaraQuestion: /\b(negara|country)\s*(apa|mana|terbesar|terbanyak|tertinggi|terendah)/i,
  pelabuhanQuestion: /\b(pelabuhan|port)\s*(apa|mana|terbesar|terbanyak|tertinggi|terendah)/i,
  keDariNegara: /\b(ke|dari)\s+negara\s*(mana|apa)/i,
  negaraTujuanAsal: /\bnegara\s+(tujuan|asal)\s*(mana|apa|terbesar|terbanyak)/i,
  tujuanAsalEksporImpor: /\b(tujuan|asal)\s+(ekspor|impor)\s*(mana|apa|terbesar|terbanyak)/i,
  eksporKe: /\b(ekspor)\s+(ke|kemana|tujuan)\s*(mana|apa)?/i,
  imporDari: /\b(impor)\s+(dari|darimana|asal)\s*(mana|apa)?/i,
  terbanyakEksporImpor: /\bterbanyak\b.*\b(ekspor|impor)\b/i,
  eksporImporTerbanyak: /\b(ekspor|impor)\b.*\bterbanyak\b/i,
  negaraTerbanyak: /\bnegara\b.*\b(terbanyak|terbesar|tertinggi|terendah)\b/i,
  terbanyakNegara: /\b(terbanyak|terbesar|tertinggi|terendah)\b.*\bnegara\b/i,
  yearPattern: /^(19\d{2}|20\d{2}|2100)$/,
  yearInText: /\b(19\d{2}|20\d{2}|2100)\b/,
  hsCode: /\bhs\s*([0-9]{2,6})\b/i,
};

// Stop words for facet extraction
const EXIM_STOP_WORDS = new Set([
  'negara', 'pelabuhan', 'komoditas', 'hs', 'hs2', 'kode', 'kodehs',
  'nilai', 'volume', 'berat', 'kg', 'usd', 'us$', 'bulan', 'tahun',
  'dan', 'sampai', 'sd', 's/d', 'hingga', 'to', 'menurut', 'berdasarkan',
  'per', 'ekspor', 'impor', 'apa', 'mana', 'yang', 'terbanyak', 'terbesar',
]);

// Month names for facet extraction — canonical source
const { MONTH_NAMES_SET } = require('../../../utils/queryAnalysis');

/**
 * Infer EXIM grouping intent from query (e.g., "ekspor menurut komoditas" -> "hs2")
 * @param {string} q - User query
 * @returns {'hs2' | 'pod' | 'ctr' | 'detail' | 'hs2ctr' | 'hs2pod' | ''}
 */
function inferEximGroupFromQuery(q) {
  const raw = String(q || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!raw) return '';

  // Use pre-compiled regex patterns
  const hasMenurut = EXIM_REGEX.hasMenurut.test(raw) || EXIM_REGEX.hasByEn.test(raw);

  const mentionsPod = EXIM_REGEX.mentionsPod.test(raw);
  const mentionsCtr =
    EXIM_REGEX.mentionsCtr.test(raw) ||
    EXIM_REGEX.mentionsNegaraAsalTujuan.test(raw) ||
    EXIM_REGEX.mentionsAsalTujuan.test(raw);
  const mentionsHs = EXIM_REGEX.mentionsHs.test(raw);

  const hasDan = EXIM_REGEX.hasDan.test(raw);

  const wantsPodSolo = EXIM_REGEX.wantsPodSolo.test(raw) || EXIM_REGEX.wantsPodByEn.test(raw);
  const wantsCtrSolo =
    EXIM_REGEX.wantsCtrSolo.test(raw) ||
    EXIM_REGEX.wantsCtrByEn.test(raw) ||
    EXIM_REGEX.wantsCtrNegaraAsalTujuan.test(raw);
  const wantsHsSolo = EXIM_REGEX.wantsHsSolo.test(raw) || EXIM_REGEX.wantsHsByEn.test(raw);

  // Handle "<A> dan <B>" multi-dimension intent
  if ((hasMenurut || hasDan) && mentionsHs && mentionsCtr && !mentionsPod) return 'hs2ctr';
  if ((hasMenurut || hasDan) && mentionsHs && mentionsPod && !mentionsCtr) return 'hs2pod';
  if ((hasMenurut || hasDan) && mentionsCtr && mentionsPod && !mentionsHs) return 'detail';

  // Fallback: direct single-target phrases
  if (wantsPodSolo) return 'pod';
  if (wantsCtrSolo) return 'ctr';
  if (wantsHsSolo) return 'hs2';
  
  // Additional patterns for questions like "komoditas apa yang terbanyak"
  if (EXIM_REGEX.komoditasQuestion.test(raw)) return 'hs2';
  if (EXIM_REGEX.negaraQuestion.test(raw)) return 'ctr';
  if (EXIM_REGEX.pelabuhanQuestion.test(raw)) return 'pod';
  
  // "ke negara mana", "dari negara mana", "negara tujuan/asal" patterns
  if (EXIM_REGEX.keDariNegara.test(raw)) return 'ctr';
  if (EXIM_REGEX.negaraTujuanAsal.test(raw)) return 'ctr';
  if (EXIM_REGEX.tujuanAsalEksporImpor.test(raw)) return 'ctr';
  // "ekspor ke mana", "impor dari mana" patterns
  if (EXIM_REGEX.eksporKe.test(raw)) return 'ctr';
  if (EXIM_REGEX.imporDari.test(raw)) return 'ctr';
  
  // "terbanyak/terbesar untuk ekspor/impor" patterns
  if (EXIM_REGEX.terbanyakEksporImpor.test(raw) || EXIM_REGEX.eksporImporTerbanyak.test(raw)) {
    // Determine what dimension user wants - check ctr FIRST for country-related queries
    if (mentionsCtr) return 'ctr';
    if (mentionsHs) return 'hs2';
    if (mentionsPod) return 'pod';
    // Default to komoditas if asking about "terbanyak" without dimension
    return 'hs2';
  }
  
  // "negara terbanyak", "negara tertinggi" without apa/mana
  if (EXIM_REGEX.negaraTerbanyak.test(raw)) return 'ctr';
  if (EXIM_REGEX.terbanyakNegara.test(raw)) return 'ctr';
  
  return '';
}

/**
 * Extract EXIM facets from query (country, port, HS code)
 * @param {string} q - User query
 * @returns {{ ctr?: string; pod?: string; code_hs?: string }}
 */
function extractEximQueryFacets(q) {
  const raw = String(q || '').toLowerCase();
  if (!raw) return {};

  const tokens = raw.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/g).filter(Boolean);

  const takeAfter = (key) => {
    const idx = tokens.indexOf(key);
    if (idx < 0) return '';
    const out = [];
    for (let i = idx + 1; i < tokens.length; i++) {
      const t = tokens[i];
      if (!t) break;
      if (EXIM_STOP_WORDS.has(t)) break;
      if (MONTH_NAMES_SET.has(t)) break;
      if (EXIM_REGEX.yearPattern.test(t)) break;
      out.push(t);
      if (out.length >= 3) break;
    }
    return out.join(' ').trim();
  };

  const ctr = takeAfter('negara');
  const pod = takeAfter('pelabuhan');

  let code_hs;
  const hsMatch = raw.match(EXIM_REGEX.hsCode);
  if (hsMatch && hsMatch[1]) {
    const d = hsMatch[1].replace(/\D/g, '');
    if (d.length >= 2) code_hs = d.slice(0, 2);
  }

  const res = {};
  if (ctr) res.ctr = ctr;
  if (pod) res.pod = pod;
  if (code_hs) res.code_hs = code_hs;
  return res;
}

/**
 * Detect if query is about ekspor, impor, or both
 * @param {string} q - User query
 * @returns {'ekspor' | 'impor' | 'both' | null}
 */
function detectEximModeFromQuery(q) {
  const raw = String(q || '').toLowerCase();
  if (!raw) return null;
  const hasImpor = raw.includes('impor');
  const hasEkspor = raw.includes('ekspor');
  if (hasImpor && hasEkspor) return 'both';
  if (hasImpor) return 'impor';
  if (hasEkspor) return 'ekspor';
  return null;
}

/**
 * Extract month from query for EXIM filtering
 * Uses shared MONTH_MAP_NUMERIC utility
 * @param {string} q - User query
 * @returns {number | null}
 */
function extractEximMonth(q) {
  return extractMonthFromQuery(q);
}

/**
 * Convert month number to Indonesian name
 * @param {number} monthNo - Month number (1-12)
 * @returns {string | null}
 */
function monthNameFromNo(monthNo) {
  const map = {
    1: 'Januari', 2: 'Februari', 3: 'Maret', 4: 'April',
    5: 'Mei', 6: 'Juni', 7: 'Juli', 8: 'Agustus',
    9: 'September', 10: 'Oktober', 11: 'November', 12: 'Desember',
  };
  return map[monthNo] || null;
}

/**
 * Check if a query is EXIM-related
 * @param {string} q - User query
 * @returns {boolean}
 */
function isEximQuery(q) {
  const mode = detectEximModeFromQuery(q);
  return mode !== null;
}

module.exports = {
  EXIM_REGEX,
  inferEximGroupFromQuery,
  extractEximQueryFacets,
  detectEximModeFromQuery,
  extractEximMonth,
  monthNameFromNo,
  isEximQuery,
};
