const express = require('express');
const controller = require('../controllers/searchAdmin.controller');

const router = express.Router();

// Admin-only: in-memory stats for intent routing (safe: no raw queries)
router.get('/intent-stats', controller.getIntentStats);

// Admin-only: shadow mode divergence snapshot (no raw queries stored)
router.get('/shadow-snapshot', controller.shadowSnapshot);

module.exports = router;
