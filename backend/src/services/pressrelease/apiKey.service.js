const DataSource = require('../../models/DataSource.model');
const { Op } = require('sequelize');

async function resolveBpsApiKey() {
  const direct =
    (process.env.BPS_API_KEY && String(process.env.BPS_API_KEY).trim()) ||
    (process.env.API_KEY && String(process.env.API_KEY).trim()) ||
    (process.env.BPS_KEY && String(process.env.BPS_KEY).trim());

  if (direct) return String(direct).trim();

  // Fallback: many existing datasources already store the BPS key in api_url.
  // Example: .../key/<api_key> (may or may not end with a slash)
  const any = await DataSource.findOne({
    where: {
      api_url: {
        [Op.like]: '%/key/%',
      },
    },
    order: [['id', 'ASC']],
  });

  const url = String(any?.api_url || '');
  const m1 = url.match(/\/key\/([^/]+)(?:\/|$)/i);
  if (m1?.[1]) return m1[1];

  const m2 = url.match(/(?:\?|&)key=([^&/]+)/i);
  if (m2?.[1]) return m2[1];

  return null;
}

module.exports = {
  resolveBpsApiKey,
};
