const DataSource = require("../models/DataSource.model");
const ProcessedCache = require("../models/ProcessedCache.model");
const getSequelizeBps = require("../config/db_bps");
const { readGenericIndicatorFromBps } = require("../services/bpsRead/indicatorTableGenericRead.service");

/**
 * Read from ProcessedCache as fallback
 */
async function readFromProcessedCache(sourceId, period) {
    try {
        const cache = await ProcessedCache.findOne({
            where: {
                source_id: sourceId,
                period_value: period,
            },
            order: [['last_update', 'DESC']],
        });

        if (!cache || !cache.processed_json) return null;

        let parsed = cache.processed_json;
        if (typeof parsed === 'string') {
            parsed = JSON.parse(parsed);
        }

        return {
            source: parsed.source || 'Data',
            columns: Array.isArray(parsed.columns) ? parsed.columns : [],
            data: Array.isArray(parsed.data) ? parsed.data : [],
            last_update: parsed.last_update || null,
        };
    } catch {
        return null;
    }
}

exports.getInterop = async (req, res) => {
    try {
        const id = req.params.id;
        const period = req.query.period || null;

        const source = await DataSource.findByPk(id);
        if (!source) return res.status(404).json({ message: "Source not found" });

        // Try data_bps first (if configured)
        const sequelizeBps = getSequelizeBps();
        if (sequelizeBps) {
            const bpsData = await readGenericIndicatorFromBps({
                sourceId: id,
                period,
                sourceName: source?.name || "Data Statistik",
            });

            if (bpsData && !bpsData.__disabled) {
                return res.json({
                    cached: true,
                    data: bpsData,
                });
            }
        }

        // Fallback to ProcessedCache
        const cacheData = await readFromProcessedCache(id, period);
        if (cacheData && cacheData.data && cacheData.data.length > 0) {
            return res.json({
                cached: true,
                data: cacheData,
                source: 'processed_cache',
            });
        }

        // Neither data_bps nor cache available
        return res.status(404).json({
            message: "Data indikator belum tersedia (belum diproses atau direplikasi).",
            code: "DATA_NOT_AVAILABLE",
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
