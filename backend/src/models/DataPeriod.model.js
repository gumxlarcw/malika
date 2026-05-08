const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const DataPeriod = sequelize.define("DataPeriod", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    source_id: { type: DataTypes.INTEGER, allowNull: false },
    period_value: { type: DataTypes.STRING(50), allowNull: false },
    granularity: {
        type: DataTypes.ENUM('monthly', 'quarterly', 'semester', 'yearly'),
        defaultValue: 'yearly',
    },
    api_url_override: DataTypes.TEXT,
    created_at: { type: DataTypes.DATE, allowNull: true },
    updated_at: { type: DataTypes.DATE, allowNull: true },
}, {
    tableName: "data_period_map",
    timestamps: false,
    freezeTableName: true
});

module.exports = DataPeriod;
