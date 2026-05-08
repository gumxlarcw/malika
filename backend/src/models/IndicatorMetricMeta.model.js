/**
 * IndicatorMetricMeta Model
 * Mirrors live `indicator_metric_meta` table — per-metric (column) metadata under each indicator.
 * Composite uniqueness: (source_id, metric_key).
 * source_id references indicator_meta.source_id by convention (FK not enforced at DB level).
 * embedding column is longtext storing 768-dim Gemini vectors as JSON text.
 */

const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const IndicatorMetricMeta = sequelize.define("IndicatorMetricMeta", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    source_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: 'References indicator_meta.source_id (FK not enforced at DB level)'
    },
    metric_key: {
        type: DataTypes.STRING(255),
        allowNull: false,
        comment: 'Unique within source_id (composite unique index)'
    },
    bps_column_id: { type: DataTypes.STRING(64), allowNull: true },
    metric_label_id: { type: DataTypes.STRING(255), allowNull: true },
    metric_label_en: { type: DataTypes.STRING(255), allowNull: true },
    metric_type: {
        type: DataTypes.ENUM('numeric', 'text', 'percent', 'currency', 'count', 'weight', 'area', 'index'),
        allowNull: true,
        defaultValue: 'numeric'
    },
    unit_id: { type: DataTypes.STRING(64), allowNull: true },
    unit_en: { type: DataTypes.STRING(64), allowNull: true },
    unit_multiplier: { type: DataTypes.TINYINT, allowNull: true },
    unit_multiplier_desc: { type: DataTypes.STRING(32), allowNull: true },
    decimal_places: {
        type: DataTypes.TINYINT,
        allowNull: true,
        defaultValue: 0
    },
    definition: { type: DataTypes.TEXT, allowNull: true },
    utility: { type: DataTypes.TEXT, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    interpretation: { type: DataTypes.TEXT, allowNull: true },
    formula_html: { type: DataTypes.TEXT, allowNull: true },
    formula_components: { type: DataTypes.TEXT('long'), allowNull: true },
    cutoff_date: { type: DataTypes.DATEONLY, allowNull: true },
    flat_text: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Concatenated searchable text (FULLTEXT index)'
    },
    embedding: {
        type: DataTypes.TEXT('long'),
        allowNull: true,
        comment: 'JSON array of 768 floats (Gemini text-embedding-004)'
    },
    embedding_updated_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'When embedding was last generated'
    },
}, {
    tableName: "indicator_metric_meta",
    timestamps: false,
    freezeTableName: true,
    indexes: [
        { unique: true, name: 'uniq_source_metric', fields: ['source_id', 'metric_key'] },
        { name: 'idx_source', fields: ['source_id'] },
    ]
});

module.exports = IndicatorMetricMeta;
