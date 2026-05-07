/**
 * Provinsi-level data helpers
 *
 * Extracted from streaming.service.js for modularity.
 */

'use strict';

const logger = require('../../../utils/logger').child({ service: 'ProvinsiHelper' });
const { Op } = require('sequelize');

/**
 * Find a better datasource for provinsi-level data (not kab/kota)
 * Returns { sourceId, sourceName } or null
 */
async function findProvinsiDatasource({ DataSource, currentSourceId, topicKeywords }) {
  try {
    if (!DataSource || !Array.isArray(topicKeywords) || topicKeywords.length === 0) return null;

    const likePatterns = topicKeywords.map(kw => (
      String(kw).includes('%') ? kw : `%${kw}%`
    ));

    const alternatives = await DataSource.findAll({
      where: {
        visible: true,
        id: { [Op.ne]: currentSourceId },
        [Op.or]: likePatterns.map(kw => ({
          name: { [Op.like]: kw },
        })),
        [Op.and]: [
          {
            [Op.or]: [
              { name: { [Op.notLike]: '%Kabupaten%' } },
              { name: { [Op.like]: '%Provinsi%' } },
            ],
          },
        ],
      },
      order: [['display_order', 'DESC']],
      limit: 5,
    });

    if (!alternatives || alternatives.length === 0) return null;

    return {
      sourceId: alternatives[0].id,
      sourceName: alternatives[0].name,
    };
  } catch (err) {
    logger.error({ error: err.message }, 'Failed to find provinsi datasource');
    return null;
  }
}

/**
 * Get provinsi-level data value from alternative datasource
 * Returns { value, sourceName, disclaimer } or null
 */
async function getProvinsiDataFromAlternative(alternativeSourceId, year, metric) {
  try {
    const { readGenericIndicatorFromBps } = require('../bpsRead/indicatorTableGenericRead.service');
    const DataSource = require('../../models/DataSource.model');

    const ds = await DataSource.findByPk(alternativeSourceId);
    if (!ds) return null;

    const bpsData = await readGenericIndicatorFromBps({
      sourceId: alternativeSourceId,
      period: year,
      sourceName: ds.name,
    });

    if (!bpsData || !Array.isArray(bpsData.data) || bpsData.data.length === 0) return null;

    // Look for provinsi row (Maluku Utara)
    const provinsiRow = bpsData.data.find(row => {
      const vals = Object.values(row).map(v => String(v || '').toLowerCase());
      return vals.some(v => v.includes('maluku utara') || v === 'maluku utara');
    });

    if (!provinsiRow) return null;

    // Extract numeric value
    const numericValues = Object.entries(provinsiRow)
      .filter(([k, v]) => typeof v === 'number' && !k.toLowerCase().includes('tahun'))
      .map(([k, v]) => ({ key: k, value: v }));

    if (numericValues.length === 0) return null;

    return {
      value: numericValues[0].value,
      metric: numericValues[0].key,
      sourceName: ds.name,
      disclaimer: true,
    };
  } catch (err) {
    logger.error({ error: err.message }, 'Failed to get provinsi data from alternative');
    return null;
  }
}

module.exports = {
  findProvinsiDatasource,
  getProvinsiDataFromAlternative,
};
