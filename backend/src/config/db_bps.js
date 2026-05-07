const { Sequelize } = require('sequelize');

let sequelizeBps = null;

function getSequelizeBps() {
  const DB_BPS_NAME = process.env.DB_BPS_NAME || 'data_bps';
  const DB_BPS_USER = process.env.DB_BPS_USER || process.env.DB_USER;
  const DB_BPS_PASS = process.env.DB_BPS_PASS || process.env.DB_PASS;
  const DB_BPS_HOST = process.env.DB_BPS_HOST || process.env.DB_HOST || 'localhost';

  if (!DB_BPS_USER || !DB_BPS_PASS) {
    // Best-effort: caller should treat null as "replication disabled"
    console.warn('[db_bps] Missing DB_BPS_USER/DB_BPS_PASS envs; replication will be skipped.');
    return null;
  }

  if (sequelizeBps) return sequelizeBps;

  sequelizeBps = new Sequelize(DB_BPS_NAME, DB_BPS_USER, DB_BPS_PASS, {
    host: DB_BPS_HOST,
    dialect: 'mysql',
    logging: false,
  });

  return sequelizeBps;
}

module.exports = getSequelizeBps;
