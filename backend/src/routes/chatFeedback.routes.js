const express = require('express');
const router = express.Router();
const feedbackController = require('../controllers/chatFeedback.controller');
const { malikaIdentityMiddleware } = require('../middleware/malikaIdentity.middleware');

// Public anon endpoints — owner is derived by the identity guard (signed token,
// or bare x-malika-uid while STRICT is off).
router.post('/', malikaIdentityMiddleware, feedbackController.submitFeedback);
router.post('/general', malikaIdentityMiddleware, feedbackController.submitGeneralFeedback);
router.get('/mine', malikaIdentityMiddleware, feedbackController.getMyFeedback);
router.get('/thread/:thread_id', malikaIdentityMiddleware, feedbackController.getFeedbackByThread);

// Admin endpoint (not an anon-owned route — left unguarded by the anon middleware)
router.get('/all', feedbackController.getAllFeedbacks);

module.exports = router;
