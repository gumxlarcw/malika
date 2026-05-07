/**
 * Datasource & Knowledge Base Keyword Index Service
 *
 * Dynamically builds a keyword set from:
 *   1. All data_sources names + aliases
 *   2. All knowledge_base.keywords (LLM-extracted from BRS/publications)
 *
 * Used by isKnowledgeTypeQuery() and hasSubstantiveKeywords() to detect
 * data-related queries WITHOUT hardcoding every indicator acronym.
 *
 * Refreshes automatically every 30 minutes or on demand.
 *
 * Exports:
 *   - initDatasourceKeywordIndex()   — call once at startup
 *   - isDatasourceKeyword(word)      — check if a single word is a known indicator
 *   - queryMatchesDatasource(query)  — check if query contains any datasource keyword
 *   - getDatasourceKeywords()        — get the full Set (for debugging)
 */

'use strict';

const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 min

// Store interval ref for cleanup/testing
let _refreshTimer = null;

// ── In-memory keyword index ────────────────────────────────────────────────
/** @type {Set<string>} */
let _keywords = new Set();

/** @type {RegExp|null} */
let _keywordRegex = null;

let _lastRefresh = 0;
let _initialized = false;

// ── Synonym expansion map ──────────────────────────────────────────────────
// When we index a keyword, we also add its synonyms to the index.
// This closes the gap where "kemiskinan" is indexed but user types "miskin".
// Bidirectional: all forms in a group are added when any one is found.
const SYNONYM_GROUPS = [
  // Poverty
  ['kemiskinan', 'miskin', 'penduduk miskin', 'poverty', 'garis kemiskinan'],
  // Unemployment
  ['pengangguran', 'nganggur', 'tpt', 'tingkat pengangguran terbuka', 'unemployment'],
  // Migration
  ['migrasi', 'pendatang', 'perpindahan', 'mobilitas penduduk', 'imigrasi'],
  // Population
  ['penduduk', 'populasi', 'demografi', 'population', 'kependudukan'],
  // Inflation  
  ['inflasi', 'ihk', 'indeks harga konsumen', 'inflation', 'harga konsumen'],
  // GDP
  ['pdrb', 'produk domestik regional bruto', 'gdp', 'pertumbuhan ekonomi', 'ekonomi'],
  // HDI
  ['ipm', 'indeks pembangunan manusia', 'human development', 'hdi'],
  // Labor
  ['ketenagakerjaan', 'naker', 'tenaga kerja', 'angkatan kerja', 'tpak', 'employment', 'labor'],
  // Agriculture
  ['pertanian', 'agriculture', 'petani', 'tanaman pangan', 'panen', 'luas panen'],
  // Fishery
  ['perikanan', 'ikan', 'nelayan', 'fishery', 'budidaya', 'tangkap'],
  // Export/Import
  ['ekspor', 'impor', 'perdagangan luar negeri', 'exim', 'neraca perdagangan', 'trade'],
  // Tourism
  ['pariwisata', 'wisatawan', 'tourist', 'tourism', 'hotel', 'tpk', 'okupansi'],
  // Education
  ['pendidikan', 'sekolah', 'education', 'siswa', 'murid', 'apk', 'apm', 'hls', 'rls'],
  // Health
  ['kesehatan', 'health', 'rumah sakit', 'puskesmas', 'kematian', 'kelahiran'],
  // Inequality
  ['gini', 'gini ratio', 'ketimpangan', 'inequality', 'distribusi pendapatan'],
  // GRDP components
  ['pmtb', 'pembentukan modal tetap bruto', 'investasi', 'capital formation'],
  // Farmer terms of trade
  ['ntp', 'nilai tukar petani', 'farmer terms of trade'],
  // Construction
  ['konstruksi', 'bangunan', 'construction', 'perusahaan konstruksi'],
  // Manufacturing
  ['manufaktur', 'industri manufaktur', 'industri pengolahan', 'manufacturing', 'pabrik'],
  // Mining
  ['pertambangan', 'tambang', 'mining', 'mineral', 'nikel', 'galian'],
  // Transportation
  ['transportasi', 'angkutan', 'transportation', 'kendaraan', 'penumpang'],
  // Welfare
  ['kesejahteraan', 'welfare', 'sosial', 'kesejahteraan rakyat'],
  // Price
  ['harga', 'price', 'harga pangan', 'harga produsen'],
  // Banking
  ['perbankan', 'bank', 'banking', 'kredit', 'tabungan', 'koperasi'],
  // Energy
  ['energi', 'listrik', 'energy', 'bbm', 'electricity'],
  // Stunting / nutrition
  ['stunting', 'gizi', 'gizi buruk', 'nutrisi', 'malnutrisi'],
  // Wages
  ['upah', 'gaji', 'wages', 'salary', 'pendapatan'],
];

