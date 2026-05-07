const DataSource = require("../models/DataSource.model");
const { saveCache } = require("../services/cache/cache.service");
const dynamicProcessor = require("../services/processor/dynamic.processor");
// You can add other processors if needed: static, interop

// POST /cache/refresh/:id?period=YYYY-MM or YYYY
async function refreshCache(req, res) {
  try {
    const id = Number(req.params.id);
    const period = String(req.query.period || "");
    if (!period) return res.status(400).json({ message: "period is required" });
    const ds = await DataSource.findByPk(id);
    if (!ds) return res.status(404).json({ message: "DataSource not found" });

    const type = ds.type || "dynamic";
    let processed;
    if (type === "dynamic") {
      processed = await dynamicProcessor.processSource(ds, period);
    } else {
      return res.status(400).json({ message: `Unsupported datasource type: ${type}` });
    }
    await saveCache(id, period, processed);
    res.json({ source_id: id, period, processed, last_update: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ message: err.message || "Failed to refresh cache" });
  }
}

module.exports.refreshCache = refreshCache;
const { getCache } = require("../services/cache/cache.service");

exports.getProcessed = async (req, res) => {
  try {
    const sourceId = req.params.id;
    const period = req.query.period;
    if (!period) {
      return res.status(400).json({ error: "Query 'period' is required" });
    }
    const row = await getCache(sourceId, period);
    if (!row) {
      return res.status(404).json({ error: "Processed cache not found" });
    }
    let json;
    try {
      json = JSON.parse(row.processed_json);
    } catch {
      json = row.processed_json; // fall back raw
    }
    res.json({
      source_id: row.source_id,
      period: row.period_value,
      last_update: row.last_update,
      processed: json,
    });
  } catch (err) {
    console.error("CACHE GET ERROR:", err);
    res.status(500).json({ error: "Failed to retrieve processed cache" });
  }
};
