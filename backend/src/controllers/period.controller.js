const { generatePeriodMap } = require("../services/period/generatePeriodMap.service");
const DataPeriod = require("../models/DataPeriod.model");
const DataSource = require("../models/DataSource.model");
const { Op } = require("sequelize");

exports.generatePeriodForSource = async (req, res) => {
    try {
        const { id } = req.params;
        const { start, end } = req.query;

        const startYear = start !== undefined ? parseInt(start, 10) : undefined;
        const endYear = end !== undefined ? parseInt(end, 10) : undefined;
        await generatePeriodMap(parseInt(id, 10), startYear, endYear);

        res.json({ message: "Period map generated successfully" });

    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
};

// Get period map for a specific source
exports.listPeriodForSource = async (req, res) => {
    try {
        const { id } = req.params;
        const sourceId = parseInt(id, 10);
        if (!Number.isFinite(sourceId)) {
            return res.status(400).json({ error: "Invalid source_id" });
        }

        const periods = await DataPeriod.findAll({
            where: { source_id: sourceId },
            order: [["period_value", "ASC"]],
        });

        res.json({
            source_id: sourceId,
            count: periods.length,
            periods: periods.map(p => ({
                id: p.id,
                period_value: p.period_value,
                api_url_override: p.api_url_override,
            })),
        });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
};

// Generate period map for ALL sources (interop/dynamic that support auto-detect)
exports.generatePeriodForAll = async (req, res) => {
    try {
        const { start, end } = req.query;
        const startYear = start !== undefined ? parseInt(start, 10) : undefined;
        const endYear = end !== undefined ? parseInt(end, 10) : undefined;

        // Fetch all datasources that can have period map (dynamic/interop)
        const sources = await DataSource.findAll({
            where: {
                type: { [Op.in]: ["dynamic", "interop"] },
                visible: true,
            },
            order: [["id", "ASC"]],
        });

        const results = [];
        for (const ds of sources) {
            const dsId = ds.id;
            try {
                await generatePeriodMap(dsId, startYear, endYear);
                results.push({ id: dsId, name: ds.name, ok: true });
            } catch (err) {
                results.push({ id: dsId, name: ds.name, ok: false, error: err.message });
            }
        }

        const successCount = results.filter(r => r.ok).length;
        res.json({
            message: `Generated period map for ${successCount}/${results.length} sources`,
            results,
        });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
};
