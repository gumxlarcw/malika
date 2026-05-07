const express = require('express');
const router = express.Router();
const feedbackController = require('../controllers/chatFeedback.controller');

// Public endpoints (with x-malika-uid header)
router.post('/', feedbackController.submitFeedback);
router.post('/general', feedbackController.submitGeneralFeedback);
router.get('/mine', feedbackController.getMyFeedback);
router.get('/thread/:thread_id', feedbackController.getFeedbackByThread);

// Admin endpoint
router.get('/all', feedbackController.getAllFeedbacks);

module.exports = router;
