const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

// Tracks popularity of datasources in the UI search dropdown.
// Counts are incremented when a user clicks a datasource suggestion.
const SearchStat = sequelize.define(
  'SearchStat',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    source_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
    },
    search_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    last_searched_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: 'data_search_stats',
    timestamps: true,
    underscored: true,
    indexes: [
      { unique: true, fields: ['source_id'] },
      { fields: ['search_count'] },
      { fields: ['last_searched_at'] },
    ],
  }
);

module.exports = SearchStat;
