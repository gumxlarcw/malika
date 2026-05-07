const express = require('express');
const controller = require('../controllers/ai.controller');

const router = express.Router();

// Public (rate-limited at app level). Never expose API keys to clients.
router.post('/query-builder', controller.queryBuilder);

module.exports = router;
