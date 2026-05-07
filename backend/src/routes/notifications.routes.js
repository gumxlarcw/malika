const router = require('express').Router();
const controller = require('../controllers/notifications.controller');

// GET /notifications?limit=20&offset=0&type=data|pressrelease|publication
router.get('/', controller.getNotifications);

module.exports = router;
