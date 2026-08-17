const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/dashboard.controller');

// Admin-only. Auth, CSRF and rate limiting are applied at app.js registration.
router.get('/curation', ctrl.getCuration);
router.put('/curation', ctrl.putCuration);

module.exports = router;
