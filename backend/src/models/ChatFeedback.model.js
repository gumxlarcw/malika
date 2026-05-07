const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * ChatFeedback - User star ratings and reviews from chat sessions
 */
const ChatFeedback = sequelize.define('ChatFeedback', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  thread_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  owner_id: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'User identifier (malika_uid)',
  },
  stars: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: {
      min: 1,
      max: 5,
    },
    comment: 'Star rating 1-5',
  },
  review: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Optional text review',
  },
  thread_title: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: 'Cached thread title for display',
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'chat_feedbacks',
  timestamps: false,
  indexes: [
    { fields: ['thread_id'] },
    { fields: ['owner_id'] },
    { fields: ['stars'] },
    { fields: ['created_at'] },
  ],
});

module.exports = ChatFeedback;
