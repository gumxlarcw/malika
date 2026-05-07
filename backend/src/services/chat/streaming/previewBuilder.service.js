/**
 * Preview Builder Service
 * 
 * Builds data previews for chat responses. Fetches and formats data
 * from various sources (data_bps, ProcessedCache, live API).
 * 
 * Extracted from streaming.service.js during Phase 4+ refactor.
 */

'use strict';

const { QueryTypes } = require('sequelize');
const ProcessedCache = require('../../../models/ProcessedCache.model');
const MergedCache = require('../../../models/MergedCache.model');
const logger = require('../../../utils/logger').child({ service: 'PreviewBuilder' });

// ============================================================================
// GEO EXPANSION
// ============================================================================

/**
 * Expand geo shorthand to full name
 */
function expandGeoShorthand(geo) {
  const map = {
    'kepsul': 'kepulauan sula',
    'kepsula': 'kepulauan sula',
    'halsel': 'halmahera selatan',
    'halut': 'halmahera utara',
    'halbar': 'halmahera barat',
    'haltim': 'halmahera timur',
    'halteng': 'halmahera tengah',
    'tikep': 'tidore kepulauan',
    'morotai': 'pulau morotai',
    'taliabu': 'pulau taliabu',
    'sula': 'kepulauan sula',
    'ternate': 'kota ternate',
    'tidore': 'tidore kepulauan',
    'malut': 'maluku utara',
    'malukuutara': 'maluku utara',
  };
  return map[geo] || null;
}

/**
 * Check if a row matches the geo filter
 * Uses exact matching for Wilayah/Kabupaten columns to avoid "Halmahera Utara" matching "utara"
 */
function matchGeoFilter(row, geoNorm, geoExpanded) {
  // Find wilayah column value
  const wilayahKeys = ['Wilayah', 'wilayah', 'Kabupaten/Kota', 'kabupaten_kota', 'Kab/Kota', 'Region'];
  let wilayahValue = null;
  
  for (const key of wilayahKeys) {
    if (row[key] !== undefined) {
      wilayahValue = String(row[key] || '').toLowerCase().trim();
      break;
    }
  }
  
  // If we found a wilayah column, use EXACT matching
  if (wilayahValue) {
    // Normalize both values for comparison (remove extra spaces, keep letters only)
    const normalizedWilayah = wilayahValue.replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
    const normalizedGeo = geoNorm.replace(/\s+/g, ' ').trim();
    const normalizedExpanded = geoExpanded ? geoExpanded.replace(/\s+/g, ' ').trim() : null;
    
    // Exact match
    if (normalizedWilayah === normalizedGeo) return true;
    if (normalizedExpanded && normalizedWilayah === normalizedExpanded) return true;
    
    // Also match without spaces (for shorthand like "malukuutara")
    const wilayahNoSpace = normalizedWilayah.replace(/\s+/g, '');
    const geoNoSpace = normalizedGeo.replace(/\s+/g, '');
    const expandedNoSpace = normalizedExpanded ? normalizedExpanded.replace(/\s+/g, '') : null;
    
    if (wilayahNoSpace === geoNoSpace) return true;
    if (expandedNoSpace && wilayahNoSpace === expandedNoSpace) return true;
    
    // For tables without clear wilayah column, we could do substring match
    // But for kab/kota tables, require exact match to avoid "Halmahera Utara" matching "utara"
    return false;
  }
  
  // Fallback: substring match on any column (for tables without clear wilayah column)
  const rowValues = Object.values(row).map(v => String(v || '').toLowerCase());
  return rowValues.some(v =>
    v.includes(geoNorm) ||
    (geoExpanded && v.includes(geoExpanded))
  );
}

// ============================================================================
// PERIOD DISCOVERY
// ============================================================================

/**
 * Find nearest available period for a datasource when requested period not available
 */
