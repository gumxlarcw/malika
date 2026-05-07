/**
 * Controller untuk Press Release datasource
 * Handles: list fetching, detail fetching, processing, and caching
 */

const { pullPressRelease } = require("../services/pressrelease/pull.service");

exports.getPressRelease = async (req, res) => {
    try {
        const source_id = Number(req.params.id);
        const keywordQuery = String(req.query.keyword || "").trim();
        const saveToBps = String(req.query.save || req.query.save_bps || req.query.production || "").trim().toLowerCase() === "true";
        const forceRefresh = String(req.query.refresh || req.query.force || "").trim().toLowerCase() === "true";

        const result = await pullPressRelease({
            sourceId: source_id,
            keywordOverride: keywordQuery || null,
            saveToBps,
            forceRefresh,
            log: (m) => console.log(`[PressRelease] ${m}`),
        });

        return res.json({
            cached: result.cached,
            updated: result.updated,
            data: result.data,
            production: result.production || null,
        });

    } catch (err) {
        console.error('[Controller] Error:', err.message, err.stack);
        return res.status(500).json({ 
            error: "Failed to fetch press release data",
            message: err.message 
        });
    }
};
