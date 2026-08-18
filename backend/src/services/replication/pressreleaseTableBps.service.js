const crypto = require('crypto');

function sha1Hex(input) {
  return crypto.createHash('sha1').update(String(input || ''), 'utf8').digest('hex');
}

function normalizeKeyword(keyword) {
  return String(keyword || '').trim().toLowerCase();
}

function sanitizeIdentifierPiece(input, { maxLen = 24 } = {}) {
  const raw = String(input || '').toLowerCase();
  const s = raw
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');

  const clipped = (s || 'kw').slice(0, maxLen);
  return clipped || 'kw';
}

function getPressReleaseKeywordTableName(keyword) {
  const kw = normalizeKeyword(keyword);
  if (!kw) throw new Error('Invalid keyword for pressrelease production table');

  // MySQL table name max length is 64.
  // Deterministic per keyword: pressrelease_kw_<slug>_<hash8>
  const slug = sanitizeIdentifierPiece(kw, { maxLen: 24 });
  const hash8 = sha1Hex(kw).slice(0, 8);
  const name = `pressrelease_kw_${slug}_${hash8}`;
  return name.length <= 64 ? name : name.slice(0, 64);
}

function parseDateOnly(value) {
  const s = String(value || '').trim();
  // Expect YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function parseIntOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function stringifyValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildColumnMap(extraKeys) {
  // Map raw keys to safe MySQL column identifiers.
  // Keep most keys as-is when safe.
  const used = new Set();
  const map = new Map();

  const makeSafe = (k) => {
    const base = String(k || '')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_]/g, '_');

    let col = base || 'col';
    if (/^\d/.test(col)) col = `c_${col}`;
    if (col.length > 50) col = col.slice(0, 50);

    // Ensure uniqueness.
    if (!used.has(col)) {
      used.add(col);
      return col;
    }

    const suffix = sha1Hex(k).slice(0, 6);
    const candidate = `${col.slice(0, 43)}_${suffix}`;
    used.add(candidate);
    return candidate;
  };

  for (const k of extraKeys) {
    const col = makeSafe(k);
    map.set(k, col);
  }

  return map;
}

