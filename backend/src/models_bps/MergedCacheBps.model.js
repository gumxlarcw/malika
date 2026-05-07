const { DataTypes } = require('sequelize');
const getSequelizeBps = require('../config/db_bps');

let MergedCacheBps = null;

function getMergedCacheBpsModel() {
  const sequelizeBps = getSequelizeBps();
  if (!sequelizeBps) return null;
  if (MergedCacheBps) return MergedCacheBps;

  MergedCacheBps = sequelizeBps.define('MergedCache', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    source_id: { type: DataTypes.INTEGER, allowNull: false },
    signature: { type: DataTypes.STRING(255), allowNull: false },
    merged_json: { type: DataTypes.TEXT('long'), allowNull: false },
    last_update: { type: DataTypes.DATE, allowNull: false },
    created_at: { type: DataTypes.DATE, allowNull: true },
    updated_at: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: 'data_merged_cache',
    timestamps: false,
    freezeTableName: true,
    indexes: [
      { unique: true, fields: ['source_id', 'signature'] }
    ],
  });

  return MergedCacheBps;
}

module.exports = getMergedCacheBpsModel;
