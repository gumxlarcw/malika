'use strict';
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query('ALTER TABLE retrieval_chunks DROP INDEX idx_embedding;');
    await queryInterface.sequelize.query('ALTER TABLE retrieval_chunks MODIFY COLUMN embedding VECTOR(1024) NOT NULL;');
    await queryInterface.sequelize.query('ALTER TABLE retrieval_chunks ADD VECTOR KEY idx_embedding (embedding) M=16 DISTANCE=cosine;');
    await queryInterface.sequelize.query('TRUNCATE TABLE retrieval_chunks;');
  },
  async down(queryInterface) {
    await queryInterface.sequelize.query('ALTER TABLE retrieval_chunks DROP INDEX idx_embedding;');
    await queryInterface.sequelize.query('ALTER TABLE retrieval_chunks MODIFY COLUMN embedding VECTOR(768) NOT NULL;');
    await queryInterface.sequelize.query('ALTER TABLE retrieval_chunks ADD VECTOR KEY idx_embedding (embedding) M=16 DISTANCE=cosine;');
  },
};
