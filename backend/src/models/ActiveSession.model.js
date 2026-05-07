const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const ActiveSession = sequelize.define('ActiveSession', {
  session_id: {
    type: DataTypes.STRING(64),
    primaryKey: true,
  },
  ip_address: {
    type: DataTypes.STRING(45),
    allowNull: true,
  },
  user_agent: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  last_seen_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  first_seen_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  page_count: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
  },
  last_page: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
}, {
  tableName: 'active_sessions',
  timestamps: false,
});

module.exports = ActiveSession;
