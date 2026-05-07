'use strict';

const { classify } = require('./categorization.service');
const { NAME_TO_KDKAB } = require('./regionMap.service');

const EXCLUDED_TABLES = new Set([
  'indikator_418',  // multi-dim Pelanggan Listrik (MVP exclusion)
  'indikator_159',  // EXIM Ekspor (multidim pipe-separated)
  'indikator_160',  // EXIM Impor
]);

// 10 kab/kota Malut + variants with Kabupaten/Kota prefix
const KABKOTA_NAMES = (() => {
  const names = Object.keys(NAME_TO_KDKAB).map(n =>
    n.replace(/\b\w/g, c => c.toUpperCase())
  );
  const variants = [];
  for (const n of names) {
    variants.push(n);
    if (['Ternate', 'Tidore Kepulauan'].includes(n)) {
      variants.push(`Kota ${n}`);
    } else {
      variants.push(`Kabupaten ${n}`);
    }
  }
  return variants;
})();

async function scanEligibility(sequelizeBps) {
  const [tables] = await sequelizeBps.query(
    `SELECT TABLE_NAME
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME LIKE 'indikator_%'
      ORDER BY TABLE_NAME`
  );

  const results = [];
  for (const row of tables) {
    const tableName = row.TABLE_NAME;
    if (EXCLUDED_TABLES.has(tableName)) {
      results.push({ tableName, sourceId: null, sourceName: null, eligible: false });
      continue;
    }
    try {
      const placeholders = KABKOTA_NAMES.map(() => '?').join(',');
      // Functional eligibility: count rows that have BOTH a matching kab/kota
      // dim_value AND a non-null value. Structural-only check (just dim_value
      // matching) caused 7 false-positives where indikator was provinsi-level
      // or single-kab indikator that mentioned a name but had no breakdown.
      const [aggRows] = await sequelizeBps.query(
        `SELECT MAX(source_id) AS source_id,
                MAX(source_name) AS source_name,
                SUM(CASE WHEN dim_value IN (${placeholders}) AND value IS NOT NULL THEN 1 ELSE 0 END) AS region_rows_with_values
           FROM \`${tableName}\``,
        { replacements: KABKOTA_NAMES }
      );
      const agg = aggRows[0] || {};
      results.push({
        tableName,
        sourceId: agg.source_id ? Number(agg.source_id) : null,
        sourceName: agg.source_name || null,
        eligible: Number(agg.region_rows_with_values || 0) > 0,
      });
    } catch (e) {
      console.warn(`[petaTematik] scan skipped ${tableName}: ${e.message}`);
      results.push({ tableName, sourceId: null, sourceName: null, eligible: false });
    }
  }
  return results;
}

function buildIndikatorList(scanResults) {
  const kategori = {};
  let totalEligible = 0;
  for (const r of scanResults) {
    if (!r.eligible || !r.sourceId || !r.sourceName) continue;
    totalEligible++;
    const k = classify(r.sourceName);
    if (!kategori[k]) kategori[k] = [];
    kategori[k].push({
      sourceId: r.sourceId,
      sourceName: r.sourceName,
      tableName: r.tableName,
    });
  }
  for (const k of Object.keys(kategori)) {
    kategori[k].sort((a, b) => a.sourceName.localeCompare(b.sourceName, 'id'));
  }
  return { totalEligible, kategori };
}

module.exports = { scanEligibility, buildIndikatorList, EXCLUDED_TABLES };