async function findNearestAvailablePeriod(sourceId, requestedYear) {
  if (!sourceId) return null;
  
  // Guard against SQL injection: sourceId must be a positive integer
  const idNum = Number(sourceId);
  if (!Number.isInteger(idNum) || idNum <= 0) return null;
  
  try {
    // Try from data_bps first
    const getSequelizeBps = require('../../../config/db_bps');
    const sequelizeBps = getSequelizeBps();
    
    if (sequelizeBps) {
      const tableName = `indikator_${idNum}`;
      const rows = await sequelizeBps.query(
        `SELECT DISTINCT year FROM \`${tableName}\` ORDER BY year DESC LIMIT 20`,
        { type: QueryTypes.SELECT }
      ).catch(() => []);
      
      if (Array.isArray(rows) && rows.length > 0) {
        const years = rows.map(r => Number(r.year)).filter(y => !isNaN(y));
        if (years.length > 0) {
          if (requestedYear) {
            const nearest = years.reduce((prev, curr) => 
              Math.abs(curr - requestedYear) < Math.abs(prev - requestedYear) ? curr : prev
            );
            if (nearest !== requestedYear) {
              return { period: nearest, direction: nearest < requestedYear ? 'terbaru' : 'terdekat' };
            }
          }
          return { period: Math.max(...years), direction: 'terbaru' };
        }
      }
    }
    
    // Fallback to DataPeriod table
    const DataPeriod = require('../../../models/DataPeriod.model');
    const periods = await DataPeriod.findAll({
      where: { source_id: sourceId },
      order: [['period_value', 'DESC']],
      limit: 20,
    });
    
    if (periods.length > 0) {
      const years = periods
        .map(p => Number(String(p.period_value).slice(0, 4)))
        .filter(y => !isNaN(y) && y >= 2000 && y <= 2100);
      
      if (years.length > 0) {
        const uniqueYears = [...new Set(years)].sort((a, b) => b - a);
        
        if (requestedYear) {
          const nearest = uniqueYears.reduce((prev, curr) => 
            Math.abs(curr - requestedYear) < Math.abs(prev - requestedYear) ? curr : prev
          );
          if (nearest !== requestedYear) {
            return { period: nearest, direction: nearest < requestedYear ? 'terbaru' : 'terdekat' };
          }
        }
        return { period: uniqueYears[0], direction: 'terbaru' };
      }
    }
    
    return null;
  } catch (err) {
    logger.warn({ error: err?.message }, 'findNearestAvailablePeriod error');
    return null;
  }
}

/**
 * Get all available years for a datasource
 */
async function getAvailableYearsForSource(sourceId) {
  if (!sourceId) return [];
  
  // Guard against SQL injection: sourceId must be a positive integer
  const idNum = Number(sourceId);
  if (!Number.isInteger(idNum) || idNum <= 0) return [];
  
  try {
    // Try data_bps first
    try {
      const getSequelizeBps = require('../../../config/db_bps');
      const sequelizeBps = getSequelizeBps();
      if (sequelizeBps) {
        const tableName = `indikator_${idNum}`;
        const [tables] = await sequelizeBps.query(
          `SHOW TABLES LIKE ?`,
          { replacements: [tableName] }
        );
        
        if (tables.length > 0) {
          const [rows] = await sequelizeBps.query(
            `SELECT DISTINCT year FROM \`${tableName}\` WHERE year IS NOT NULL ORDER BY year DESC LIMIT 20`
          );
          
          if (rows.length > 0) {
            const years = rows.map(r => Number(r.year)).filter(y => !isNaN(y) && y >= 2000 && y <= 2100);
            if (years.length > 0) return years.slice(0, 10);
          }
        }
      }
    } catch {
      // data_bps not available
    }
    
    // Fallback to DataPeriod
    const DataPeriod = require('../../../models/DataPeriod.model');
    const periods = await DataPeriod.findAll({
      where: { source_id: sourceId },
      order: [['period_value', 'DESC']],
      limit: 20,
    });
    
    if (periods.length > 0) {
      const years = periods
        .map(p => {
          const val = String(p.period_value || '');
          if (/^\d{3}$/.test(val)) return 1900 + Number(val);
          if (/^\d{4}$/.test(val)) return Number(val);
          return Number(val.slice(0, 4));
        })
        .filter(y => !isNaN(y) && y >= 2000 && y <= 2100);
      
      const uniqueYears = [...new Set(years)].sort((a, b) => b - a);
      if (uniqueYears.length > 0) return uniqueYears.slice(0, 10);
    }
    
    return [];
  } catch (err) {
    logger.warn({ error: err?.message }, 'getAvailableYearsForSource error');
    return [];
  }
}

