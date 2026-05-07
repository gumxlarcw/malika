const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const FetchLog = sequelize.define("FetchLog", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    source_id: DataTypes.INTEGER,
    status_code: DataTypes.INTEGER,
    message: DataTypes.TEXT,
}, {
    tableName: "fetch_logs",
    timestamps: false,
    freezeTableName: true
});

module.exports = FetchLog;
