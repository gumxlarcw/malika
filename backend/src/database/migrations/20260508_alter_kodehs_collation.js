'use strict';
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      'ALTER TABLE data_bps.kodehs_indd CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;'
    );
  },
  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'ALTER TABLE data_bps.kodehs_indd CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;'
    );
  },
};
