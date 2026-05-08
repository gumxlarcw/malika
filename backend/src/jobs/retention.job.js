'use strict';
const sequelize = require('../config/db');
const logger = require('../utils/logger').child({ service: 'Retention' });

const POLICIES = [
  { table: 'fetch_logs',          days: 90,  column: 'created_at' },
  { table: 'automation_run_logs', days: 30,  column: 'created_at' },
  { table: 'admin_audit_logs',    days: 365, column: 'created_at' },
];

async function runRetention() {
  for (const p of POLICIES) {
    try {
      const [r] = await sequelize.query(
        `DELETE FROM \`${p.table}\` WHERE \`${p.column}\` < NOW() - INTERVAL ? DAY`,
        { replacements: [p.days] }
      );
      logger.info({ table: p.table, deleted: r.affectedRows, days: p.days }, 'Retention purge');
    } catch (err) {
      logger.error({ table: p.table, err: err.message }, 'Retention purge failed');
    }
  }
}

module.exports = { runRetention };
