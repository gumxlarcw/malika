module.exports = {
  async up(queryInterface) {
    await queryInterface.addIndex(
      'data_processed_cache',
      ['source_id', 'period_value'],
      { name: 'idx_cache_source_period' }
    );

    await queryInterface.addIndex(
      'chat_messages',
      ['thread_id', 'created_at'],
      { name: 'idx_chat_thread_created' }
    );

    await queryInterface.addIndex(
      'data_sources',
      ['name', 'aliases'],
      { name: 'idx_datasources_name_aliases_fulltext', type: 'FULLTEXT' }
    );

    await queryInterface.addIndex(
      'knowledge_base',
      ['source_type', 'created_at'],
      { name: 'idx_knowledge_type_created' }
    );
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('knowledge_base', 'idx_knowledge_type_created');
    await queryInterface.removeIndex('data_sources', 'idx_datasources_name_aliases_fulltext');
    await queryInterface.removeIndex('chat_messages', 'idx_chat_thread_created');
    await queryInterface.removeIndex('data_processed_cache', 'idx_cache_source_period');
  },
};
