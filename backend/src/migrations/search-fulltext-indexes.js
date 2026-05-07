'use strict';

const sequelize = require('../config/db');

// Canonical Indonesian stopword list — mirrors searchTermIndex.service.js STOPWORDS.
// Kept here as a module-local constant to avoid circular imports during migration phase.
// If searchTermIndex's STOPWORDS diverges, run ensureSearchFullTextIndexes to resync.
const INDONESIAN_STOPWORDS = [
  'dan', 'atau', 'yang', 'dengan', 'untuk', 'pada', 'di', 'ke', 'dari',
  'menurut', 'berdasarkan', 'per', 'tahun', 'bulan', 'seperti', 'juga',
  'ini', 'itu', 'adalah', 'akan', 'sudah', 'belum', 'oleh', 'bagi',
  'telah', 'ada', 'tidak', 'bukan', 'atas', 'bawah', 'dalam', 'luar',
];

async function indexExists(tableName, indexName) {
  const [rows] = await sequelize.query(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND INDEX_NAME = :i LIMIT 1`,
    { replacements: { t: tableName, i: indexName } }
  );
  return rows.length > 0;
}

async function tableExists(tableName) {
  const [rows] = await sequelize.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t LIMIT 1`,
    { replacements: { t: tableName } }
  );
  return rows.length > 0;
}

async function ensureStopwordsTable() {
  if (!(await tableExists('innodb_ft_stopwords'))) {
    await sequelize.query(`
      CREATE TABLE innodb_ft_stopwords (
        value VARCHAR(255) NOT NULL PRIMARY KEY
      ) ENGINE=InnoDB
    `);
  }
  // Upsert stopwords — safe to re-run.
  for (const w of INDONESIAN_STOPWORDS) {
    await sequelize.query(
      `INSERT INTO innodb_ft_stopwords (value) VALUES (:v) ON DUPLICATE KEY UPDATE value = value`,
      { replacements: { v: w } }
    );
  }
  // Direct the InnoDB FT engine at our table. Set server variable for the session;
  // persistent config must be done in my.cnf by an operator (one-time manual step documented in the runbook).
  try {
    await sequelize.query(
      `SET GLOBAL innodb_ft_user_stopword_table = 'project_data_strategis/innodb_ft_stopwords'`
    );
  } catch (e) {
    // Some environments won't allow SET GLOBAL; log and continue — default stoplist still works,
    // stopwords table just isn't active. Operator must persist in my.cnf.
    console.warn('[migrations] Could not SET GLOBAL innodb_ft_user_stopword_table:', e?.message || String(e));
  }
}

async function ensureSearchFullTextIndexes() {
  if (!(await indexExists('data_sources', 'ft_data_sources_name'))) {
    await sequelize.query(`ALTER TABLE data_sources ADD FULLTEXT INDEX ft_data_sources_name (name)`);
  }
  if (!(await indexExists('data_sources', 'ft_data_sources_desc'))) {
    await sequelize.query(`ALTER TABLE data_sources ADD FULLTEXT INDEX ft_data_sources_desc (description)`);
  }
  if (!(await indexExists('data_source_search_terms', 'ft_search_terms_term'))) {
    await sequelize.query(`ALTER TABLE data_source_search_terms ADD FULLTEXT INDEX ft_search_terms_term (term)`);
  }
  await ensureStopwordsTable();
}

module.exports = { ensureSearchFullTextIndexes, INDONESIAN_STOPWORDS };
