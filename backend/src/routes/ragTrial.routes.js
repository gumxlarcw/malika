/**
 * RAG Trial Routes
 * Admin endpoints for testing BRS/Publication RAG indexing
 */

const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth.middleware');
const ragTrialController = require('../controllers/ragTrial.controller');

// All routes require admin authentication
router.use(requireAdmin);

// Stats (includes available years)
router.get('/stats', ragTrialController.getStats);

// Available years for BRS and Publications
router.get('/available-years', ragTrialController.getAvailableYears);

// BRS endpoints
router.get('/brs', ragTrialController.getBrsList);

// Publication endpoints
router.get('/publications', ragTrialController.getPublicationsList);

// PDF extraction
router.post('/extract-pdf', ragTrialController.extractPdf);

// Embedding test
router.post('/test-embed', ragTrialController.testEmbed);

// Abstract analysis
router.post('/analyze-abstract', ragTrialController.analyzeAbstract);

// Compare abstract vs PDF
router.post('/compare', ragTrialController.compareExtraction);

// Test RAG search
router.post('/test-search', ragTrialController.testSearch);

// ========== Indexed Document Tracking ==========

// Get list of indexed documents (paginated)
router.get('/indexed', ragTrialController.getIndexedList);

// Get indexed stats
router.get('/indexed/stats', ragTrialController.getIndexedStats);

// Index a document (create tracking record)
router.post('/index', ragTrialController.indexDocument);

// Check if documents are already indexed (batch)
router.post('/check-indexed', ragTrialController.checkIndexed);

// Remove indexed document
router.delete('/indexed/:id', ragTrialController.removeIndexed);

module.exports = router;
