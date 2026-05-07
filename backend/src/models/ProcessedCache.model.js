const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const ProcessedCache = sequelize.define("ProcessedCache", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    source_id: DataTypes.INTEGER,
    period_value: DataTypes.STRING(50),
    processed_json: DataTypes.TEXT("long"),
    last_update: DataTypes.DATE,
}, {
    tableName: "data_processed_cache",
    timestamps: false,
    freezeTableName: true
});

module.exports = ProcessedCache;
