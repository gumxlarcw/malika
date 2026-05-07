const express = require("express");
const router = express.Router();
const controller = require("../controllers/datasource.controller");
const { requireAdmin } = require("../middleware/auth.middleware");

router.get("/", controller.getAll);

// Admin endpoints
router.get("/admin", controller.getAdminList);
router.post("/search-terms/reindex", requireAdmin, controller.reindexSearchTermsForAll);
router.post("/:id/search-terms/reindex", requireAdmin, controller.reindexSearchTermsForSource);
router.post("/search-metadata/reindex", requireAdmin, controller.reindexSearchMetadataForAllFromCache);
router.post("/:id/search-metadata/reindex", requireAdmin, controller.reindexSearchMetadataForSourceFromCache);
router.post("/exim/seed", requireAdmin, controller.seedExim);
router.post("/exim/seed/job", requireAdmin, controller.seedEximJobStart);
router.get("/exim/seed/job-active", requireAdmin, controller.seedEximJobActive);
router.get("/exim/seed/job/:jobId", requireAdmin, controller.seedEximJobStatus);
router.post("/prepare", controller.prepareFromUrl);
router.post("/", controller.create);
router.put("/:id", controller.update);
router.delete("/:id", controller.remove);
router.delete("/:id/hard", requireAdmin, controller.hardRemove);

module.exports = router;
