/**
 * DNA Nucleus API Service
 *
 * Queries the BPS DNA (Data Nucleus Architecture) API for authoritative
 * metadata about statistical activities (kegiatan), variables, and indicators.
 *
 * Base URL: https://dna.web.bps.go.id/api
 * Endpoints:
 *   - /metadata/mskeg/search  → kegiatan statistik (surveys, censuses)
 *   - /metadata/msvar/search  → statistical variables
 *   - /metadata/msind/search  → statistical indicators
 *
 * Authentication: Bearer JWT via env DNA_NUCLEUS_API_KEY_BPS
 *
 * Features:
 *   - DB-persistent cache (MySQL dna_cache table) — search from DB first
 *   - BPS source detection (Direktorat for MSVAR/MSIND, STATISTIK_DASAR for MSKEG)
 *   - In-memory cache (1hr TTL) for hot-path performance
 *   - URL params: province=00&city=0000 for all 3 endpoints (filters to BPS pusat)
 *
 * Used by:
 *   - bpsAbbreviations.js  (dynamic abbreviation lookup)
 *   - pipeline.service.js  (enrich context with authoritative definitions)
 *   - streaming.service.js (legacy pipeline enrichment)
 *
 * @module services/dna/dnaNucleus
 */

'use strict';

const logger = require('../../utils/logger').child({ service: 'DnaNucleus' });

// ── Configuration ─────────────────────────────────────────────────────────

const DNA_BASE_URL = 'https://dna.web.bps.go.id/api';
const DEFAULT_PROVINCE = '00';   // Nasional
const DEFAULT_CITY = '0000';     // Pusat (all cities)
const DEFAULT_LENGTH = 100;      // Get more results to persist in DB
const SEARCH_LENGTH = 100;       // API search length (get comprehensive results)
const REQUEST_TIMEOUT_MS = 25000; // DNA API can be slow (MSVAR ~17s, need margin)

// ── DNA stem map ──────────────────────────────────────────────────────────
// Explicit mapping of terms that benefit from an ADDITIONAL root-word search
// in the DNA API. Both the original AND the stem are searched, results merged.
//
// Built from empirical quality testing (2026-02-14):
//   kemiskinan→miskin: adds "Penduduk Miskin di Daerah Tertinggal" ✓
//   kelahiran→lahir:   adds "UHH saat Lahir" ✓
//   pertumbuhan→tumbuh: same quality, more MSVAR hits ✓
//
// EXCLUDED (stem produces noise / irrelevant results):
//   pengangguran→anggur: "anggur" = grape → noise
//   pengeluaran→keluar:  "keluar" → "keluarga" noise
//   pendapatan→dapat:    "dapat" → "dapat digunakan" noise
//   kematian→mati:       "mati" → "kehidupan sesudah mati" noise
//   kepadatan→padat:     "padat" → "limbah padat" noise
//   pembangunan→bangun:  "bangun" → "rancang bangun" noise
//   kekayaan→kaya:       "kaya" → "perekayasaan" noise

// ── Kegiatan abbreviation map ─────────────────────────────────────────
// Maps full survey names (from variabel_pembangun.kegiatan_penghasil) to
// their commonly-known short names for MSKEG search.
const KEGIATAN_ABBREV_MAP = {
  'survei sosial ekonomi nasional': 'Susenas',
  'survei angkatan kerja nasional': 'Sakernas',
  'sensus penduduk': 'Sensus Penduduk',
  'survei penduduk antar sensus': 'SUPAS',
  'survei demografi dan kesehatan': 'SDKI',
  'survei biaya hidup': 'SBH',
  'survei harga konsumen': 'SHK',
  'sensus ekonomi': 'Sensus Ekonomi',
  'sensus pertanian': 'Sensus Pertanian',
  'survei industri': 'Survei Industri',
  'survei pertanian antar sensus': 'SUTAS',
  'survei struktur ongkos usaha': 'SUSI',
  'survei pola konsumsi': 'Susenas',
};

// ── Direct kegiatan query keywords ───────────────────────────────────
const KEGIATAN_QUERY_KEYWORDS = [
  'susenas', 'sakernas', 'supas', 'sdki', 'sensus', 'survei',
  'registrasi', 'kegiatan statistik', 'kegiatan', 'survey',
  'sutas', 'susi', 'sbh', 'shk',
];

const DNA_STEM_MAP = new Map([
  ['kemiskinan', 'miskin'],
  ['kelahiran', 'lahir'],
  ['pertumbuhan', 'tumbuh'],
  ['ketenagakerjaan', 'tenaga kerja'],
  ['ketimpangan', 'gini'],           // conceptual synonym, not stem
  ['perdagangan', 'dagang'],
  ['peternakan', 'ternak'],
  ['perkebunan', 'kebun'],
  ['perhubungan', 'transportasi'],   // conceptual synonym
  ['kependudukan', 'penduduk'],
  ['perindustrian', 'industri'],
]);

/**
 * Get alternative search term for DNA API (if exists).
 * Returns null if no beneficial stem exists for this term.
 * @param {string} term
 * @returns {string|null}
 */
function _getDnaStem(term) {
  if (!term) return null;
  return DNA_STEM_MAP.get(term.toLowerCase()) || null;
}

/**
 * Check if user query is directly asking about a kegiatan/survey.
 * When true, MSKEG is searched with the user's original term.
 * When false, MSKEG search term is derived from MSIND variabel_pembangun.
 *
 * @param {string} title
 * @returns {boolean}
 */
