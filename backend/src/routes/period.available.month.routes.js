const express = require("express");
const router = express.Router();
const { fetchAvailableMonthsForSource } = require("../services/period/fetchAvailable.service");

// GET /period/available/:id/months?year=YYYY
router.get("/:id/months", async (req, res) => {
  try {
    const id = req.params.id;
    const { year } = req.query;
    const months = await fetchAvailableMonthsForSource(id, String(year));
    res.json({ source_id: Number(id), year: String(year), months });
  } catch (err) {
    res.status(400).json({ message: err.message || "Failed to get months" });
  }
});

module.exports = router;
