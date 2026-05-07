const DataSource = require("../../models/DataSource.model");
const ProcessedCache = require("../../models/ProcessedCache.model");

module.exports = {
    async buildSummary(source_id) {
        const source = await DataSource.findByPk(source_id);

        let trendList = [];
        if (source.summary_trend) {
            try {
                trendList = JSON.parse(source.summary_trend);
            } catch {
                trendList = [];
            }
        }

        // Ambil periode terbaru
        const latestRow = await ProcessedCache.findOne({
            where: { source_id },
            order: [["period_value", "DESC"]],
        });

        if (!latestRow) {
            return { headline: null, trends: [], latest_period: null };
        }

        const latest_period = latestRow.period_value;
        const latest = JSON.parse(latestRow.processed_json);

        // Ambil periode sebelumnya untuk mom dan yoy
        const prev_mom_row = await ProcessedCache.findOne({
            where: { source_id, period_value: (parseInt(latest_period) - 1).toString() }
        });

        const prev_yoy_row = await ProcessedCache.findOne({
            where: { source_id, period_value: (parseInt(latest_period) - 12).toString() }
        });

        const prev_mom = prev_mom_row ? JSON.parse(prev_mom_row.processed_json) : null;
        const prev_yoy = prev_yoy_row ? JSON.parse(prev_yoy_row.processed_json) : null;

        // Compile trends
        let trends = [];

        for (const t of trendList) {
            if (t === "mom" && latest.value !== undefined) {
                if (prev_mom) {
                    trends.push({
                        type: "mom",
                        value: latest.value - prev_mom.value
                    });
                } else {
                    trends.push({ type: "mom", value: null });
                }
            }

            if (t === "yoy" && latest.value !== undefined) {
                if (prev_yoy) {
                    trends.push({
                        type: "yoy",
                        value: latest.value - prev_yoy.value
                    });
                } else {
                    trends.push({ type: "yoy", value: null });
                }
            }
        }

        return {
            headline: latest.value ?? null,
            trends,
            latest_period
        };
    }
};
