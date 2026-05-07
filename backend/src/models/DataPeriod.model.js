const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const DataPeriod = sequelize.define("DataPeriod", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    source_id: DataTypes.INTEGER,
    period_value: DataTypes.STRING(50),
    granularity: {
        type: DataTypes.ENUM('monthly', 'quarterly', 'semester', 'yearly'),
        defaultValue: 'yearly',
    },
    api_url_override: DataTypes.TEXT,
}, {
    tableName: "data_period_map",
    timestamps: false,
    freezeTableName: true
});

module.exports = DataPeriod;
