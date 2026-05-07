const { fetchAvailablePeriodsForSource } = require("../services/period/fetchAvailable.service");

async function getAvailablePeriods(req, res) {
  try {
    const id = req.params.id;
    const periods = await fetchAvailablePeriodsForSource(id);
    res.json({ source_id: Number(id), periods });
  } catch (err) {
    res.status(400).json({ message: err.message || "Failed to get periods" });
  }
}

module.exports = { getAvailablePeriods };
