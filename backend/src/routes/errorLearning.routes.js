/**
 * Error Learning Routes
 * Endpoints for error tracking and learning from mistakes
 */

const express = require('express');
const router = express.Router();
const { authMiddleware, requireAdmin } = require('../middleware/auth.middleware');
const { createAuditLogMiddleware } = require('../middleware/auditLog.middleware');
const errorLearningController = require('../controllers/errorLearning.controller');

const auditEL = createAuditLogMiddleware({ resource: 'error-learning' });

// Public endpoint - users can flag messages
router.post('/flag', auditEL, errorLearningController.flagMessage);

// Admin-only endpoints (require auth + admin role)
router.get('/stats', authMiddleware, requireAdmin, errorLearningController.getStats);
router.get('/analyze', authMiddleware, requireAdmin, errorLearningController.analyzeFlags);
router.get('/flags', authMiddleware, requireAdmin, errorLearningController.listFlags);
router.put('/flags/:id/resolve', authMiddleware, requireAdmin, auditEL, errorLearningController.resolveFlag);
router.patch('/flags/:id', authMiddleware, requireAdmin, auditEL, errorLearningController.updateFlag);
router.post('/flags/:id/add-to-knowledge', authMiddleware, requireAdmin, auditEL, errorLearningController.addToKnowledge);

// Pattern management (admin only)
router.get('/patterns', authMiddleware, requireAdmin, errorLearningController.listPatterns);
router.post('/patterns', authMiddleware, requireAdmin, auditEL, errorLearningController.createPattern);
router.put('/patterns/:id', authMiddleware, requireAdmin, auditEL, errorLearningController.updatePattern);
router.patch('/patterns/:id', authMiddleware, requireAdmin, auditEL, errorLearningController.updatePattern);
router.delete('/patterns/:id', authMiddleware, requireAdmin, auditEL, errorLearningController.deletePattern);

module.exports = router;
