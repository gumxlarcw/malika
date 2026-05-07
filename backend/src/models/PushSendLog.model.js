const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const PushSendLog = sequelize.define(
  'PushSendLog',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

    notification_id: { type: DataTypes.INTEGER, allowNull: true },
    notification_unique_key: { type: DataTypes.STRING(255), allowNull: true },
    notification_type: { type: DataTypes.STRING(50), allowNull: true },
    notification_title: { type: DataTypes.STRING(255), allowNull: true },

    trigger: { type: DataTypes.STRING(50), allowNull: false },

    sent: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    failed: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    skipped: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    tableName: 'push_send_logs',
    timestamps: false,
    freezeTableName: true,
    indexes: [{ fields: ['created_at'] }, { fields: ['notification_id'] }, { fields: ['notification_unique_key'] }],
  }
);

module.exports = PushSendLog;
