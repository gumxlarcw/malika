/**
 * Multi-Source Merge Service
 *
 * Extracted from streaming.service.js for modularity.
 */

'use strict';

const logger = require('../../../utils/logger').child({ service: 'MultiSourceMerge' });
const { expandGeoShorthand } = require('./previewBuilder.service');

const MAX_PARALLEL_SOURCES = 5;

async function fetchSourcesInParallel(sources, fetcher, maxParallel = MAX_PARALLEL_SOURCES) {
  const results = [];
  for (let i = 0; i < sources.length; i += maxParallel) {
    const batch = sources.slice(i, i + maxParallel);
    const batchResults = await Promise.all(batch.map(fetcher));
    results.push(...batchResults);
  }
  return results;
}

/**
 * Extract indicator/topic name from datasource name for column labeling
 * @param {string} sourceName - Full datasource name
 * @param {string|null} topicHint - Optional topic hint from conversation
 * @returns {string|null} Extracted indicator name or null
 */
function extractIndicatorFromSourceName(sourceName, topicHint = null) {
  const name = String(sourceName || '').toLowerCase();

  const indicatorPatterns = [
    { pattern: /penduduk\s+miskin/i, label: 'Penduduk Miskin' },
    { pattern: /kemiskinan/i, label: 'Penduduk Miskin' },
    { pattern: /pengangguran\s+terbuka/i, label: 'Pengangguran Terbuka' },
    { pattern: /pengangguran/i, label: 'Pengangguran' },
    { pattern: /tpt/i, label: 'Pengangguran Terbuka' },
    { pattern: /angkatan\s+kerja/i, label: 'Angkatan Kerja' },
    { pattern: /bekerja/i, label: 'Penduduk Bekerja' },
    { pattern: /tpak/i, label: 'Angkatan Kerja' },
    { pattern: /rata.*lama.*sekolah/i, label: 'Rata-rata Lama Sekolah' },
    { pattern: /harapan.*lama.*sekolah/i, label: 'Harapan Lama Sekolah' },
    { pattern: /melek\s+huruf/i, label: 'Melek Huruf' },
    { pattern: /apm|apk/i, label: 'Partisipasi Sekolah' },
    { pattern: /pdrb/i, label: 'PDRB' },
    { pattern: /pertumbuhan\s+ekonomi/i, label: 'Pertumbuhan Ekonomi' },
    { pattern: /inflasi/i, label: 'Inflasi' },
    { pattern: /gini/i, label: 'Gini Ratio' },
    { pattern: /harapan\s+hidup/i, label: 'Harapan Hidup' },
    { pattern: /stunting/i, label: 'Stunting' },
    { pattern: /gizi/i, label: 'Gizi' },
    { pattern: /ipm|indeks\s+pembangunan\s+manusia/i, label: 'IPM' },
    { pattern: /jumlah\s+penduduk(?!\s+miskin)/i, label: 'Penduduk' },
    { pattern: /kepadatan\s+penduduk/i, label: 'Kepadatan Penduduk' },
    { pattern: /laju\s+pertumbuhan/i, label: 'Pertumbuhan Penduduk' },
  ];

  for (const { pattern, label } of indicatorPatterns) {
    if (pattern.test(name)) {
      return label;
    }
  }

  if (topicHint) {
    const topicLower = topicHint.toLowerCase();
    if (topicLower.includes('miskin') || topicLower.includes('kemiskinan')) return 'Penduduk Miskin';
    if (topicLower.includes('pengangguran')) return 'Pengangguran';
    if (topicLower.includes('ipm')) return 'IPM';
  }

  return null;
}

/**
 * Fetch and merge data from multiple datasources by dimension (e.g., Wilayah)
 * Used when user asks for "jumlah dan persentase" but data is in separate tables
 * @param {Array<{sourceId: number, sourceName: string}>} sources
 * @param {number} year
 * @param {string|null} geo
 * @param {string|null} topic
 * @returns {Object|null}
 */
