'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE retrieval_chunks (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        source_kind ENUM('datasource','knowledge_doc','knowledge_chunk','indicator_meta','chat_thread') NOT NULL,
        source_ref_id BIGINT NOT NULL,
        parent_chunk_id BIGINT NULL,
        chunk_index INT NOT NULL DEFAULT 0,
        title VARCHAR(500) NOT NULL,
        content_text MEDIUMTEXT NOT NULL,
        metadata JSON NULL,
        embedding VECTOR(768) NOT NULL,
        embedding_model VARCHAR(64) NOT NULL,
        embedding_generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_source_ref (source_kind, source_ref_id, chunk_index),
        INDEX idx_source (source_kind, source_ref_id),
        INDEX idx_parent (parent_chunk_id),
        VECTOR KEY idx_embedding (embedding) M=16 DISTANCE=cosine
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
    `);
  },
  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS retrieval_chunks;');
  }
};
