// src/routes/logs.routes.js
const express = require("express");
const router = express.Router();
const { authMiddleware, requireAdmin } = require("../middleware/auth.middleware");
const FetchLog = require("../models/FetchLog.model");
const { Op } = require("sequelize");

// GET /logs/fetch - List fetch logs with pagination
router.get("/fetch", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;
    const source_id = req.query.source_id ? parseInt(req.query.source_id) : null;
    const status = req.query.status; // "success", "error", or null for all

    const where = {};
    if (source_id) {
      where.source_id = source_id;
    }
    if (status === "success") {
      where.status_code = { [Op.between]: [200, 299] };
    } else if (status === "error") {
      where.status_code = { [Op.or]: [{ [Op.lt]: 200 }, { [Op.gte]: 300 }] };
    }

    const { count, rows } = await FetchLog.findAndCountAll({
      where,
      order: [["id", "DESC"]],
      limit,
      offset,
    });

    return res.json({
      total: count,
      limit,
      offset,
      logs: rows,
    });
  } catch (err) {
    console.error("List fetch logs error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /logs/fetch/stats - Summary stats
router.get("/fetch/stats", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const sequelize = require("../config/db");
    const [stats] = await sequelize.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status_code BETWEEN 200 AND 299 THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN status_code < 200 OR status_code >= 300 THEN 1 ELSE 0 END) as error_count,
        COUNT(DISTINCT source_id) as unique_sources
      FROM fetch_logs
    `);

    return res.json(stats[0] || { total: 0, success_count: 0, error_count: 0, unique_sources: 0 });
  } catch (err) {
    console.error("Fetch logs stats error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /logs/fetch - Clear old logs (keep last N)
router.delete("/fetch", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const keep = parseInt(req.query.keep) || 1000;
    
    const sequelize = require("../config/db");
    const [result] = await sequelize.query(`
      DELETE FROM fetch_logs 
      WHERE id NOT IN (
        SELECT id FROM (
          SELECT id FROM fetch_logs ORDER BY id DESC LIMIT ?
        ) as keep_rows
      )
    `, { replacements: [keep] });

    return res.json({ message: `Cleared old logs, kept last ${keep}`, affected: result.affectedRows || 0 });
  } catch (err) {
    console.error("Clear fetch logs error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
