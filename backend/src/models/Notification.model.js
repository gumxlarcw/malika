const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Notification = sequelize.define(
  'Notification',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    type: { type: DataTypes.STRING(50), allowNull: false },
    title: { type: DataTypes.STRING(255), allowNull: false },
    message: { type: DataTypes.TEXT('long'), allowNull: true },
    link: { type: DataTypes.STRING(500), allowNull: true },
    unique_key: { type: DataTypes.STRING(255), allowNull: false },
    metadata_json: { type: DataTypes.TEXT('long'), allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false },
  },
  {
    tableName: 'app_notifications',
    timestamps: false,
    freezeTableName: true,
    indexes: [{ unique: true, fields: ['unique_key'] }],
  }
);

module.exports = Notification;
