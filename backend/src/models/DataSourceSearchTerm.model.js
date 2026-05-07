const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const DataSourceSearchTerm = sequelize.define(
  'DataSourceSearchTerm',
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
    source_id: { type: DataTypes.INTEGER, allowNull: false },
    kind: { type: DataTypes.STRING(32), allowNull: false },
    term: { type: DataTypes.STRING(255), allowNull: false },
    term_norm: { type: DataTypes.STRING(255), allowNull: false },
    weight: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    created_at: { type: DataTypes.DATE, allowNull: true },
    updated_at: { type: DataTypes.DATE, allowNull: true },
  },
  {
    tableName: 'data_source_search_terms',
    timestamps: false,
    freezeTableName: true,
    indexes: [
      { unique: true, fields: ['source_id', 'kind', 'term_norm'], name: 'uniq_source_kind_term' },
      { fields: ['term_norm'], name: 'idx_term_norm' },
      { fields: ['source_id'], name: 'idx_source_id' },
    ],
  }
);

module.exports = DataSourceSearchTerm;
