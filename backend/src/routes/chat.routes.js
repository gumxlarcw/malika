const express = require('express');
const chatController = require('../controllers/chat.controller');
const { malikaIdentityMiddleware } = require('../middleware/malikaIdentity.middleware');

const router = express.Router();

// Bootstrap: mint/renew a signed identity. MUST stay un-guarded — it is what
// issues the token, so requiring a valid token here would deadlock strict mode.
router.post('/identity', chatController.createIdentity);

// Data routes — guarded: ownership is derived from the verified token.
router.get('/threads', malikaIdentityMiddleware, chatController.listThreads);
router.post('/threads', malikaIdentityMiddleware, chatController.createThread);
router.get('/threads/:id/messages', malikaIdentityMiddleware, chatController.listMessages);
router.post('/threads/:id/messages', malikaIdentityMiddleware, chatController.sendMessage);
router.get('/threads/:id/suggestions', malikaIdentityMiddleware, chatController.getThreadSuggestions);

// Streaming over SSE — POST only. The GET ?text= variant was removed: it leaked
// queries/credentials into URLs and access logs (audit finding H11).
router.post('/threads/:id/stream', malikaIdentityMiddleware, chatController.streamMessage);

module.exports = router;
