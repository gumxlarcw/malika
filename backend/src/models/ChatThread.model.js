const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const ChatThread = sequelize.define(
  'ChatThread',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    owner_id: { type: DataTypes.STRING(100), allowNull: false },
    title: { type: DataTypes.STRING(255), allowNull: false },
    topics: { type: DataTypes.JSON, allowNull: true, defaultValue: null },
    summary: { type: DataTypes.TEXT('long'), allowNull: true },
    last_message_at: { type: DataTypes.DATE, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    tableName: 'chat_threads',
    timestamps: false,
    freezeTableName: true,
    indexes: [
      { fields: ['owner_id'] },
      { fields: ['last_message_at'] },
    ],
  }
);

module.exports = ChatThread;
