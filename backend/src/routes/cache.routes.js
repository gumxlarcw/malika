const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middleware/auth.middleware");
const cacheController = require("../controllers/cache.controller");
const { mergeProcessedByTh, readSavedMerged } = require("../controllers/cache.merge.controller");

// GET /cache/:id?period=YYYY
router.get("/:id", authMiddleware, cacheController.getProcessed);
// POST /cache/refresh/:id?period=YYYY[-MM]
router.post("/refresh/:id", authMiddleware, cacheController.refreshCache);
// GET /cache/merge/:id?th_ids=125,124 or &all=true
router.get("/merge/:id", authMiddleware, mergeProcessedByTh);
// GET /cache/merged/:id?signature=all|124,125
router.get("/merged/:id", authMiddleware, readSavedMerged);

module.exports = router;
