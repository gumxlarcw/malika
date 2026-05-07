const express = require("express");
const controller = require("../controllers/search.controller");
const intentController = require("../controllers/searchIntent.controller");

const router = express.Router();

// Public (no auth): datasource search
router.get("/datasource", controller.searchDatasource);
router.get("/favorites", controller.favorites);
router.post("/track/datasource", controller.trackDatasource);
router.get("/intent", intentController.getSearchIntent);

// Public: knowledge base search (for RAG)
router.get("/knowledge", controller.searchKnowledge);

module.exports = router;
