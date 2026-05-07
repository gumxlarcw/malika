/**
 * KnowledgeBase Model
 * Stores custom knowledge documents (PDF, text) with embeddings for RAG
 */

const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const KnowledgeBase = sequelize.define("KnowledgeBase", {
    id: { 
        type: DataTypes.INTEGER, 
        primaryKey: true, 
        autoIncrement: true 
    },
    
    // Document metadata
    title: { 
        type: DataTypes.STRING(255), 
        allowNull: false,
        comment: 'Document title'
    },
    description: { 
        type: DataTypes.TEXT, 
        allowNull: true,
        comment: 'Optional description'
    },
    category: { 
        type: DataTypes.STRING(100), 
        allowNull: true,
        comment: 'Category for organization (metodologi, FAQ, etc)'
    },
    
    // Source info
    source_type: { 
        type: DataTypes.ENUM('text', 'pdf', 'url'), 
        allowNull: false, 
        defaultValue: 'text',
        comment: 'Original source type'
    },
    source_filename: { 
        type: DataTypes.STRING(255), 
        allowNull: true,
        comment: 'Original filename if uploaded'
    },
    source_url: { 
        type: DataTypes.TEXT, 
        allowNull: true,
        comment: 'Source URL if from web'
    },
    
    // Content
    content: { 
        type: DataTypes.TEXT('long'), 
        allowNull: false,
        comment: 'Extracted text content'
    },
    content_length: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Character count of content'
    },
    
    // Chunking for long documents
    chunk_index: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
        comment: 'Chunk index for split documents (0 = whole doc or first chunk)'
    },
    parent_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Parent document ID for chunks'
    },
    
    // Embedding
    embedding: {
        type: DataTypes.TEXT('long'),
        allowNull: true,
        comment: 'JSON array of 1536 floats (text-embedding-3-small)'
    },
    embedding_updated_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'When embedding was last generated'
    },
    
    // Status
    status: { 
        type: DataTypes.ENUM('pending', 'processing', 'ready', 'error'), 
        allowNull: false, 
        defaultValue: 'pending',
        comment: 'Processing status'
    },
    error_message: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Error message if processing failed'
    },
    
    // Metadata
    created_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'User ID who created this'
    },
    
    created_at: { type: DataTypes.DATE, allowNull: true },
    updated_at: { type: DataTypes.DATE, allowNull: true },
}, {
    tableName: "knowledge_base",
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    freezeTableName: true
});

module.exports = KnowledgeBase;
