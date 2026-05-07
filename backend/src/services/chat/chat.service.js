const ChatThread = require('../../models/ChatThread.model');
const ChatMessage = require('../../models/ChatMessage.model');
const { resolveSearchIntent } = require('../search/intent.service');
const { buildDatasourceCandidates } = require('../search/intent.service');
const DataPeriod = require('../../models/DataPeriod.model');
const ProcessedCache = require('../../models/ProcessedCache.model');
const DataSourceSearchTerm = require('../../models/DataSourceSearchTerm.model');
const { getCache } = require('../cache/cache.service');
const { chat: llmChat } = require('./streaming/openaiClient');
const { QueryTypes, Op } = require('sequelize');

/**
 * Parse quarter/triwulan from query text
 * Returns { quarter: 1-4, monthStart: 1-12, monthEnd: 1-12 } or null
 */
function parseQuarterFromText(text) {
  const t = String(text || '').toLowerCase();
  
  // Check for "triwulan I/II/III/IV" or "triwulan 1/2/3/4" or "Q1/Q2/Q3/Q4"
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
  
  // Check for semester
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

let _globalLatestYearCache = { year: null, atMs: 0 };

async function getGlobalLatestYearFromPeriodMap() {
  const nowMs = Date.now();
  if (_globalLatestYearCache.year && nowMs - _globalLatestYearCache.atMs < 5 * 60 * 1000) {
    return _globalLatestYearCache.year;
  }

  try {
    const rows = await DataPeriod.sequelize.query(
      'SELECT MAX(CAST(period_value AS UNSIGNED)) AS max_pv FROM data_period_map',
      { type: QueryTypes.SELECT }
    );
    const maxPv = rows?.[0]?.max_pv;
    const parsed = parsePeriodValue(maxPv);
    const year = parsed?.year;
    if (Number.isInteger(year) && year >= 1900 && year <= 2100) {
      _globalLatestYearCache = { year, atMs: nowMs };
      return year;
    }
  } catch {
    // best-effort
  }

  _globalLatestYearCache = { year: null, atMs: nowMs };
  return null;
}

function now() {
  return new Date();
}

function getOwnerIdFromReq(req) {
  const raw = req.get('x-malika-uid') || req.get('x-malika-user') || '';
  const ownerId = String(raw || '').trim();
  if (!ownerId) {
    const err = new Error('Missing x-malika-uid header');
    err.status = 400;
    err.code = 'missing_owner';
    throw err;
  }
  if (ownerId.length > 100) {
    const err = new Error('Invalid x-malika-uid header');
    err.status = 400;
    err.code = 'invalid_owner';
    throw err;
  }
  return ownerId;
}

function getOpenAIKey() {
  return (
    process.env.OPENAI_API_KEY_CHAT ||
    process.env.OPENAI_API_KEY_INTERPRETATION ||
    process.env.OPENAI_API_KEY_QUERY_BUILDER ||
    ''
  );
}

function getOpenAIModel() {
  return process.env.OPENAI_MODEL_CHAT || 'gpt-4.1-mini';
}

async function listThreads(ownerId) {
  const rows = await ChatThread.findAll({
    where: { owner_id: ownerId },
    order: [
      ['last_message_at', 'DESC'],
      ['id', 'DESC'],
    ],
    limit: 100,
  });
  return rows.map((r) => r.toJSON());
}

async function createThread(ownerId, titleRaw) {
  const title = String(titleRaw || '').trim() || 'Chat baru';
  const t = await ChatThread.create({
    owner_id: ownerId,
    title: title.slice(0, 255),
    summary: null,
    last_message_at: null,
    created_at: now(),
    updated_at: now(),
  });
  return t.toJSON();
}

async function getThreadOwned(ownerId, threadId) {
  const thread = await ChatThread.findOne({ where: { id: threadId, owner_id: ownerId } });
  if (!thread) {
    const err = new Error('Thread not found');
    err.status = 404;
    err.code = 'thread_not_found';
    throw err;
  }
  return thread;
}

async function listMessages(ownerId, threadId) {
  await getThreadOwned(ownerId, threadId);
  const rows = await ChatMessage.findAll({
    where: { thread_id: threadId },
    order: [['id', 'ASC']],
    limit: 500,
  });
  return rows.map((r) => r.toJSON());
}

/**
 * System prompt for MALIKA chat assistant.
 * Can be customized via MALIKA_SYSTEM_PROMPT env var for easy iteration.
 * 
 * Structure:
 * 1. ROLE - Who is MALIKA
 * 2. STYLE - How to communicate
 * 3. GOAL - What to achieve
 * 4. CONSTRAINTS - What NOT to do
 * 5. OUTPUT FORMAT - Structure of response
 */
function systemPrompt(context = {}) {
  // Allow override via env for testing/tuning without code deploy
  const customPrompt = process.env.MALIKA_SYSTEM_PROMPT;
  if (customPrompt && customPrompt.trim().length > 50) {
    return customPrompt.trim();
  }

  const { hasDataPreview, hasConfidentMatch, requestedYear, availableYears, lowConfidence } = context;

  // Default structured prompt
  const maxLines = process.env.MALIKA_MAX_LINES || '8';
  const maxQuestions = process.env.MALIKA_MAX_QUESTIONS || '2';

  const parts = [
    // ROLE
    'Kamu adalah MALIKA (Manajer Layanan Informasi dan Komunikasi Aktif), customer service data statistik BPS Maluku Utara.',
    
    // STYLE
    'Gaya: sopan, membantu, tidak menyalahkan user, fokus solusi, SINGKAT dan to the point.',
    
    // GOAL
    'Tujuan: bantu user menemukan indikator tepat, pahami arti angka, tentukan langkah selanjutnya.',
    
    // CONSTRAINTS - CRITICAL
    'DILARANG KERAS:',
    '- Mengarang/mengira-ngira angka statistik (persentase, jumlah, nilai) KECUALI angka ada di tabel yang dilampirkan.',
    '- Proyeksi/perkiraan masa depan.',
    '- Cari data dari internet.',
    '- Tulis URL mentah.',
    '- Tulis tabel kandidat (UI sudah handle).',
    
    // ASSUMPTIONS
    'Default wilayah: Maluku Utara (jangan tanya "Indonesia" kecuali diminta).',
    'Jika user minta angka spesifik, pastikan: indikator + periode (tahun/bulan) + wilayah (kab/kota) lengkap.',
  ];

  // Context-aware rules
  if (hasDataPreview) {
    parts.push('KONTEKS: Tabel data SUDAH ditampilkan di UI. Berikan interpretasi SINGKAT dari angka yang ada.');
  } else {
    parts.push('KONTEKS: TIDAK ada tabel data. DILARANG menyebut angka apapun. Hanya bantu klarifikasi parameter.');
  }

  if (lowConfidence) {
    parts.push('PERHATIAN: Kandidat indikator masih ambigu. Minta user klarifikasi indikator yang dimaksud.');
  } else if (hasConfidentMatch) {
    parts.push('Kandidat indikator sudah teridentifikasi dengan yakin.');
  }

  if (requestedYear && Array.isArray(availableYears) && availableYears.length > 0 && !availableYears.includes(requestedYear)) {
    parts.push(`PENTING: Tahun ${requestedYear} TIDAK tersedia di database. Tahun tersedia: ${availableYears.slice(0, 5).join(', ')}.`);
  }

  // OUTPUT FORMAT
  parts.push(
    'Format jawaban (' + maxLines + ' baris maks):',
    '(1) Pahami kebutuhan user (1 kalimat)',
    '(2) Jawaban/penjelasan inti (SINGKAT)',
    '(3) Jika perlu: 1-' + maxQuestions + ' pertanyaan klarifikasi spesifik',
    '(4) Tutup: 1 langkah berikutnya yang jelas',
    'Ritme: maks ' + maxQuestions + ' pertanyaan, hindari paragraf panjang.'
  );

  return parts.join(' ');
}

function stripMalikaUiBlock(content) {
  const text = String(content || '');
  // Remove ```malika_ui ... ``` blocks to avoid polluting LLM context.
  return text.replace(/```\s*malika_ui\s*[\s\S]*?```/gi, '').trim();
}

function stripRawUrlsFromText(textRaw) {
  let out = String(textRaw || '');
  // Convert markdown links to plain labels.
  out = out.replace(/\[([^\]]+)]\((https?:\/\/[^)]+)\)/gi, '$1');
  // Remove raw URLs.
  out = out.replace(/\bhttps?:\/\/[^\s<>()]+/gi, '');
  out = out.replace(/\bwww\.[^\s<>()]+/gi, '');

  // Also avoid printing app-relative deep links; UI renders links separately.
  out = out.replace(/\/data\?[^\s]+/gi, 'halaman data');
  out = out.replace(/\/search\?q=[^\s]+/gi, 'halaman pencarian');
  out = out.replace(/\/backend\/?[^\s]*/gi, '');

  // Normalize whitespace.
  out = out.replace(/\s{2,}/g, ' ');
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

/**
 * Enforce response rhythm/length limits.
 * Configurable via env vars for easy tuning:
 * - MALIKA_MAX_LINES: max lines in response (default: 10)
 * - MALIKA_MAX_CHARS: max characters (default: 1000)
 * - MALIKA_MAX_QUESTIONS: max question marks (default: 2)
 */
