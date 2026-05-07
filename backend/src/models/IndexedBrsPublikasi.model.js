/**
 * IndexedBrsPublikasi Model
 * Tracks which BRS and Publications have been indexed to Knowledge Base
 */

const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const IndexedBrsPublikasi = sequelize.define('IndexedBrsPublikasi', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    // BRS or Publication
    doc_type: {
      type: DataTypes.ENUM('brs', 'publication'),
      allowNull: false,
    },
    // Original ID from BPS API (string for publications, numeric for BRS)
    external_id: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    // Document title
    title: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    // Release date from BPS
    release_date: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    // Year for filtering
    year: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    // Indexing mode used
    index_mode: {
      type: DataTypes.ENUM('abstract', 'abstract+pdf', 'abstract+ocr'),
      allowNull: false,
      defaultValue: 'abstract',
    },
    // Reference to knowledge_base.id
    knowledge_doc_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    // Content length indexed
    content_length: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    // Status
    status: {
      type: DataTypes.ENUM('success', 'error'),
      allowNull: false,
      defaultValue: 'success',
    },
    // Error message if failed
    error_message: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // PDF URL for reference
    pdf_url: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  }, {
    tableName: 'indexed_brs_publikasi',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        unique: true,
        fields: ['doc_type', 'external_id'],
        name: 'idx_doctype_extid',
      },
      {
        fields: ['year'],
        name: 'idx_year',
      },
      {
        fields: ['status'],
        name: 'idx_status',
      },
    ],
  });

module.exports = IndexedBrsPublikasi;
