/**
 * Models Index
 * Exports all Sequelize models for easy importing
 */

const sequelize = require('../config/db');

// Load and export all models
module.exports = {
  sequelize,
  
  // User & Auth
  User: require('./User.model'),
  
  // DataSource & Cache
  DataSource: require('./DataSource.model'),
  DataPeriod: require('./DataPeriod.model'),
  ProcessedCache: require('./ProcessedCache.model'),
  MergedCache: require('./MergedCache.model'),
  FetchLog: require('./FetchLog.model'),
  
  // Automation
  AutomationConfig: require('./AutomationConfig.model'),
  AutomationRunLog: require('./AutomationRunLog.model'),
  
  // EXIM
  EximPodFilter: require('./EximPodFilter.model'),
  
  // Notifications
  Notification: require('./Notification.model'),
  PushSubscription: require('./PushSubscription.model'),
  PushSendLog: require('./PushSendLog.model'),
  
  // Settings & Search
  AppSetting: require('./AppSetting.model'),
  DataSourceSearchTerm: require('./DataSourceSearchTerm.model'),
  SearchStat: require('./SearchStat.model'),
  
  // Chat
  ChatThread: require('./ChatThread.model'),
  ChatMessage: require('./ChatMessage.model'),
  ChatFeedback: require('./ChatFeedback.model'),
  ChatMessageFlag: require('./ChatMessageFlag.model'),
  ChatErrorPattern: require('./ChatErrorPattern.model'),
  UserMemory: require('./UserMemory.model'),
  DnaCache: require('./DnaCache.model'),

  // Sessions / Activity
  ActiveSession: require('./ActiveSession.model'),
  PageView: require('./PageView.model'),

  // Knowledge Base / RAG
  KnowledgeBase: require('./KnowledgeBase.model'),
  IndexedBrsPublikasi: require('./IndexedBrsPublikasi.model'),

  // Indicator metadata
  IndicatorMeta: require('./IndicatorMeta.model'),
  IndicatorMetricMeta: require('./IndicatorMetricMeta.model'),

  // Unified Retrieval (Phase C: replaces in-memory HNSW + JSON-text scan)
  RetrievalChunk: require('./RetrievalChunk.model'),

  // Audit Logs
  AdminAuditLog: require('./AdminAuditLog.model'),
};
