/**
 * IndicatorMeta Model
 * Mirrors live `indicator_meta` table — BPS indicator-level metadata snapshot.
 * source_id is PK (1:1 with data_sources.id by convention; FK not enforced at DB level).
 * embedding column is longtext storing 768-dim Gemini vectors as JSON text.
 */

const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const IndicatorMeta = sequelize.define("IndicatorMeta", {
    source_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
        comment: 'PK; references data_sources.id (FK not enforced at DB level)'
    },
    source_type: {
        type: DataTypes.ENUM('static', 'dynamic', 'interop', 'exim'),
        allowNull: false
    },
    title_id_html: { type: DataTypes.TEXT, allowNull: true },
    title_en_html: { type: DataTypes.TEXT, allowNull: true },
    title_clean: { type: DataTypes.STRING(500), allowNull: true },
    subject_id: { type: DataTypes.STRING(64), allowNull: true },
    subject_label: { type: DataTypes.STRING(255), allowNull: true },
    bab: { type: DataTypes.STRING(255), allowNull: true },
    mms_subject: { type: DataTypes.STRING(255), allowNull: true },
    unit_id: { type: DataTypes.STRING(64), allowNull: true },
    unit_en: { type: DataTypes.STRING(64), allowNull: true },
    decimal_places: {
        type: DataTypes.TINYINT,
        allowNull: true,
        defaultValue: 2
    },
    definition: { type: DataTypes.TEXT, allowNull: true },
    utility: { type: DataTypes.TEXT, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    interpretation: { type: DataTypes.TEXT, allowNull: true },
    formula_html: { type: DataTypes.TEXT, allowNull: true },
    formula_components: { type: DataTypes.TEXT('long'), allowNull: true },
    responsible_party: { type: DataTypes.STRING(255), allowNull: true },
    source_citation_html: { type: DataTypes.TEXT, allowNull: true },
    produced_by: { type: DataTypes.TEXT('long'), allowNull: true },
    data_legend: { type: DataTypes.TEXT('long'), allowNull: true },
    bps_table_id: { type: DataTypes.STRING(128), allowNull: true },
    bps_var_id: { type: DataTypes.INTEGER, allowNull: true },
    cutoff_date: { type: DataTypes.DATEONLY, allowNull: true },
    bps_last_update: { type: DataTypes.DATE, allowNull: true },
    fetched_at: {
        type: DataTypes.DATE,
        allowNull: false,
        comment: 'Snapshot timestamp; NOT NULL at DB level'
    },
    raw_metadata: { type: DataTypes.TEXT('long'), allowNull: true },
    flat_text: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Concatenated searchable text (FULLTEXT index)'
    },
    // Embedding columns dropped 2026-05-09 — vectors live in retrieval_chunks now (e5-base 768d)
}, {
    tableName: "indicator_meta",
    timestamps: false,
    freezeTableName: true
});

module.exports = IndicatorMeta;
