/**
 * Analytics Routes
 * /analytics/*
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/analytics.controller');
const { authMiddleware, requireAdmin } = require('../middleware/auth.middleware');

// Public endpoints (called from frontend PWA)
router.post('/track', controller.trackPageView);
router.post('/heartbeat', controller.heartbeat);

// Admin endpoints (require auth + admin role)
router.get('/dashboard', authMiddleware, requireAdmin, controller.getDashboardStats);
router.get('/calendar', authMiddleware, requireAdmin, controller.getMonthlyCalendar);
router.post('/cleanup', authMiddleware, requireAdmin, controller.cleanup);

module.exports = router;
