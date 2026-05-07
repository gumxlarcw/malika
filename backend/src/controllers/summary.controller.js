const SummaryService = require("../services/summary/summary.services");

exports.getSummary = async (req, res) => {
    try {
        const summary = await SummaryService.buildSummary(req.params.id);
        res.json(summary);
    } catch (err) {
        console.error("SUMMARY ERROR:", err);
        res.status(500).json({ error: "Failed to build summary" });
    }
};