// Build reverse lookup: keyword → all synonyms in its group
const _synonymLookup = new Map();
for (const group of SYNONYM_GROUPS) {
  for (const term of group) {
    _synonymLookup.set(term, group);
  }
}

/**
 * Given a keyword, return all its synonyms (including itself).
 * @param {string} keyword
 * @returns {string[]}
 */
function getSynonyms(keyword) {
  const group = _synonymLookup.get(keyword);
  return group || [keyword];
}

// ── Core statistical keywords (tier 1) — strongest match signal ────────────
// These are the most important BPS indicators. A match on these is a strong
// signal the query is data-related (vs "domain" keywords like crop names).
const CORE_KEYWORDS = new Set([
  // Economics
  'pdrb', 'inflasi', 'ihk', 'ipm', 'tpt', 'tpak', 'gini', 'pmtb', 'ntp',
  'ekspor', 'impor', 'pertumbuhan ekonomi', 'kemiskinan', 'pengangguran',
  // Demographics
  'penduduk', 'populasi', 'migrasi', 'fertilitas', 'mortalitas',
  // Key sectors
  'ketenagakerjaan', 'kesejahteraan', 'pendidikan', 'kesehatan',
  // Top indicators
  'upah', 'gaji', 'harga', 'produksi', 'konsumsi',
  'apbd', 'apbn', 'stunting', 'perikanan', 'pertanian',
  'konstruksi', 'manufaktur', 'pertambangan', 'pariwisata', 'transportasi',
  'perbankan', 'energi',
]);

// ── Stopwords to exclude from indexing ─────────────────────────────────────
const STOPWORDS = new Set([
  'data', 'dan', 'di', 'ke', 'dari', 'yang', 'untuk', 'dengan', 'pada', 'atau',
  'dalam', 'ini', 'itu', 'adalah', 'serta', 'oleh', 'sebagai', 'secara',
  'menurut', 'per', 'tahun', 'bulan', 'provinsi', 'kabupaten', 'kota',
  'maluku', 'utara', 'indonesia', 'bps', 'statistik',
  'seri', 'baru', 'metode', 'tabel', 'angka', 'jumlah', 'jenis',
  'hasil', 'long', 'form', 'berdasarkan', 'tentang',
  // Common datasource name parts that are too generic
  'based', 'index', 'total', 'nilai', 'umur', 'status',
  // Time/generic words that cause false positives
  'hari', 'waktu', 'lama', 'masa', 'pagi', 'malam', 'siang',
]);

// ── Known valid acronyms (2-3 chars) — whitelist for short terms ───────────
// Only these short terms are allowed through the length filter.
const KNOWN_ACRONYMS = new Set([
  // Economics
  'ipm', 'tpt', 'ihk', 'ntb', 'ntm', 'ntp', 'ntr', 'tpk', 'pdb', 'umk', 'umr',
  'tpak', 'apbd', 'apbn', 'pdrb', 'pmtb', 'gini', 'ddi', 'fdi',
  // Trade
  'fob', 'cif', 'pod', 'hts',
  // Demographics
  'cpw', 'tfr', 'imr', 'mmr', 'cdr', 'cbr', 'adr', 'uhh', 'umb', 'amh',
  // Education
  'apk', 'apm', 'hls', 'rls', 'asn',
  'sd', 'mi', 'ma', 'tk', 'ra', 'smp', 'sma', 'smk',  // school levels
  // Agriculture
  'gkg', 'gkp',
  // Health
  'hiv', 'dbd', 'tbc',
  // Energy
  'bbm', 'lpg',
  // ICT
  'ict', 'ikt',
  // Other statistical
  'idg', 'idi', 'ikg', 'ikk', 'ipg', 'ipi',
  'brs', 'sph',
  // Units & currency
  'rp', 'm3',
]);

