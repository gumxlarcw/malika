const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/dashboard.controller');

// Public routes for the PWA dashboard — no auth.
// Rate limiting is applied at app.js registration.
router.get('/summary', ctrl.getSummary);

module.exports = router;
