const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

// Stores per-indicator automation toggle & last run status.
const AutomationConfig = sequelize.define('AutomationConfig', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  source_id: { type: DataTypes.INTEGER, allowNull: false },
  enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  mode: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'daily' }, // 'daily' | 'smart'

  last_run_at: { type: DataTypes.DATE, allowNull: true },
  last_success_at: { type: DataTypes.DATE, allowNull: true },
  last_pull_started_at: { type: DataTypes.DATE, allowNull: true },
  last_pull_finished_at: { type: DataTypes.DATE, allowNull: true },
  last_bps_last_update: { type: DataTypes.DATE, allowNull: true },
  last_signature: { type: DataTypes.STRING(255), allowNull: true },
  last_error: { type: DataTypes.TEXT('long'), allowNull: true },

  created_at: { type: DataTypes.DATE, allowNull: true },
  updated_at: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'automation_configs',
  timestamps: false,
  freezeTableName: true,
  indexes: [
    { unique: true, fields: ['source_id'] },
    { fields: ['enabled'] },
  ],
});

module.exports = AutomationConfig;
