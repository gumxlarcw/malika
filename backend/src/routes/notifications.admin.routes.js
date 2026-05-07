const router = require('express').Router();
const controller = require('../controllers/notifications.admin.controller');

// GET /notifications/admin/list?limit=50&offset=0&type=data|pressrelease
router.get('/list', controller.list);

// DELETE /notifications/admin/clear?all=true|false&type=pressrelease|data
router.delete('/clear', controller.clear);

// DELETE /notifications/admin/delete (body: { ids: [1,2,3] })
router.delete('/delete', controller.deleteSelected);

// POST /notifications/admin/test
router.post('/test', controller.test);

// POST /notifications/admin/create (custom notification with redirect)
router.post('/create', controller.createCustom);

// POST /notifications/admin/emit-latest-merged
router.post('/emit-latest-merged', controller.emitLatestMerged);

// POST /notifications/admin/rebroadcast?id=<notification_id> OR ?uniqueKey=<unique_key>
router.post('/rebroadcast', controller.rebroadcast);

module.exports = router;
