const webpush = require('web-push');
const PushSubscription = require('../../models/PushSubscription.model');

function getVapidConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

function configureWebPushIfPossible() {
  const cfg = getVapidConfig();
  if (!cfg) return { configured: false, publicKey: null };

  webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
  return { configured: true, publicKey: cfg.publicKey };
}

async function upsertSubscription({ endpoint, keys, userAgent }) {
  if (!endpoint) throw new Error('endpoint is required');

  const p256dh = keys && keys.p256dh ? String(keys.p256dh) : null;
  const auth = keys && keys.auth ? String(keys.auth) : null;

  const [row, created] = await PushSubscription.findOrCreate({
    where: { endpoint: String(endpoint) },
    defaults: {
      endpoint: String(endpoint),
      p256dh,
      auth,
      user_agent: userAgent ? String(userAgent) : null,
      created_at: new Date(),
      updated_at: new Date(),
    },
  });

  if (!created) {
    row.p256dh = p256dh;
    row.auth = auth;
    row.user_agent = userAgent ? String(userAgent) : row.user_agent;
    row.updated_at = new Date();
    await row.save();
  }

  return { row, created };
}

async function removeSubscription({ endpoint }) {
  if (!endpoint) throw new Error('endpoint is required');
  const count = await PushSubscription.destroy({ where: { endpoint: String(endpoint) } });
  return { deleted: count };
}

async function broadcastPush({ title, body, url, tag }) {
  const cfg = configureWebPushIfPossible();
  if (!cfg.configured) return { sent: 0, failed: 0, skipped: true };

  const rows = await PushSubscription.findAll({
    order: [['id', 'DESC']],
    limit: 2000,
  });

  const payload = JSON.stringify({
    title: title || 'Notifikasi',
    body: body || '',
    url: url || '/notifications',
    tag: tag || null,
  });

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    const subscription = {
      endpoint: row.endpoint,
      keys: {
        p256dh: row.p256dh,
        auth: row.auth,
      },
    };

    try {
      await webpush.sendNotification(subscription, payload);
      sent += 1;
    } catch (err) {
      failed += 1;

      const statusCode = err && (err.statusCode || err.status);
      if (statusCode === 404 || statusCode === 410) {
        try {
          await PushSubscription.destroy({ where: { endpoint: row.endpoint } });
        } catch {
          // ignore
        }
      }
    }
  }

  return { sent, failed, skipped: false };
}

module.exports = {
  getVapidConfig,
  configureWebPushIfPossible,
  upsertSubscription,
  removeSubscription,
  broadcastPush,
};
