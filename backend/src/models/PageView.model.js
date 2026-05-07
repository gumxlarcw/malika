const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const PageView = sequelize.define('PageView', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  session_id: {
    type: DataTypes.STRING(64),
    allowNull: false,
  },
  ip_address: {
    type: DataTypes.STRING(45),
    allowNull: true,
  },
  user_agent: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  page_path: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  referrer: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
}, {
  tableName: 'page_views',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
});

module.exports = PageView;
