/**
 * Error Learning Routes
 * Endpoints for error tracking and learning from mistakes
 */

const express = require('express');
const router = express.Router();
const { authMiddleware, requireAdmin } = require('../middleware/auth.middleware');
const errorLearningController = require('../controllers/errorLearning.controller');

// Public endpoint - users can flag messages
router.post('/flag', errorLearningController.flagMessage);

// Admin-only endpoints (require auth + admin role)
router.get('/stats', authMiddleware, requireAdmin, errorLearningController.getStats);
router.get('/analyze', authMiddleware, requireAdmin, errorLearningController.analyzeFlags);
router.get('/flags', authMiddleware, requireAdmin, errorLearningController.listFlags);
router.put('/flags/:id/resolve', authMiddleware, requireAdmin, errorLearningController.resolveFlag);
router.patch('/flags/:id', authMiddleware, requireAdmin, errorLearningController.updateFlag);
router.post('/flags/:id/add-to-knowledge', authMiddleware, requireAdmin, errorLearningController.addToKnowledge);

// Pattern management (admin only)
router.get('/patterns', authMiddleware, requireAdmin, errorLearningController.listPatterns);
router.post('/patterns', authMiddleware, requireAdmin, errorLearningController.createPattern);
router.put('/patterns/:id', authMiddleware, requireAdmin, errorLearningController.updatePattern);
router.patch('/patterns/:id', authMiddleware, requireAdmin, errorLearningController.updatePattern);
router.delete('/patterns/:id', authMiddleware, requireAdmin, errorLearningController.deletePattern);

module.exports = router;
