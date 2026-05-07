const DataSource = require("../models/DataSource.model");
const { fetchAvailablePeriodsForSource } = require("../services/period/fetchAvailable.service");

async function getPublicAvailablePeriods(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid source id" });
    }

    const ds = await DataSource.findByPk(id);
    if (!ds || ds.visible === false || ds.status === false) {
      return res.status(404).json({ message: "DataSource not found" });
    }

    const periods = await fetchAvailablePeriodsForSource(id);
    return res.json({ source_id: id, periods });
  } catch (err) {
    return res.status(400).json({ message: err?.message || "Failed to get periods" });
  }
}

module.exports = { getPublicAvailablePeriods };