// ============================================================================
// MERGED CACHE FALLBACK
// ============================================================================

/**
 * Try to get data from MergedCache for a specific year
 * MergedCache stores all years merged, so we filter to the requested year
 */
async function tryMergedCacheForYear({ sourceId, year, month, geo, sourceName }) {
  try {
    const { parseProcessedJson } = require('../../../utils/cacheCompression');
    
    // Try 'all' signature first (most common)
    const merged = await MergedCache.findOne({
      where: { source_id: sourceId, signature: 'all' },
      order: [['last_update', 'DESC']],
    });
    
    if (!merged || !merged.merged_json) return null;
    
    const parsed = parseProcessedJson(merged.merged_json);
    if (!parsed || !Array.isArray(parsed.years) || parsed.years.length === 0) return null;
    
    // Find the requested year in merged data
    const yearStr = String(year);
    const yearData = parsed.years.find(y => 
      String(y.year) === yearStr || String(y.th_id) === yearStr
    );
    
    if (!yearData || !Array.isArray(yearData.months) || yearData.months.length === 0) return null;
    
    // Get metrics from first month
    const metrics = parsed.metrics || Object.keys(yearData.months[0]?.values || {});
    
    // Build table from merged data
    const columns = ['Bulan', ...metrics];
    let data = yearData.months.map(m => {
      const row = { Bulan: m.name };
      for (const metric of metrics) {
        row[metric] = m.values?.[metric] ?? null;
      }
      return row;
    });
    
    // Filter by month if specified
    if (Number.isInteger(month) && month >= 1 && month <= 12) {
      const { MONTH_ORDER } = require('../../../utils/queryAnalysis');
      const targetMonth = MONTH_ORDER[month - 1];
      data = data.filter(row => 
        String(row.Bulan || '').toLowerCase() === targetMonth.toLowerCase()
      );
    }
    
    // Validate we have actual data
    if (data.length === 0) return null;
    
    const hasValidData = data.some(row => 
      Object.values(row).some(v => v !== null && typeof v !== 'string')
    );
    
    if (!hasValidData) return null;
    
    return {
      source: parsed.source?.name || sourceName || 'Data Statistik',
      columns,
      data,
      last_update: merged.last_update || null,
      from: 'merged_cache',
      unit: parsed.unit || null,
    };
  } catch (err) {
    logger.warn({ error: err?.message, sourceId }, 'tryMergedCacheForYear error');
    return null;
  }
}

// ============================================================================
// PREVIEW FETCHERS
// ============================================================================

/**
 * Get processed data preview - try data_bps first, then ProcessedCache as fallback
 */
