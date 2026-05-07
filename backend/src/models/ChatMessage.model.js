const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const ChatMessage = sequelize.define(
  'ChatMessage',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    thread_id: { type: DataTypes.INTEGER, allowNull: false },
    role: { type: DataTypes.ENUM('system', 'user', 'assistant'), allowNull: false },
    content: { type: DataTypes.TEXT('long'), allowNull: false },
    model: { type: DataTypes.STRING(80), allowNull: true },
    tokens_in: { type: DataTypes.INTEGER, allowNull: true },
    tokens_out: { type: DataTypes.INTEGER, allowNull: true },
    latency_ms: { type: DataTypes.INTEGER, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    tableName: 'chat_messages',
    timestamps: false,
    freezeTableName: true,
    indexes: [{ fields: ['thread_id'] }, { fields: ['created_at'] }],
  }
);

module.exports = ChatMessage;