// ── Noise patterns — reject these even if they pass length filter ──────────
const NOISE_PATTERNS = [
  /^\d+$/,                    // Pure numbers: 2010, 100000, 724
  /^[a-f0-9]{16,}$/i,         // Hex hashes
  /^(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+\d{4}$/i,  // "februari 2016"
  /^tahun\s+\d{4}$/i,         // "tahun 2010"
];

function isNoise(keyword) {
  return NOISE_PATTERNS.some(p => p.test(keyword));
}

// ── Well-known statistical terms — always included as baseline ─────────────
// Terms that users commonly search for but might not appear in DB names
const BASELINE_KEYWORDS = [
  // Coverage gaps found in audit
  'pmtb', 'upah', 'transportasi', 'ntb', 'stunting', 'sawit',
  // Additional common BPS terms
  'gaji', 'pendapatan', 'belanja', 'tabungan', 'kredit',
  'kelahiran', 'kematian', 'nikah', 'cerai', 'talak',
  'pupuk', 'pestisida', 'irigasi', 'nelayan',
  'wisatawan', 'turis', 'hotel', 'penginapan',
  'sampah', 'polusi', 'limbah', 'emisi',
  'kecelakaan', 'kriminal', 'kejahatan',
  'disabilitas', 'lansia', 'balita', 'bayi',
  'subsidi', 'bansos', 'pkh', 'blt', 'bpnt',
  'tenaga kerja', 'angkatan kerja', 'pengangguran terbuka',
  'harapan hidup', 'lama sekolah', 'melek huruf',
  'daya beli', 'paritas', 'purchasing power',
];

// ── Well-known acronyms — always included even if short ────────────────────
// These are extracted ADDITIONALLY from parenthesized expressions in names
// e.g. "Indeks Pembangunan Manusia (IPM)" → extracts "ipm"
const ACRONYM_PATTERN = /\(([A-Z][A-Za-z0-9]{1,8})\)/g;

/**
 * Extract meaningful keywords from a datasource name + aliases string.
 * Returns lowercase tokens.
 */
function extractKeywords(name, aliases) {
  const tokens = new Set();

  const combined = `${name || ''} ${aliases || ''}`;

  // 1. Extract acronyms from parentheses: (IPM), (PMTB), (TPT), etc.
  let m;
  const acronymRe = /\(([A-Z][A-Za-z0-9/]{1,12})\)/g;
  while ((m = acronymRe.exec(combined)) !== null) {
    const acr = m[1].toLowerCase();
    if (acr.length >= 2 && !STOPWORDS.has(acr)) {
      tokens.add(acr);
    }
  }

  // 2. Tokenize the entire string
  const words = combined
    .replace(/\([^)]*\)/g, ' ')       // remove parenthesized text (already extracted)
    .replace(/\[([^\]]*)\]/g, '$1')   // unwrap brackets: [Seri 2010] → Seri 2010
    .toLowerCase()
    .split(/[\s,;/|•–—]+/)
    .map(w => w.replace(/[^a-z0-9]/g, ''))
    .filter(w => w.length >= 3);

  for (const w of words) {
    if (STOPWORDS.has(w) || isNoise(w)) continue;
    // Short words (3 chars) from tokenization: must be known acronym
    if (w.length <= 3 && !KNOWN_ACRONYMS.has(w)) continue;
    tokens.add(w);
  }

  // 3. Extract multi-word phrases from aliases (comma-separated)
  if (aliases) {
    const aliasList = aliases.split(',').map(a => a.trim().toLowerCase()).filter(a => a.length >= 2);
    for (const alias of aliasList) {
      if (STOPWORDS.has(alias) || isNoise(alias)) continue;
      // Short single-word aliases: must be known acronym
      if (alias.length <= 3 && !alias.includes(' ') && !KNOWN_ACRONYMS.has(alias)) continue;
      tokens.add(alias);
    }
  }

  return tokens;
}

/**
 * Build a single RegExp that matches any keyword as a whole word.
 * Uses alternation: \b(keyword1|keyword2|...)\b
 */
function buildRegex(keywords) {
  if (keywords.size === 0) return null;

  // Sort by length descending so longer phrases match first
  const sorted = [...keywords].sort((a, b) => b.length - a.length);

  // Escape regex special chars in each keyword
  const escaped = sorted.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  // For multi-word phrases, use the phrase as-is with \b boundaries
  // For single words, also use \b
  return new RegExp(`\\b(${escaped.join('|')})\\b`, 'i');
}

/**
 * Load all datasource names + aliases AND knowledge_base keywords from DB
 * and build the unified keyword index.
 */