function _isDirectKegiatanQuery(title) {
  if (!title) return false;
  const lower = title.toLowerCase();
  return KEGIATAN_QUERY_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Simplify a kegiatan_penghasil name for MSKEG search.
 * Maps full survey names to known abbreviations, or strips " BPS" suffix.
 *
 * Examples:
 *   "Survei Sosial Ekonomi Nasional" → "Susenas"
 *   "Susenas BPS" → "Susenas"
 *   "Unknown Survey" → "Unknown Survey"
 *
 * @param {string} name
 * @returns {string|null}
 */
function _simplifyKegiatanName(name) {
  if (!name) return null;
  const lower = name.toLowerCase().replace(/\s+bps$/i, '').trim();
  if (!lower) return null;

  // Check known abbreviation map
  for (const [full, abbrev] of Object.entries(KEGIATAN_ABBREV_MAP)) {
    if (lower.includes(full)) return abbrev;
  }

  // Return cleaned name (without " BPS" suffix)
  return name.replace(/\s+BPS$/i, '').trim();
}

/**
 * Extract unique kegiatan (survey/activity) names from MSIND variabel_pembangun.
 * The variabel_pembangun field is a JSON string:
 *   [{"nama": "...", "kegiatan_penghasil": ["Survei Sosial Ekonomi Nasional"]}, ...]
 *
 * @param {object[]} indicatorResults - MSIND results with variabelPembangun field
 * @returns {string[]} Unique simplified kegiatan search terms
 */
function _extractKegiatanPenghasil(indicatorResults) {
  const seen = new Set();  // case-insensitive dedup
  const kegiatan = [];
  for (const item of (indicatorResults || [])) {
    const raw = item.variabelPembangun;
    if (!raw) continue;
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!Array.isArray(parsed)) continue;
      for (const vp of parsed) {
        if (!vp.kegiatan_penghasil || !Array.isArray(vp.kegiatan_penghasil)) continue;
        for (const kpName of vp.kegiatan_penghasil) {
          if (!kpName || typeof kpName !== 'string') continue;
          const simplified = _simplifyKegiatanName(kpName.trim());
          if (simplified) {
            const key = simplified.toLowerCase();
            if (!seen.has(key)) {
              seen.add(key);
              kegiatan.push(simplified);
            }
          }
        }
      }
    } catch { /* ignore parse errors */ }
  }
  return kegiatan;
}

// ── Cache (1-hour TTL) ────────────────────────────────────────────────────

const _cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_CACHE_SIZE = 200;

function _getCached(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    _cache.delete(key);
    return null;
  }
  return entry.data;
}

function _setCache(key, data) {
  // Evict oldest entries if cache is full
  if (_cache.size >= MAX_CACHE_SIZE) {
    const oldest = _cache.keys().next().value;
    _cache.delete(oldest);
  }
  _cache.set(key, { data, ts: Date.now() });
}

// ── Internal fetch helper ─────────────────────────────────────────────────

/**
 * Fetch from DNA API with timeout and auth.
 * @param {string} endpoint - e.g. '/metadata/msvar/search'
 * @param {URLSearchParams} params
 * @returns {Promise<object|null>} Parsed JSON or null on error
 */
