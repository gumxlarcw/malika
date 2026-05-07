const { getDashboardEmbedUrl } = require("../services/metabase/embed.service");

// GET /metabase/embed/dashboard/:id
async function getDashboardEmbed(req, res) {
  try {
    const dashboardId = Number(req.params.id);
    if (!Number.isFinite(dashboardId) || dashboardId <= 0) {
      return res.status(400).json({ error: "Invalid dashboard id" });
    }

    const bordered = String(req.query.bordered || "true").toLowerCase() === "true";
    const titled = String(req.query.titled || "true").toLowerCase() === "true";

    // For now we keep params empty (public embed use-case). If you need per-device
    // filters later, we can safely whitelist keys here.
    const iframeUrl = await getDashboardEmbedUrl({
      dashboardId,
      params: {},
      bordered,
      titled,
    });

    return res.json({ iframeUrl });
  } catch (err) {
    console.error("[MetabaseEmbed] Error:", err.message);
    return res.status(err.status || 500).json({
      error: "Failed to generate Metabase embed",
      message: err.message,
    });
  }
}

module.exports = {
  getDashboardEmbed,
};
