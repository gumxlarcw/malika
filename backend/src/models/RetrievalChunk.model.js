const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const SOURCE_KINDS = ['datasource', 'knowledge_doc', 'knowledge_chunk', 'indicator_meta', 'chat_thread'];

const RetrievalChunk = sequelize.define('RetrievalChunk', {
  id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
  source_kind: { type: DataTypes.ENUM.apply(null, SOURCE_KINDS), allowNull: false },
  source_ref_id: { type: DataTypes.BIGINT, allowNull: false },
  parent_chunk_id: { type: DataTypes.BIGINT, allowNull: true },
  chunk_index: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  title: { type: DataTypes.STRING(500), allowNull: false },
  content_text: { type: DataTypes.TEXT('medium'), allowNull: false },
  metadata: { type: DataTypes.JSON, allowNull: true },
  embedding: { type: DataTypes.TEXT('long'), allowNull: false }, // VECTOR not natively typed in Sequelize 6; cast at write via VEC_FromText()
  embedding_model: { type: DataTypes.STRING(64), allowNull: false },
  embedding_generated_at: { type: DataTypes.DATE, allowNull: false },
  created_at: { type: DataTypes.DATE, allowNull: true },
  updated_at: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'retrieval_chunks',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  freezeTableName: true,
});

RetrievalChunk.SOURCE_KINDS = SOURCE_KINDS;

module.exports = RetrievalChunk;
