const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const WebapiHealthLog = sequelize.define("WebapiHealthLog", {
  id:              { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  run_id:          { type: DataTypes.CHAR(36), allowNull: false },
  probe_kind:      { type: DataTypes.ENUM('scheduled','manual','recovery'), allowNull: false },
  endpoint_family: { type: DataTypes.STRING(32), allowNull: false },
  url_template:    { type: DataTypes.STRING(255), allowNull: false },
  http_status:     { type: DataTypes.SMALLINT, allowNull: true },
  latency_ms:      { type: DataTypes.INTEGER, allowNull: true },
  ok:              { type: DataTypes.TINYINT, allowNull: false },
  error_code:      { type: DataTypes.STRING(64), allowNull: true },
  error_message:   { type: DataTypes.STRING(500), allowNull: true },
  bytes_received:  { type: DataTypes.INTEGER, allowNull: true },
  created_at:      { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: "webapi_health_logs",
  timestamps: false,
  freezeTableName: true,
});

module.exports = WebapiHealthLog;