async function getMergedMultiSourcePreview({ sources, year, geo, topic = null }) {
  if (!Array.isArray(sources) || sources.length === 0) return null;

  try {
    const { readGenericIndicatorFromBps } = require('../../bpsRead/indicatorTableGenericRead.service');

    const results = await fetchSourcesInParallel(sources, async (src) => {
      try {
        const bpsData = await readGenericIndicatorFromBps({
          sourceId: src.sourceId,
          period: year,
          sourceName: src.sourceName,
        });

        if (bpsData && !bpsData.__disabled && Array.isArray(bpsData.data) && bpsData.data.length > 0) {
          return {
            sourceId: src.sourceId,
            sourceName: src.sourceName,
            columns: bpsData.columns || [],
            data: bpsData.data,
            year: year,
            last_update: bpsData.last_update,
          };
        }
        return null;
      } catch (err) {
        logger.warn({ sourceId: src.sourceId, error: err.message }, 'Multi-source preview: failed to fetch');
        return null;
      }
    });
    const validResults = results.filter(r => r !== null);

    logger.debug('[getMergedMultiSourcePreview] validResults count:', validResults.length, 'for year:', year);

    if (validResults.length === 0) return null;
    if (validResults.length === 1) {
      const r = validResults[0];
      let filteredData = r.data;
      if (geo) {
        const geoNorm = String(geo).toLowerCase().replace(/[^a-z]/g, '');
        const geoExpanded = expandGeoShorthand(geoNorm);
        filteredData = r.data.filter(row => {
          const rowValues = Object.values(row).map(v => String(v || '').toLowerCase());
          return rowValues.some(v => v.includes(geoNorm) || (geoExpanded && v.includes(geoExpanded)));
        });
        if (filteredData.length === 0) filteredData = r.data;
      }
      return {
        source: r.sourceName,
        columns: r.columns,
        data: filteredData,
        last_update: r.last_update,
        from: 'data_bps',
        merged: false,
      };
    }

    const dimensionPatterns = ['wilayah', 'kabupaten', 'kota', 'propinsi', 'provinsi', 'daerah'];

    let dimensionCol = null;
    for (const result of validResults) {
      for (const col of result.columns) {
        const colLower = String(col).toLowerCase();
        if (dimensionPatterns.some(p => colLower.includes(p))) {
          dimensionCol = col;
          break;
        }
      }
      if (dimensionCol) break;
    }

    if (!dimensionCol) {
      const r = validResults[0];
      return {
        source: r.sourceName,
        columns: r.columns,
        data: r.data,
        last_update: r.last_update,
        from: 'data_bps',
        merged: false,
      };
    }

    const mergedMap = new Map();
    const allColumns = new Set([dimensionCol]);
    const columnRenameMap = new Map();

    for (const result of validResults) {
      const sourceLower = String(result.sourceName || '').toLowerCase();

      for (const col of result.columns) {
        if (col !== dimensionCol) {
          let finalColName = col;

          if (String(col).toLowerCase() === 'nilai') {
            let indicatorName = extractIndicatorFromSourceName(result.sourceName, topic);

            if (sourceLower.includes('jumlah') && !sourceLower.includes('persentase')) {
              finalColName = indicatorName ? `Jumlah ${indicatorName}` : 'Jumlah';
            } else if (sourceLower.includes('persentase') && !sourceLower.includes('jumlah')) {
              finalColName = indicatorName ? `Persentase ${indicatorName}` : 'Persentase';
            } else if (sourceLower.includes('indeks') || sourceLower.includes('ipm')) {
              finalColName = indicatorName || 'Indeks';
            } else {
              finalColName = indicatorName || col;
            }
          }

          const mapKey = `${result.sourceId}:${col}`;
          columnRenameMap.set(mapKey, finalColName);
          allColumns.add(finalColName);
        }
      }

      for (const row of result.data) {
        const dimValue = String(row[dimensionCol] || '').trim();
        if (!dimValue) continue;

        if (!mergedMap.has(dimValue)) {
          mergedMap.set(dimValue, { [dimensionCol]: dimValue });
        }

        const mergedRow = mergedMap.get(dimValue);
        for (const col of result.columns) {
          if (col !== dimensionCol && row[col] !== undefined && row[col] !== null) {
            const mapKey = `${result.sourceId}:${col}`;
            const finalColName = columnRenameMap.get(mapKey) || col;
            mergedRow[finalColName] = row[col];
          }
        }
      }
    }

    const mergedData = Array.from(mergedMap.values());
    const mergedColumns = Array.from(allColumns);

    let filteredData = mergedData;
    if (geo) {
      const geoNorm = String(geo).toLowerCase().replace(/[^a-z]/g, '');
      const geoExpanded = expandGeoShorthand(geoNorm);
      filteredData = mergedData.filter(row => {
        const rowValues = Object.values(row).map(v => String(v || '').toLowerCase());
        return rowValues.some(v => v.includes(geoNorm) || (geoExpanded && v.includes(geoExpanded)));
      });
      if (filteredData.length === 0) filteredData = mergedData;
    }

    const sourceNames = validResults.map(r => r.sourceName);
    const combinedSourceName = sourceNames.length > 1
      ? `${sourceNames[0]} + ${sourceNames.length - 1} tabel lain`
      : sourceNames[0];

    const latestUpdate = validResults
      .map(r => r.last_update)
      .filter(Boolean)
      .sort()
      .pop() || null;

    return {
      source: combinedSourceName,
      columns: mergedColumns,
      data: filteredData,
      last_update: latestUpdate,
      from: 'data_bps_merged',
      merged: true,
      sourceCount: validResults.length,
    };
  } catch (err) {
    logger.error({ error: err.message }, 'Multi-source merge preview failed');
    return null;
  }
}

async function aggregateMultiSource(params) {
  return getMergedMultiSourcePreview(params);
}

function buildComparisonTable(mergedPreview) {
  if (!mergedPreview) return null;
  return {
    source: mergedPreview.source,
    columns: mergedPreview.columns,
    rows: mergedPreview.data,
    last_update: mergedPreview.last_update || null,
    merged: Boolean(mergedPreview.merged),
    sourceCount: mergedPreview.sourceCount || 1,
  };
}

module.exports = {
  extractIndicatorFromSourceName,
  getMergedMultiSourcePreview,
  aggregateMultiSource,
  buildComparisonTable,
};
