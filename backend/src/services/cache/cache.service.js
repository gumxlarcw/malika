const ProcessedCache = require("../../models/ProcessedCache.model");
const { syncMetadataIndexFromProcessedCacheRow } = require('../search/metadataIndex.service');

async function getCache(source_id, period) {
    return ProcessedCache.findOne({
        where: { source_id, period_value: period },
        order: [["last_update", "DESC"]]
    });
}

async function saveCache(source_id, period, json) {
    const result = await ProcessedCache.upsert({
        source_id: source_id,
        period_value: period,
        processed_json: JSON.stringify(json),
        last_update: new Date()
    }, {
        returning: true
    });

    // Best-effort: keep search index up-to-date with cached columns/values.
    // Never fail cache writes if indexing fails.
    try {
        await syncMetadataIndexFromProcessedCacheRow({
            sourceId: source_id,
            processedObj: json,
        });
    } catch {
        // ignore
    }

    return result;
}


module.exports = { getCache, saveCache };
