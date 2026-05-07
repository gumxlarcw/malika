const express = require('express');
const router = express.Router();

const controller = require('../controllers/automation.notifications.controller');

// GET /automation/notifications/status
router.get('/status', controller.getStatus);

// GET /automation/notifications/notifications?limit=&offset=&type=
router.get('/notifications', controller.listNotifications);

// GET /automation/notifications/push-logs?limit=&offset=&trigger=&notification_id=&unique_key=
router.get('/push-logs', controller.listPushLogs);

module.exports = router;
