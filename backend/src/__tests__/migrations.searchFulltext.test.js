'use strict';

const sequelize = require('../config/db');
const { ensureSearchFullTextIndexes } = require('../migrations/search-fulltext-indexes');

const runDb = process.env.SKIP_DB_TESTS !== '1';

(runDb ? describe : describe.skip)('ensureSearchFullTextIndexes', () => {
  afterAll(async () => {
    await sequelize.close();
  });

  test('creates FULLTEXT index on data_sources(name)', async () => {
    await ensureSearchFullTextIndexes();
    const [rows] = await sequelize.query(`
      SELECT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'data_sources'
        AND INDEX_NAME = 'ft_data_sources_name'
      LIMIT 1
    `);
    expect(rows.length).toBe(1);
  });

  test('creates FULLTEXT index on data_sources(description)', async () => {
    await ensureSearchFullTextIndexes();
    const [rows] = await sequelize.query(`
      SELECT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'data_sources'
        AND INDEX_NAME = 'ft_data_sources_desc'
      LIMIT 1
    `);
    expect(rows.length).toBe(1);
  });

  test('creates FULLTEXT index on data_source_search_terms(term)', async () => {
    await ensureSearchFullTextIndexes();
    const [rows] = await sequelize.query(`
      SELECT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'data_source_search_terms'
        AND INDEX_NAME = 'ft_search_terms_term'
      LIMIT 1
    `);
    expect(rows.length).toBe(1);
  });

  test('creates innodb_ft_stopwords table and populates with Indonesian stopwords', async () => {
    await ensureSearchFullTextIndexes();
    const [rows] = await sequelize.query(
      `SELECT COUNT(*) AS n FROM innodb_ft_stopwords WHERE value IN ('di', 'dan', 'yang')`
    );
    expect(Number(rows[0].n)).toBeGreaterThanOrEqual(3);
  });

  test('is idempotent — running twice does not error', async () => {
    await expect(ensureSearchFullTextIndexes()).resolves.not.toThrow();
    await expect(ensureSearchFullTextIndexes()).resolves.not.toThrow();
  });
});
