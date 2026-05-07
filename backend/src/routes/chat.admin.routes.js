const express = require('express');
const chatAdminController = require('../controllers/chat.admin.controller');

const router = express.Router();

/**
 * Admin endpoints for viewing all chat data (threads + messages)
 * All endpoints require admin authentication
 */

// List all chat threads (paginated)
router.get('/threads', chatAdminController.listAllThreads);

// Get a single thread with all its messages
router.get('/threads/:id', chatAdminController.getThreadWithMessages);

// Export all threads + messages for a specific owner
router.get('/export/owner/:ownerId', chatAdminController.exportByOwner);

// Export all chat data (threads + messages)
router.get('/export/all', chatAdminController.exportAll);

// Get chat statistics
router.get('/stats', chatAdminController.getStats);

module.exports = router;
