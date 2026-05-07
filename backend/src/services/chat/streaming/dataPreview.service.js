/**
 * Data Preview Bundle Merge Service
 *
 * Extracted from streaming.service.js for modularity.
 */

'use strict';

const logger = require('../../../utils/logger').child({ service: 'DataPreviewBundle' });
const { fetchWithTimeout } = require('./openaiClient');
const { INTERNAL_API_BASE } = require('./config');

/**
 * Fetch and merge monthly data from a bundle (Inflasi/IHK by Bulan)
 * @param {Object} bundle - Bundle definition from MONTHLY_BUNDLES
 * @param {number} year - Year to fetch
 * @returns {Object|null} Merged preview with all columns, keyed by Bulan
 */
async function getMonthlyMergePreview({ bundle, year }) {
  if (!bundle || !bundle.sources || bundle.sources.length === 0) {
    return null;
  }

  logger.debug({ bundle: bundle.id, year }, 'MonthlyMerge: Starting merge');

  const uniqueSourceIds = [...new Set(bundle.sources.map(s => s.id))];

  const fetchPromises = uniqueSourceIds.map(async (sourceId) => {
    try {
      const dynamicEndpoint = `${INTERNAL_API_BASE}/dynamic/${sourceId}?period=${year}`;
      const response = await fetchWithTimeout(dynamicEndpoint, {}, 10000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();

      if (json.data && json.data.data && json.data.data.length > 0) {
        return { sourceId, data: json.data, success: true };
      }
      return { sourceId, success: false, error: 'No data' };
    } catch (err) {
      logger.warn({ sourceId, error: err.message }, 'MonthlyMerge: failed to fetch source');
      return { sourceId, success: false, error: err.message };
    }
  });

  const fetchResults = await Promise.all(fetchPromises);
  const sourceDataMap = {};

  for (const result of fetchResults) {
    if (result.success) {
      sourceDataMap[result.sourceId] = result.data;
    }
  }

  const successCount = Object.keys(sourceDataMap).length;
  logger.debug({ successCount, total: uniqueSourceIds.length }, 'MonthlyMerge: Fetch results');

  if (successCount < 1) {
    logger.debug('MonthlyMerge: No sources available, aborting');
    return null;
  }

  const keyColumn = bundle.keyColumn || 'Bulan';

  const sourceLookups = {};
  for (const [srcId, srcData] of Object.entries(sourceDataMap)) {
    const lookup = {};
    for (const row of srcData.data) {
      const rawKey = row[keyColumn] || row['Bulan'] || '';
      const normalizedKey = String(rawKey).replace(/^\[\d+\]\s*/, '').trim();
      if (normalizedKey) lookup[normalizedKey] = row;
    }
    sourceLookups[srcId] = lookup;
  }

  const firstSourceId = Object.keys(sourceDataMap)[0];
  const baseData = sourceDataMap[firstSourceId];
  const allKeys = baseData.data.map(row => {
    const rawKey = row[keyColumn] || row['Bulan'] || '';
    return String(rawKey).replace(/^\[\d+\]\s*/, '').trim();
  }).filter(Boolean);

  const mergedColumns = [keyColumn];
  const columnDefs = [];

  for (const sourceDef of bundle.sources) {
    const srcData = sourceDataMap[sourceDef.id];
    if (!srcData) continue;

    const colName = `${sourceDef.label}${sourceDef.unit ? ` (${sourceDef.unit})` : ''}`;
    columnDefs.push({
      name: colName,
      sourceId: sourceDef.id,
      valueColumn: sourceDef.valueColumn || 'Nilai',
    });
    mergedColumns.push(colName);
  }

  const mergedRows = [];
  for (const key of allKeys) {
    const mergedRow = { [keyColumn]: key };

    for (const colDef of columnDefs) {
      const lookup = sourceLookups[colDef.sourceId];
      const srcRow = lookup ? lookup[key] : null;
      const value = srcRow ? srcRow[colDef.valueColumn] : null;
      mergedRow[colDef.name] = value;
    }

    mergedRows.push(mergedRow);
  }

  const validRows = mergedRows.filter(row => {
    const values = Object.values(row).slice(1);
    return values.some(v => v !== null && v !== undefined);
  });

  if (validRows.length === 0) {
    logger.debug('MonthlyMerge: No valid merged rows');
    return null;
  }

  logger.debug({ bundle: bundle.id, columns: mergedColumns.length, rows: validRows.length }, 'MonthlyMerge: Success');

  return {
    columns: mergedColumns,
    data: validRows,
    merged: true,
    bundle: bundle.id,
    bundleName: bundle.name,
    from: uniqueSourceIds.map(id => `source_${id}`).join('+'),
    year,
  };
}

/**
 * Fetch and merge data from a bundle of datasources
 * @param {Object} bundle - Bundle definition from MERGE_BUNDLES
 * @param {number} year - Year to fetch
 * @param {string|null} geo - Geographic filter
 * @returns {Object|null} Merged preview with all columns
 */
async function getExtendedMergePreview({ bundle, year, geo }) {
  if (!bundle || !bundle.sources || bundle.sources.length === 0) {
    return null;
  }

  logger.debug('[ExtendedMerge] Starting merge for bundle:', bundle.id, 'year:', year);

  const uniqueSourceIds = [...new Set(bundle.sources.map(s => s.id))];

  const fetchPromises = uniqueSourceIds.map(async (sourceId) => {
    try {
      const dynamicEndpoint = `${INTERNAL_API_BASE}/dynamic/${sourceId}?period=${year}`;
      const response = await fetchWithTimeout(dynamicEndpoint, {}, 10000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();

      if (json.data && json.data.data && json.data.data.length > 0) {
        return { sourceId, data: json.data, success: true };
      }
      return { sourceId, success: false, error: 'No data' };
    } catch (err) {
      logger.warn({ sourceId, error: err.message }, 'Extended merge: failed to fetch source');
      return { sourceId, success: false, error: err.message };
    }
  });

  const fetchResults = await Promise.all(fetchPromises);
  const sourceDataMap = {};

  for (const result of fetchResults) {
    if (result.success) {
      sourceDataMap[result.sourceId] = result.data;
    }
  }

  const successCount = Object.keys(sourceDataMap).length;
  logger.debug('[ExtendedMerge] Fetch results:', successCount, '/', uniqueSourceIds.length, 'sources');

  if (successCount < 2) {
    logger.debug('[ExtendedMerge] Not enough sources, aborting merge');
    return null;
  }

  const firstSourceId = Object.keys(sourceDataMap)[0];
  const baseData = sourceDataMap[firstSourceId];
  const keyColumn = bundle.keyColumn || 'Wilayah';

  const mergedRows = [];
  const mergedColumns = [keyColumn];

  const sourceLookups = {};
  for (const [srcId, srcData] of Object.entries(sourceDataMap)) {
    const lookup = {};
    for (const row of srcData.data) {
      const key = row[keyColumn];
      if (key) lookup[key] = row;
    }
    sourceLookups[srcId] = lookup;
  }

  const columnDefs = [];
  for (const sourceDef of bundle.sources) {
    const srcData = sourceDataMap[sourceDef.id];
    if (!srcData) continue;

    const colName = `${sourceDef.label}${sourceDef.unit ? ` (${sourceDef.unit})` : ''}`;
    columnDefs.push({
      name: colName,
      sourceId: sourceDef.id,
      valueColumn: sourceDef.valueColumn || 'Nilai',
    });
    mergedColumns.push(colName);
  }

  const allKeys = baseData.data.map(row => row[keyColumn]).filter(Boolean);

  for (const key of allKeys) {
    if (geo) {
      const keyLower = String(key).toLowerCase();
      const geoLower = String(geo).toLowerCase();
      if (!keyLower.includes(geoLower) && !geoLower.includes(keyLower)) {
        continue;
      }
    }

    const mergedRow = { [keyColumn]: key };

    for (const colDef of columnDefs) {
      const lookup = sourceLookups[colDef.sourceId];
      const srcRow = lookup ? lookup[key] : null;
      const value = srcRow ? srcRow[colDef.valueColumn] : null;
      mergedRow[colDef.name] = value;
    }

    mergedRows.push(mergedRow);
  }

  const validRows = mergedRows.filter(row => {
    const values = Object.values(row).slice(1);
    return values.some(v => v !== null && v !== undefined);
  });

  if (validRows.length === 0) {
    logger.debug('[ExtendedMerge] No valid merged rows');
    return null;
  }

  logger.debug('[ExtendedMerge] Merge success:', {
    bundle: bundle.id,
    columns: mergedColumns.length,
    rows: validRows.length,
  });

  return {
    columns: mergedColumns,
    data: validRows,
    merged: true,
    bundle: bundle.id,
    bundleName: bundle.name,
    from: uniqueSourceIds.map(id => `source_${id}`).join('+'),
    year,
  };
}

module.exports = {
  getMonthlyMergePreview,
  getExtendedMergePreview,
};