async function getProcessedPreviewFromCache({ sourceId, year, month, geo }) {
  if (!Number.isFinite(sourceId) || sourceId <= 0) return null;
  
  try {
    const { readGenericIndicatorFromBps } = require('../../bpsRead/indicatorTableGenericRead.service');
    const { parseProcessedJson } = require('../../../utils/cacheCompression');
    const DataSource = require('../../../models/DataSource.model');
    
    const ds = await DataSource.findByPk(sourceId);
    const sourceName = ds?.name || 'Data Statistik';
    
    const bpsData = await readGenericIndicatorFromBps({
      sourceId,
      period: year,
      sourceName,
    });
    
    if (bpsData && !bpsData.__disabled && Array.isArray(bpsData.data) && bpsData.data.length > 0) {
      let filteredData = bpsData.data;
      
      if (geo) {
        const geoNorm = String(geo).toLowerCase().replace(/[^a-z\s]/g, '').trim();
        const geoExpanded = expandGeoShorthand(geoNorm.replace(/\s+/g, ''));
        
        filteredData = bpsData.data.filter(row => matchGeoFilter(row, geoNorm, geoExpanded));
        
        if (filteredData.length === 0) filteredData = bpsData.data;
      }
      
      // Validate data_bps data is not all null
      const hasValidBpsData = filteredData.some(row => {
        const values = Object.values(row).filter(v => typeof v !== 'string');
        return values.some(v => v !== null && v !== undefined);
      });
      
      if (hasValidBpsData) {
        // Lookup unit from MergedCache (data_bps table doesn't store unit)
        let unit = null;
        try {
          const mergedForUnit = await MergedCache.findOne({
            where: { source_id: sourceId, signature: 'all' },
            attributes: ['merged_json'],
          });
          if (mergedForUnit?.merged_json) {
            const { parseProcessedJson } = require('../../../utils/cacheCompression');
            const unitParsed = parseProcessedJson(mergedForUnit.merged_json);
            unit = unitParsed?.unit || null;
          }
        } catch { /* ignore unit lookup error */ }
        
        return {
          source: bpsData.source || sourceName,
          columns: Array.isArray(bpsData.columns) ? bpsData.columns : [],
          data: filteredData,
          last_update: bpsData.last_update || null,
          from: 'data_bps',
          latestPeriodLabel: bpsData.latestPeriodLabel || null,
          unit,
        };
      }
      // data_bps has corrupted/null data, continue to ProcessedCache fallback
      logger.info({ sourceId, year }, 'data_bps has null data, trying fallbacks');
    }
    
    // Fallback to ProcessedCache
    let periodValue = String(year);
    if (Number.isInteger(month) && month >= 1 && month <= 12) {
      periodValue = `${year}${String(month).padStart(2, '0')}`;
    }

    const cache = await ProcessedCache.findOne({
      where: {
        source_id: sourceId,
        period_value: periodValue,
      },
      order: [['last_update', 'DESC']],
    });

    if (cache && cache.processed_json) {
      const parsed = parseProcessedJson(cache.processed_json);
      if (parsed && Array.isArray(parsed.data) && parsed.data.length > 0) {
        // Validate data is not all null - check if at least one row has non-null values
        const hasValidData = parsed.data.some(row => {
          const values = Object.values(row).filter(v => typeof v !== 'string'); // Exclude labels
          return values.some(v => v !== null && v !== undefined);
        });
        
        if (hasValidData) {
          return {
            source: parsed.source || 'Data',
            columns: Array.isArray(parsed.columns) ? parsed.columns : [],
            data: parsed.data,
            last_update: parsed.last_update || null,
            from: 'processed_cache',
            unit: parsed.unit || null,
          };
        }
        // ProcessedCache has corrupted/null data, try MergedCache
        logger.info({ sourceId, periodValue }, 'ProcessedCache has null data, trying MergedCache');
      }
    }

    // Fallback to MergedCache - extract data for the requested year
    const mergedResult = await tryMergedCacheForYear({ sourceId, year, month, geo, sourceName });
    if (mergedResult) return mergedResult;

    return null;
  } catch (err) {
    logger.warn({ error: err?.message }, 'getProcessedPreviewFromCache error');
    return null;
  }
}

/**
 * Get EXIM data preview from backend API
 * Includes retry logic for transient MySQL connection issues
 */
async function getEximPreviewFromApi({ sourceId, year, month, group, codeHs, pod, ctr, metric }) {
  if (!sourceId || !year) return null;
  
  const MAX_RETRIES = 2;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const DataSource = require('../../../models/DataSource.model');
      const ds = await DataSource.findByPk(sourceId);
      if (!ds || ds.type !== 'exim') return null;
      
      const { readEximFromBps } = require('../../bpsRead/indicatorTableRead.service');
      
      const bpsData = await readEximFromBps({
        sourceId,
        year,
        monthNo: month || null,
        hs2: codeHs || null,
        pod: pod || null,
        ctr: ctr || null,
        metricWanted: metric || null,
        groupBy: group || null,
      });
      
      if (!bpsData || !Array.isArray(bpsData.data) || bpsData.data.length === 0) {
        // No data found — not transient, don't retry
        return null;
      }
      
      return {
        source: bpsData.source || ds.name || 'Data EXIM',
        columns: Array.isArray(bpsData.columns) ? bpsData.columns : [],
        data: bpsData.data,
        last_update: bpsData.last_update || null,
        from: 'data_bps_exim',
        eximGroup: group || null,
      };
    } catch (err) {
      const isTransient = /socket hang up|ECONNRESET|ETIMEDOUT|ECONNREFUSED|SequelizeConnectionError/i.test(err?.message || '');
      if (isTransient && attempt < MAX_RETRIES) {
        logger.warn({ error: err?.message, attempt: attempt + 1 }, 'getEximPreviewFromApi transient error, retrying...');
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      logger.warn({ error: err?.message, attempt }, 'getEximPreviewFromApi error (final)');
      return null;
    }
  }
  return null;
}

