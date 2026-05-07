const express = require('express');
const router = express.Router();
const { subscribe, unsubscribe } = require('../controllers/push.controller');
const { authMiddleware, requireAdmin } = require('../middleware/auth.middleware');
const PushSubscription = require('../models/PushSubscription.model');

// Public: subscription must be initiated by the client browser.
router.post('/subscribe', subscribe);
router.post('/unsubscribe', unsubscribe);

// Admin: list all push subscriptions
router.get('/subscriptions', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;
    
    const { count, rows } = await PushSubscription.findAndCountAll({
      order: [['created_at', 'DESC']],
      limit,
      offset,
      attributes: ['id', 'endpoint', 'user_agent', 'created_at'],
    });
    
    return res.json({ total: count, limit, offset, subscriptions: rows });
  } catch (err) {
    console.error('List push subscriptions error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin: delete a push subscription
router.delete('/subscriptions/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await PushSubscription.destroy({ where: { id } });
    return res.json({ message: 'Subscription deleted', id: Number(id) });
  } catch (err) {
    console.error('Delete push subscription error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin: get subscription stats
router.get('/subscriptions/stats', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const total = await PushSubscription.count();
    return res.json({ total });
  } catch (err) {
    console.error('Push subscription stats error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
