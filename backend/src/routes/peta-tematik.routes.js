const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/peta-tematik.controller');

router.get('/indikator-list', ctrl.getIndikatorList);
router.get('/years', ctrl.getYears);
router.get('/metrics', ctrl.getMetrics);
router.get('/data', ctrl.getData);
router.get('/summary', ctrl.getSummary);
router.get('/indikator-meta/:id', ctrl.getIndikatorMeta);
router.get('/indikator-search', ctrl.searchIndikator);

module.exports = router;
