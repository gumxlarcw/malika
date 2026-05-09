'use strict';
/**
 * Phase C cutover (2026-05-09): drop legacy embedding columns.
 *
 * The retrieval_chunks table (VECTOR(768) cosine HNSW, e5-base) is now the
 * canonical embedding store. Legacy per-table embedding columns are obsolete:
 *   - knowledge_base.embedding (LONGTEXT, was 3072d OpenAI / 768d Gemini)
 *   - knowledge_base.embedding_updated_at
 *   - data_sources.embedding
 *   - data_sources.embedding_updated_at
 *   - indicator_meta.embedding (was 768d Gemini, repacked into retrieval_chunks)
 *   - indicator_meta.embedding_updated_at
 *   - chat_threads.embedding (1 abandoned 1536d row, deferred)
 *
 * Preserved:
 *   - retrieval_chunks.embedding (vector, the new canonical)
 *   - indicator_metric_meta.embedding (per-metric metadata, separate use)
 *   - user_memory.embedding (per-user thread memory, separate feature)
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      'ALTER TABLE knowledge_base DROP COLUMN embedding, DROP COLUMN embedding_updated_at;'
    );
    await queryInterface.sequelize.query(
      'ALTER TABLE data_sources DROP COLUMN embedding, DROP COLUMN embedding_updated_at;'
    );
    await queryInterface.sequelize.query(
      'ALTER TABLE indicator_meta DROP COLUMN embedding, DROP COLUMN embedding_updated_at;'
    );
    await queryInterface.sequelize.query(
      'ALTER TABLE chat_threads DROP COLUMN embedding;'
    );
  },
  async down(queryInterface) {
    // Reversal re-adds nullable longtext columns. Original embedding data is lost.
    await queryInterface.sequelize.query(
      'ALTER TABLE knowledge_base ADD COLUMN embedding LONGTEXT NULL, ADD COLUMN embedding_updated_at TIMESTAMP NULL;'
    );
    await queryInterface.sequelize.query(
      'ALTER TABLE data_sources ADD COLUMN embedding LONGTEXT NULL, ADD COLUMN embedding_updated_at TIMESTAMP NULL;'
    );
    await queryInterface.sequelize.query(
      'ALTER TABLE indicator_meta ADD COLUMN embedding LONGTEXT NULL, ADD COLUMN embedding_updated_at DATETIME NULL;'
    );
    await queryInterface.sequelize.query(
      'ALTER TABLE chat_threads ADD COLUMN embedding LONGTEXT NULL;'
    );
  },
};
