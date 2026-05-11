/**
 * Knowledge Routes
 * Endpoints for RAG / Knowledge Base management
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { requireAdmin } = require('../middleware/auth.middleware');
const knowledgeController = require('../controllers/knowledge.controller');

// Configure multer for PDF uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  },
});

// All routes require admin authentication
router.use(requireAdmin);

// Stats & listing (datasources)
router.get('/stats', knowledgeController.getStats);
router.get('/datasources', knowledgeController.getDatasources);

// Embedding management (datasources)
router.post('/embed/:id', knowledgeController.embedSingle);
router.post('/embed-all', knowledgeController.embedAll);
router.delete('/embed/:id', knowledgeController.clearEmbedding);

// Search
router.post('/search', knowledgeController.search);

// Cache management
router.post('/invalidate-cache', knowledgeController.invalidateCache);

// Knowledge Sync (BRS + Publikasi auto-embed)
router.get('/sync/stats', knowledgeController.getSyncStats);
router.get('/sync/config', knowledgeController.getSyncConfig);
router.post('/sync', knowledgeController.runManualSync);
router.put('/sync/schedule', knowledgeController.updateSyncSchedule);

// Custom knowledge documents
router.get('/documents/stats', knowledgeController.getDocumentStats);
router.get('/documents', knowledgeController.getDocuments);
router.post('/documents/text', knowledgeController.createFromText);
router.post('/documents/pdf', upload.single('file'), knowledgeController.createFromPdf);
router.post('/documents/:id/re-embed', knowledgeController.reEmbedDocument);
router.delete('/documents/:id', knowledgeController.deleteDocument);

module.exports = router;
