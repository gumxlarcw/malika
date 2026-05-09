'use strict';
/**
 * Phase 5.3 (BPS data integrity): backfill missing secondary indexes on indikator_1..20.
 *
 * The 20 oldest indikator tables were created before ensureIndicatorTable()
 * gained idx_dim_hash and idx_hs2; the existing-table branch never adds
 * missing indexes. This migration converges the index set across all 310
 * tables. Tables 1-3 also missed idx_dim.
 */
const TABLES_NEEDING_DIM_HASH = Array.from({length: 20}, (_, i) => `indikator_${i+1}`);
const TABLES_NEEDING_DIM = ['indikator_1', 'indikator_2', 'indikator_3'];

module.exports = {
  async up(queryInterface) {
    let added = 0;
    for (const t of TABLES_NEEDING_DIM_HASH) {
      try {
        await queryInterface.sequelize.query(`ALTER TABLE data_bps.\`${t}\` ADD INDEX idx_dim_hash (dim_hash);`);
        added++;
      } catch (err) { /* index may exist */ }
      try {
        await queryInterface.sequelize.query(`ALTER TABLE data_bps.\`${t}\` ADD INDEX idx_hs2 (hs2);`);
        added++;
      } catch (err) { /* */ }
    }
    for (const t of TABLES_NEEDING_DIM) {
      try {
        await queryInterface.sequelize.query(`ALTER TABLE data_bps.\`${t}\` ADD INDEX idx_dim (dim_value);`);
        added++;
      } catch (err) { /* */ }
    }
    console.log(`[idx] added=${added} of ${TABLES_NEEDING_DIM_HASH.length * 2 + TABLES_NEEDING_DIM.length} potential`);
  },
  async down(queryInterface) {
    for (const t of TABLES_NEEDING_DIM_HASH) {
      try { await queryInterface.sequelize.query(`ALTER TABLE data_bps.\`${t}\` DROP INDEX idx_dim_hash;`); } catch (e) {}
      try { await queryInterface.sequelize.query(`ALTER TABLE data_bps.\`${t}\` DROP INDEX idx_hs2;`); } catch (e) {}
    }
    for (const t of TABLES_NEEDING_DIM) {
      try { await queryInterface.sequelize.query(`ALTER TABLE data_bps.\`${t}\` DROP INDEX idx_dim;`); } catch (e) {}
    }
  },
};
