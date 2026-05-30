const express = require('express');
const router = express.Router();
const feedbackController = require('../controllers/chatFeedback.controller');
const { malikaIdentityMiddleware } = require('../middleware/malikaIdentity.middleware');

// Public endpoints — identity derived from the signed token (dual-mode: bare uid).
router.post('/', malikaIdentityMiddleware, feedbackController.submitFeedback);
router.post('/general', malikaIdentityMiddleware, feedbackController.submitGeneralFeedback);
router.get('/mine', malikaIdentityMiddleware, feedbackController.getMyFeedback);
router.get('/thread/:thread_id', malikaIdentityMiddleware, feedbackController.getFeedbackByThread);

// NOTE: /all returns all feedback and is NOT admin-gated today — pre-existing,
// out of scope for this IDOR fix. The guard at least requires a valid signed
// identity; proper admin-gating is tracked separately.
router.get('/all', malikaIdentityMiddleware, feedbackController.getAllFeedbacks);

module.exports = router;
