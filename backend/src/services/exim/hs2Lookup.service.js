const sequelize = require('../../config/db');

const cache = new Map();

function normalizeHs2(code) {
  const s = String(code || '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})$/);
  if (!m) return null;
  return String(m[1]).padStart(2, '0');
}

async function getHs2IndonesianName(hs2digit) {
  const key = normalizeHs2(hs2digit);
  if (!key) return null;

  const cached = cache.get(key);
  if (typeof cached === 'string') return cached || null;

  try {
    const [rows] = await sequelize.query(
      "SELECT bab_ind, bab_ind_singkat FROM `data_bps`.`kodehs_indd` WHERE hs2digit = ? LIMIT 1",
      { replacements: [key] }
    );

    const r = Array.isArray(rows) ? rows[0] : null;
    const shortName = typeof r?.bab_ind_singkat === 'string' ? r.bab_ind_singkat.trim() : '';
    const longName = typeof r?.bab_ind === 'string' ? r.bab_ind.trim() : '';
    const name = shortName || longName || '';
    cache.set(key, name);
    return name || null;
  } catch {
    cache.set(key, '');
    return null;
  }
}

async function getHs2IndonesianNames(hs2digits) {
  const input = Array.isArray(hs2digits) ? hs2digits : [];
  const normalized = Array.from(
    new Set(
      input
        .map((x) => normalizeHs2(x))
        .filter(Boolean)
    )
  );

  const out = new Map();
  const missing = [];

  for (const key of normalized) {
    const cached = cache.get(key);
    if (typeof cached === 'string') {
      if (cached) out.set(key, cached);
      continue;
    }
    missing.push(key);
  }

  if (missing.length === 0) return out;

  try {
    const placeholders = missing.map(() => '?').join(',');
    const [rows] = await sequelize.query(
      `SELECT hs2digit, bab_ind, bab_ind_singkat FROM \`data_bps\`.\`kodehs_indd\` WHERE hs2digit IN (${placeholders})`,
      { replacements: missing }
    );

    const list = Array.isArray(rows) ? rows : [];
    for (const r of list) {
      const key = normalizeHs2(r?.hs2digit);
      if (!key) continue;
      const shortName = typeof r?.bab_ind_singkat === 'string' ? r.bab_ind_singkat.trim() : '';
      const longName = typeof r?.bab_ind === 'string' ? r.bab_ind.trim() : '';
      const name = shortName || longName || '';
      cache.set(key, name);
      if (name) out.set(key, name);
    }

    for (const key of missing) {
      if (!cache.has(key)) cache.set(key, '');
    }
  } catch {
    for (const key of missing) cache.set(key, '');
  }

  return out;
}

module.exports = {
  getHs2IndonesianName,
  getHs2IndonesianNames,
};