async function refreshIndex() {
  try {
    const DataSource = require('../../models/DataSource.model');
    const sources = await DataSource.findAll({
      attributes: ['id', 'name', 'aliases', 'category'],
      where: { visible: true },
      raw: true,
    });

    const newKeywords = new Set();

    // 1. Keywords from datasources (names + aliases)
    for (const ds of sources) {
      const tokens = extractKeywords(ds.name, ds.aliases);
      for (const t of tokens) {
        newKeywords.add(t);
      }
    }

    const dsCount = newKeywords.size;

    // 2. Keywords from knowledge_base (LLM-extracted from BRS/publications)
    let kbKeywordCount = 0;
    try {
      const KnowledgeBase = require('../../models/KnowledgeBase.model');
      const { Sequelize } = require('sequelize');
      const kbDocs = await KnowledgeBase.findAll({
        attributes: ['keywords'],
        where: {
          keywords: { [Sequelize.Op.not]: null },
          parent_id: null,  // Only parent docs (not chunks)
        },
        raw: true,
      });

      for (const doc of kbDocs) {
        if (!doc.keywords) continue;
        // Parse comma-separated keywords
        const parts = doc.keywords.split(',').map(k => k.trim().toLowerCase()).filter(k => k.length >= 2);
        for (const kw of parts) {
          if (STOPWORDS.has(kw) || isNoise(kw)) continue;
          // Short keywords (2-3 chars) must be in the known acronym whitelist
          if (kw.length <= 3 && !KNOWN_ACRONYMS.has(kw)) continue;
          newKeywords.add(kw);
          kbKeywordCount++;
        }
      }
    } catch (kbErr) {
      // knowledge_base might not have keywords column yet, or other issues
      console.warn('[DatasourceKeywordIndex] KB keyword load failed (non-fatal):', kbErr?.message);
    }

    // 3. Baseline keywords — always present regardless of DB content
    for (const bk of BASELINE_KEYWORDS) {
      newKeywords.add(bk);
    }

    // 4. Synonym expansion — for every indexed keyword, add its synonym group
    const preExpansion = newKeywords.size;
    const toAdd = [];
    for (const kw of newKeywords) {
      const syns = getSynonyms(kw);
      for (const s of syns) {
        if (!newKeywords.has(s)) toAdd.push(s);
      }
    }
    for (const s of toAdd) newKeywords.add(s);
    const synonymsAdded = newKeywords.size - preExpansion;

    _keywords = newKeywords;
    _keywordRegex = buildRegex(newKeywords);
    _lastRefresh = Date.now();

    console.log(`[DatasourceKeywordIndex] Loaded ${newKeywords.size} keywords (${dsCount} from ${sources.length} datasources + ${kbKeywordCount} from knowledge_base + ${synonymsAdded} synonyms)`);
  } catch (err) {
    console.warn('[DatasourceKeywordIndex] Failed to refresh:', err?.message);
    // Keep existing index
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Initialize the index. Call once at startup after DB is ready.
 * Sets up auto-refresh every 30 minutes.
 */
async function initDatasourceKeywordIndex() {
  if (_initialized) return;
  _initialized = true;
  await refreshIndex();
  _refreshTimer = setInterval(refreshIndex, REFRESH_INTERVAL_MS);
}

/**
 * Check if a single word/token matches a datasource keyword.
 * @param {string} word
 * @returns {boolean}
 */
function isDatasourceKeyword(word) {
  if (!word) return false;
  return _keywords.has(String(word).toLowerCase().trim());
}

/**
 * Check if a query string contains any known datasource keyword.
 * Uses the pre-built regex for fast matching.
 * @param {string} query
 * @returns {boolean}
 */
function queryMatchesDatasource(query) {
  if (!query || !_keywordRegex) return false;
  return _keywordRegex.test(String(query));
}

/**
 * Check query match strength: returns 'core' for top-tier statistical terms,
 * 'domain' for any known keyword, or null for no match.
 * Useful for callers that want to differentiate strong vs weak signals.
 * @param {string} query
 * @returns {'core'|'domain'|null}
 */
function queryMatchStrength(query) {
  if (!query || !_keywordRegex) return null;
  const q = String(query).toLowerCase().trim();
  
  // Check core keywords first (strongest signal)
  for (const core of CORE_KEYWORDS) {
    if (q.includes(core)) return 'core';
  }
  
  // Check any keyword
  if (_keywordRegex.test(q)) return 'domain';
  
  return null;
}

/**
 * Get the full keyword set (for debugging).
 * @returns {Set<string>}
 */
function getDatasourceKeywords() {
  return _keywords;
}

// ── Exports ────────────────────────────────────────────────────────────────
module.exports = {
  initDatasourceKeywordIndex,
  isDatasourceKeyword,
  queryMatchesDatasource,
  queryMatchStrength,
  getDatasourceKeywords,
  CORE_KEYWORDS,
  // For testing:
  extractKeywords,
  refreshIndex,
};
