const { intentStats } = require('../services/search/intentStats.service');
const shadowLogger = require('../services/search/shadowLogger.service');

async function getIntentStats(req, res) {
  return res.json({ ok: true, stats: intentStats.snapshot() });
}

async function shadowSnapshot(req, res) {
  return res.json(shadowLogger.snapshot());
}

module.exports = {
  getIntentStats,
  shadowSnapshot,
};