async function _fetchDNA(endpoint, params) {
  const apiKey = process.env.DNA_NUCLEUS_API_KEY_BPS;
  if (!apiKey) {
    logger.warn('DNA_NUCLEUS_API_KEY_BPS not set — skipping DNA lookup');
    return null;
  }

  const url = `${DNA_BASE_URL}${endpoint}?${params.toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      logger.warn({ status: res.status, endpoint }, 'DNA API non-OK response');
      return null;
    }

    const json = await res.json();
    if (!json?.status || !json?.result?.data) {
      logger.debug({ endpoint, hit: json?.hit }, 'DNA API returned no data');
      return null;
    }

    return json;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      logger.warn({ endpoint }, 'DNA API request timed out');
    } else {
      logger.warn({ endpoint, error: err.message }, 'DNA API request failed');
    }
    return null;
  }
}

// ── DB persistence layer (MySQL dna_cache table) ──────────────────────────

let DnaCache = null;

/**
 * Lazy-load DnaCache model. Called at first DB operation.
 * Avoids circular dependency issues during server startup.
 */
function _getModel() {
  if (!DnaCache) {
    try {
      DnaCache = require('../../models/DnaCache.model');
    } catch (e) {
      logger.warn({ error: e.message }, 'DnaCache model not available — DB caching disabled');
    }
  }
  return DnaCache;
}

/**
 * Check if producer name indicates a BPS (Direktorat) source.
 * Used for MSVAR and MSIND endpoints.
 *
 * @param {string} produsen - produsen_data_name from API response
 * @returns {boolean}
 */
function _isBpsProducer(produsen) {
  if (!produsen) return false;
  return produsen.toLowerCase().includes('direktorat');
}

/**
 * Search for DNA results in the MySQL dna_cache table.
 * Returns mapped objects matching the in-memory format.
 *
 * @param {'msvar'|'msind'|'mskeg'} endpoint
 * @param {string} searchTerm
 * @param {number} limit
 * @returns {Promise<object[]>}
 */
async function _searchFromDb(endpoint, searchTerm, limit = 100) {
  const Model = _getModel();
  if (!Model) return [];

  try {
    const rows = await Model.findAll({
      where: {
        search_term: searchTerm.toLowerCase(),
        endpoint,
      },
      limit,
      order: [['is_bps', 'DESC'], ['id', 'ASC']], // BPS first
    });

    if (!rows || rows.length === 0) return [];

    // Map DB rows back to the in-memory format
    return rows.map(row => _dbRowToResult(row, endpoint));
  } catch (e) {
    logger.debug({ error: e.message, endpoint, searchTerm }, 'DNA DB search failed');
    return [];
  }
}

/**
 * Map a DB row back to the service result format.
 * @param {object} row - Sequelize model instance
 * @param {string} endpoint
 * @returns {object}
 */
function _dbRowToResult(row, endpoint) {
  const base = {
    dna_id: row.dna_id,
    isBps: row.is_bps,
    produsenDataName: row.produsen_data_name || '',
    produsenProvinceCode: row.produsen_province_code || '',
    produsenCityCode: row.produsen_city_code || '',
  };

  if (endpoint === 'msvar') {
    return {
      ...base,
      nama: row.nama || '',
      alias: row.alias || '',
      konsep: row.konsep || '',
      definisi: row.definisi || '',
      satuan: row.satuan || '',
      ukuran: row.ukuran || '',
      referensiWaktu: row.referensi_waktu || '',
    };
  }

  if (endpoint === 'msind') {
    return {
      ...base,
      nama: row.nama || '',
      konsep: row.konsep || '',
      definisi: row.definisi || '',
      satuan: row.satuan || '',
      ukuran: row.ukuran || '',
      variabelPembangun: row.variabel_pembangun || '',
    };
  }

  // mskeg
  return {
    ...base,
    judul: row.nama || '',       // MSKEG stores judul in nama column
    tujuan: row.tujuan || '',
    metode: row.metode || '',
    frekuensi: row.frekuensi || '',
    latarBelakang: '',           // Not stored in DB (low value field)
    tahun: row.tahun || '',
    jenisStatistik: row.jenis_statistik || '',
  };
}

/**
 * Persist DNA API results to MySQL dna_cache table.
 * Uses bulkCreate with updateOnDuplicate for upsert behavior.
 *
 * @param {'msvar'|'msind'|'mskeg'} endpoint
 * @param {string} searchTerm
 * @param {object[]} results - Mapped result objects from API
 */
async function _persistToDb(endpoint, searchTerm, results) {
  const Model = _getModel();
  if (!Model || !results || results.length === 0) return;

  const termLower = searchTerm.toLowerCase();
  const now = new Date();

  const rows = results.map(item => {
    const base = {
      endpoint,
      search_term: termLower,
      dna_id: item.dna_id || null,
      is_bps: item.isBps || false,
      produsen_data_name: item.produsenDataName || null,
      produsen_province_code: item.produsenProvinceCode || null,
      produsen_city_code: item.produsenCityCode || null,
      fetched_at: now,
    };

    if (endpoint === 'msvar') {
      return {
        ...base,
        nama: item.nama || null,
        alias: item.alias || null,
        konsep: item.konsep || null,
        definisi: item.definisi || null,
        satuan: item.satuan || null,
        ukuran: item.ukuran || null,
        referensi_waktu: item.referensiWaktu || null,
      };
    }

    if (endpoint === 'msind') {
      return {
        ...base,
        nama: item.nama || null,
        konsep: item.konsep || null,
        definisi: item.definisi || null,
        satuan: item.satuan || null,
        ukuran: item.ukuran || null,
        variabel_pembangun: item.variabelPembangun || null,
      };
    }

    // mskeg
    return {
      ...base,
      nama: item.judul || null,     // Store judul in nama column
      tujuan: item.tujuan || null,
      metode: item.metode || null,
      frekuensi: item.frekuensi || null,
      tahun: item.tahun || null,
      jenis_statistik: item.jenisStatistik || null,
    };
  });

  try {
    // Use bulkCreate; items without dna_id can't use unique constraint,
    // so we handle individually for those
    const withDnaId = rows.filter(r => r.dna_id != null);
    const withoutDnaId = rows.filter(r => r.dna_id == null);

    if (withDnaId.length > 0) {
      await Model.bulkCreate(withDnaId, {
        updateOnDuplicate: [
          'search_term', 'nama', 'alias', 'definisi', 'konsep',
          'satuan', 'ukuran', 'referensi_waktu', 'tujuan', 'metode',
          'frekuensi', 'tahun', 'jenis_statistik', 'produsen_data_name',
          'produsen_province_code', 'produsen_city_code', 'is_bps', 'fetched_at',
          'variabel_pembangun',
        ],
      });
    }

    if (withoutDnaId.length > 0) {
      // For items without dna_id, just insert (ignore if exists)
      await Model.bulkCreate(withoutDnaId, { ignoreDuplicates: true });
    }

    logger.debug({
      endpoint,
      searchTerm: termLower,
      persisted: rows.length,
    }, 'DNA results persisted to DB');
  } catch (e) {
    logger.debug({ error: e.message, endpoint }, 'DNA DB persist failed');
  }
}

// ── Public search functions ───────────────────────────────────────────────

/**
 * Search kegiatan statistik (surveys, censuses, registrations).
 *
 * @param {string} title - Search term (e.g. "SAKERNAS", "Survei Angkatan Kerja")
 * @param {object} [opts]
 * @param {string} [opts.province='00'] - Province code
 * @param {number} [opts.length=5]      - Max results
 * @returns {Promise<DnaKegiatan[]>}
 *
 * @typedef {Object} DnaKegiatan
 * @property {string} judul   - Activity title
 * @property {string} tujuan  - Purpose/objective
 * @property {string} metode  - Data collection method
 * @property {string} frekuensi - Frequency
 */
async function searchKegiatan(title, opts = {}) {
  const province = opts.province || DEFAULT_PROVINCE;
  const length = opts.length || SEARCH_LENGTH;
  const cacheKey = `mskeg:${title.toLowerCase()}:${province}:${length}`;

  const cached = _getCached(cacheKey);
  if (cached) return cached;

  // Try DB first
  const dbResults = await _searchFromDb('mskeg', title, length);
  if (dbResults.length > 0) {
    _setCache(cacheKey, dbResults);
    logger.debug({ title, hits: dbResults.length, source: 'db' }, 'DNA MSKEG search completed');
    return dbResults;
  }

  // MSKEG uses province + city params
  const params = new URLSearchParams({ province, city: DEFAULT_CITY, title, length: String(length), page: '1' });
  const json = await _fetchDNA('/metadata/mskeg/search', params);
  if (!json) return [];

  const results = json.result.data.map(item => {
    const jenisStatistik = item.jenis_statistik || '';
    const isBps = jenisStatistik === 'STATISTIK_DASAR';
    return {
      dna_id: item.id || null,
      judul: item.judul_kegiatan || '',
      tujuan: item.iii_tujuan_kegiatan || '',
      metode: item.cara_pengumpulan_data || '',
      frekuensi: item.iv_frekuensi_penyelanggara || '',
      latarBelakang: item.iii_latar_belakang_kegiatan || '',
      tahun: item.tahun || '',
      jenisStatistik,
      produsenDataName: item.produsen_data_name || item.ii_unit_eselon2 || '',
      produsenProvinceCode: item.produsen_data_province_code || '',
      produsenCityCode: item.produsen_data_city_code || '',
      isBps,
    };
  });

  // Persist to DB (fire & forget)
  _persistToDb('mskeg', title, results).catch(e =>
    logger.debug({ error: e.message }, 'DNA MSKEG DB persist failed')
  );

  _setCache(cacheKey, results);
  logger.debug({ title, hits: results.length, source: 'api' }, 'DNA MSKEG search completed');
  return results;
}

/**
 * Search statistical variables (MSVAR).
 *
 * @param {string} title - Search term (e.g. "PMTB", "Inflasi")
 * @param {object} [opts]
 * @param {string} [opts.province='00']
 * @param {number} [opts.length=5]
 * @returns {Promise<DnaVariable[]>}
 *
 * @typedef {Object} DnaVariable
 * @property {string} nama     - Variable name
 * @property {string} alias    - Short alias/abbreviation
 * @property {string} konsep   - Conceptual framework
 * @property {string} definisi - Official definition
 * @property {string} satuan   - Unit of measurement
 * @property {string} ukuran   - Measurement type
 * @property {string} referensiWaktu - Time reference
 * @property {string} produsen - Data producer
 */
async function searchVariable(title, opts = {}) {
  const province = opts.province || DEFAULT_PROVINCE;
  const length = opts.length || SEARCH_LENGTH;
  const cacheKey = `msvar:${title.toLowerCase()}:${province}:${length}`;

  const cached = _getCached(cacheKey);
  if (cached) return cached;

  // Try DB first
  const dbResults = await _searchFromDb('msvar', title, length);
  if (dbResults.length > 0) {
    _setCache(cacheKey, dbResults);
    logger.debug({ title, hits: dbResults.length, source: 'db' }, 'DNA MSVAR search completed');
    return dbResults;
  }

  // All endpoints use province + city params (filters to BPS pusat data)
  const params = new URLSearchParams({ province, city: DEFAULT_CITY, title, length: String(length), page: '1' });
  const json = await _fetchDNA('/metadata/msvar/search', params);
  if (!json) return [];

  const results = json.result.data.map(item => {
    const produsen = item.produsen_data_name || '';
    const isBps = _isBpsProducer(produsen);
    return {
      dna_id: item.id || null,
      nama: item.nama || '',
      alias: item.alias || '',
      konsep: item.konsep || '',
      definisi: item.definisi || '',
      satuan: item.satuan || '',
      ukuran: item.ukuran || '',
      referensiWaktu: item.referensi_waktu || '',
      produsenDataName: produsen,
      produsenProvinceCode: item.produsen_data_province_code || '',
      produsenCityCode: item.produsen_data_city_code || '',
      isBps,
    };
  });

  // Persist to DB (fire & forget)
  _persistToDb('msvar', title, results).catch(e =>
    logger.debug({ error: e.message }, 'DNA MSVAR DB persist failed')
  );

  _setCache(cacheKey, results);
  logger.debug({ title, hits: results.length, source: 'api' }, 'DNA MSVAR search completed');
  return results;
}

/**
 * Search statistical indicators (MSIND).
 *
 * @param {string} title - Search term (e.g. "IPM", "Inflasi")
 * @param {object} [opts]
 * @param {string} [opts.province='00']
 * @param {number} [opts.length=5]
 * @returns {Promise<DnaIndicator[]>}
 *
 * @typedef {Object} DnaIndicator
 * @property {string} nama     - Indicator name
 * @property {string} definisi - Official definition
 * @property {string} satuan   - Unit
 * @property {string} ukuran   - Measurement type
 */
async function searchIndicator(title, opts = {}) {
  const province = opts.province || DEFAULT_PROVINCE;
  const length = opts.length || SEARCH_LENGTH;
  const cacheKey = `msind:${title.toLowerCase()}:${province}:${length}`;

  const cached = _getCached(cacheKey);
  if (cached) return cached;

  // Try DB first
  const dbResults = await _searchFromDb('msind', title, length);
  if (dbResults.length > 0) {
    _setCache(cacheKey, dbResults);
    logger.debug({ title, hits: dbResults.length, source: 'db' }, 'DNA MSIND search completed');
    return dbResults;
  }

  // MSIND uses province + city params
  const params = new URLSearchParams({ province, city: DEFAULT_CITY, title, length: String(length), page: '1' });
  const json = await _fetchDNA('/metadata/msind/search', params);
  if (!json) return [];

  const results = json.result.data.map(item => {
    const produsen = item.produsen_data_name || '';
    const isBps = _isBpsProducer(produsen);
    return {
      dna_id: item.id || null,
      nama: item.nama || '',
      konsep: item.konsep || '',
      definisi: item.definisi || '',
      satuan: item.satuan || '',
      ukuran: item.ukuran || '',
      variabelPembangun: item.variabel_pembangun || '',
      produsenDataName: produsen,
      produsenProvinceCode: item.produsen_data_province_code || '',
      produsenCityCode: item.produsen_data_city_code || '',
      isBps,
    };
  });

  // Persist to DB (fire & forget)
  _persistToDb('msind', title, results).catch(e =>
    logger.debug({ error: e.message }, 'DNA MSIND DB persist failed')
  );

  _setCache(cacheKey, results);
  logger.debug({ title, hits: results.length, source: 'api' }, 'DNA MSIND search completed');
  return results;
}

/**
 * Search ALL three metadata types in parallel.
 * Returns combined results for variables, indicators, and kegiatan.
 * Does NOT apply stem expansion — use searchSmart() for that.
 *
 * @param {string} title - Search term
 * @param {object} [opts]
 * @param {string} [opts.province='00']
 * @param {number} [opts.length=3] - Per-type limit (smaller for combined search)
 * @returns {Promise<DnaCombinedResult>}
 *
 * @typedef {Object} DnaCombinedResult
 * @property {DnaVariable[]}  variables
 * @property {DnaIndicator[]} indicators
 * @property {DnaKegiatan[]}  kegiatan
 */
async function searchAll(title, opts = {}) {
  const length = opts.length || 3;
  const searchOpts = { ...opts, length };

  const [variables, indicators, kegiatan] = await Promise.allSettled([
    searchVariable(title, searchOpts),
    searchIndicator(title, searchOpts),
    searchKegiatan(title, searchOpts),
  ]);

  return {
    variables: variables.status === 'fulfilled' ? variables.value : [],
    indicators: indicators.status === 'fulfilled' ? indicators.value : [],
    kegiatan: kegiatan.status === 'fulfilled' ? kegiatan.value : [],
  };
}

/**
 * Fast search: MSIND + MSKEG only (skips MSVAR).
 * Used internally when MSVAR is not needed.
 *
 * @param {string} title - Search term
 * @param {object} [opts]
 * @returns {Promise<DnaCombinedResult>}
 */
async function searchFast(title, opts = {}) {
  const length = opts.length || 3;
  const searchOpts = { ...opts, length };

  const [indicators, kegiatan] = await Promise.allSettled([
    searchIndicator(title, searchOpts),
    searchKegiatan(title, searchOpts),
  ]);

  return {
    variables: [],
    indicators: indicators.status === 'fulfilled' ? indicators.value : [],
    kegiatan: kegiatan.status === 'fulfilled' ? kegiatan.value : [],
  };
}

/**
 * Merge two arrays of DNA results, deduplicating by dna_id.
 * Items from `primary` take precedence over `secondary`.
 *
 * @param {object[]} primary - Higher-priority results
 * @param {object[]} secondary - Additional results to merge in
 * @returns {object[]}
 */
function _mergeResults(primary, secondary) {
  if (!secondary || secondary.length === 0) return primary || [];
  if (!primary || primary.length === 0) return secondary;
  const seen = new Set();
  const merged = [];
  for (const item of primary) {
    if (item.dna_id != null) seen.add(item.dna_id);
    merged.push(item);
  }
  for (const item of secondary) {
    if (item.dna_id != null && seen.has(item.dna_id)) continue;
    if (item.dna_id != null) seen.add(item.dna_id);
    merged.push(item);
  }
  return merged;
}

/**
 * Full search: MSIND + MSKEG + MSVAR in parallel.
 *
 * MSKEG derivation from variabel_pembangun:
 *   When searching non-kegiatan queries (e.g., "kemiskinan"), MSIND results
 *   may contain variabel_pembangun with kegiatan_penghasil fields listing
 *   the actual surveys that produce the data. We extract those survey names
 *   and search MSKEG with them for more relevant kegiatan results.
 *
 *   Example flow:
 *     "kemiskinan" MSIND → variabel_pembangun → "Susenas" → MSKEG("Susenas")
 *     Instead of MSKEG("kemiskinan") which returns generic/irrelevant results.
 *
 * For direct kegiatan queries (e.g., "Susenas", "survei angkatan kerja"),
 * MSKEG is searched with the user's original term directly.
 *
 * If the term has a beneficial stem (from DNA_STEM_MAP), also searches
 * the stem form and merges results (deduped by dna_id).
 *
 * @param {string} title - Search term
 * @param {object} [opts]
 * @returns {Promise<DnaCombinedResult>}
 */
async function searchSmart(title, opts = {}) {
  const length = opts.length || 3;
  const province = opts.province || DEFAULT_PROVINCE;
  const searchOpts = { ...opts, length };
  const isDirectKegiatan = _isDirectKegiatanQuery(title);

  // Primary search: MSIND + MSVAR + MSKEG in parallel (original term)
  const [variables, indicators, kegiatan] = await Promise.allSettled([
    searchVariable(title, searchOpts),
    searchIndicator(title, searchOpts),
    searchKegiatan(title, searchOpts),
  ]);

  let result = {
    variables: variables.status === 'fulfilled' ? variables.value : [],
    indicators: indicators.status === 'fulfilled' ? indicators.value : [],
    kegiatan: kegiatan.status === 'fulfilled' ? kegiatan.value : [],
  };

  // ── Derived MSKEG from variabel_pembangun ─────────────────────────
  // If NOT a direct kegiatan query, extract kegiatan_penghasil names from
  // MSIND results and search MSKEG with the actual survey names.
  if (!isDirectKegiatan && result.indicators.length > 0) {
    const derivedNames = _extractKegiatanPenghasil(result.indicators);
    if (derivedNames.length > 0) {
      logger.debug({ title, derived: derivedNames }, 'MSKEG: deriving kegiatan from variabel_pembangun');
      const derivedKeg = await Promise.allSettled(
        derivedNames.slice(0, 3).map(name => searchKegiatan(name, searchOpts))
      );
      const allDerived = derivedKeg
        .filter(r => r.status === 'fulfilled')
        .flatMap(r => r.value);
      if (allDerived.length > 0) {
        // Derived results take priority — original kegiatan is fallback only
        result.kegiatan = _mergeResults(allDerived, result.kegiatan);
        // Update L1 cache under original term so getCachedSmart returns derived results
        const cacheKey = `mskeg:${title.toLowerCase()}:${province}:${length}`;
        _setCache(cacheKey, result.kegiatan);
        logger.debug({ title, derivedHits: allDerived.length }, 'MSKEG: replaced with derived kegiatan results');
      }
    }
  }

  // Stem expansion: search root word too, merge results
  const stem = _getDnaStem(title);
  if (stem) {
    logger.debug({ title, stem }, 'DNA stem expansion: searching additional form');
    const [stemVars, stemInds, stemKeg] = await Promise.allSettled([
      searchVariable(stem, searchOpts),
      searchIndicator(stem, searchOpts),
      searchKegiatan(stem, searchOpts),
    ]);

    result = {
      variables: _mergeResults(result.variables, stemVars.status === 'fulfilled' ? stemVars.value : []),
      indicators: _mergeResults(result.indicators, stemInds.status === 'fulfilled' ? stemInds.value : []),
      kegiatan: _mergeResults(result.kegiatan, stemKeg.status === 'fulfilled' ? stemKeg.value : []),
    };
    logger.debug({
      title, stem,
      vars: result.variables.length,
      inds: result.indicators.length,
      keg: result.kegiatan.length,
    }, 'DNA stem expansion: merged results');
  }

  return result;
}

/**
 * Check if a term looks like a BPS abbreviation.
 * @param {string} term
 * @returns {boolean}
 */
function _looksLikeAbbreviation(term) {
  if (!term) return false;
  const clean = term.replace(/[^a-zA-Z]/g, '');
  return clean.length >= 2 && clean.length <= 8 && clean === clean.toUpperCase();
}

// ── Abbreviation-focused lookup ───────────────────────────────────────────

/**
 * Look up what an abbreviation means using DNA API.
 * Searches variables and indicators (most likely to contain abbreviation definitions).
 *
 * @param {string} abbr - The abbreviation to look up (e.g. "PMTB", "IPM")
 * @returns {Promise<{found: boolean, expansion: string, definition: string, source: string}|null>}
 */
async function lookupAbbreviation(abbr) {
  if (!abbr || abbr.length < 2) return null;

  const cacheKey = `abbr:${abbr.toLowerCase()}`;
  const cached = _getCached(cacheKey);
  if (cached) return cached;

  // Search variables first (most abbreviations are statistical variables)
  const [varResults, indResults] = await Promise.allSettled([
    searchVariable(abbr, { length: 3 }),
    searchIndicator(abbr, { length: 3 }),
  ]);

  const vars = varResults.status === 'fulfilled' ? varResults.value : [];
  const inds = indResults.status === 'fulfilled' ? indResults.value : [];

  // Find best match — look for the abbreviation in the name or alias
  const abbrUpper = abbr.toUpperCase();
  const abbrLower = abbr.toLowerCase();

  // Check variables
  for (const v of vars) {
    if (v.alias?.toUpperCase() === abbrUpper ||
        v.nama?.toUpperCase().includes(`(${abbrUpper})`) ||
        v.nama?.toLowerCase().includes(abbrLower)) {
      const result = {
        found: true,
        expansion: v.nama.replace(/\s*\([^)]*\)\s*$/, '').trim(), // Remove trailing "(ABBR)"
        definition: v.definisi || '',
        source: 'DNA-MSVAR',
        unit: v.satuan || '',
      };
      _setCache(cacheKey, result);
      return result;
    }
  }

  // Check indicators
  for (const i of inds) {
    if (i.nama?.toUpperCase().includes(`(${abbrUpper})`) ||
        i.nama?.toLowerCase().includes(abbrLower)) {
      const result = {
        found: true,
        expansion: i.nama.replace(/\s*\([^)]*\)\s*$/, '').trim(),
        definition: i.definisi || '',
        source: 'DNA-MSIND',
        unit: i.satuan || '',
      };
      _setCache(cacheKey, result);
      return result;
    }
  }

  // Not found with exact match — return null
  const result = { found: false, expansion: '', definition: '', source: '' };
  _setCache(cacheKey, result);
  return result;
}

// ── Context builder for LLM prompts ───────────────────────────────────────

/**
 * Build a compact context block from DNA results for injection into LLM prompts.
 * Provides authoritative definitions and metadata for the LLM.
 * Labels BPS official sources vs external/ministry sources.
 *
 * @param {DnaCombinedResult} dnaResults - From searchAll()
 * @param {string} query - Original user query (for relevance)
 * @returns {string} - Formatted context block, or empty string if no results
 */
function buildDnaContextBlock(dnaResults, query) {
  if (!dnaResults) return '';

  const bpsLines = [];
  const otherLines = [];
  const seen = new Set(); // dedup by first 60 chars of name

  /**
   * Build a rich metadata line for a variable or indicator.
   * Includes definisi, konsep, satuan, ukuran, alias, referensiWaktu.
   */
  function _buildVarIndLine(item) {
    const parts = [`• **${item.nama}**`];
    if (item.alias) parts.push(`  Alias: ${item.alias}`);
    if (item.definisi) parts.push(`  Definisi: ${item.definisi.slice(0, 350)}`);
    if (item.konsep) {
      // konsep can be JSON array string or plain text
      let konsepText = item.konsep;
      if (typeof konsepText === 'string' && konsepText.startsWith('[')) {
        try { konsepText = JSON.parse(konsepText).join(', '); } catch { /* keep as-is */ }
      }
      parts.push(`  Konsep: ${String(konsepText).slice(0, 200)}`);
    }
    if (item.satuan) parts.push(`  Satuan: ${item.satuan}`);
    if (item.ukuran) parts.push(`  Ukuran: ${item.ukuran}`);
    if (item.referensiWaktu) parts.push(`  Referensi Waktu: ${item.referensiWaktu}`);
    return parts.join('\n');
  }

  /**
   * Build a rich metadata line for a kegiatan (statistical activity).
   * Includes tujuan, metode, frekuensi.
   */
  function _buildKegiatanLine(k) {
    const title = k.judul || k.nama || '';
    if (!title) return null;
    const parts = [`• **${title}**`];
    if (k.tujuan) parts.push(`  Tujuan: ${k.tujuan.slice(0, 300)}`);
    if (k.metode) parts.push(`  Metode: ${k.metode}`);
    if (k.frekuensi) parts.push(`  Frekuensi: ${k.frekuensi}`);
    return parts.join('\n');
  }

  // ── Variables (MSVAR) ──
  if (dnaResults.variables?.length > 0) {
    for (const v of dnaResults.variables.slice(0, 5)) {
      if (!v.nama) continue;
      const key = v.nama.slice(0, 60).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const line = _buildVarIndLine(v);
      (v.isBps ? bpsLines : otherLines).push(line);
    }
  }

  // ── Indicators (MSIND) ──
  if (dnaResults.indicators?.length > 0) {
    for (const i of dnaResults.indicators.slice(0, 5)) {
      if (!i.nama) continue;
      const key = i.nama.slice(0, 60).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const line = _buildVarIndLine(i);
      (i.isBps ? bpsLines : otherLines).push(line);
    }
  }

  // ── Kegiatan (MSKEG) ──
  if (dnaResults.kegiatan?.length > 0) {
    for (const k of dnaResults.kegiatan.slice(0, 3)) {
      const title = k.judul || k.nama || '';
      if (!title) continue;
      const key = title.slice(0, 60).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const line = _buildKegiatanLine(k);
      if (line) (k.isBps ? bpsLines : otherLines).push(line);
    }
  }

  if (bpsLines.length === 0 && otherLines.length === 0) return '';

  // Build block with header instruction for the LLM
  const lines = [];
  lines.push(`📋 METADATA STATISTIK (sumber: DNA Nucleus BPS — definisi resmi variabel, indikator & kegiatan statistik)`);
  lines.push(`INSTRUKSI: Gunakan metadata di bawah sebagai referensi definisi resmi untuk AKURASI jawaban. JANGAN menjelaskan definisi/konsep/satuan secara panjang lebar di dalam teks jawaban — informasi metadata sudah ditampilkan terpisah di UI bagi pengguna.`);
  lines.push('');

  if (bpsLines.length > 0) {
    lines.push('── Metadata Resmi BPS ──');
    lines.push(...bpsLines);
    lines.push('');
  }

  if (otherLines.length > 0) {
    lines.push('── Metadata Lainnya (kementerian/lembaga lain) ──');
    lines.push(...otherLines);
    lines.push('');
  }

  return lines.join('\n');
}

// ── Cache-aware smart lookup (instant if cached) ─────────────────────────

/**
 * Check if searchSmart results are already cached for the given term.
 * 3-tier lookup: in-memory (L1) → MySQL DB (L2) → null (cache miss).
 *
 * This enables the pipeline to:
 *  - Instantly enrich intent/KB queries on repeat queries (memory cache hit)
 *  - Fast local lookup from DB (DB cache hit, ~1-5ms)
 *  - Skip enrichment on first queries (cache miss) → fire background fetch
 *
 * @param {string} title - Search term
 * @param {object} [opts]
 * @param {string} [opts.province='00']
 * @param {number} [opts.length=3]
 * @returns {Promise<DnaCombinedResult|null>} - Cached result or null
 */
async function getCachedSmart(title, opts = {}) {
  if (!title) return null;
  const province = opts.province || DEFAULT_PROVINCE;
  const length = opts.length || SEARCH_LENGTH;
  const titleLower = title.toLowerCase();

  // L1: In-memory cache
  const indKey = `msind:${titleLower}:${province}:${length}`;
  const kegKey = `mskeg:${titleLower}:${province}:${length}`;
  const varKey = `msvar:${titleLower}:${province}:${length}`;

  const indicators = _getCached(indKey);
  const kegiatan = _getCached(kegKey);

  // If at least MSIND or MSKEG is in memory, return immediately
  if (indicators || kegiatan) {
    const variables = _getCached(varKey);
    let keg = kegiatan || [];

    // If indicators exist but no kegiatan in L1, derive from variabelPembangun
    if (indicators && indicators.length > 0 && (!kegiatan || kegiatan.length === 0)) {
      const derivedNames = _extractKegiatanPenghasil(indicators);
      if (derivedNames.length > 0) {
        const derivedKeg = derivedNames.slice(0, 3).map(name => {
          const dk = `mskeg:${name.toLowerCase()}:${province}:${length}`;
          return _getCached(dk) || [];
        }).flat();
        if (derivedKeg.length > 0) {
          keg = derivedKeg;
          _setCache(kegKey, keg);  // Cache under original term for next hit
          logger.debug({ title, derivedCount: keg.length }, 'getCachedSmart: derived MSKEG from L1 variabelPembangun');
        }
      }
    }

    return {
      variables: variables || [],
      indicators: indicators || [],
      kegiatan: keg,
    };
  }

  // L2: MySQL DB cache
  try {
    let [dbInd, dbKeg, dbVar] = await Promise.all([
      _searchFromDb('msind', titleLower, length),
      _searchFromDb('mskeg', titleLower, length),
      _searchFromDb('msvar', titleLower, length),
    ]);

    if (dbInd.length > 0 || dbKeg.length > 0) {
      // Derive MSKEG from variabelPembangun when indicators exist but no kegiatan
      if (dbInd.length > 0 && dbKeg.length === 0) {
        const derivedNames = _extractKegiatanPenghasil(dbInd);
        if (derivedNames.length > 0) {
          const derivedResults = await Promise.all(
            derivedNames.slice(0, 3).map(name => _searchFromDb('mskeg', name, length))
          );
          dbKeg = derivedResults.flat();
          if (dbKeg.length > 0) {
            logger.debug({ title, derivedCount: dbKeg.length, from: derivedNames }, 'getCachedSmart: derived MSKEG from DB variabelPembangun');
          }
        }
      }

      // Populate L1 from L2 for next hot-path access
      if (dbInd.length > 0) _setCache(indKey, dbInd);
      if (dbKeg.length > 0) _setCache(kegKey, dbKeg);
      if (dbVar.length > 0) _setCache(varKey, dbVar);

      return {
        variables: dbVar,
        indicators: dbInd,
        kegiatan: dbKeg,
      };
    }
  } catch (e) {
    logger.debug({ error: e.message, title }, 'DNA getCachedSmart DB fallback failed');
  }

  return null;
}

// ── Startup cache warming ──────────────────────────────────────────────────

/**
 * Pre-warm DNA cache for common statistical terms.
 * Runs in background — does not block server startup.
 * After warming, these terms get instant enrichment in the pipeline.
 *
 * @param {string[]} [terms] - Override default terms
 * @returns {Promise<void>}
 */
async function warmupCache(terms) {
  const defaultTerms = [
    // Core statistical topics
    'kemiskinan', 'inflasi', 'pengangguran', 'migrasi', 'penduduk',
    'PDRB', 'IPM', 'ekspor', 'impor', 'pertumbuhan ekonomi',
    'ketenagakerjaan', 'upah', 'konsumsi', 'produksi',
    'pertanian', 'perikanan', 'pariwisata', 'industri',
    // Common abbreviations (frequently queried)
    'PMTB', 'TPK', 'NTP', 'NTUP', 'TPT',
    // Short-form variations (extracted by _extractDnaPrimaryTerm)
    'miskin', 'ekonomi', 'harga', 'investasi', 'konstruksi',
    'pendidikan', 'kesehatan', 'gini', 'ketimpangan',
    // Stem targets from DNA_STEM_MAP (pre-cache for faster dual-search)
    'lahir', 'tumbuh', 'tenaga kerja', 'dagang', 'ternak',
    'kebun', 'transportasi', 'kelahiran', 'pertumbuhan',
    'perdagangan', 'peternakan', 'perkebunan', 'perhubungan',
    'kependudukan', 'perindustrian',
  ];
  const toWarm = terms || defaultTerms;

  logger.info({ count: toWarm.length }, 'DNA cache warmup starting');
  let warmed = 0;

  for (const term of toWarm) {
    try {
      // Check if already cached (in-memory or DB)
      const cached = await getCachedSmart(term, { length: 3 });
      if (cached) {
        warmed++;
        continue;
      }
      // Fire searchSmart (MSIND + MSKEG + MSVAR in parallel, ~10-17s)
      await searchSmart(term, { length: 3 });
      warmed++;
      // Small delay between calls to not hammer the API
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      logger.debug({ term, error: e.message }, 'DNA warmup failed for term');
    }
  }

  logger.info({ warmed, total: toWarm.length }, 'DNA cache warmup completed');
}

// ── Build structured DNA metadata for frontend UI ────────────────────────

/**
 * Build structured DNA metadata for the frontend second bubble.
 * Returns an array of items suitable for UI rendering (definitions, concepts, etc.).
 * Unlike buildDnaContextBlock (text for LLM), this returns JSON for the frontend.
 *
 * @param {object} dnaResults - Raw DNA search results {variables, indicators, kegiatan}
 * @returns {DnaUiMetadata|null}
 *
 * @typedef {Object} DnaUiMetadata
 * @property {DnaUiItem[]} items
 *
 * @typedef {Object} DnaUiItem
 * @property {'variable'|'indicator'|'kegiatan'} type
 * @property {string} nama
 * @property {string|null} alias
 * @property {string|null} definisi
 * @property {string|null} konsep
 * @property {string|null} satuan
 * @property {string|null} ukuran
 * @property {string|null} referensiWaktu
 * @property {string|null} tujuan
 * @property {string|null} metode
 * @property {string|null} frekuensi
 * @property {boolean} isBps
 */
function buildDnaUiMetadata(dnaResults) {
  if (!dnaResults) return null;

  const items = [];
  const seen = new Set();

  function _parseKonsep(raw) {
    if (!raw) return null;
    if (typeof raw === 'string' && raw.startsWith('[')) {
      try { return JSON.parse(raw).join(', '); } catch { /* keep as-is */ }
    }
    return String(raw);
  }

  // Variables (MSVAR)
  if (dnaResults.variables?.length > 0) {
    for (const v of dnaResults.variables.slice(0, 3)) {
      if (!v.nama) continue;
      const key = v.nama.slice(0, 60).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        type: 'variable',
        nama: v.nama,
        alias: v.alias || null,
        definisi: v.definisi ? v.definisi.slice(0, 500) : null,
        konsep: _parseKonsep(v.konsep),
        satuan: v.satuan || null,
        ukuran: v.ukuran || null,
        referensiWaktu: v.referensiWaktu || null,
        tujuan: null,
        metode: null,
        frekuensi: null,
        isBps: !!v.isBps,
      });
    }
  }

  // Indicators (MSIND)
  if (dnaResults.indicators?.length > 0) {
    for (const i of dnaResults.indicators.slice(0, 3)) {
      if (!i.nama) continue;
      const key = i.nama.slice(0, 60).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        type: 'indicator',
        nama: i.nama,
        alias: null,
        definisi: i.definisi ? i.definisi.slice(0, 500) : null,
        konsep: _parseKonsep(i.konsep),
        satuan: i.satuan || null,
        ukuran: i.ukuran || null,
        referensiWaktu: null,
        tujuan: null,
        metode: null,
        frekuensi: null,
        isBps: !!i.isBps,
      });
    }
  }

  // Kegiatan (MSKEG)
  if (dnaResults.kegiatan?.length > 0) {
    for (const k of dnaResults.kegiatan.slice(0, 2)) {
      const title = k.judul || k.nama || '';
      if (!title) continue;
      const key = title.slice(0, 60).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        type: 'kegiatan',
        nama: title,
        alias: null,
        definisi: null,
        konsep: null,
        satuan: null,
        ukuran: null,
        referensiWaktu: null,
        tujuan: k.tujuan ? k.tujuan.slice(0, 400) : null,
        metode: k.metode || null,
        frekuensi: k.frekuensi || null,
        isBps: !!k.isBps,
      });
    }
  }

  if (items.length === 0) return null;
  return { items };
}

// ── Exports ───────────────────────────────────────────────────────────────

module.exports = {
  searchKegiatan,
  searchVariable,
  searchIndicator,
  searchAll,
  searchFast,
  searchSmart,
  getCachedSmart,
  warmupCache,
  lookupAbbreviation,
  buildDnaContextBlock,
  buildDnaUiMetadata,
  // Exposed for testing
  _cache,
  _getCached,
  _setCache,
};
