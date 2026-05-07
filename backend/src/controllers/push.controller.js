const { upsertSubscription, removeSubscription } = require('../services/push/push.service');

async function subscribe(req, res) {
  try {
    const subscription = req.body || {};
    const endpoint = subscription.endpoint;
    const keys = subscription.keys;

    const forwardedUa = req.headers['x-forwarded-user-agent'];
    const userAgent = (Array.isArray(forwardedUa) ? forwardedUa[0] : forwardedUa) || req.headers['user-agent'] || null;

    const result = await upsertSubscription({ endpoint, keys, userAgent });
    return res.json({ ok: true, created: result.created, id: result.row.id });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message || 'Bad Request' });
  }
}

async function unsubscribe(req, res) {
  try {
    const { endpoint } = req.body || {};
    const result = await removeSubscription({ endpoint });
    return res.json({ ok: true, deleted: result.deleted });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message || 'Bad Request' });
  }
}

module.exports = {
  subscribe,
  unsubscribe,
};
