const express = require('express');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { authMiddleware, requireAdmin } = require('../middleware/auth.middleware');
const {
  uploadGeojson,
  listGeojson,
  deleteGeojson,
  serveGeojsonPublic,
  getGeojsonAdmin,
  updateGeojsonPropertiesAdmin,
} = require('../controllers/geojson.controller');

const router = express.Router();

// Upload limiter (admin-only).
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      // __dirname: backend/src/routes
      const dir = path.join(__dirname, '..', '..', 'tmp', 'geojson_uploads');
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch {
        // ignore
      }
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '') || '.geojson';
      const name = `upload_${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`;
      cb(null, name);
    },
  }),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
});

router.get('/list', authMiddleware, requireAdmin, listGeojson);

// Admin-only raw JSON (for preview/edit)
router.get('/admin/raw/:filename', authMiddleware, requireAdmin, getGeojsonAdmin);

// Admin-only bulk update properties (kode -> label)
router.post('/admin/update-properties/:filename', authMiddleware, requireAdmin, updateGeojsonPropertiesAdmin);

router.delete('/file/:filename', authMiddleware, requireAdmin, deleteGeojson);

router.post('/upload', authMiddleware, uploadLimiter, requireAdmin, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: {
          message: 'File terlalu besar. Maksimal 50MB.',
          code: 'ERR_FILE_TOO_LARGE',
        },
      });
    }
    if (err) return next(err);
    return uploadGeojson(req, res, next);
  });
});

// Public raw access (no auth): /geojson/<filename>
// Keep this LAST so it doesn't shadow /list or /file/*.
router.get('/:filename', serveGeojsonPublic);

module.exports = router;
