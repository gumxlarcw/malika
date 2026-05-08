const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const DataSource = sequelize.define("DataSource", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(150), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    aliases: { type: DataTypes.TEXT, allowNull: true },
    type: { type: DataTypes.ENUM("static", "dynamic", "interop", "exim", "pressrelease"), allowNull: false },
    api_url: { type: DataTypes.TEXT, allowNull: false },
    period_key: { type: DataTypes.STRING(100), allowNull: true },

    summary_trend: {
        type: DataTypes.TEXT,
        allowNull: true,
    },

    auto_period: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
    status: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: true },

    visible: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: true },
    display_order: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    icon: { type: DataTypes.STRING(50), allowNull: true },
    color: { type: DataTypes.STRING(20), allowNull: true },
    category: { type: DataTypes.STRING(100), allowNull: true },
    compare_to: { type: DataTypes.INTEGER, allowNull: true },
    chart_config: { 
        type: DataTypes.JSON, 
        allowNull: true,
        comment: 'Chart configuration for PWA visualization'
    },

    // RAG / Embedding fields
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

    bps_web_url: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: 'Direct link to BPS web page'
    },
    priority: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 3,
        comment: 'Display priority (lower = higher importance)'
    },
    bps_last_metadata_fetch: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Last successful BPS metadata fetch timestamp'
    },
    bps_last_metadata_status: {
        type: DataTypes.STRING(50),
        allowNull: true,
        comment: 'Last metadata fetch outcome (success | error | skipped)'
    },

    created_at: { type: DataTypes.DATE, allowNull: true },
    updated_at: { type: DataTypes.DATE, allowNull: true },
}, {
    tableName: "data_sources",
    timestamps: false,
    freezeTableName: true
});

module.exports = DataSource;
