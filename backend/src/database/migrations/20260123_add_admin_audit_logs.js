module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('admin_audit_logs', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      user_id: { type: Sequelize.INTEGER, allowNull: false },
      user_email: { type: Sequelize.STRING(255), allowNull: true },
      user_role: { type: Sequelize.STRING(50), allowNull: true },
      action: { type: Sequelize.STRING(20), allowNull: false },
      resource: { type: Sequelize.STRING(100), allowNull: true },
      method: { type: Sequelize.STRING(10), allowNull: false },
      path: { type: Sequelize.TEXT, allowNull: false },
      ip: { type: Sequelize.STRING(64), allowNull: true },
      user_agent: { type: Sequelize.TEXT, allowNull: true },
      status_code: { type: Sequelize.INTEGER, allowNull: true },
      duration_ms: { type: Sequelize.INTEGER, allowNull: true },
      request_body: { type: Sequelize.TEXT('long'), allowNull: true },
      request_query: { type: Sequelize.TEXT('long'), allowNull: true },
      request_params: { type: Sequelize.TEXT('long'), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addIndex('admin_audit_logs', ['user_id'], { name: 'idx_admin_audit_user' });
    await queryInterface.addIndex('admin_audit_logs', ['created_at'], { name: 'idx_admin_audit_created' });
    await queryInterface.addIndex('admin_audit_logs', ['resource'], { name: 'idx_admin_audit_resource' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('admin_audit_logs');
  },
};