function clampChatRhythm(textRaw) {
  let out = String(textRaw || '').trim();
  if (!out) return out;

  // Configurable limits
  const maxLines = Number(process.env.MALIKA_MAX_LINES) || 10;
  const maxChars = Number(process.env.MALIKA_MAX_CHARS) || 1000;
  const maxQuestions = Number(process.env.MALIKA_MAX_QUESTIONS) || 2;

  // Keep it short and readable.
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  const lines = out.split('\n');
  if (lines.length > maxLines) out = lines.slice(0, maxLines).join('\n').trim();
  if (out.length > maxChars) out = out.slice(0, maxChars).trim();

  // Hard cap questions: replace extra '?' with '.' to reduce interrogation feel.
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
  // Some services can yield BPS th_id-style values (e.g. 125 for 2025).
  if (n >= 0 && n <= 999) {
    const y = 1900 + n;
    return y >= 1900 && y <= 2100 ? y : null;
  }
  return null;
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
 * Expand geo shorthand to full name for matching
 */
function expandGeoShorthand(geo) {
  const map = {
    // Shortcuts
    kepsul: 'kepulauan sula',
    kepsula: 'kepulauan sula',
    halsel: 'halmahera selatan',
    halut: 'halmahera utara',
    halbar: 'halmahera barat',
    haltim: 'halmahera timur',
    halteng: 'halmahera tengah',
    tikep: 'tidore kepulauan',
    // Full variants
    ternate: 'kota ternate',
    morotai: 'pulau morotai',
    taliabu: 'pulau taliabu',
    sula: 'kepulauan sula',
    // City variants
    tidore: 'tidore kepulauan',
  };
  return map[geo] || null;
}

/**
 * Filter data rows by geo term
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
    return rowValues.some(v =>
      v.includes(geoNorm) ||
      (geoExpanded && v.includes(geoExpanded))
    );
  });

  return {
    filtered: filtered.length > 0 ? filtered : data,
    geoMatched: filtered.length > 0,
    geoMatchCount: filtered.length,
  };
}

/**
 * Filter data rows by quarter (triwulan)
 * Looks for columns like "Bulan" or "Periode" with values like "Triwulan I/II/III/IV"
 * @returns {{ filtered: Array, quarterMatched: boolean, quarterMatchCount: number }}
 */
function filterDataByQuarter(data, quarterNum) {
  if (!quarterNum || !Array.isArray(data) || data.length === 0) {
    return { filtered: data, quarterMatched: false, quarterMatchCount: 0 };
  }

  // Map quarter number to triwulan label patterns
  const quarterLabels = {
    1: /triwulan\s*i\b/i,
    2: /triwulan\s*ii\b/i,
    3: /triwulan\s*iii\b/i,
    4: /triwulan\s*iv\b/i,
  };
  const pattern = quarterLabels[quarterNum];
  if (!pattern) return { filtered: data, quarterMatched: false, quarterMatchCount: 0 };

  const filtered = data.filter(row => {
    // Look for quarter column (Bulan, Periode, etc.)
    const quarterCol = row.Bulan || row.bulan || row.Periode || row.periode || row.Triwulan || row.triwulan;
    if (quarterCol) {
      return pattern.test(String(quarterCol));
    }
    // Fallback: check all string values
    return Object.values(row).some(v => typeof v === 'string' && pattern.test(v));
  });

  return {
    filtered: filtered.length > 0 ? filtered : data,
    quarterMatched: filtered.length > 0,
    quarterMatchCount: filtered.length,
  };
}

/**
 * Extract period range or specific years from query builder clauses
 * Supports:
 * - Continuous range: "2020-2024", "2020 sampai 2024" → generates all years in between
 * - Specific years: "2020, 2022, 2024", "2020 dan 2024" → uses exact years from clauses
 * Returns { yearStart, yearEnd, years[], isSpecificYears } or null if single/no year
 */
function extractPeriodRange(queryBuilder) {
  if (!queryBuilder?.clauses || !Array.isArray(queryBuilder.clauses)) return null;
  
  const timeClauses = queryBuilder.clauses.filter(c => c.kind === 'time' && c.year);
  if (timeClauses.length <= 1) return null; // Not a range/multiple years
  
  const clauseYears = [...new Set(timeClauses.map(c => c.year))].sort((a, b) => a - b);
  const yearStart = clauseYears[0];
  const yearEnd = clauseYears[clauseYears.length - 1];
  
  // Detect if this is a continuous range or specific years
  // If clauses only have 2 years (start, end) → treat as continuous range
  // If clauses have 3+ years → check if they're consecutive or specific
  let isSpecificYears = false;
  let years = [];
  
  if (clauseYears.length === 2) {
    // Two years: treat as continuous range (e.g., "2020-2024", "2020 sampai 2024")
    for (let y = yearStart; y <= yearEnd; y++) {
      years.push(y);
    }
  } else {
    // 3+ years: check if they're consecutive
    const expectedContinuous = yearEnd - yearStart + 1;
    if (clauseYears.length === expectedContinuous) {
      // All years are consecutive (e.g., "2020, 2021, 2022, 2023")
      years = clauseYears;
    } else {
      // Non-consecutive specific years (e.g., "2020, 2022, 2024")
      isSpecificYears = true;
      years = clauseYears;
    }
  }
  
  // Sanity check: don't allow more than 10 years
  if (years.length > 10) {
    years = years.slice(-10); // Take last 10 years
  }
  
  return {
    yearStart,
    yearEnd,
    years,
    isSpecificYears,
  };
}

/**
 * Get processed data preview for multiple years (range)
 * Returns merged data from all years
 */
async function getProcessedPreviewForRange({ sourceId, years, geo }) {
  if (!Number.isFinite(sourceId) || sourceId <= 0) return null;
  if (!Array.isArray(years) || years.length === 0) return null;
  
  try {
    const { readGenericIndicatorFromBps } = require('../bpsRead/indicatorTableGenericRead.service');
    const DataSource = require('../../models/DataSource.model');
    
    const ds = await DataSource.findByPk(sourceId);
    const sourceName = ds?.name || 'Data Statistik';
    
    // Fetch data for each year
    const allRows = [];
    let lastUpdate = null;
    const availableYears = [];
    
    for (const year of years) {
      try {
        const bpsData = await readGenericIndicatorFromBps({
          sourceId,
          period: year,
          sourceName,
        });
        
        if (bpsData && !bpsData.__disabled && Array.isArray(bpsData.data) && bpsData.data.length > 0) {
          // Add year column to each row
          const rowsWithYear = bpsData.data.map(row => ({
            ...row,
            _year: year,
          }));
          allRows.push(...rowsWithYear);
          availableYears.push(year);
          
          if (bpsData.last_update) {
            const lu = new Date(bpsData.last_update);
            if (!lastUpdate || lu > lastUpdate) lastUpdate = lu;
          }
        }
      } catch (err) {
        console.warn(`[getProcessedPreviewForRange] Year ${year} not available:`, err.message);
      }
    }
    
    if (allRows.length === 0) return null;
    
    // Apply geo filter if provided
    let filteredRows = allRows;
    let geoMatched = false;
    let geoMatchCount = 0;
    if (geo) {
      const geoResult = filterDataByGeo(allRows, geo);
      filteredRows = geoResult.filtered;
      geoMatched = geoResult.geoMatched;
      geoMatchCount = geoResult.geoMatchCount;
    }
    
    // Extract columns (excluding internal _year)
    const sampleRow = filteredRows[0] || {};
    const columns = Object.keys(sampleRow).filter(k => k !== '_year');
    
    // Add Tahun column at the beginning if multiple years
    if (availableYears.length > 1) {
      columns.unshift('Tahun');
      filteredRows = filteredRows.map(row => {
        const { _year, ...rest } = row;
        return { Tahun: _year, ...rest };
      });
    } else if (availableYears.length === 1) {
      // Single year - remove _year from rows
      filteredRows = filteredRows.map(row => {
        const { _year, ...rest } = row;
        return rest;
      });
    }
    
    return {
      source: sourceName,
      columns,
      data: filteredRows,
      last_update: lastUpdate,
      from_data_bps: true,
      availableYears,
      requestedYears: years,
      geoMatched,
      geoMatchCount,
      geoRequested: Boolean(geo),
    };
  } catch (err) {
    console.error('[getProcessedPreviewForRange] Error:', err.message);
    return null;
  }
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

async function getProcessedPreviewFromCache({ sourceId, year, month, geo, quarter }) {
  const sid = Number(sourceId);
  if (!Number.isFinite(sid) || sid <= 0) return null;

  const candidates = buildPeriodCandidates({ year, month });
  for (const pv of candidates) {
    try {
      const row = await getCache(sid, pv);
      if (!row) continue;
      const raw = row.toJSON ? row.toJSON() : row;
      const processedRaw = raw?.processed_json;
      if (!processedRaw) continue;

      let obj;
      try {
        obj = typeof processedRaw === 'string' ? JSON.parse(processedRaw) : processedRaw;
      } catch {
        obj = null;
      }
      if (!obj || typeof obj !== 'object') continue;

      const columns = Array.isArray(obj.columns) ? obj.columns : [];
      let data = Array.isArray(obj.data) ? obj.data : [];
      if (!Array.isArray(columns) || columns.length === 0 || !Array.isArray(data) || data.length === 0) continue;

      // Apply geo filter if provided
      let geoMatched = false;
      let geoMatchCount = 0;
      if (geo) {
        const geoResult = filterDataByGeo(data, geo);
        data = geoResult.filtered;
        geoMatched = geoResult.geoMatched;
        geoMatchCount = geoResult.geoMatchCount;
      }

      // Apply quarter filter if provided
      let quarterMatched = false;
      let quarterMatchCount = 0;
      if (quarter) {
        const quarterResult = filterDataByQuarter(data, quarter);
        data = quarterResult.filtered;
        quarterMatched = quarterResult.quarterMatched;
        quarterMatchCount = quarterResult.quarterMatchCount;
      }

      return {
        period_value: pv,
        source: obj.source || null,
        last_update: obj.last_update || raw?.last_update || null,
        columns,
        data,
        geoMatched,
        geoMatchCount,
        geoRequested: Boolean(geo),
        quarterMatched,
        quarterMatchCount,
        quarterRequested: Boolean(quarter),
      };
    } catch {
      // best-effort
    }
  }

  // Fallback: try reading from data_bps.indikator_<sourceId> directly
  // This handles cases where processed cache is empty but data exists in data_bps
  try {
    const { readGenericIndicatorFromBps } = require('../bpsRead/indicatorTableGenericRead.service');
    const bpsResult = await readGenericIndicatorFromBps({ sourceId: sid, period: year, sourceName: null });
    
    if (bpsResult && !bpsResult.__disabled && bpsResult.columns && bpsResult.data) {
      const columns = Array.isArray(bpsResult.columns) ? bpsResult.columns : [];
      let data = Array.isArray(bpsResult.data) ? bpsResult.data : [];
      
      if (columns.length > 0 && data.length > 0) {
        // Apply geo filter if provided
        let geoMatched = false;
        let geoMatchCount = 0;
        if (geo) {
          const geoResult = filterDataByGeo(data, geo);
          data = geoResult.filtered;
          geoMatched = geoResult.geoMatched;
          geoMatchCount = geoResult.geoMatchCount;
        }

        // Apply quarter filter if provided
        let quarterMatched = false;
        let quarterMatchCount = 0;
        if (quarter) {
          const quarterResult = filterDataByQuarter(data, quarter);
          data = quarterResult.filtered;
          quarterMatched = quarterResult.quarterMatched;
          quarterMatchCount = quarterResult.quarterMatchCount;
        }

        return {
          period_value: String(year),
          source: bpsResult.source || null,
          last_update: bpsResult.last_update || null,
          columns,
          data,
          geoMatched,
          geoMatchCount,
          geoRequested: Boolean(geo),
          quarterMatched,
          quarterMatchCount,
          quarterRequested: Boolean(quarter),
          from_data_bps: true, // flag to indicate this came from data_bps
        };
      }
    }
  } catch {
    // Best-effort fallback
  }

  // Fallback 2: try reading from MergedCache (data_merged_cache)
  // This handles quarterly/triwulanan datasources that might have merged data
  try {
    const MergedCache = require('../../models/MergedCache.model');
    const mergedRow = await MergedCache.findOne({
      where: { source_id: sid, signature: 'all' }
    });
    
    if (mergedRow?.merged_json) {
      const mergedObj = typeof mergedRow.merged_json === 'string' 
        ? JSON.parse(mergedRow.merged_json) 
        : mergedRow.merged_json;
      
      if (mergedObj?.table?.columns && mergedObj?.table?.data) {
        // Convert column objects to strings if needed
        const columns = mergedObj.table.columns.map(c => 
          typeof c === 'object' ? (c.label || c.key || String(c)) : String(c)
        );
        let data = Array.isArray(mergedObj.table.data) ? [...mergedObj.table.data] : [];
        
        // Filter by year if specified
        if (year && data.length > 0) {
          const yearStr = String(year);
          const yearFiltered = data.filter(row => {
            const rowYear = String(row?.year || row?.Tahun || '');
            return rowYear === yearStr || rowYear.startsWith(yearStr);
          });
          if (yearFiltered.length > 0) data = yearFiltered;
        }
        
        // Apply geo filter if provided
        let geoMatched = false;
        let geoMatchCount = 0;
        if (geo && data.length > 0) {
          const geoResult = filterDataByGeo(data, geo);
          data = geoResult.filtered;
          geoMatched = geoResult.geoMatched;
          geoMatchCount = geoResult.geoMatchCount;
        }

        // Apply quarter filter if provided
        let quarterMatched = false;
        let quarterMatchCount = 0;
        if (quarter && data.length > 0) {
          const quarterResult = filterDataByQuarter(data, quarter);
          data = quarterResult.filtered;
          quarterMatched = quarterResult.quarterMatched;
          quarterMatchCount = quarterResult.quarterMatchCount;
        }

        if (columns.length > 0 && data.length > 0) {
          return {
            period_value: year ? String(year) : 'all',
            source: mergedObj.source || null,
            last_update: mergedObj.last_update || mergedRow.last_update || null,
            columns,
            data,
            geoMatched,
            geoMatchCount,
            geoRequested: Boolean(geo),
            quarterMatched,
            quarterMatchCount,
            quarterRequested: Boolean(quarter),
            from_merged_cache: true, // flag to indicate this came from merged cache
          };
        }
      }
    }
  } catch {
    // Best-effort fallback
  }

  return null;
}

async function getMergedPreviewFromCache({ sourceId, year, geo, quarter }) {
  const sid = Number(sourceId);
  if (!Number.isFinite(sid) || sid <= 0) return null;

  try {
    const MergedCache = require('../../models/MergedCache.model');
    const mergedRow = await MergedCache.findOne({
      where: { source_id: sid, signature: 'all' },
    });

    if (!mergedRow?.merged_json) return null;

    const mergedObj = typeof mergedRow.merged_json === 'string'
      ? JSON.parse(mergedRow.merged_json)
      : mergedRow.merged_json;

    if (!mergedObj?.table?.columns || !mergedObj?.table?.data) return null;

    // Prefer keys for stable lookup, fall back to label
    const columns = mergedObj.table.columns.map((c) =>
      typeof c === 'object' ? (c.key || c.label || String(c)) : String(c)
    );

    let data = Array.isArray(mergedObj.table.data) ? [...mergedObj.table.data] : [];

    // Filter by year if specified
    if (year && data.length > 0) {
      const yearStr = String(year);
      const yearFiltered = data.filter((row) => {
        const rowYear = String(row?.year || row?.Tahun || '');
        return rowYear === yearStr || rowYear.startsWith(yearStr);
      });
      if (yearFiltered.length > 0) data = yearFiltered;
    }

    // Apply geo filter if provided
    let geoMatched = false;
    let geoMatchCount = 0;
    if (geo && data.length > 0) {
      const geoResult = filterDataByGeo(data, geo);
      data = geoResult.filtered;
      geoMatched = geoResult.geoMatched;
      geoMatchCount = geoResult.geoMatchCount;
    }

    // Apply quarter filter if provided
    let quarterMatched = false;
    let quarterMatchCount = 0;
    if (quarter && data.length > 0) {
      const quarterResult = filterDataByQuarter(data, quarter);
      data = quarterResult.filtered;
      quarterMatched = quarterResult.quarterMatched;
      quarterMatchCount = quarterResult.quarterMatchCount;
    }

    if (columns.length === 0 || data.length === 0) return null;

    return {
      period_value: year ? String(year) : 'all',
      source: mergedObj.source || null,
      last_update: mergedObj.last_update || mergedRow.last_update || null,
      columns,
      data,
      geoMatched,
      geoMatchCount,
      geoRequested: Boolean(geo),
      quarterMatched,
      quarterMatchCount,
      quarterRequested: Boolean(quarter),
      from_merged_cache: true,
    };
  } catch {
    return null;
  }
}

function buildUiMeta({ q, intentResult, candidates, latestBySource, dataPreview, hasGeoCandidate }) {
  const qb = intentResult?.query_builder;
  let requestedYear = qb?.params?.year ? normalizeYearValue(qb.params.year) : null;
  let requestedMonth = qb?.params?.month ? safeParseInt(qb.params.month) : null;
  const geo = qb?.params?.geo ? String(qb.params.geo).trim() : '';

  const qText = String(q || '').trim().slice(0, 500);

  // If query builder missed/overrode the year, prefer the explicit year found in the text.
  // This keeps UI + preview query aligned with what user sees.
  const yearInText = (() => {
    const m = qText.match(/\b(19\d{2}|20\d{2}|2100)\b/);
    if (!m || !m[1]) return null;
    const y = Number(m[1]);
    return Number.isInteger(y) && y >= 1900 && y <= 2100 ? y : null;
  })();
  if (yearInText && (!requestedYear || requestedYear !== yearInText)) {
    requestedYear = yearInText;
  }

  const monthInText = intentResult?.ui_suppress_month
    ? null
    : (() => {
    const norm = qText.toLowerCase();
    const mNumeric = norm.match(/\b(?:19\d{2}|20\d{2}|2100)\s*[-–\/]\s*(0?[1-9]|1[0-2])\b/);
    if (mNumeric && mNumeric[1]) {
      const m = Number(mNumeric[1]);
      return Number.isInteger(m) && m >= 1 && m <= 12 ? m : null;
    }
    const map = {
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
    for (const [k, v] of Object.entries(map)) {
      if (norm.includes(k)) return v;
    }
    return null;
  })();

  if (!requestedMonth && monthInText) requestedMonth = monthInText;

  // Parse quarter/triwulan from query if present
  const quarterInfo = parseQuarterFromText(qText);
  const hasQuarterSignal = Boolean(quarterInfo);

  // IMPORTANT: keep this conservative. Do NOT include the generic word "data" here,
  // otherwise questions like "apakah ada data kemiskinan" will auto-trigger preview.
  const wantsPreviewNow = /\b(tampilkan|lihat|buka|buat(?:kan)?|link|tabel|grafik|chart|unduh|download|angka|berapa)\b/i.test(qText);
  const hasRelativeTimeSignal = (() => {
    const t = qText.toLowerCase();
    if (!t) return false;
    // Examples:
    // - "2 tahun terakhir" / "dua tahun terakhir" / "2 thn terakhir"
    // - "tahun terakhir" / "beberapa tahun terakhir"
    return (
      /\b(\d+\s*(tahun|thn)\s*terakhir)\b/.test(t) ||
      /\b(satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh)\s*(tahun|thn)\s*terakhir\b/.test(t) ||
      /\b(beberapa|sejumlah)\s*(tahun|thn)\s*terakhir\b/.test(t) ||
      /\b(tahun|thn)\s*terakhir\b/.test(t)
    );
  })();

  // Fallback: even if query builder didn't extract a year, treat explicit years in the query as a period signal.
  const hasExplicitYearSignal = /\b(19\d{2}|20\d{2}|2100)\b/.test(qText);

  const hasPeriodSignal = Boolean(requestedYear || hasRelativeTimeSignal || hasExplicitYearSignal || hasQuarterSignal);

  // Check if top candidate is a confident match with latest data (for auto-preview)
  const topCandidate = Array.isArray(candidates) ? candidates[0] : null;
  const topScore = Number(topCandidate?.score || 0);
  const secondScore = Number(candidates?.[1]?.score || 0);
  const topName = String(topCandidate?.name || '');
  const secondName = String(candidates?.[1]?.name || '');
  const topIsProvince = isProvinceLevelName(topName);
  const topIsGeneral = !isKabKotaLevelName(topName);
  const secondIsKabKota = isKabKotaLevelName(secondName);
  const hasConfidentTopCandidate = topScore >= 80 && (
    (topScore - secondScore >= 5) ||
    ((topIsProvince || topIsGeneral) && secondIsKabKota) ||
    topScore >= 80
  );
  const topHasLatestData = Boolean(topCandidate?.latestYear);

  // UX policy (updated):
  // - If user explicitly asks to show table/link/number AND period exists -> auto preview.
  // - If user asks explicitly but period is missing -> confirm first (avoid wrong preview).
  // - If period exists but user didn't ask explicitly -> confirm first.
  // - NEW: If no period but confident match with latest year data -> auto preview with latest year.
  // - Else -> don't offer preview yet (stay in CS/discovery mode).
  let preview_mode = wantsPreviewNow ? (hasPeriodSignal ? 'auto' : 'confirm') : hasPeriodSignal ? 'confirm' : 'none';
  
  // NEW: Auto-preview when we have a confident top candidate with latest data
  // This ensures "pertumbuhan ekonomi" shows the latest quarterly data immediately
  if (preview_mode === 'none' && hasConfidentTopCandidate && topHasLatestData) {
    preview_mode = 'auto';
    // Use the top candidate's latest year as the requested year for preview
    if (!requestedYear && topCandidate?.latestYear) {
      requestedYear = topCandidate.latestYear;
    }
  }
  
  // If we already have a data preview and top candidate is confident+recent, force auto preview.
  if (dataPreview && hasConfidentTopCandidate && topHasLatestData) {
    preview_mode = 'auto';
  }
  if (intentResult?.ui_force_confirm) preview_mode = preview_mode === 'auto' ? 'confirm' : preview_mode;

  const list = Array.isArray(candidates) ? candidates : [];
  const topRows = list.slice(0, 8).map((it) => {
    const sid = Number(it?.id);
    const name = String(it?.name || '').trim() || `Sumber ${sid}`;
    const t = normalizeType(it?.type) || 'dynamic';
    const score = typeof it?.score === 'number' ? it.score : Number(it?.score || 0);
    const latest = latestBySource?.get(sid) || null;
    const latestLabel = latest?.year
      ? latest.month
        ? `${latest.year}-${String(latest.month).padStart(2, '0')}`
        : String(latest.year)
      : null;

    const hrefLatest = latest?.year
      ? buildDataHref({
          sourceId: sid,
          type: t,
          period: latest.year,
          month: latest.month || null,
          geo: geo || null,
        })
      : null;

    const hrefSearch = `/search?q=${encodeURIComponent(name)}`;

    return {
      id: sid,
      name,
      type: t,
      score: Number.isFinite(score) ? Math.round(score * 100) / 100 : 0,
      latest: latestLabel,
      href: hrefLatest || hrefSearch,
    };
  });

  const links = [];
  const planHref = intentResult?.plan?.href ? String(intentResult.plan.href) : '';
  if (planHref) {
    links.push({
      label:
        intentResult?.plan?.action === 'deeplink'
          ? 'Buka data yang paling sesuai'
          : 'Buka hasil pencarian yang paling sesuai',
      href: planHref,
    });
  }

  // Confidence heuristic: if top candidate is much higher than #2, avoid spamming extra links.
  const score0 = Number(list?.[0]?.score || 0);
  const score1 = Number(list?.[1]?.score || 0);
  const confidentTop = Number.isFinite(score0) && (score0 >= 1.2 || score0 - score1 >= 0.35);

  // Only show extra quick links when:
  // - user explicitly wants to open something, OR
  // - we're still in discovery/confirm mode (user didn't ask explicitly), OR
  // - ranking confidence is low.
  const shouldShowExtraLinks = wantsPreviewNow || preview_mode !== 'auto' || !confidentTop;
  if (shouldShowExtraLinks) {
    for (const r of topRows.slice(0, confidentTop ? 1 : 2)) {
      if (!r?.href) continue;
      links.push({ label: `Buka: ${r.name}`, href: r.href });
    }
  }

  // Suggestions: only when something important is missing / ambiguous.
  const suggestions = [];
  const missingYear = !requestedYear;
  const missingGeo = !geo && Boolean(hasGeoCandidate);
  const missingType = !normalizeType(qb?.type) || normalizeType(qb?.type) === 'pressrelease';


  // Check for ambiguous/tie candidates (score difference < 0.12)
  const hasAmbiguousCandidates = (() => {
    if (list.length < 2) return false;
    const s0 = Number(list[0]?.score || 0);
    const s1 = Number(list[1]?.score || 0);
    return Math.abs(s0 - s1) < 0.12;
  })();

  // Build disambiguation suggestion with top 2-3 candidate names
  if (hasAmbiguousCandidates && !confidentTop) {
    const candidateNames = list.slice(0, 3)
      .map(c => String(c?.name || '').trim())
      .filter(n => n.length > 0);
    if (candidateNames.length >= 2) {
      const optionsList = candidateNames.map((n, i) => `(${i + 1}) ${n}`).join(', ');
      suggestions.push(`Mau yang mana? ${optionsList}`);
    }
  }

  if (missingYear) suggestions.push('Tahun/periode berapa? (contoh: 2024 atau 2025)');
  if (!missingYear && requestedYear && !requestedMonth) suggestions.push('Kalau butuh bulanan, sebutkan bulan (contoh: Januari 2025)');
  if (missingGeo) suggestions.push('Wilayahnya yang mana? (contoh: Ternate / Tidore / Halmahera Barat)');
  if (missingType) suggestions.push('Jenis datanya apa? (dynamic / interop / static / exim)');

  // If user already asked explicitly and we’re confident, keep the UI clean.
  const shouldShowSuggestions = preview_mode !== 'auto' || !confidentTop || missingYear || missingGeo || hasAmbiguousCandidates;
  const finalSuggestions = shouldShowSuggestions ? Array.from(new Set(suggestions)).slice(0, 4) : [];

  const table = (() => {
    if (dataPreview && Array.isArray(dataPreview.columns) && Array.isArray(dataPreview.rows) && dataPreview.columns.length > 0) {
      return {
        kind: 'data',
        title: dataPreview.title || 'Preview data (database)',
        columns: dataPreview.columns,
        rows: dataPreview.rows,
        total_rows: dataPreview.total_rows,
        periodRange: dataPreview.periodRange || null,
      };
    }
    // Intentionally omit DB candidate tables from chat UI.
    // Candidates are still available in `candidates` for internal/UI logic if needed.
    return null;
  })();

  // Preview query suggestions: allow user confirmation and reduce mismatch.
  // Always include the original user query first.
  const preview_queries = (() => {
    if (preview_mode === 'none') return [];

    const out = [];

    const topName = topRows?.[0]?.name ? String(topRows[0].name).trim() : '';
    if (topName && topName.length >= 3) {
      const parts = [topName];

      const relText = qText.match(
        /\b(\d+\s*(?:tahun|thn)\s*terakhir|satu\s*(?:tahun|thn)\s*terakhir|dua\s*(?:tahun|thn)\s*terakhir|tiga\s*(?:tahun|thn)\s*terakhir|empat\s*(?:tahun|thn)\s*terakhir|lima\s*(?:tahun|thn)\s*terakhir|enam\s*(?:tahun|thn)\s*terakhir|tujuh\s*(?:tahun|thn)\s*terakhir|delapan\s*(?:tahun|thn)\s*terakhir|sembilan\s*(?:tahun|thn)\s*terakhir|sepuluh\s*(?:tahun|thn)\s*terakhir|beberapa\s*(?:tahun|thn)\s*terakhir|(?:tahun|thn)\s*terakhir)\b/i
      );

      const relN = (() => {
        const t = String(relText?.[0] || '').toLowerCase();
        if (!t) return null;
        const mDigit = t.match(/\b(\d{1,2})\s*(tahun|thn)\s*terakhir\b/);
        if (mDigit) {
          const n = Number(mDigit[1]);
          return Number.isInteger(n) && n >= 1 && n <= 10 ? n : null;
        }
        const map = {
          satu: 1,
          dua: 2,
          tiga: 3,
          empat: 4,
          lima: 5,
          enam: 6,
          tujuh: 7,
          delapan: 8,
          sembilan: 9,
          sepuluh: 10,
        };
        const mWord = t.match(
          /\b(satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh)\s*(tahun|thn)\s*terakhir\b/
        );
        if (mWord) return map[mWord[1]] || null;
        if (/\b(beberapa|sejumlah)\s*(tahun|thn)\s*terakhir\b/.test(t)) return 2;
        if (/\b(tahun|thn)\s*terakhir\b/.test(t)) return 1;
        return null;
      })();

      // Period: prefer explicit year ranges in free text (keeps "periode 2022-2023" intact).
      const yrRange = qText.match(/\b(19\d{2}|20\d{2}|2100)\s*[-–]\s*(19\d{2}|20\d{2}|2100)\b/);
      if (yrRange && yrRange[0]) {
        parts.push(yrRange[0].replace(/\s+/g, ''));
      } else if (requestedYear) {
        const mm = requestedMonth && Number.isInteger(requestedMonth) ? `-${String(requestedMonth).padStart(2, '0')}` : '';
        parts.push(`${requestedYear}${mm}`);
      } else {
        if (relN) {
          const topId = Number(topRows?.[0]?.id);
          const latestTop = Number.isFinite(topId) ? latestBySource?.get(topId) : null;
          const endYear = latestTop?.year || new Date().getFullYear();
          const startYear = endYear - (relN - 1);
          if (Number.isInteger(startYear) && Number.isInteger(endYear) && startYear >= 1900 && endYear <= 2100) {
            parts.push(`periode ${startYear}-${endYear}`);
          } else {
            parts.push(relText[0]);
          }
        } else if (relText && relText[0]) {
          parts.push(relText[0]);
        }
      }

      // Geo: use extracted geo; otherwise add the app default so the query reads well.
      if (geo) parts.push(geo);
      else parts.push('Maluku Utara');

      const q2 = parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 500);
      if (q2 && q2 !== qText) out.push({ label: 'Pakai indikator teratas', q: q2 });
    }

    // Always include the original user query as a fallback choice (but not necessarily the default).
    out.push({ label: 'Pakai pertanyaan asli', q: qText });

    // Put a cleaner query first so UI default is nicer.
    return out.slice(0, 3);
  })();

  return {
    v: 1,
    query: preview_mode === 'none' ? undefined : qText,
    preview_mode,
    preview_queries,
    requested: {
      year: requestedYear,
      month: requestedMonth,
      geo: geo || null,
    },
    table,
    candidates: topRows,
    links: links.slice(0, 3),
    suggestions: finalSuggestions,
  };
}

function normalizeType(raw) {
  const t = String(raw || '').toLowerCase();
  if (t === 'dynamic' || t === 'interop' || t === 'static' || t === 'exim' || t === 'pressrelease') return t;
  return '';
}

function parsePeriodValue(periodValue) {
  const raw = String(periodValue || '').trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  // Accept:
  // - YYYY
  // - YYYYMM
  // - TTT (BPS th_id) -> year = 1900 + TTT
  // - TTTMM
  if (digits.length === 4) {
    const y = Number(digits);
    if (Number.isFinite(y) && y >= 1900 && y <= 2999) return { year: y, month: 0, key: y * 100 };
  }
  if (digits.length === 6) {
    const y = Number(digits.slice(0, 4));
    const m = Number(digits.slice(4, 6));
    if (Number.isFinite(y) && y >= 1900 && y <= 2999 && Number.isFinite(m) && m >= 1 && m <= 12) {
      return { year: y, month: m, key: y * 100 + m };
    }
  }
  if (digits.length === 3) {
    const th = Number(digits);
    const y = 1900 + th;
    if (Number.isFinite(th) && th >= 0 && th <= 999 && y >= 1900 && y <= 2999) return { year: y, month: 0, key: y * 100 };
  }
  if (digits.length === 5) {
    const th = Number(digits.slice(0, 3));
    const m = Number(digits.slice(3, 5));
    const y = 1900 + th;
    if (Number.isFinite(th) && th >= 0 && th <= 999 && y >= 1900 && y <= 2999 && Number.isFinite(m) && m >= 1 && m <= 12) {
      return { year: y, month: m, key: y * 100 + m };
    }
  }
  return null;
}

async function getLatestPeriodForSource(sourceId) {
  const sid = Number(sourceId);
  if (!Number.isFinite(sid) || sid <= 0) return null;

  // Keep it DB-only and efficient: pull a bounded set of most "likely-latest" values.
  const rows = await DataPeriod.sequelize.query(
    'SELECT period_value FROM data_period_map WHERE source_id = ? ORDER BY LENGTH(period_value) DESC, period_value DESC LIMIT 500',
    {
      replacements: [sid],
      type: QueryTypes.SELECT,
    }
  );

  let best = null;
  for (const r of rows || []) {
    const pv = r?.period_value;
    const parsed = parsePeriodValue(pv);
    if (!parsed) continue;
    if (!best || parsed.key > best.key) best = parsed;
  }
  return best;
}

async function getAvailableYearsForSource(sourceId) {
  const sid = Number(sourceId);
  if (!Number.isFinite(sid) || sid <= 0) return [];

  const rows = await DataPeriod.sequelize.query(
    'SELECT period_value FROM data_period_map WHERE source_id = ? ORDER BY LENGTH(period_value) DESC, period_value DESC LIMIT 800',
    {
      replacements: [sid],
      type: QueryTypes.SELECT,
    }
  );

  const years = new Set();
  for (const r of rows || []) {
    const pv = r?.period_value;
    const parsed = parsePeriodValue(pv);
    if (!parsed?.year) continue;
    if (parsed.year >= 1900 && parsed.year <= 2100) years.add(parsed.year);
  }

  return Array.from(years).sort((a, b) => b - a);
}

/**
 * Get granularity for a datasource from period_map.
 * Returns 'monthly', 'quarterly', 'semester', or 'yearly' (default).
 */
async function getGranularityForSource(sourceId) {
  const sid = Number(sourceId);
  if (!Number.isFinite(sid) || sid <= 0) return 'yearly';

  try {
    const rows = await DataPeriod.sequelize.query(
      `SELECT granularity FROM data_period_map WHERE source_id = ? AND granularity IS NOT NULL LIMIT 1`,
      {
        replacements: [sid],
        type: QueryTypes.SELECT,
      }
    );
    return rows?.[0]?.granularity || 'yearly';
  } catch {
    return 'yearly';
  }
}

async function getAvailableYearsFromProcessedCache(sourceId) {
  const sid = Number(sourceId);
  if (!Number.isFinite(sid) || sid <= 0) return [];

  try {
    const rows = await ProcessedCache.sequelize.query(
      'SELECT period_value FROM data_processed_cache WHERE source_id = ? ORDER BY LENGTH(period_value) DESC, period_value DESC LIMIT 800',
      {
        replacements: [sid],
        type: QueryTypes.SELECT,
      }
    );

    const years = new Set();
    for (const r of rows || []) {
      const pv = r?.period_value;
      const parsed = parsePeriodValue(pv);
      if (!parsed?.year) continue;
      if (parsed.year >= 1900 && parsed.year <= 2100) years.add(parsed.year);
    }

    return Array.from(years).sort((a, b) => b - a);
  } catch {
    return [];
  }
}

async function getAvailableMonthsForSourceYear(sourceId, year) {
  const sid = Number(sourceId);
  const y = Number(year);
  if (!Number.isFinite(sid) || sid <= 0) return [];
  if (!Number.isInteger(y) || y < 1900 || y > 2100) return [];

  const th = y - 1900;
  const th3 = Number.isInteger(th) && th >= 0 && th <= 999 ? String(th).padStart(3, '0') : null;
  const y4 = String(y);

  // We store `period_value` as string; dynamic sources may use YYYYMM or TTTMM.
  // Query only relevant rows to keep it efficient and accurate for the requested year.
  const rows = await DataPeriod.sequelize.query(
    'SELECT period_value FROM data_period_map WHERE source_id = ? AND (period_value LIKE ? OR period_value LIKE ?) AND LENGTH(period_value) IN (5, 6) ORDER BY period_value ASC LIMIT 1200',
    {
      replacements: [sid, `${y4}__`, th3 ? `${th3}__` : '___' + '__'],
      type: QueryTypes.SELECT,
    }
  );

  const months = new Set();
  for (const r of rows || []) {
    const parsed = parsePeriodValue(r?.period_value);
    if (!parsed) continue;
    if (parsed.year !== y) continue;
    if (Number.isInteger(parsed.month) && parsed.month >= 1 && parsed.month <= 12) months.add(parsed.month);
  }

  return Array.from(months).sort((a, b) => a - b);
}

async function detectGeoCapabilityFromMetadataIndex(sourceId) {
  const sid = Number(sourceId);
  if (!Number.isFinite(sid) || sid <= 0) return false;

  // Column labels: explicit kab/kota/wilayah cues.
  try {
    const hit = await DataSourceSearchTerm.findOne({
      where: {
        source_id: sid,
        kind: 'column',
        [Op.or]: [
          // Common explicit labels
          { term_norm: { [Op.like]: '%kabupaten/kota%' } },
          { term_norm: { [Op.like]: '%kabupaten / kota%' } },
          { term_norm: { [Op.like]: '%kab/kota%' } },
          { term_norm: { [Op.like]: '%kab / kota%' } },
          // Two-word combos without slash
          {
            [Op.and]: [
              { term_norm: { [Op.like]: '%kabupaten%' } },
              { term_norm: { [Op.like]: '%kota%' } },
            ],
          },
          // Other common geo column labels
          { term_norm: { [Op.like]: '%wilayah%' } },
          { term_norm: { [Op.like]: '%kabupaten%' } },
          { term_norm: { [Op.like]: '%kota%' } },
          { term_norm: { [Op.like]: '%kab.%' } },
          { term_norm: { [Op.like]: '%kec.%' } },
          { term_norm: { [Op.like]: '%kecamatan%' } },
          // Phrasing patterns
          { term_norm: { [Op.like]: '%menurut kabupaten%' } },
          { term_norm: { [Op.like]: '%menurut kota%' } },
          { term_norm: { [Op.like]: '%menurut wilayah%' } },
        ],
      },
      attributes: ['id'],
    });
    if (hit) return true;
  } catch {
    // best-effort
  }

  // Row values: kab/kota names (Maluku Utara) indicate geo dimension.
  try {
    const hit = await DataSourceSearchTerm.findOne({
      where: {
        source_id: sid,
        kind: 'value',
        [Op.or]: [
          { term_norm: { [Op.like]: '%ternate%' } },
          { term_norm: { [Op.like]: '%tidore%' } },
          { term_norm: { [Op.like]: '%halmahera barat%' } },
          { term_norm: { [Op.like]: '%halmahera tengah%' } },
          { term_norm: { [Op.like]: '%halmahera utara%' } },
          { term_norm: { [Op.like]: '%halmahera selatan%' } },
          { term_norm: { [Op.like]: '%halmahera timur%' } },
          { term_norm: { [Op.like]: '%kepulauan sula%' } },
          { term_norm: { [Op.like]: '%pulau morotai%' } },
          { term_norm: { [Op.like]: '%pulau taliabu%' } },
          // Variants often seen in rows
          { term_norm: { [Op.like]: '%kab.%' } },
          { term_norm: { [Op.like]: '%kota%' } },
        ],
      },
      attributes: ['id'],
    });
    if (hit) return true;
  } catch {
    // best-effort
  }

  return false;
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
    tips.push('Untuk EXIM: bisa tambah “kode HS2 02”, “menurut negara”, atau “menurut pelabuhan”.');
  }

  return tips.slice(0, 5);
}

function cleanAssistantTextAgainstDb({ text, requestedYear, anyCandidateHasYear, hasDataPreview }) {
  let out = String(text || '').trim();
  if (!out) return out;

  // If DB suggests the requested year exists for at least one candidate,
  // avoid misleading statements like "belum tersedia" or "proyeksi".
  if (requestedYear && anyCandidateHasYear) {
    out = out
      .replace(/\bbelum\s+tersedia\b[^.。\n]*[.。]?/gi, '')
      .replace(/\b(proyeksi|perkiraan)\b[^.。\n]*[.。]?/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  // CRITICAL: If no data preview, strip any specific numbers that LLM might hallucinate
  if (!hasDataPreview) {
    // Remove percentage patterns like "12.5%", "12,5 persen", etc
    out = out.replace(/\b\d{1,3}[,.]?\d*\s*(%|persen)\b/gi, '[lihat tabel]');
    // Remove currency patterns like "Rp 1.5 juta", "IDR 500 miliar"
    out = out.replace(/\b(Rp\.?|IDR)\s*[\d.,]+\s*(ribu|juta|miliar|triliun)?\b/gi, '[lihat tabel]');
    // Remove large specific numbers that look like statistics (but NOT years 1900-2100)
    // Use negative lookbehind/lookahead to avoid matching standalone years
    out = out.replace(/\b(?!(?:19|20)\d{2}\b)\d{4,}[,.]?\d*\s*(orang|jiwa|ton|kg|unit|rumah|tangga)?\b/gi, '[lihat tabel]');
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

async function callOpenAIChat({ model, apiKey, messages, timeoutMs }) {
  // Delegates to the centralized llmChat helper (routes to malika-llm-proxy :3031).
  // llmChat handles retry, timeout, circuit breaker, and abort propagation; here we
  // only parse the response and extract assistant content.
  const res = await llmChat({
    model,
    messages,
    stream: false,
    apiKey,
    temperature: 0.2,
    timeoutMs,
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    const err = new Error('OpenAI response is not JSON');
    err.status = 502;
    err.code = 'openai_non_json';
    throw err;
  }

  const content = json?.choices?.[0]?.message?.content;
  return String(content || '').trim();
}

async function sendMessage(ownerId, threadId, userTextRaw) {
  const userText = String(userTextRaw || '').trim();
  if (!userText) {
    const err = new Error('Message is required');
    err.status = 400;
    err.code = 'missing_message';
    throw err;
  }

  const thread = await getThreadOwned(ownerId, threadId);

  const clippedUserText = userText.slice(0, 4000);

  function isConfirmMessage(raw) {
    const t = String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!t) return false;
    // Treat short confirmations as "go ahead".
    return (
      /^(ya|iya|y|ok|oke|sip|lanjut|gas|boleh)$/i.test(t) ||
      /^ya\s*,?\s*(tampilkan|lanjut)/i.test(t) ||
      /\b(tampilkan\s+datanya|tampilkan\s+preview|tampilkan\s+data)\b/i.test(t)
    );
  }

  function isLikelyTimeOrPeriodFragment(raw) {
    const t = String(raw || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t) return false;

    // Quick reject: if it's already a full question with many words, treat as not-fragment.
    const tokens = t.split(' ').filter(Boolean);
    if (tokens.length > 7) return false;

    const allowed = new Set([
      'untuk',
      'periode',
      'rentang',
      'dari',
      'sampai',
      'sd',
      's/d',
      'tahun',
      'thn',
      'bulan',
      'terakhir',
      'ini',
      'lalu',
      'kemarin',
      // Quarterly/semester terms
      'triwulan',
      'kuartal',
      'quartal',
      'q1',
      'q2',
      'q3',
      'q4',
      'semester',
      'i',
      'ii',
      'iii',
      'iv',
      // Month names
      'januari',
      'jan',
      'februari',
      'feb',
      'maret',
      'mar',
      'april',
      'apr',
      'mei',
      'juni',
      'jun',
      'juli',
      'jul',
      'agustus',
      'agu',
      'ags',
      'september',
      'sep',
      'oktober',
      'okt',
      'november',
      'nov',
      'desember',
      'des',
      // Number words
      'satu',
      'dua',
      'tiga',
      'empat',
      'lima',
      'enam',
      'tujuh',
      'delapan',
      'sembilan',
      'sepuluh',
      'beberapa',
      'sejumlah',
    ]);

    let hasTimeSignal = false;
    for (const tok of tokens) {
      if (/^(19\d{2}|20\d{2}|2100)$/.test(tok)) {
        hasTimeSignal = true;
        continue;
      }
      if (/^(0?[1-9]|1[0-2])$/.test(tok)) {
        // month number (often appears when user writes "01" etc.)
        continue;
      }
      if (allowed.has(tok)) {
        if (tok === 'tahun' || tok === 'thn' || tok === 'bulan' || tok === 'terakhir' ||
            tok === 'triwulan' || tok === 'kuartal' || tok === 'quartal' || tok === 'semester') {
          hasTimeSignal = true;
        }
        continue;
      }
      // Anything outside the allowlist indicates it's not a pure period fragment.
      return false;
    }

    return hasTimeSignal;
  }

  /**
   * Detect if user message is a geo-only follow-up (e.g., "morotai", "kabupaten morotai", "pulau morotai ada?")
   * that should be merged with previous topic context.
   * Also handles variants like "pulau morotai ada?", "morotai gimana?", "di ternate"
   */
  function isLikelyGeoOnlyFragment(raw) {
    if (!raw) return false;
    let t = String(raw).toLowerCase().trim();
    if (!t || t.length < 3) return false;
    
    // Strip common filler words/patterns that don't change the geo intent
    // e.g. "pulau morotai ada?" → "pulau morotai"
    const fillerPatterns = [
      /\s*(ada|tidak|gimana|bagaimana|dong|deh|nih|sih|ya|yah|juga|saja|aja)\s*\?*$/i,
      /^\s*(di|untuk|pada|ke|dari)\s+/i,
      /\s*\?+$/,
    ];
    for (const pattern of fillerPatterns) {
      t = t.replace(pattern, '').trim();
    }
    
    // Clean up remaining special chars
    t = t.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (!t || t.length < 3) return false;
    
    const tokens = t.split(' ').filter(Boolean);
    // Max 4 tokens for a geo fragment
    if (tokens.length > 4) return false;
    
    // Known kabupaten/kota names in Maluku Utara
    const knownGeo = new Set([
      'morotai', 'pulau morotai', 'ternate', 'kota ternate',
      'tidore', 'tidore kepulauan', 'kota tidore', 'kota tidore kepulauan', 'tikep',
      'halmahera utara', 'halmahera selatan', 'halmahera tengah', 
      'halmahera timur', 'halmahera barat', 'halut', 'halsel', 'halteng', 'haltim', 'halbar',
      'kepulauan sula', 'kepsul', 'sula', 'pulau taliabu', 'taliabu', 'pultal',
    ]);
    
    // Geo modifiers/prefixes that should be ignored
    const geoModifiers = new Set(['kabupaten', 'kab', 'kota', 'pulau', 'kepulauan']);
    
    // Filter out modifiers and check if remaining is a known geo
    const geoTokens = tokens.filter(tok => !geoModifiers.has(tok));
    const geoPhrase = geoTokens.join(' ');
    
    // Check if it matches known geo or starts with known geo
    if (knownGeo.has(geoPhrase)) return true;
    if (knownGeo.has(t)) return true;
    
    // Check individual tokens
    for (const tok of tokens) {
      if (knownGeo.has(tok)) return true;
    }
    
    return false;
  }

  /**
   * Detect if user message is an availability/period follow-up question that references
   * a different period (e.g. "apakah ada data triwulan 2 tahun 2025?", "ada tidak data 2024?").
   * These should be merged with the previous topic to maintain context.
   * Returns { isFollowUp: boolean, periodInfo?: { year, quarter, month }, periodFragment?: string }
   */
  function isAvailabilityFollowUp(raw) {
    const t = String(raw || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t) return { isFollowUp: false };

    // Must start with availability-checking phrase
    const availabilityPhrases = [
      /^apakah\s+ada\s+(data\s+)?(untuk\s+)?/,
      /^ada\s+(ga[k]?|tidak|nggak|ndak)?\s*(data\s+)?(untuk\s+)?/,
      /^data\s+(untuk\s+)?/,
      /^bagaimana\s+(dengan\s+)?(data\s+)?(untuk\s+)?/,
      /^gimana\s+(data\s+)?(untuk\s+)?/,
      /^kalau\s+(data\s+)?(untuk\s+)?/,
    ];

    let matchedPrefix = false;
    let remaining = t;
    for (const pat of availabilityPhrases) {
      if (pat.test(t)) {
        matchedPrefix = true;
        remaining = t.replace(pat, '').trim();
        break;
      }
    }
    if (!matchedPrefix) return { isFollowUp: false };

    // Check if the remaining part contains a period/time reference
    // e.g. "triwulan 2 tahun 2025", "2024", "januari 2025"
    const hasYear = /\b(19\d{2}|20\d{2}|2100)\b/.test(remaining);
    const hasQuarter = /\btriwulan\s*([1-4]|i{1,3}|iv)\b/i.test(remaining);
    const hasMonth = /\b(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\b/i.test(remaining);

    // Must have at least a year reference
    if (!hasYear && !hasQuarter && !hasMonth) return { isFollowUp: false };

    // Extract period info
    const yearMatch = remaining.match(/\b(19\d{2}|20\d{2}|2100)\b/);
    const quarterMatch = remaining.match(/\btriwulan\s*([1-4]|i{1,3}|iv)\b/i);
    
    let quarter = null;
    if (quarterMatch) {
      const qRaw = quarterMatch[1].toLowerCase();
      quarter = qRaw === 'i' ? 1 : qRaw === 'ii' ? 2 : qRaw === 'iii' ? 3 : qRaw === 'iv' ? 4 : parseInt(qRaw, 10);
    }

    // Build a clean period fragment for merging (only time-related tokens)
    // e.g. "triwulan 2 tahun 2025" from "apakah ada data triwulan 2 tahun 2025?"
    const periodFragment = remaining.trim();

    return {
      isFollowUp: true,
      periodInfo: {
        year: yearMatch ? Number(yearMatch[1]) : null,
        quarter,
      },
      periodFragment,
    };
  }

  /**
   * Merge base query with availability follow-up fragment.
   * Smarter than simple concatenation - extracts only relevant period info.
   */
  function mergeAvailabilityFollowUp(base, followUp) {
    const b = String(base || '').trim();
    const fragment = followUp?.periodFragment || '';
    if (!b) return fragment;
    if (!fragment) return b;
    
    // Only append the period fragment (e.g. "triwulan 2 tahun 2025")
    return `${b} ${fragment}`.replace(/\s+/g, ' ').trim();
  }

  function mergeQuery(base, fragment) {
    const b = String(base || '').trim();
    const f = String(fragment || '').trim();
    if (!b) return f;
    if (!f) return b;
    const bNorm = b.toLowerCase();
    const fNorm = f.toLowerCase();
    if (bNorm.includes(fNorm)) return b;
    return `${b} ${f}`.replace(/\s+/g, ' ').trim();
  }

  function extractLastNYearsCount(text) {
    const t = String(text || '').toLowerCase();
    if (!t) return null;

    // If explicit years/ranges already exist, don't treat as relative.
    if (/\b(19\d{2}|20\d{2}|2100)\b/.test(t)) return null;

    const mDigit = t.match(/\b(\d{1,2})\s*(tahun|thn)\s*terakhir\b/);
    if (mDigit) {
      const n = Number(mDigit[1]);
      if (Number.isInteger(n) && n >= 1 && n <= 10) return n;
    }

    const wordMap = {
      satu: 1,
      dua: 2,
      tiga: 3,
      empat: 4,
      lima: 5,
      enam: 6,
      tujuh: 7,
      delapan: 8,
      sembilan: 9,
      sepuluh: 10,
    };
    const mWord = t.match(
      /\b(satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh)\s*(tahun|thn)\s*terakhir\b/
    );
    if (mWord) return wordMap[mWord[1]] || null;

    if (/\b(beberapa|sejumlah)\s*(tahun|thn)\s*terakhir\b/.test(t)) return 2;
    if (/\b(tahun|thn)\s*terakhir\b/.test(t)) return 1;

    return null;
  }

  function replaceLastNYearsPhraseWithRange(text, startYear, endYear) {
    const raw = String(text || '');
    const rangeText = `periode ${startYear}-${endYear}`;
    const patterns = [
      /\b\d{1,2}\s*(tahun|thn)\s*terakhir\b/i,
      /\b(satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh)\s*(tahun|thn)\s*terakhir\b/i,
      /\b(beberapa|sejumlah)\s*(tahun|thn)\s*terakhir\b/i,
      /\b(tahun|thn)\s*terakhir\b/i,
    ];
    for (const re of patterns) {
      if (re.test(raw)) return raw.replace(re, rangeText);
    }
    return raw;
  }

  async function expandRelativeYearsToExplicitRange({ q, sourceId }) {
    const n = extractLastNYearsCount(q);
    if (!n) return { expanded: String(q || ''), range: null, note: null };

    const sid = Number(sourceId);
    if (!Number.isFinite(sid) || sid <= 0) return { expanded: String(q || ''), range: null, note: null };

    const availableYears = await getAvailableYearsForSource(sid);
    if (!availableYears?.length) return { expanded: String(q || ''), range: null, note: 'no_year_map' };

    const set = new Set(availableYears);
    const anchorYear = availableYears?.[0] || new Date().getFullYear();

    // Prefer a consecutive run of length N ending at the latest possible year.
    let chosenEnd = null;
    for (let end = anchorYear; end >= anchorYear - 20; end--) {
      let ok = true;
      for (let k = 0; k < n; k++) {
        if (!set.has(end - k)) {
          ok = false;
          break;
        }
      }
      if (ok) {
        chosenEnd = end;
        break;
      }
    }

    if (!chosenEnd) {
      // Fallback: use last N available years (may be non-consecutive).
      const picked = (availableYears || []).slice(0, n);
      if (!picked.length) return { expanded: String(q || ''), range: null, note: null };
      const endYear = Math.max(...picked);
      const startYear = Math.min(...picked);
      return {
        expanded: replaceLastNYearsPhraseWithRange(q, startYear, endYear),
        range: { startYear, endYear },
        note: 'non_consecutive',
      };
    }

    const endYear = chosenEnd;
    const startYear = chosenEnd - (n - 1);
    return {
      expanded: replaceLastNYearsPhraseWithRange(q, startYear, endYear),
      range: { startYear, endYear },
      note: null,
    };
  }

  const isConfirm = isConfirmMessage(clippedUserText);
  const isPeriodFragment = isLikelyTimeOrPeriodFragment(clippedUserText);
  const wantsPreviewNow =
    isConfirm ||
    /\b(tampilkan|lihat|buka|buat(?:kan)?|link|tabel|grafik|chart|unduh|download|angka|berapa|persentase|persen|jumlah|total|rata-rata|nilai|data)\b/i.test(clippedUserText);

  const createdUser = await ChatMessage.create({
    thread_id: threadId,
    role: 'user',
    content: clippedUserText,
    model: null,
    tokens_in: null,
    tokens_out: null,
    latency_ms: null,
    created_at: now(),
  });

  // Auto-title on first user message
  try {
    const hasAny = await ChatMessage.count({ where: { thread_id: threadId } });
    if (hasAny === 1 && (thread.title === 'Chat baru' || !thread.title)) {
      const nextTitle = clippedUserText.replace(/\s+/g, ' ').trim().slice(0, 60);
      await thread.update({
        title: nextTitle || 'Chat baru',
        updated_at: now(),
      });
    }
  } catch {
    // best-effort
  }

  const apiKey = getOpenAIKey();
  const model = getOpenAIModel();

  // Build a full-history context so intent/query builder and assistant can
  // resolve references like "yang tadi" reliably.
  let historyAllAsc = [];
  try {
    const all = await ChatMessage.findAll({
      where: { thread_id: threadId },
      order: [['id', 'ASC']],
      limit: 250,
    });
    historyAllAsc = all.map((r) => r.toJSON());
  } catch {
    historyAllAsc = [];
  }

  const historyForContext = historyAllAsc
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({ role: m.role, content: stripMalikaUiBlock(String(m.content || '')).trim() }))
    .filter((m) => m.content);

  function parseLastUiMetaFromContent(rawContent) {
    const raw = String(rawContent || '');
    if (!raw) return null;
    const m = raw.match(/```\s*malika_ui\s*\n([\s\S]*?)\n```/i);
    if (!m || !m[1]) return null;
    try {
      return JSON.parse(m[1]);
    } catch {
      return null;
    }
  }

  function findLastAssistantUiMeta() {
    if (!Array.isArray(historyAllAsc) || historyAllAsc.length < 2) return null;
    for (let i = historyAllAsc.length - 1; i >= 0; i--) {
      const m = historyAllAsc[i];
      if (!m || m.role !== 'assistant') continue;
      const ui = parseLastUiMetaFromContent(m.content);
      if (ui && Array.isArray(ui.candidates) && ui.candidates.length > 0) return ui;
    }
    return null;
  }

  function extractYears(text) {
    const raw = String(text || '');
    const years = Array.from(raw.matchAll(/\b(19\d{2}|20\d{2}|2100)\b/g))
      .map((mm) => Number(mm[1]))
      .filter((y) => Number.isInteger(y) && y >= 1900 && y <= 2100);
    return Array.from(new Set(years)).slice(0, 4);
  }

  function summarizeOlderMessages(list) {
    const older = Array.isArray(list) ? list : [];
    if (older.length === 0) return '';

    const lines = [];
    for (const m of older) {
      const role = m.role === 'user' ? 'User' : 'Assistant';
      const content = String(m.content || '').replace(/\s+/g, ' ').trim();
      if (!content) continue;
      const years = extractYears(content);
      const snippet = content.length > 140 ? `${content.slice(0, 140)}…` : content;
      lines.push(`- ${role}: ${snippet}${years.length ? ` (tahun: ${years.join(', ')})` : ''}`);
      if (lines.length >= 40) break;
    }
    return lines.join('\n');
  }

  const recentForIntent = historyForContext.slice(-20);
  const olderForIntent = historyForContext.slice(0, Math.max(0, historyForContext.length - 20));
  const intentContext =
    (olderForIntent.length
      ? `Ringkasan percakapan sebelumnya:\n${summarizeOlderMessages(olderForIntent)}\n\n`
      : '') +
    `Percakapan terbaru:\n${recentForIntent
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${String(m.content || '').slice(0, 500)}`)
      .join('\n')}`;

  // If the current user message is a confirmation (e.g. "ya tampilkan datanya"),
  // reuse the last meaningful user query from history for intent + UI query.
  function findLastMeaningfulUserQuery() {
    if (!historyAllAsc || historyAllAsc.length < 2) return '';
    for (let i = historyAllAsc.length - 2; i >= 0; i--) {
      const m = historyAllAsc[i];
      if (!m || m.role !== 'user') continue;
      const txt = stripMalikaUiBlock(String(m.content || '')).trim();
      if (!txt) continue;
      if (isConfirmMessage(txt)) continue;
      if (isLikelyTimeOrPeriodFragment(txt)) continue;
      if (isLikelyGeoOnlyFragment(txt)) continue; // Skip geo-only fragments too
      // Avoid picking extremely short acknowledgements.
      if (txt.replace(/\s+/g, ' ').trim().length < 12) continue;
      return txt.slice(0, 4000);
    }
    return '';
  }

  const isGeoOnlyFragment = isLikelyGeoOnlyFragment(clippedUserText);
  const availabilityFollowUp = isAvailabilityFollowUp(clippedUserText);
  
  let effectiveUserQuery = clippedUserText;
  const lastMeaningful = findLastMeaningfulUserQuery();
  if (isConfirm && lastMeaningful) {
    effectiveUserQuery = lastMeaningful;
  }
  // If user sends a period fragment (e.g. "2 tahun terakhir"), merge it into the
  // previous meaningful query (e.g. "data impor maluku utara").
  if (!isConfirm && isPeriodFragment && lastMeaningful) {
    effectiveUserQuery = mergeQuery(lastMeaningful, clippedUserText).slice(0, 4000);
  }
  // NEW: If user sends a geo-only fragment (e.g. "morotai", "kabupaten morotai"),
  // merge it into the previous meaningful query to maintain topic context.
  if (!isConfirm && !isPeriodFragment && isGeoOnlyFragment && lastMeaningful) {
    effectiveUserQuery = mergeQuery(lastMeaningful, clippedUserText).slice(0, 4000);
  }
  // NEW: If user sends an availability follow-up (e.g. "apakah ada data triwulan 2 tahun 2025?"),
  // merge only the period fragment with the previous topic to maintain context.
  // Use smarter merge that extracts only time-related tokens to avoid search noise.
  if (!isConfirm && !isPeriodFragment && !isGeoOnlyFragment && availabilityFollowUp.isFollowUp && lastMeaningful) {
    effectiveUserQuery = mergeAvailabilityFollowUp(lastMeaningful, availabilityFollowUp).slice(0, 4000);
  }

  // DB-only routing hint: use existing search intent logic to produce deterministic /data or /search link.
  let intentResult = null;
  try {
    intentResult = await resolveSearchIntent({ q: effectiveUserQuery, context: intentContext });
  } catch {
    intentResult = null;
  }

  let candidates = [];
  try {
    candidates = await buildDatasourceCandidates({
      q: effectiveUserQuery,
      qb: intentResult?.query_builder || null,
      limit: 12,
    });
  } catch {
    candidates = [];
  }

  // If user didn't specify a period, prefer the top candidate for preview when it's confident and recent.
  // This aligns preview/table with the smallest granularity + latest data.
  try {
    const hasExplicitYear = /\b(19\d{2}|20\d{2}|2100)\b/.test(effectiveUserQuery);
    const hasQuarter = /\b(triwulan|kuartal|q[1-4])\b/i.test(effectiveUserQuery);
    const hasMonthName = /\b(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\b/i.test(
      effectiveUserQuery
    );

    if (!hasExplicitYear && !hasQuarter && !hasMonthName) {
      const topId = Number(candidates?.[0]?.id);
      const topScore = Number(candidates?.[0]?.score || 0);
      const secondScore = Number(candidates?.[1]?.score || 0);
      const topName = String(candidates?.[0]?.name || '');
      const secondName = String(candidates?.[1]?.name || '');
      const topIsProvince = isProvinceLevelName(topName);
      const topIsGeneral = !isKabKotaLevelName(topName);
      const secondIsKabKota = isKabKotaLevelName(secondName);
      const hasConfidentTop = topScore >= 80 && (
        (topScore - secondScore >= 5) ||
        ((topIsProvince || topIsGeneral) && secondIsKabKota) ||
        topScore >= 80
      );

      if (Number.isFinite(topId) && topId > 0 && hasConfidentTop) {
        const latest = await getLatestPeriodForSource(topId);
        const hasAnyData = Boolean(latest?.year);
        if (hasAnyData) {
          intentResult = {
            ...(intentResult || {}),
            datasource: {
              ...(intentResult?.datasource || {}),
              source_id: topId,
              strategy: 'RANKED_RECENT_TOP',
            },
          };
        }
      }
    }
  } catch {
    // best-effort
  }

  // Helper to check if query contains specific kabupaten/kota name
  const hasSpecificGeoInQuery = (() => {
    const knownKabKota = [
      'halmahera utara', 'halmahera selatan', 'halmahera timur', 'halmahera barat', 'halmahera tengah',
      'kepulauan sula', 'pulau taliabu', 'pulau morotai', 'morotai',
      'ternate', 'tidore', 'tidore kepulauan',
    ];
    const norm = String(effectiveUserQuery || '').toLowerCase();
    return knownKabKota.some((g) => norm.includes(g));
  })();

  // If user only follows up with a period/time fragment, keep datasource selection stable
  // by biasing toward the previous assistant's top candidate.
  // BUT: Do NOT apply this if user query contains specific geo name - geo overrides period fragment handling
  try {
    if (!isConfirm && isPeriodFragment && !hasSpecificGeoInQuery) {
      const prevUi = findLastAssistantUiMeta();
      const preferredSourceId = Number(prevUi?.candidates?.[0]?.id);
      if (Number.isFinite(preferredSourceId) && preferredSourceId > 0 && Array.isArray(candidates) && candidates.length > 1) {
        const idx = candidates.findIndex((c) => Number(c?.id) === preferredSourceId);
        if (idx > 0) {
          const picked = candidates[idx];
          candidates = [picked, ...candidates.slice(0, idx), ...candidates.slice(idx + 1)];
        }
      }
    }
  } catch {
    // best-effort
  }

  // Confidence check: if top candidate score is too low, flag for confirmation
  // This prevents showing wrong data when intent is ambiguous
  // Configurable via MALIKA_MIN_CONFIDENCE (default: 0.6)
  let lowConfidenceFlag = false;
  try {
    const minConfidence = Number(process.env.MALIKA_MIN_CONFIDENCE) || 0.6;
    const topScore = Number(candidates?.[0]?.score || 0);
    const secondScore = Number(candidates?.[1]?.score || 0);
    
    // Low confidence if:
    // 1. Top score is below threshold, OR
    // 2. Top and second are too close (ambiguous)
    if (topScore < minConfidence) {
      lowConfidenceFlag = true;
    } else if (candidates.length >= 2 && (topScore - secondScore) < 0.15) {
      // Ambiguous: top two are very close
      lowConfidenceFlag = true;
    }
  } catch {
    // best-effort
  }

  // Convert relative period phrases (e.g. "2 tahun terakhir") into explicit year ranges
  // BEFORE we show the confirmation query / run preview.
  try {
    const selectedSourceIdForAvailability = intentResult?.datasource?.source_id
      ? Number(intentResult.datasource.source_id)
      : Number(candidates?.[0]?.id);

    const expanded = await expandRelativeYearsToExplicitRange({
      q: effectiveUserQuery,
      sourceId: selectedSourceIdForAvailability,
    });
    if (expanded?.expanded && expanded.expanded !== effectiveUserQuery) {
      effectiveUserQuery = String(expanded.expanded).slice(0, 4000);
    }
  } catch {
    // best-effort
  }

  const latestBySource = new Map();
  try {
    const ids = new Set([
      ...(Array.isArray(candidates) ? candidates.slice(0, 6).map((c) => Number(c?.id)).filter((n) => Number.isFinite(n) && n > 0) : []),
      ...(intentResult?.datasource?.source_id ? [Number(intentResult.datasource.source_id)] : []),
    ]);
    for (const sid of ids) {
      try {
        const latest = await getLatestPeriodForSource(sid);
        if (latest) latestBySource.set(Number(sid), latest);
      } catch {
        // best-effort
      }
    }
  } catch {
    // ignore
  }

  // Fallback: if a relative phrase is still present, expand it using the latest available year.
  // This helps when `data_period_map` lookups fail or return an empty year list.
  try {
    const n = extractLastNYearsCount(effectiveUserQuery);
    if (n) {
      const sid = intentResult?.datasource?.source_id
        ? Number(intentResult.datasource.source_id)
        : Number(candidates?.[0]?.id);
      if (Number.isFinite(sid) && sid > 0) {
        const latest = latestBySource.get(Number(sid));
        const endYear = latest?.year;
        let anchorYear = Number.isInteger(endYear) ? endYear : null;
        if (!anchorYear) anchorYear = await getGlobalLatestYearFromPeriodMap();
        if (Number.isInteger(anchorYear) && anchorYear >= 1900 && anchorYear <= 2100) {
          const startYear = anchorYear - (n - 1);
          const replaced = replaceLastNYearsPhraseWithRange(effectiveUserQuery, startYear, anchorYear);
          if (replaced && replaced !== effectiveUserQuery) {
            effectiveUserQuery = String(replaced).slice(0, 4000);
          }
        }
      }
    }
  } catch {
    // best-effort
  }

  // If user asked for a specific year/range that isn't available for the selected datasource,
  // avoid showing an empty preview. Suggest available years and adjust the confirmation query.
  let periodAvailabilityNotice = '';
  let uiForceConfirm = lowConfidenceFlag; // Start with confidence flag
  let lowConfidenceNotice = '';
  
  // Add notice if confidence is low
  if (lowConfidenceFlag && candidates.length > 0) {
    const topName = String(candidates[0]?.name || '').trim();
    lowConfidenceNotice = topName
      ? `Saya kurang yakin apakah "${topName}" adalah indikator yang tepat. Apakah benar?`
      : 'Saya kurang yakin dengan indikator yang dimaksud. Bisa tolong diperjelas?';
  }
  
  let qbYearOverride = null;
  let qbMonthOverride = undefined;
  let uiSuppressMonth = false;
  try {
    const qb = intentResult?.query_builder;
    const qbYear = qb?.params?.year ? normalizeYearValue(qb.params.year) : null;
    const qbMonth = qb?.params?.month ? safeParseInt(qb.params.month) : null;

    const monthInText = (() => {
      const norm = String(effectiveUserQuery || '').toLowerCase();
      const mNumeric = norm.match(/\b(?:19\d{2}|20\d{2}|2100)\s*[-–\/]\s*(0?[1-9]|1[0-2])\b/);
      if (mNumeric && mNumeric[1]) {
        const m = Number(mNumeric[1]);
        return Number.isInteger(m) && m >= 1 && m <= 12 ? m : null;
      }
      const map = {
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
      for (const [k, v] of Object.entries(map)) {
        if (norm.includes(k)) return v;
      }
      return null;
    })();

    const requestedMonth = qbMonth || monthInText;
    // Keep QB in sync so later preview query formatting includes the month.
    if (!qbMonth && requestedMonth && qbMonthOverride === undefined) {
      qbMonthOverride = requestedMonth;
    }
    const selectedSourceId = intentResult?.datasource?.source_id
      ? Number(intentResult.datasource.source_id)
      : Number(candidates?.[0]?.id);

    if (Number.isFinite(selectedSourceId) && selectedSourceId > 0) {
      // Prefer cache-backed availability to match what preview/search can actually show.
      const yearsFromCache = await getAvailableYearsFromProcessedCache(selectedSourceId);
      const yearsFromMap = yearsFromCache.length ? yearsFromCache : await getAvailableYearsForSource(selectedSourceId);
      const yearsFallback = (() => {
        const latest = latestBySource.get(Number(selectedSourceId));
        const y = latest?.year;
        return Number.isInteger(y) ? [y] : [];
      })();

      const availableYears = (yearsFromMap && yearsFromMap.length ? yearsFromMap : yearsFallback).filter(
        (y) => Number.isInteger(y) && y >= 1900 && y <= 2100
      );

      const yrRangeInText = effectiveUserQuery.match(/\b(19\d{2}|20\d{2}|2100)\s*[-–]\s*(19\d{2}|20\d{2}|2100)\b/);
      const rangeLen = (() => {
        if (!yrRangeInText) return null;
        const a = Number(yrRangeInText[1]);
        const b = Number(yrRangeInText[2]);
        if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
        const len = Math.abs(b - a) + 1;
        return len >= 1 && len <= 10 ? len : null;
      })();

      const requestedYearInText = (() => {
        const m = effectiveUserQuery.match(/\b(19\d{2}|20\d{2}|2100)\b/);
        if (!m || !m[1]) return null;
        const y = Number(m[1]);
        return Number.isInteger(y) && y >= 1900 && y <= 2100 ? y : null;
      })();

      // Prefer explicit year in the text; QB can sometimes contain th_id-like values.
      const requestedYear = requestedYearInText || qbYear;

      function formatYearsSuggestion(listYears) {
        const ys = Array.isArray(listYears) ? listYears.filter((y) => Number.isInteger(y)).slice(0, 8) : [];
        if (!ys.length) return '';
        const max = ys[0];
        const min = ys[ys.length - 1];
        const isConsecutive = ys.every((y, i) => i === 0 || ys[i - 1] - y === 1);
        if (isConsecutive && ys.length >= 3) return `Tahun tersedia: ${min}-${max}.`;
        return `Tahun tersedia: ${ys.slice(0, 6).join(', ')}.`;
      }

      if (availableYears.length && requestedYear && !availableYears.includes(requestedYear)) {
        // UX policy: do NOT silently switch year when user explicitly asked for a year.
        // Ask for confirmation and show available years only.
        uiForceConfirm = true;
        const suggestionText = formatYearsSuggestion(availableYears);
        periodAvailabilityNotice =
          `Catatan: periode ${requestedYear} belum tersedia untuk indikator ini. ` +
          `${suggestionText} ` +
          `Silakan pilih tahun yang tersedia.`;
      }

      // Month-level validation: only if user requested a month.
      // If month isn't available for the selected year, suggest the nearest available month
      // (or drop the month if the datasource is yearly-only).
      const effectiveYearForMonth = qbYearOverride || requestedYear;
      if (availableYears.length && requestedMonth && effectiveYearForMonth && availableYears.includes(effectiveYearForMonth)) {
        const months = await getAvailableMonthsForSourceYear(selectedSourceId, effectiveYearForMonth);

        function pickClosestMonth(target, listMonths) {
          const ms = Array.isArray(listMonths) ? listMonths.filter((m) => Number.isInteger(m) && m >= 1 && m <= 12) : [];
          if (!ms.length || !Number.isInteger(target)) return null;
          // Prefer closest; tie-break toward latest month.
          ms.sort((a, b) => b - a);
          let best = ms[0];
          let bestDist = Math.abs(best - target);
          for (const m of ms) {
            const d = Math.abs(m - target);
            if (d < bestDist) {
              best = m;
              bestDist = d;
            }
          }
          return best;
        }

        function formatMonthsSuggestion(listMonths) {
          const ms = Array.isArray(listMonths)
            ? listMonths.filter((m) => Number.isInteger(m) && m >= 1 && m <= 12).slice(0, 12)
            : [];
          if (!ms.length) return '';
          const min = ms[0];
          const max = ms[ms.length - 1];
          const isConsecutive = ms.every((m, i) => i === 0 || ms[i - 1] + 1 === m);
          const fmt = (m) => String(m).padStart(2, '0');
          if (isConsecutive && ms.length >= 3) return `Bulan tersedia: ${fmt(min)}-${fmt(max)}.`;
          return `Bulan tersedia: ${ms.map(fmt).slice(0, 8).join(', ')}.`;
        }

        const yy = effectiveYearForMonth;

        const applyMonthCorrection = (suggestedMonth, sourceLabel = 'periode') => {
          if (!suggestedMonth) return;
          uiForceConfirm = true;
          qbMonthOverride = suggestedMonth;
          const fromLabel = `${yy}-${String(requestedMonth).padStart(2, '0')}`;
          const toLabel = `${yy}-${String(suggestedMonth).padStart(2, '0')}`;

          if (new RegExp(`\\b${yy}\\s*[-–/]\\s*\\d{1,2}\\b`).test(effectiveUserQuery)) {
            effectiveUserQuery = effectiveUserQuery.replace(new RegExp(`\\b${yy}\\s*[-–/]\\s*\\d{1,2}\\b`), toLabel);
          } else if (new RegExp(`\\b${yy}\\b`).test(effectiveUserQuery)) {
            effectiveUserQuery = effectiveUserQuery.replace(new RegExp(`\\b${yy}\\b`), toLabel);
          } else {
            effectiveUserQuery = `${effectiveUserQuery} ${toLabel}`.trim();
          }

          const msg =
            `Catatan: ${sourceLabel} ${fromLabel} tidak tersedia untuk indikator ini. ` +
            `Saya ubah query konfirmasi ke periode ${toLabel}.`;
          periodAvailabilityNotice = periodAvailabilityNotice ? `${periodAvailabilityNotice}\n${msg}` : msg;
        };

        if (months.length > 0) {
          // True month-level availability is explicitly stored in period map.
          if (!months.includes(requestedMonth)) {
            const suggestedMonth = pickClosestMonth(requestedMonth, months);
            const msText = formatMonthsSuggestion(months);
            if (suggestedMonth) {
              applyMonthCorrection(suggestedMonth, `periode`);
              if (periodAvailabilityNotice && msText && !periodAvailabilityNotice.includes('Bulan tersedia:')) {
                periodAvailabilityNotice = `${periodAvailabilityNotice} ${msText}`;
              }
            }
          }
        } else {
          // Many dynamic tables are year-indexed in period_map, but the month exists inside the processed table.
          // Validate month based on cached processed rows (no external fetch).
          try {
            const processed = await getProcessedPreviewFromCache({ sourceId: selectedSourceId, year: yy, month: null });
            const cols = Array.isArray(processed?.columns) ? processed.columns : [];
            const rows = Array.isArray(processed?.data) ? processed.data : [];

            const monthColKey = (() => {
              // Prefer explicit 'Bulan' column.
              const direct = cols.find((c) => String(c).toLowerCase() === 'bulan');
              if (direct) return String(direct);
              // Fallback: any column containing 'bulan'.
              const any = cols.find((c) => String(c).toLowerCase().includes('bulan'));
              return any ? String(any) : null;
            })();

            // Check if this is quarterly data (has "Triwulan" values)
            const hasQuarterlyValues = rows.some((r) => {
              const obj = r && typeof r === 'object' ? r : {};
              const colValue = monthColKey ? String(obj?.[monthColKey] || '').toLowerCase() : '';
              return /triwulan/i.test(colValue);
            });

            if (!monthColKey) {
              // No month column at all → treat as yearly-only.
              uiForceConfirm = true;
              qbMonthOverride = null;
              uiSuppressMonth = true;
              effectiveUserQuery = effectiveUserQuery
                .replace(/\b(19\d{2}|20\d{2}|2100)\s*[-–/]\s*\d{1,2}\b/, '$1')
                .replace(/\b(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\b/gi, '')
                .replace(/\s+/g, ' ')
                .trim();
              const msg = `Catatan: indikator ini tersedia tahunan (tidak punya dimensi bulan). Saya hapus bulan dari query konfirmasi.`;
              periodAvailabilityNotice = periodAvailabilityNotice ? `${periodAvailabilityNotice}\n${msg}` : msg;
            } else if (hasQuarterlyValues) {
              // Quarterly data - skip monthly validation, will be filtered by quarter
              // Clear month override, keep the quarter
              qbMonthOverride = undefined;
              // Don't trigger "tersedia tahunan" message for quarterly data
            } else {
              const monthNameToNo = {
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

              const availableMonths = new Set();
              for (const r of rows || []) {
                const obj = r && typeof r === 'object' ? r : {};
                const label = String(obj?.[monthColKey] || '').toLowerCase().trim();
                const mNo = monthNameToNo[label] || null;
                if (!mNo) continue;

                // Consider month "available" only if at least one non-month column has a value.
                const keys = Object.keys(obj || {});
                const valueKeys = keys.filter((k) => String(k) !== monthColKey);
                const hasAnyValue = valueKeys.some((k) => {
                  const v = obj[k];
                  if (v == null) return false;
                  if (typeof v === 'number') return Number.isFinite(v);
                  const s = String(v).trim();
                  return s !== '' && s !== '-' && s.toLowerCase() !== 'null';
                });
                if (hasAnyValue) availableMonths.add(mNo);
              }

              const sorted = Array.from(availableMonths).sort((a, b) => a - b);
              if (sorted.length > 0 && !availableMonths.has(requestedMonth)) {
                const suggestedMonth = pickClosestMonth(requestedMonth, sorted);
                applyMonthCorrection(suggestedMonth, 'bulan');
              }
            }
          } catch {
            // If cache is missing, don't guess month availability.
          }
        }
      }
    }
  } catch {
    periodAvailabilityNotice = '';
    uiForceConfirm = false;
    qbYearOverride = null;
    qbMonthOverride = undefined;
    uiSuppressMonth = false;
  }

  // Patch QB params so subsequent preview/table logic uses the corrected year/month.
  if (intentResult?.query_builder && (qbYearOverride || qbMonthOverride !== undefined)) {
    try {
      const qb0 = intentResult.query_builder;
      const params0 = qb0?.params || {};
      const nextParams = { ...params0 };
      if (qbYearOverride) nextParams.year = qbYearOverride;
      if (qbMonthOverride !== undefined) nextParams.month = qbMonthOverride;
      intentResult = {
        ...(intentResult || {}),
        ui_suppress_month: Boolean(uiSuppressMonth),
        query_builder: {
          ...(qb0 || {}),
          params: nextParams,
        },
      };
    } catch {
      // best-effort
    }
  }

  if (intentResult && uiSuppressMonth && intentResult.ui_suppress_month !== true) {
    intentResult = { ...(intentResult || {}), ui_suppress_month: true };
  }

  let assistantText = '';
  let latencyMs = null;

  // Try to load a DB-only preview table for the best datasource & requested period.
  // This should NOT trigger external fetches (reads from ProcessedCache only).
  let dataPreview = null;
  let dataPreviewLooksEmpty = false;
  let dataPreviewIsFallback = false; // true if showing a different year than requested
  let dataPreviewRequestedYear = null;
  let dataPreviewActualYear = null;
  let dataPreviewGeoInfo = null; // geo filter status info
  let dataPreviewQuarterInfo = null; // quarter filter status info
  try {
    const qb = intentResult?.query_builder;
    const y = qb?.params?.year ? normalizeYearValue(qb.params.year) : null;
    const m = qb?.params?.month ? Number(qb.params.month) : null;
    const geo = qb?.params?.geo ? String(qb.params.geo).trim() : '';
    
    // Parse quarter from the original query
    const quarterInfo = parseQuarterFromText(effectiveUserQuery || userText);
    const quarterNum = quarterInfo?.quarter || null;

    dataPreviewRequestedYear = y;

    // Determine if we should generate preview:
    // - If user explicitly asked to show data (wantsPreviewNow)
    // - If user specified a year
    // - NEW: If top candidate has recent data (latestYear >= current year - 1) and confident match
    const topCandidateId = Number(candidates?.[0]?.id);
    const intentSourceId = intentResult?.datasource?.source_id
      ? Number(intentResult.datasource.source_id)
      : null;
    const topCandidateScore = Number(candidates?.[0]?.score || 0);
    const secondCandidateScore = Number(candidates?.[1]?.score || 0);
    const topCandidateName = String(candidates?.[0]?.name || '');
    const secondCandidateName = String(candidates?.[1]?.name || '');
    const topIsProvince = isProvinceLevelName(topCandidateName);
    const topIsGeneral = !isKabKotaLevelName(topCandidateName);
    const secondIsKabKota = isKabKotaLevelName(secondCandidateName);
    const hasConfidentMatch = topCandidateScore >= 80 && (
      (topCandidateScore - secondCandidateScore >= 5) ||
      ((topIsProvince || topIsGeneral) && secondIsKabKota) ||
      topCandidateScore >= 80
    );

    const topCandidateLatest = Number.isFinite(topCandidateId) && topCandidateId > 0
      ? latestBySource?.get(topCandidateId)
      : null;
    const topHasRecentData = Boolean(topCandidateLatest?.year);

    // Prefer top candidate for preview when it's a confident match with data
    let selectedSourceId = (hasConfidentMatch && topHasRecentData && Number.isFinite(topCandidateId) && topCandidateId > 0)
      ? topCandidateId
      : (Number.isFinite(intentSourceId) && intentSourceId > 0 ? intentSourceId : topCandidateId);
    
    // Skip preview only if:
    // - No year specified AND
    // - User didn't ask for preview explicitly AND
    // - We DON'T have a confident match with recent data
    if (!y && !wantsPreviewNow && !(hasConfidentMatch && topHasRecentData)) {
      throw new Error('skip_preview_discovery');
    }

    // If user did NOT specify any period, always align preview with top-ranked candidate.
    const hasExplicitYear = /\b(19\d{2}|20\d{2}|2100)\b/.test(effectiveUserQuery || userText || '');
    const hasQuarter = /\b(triwulan|kuartal|q[1-4])\b/i.test(effectiveUserQuery || userText || '');
    const hasMonthName = /\b(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\b/i.test(
      effectiveUserQuery || userText || ''
    );
    const noPeriodSpecified = !hasExplicitYear && !hasQuarter && !hasMonthName;
    if (noPeriodSpecified && Number.isFinite(topCandidateId) && topCandidateId > 0) {
      // Override datasource to ensure preview matches smallest-granularity + latest candidate
      if (!intentResult?.datasource || Number(intentResult?.datasource?.source_id) !== topCandidateId) {
        intentResult = {
          ...(intentResult || {}),
          datasource: {
            ...(intentResult?.datasource || {}),
            source_id: topCandidateId,
            strategy: 'RANKED_TOP_NO_PERIOD',
          },
        };
      }
      selectedSourceId = topCandidateId;
    }

    // If requested year missing, try latest period as a fallback for preview.
    let yy = y;
    let mm = m;
    if (!yy && Number.isFinite(selectedSourceId) && selectedSourceId > 0) {
      const latest = latestBySource.get(Number(selectedSourceId));
      if (latest?.year) {
        yy = latest.year;
        mm = latest.month || null;
      }
    }

    // Check if requested year doesn't match available years - use latest as fallback
    if (y && Number.isFinite(selectedSourceId) && selectedSourceId > 0) {
      const latest = latestBySource.get(Number(selectedSourceId));
      if (latest?.year && latest.year !== y) {
        // User requested a year that might not be available, check and use fallback
        let processed = await getProcessedPreviewFromCache({
          sourceId: selectedSourceId,
          year: y,
          month: m,
          geo: null, // Don't apply geo filter for availability check
        });
        if (!processed) {
          processed = await getMergedPreviewFromCache({
            sourceId: selectedSourceId,
            year: y,
            geo: null,
          });
        }
        if (!processed || !Array.isArray(processed.data) || processed.data.length === 0) {
          // Requested year has no data, use latest as fallback
          yy = latest.year;
          mm = latest.month || null;
          dataPreviewIsFallback = true;
        }
      }
    }

    dataPreviewActualYear = yy;

    // Check for period range (e.g., "2020-2024", "2023 sampai 2025")
    const periodRange = extractPeriodRange(qb);
    const isRangeQuery = periodRange !== null && periodRange.years && periodRange.years.length > 1;
    
    // PERIOD RANGE HANDLING: Fetch and merge data from multiple years
    if (isRangeQuery && Number.isFinite(selectedSourceId) && selectedSourceId > 0) {
      const rangeProcessed = await getProcessedPreviewForRange({
        sourceId: selectedSourceId,
        years: periodRange.years,
        geo: geo || null,
      });
      
      if (rangeProcessed && Array.isArray(rangeProcessed.data) && rangeProcessed.data.length > 0) {
        
        // Track geo filter info for UI feedback
        if (geo) {
          dataPreviewGeoInfo = {
            requested: geo,
            matched: rangeProcessed.geoMatched,
            matchCount: rangeProcessed.geoMatchCount,
          };
        }
        
        const columns = rangeProcessed.columns.slice(0, 12).map((c) => String(c));
        const rowsRaw = Array.isArray(rangeProcessed.data) ? rangeProcessed.data : [];
        const rows = rowsRaw.slice(0, 30).map((r) => { // Allow more rows for range
          const obj = r && typeof r === 'object' ? r : {};
          const picked = {};
          for (const c of columns) picked[c] = obj[c];
          return picked;
        });
        
        // Generate year label based on whether it's specific years or continuous range
        let yearLabel;
        if (periodRange.isSpecificYears && rangeProcessed.availableYears.length > 0) {
          // Specific years: show comma-separated (e.g., "2020, 2022, 2024")
          yearLabel = rangeProcessed.availableYears.join(', ');
        } else if (rangeProcessed.availableYears.length > 0) {
          // Continuous range: show range format (e.g., "2020-2024")
          yearLabel = rangeProcessed.availableYears.length === 1
            ? String(rangeProcessed.availableYears[0])
            : `${rangeProcessed.availableYears[0]}-${rangeProcessed.availableYears[rangeProcessed.availableYears.length - 1]}`;
        } else {
          yearLabel = periodRange.isSpecificYears
            ? periodRange.years.join(', ')
            : `${periodRange.yearStart}-${periodRange.yearEnd}`;
        }
        
        // Build title with geo filter indication
        let titleSuffix = '';
        if (dataPreviewGeoInfo?.requested) {
          if (dataPreviewGeoInfo.matched) {
            titleSuffix = ` • Filter: ${dataPreviewGeoInfo.requested} (${dataPreviewGeoInfo.matchCount} baris)`;
          } else {
            titleSuffix = ` • Filter "${dataPreviewGeoInfo.requested}" tidak cocok, tampilkan semua`;
          }
        }
        
        dataPreview = {
          title: `${rangeProcessed.source || 'Data Statistik'} • ${yearLabel}${titleSuffix}`,
          columns,
          rows,
          total_rows: rangeProcessed.data.length,
          periodRange: {
            requested: { start: periodRange.yearStart, end: periodRange.yearEnd, isSpecificYears: periodRange.isSpecificYears },
            available: rangeProcessed.availableYears,
          },
        };
        dataPreviewActualYear = periodRange.yearEnd;
      }
    }
    
    // SINGLE YEAR HANDLING (if not range query or range failed)
    if (!dataPreview && Number.isInteger(yy) && yy >= 1900 && yy <= 2100 && Number.isFinite(selectedSourceId) && selectedSourceId > 0) {
      let processed = await getProcessedPreviewFromCache({
        sourceId: selectedSourceId,
        year: yy,
        month: mm,
        geo: geo || null, // Apply geo filter when displaying preview
        quarter: quarterNum, // Apply quarter filter when displaying preview
      });
      if (!processed) {
        processed = await getMergedPreviewFromCache({
          sourceId: selectedSourceId,
          year: yy,
          geo: geo || null,
          quarter: quarterNum,
        });
      }
      if (processed) {
        // Track geo filter info for UI feedback
        if (geo) {
          dataPreviewGeoInfo = {
            requested: geo,
            matched: processed.geoMatched,
            matchCount: processed.geoMatchCount,
          };
        }
        
        // Track quarter filter info for UI feedback
        if (quarterNum) {
          dataPreviewQuarterInfo = {
            requested: quarterNum,
            matched: processed.quarterMatched,
            matchCount: processed.quarterMatchCount,
          };
        }

        const columns = processed.columns.slice(0, 12).map((c) => String(c));
        const rowsRaw = Array.isArray(processed.data) ? processed.data : [];
        const rows = rowsRaw.slice(0, 20).map((r) => {
          const obj = r && typeof r === 'object' ? r : {};
          const picked = {};
          for (const c of columns) picked[c] = obj[c];
          return picked;
        });

        // Heuristic: if all non-first columns are null/empty across the preview rows, treat as empty.
        try {
          const valueCols = columns.slice(1);
          if (valueCols.length > 0 && rows.length > 0) {
            const anyValue = rows.some((rr) =>
              valueCols.some((c) => {
                const v = rr?.[c];
                if (v == null) return false;
                if (typeof v === 'number') return Number.isFinite(v);
                const s = String(v).trim();
                return s !== '' && s !== '-' && s.toLowerCase() !== 'null';
              })
            );
            dataPreviewLooksEmpty = !anyValue;
          }
        } catch {
          dataPreviewLooksEmpty = false;
        }

        const periodLabel = String(yy) + (Number.isInteger(mm) ? `-${String(mm).padStart(2, '0')}` : '');
        
        // Build title with geo and quarter filter indication
        let titleSuffix = '';
        if (dataPreviewGeoInfo?.requested) {
          if (dataPreviewGeoInfo.matched) {
            titleSuffix = ` • Filter: ${dataPreviewGeoInfo.requested} (${dataPreviewGeoInfo.matchCount} baris)`;
          } else {
            titleSuffix = ` • Filter "${dataPreviewGeoInfo.requested}" tidak cocok, tampilkan semua`;
          }
        }
        if (dataPreviewQuarterInfo?.requested) {
          const qLabels = { 1: 'Triwulan I', 2: 'Triwulan II', 3: 'Triwulan III', 4: 'Triwulan IV' };
          const qLabel = qLabels[dataPreviewQuarterInfo.requested] || `Triwulan ${dataPreviewQuarterInfo.requested}`;
          if (dataPreviewQuarterInfo.matched) {
            titleSuffix += ` • ${qLabel} (${dataPreviewQuarterInfo.matchCount} baris)`;
          } else {
            titleSuffix += ` • Filter ${qLabel} tidak cocok, tampilkan semua`;
          }
        }

        dataPreview = {
          title: `${String(processed.source || 'Data')} • ${periodLabel}${titleSuffix}`,
          columns,
          rows,
          total_rows: rowsRaw.length,
          geoInfo: dataPreviewGeoInfo,
          quarterInfo: dataPreviewQuarterInfo,
        };
      }
    }
  } catch {
    dataPreview = null;
    dataPreviewLooksEmpty = false;
    dataPreviewGeoInfo = null;
    dataPreviewQuarterInfo = null;
  }

  // Check if UI will show a preview (even if we don't have cached data to compute on)
  // Define at outer scope so it's available for post-processing notes
  const uiWillShowPreview = Boolean(intentResult?.datasource?.source_id || candidates?.[0]?.id);

  if (!apiKey) {
    assistantText =
      'Saat ini fitur jawaban AI belum aktif di server. ' +
      'Saya tetap bisa bantu mengarahkan ke data yang sesuai berdasarkan database. ' +
      'Supaya saya bisa bantu lebih tepat, sebutkan: indikator apa, periode (tahun/bulan), dan wilayah (kab/kota bila perlu).';
  } else {
    const historyAsc = historyAllAsc.length
      ? historyAllAsc
      : (await ChatMessage.findAll({ where: { thread_id: threadId }, order: [['id', 'DESC']], limit: 16 }))
          .map((r) => r.toJSON())
          .reverse();

    const historyAscClean = historyAsc
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
      .map((m) => ({ role: m.role, content: stripMalikaUiBlock(String(m.content || '')).trim() }))
      .filter((m) => m.content);

    const recentForAssistant = historyAscClean.slice(-16);
    const olderForAssistant = historyAscClean.slice(0, Math.max(0, historyAscClean.length - 16));
    const olderSummaryForAssistant = summarizeOlderMessages(olderForAssistant);

    // Use uiWillShowPreview defined above
    const matchedIndicatorName = intentResult?.datasource?.name || candidates?.[0]?.name || null;
    const requestedYearFromQb = intentResult?.query_builder?.params?.year;

    // Build context for system prompt
    const systemPromptContext = {
      hasDataPreview: Boolean(dataPreview),
      hasConfidentMatch: !lowConfidenceFlag && candidates.length > 0,
      lowConfidence: lowConfidenceFlag,
      requestedYear: requestedYearFromQb ? normalizeYearValue(requestedYearFromQb) : null,
      availableYears: (() => {
        const selectedSid = intentResult?.datasource?.source_id || candidates?.[0]?.id;
        const latest = selectedSid ? latestBySource.get(Number(selectedSid)) : null;
        return latest?.year ? [latest.year] : [];
      })(),
    };

    const openAiMessages = [
      { role: 'system', content: systemPrompt(systemPromptContext) },
      ...(!dataPreview && uiWillShowPreview
        ? [
            {
              role: 'system',
              content:
                'PENTING: UI sedang menampilkan tabel preview data. ' +
                'Kamu TIDAK punya akses ke angka-angkanya, jadi JANGAN sebutkan angka apapun. ' +
                'Berikan respons SANGAT SINGKAT (1-2 kalimat saja): ' +
                '"Silakan lihat data di tabel preview yang sudah ditampilkan. ' +
                'Jika ada pertanyaan tentang angka atau perbandingan wilayah, silakan tanyakan setelah melihat tabelnya." ' +
                'JANGAN tawarkan untuk mencarikan data. JANGAN jelaskan panjang lebar.',
            },
          ]
        : []),
      ...(!dataPreview && !uiWillShowPreview
        ? [
            {
              role: 'system',
              content:
                'Tidak ada tabel data yang dilampirkan untuk dihitung. ' +
                'Jangan menyebut angka statistik/persentase sebagai fakta. ' +
                'Fokus pada klarifikasi parameter (indikator, tahun/bulan, wilayah) dan langkah berikutnya.',
            },
          ]
        : []),
      ...(dataPreview
        ? [
            {
              role: 'system',
              content:
                'TABEL DATA SUDAH DITAMPILKAN DI UI (dari database):\n' +
                `Judul: ${dataPreview.title}\n` +
                `Kolom: ${dataPreview.columns.join(' | ')}\n` +
                `Contoh baris (maks 10): ${JSON.stringify(dataPreview.rows.slice(0, 10))}\n` +
                (dataPreviewRequestedYear && dataPreviewActualYear && dataPreviewRequestedYear !== dataPreviewActualYear
                  ? `\nPENTING: User meminta data tahun ${dataPreviewRequestedYear}, tapi tahun tersebut BELUM TERSEDIA di database. ` +
                    `Tabel yang ditampilkan adalah data tahun ${dataPreviewActualYear} (tahun terakhir yang tersedia). ` +
                    `Kamu HARUS: (1) Jelaskan bahwa data ${dataPreviewRequestedYear} belum tersedia, (2) Berikan interpretasi SINGKAT dari data ${dataPreviewActualYear} yang sudah ditampilkan di atas. ` +
                    `JANGAN bertanya apakah user ingin melihat data tahun lain - data ${dataPreviewActualYear} sudah ditampilkan!\n`
                  : '') +
                (dataPreviewLooksEmpty
                  ? '\nCATATAN: Banyak nilai terlihat kosong (null/"-"). Jelaskan bahwa cache database belum terisi untuk periode ini.\n'
                  : '') +
                '\nTUGASMU: Berikan interpretasi SINGKAT dari data di atas. Sebutkan angka/pola yang terlihat. ' +
                'Jika user menyebut wilayah tertentu (kab/kota), fokus pada data wilayah tersebut dari tabel. ' +
                'JANGAN menawarkan untuk mencarikan data karena data sudah ditampilkan.',
            },
          ]
        : []),
      ...(intentResult?.plan?.href
        ? [
            {
              role: 'system',
              content:
                'Catatan sistem (deterministik, dari database): ' +
                'Jika relevan, arahkan user untuk membuka link data/pencarian yang sudah disediakan oleh UI. ' +
                'Jangan menuliskan URL mentah di jawaban. ' +
                'Jangan mencari data dari internet. Fokus pada indikator/tahun/wilayah dan jelaskan langkah berikutnya.',
            },
          ]
        : []),
      ...(olderSummaryForAssistant
        ? [
            {
              role: 'system',
              content:
                'Ringkasan seluruh riwayat chat (agar kamu paham konteks sebelum menjawab):\n' +
                `${olderSummaryForAssistant}\n\n` +
                'Jika ada rujukan seperti "yang tadi", gunakan ringkasan ini untuk menjaga konsistensi.',
            },
          ]
        : []),
      ...recentForAssistant.map((m) => ({
        role: m.role,
        content: String(m.content || '').slice(0, 4000),
      })),
    ];

    const t0 = Date.now();
    try {
      assistantText = await callOpenAIChat({
        model,
        apiKey,
        messages: openAiMessages,
        timeoutMs: Number(process.env.OPENAI_CHAT_TIMEOUT_MS || '15000'),
      });
      latencyMs = Date.now() - t0;
    } catch {
      latencyMs = Date.now() - t0;
      assistantText =
        'Maaf, saat ini saya sedang mengalami gangguan untuk menyusun jawaban otomatis. ' +
        'Saya tetap bisa bantu jika Anda sebutkan: indikator apa, periode (tahun/bulan), dan wilayah (kab/kota bila perlu).';
    }

    const hadOpenAiError = assistantText && assistantText.includes('gangguan');

    if (!assistantText) {
      assistantText = 'Maaf, saya belum bisa menghasilkan jawaban. Coba ulangi pertanyaan dengan lebih spesifik.';
    }

    // OVERRIDE: When UI shows preview confirmation but we have no cached data,
    // DON'T show any bubble chat - let user see confirmation first, then table + interpretation after.
    // This prevents the confusing "lihat tabel di atas" when there's no table yet.
    if (!dataPreview && uiWillShowPreview && !hadOpenAiError) {
      // Empty string = no bubble chat rendered (frontend will skip empty content)
      assistantText = '';
    }
  }

  // Append low confidence notice if applicable (ask for clarification)
  if (lowConfidenceNotice) {
    assistantText = `${String(assistantText || '').trim()}

${lowConfidenceNotice}`.trim();
  }

  if (periodAvailabilityNotice) {
    assistantText = `${String(assistantText || '').trim()}

${periodAvailabilityNotice}`.trim();
  }

  // Deterministic-first: prepend DB summary so users see factual availability/links first.
  const qb = intentResult?.query_builder;
  const requestedYear = qb?.params?.year ? normalizeYearValue(qb.params.year) : null;
  const anyCandidateHasYear = Array.isArray(candidates)
    ? candidates
        .slice(0, 6)
        .some((c) => {
          const sid = Number(c?.id);
          const latest = latestBySource.get(sid);
          return Boolean(requestedYear && latest?.year && latest.year >= requestedYear);
        })
    : false;

  assistantText = cleanAssistantTextAgainstDb({
    text: assistantText,
    requestedYear,
    anyCandidateHasYear,
    hasDataPreview: Boolean(dataPreview),
  });

  // Hard guardrail: never persist raw URLs in chat bubbles.
  assistantText = stripRawUrlsFromText(assistantText);
  assistantText = clampChatRhythm(assistantText);

  // If preview exists but looks empty, ensure we always tell the user what happened.
  if (dataPreview && dataPreviewLooksEmpty) {
    const note =
      'Catatan: tabel preview dari database terlihat masih kosong (banyak nilai null/“-”). ' +
      'Ini biasanya berarti cache indikator untuk periode tersebut belum terisi di database. ' +
      'Jika Anda butuh angkanya, jalankan refresh/update cache indikator (admin) lalu coba lagi.';
    assistantText = `${String(assistantText || '').trim()}\n\n${note}`.trim();
  }

  // If user explicitly wants numbers/preview but we couldn't load any cached table,
  // give a deterministic, CS-friendly explanation and next step.
  // SKIP this note if UI will show preview (we already gave a short response above).
  if (!dataPreview && wantsPreviewNow && !uiWillShowPreview) {
    const note =
      'Catatan: saya belum menemukan tabel data di cache database untuk dihitung/ditampilkan saat ini. ' +
      'Supaya saya bisa bantu lebih tepat, sebutkan indikator + periode (tahun/bulan) + wilayah (kab/kota bila perlu). ' +
      'Jika Anda admin dan data seharusnya ada, coba refresh/update cache indikator untuk periode tersebut.';
    assistantText = `${String(assistantText || '').trim()}\n\n${note}`.trim();
  }

  // Build structured UI payload and embed it into the assistant content (persisted),
  // so frontend can render a table + clickable links above/below the interpretation.
  let hasGeoCandidate = false;
  try {
    const selectedSourceIdForMeta = intentResult?.datasource?.source_id
      ? Number(intentResult.datasource.source_id)
      : Number(candidates?.[0]?.id);
    if (Number.isFinite(selectedSourceIdForMeta) && selectedSourceIdForMeta > 0) {
      hasGeoCandidate = await detectGeoCapabilityFromMetadataIndex(selectedSourceIdForMeta);
    }
  } catch {
    hasGeoCandidate = false;
  }

  const uiMeta = buildUiMeta({
    q: effectiveUserQuery,
    intentResult: { ...(intentResult || {}), ui_force_confirm: Boolean(uiForceConfirm) },
    candidates,
    latestBySource,
    dataPreview,
    hasGeoCandidate,
  });
  const uiBlock = `\n\n\`\`\`malika_ui\n${JSON.stringify(uiMeta)}\n\`\`\`\n`;
  const maxInterpretationLen = Math.max(0, 7800 - uiBlock.length);
  // Strip any existing malika_ui blocks from LLM output before adding our own
  const cleanedText = stripMalikaUiBlock(String(assistantText || ''));
  const interpretation = cleanedText.trim().slice(0, maxInterpretationLen).trim();
  const assistantContent = `${interpretation}${uiBlock}`.trim();

  const createdAssistant = await ChatMessage.create({
    thread_id: threadId,
    role: 'assistant',
    content: assistantContent.slice(0, 8000),
    model: apiKey ? model : null,
    tokens_in: null,
    tokens_out: null,
    latency_ms: latencyMs,
    created_at: now(),
  });

  await thread.update({
    last_message_at: now(),
    updated_at: now(),
  });

  return {
    user: createdUser.toJSON(),
    assistant: createdAssistant.toJSON(),
  };
}

module.exports = {
  getOwnerIdFromReq,
  listThreads,
  createThread,
  listMessages,
  sendMessage,
};
