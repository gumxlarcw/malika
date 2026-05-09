'use strict';
/**
 * Phase 4 (BPS data integrity): add CHECK constraints to all 310 indikator_NNN tables.
 *
 * - year: 2000-2100 (accommodates Proyeksi Penduduk projections)
 * - month_no: BPS sentinel set (0, 1-12, 31-37)
 *   - 0 = unknown / annual rollup
 *   - 1-12 = January-December (monthly)
 *   - 31-34 = Triwulan I-IV (quarterly sentinels)
 *   - 35 = Tahunan (annual sentinel)
 *   - 36-37 = semi-annual / semester (Maret/Sept for Kemiskinan)
 *
 * Note: value_code stays VARCHAR(8) (NOT enum) — locking the enum
 * would prevent future BPS additions. Document the known set in
 * frontend/src/lib/cellRender.tsx instead.
 */
module.exports = {
  async up(queryInterface) {
    const [tables] = await queryInterface.sequelize.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='data_bps' AND table_name LIKE 'indikator_%'"
    );
    let added = 0, skipped = 0;
    for (const row of tables) {
      const t = row.table_name || row.TABLE_NAME;
      try {
        await queryInterface.sequelize.query(
          `ALTER TABLE data_bps.\`${t}\` ADD CONSTRAINT chk_${t}_year CHECK (year BETWEEN 2000 AND 2100);`
        );
        await queryInterface.sequelize.query(
          `ALTER TABLE data_bps.\`${t}\` ADD CONSTRAINT chk_${t}_month CHECK (month_no IN (0,1,2,3,4,5,6,7,8,9,10,11,12,31,32,33,34,35,36,37));`
        );
        added++;
      } catch (err) {
        skipped++;
      }
    }
    console.log(`[check] added=${added} skipped=${skipped}`);
  },
  async down(queryInterface) {
    const [tables] = await queryInterface.sequelize.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='data_bps' AND table_name LIKE 'indikator_%'"
    );
    for (const row of tables) {
      const t = row.table_name || row.TABLE_NAME;
      try { await queryInterface.sequelize.query(`ALTER TABLE data_bps.\`${t}\` DROP CONSTRAINT chk_${t}_year;`); } catch (e) {}
      try { await queryInterface.sequelize.query(`ALTER TABLE data_bps.\`${t}\` DROP CONSTRAINT chk_${t}_month;`); } catch (e) {}
    }
  },
};
