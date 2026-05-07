const express = require("express");
const router = express.Router();
const DataSource = require("../models/DataSource.model");
const { Op } = require("sequelize");

/**
 * GET /categories
 * Public endpoint to list all categories with counts
 * Used by PWA /kategori page
 */
router.get("/", async (req, res) => {
  try {
    const datasources = await DataSource.findAll({
      where: { visible: 1 },
      attributes: ["id", "name", "type", "category"],
      order: [
        ["display_order", "ASC"],
        ["id", "ASC"],
      ],
    });

    // Aggregate by category
    const categoryMap = new Map();

    for (const ds of datasources) {
      const cat = (ds.category || "").trim() || "Lainnya";
      const existing = categoryMap.get(cat);
      if (existing) {
        existing.count++;
        existing.sources.push({
          id: ds.id,
          name: ds.name,
          type: ds.type,
        });
      } else {
        categoryMap.set(cat, {
          count: 1,
          sources: [
            {
              id: ds.id,
              name: ds.name,
              type: ds.type,
            },
          ],
        });
      }
    }

    // Convert to array and sort by count descending
    const categories = Array.from(categoryMap.entries())
      .map(([name, { count, sources }]) => ({
        name,
        count,
        slug: slugify(name),
        sources,
      }))
      .sort((a, b) => b.count - a.count);

    res.json({ categories });
  } catch (err) {
    console.error("[Categories] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

module.exports = router;
