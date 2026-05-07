const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const AppSetting = sequelize.define(
  'AppSetting',
  {
    key: { type: DataTypes.STRING(191), allowNull: false, primaryKey: true },
    value_json: { type: DataTypes.TEXT('long'), allowNull: true },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    tableName: 'app_settings',
    timestamps: false,
    freezeTableName: true,
  }
);

module.exports = AppSetting;
