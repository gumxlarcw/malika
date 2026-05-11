/**
 * ChatErrorPattern Model
 * Stores identified patterns of errors to prevent recurrence
 */

const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const ChatErrorPattern = sequelize.define('ChatErrorPattern', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  pattern_name: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: 'Human-readable name for this error pattern',
  },
  pattern_type: {
    type: DataTypes.ENUM(
      'query_pattern',      // Specific query patterns that cause issues
      'data_pattern',       // Data-related issues (missing, wrong source)
      'context_pattern',    // Context merging issues
      'hallucination_pattern', // Specific hallucination patterns
      'prompt_issue'        // System prompt issues
    ),
    allowNull: false,
  },
  // Query patterns that trigger this error
  trigger_keywords: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: 'Keywords/phrases that trigger this error pattern',
    get() {
      const raw = this.getDataValue('trigger_keywords');
      if (!raw) return [];
      if (Array.isArray(raw)) return raw;
      try { return JSON.parse(raw); } catch { return []; }
    },
    set(val) {
      this.setDataValue('trigger_keywords',
        Array.isArray(val) ? JSON.stringify(val) : (val || null));
    },
  },
  canonical_query: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Sample query that triggered this pattern at creation time, used by Auto Tune regression eval to verify the pattern still fires.',
  },
  trigger_regex: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Regex pattern to match problematic queries',
  },
  // What goes wrong
  error_description: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: 'Description of what goes wrong',
  },
  // How to fix it
  fix_type: {
    type: DataTypes.ENUM(
      'add_to_knowledge',   // Add info to knowledge base
      'add_to_prompt',      // Add rule to system prompt
      'special_handling',   // Add special case in code
      'data_fix',           // Fix underlying data
      'cannot_fix'          // Known limitation
    ),
    allowNull: false,
  },
  fix_content: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'The actual fix content (prompt addition, knowledge text, etc)',
  },
  // Tracking
  occurrence_count: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
    comment: 'How many times this pattern was flagged',
  },
  last_occurrence_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: 'Whether to apply this fix',
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
  tableName: 'chat_error_patterns',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['pattern_type'] },
    { fields: ['fix_type'] },
    { fields: ['is_active'] },
  ],
});

module.exports = ChatErrorPattern;
