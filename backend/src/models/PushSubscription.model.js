const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const PushSubscription = sequelize.define(
  'PushSubscription',
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    endpoint: {
      type: DataTypes.TEXT,
      allowNull: false,
      unique: true,
    },
    p256dh: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    auth: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    user_agent: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: 'push_subscriptions',
    timestamps: false,
  }
);

module.exports = PushSubscription;
