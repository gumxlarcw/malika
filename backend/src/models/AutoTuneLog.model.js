const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const AutoTuneLog = sequelize.define('AutoTuneLog', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  flag_id: { type: DataTypes.INTEGER, allowNull: false },
  job_id: { type: DataTypes.STRING(64), allowNull: false, unique: true },
  model_used: { type: DataTypes.STRING(128), allowNull: true },
  total_input_tokens: { type: DataTypes.INTEGER, defaultValue: 0 },
  total_output_tokens: { type: DataTypes.INTEGER, defaultValue: 0 },
  cost_usd: { type: DataTypes.DECIMAL(10, 4), defaultValue: 0 },
  proposed_changes: {
    type: DataTypes.TEXT('long'),
    allowNull: true,
    get() {
      const raw = this.getDataValue('proposed_changes');
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    },
    set(val) { this.setDataValue('proposed_changes', val ? JSON.stringify(val) : null); },
  },
  regression_result: {
    type: DataTypes.TEXT('long'),
    allowNull: true,
    get() {
      const raw = this.getDataValue('regression_result');
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    },
    set(val) { this.setDataValue('regression_result', val ? JSON.stringify(val) : null); },
  },
  final_status: {
    type: DataTypes.ENUM('queued', 'running', 'committed', 'abandoned', 'failed', 'regression_failed'),
    defaultValue: 'queued',
  },
  abandon_reason: { type: DataTypes.TEXT, allowNull: true },
  tool_call_log: {
    type: DataTypes.TEXT('long'),
    allowNull: true,
    get() {
      const raw = this.getDataValue('tool_call_log');
      if (!raw) return [];
      try { return JSON.parse(raw); } catch { return []; }
    },
    set(val) { this.setDataValue('tool_call_log', val ? JSON.stringify(val) : null); },
  },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  completed_at: { type: DataTypes.DATE, allowNull: true },
  duration_ms: { type: DataTypes.INTEGER, allowNull: true },
}, {
  tableName: 'auto_tune_logs',
  timestamps: false,
});

module.exports = AutoTuneLog;
