const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

// Stores last execution logs per indicator (manual run / scheduler).
const AutomationRunLog = sequelize.define('AutomationRunLog', {
  id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
  source_id: { type: DataTypes.INTEGER, allowNull: false },
  mode: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'daily' },
  ok: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  started_at: { type: DataTypes.DATE, allowNull: true },
  finished_at: { type: DataTypes.DATE, allowNull: true },
  error: { type: DataTypes.TEXT('long'), allowNull: true },
  logs: { type: DataTypes.TEXT('long'), allowNull: true },
  created_at: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'automation_run_logs',
  timestamps: false,
  freezeTableName: true,
  indexes: [
    { fields: ['source_id'] },
    { fields: ['created_at'] },
  ],
});

module.exports = AutomationRunLog;
