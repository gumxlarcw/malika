/**
 * UserMemory Model
 * 
 * Persistent per-user memory system (OpenClaw-inspired).
 * Stores extracted facts, preferences, and context from conversations.
 * 
 * Types:
 *   - fact:       Learned fact about user (e.g., "works at BPS Halmahera Utara")
 *   - preference: User preference (e.g., "prefers data in percentage format")
 *   - topic:      Frequently discussed topic (e.g., "kemiskinan", "inflasi")
 *   - region:     User's region of interest (e.g., "Kota Ternate")
 */

'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const UserMemory = sequelize.define('UserMemory', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  owner_id: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: 'User identifier (same as chat_threads.owner_id)',
  },
  type: {
    type: DataTypes.ENUM('fact', 'preference', 'topic', 'region'),
    allowNull: false,
    defaultValue: 'fact',
  },
  key: {
    type: DataTypes.STRING(191),
    allowNull: false,
    comment: 'Memory key for deduplication (e.g., "region_interest", "preferred_format")',
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: 'The memory content / fact text',
  },
  confidence: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 0.7,
    comment: 'Confidence score 0-1 (increases with repetition)',
  },
  source_thread_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Thread where this memory was first extracted',
  },
  hit_count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
    comment: 'How many times this memory was reinforced',
  },
  last_accessed_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Last time this memory was used in a prompt',
  },
  expires_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Optional expiration (null = permanent)',
  },
  embedding: {
    type: DataTypes.TEXT('long'),
    allowNull: true,
    comment: 'JSON array of 1536-dim vector for semantic search',
  },
  created_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  updated_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'user_memory',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  freezeTableName: true,
  indexes: [
    { fields: ['owner_id'] },
    { fields: ['owner_id', 'type'] },
    { unique: true, fields: ['owner_id', 'key'], name: 'uq_user_memory_owner_key' },
    { fields: ['expires_at'] },
  ],
});

module.exports = UserMemory;
