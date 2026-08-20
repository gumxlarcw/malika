const express = require('express');
const chatController = require('../controllers/chat.controller');
const { malikaIdentityMiddleware } = require('../middleware/malikaIdentity.middleware');

const router = express.Router();

// Bootstrap: mint/renew the signed anonymous identity token. MUST be registered
// BEFORE the identity guard so it stays reachable even in strict mode (it is the
// endpoint that issues the very token the guard would otherwise require).
router.post('/identity', chatController.createIdentity);

// Everything below requires a derived identity: a valid x-malika-token (always),
// or — while MALIKA_IDENTITY_STRICT is off — a bare x-malika-uid (legacy).
router.use(malikaIdentityMiddleware);

router.get('/threads', chatController.listThreads);
router.post('/threads', chatController.createThread);
router.get('/threads/:id/messages', chatController.listMessages);
router.post('/threads/:id/messages', chatController.sendMessage);
router.delete('/threads/:id', chatController.deleteThread);
router.get('/threads/:id/suggestions', chatController.getThreadSuggestions);

// Streaming endpoint using SSE. POST only — the GET `?text=` variant was removed
// (leak vector: it put user questions + credentials in URLs and access logs).
router.post('/threads/:id/stream', chatController.streamMessage);

module.exports = router;