async function ensurePressReleaseKeywordTable(sequelizeBps, tableName) {
  const createSql = `
    CREATE TABLE IF NOT EXISTS \`${tableName}\` (
      brs_id BIGINT UNSIGNED NOT NULL,
      keyword VARCHAR(255) NOT NULL,
      source_id INT NULL,

      title TEXT NULL,
      abstract LONGTEXT NULL,
      rl_date DATE NULL,
      updt_date DATE NULL,
      subj_id INT NULL,
      subj VARCHAR(255) NULL,
      subcsa_id INT NULL,
      subcsa VARCHAR(255) NULL,
      pdf_url TEXT NULL,
      slide_url TEXT NULL,
      thumbnail_url TEXT NULL,
      hit INT NULL,
      size VARCHAR(64) NULL,

      last_update DATETIME NULL,
      created_at DATETIME NULL,
      updated_at DATETIME NULL,

      PRIMARY KEY (brs_id),
      KEY idx_keyword (keyword),
      KEY idx_rl_date (rl_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  await sequelizeBps.query(createSql);
}

async function ensureExtraColumns(sequelizeBps, tableName, extraColumnNames) {
  if (!extraColumnNames.length) return;

  let dbName = null;
  try {
    const [rows] = await sequelizeBps.query('SELECT DATABASE() AS dbName');
    dbName = rows?.[0]?.dbName || null;
  } catch {
    dbName = null;
  }
  if (!dbName) return;

  const [rows] = await sequelizeBps.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema=? AND table_name=?`,
    { replacements: [dbName, tableName] }
  );
  const existing = new Set((rows || []).map((r) => String(r.column_name)));

  for (const col of extraColumnNames) {
    if (existing.has(col)) continue;
    // LONGTEXT: allows arbitrary JSON-ish payloads, dashboard-friendly.
    // Best-effort: if ALTER fails (permissions), skip.
    try {
      await sequelizeBps.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${col}\` LONGTEXT NULL`);
    } catch {
      // best-effort
    }
  }
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function replicatePressReleaseToKeywordTableBps({ sequelizeBps, keyword, sourceId, rows, lastUpdate, log }) {
  if (!sequelizeBps) return { ok: false, skipped: true, reason: 'sequelizeBps missing' };

  const kw = normalizeKeyword(keyword);
  if (!kw) throw new Error('keyword wajib untuk replikasi pressrelease');

  const tableName = getPressReleaseKeywordTableName(kw);

  const emit = typeof log === 'function' ? log : null;
  const info = (m) => emit && emit(`[${new Date().toISOString()}] ${m}`);

  const data = Array.isArray(rows) ? rows : [];

  // Determine extra keys from merged rows (list+detail already merged by processor).
  const baseKeys = new Set([
    'brs_id',
    'keyword',
    'source_id',
    'title',
    'abstract',
    'rl_date',
    'updt_date',
    'subj_id',
    'subj',
    'subcsa_id',
    'subcsa',
    'pdf_url',
    'slide_url',
    'thumbnail_url',
    'hit',
    'size',
    'last_update',
    'created_at',
    'updated_at',
  ]);

  const extraKeysSet = new Set();
  for (const r of data) {
    if (!r || typeof r !== 'object') continue;
    for (const k of Object.keys(r)) {
      if (!baseKeys.has(k)) extraKeysSet.add(k);
    }
  }

  const extraKeys = Array.from(extraKeysSet).sort((a, b) => String(a).localeCompare(String(b)));
  const colMap = buildColumnMap(extraKeys);
  const extraCols = Array.from(new Set(Array.from(colMap.values())));

  await ensurePressReleaseKeywordTable(sequelizeBps, tableName);
  await ensureExtraColumns(sequelizeBps, tableName, extraCols);

  const now = new Date();
  const lastUpdateIso = lastUpdate ? new Date(lastUpdate) : now;

  const batches = chunkArray(data, 200);
  let upserted = 0;

  for (const batch of batches) {
    const cols = [
      'brs_id',
      'keyword',
      'source_id',
      'title',
      'abstract',
      'rl_date',
      'updt_date',
      'subj_id',
      'subj',
      'subcsa_id',
      'subcsa',
      'pdf_url',
      'slide_url',
      'thumbnail_url',
      'hit',
      'size',
      ...extraCols,
      'last_update',
      'created_at',
      'updated_at',
    ];

    const valuesSql = [];
    const replacements = [];

    for (const r of batch) {
      const brsId = Number(r?.brs_id);
      if (!Number.isFinite(brsId) || brsId <= 0) continue;

      valuesSql.push(`(${cols.map(() => '?').join(',')})`);

      const title = stringifyValue(r?.title);
      const abstract = stringifyValue(r?.abstract);
      const rlDate = parseDateOnly(r?.rl_date);
      const updtDate = parseDateOnly(r?.updt_date);
      const subjId = parseIntOrNull(r?.subj_id);
      const subj = stringifyValue(r?.subj);
      const subcsaId = parseIntOrNull(r?.subcsa_id);
      const subcsa = stringifyValue(r?.subcsa);
      const pdfUrl = stringifyValue(r?.pdf_url || r?.pdf);
      const slideUrl = stringifyValue(r?.slide_url || r?.slide);
      const thumbUrl = stringifyValue(r?.thumbnail_url || r?.thumbnail);
      const hit = parseIntOrNull(r?.hit);
      const size = stringifyValue(r?.size);

      replacements.push(
        brsId,
        kw,
        Number.isFinite(Number(sourceId)) ? Number(sourceId) : null,
        title,
        abstract,
        rlDate,
        updtDate,
        subjId,
        subj,
        subcsaId,
        subcsa,
        pdfUrl,
        slideUrl,
        thumbUrl,
        hit,
        size,
      );

      for (const rawKey of extraKeys) {
        const col = colMap.get(rawKey);
        if (!col) {
          replacements.push(null);
          continue;
        }
        // Store any value as string (or JSON string).
        replacements.push(stringifyValue(r?.[rawKey]));
      }

      const lu = lastUpdateIso;
      replacements.push(lu, now, now);
    }

    if (!valuesSql.length) continue;

    const insertSql = `
      INSERT INTO \`${tableName}\` (${cols.map((c) => `\`${c}\``).join(',')})
      VALUES ${valuesSql.join(',')}
      ON DUPLICATE KEY UPDATE
        keyword=VALUES(keyword),
        source_id=VALUES(source_id),
        title=VALUES(title),
        abstract=VALUES(abstract),
        rl_date=VALUES(rl_date),
        updt_date=VALUES(updt_date),
        subj_id=VALUES(subj_id),
        subj=VALUES(subj),
        subcsa_id=VALUES(subcsa_id),
        subcsa=VALUES(subcsa),
        pdf_url=VALUES(pdf_url),
        slide_url=VALUES(slide_url),
        thumbnail_url=VALUES(thumbnail_url),
        hit=VALUES(hit),
        size=VALUES(size),
        ${extraCols.map((c) => `\`${c}\`=VALUES(\`${c}\`)`).join(',\n        ')},
        last_update=VALUES(last_update),
        updated_at=VALUES(updated_at)
    `;

    try {
      await sequelizeBps.query(insertSql, { replacements });
      upserted += valuesSql.length;
    } catch (e) {
      info(`WARN: pressrelease replicate batch failed: ${e?.message || String(e)}`);
      // best-effort: continue
    }
  }

  return { ok: true, tableName, upserted, keyword: kw };
}

module.exports = {
  getPressReleaseKeywordTableName,
  replicatePressReleaseToKeywordTableBps,
};
