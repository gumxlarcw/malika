const express = require('express');
const router = express.Router();
const { authMiddleware, requireAdmin } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/autoTune.controller');

router.post('/flags/:id/auto-tune', authMiddleware, requireAdmin, ctrl.startJob);
router.get('/auto-tune/:jobId', authMiddleware, requireAdmin, ctrl.status);

module.exports = router;
