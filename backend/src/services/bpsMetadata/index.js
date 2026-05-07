'use strict';

const { extractDynamicMetadata } = require('./extractors/dynamic.extractor');
const { extractInteropMetadata } = require('./extractors/interop.extractor');
const { extractEximMetadata } = require('./extractors/exim.extractor');
const { extractStaticMetadata } = require('./extractors/static.extractor');
const { persistMetadata, markFetchFailure } = require('./persist');

/**
 * Single dispatch entry: given a `data_sources` row + raw BPS API response,
 * extract metadata for the appropriate type and persist to the metadata tables.
 *
 * Returns a summary { sourceId, type, metricsCount, ok, error? }.
 */
async function ingestSourceMetadata(source, apiResponse) {
  const sourceId = source?.id;
  const type = source?.type;
  if (!sourceId || !type) {
    throw new Error('ingestSourceMetadata: missing source id/type');
  }

  let extracted;
  try {
    extracted = extractByType(type, apiResponse, sourceId, source.name);
  } catch (e) {
    await markFetchFailure(sourceId, e.message);
    return { sourceId, type, ok: false, error: `extract: ${e.message}` };
  }

  if (!extracted || !extracted.meta) {
    await markFetchFailure(sourceId, 'no metadata extracted');
    return { sourceId, type, ok: false, error: 'no metadata extracted' };
  }

  try {
    await persistMetadata(extracted);
  } catch (e) {
    await markFetchFailure(sourceId, e.message);
    return { sourceId, type, ok: false, error: `persist: ${e.message}` };
  }

  return {
    sourceId,
    type,
    ok: true,
    metricsCount: Array.isArray(extracted.metrics) ? extracted.metrics.length : 0,
    hasStaticTable: !!extracted.staticTable,
    valueCodesCount: Array.isArray(extracted.valueCodes) ? extracted.valueCodes.length : 0,
  };
}

function extractByType(type, api, sourceId, sourceName) {
  switch (type) {
    case 'dynamic':
      return extractDynamicMetadata(api, sourceId);
    case 'interop':
      return extractInteropMetadata(api, sourceId);
    case 'exim':
      return extractEximMetadata(api, sourceId, sourceName);
    case 'static':
      return extractStaticMetadata(api, sourceId);
    default:
      throw new Error(`Unsupported type: ${type}`);
  }
}

module.exports = { ingestSourceMetadata, extractByType };
