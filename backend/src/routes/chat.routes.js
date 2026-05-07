const express = require('express');
const chatController = require('../controllers/chat.controller');

const router = express.Router();

router.get('/threads', chatController.listThreads);
router.post('/threads', chatController.createThread);
router.get('/threads/:id/messages', chatController.listMessages);
router.post('/threads/:id/messages', chatController.sendMessage);

// Streaming endpoint using SSE
router.get('/threads/:id/stream', chatController.streamMessage);
router.post('/threads/:id/stream', chatController.streamMessage);

module.exports = router;