/**
 * Get processed data preview for multiple years (range)
 */
async function getProcessedPreviewForRange({ sourceId, years, geo }) {
  if (!Number.isFinite(sourceId) || sourceId <= 0) return null;
  if (!Array.isArray(years) || years.length === 0) return null;
  
  try {
    const { readGenericIndicatorFromBps } = require('../../bpsRead/indicatorTableGenericRead.service');
    const DataSource = require('../../../models/DataSource.model');
    
    const ds = await DataSource.findByPk(sourceId);
    const sourceName = ds?.name || 'Data Statistik';
    
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
        logger.warn({ year, error: err.message }, 'getProcessedPreviewForRange year not available');
      }
    }
    
    // Fallback to MergedCache if no data from data_bps
    if (allRows.length === 0) {
      const mergedRow = await MergedCache.findOne({
        where: { source_id: sourceId, signature: 'all' },
      });
      
      if (mergedRow?.merged_json) {
        const { parseProcessedJson } = require('../../../utils/cacheCompression');
        const mergedObj = parseProcessedJson(mergedRow.merged_json);
        
        if (mergedObj?.table?.data && Array.isArray(mergedObj.table.data)) {
          // Filter by requested years
          const yearsSet = new Set(years.map(String));
          const filtered = mergedObj.table.data.filter(row => {
            const rowYear = String(row?.year || row?.Tahun || '');
            return yearsSet.has(rowYear);
          });
          
          if (filtered.length > 0) {
            const columns = mergedObj.table.columns?.map(c =>
              typeof c === 'object' ? (c.label || c.key || String(c)) : String(c)
            ) || [];
            
            // Apply geo filter if provided - use exact matching for Wilayah column
            let filteredData = filtered;
            if (geo) {
              const geoNorm = String(geo).toLowerCase().replace(/[^a-z\s]/g, '').trim();
              const geoExpanded = expandGeoShorthand(geoNorm.replace(/\s+/g, ''));
              
              filteredData = filtered.filter(row => matchGeoFilter(row, geoNorm, geoExpanded));
              
              if (filteredData.length === 0) filteredData = filtered;
            }
            
            const foundYears = [...new Set(filteredData.map(r => r.year || r.Tahun))].sort();
            
            return {
              source: sourceName,
              columns,
              data: filteredData,
              last_update: mergedObj.last_update || mergedRow.last_update,
              from: 'merged_cache',
              availableYears: foundYears,
              requestedYears: years,
              unit: mergedObj.unit || null,
            };
          }
        }
      }
      
      return null;
    }
    
    let filteredRows = allRows;
    if (geo) {
      const geoNorm = String(geo).toLowerCase().replace(/[^a-z\s]/g, '').trim();
      const geoExpanded = expandGeoShorthand(geoNorm.replace(/\s+/g, ''));
      
      filteredRows = allRows.filter(row => matchGeoFilter(row, geoNorm, geoExpanded));
      
      if (filteredRows.length === 0) filteredRows = allRows;
    }
    
    const sampleRow = filteredRows[0] || {};
    const columns = Object.keys(sampleRow).filter(k => k !== '_year');
    
    if (availableYears.length > 1) {
      columns.unshift('Tahun');
      filteredRows = filteredRows.map(row => {
        const { _year, ...rest } = row;
        return { Tahun: _year, ...rest };
      });
    } else if (availableYears.length === 1) {
      filteredRows = filteredRows.map(row => {
        const { _year, ...rest } = row;
        return rest;
      });
    }
    
    // Lookup unit from MergedCache for data_bps range result
    let unit = null;
    try {
      const mergedForUnit = await MergedCache.findOne({
        where: { source_id: sourceId, signature: 'all' },
        attributes: ['merged_json'],
      });
      if (mergedForUnit?.merged_json) {
        const { parseProcessedJson } = require('../../../utils/cacheCompression');
        const unitParsed = parseProcessedJson(mergedForUnit.merged_json);
        unit = unitParsed?.unit || null;
      }
    } catch { /* ignore unit lookup error */ }
    
    return {
      source: sourceName,
      columns,
      data: filteredRows,
      last_update: lastUpdate,
      from: 'data_bps_merged',
      availableYears,
      requestedYears: years,
      unit,
    };
  } catch (err) {
    logger.error({ error: err.message }, 'getProcessedPreviewForRange error');
    return null;
  }
}

