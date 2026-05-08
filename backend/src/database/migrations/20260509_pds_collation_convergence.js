'use strict';
/**
 * Phase D2: converge PDS legacy tables from utf8mb4_general_ci
 * to utf8mb4_uca1400_ai_ci. Eliminates cross-collation JOIN hazard
 * within the project_data_strategis schema.
 *
 * Each ALTER rewrites the table — brief lock per table. Largest are
 * user_memory (~148 MB) and chat_messages (~55 MB), expected to take
 * a few seconds each.
 *
 * Down() is a NOOP — manual rollback only since the legacy collation
 * was the wrong target.
 */
const LEGACY_TABLES = [
  'active_sessions',
  'admin_audit_logs',
  'app_notifications',
  'automation_configs',
  'automation_run_logs',
  'chat_error_patterns',
  'chat_feedbacks',
  'chat_messages',
  'chat_message_flags',
  'chat_threads',
  'data_search_stats',
  'data_source_search_terms',
  'dna_cache',
  'exim_pod_filters',
  'indexed_brs_publikasi',
  'innodb_ft_stopwords',
  'page_views',
  'push_send_logs',
  'push_subscriptions',
  'user_memory',
  'users',
];

module.exports = {
  async up(queryInterface) {
    for (const t of LEGACY_TABLES) {
      try {
        await queryInterface.sequelize.query(
          `ALTER TABLE \`${t}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;`
        );
        console.log(`[collation] converged ${t}`);
      } catch (err) {
        console.warn(`[collation] skip ${t}: ${err.message}`);
      }
    }
  },
  async down() {
    /* irreversible — manual rollback only */
  },
};
