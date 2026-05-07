const express = require('express');
const router = express.Router();

const controller = require('../controllers/schedulerSettings.controller');

// GET /automation/scheduler-settings
router.get('/', controller.getSettings);

// POST /automation/scheduler-settings
router.post('/', controller.updateSettings);

// POST /automation/scheduler-settings/restart
router.post('/restart', controller.restartSchedulers);

module.exports = router;