// ============================================================================
// CONTEXT EXTRACTION
// ============================================================================

/**
 * Extract period and geo from previous UI meta candidates
 */
function extractContextFromPrevUiMeta(prevUiMeta) {
  if (!prevUiMeta || !Array.isArray(prevUiMeta.candidates)) return { year: null, geo: null };
  
  const firstCandidate = prevUiMeta.candidates[0];
  if (!firstCandidate?.href) return { year: null, geo: null };
  
  try {
    const url = new URL(firstCandidate.href, 'http://localhost');
    const period = url.searchParams.get('period');
    const geo = url.searchParams.get('geo');
    
    let year = null;
    if (period) {
      const match = period.match(/^(19\d{2}|20\d{2}|2100)/);
      if (match) year = Number(match[1]);
    }
    
    return { year, geo };
  } catch {
    return { year: null, geo: null };
  }
}

// ============================================================================
// RELATIVE YEAR HELPERS ("N tahun terakhir")
// ============================================================================

/**
 * Extract "N tahun terakhir" count from query
 * @param {string} text - Query text
 * @returns {number|null} - Number of years or null
 */
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

/**
 * Replace "N tahun terakhir" phrase with explicit year range
 */
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

/**
 * Expand "N tahun terakhir" to explicit year range
 * @param {object} options - { q: string, sourceId: number }
 * @returns {Promise<{ expanded: string, range: { start: number, end: number }|null, note: string|null }>}
 */
async function expandRelativeYearsToExplicitRange({ q, sourceId }) {
  const n = extractLastNYearsCount(q);
  if (!n) return { expanded: String(q || ''), range: null, note: null };

  const sid = Number(sourceId);
  if (!Number.isFinite(sid) || sid <= 0) return { expanded: String(q || ''), range: null, note: null };

  const availableYears = await getAvailableYearsForSource(sid);
  if (!availableYears?.length) return { expanded: String(q || ''), range: null, note: 'no_year_map' };

  const set = new Set(availableYears);
  const anchorYear = availableYears[0] || new Date().getFullYear();

  // Prefer a consecutive run of length N ending at the latest possible year.
  let chosenEnd = null;
  for (let end = anchorYear; end >= anchorYear - 20; end--) {
    let ok = true;
    for (let y = end; y > end - n; y--) {
      if (!set.has(y)) {
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
    // Fallback: just take latest N available years (may be non-consecutive)
    const sorted = [...availableYears].sort((a, b) => b - a);
    const startYear = sorted[Math.min(n - 1, sorted.length - 1)];
    const endYear = sorted[0];
    const expanded = replaceLastNYearsPhraseWithRange(q, startYear, endYear);
    return { expanded, range: { start: startYear, end: endYear }, note: 'non_consecutive' };
  }

  const startYear = chosenEnd - n + 1;
  const expanded = replaceLastNYearsPhraseWithRange(q, startYear, chosenEnd);
  return { expanded, range: { start: startYear, end: chosenEnd }, note: null };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Geo
  expandGeoShorthand,
  
  // Period discovery
  findNearestAvailablePeriod,
  getAvailableYearsForSource,
  
  // Preview fetchers
  getProcessedPreviewFromCache,
  getEximPreviewFromApi,
  getProcessedPreviewForRange,
  
  // Context
  extractContextFromPrevUiMeta,
  
  // Relative year helpers
  extractLastNYearsCount,
  replaceLastNYearsPhraseWithRange,
  expandRelativeYearsToExplicitRange,
};
