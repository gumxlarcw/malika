const express = require('express');
const router = express.Router();
const {
	listAutomationStatus,
	upsertAutomationConfig,
	runAutomationNow,
	runAutomationJobStart,
	getAutomationJobStatus,
	startAutomationStatusJob,
	getAutomationStatusJob,
	getLastAutomationLog,
	getEximPodFilter,
	upsertEximPodFilter,
	getEximPodOptions,
} = require('../controllers/automation.controller');

const automationNotificationsRoutes = require('./automation.notifications.routes');
const schedulerSettingsRoutes = require('./schedulerSettings.routes');

// GET /automation
router.get('/', listAutomationStatus);

// Automation Notifications (admin-only)
// NOTE: keep this BEFORE any /:id routes.
router.use('/notifications', automationNotificationsRoutes);

// Scheduler Settings (admin-only)
// NOTE: keep this BEFORE any /:id routes.
router.use('/scheduler-settings', schedulerSettingsRoutes);

// POST /automation/status-job
router.post('/status-job', startAutomationStatusJob);

// GET /automation/status-job/:jobId
router.get('/status-job/:jobId', getAutomationStatusJob);

// GET /automation/run/job/:jobId
router.get('/run/job/:jobId', getAutomationJobStatus);

// EXIM POD filter (persisted per-indicator; affects replication to data_bps)
// GET /automation/:id/pod-filter
router.get('/:id/pod-filter', getEximPodFilter);

// POST /automation/:id/pod-filter
router.post('/:id/pod-filter', upsertEximPodFilter);

// GET /automation/:id/pod-options
router.get('/:id/pod-options', getEximPodOptions);

// POST /automation/:id
router.post('/:id', upsertAutomationConfig);

// POST /automation/:id/run
router.post('/:id/run', runAutomationNow);

// POST /automation/:id/run-job
router.post('/:id/run-job', runAutomationJobStart);

// GET /automation/:id/log
router.get('/:id/log', getLastAutomationLog);

module.exports = router;
