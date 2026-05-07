const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const MergedCache = sequelize.define('MergedCache', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  source_id: { type: DataTypes.INTEGER, allowNull: false },
  signature: { type: DataTypes.STRING(255), allowNull: false }, // e.g., 'all' or '124,125'
  merged_json: { type: DataTypes.TEXT('long'), allowNull: false },
  last_update: { type: DataTypes.DATE, allowNull: false },
  created_at: { type: DataTypes.DATE, allowNull: true },
  updated_at: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'data_merged_cache',
  timestamps: false,
  freezeTableName: true,
  indexes: [
    { unique: true, fields: ['source_id', 'signature'] }
  ],
});

module.exports = MergedCache;
