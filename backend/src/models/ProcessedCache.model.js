const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const ProcessedCache = sequelize.define("ProcessedCache", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    source_id: { type: DataTypes.INTEGER, allowNull: false },
    period_value: { type: DataTypes.STRING(50), allowNull: false },
    processed_json: { type: DataTypes.TEXT("long"), allowNull: false },
    last_update: DataTypes.DATE,
}, {
    tableName: "data_processed_cache",
    timestamps: false,
    freezeTableName: true
});

module.exports = ProcessedCache;
