/**
 * ChatMessageFlag Model
 * Tracks problematic messages for review and learning
 */

const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const ChatMessageFlag = sequelize.define('ChatMessageFlag', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  message_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Reference to chat_messages.id',
  },
  thread_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Reference to chat_threads.id',
  },
  flag_type: {
    type: DataTypes.ENUM(
      'hallucination',      // Response contains invented data
      'wrong_data',         // Data shown was incorrect
      'irrelevant',         // Response doesn't match query
      'incomplete',         // Response missing important info
      'formatting_issue',   // Markdown/display issues
      'context_lost',       // Failed to understand follow-up
      'wrong_source',       // Used wrong datasource
      'other'
    ),
    allowNull: false,
    comment: 'Type of issue detected',
  },
  severity: {
    type: DataTypes.ENUM('low', 'medium', 'high', 'critical'),
    allowNull: false,
    defaultValue: 'medium',
    comment: 'Severity of the issue',
  },
  flagged_by: {
    type: DataTypes.ENUM('user', 'admin', 'system', 'auto'),
    allowNull: false,
    defaultValue: 'user',
    comment: 'Who flagged this message',
  },
  owner_id: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'User who flagged (malika_uid)',
  },
  user_query: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'The user query that triggered this response',
  },
  assistant_response: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'The problematic assistant response',
  },
  expected_response: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'What the correct response should be (for training)',
  },
  correction_notes: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Notes from admin about what went wrong',
  },
  resolution_status: {
    type: DataTypes.ENUM('pending', 'reviewed', 'fixed', 'ignored', 'training_added'),
    allowNull: false,
    defaultValue: 'pending',
    comment: 'Status of this flag',
  },
  resolved_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Admin user ID who resolved',
  },
  resolved_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  // Context for debugging
  context_snapshot: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: 'Snapshot of context used (datasource_id, year, etc)',
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  updated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'chat_message_flags',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['message_id'] },
    { fields: ['thread_id'] },
    { fields: ['flag_type'] },
    { fields: ['severity'] },
    { fields: ['resolution_status'] },
    { fields: ['created_at'] },
  ],
});

module.exports = ChatMessageFlag;
