const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

// Stores per-indicator EXIM POD allowlist for production replication (data_bps.indikator_<id>).
// This is intentionally separate from automation_configs to avoid altering that table.
const EximPodFilter = sequelize.define(
  'EximPodFilter',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    source_id: { type: DataTypes.INTEGER, allowNull: false },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    pods_json: { type: DataTypes.TEXT('long'), allowNull: true },
    updated_at: { type: DataTypes.DATE, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: true },
  },
  {
    tableName: 'exim_pod_filters',
    timestamps: false,
    freezeTableName: true,
    indexes: [{ unique: true, fields: ['source_id'] }],
  }
);

module.exports = EximPodFilter;
