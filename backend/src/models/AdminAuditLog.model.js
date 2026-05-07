const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const AdminAuditLog = sequelize.define('AdminAuditLog', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  user_email: { type: DataTypes.STRING(255), allowNull: true },
  user_role: { type: DataTypes.STRING(50), allowNull: true },
  action: { type: DataTypes.STRING(20), allowNull: false },
  resource: { type: DataTypes.STRING(100), allowNull: true },
  method: { type: DataTypes.STRING(10), allowNull: false },
  path: { type: DataTypes.TEXT, allowNull: false },
  ip: { type: DataTypes.STRING(64), allowNull: true },
  user_agent: { type: DataTypes.TEXT, allowNull: true },
  status_code: { type: DataTypes.INTEGER, allowNull: true },
  duration_ms: { type: DataTypes.INTEGER, allowNull: true },
  request_body: { type: DataTypes.TEXT('long'), allowNull: true },
  request_query: { type: DataTypes.TEXT('long'), allowNull: true },
  request_params: { type: DataTypes.TEXT('long'), allowNull: true },
  created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
  tableName: 'admin_audit_logs',
  timestamps: false,
  freezeTableName: true,
  indexes: [
    { fields: ['user_id'] },
    { fields: ['created_at'] },
    { fields: ['resource'] },
  ],
});

module.exports = AdminAuditLog;
