const MONTH_ORDER = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

const crypto = require('crypto');

function getMonthNo(monthName) {
  const s = String(monthName || "").trim();
  const m = s.match(/\[(\d{1,2})\]/);
  if (m) {
    const n = Number(m[1]);
    // Support both monthly (1-12) and quarterly/tahunan codes (31-35)
    if (Number.isFinite(n) && ((n >= 1 && n <= 12) || (n >= 31 && n <= 35))) return n;
  }

  const lower = s.toLowerCase();
  // Use word boundaries so "Triwulan IV" doesn't get parsed as "Triwulan I".
  if (/triwulan\s+iv\b/i.test(s)) return 34;
  if (/triwulan\s+iii\b/i.test(s)) return 33;
  if (/triwulan\s+ii\b/i.test(s)) return 32;
  if (/triwulan\s+i\b/i.test(s)) return 31;
  if (/tahunan\b/i.test(s)) return 35;

  const idx = MONTH_ORDER.indexOf(s);
  return idx >= 0 ? idx + 1 : null;
}

function getIndicatorTableName(sourceId) {
  const idNum = Number(sourceId);
  if (!Number.isFinite(idNum) || idNum <= 0) {
    throw new Error("Invalid source_id for indicator table");
  }
  // 1 indikator = 1 tabel (nama tabel aman, hanya angka)
  return `indikator_${idNum}`;
}

function stripHtml(input) {
  return String(input || "").replace(/<[^>]*>/g, "").trim();
}

function normalizeDecimalValue(val) {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;

  if (typeof val === 'string') {
    const s = stripHtml(val);
    if (!s) return null;
    // Common Indonesian formats: 1.234.567 or 1.234,56
    const cleaned = s.replace(/\./g, '').replace(/,/g, '.');
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : null;
  }

  return null;
}

function normalizeMetricKey(metric) {
  const raw = stripHtml(metric);
  const s = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!s) return '';

  // Keep metric reasonably short for dashboard queries + MySQL indexes.
  // If it exceeds the DB column length, truncate with a stable hash suffix.
  const maxLen = 255;
  if (s.length <= maxLen) return s;

  const hash = sha1Hex(s).slice(0, 10);
  const keep = Math.max(0, maxLen - (1 + hash.length));
  return `${s.slice(0, keep)}_${hash}`;
}

function isValueOutOfRangeError(err) {
  const msg = String(err?.original?.message || err?.message || '');
  const code = err?.original?.code || err?.code;
  const errno = err?.original?.errno || err?.errno;

  if (errno === 1264) return true; // ER_WARN_DATA_OUT_OF_RANGE
  if (code === 'ER_WARN_DATA_OUT_OF_RANGE' || code === 'ER_DATA_OUT_OF_RANGE') return true;
  return msg.includes("Out of range value for column 'value'");
}

function isTransientDbError(err) {
  const msg = String(err?.original?.message || err?.message || '').toLowerCase();
  const code = String(err?.original?.code || err?.code || '').toUpperCase();

  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'EPIPE') return true;
  if (code === 'PROTOCOL_CONNECTION_LOST' || code === 'ER_LOCK_DEADLOCK' || code === 'ER_LOCK_WAIT_TIMEOUT') return true;

  return (
    msg.includes('econnreset') ||
    msg.includes('connection lost') ||
    msg.includes('read econnreset') ||
    msg.includes('write econnreset') ||
    msg.includes('server has gone away') ||
    msg.includes('lost connection to mysql server')
  );
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function queryWithRetry(sequelizeBps, sql, replacements, { maxAttempts = 3 } = {}) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await sequelizeBps.query(sql, { replacements });
    } catch (err) {
      lastErr = err;

      if (isValueOutOfRangeError(err)) throw err;
      if (!isTransientDbError(err) || attempt === maxAttempts) throw err;

      // Re-authenticate and retry with backoff
      try {
        await sequelizeBps.authenticate();
      } catch {
        // ignore
      }
      await sleep(250 * attempt);
    }
  }
  throw lastErr;
}

async function ensureIndicatorValueColumnWide(sequelizeBps, tableName) {
  try {
    await sequelizeBps.query(`ALTER TABLE \`${tableName}\` MODIFY COLUMN value DECIMAL(30,6) NULL`);
  } catch {
    // best-effort
  }
}

async function ensureIndicatorMetricColumnWide(sequelizeBps, tableName) {
  try {
    await sequelizeBps.query(`ALTER TABLE \`${tableName}\` MODIFY COLUMN metric VARCHAR(255) NOT NULL`);
  } catch {
    // best-effort
  }
}

async function ensureIndicatorTable(sequelizeBps, tableName) {
  // MySQL/MariaDB DDL: stable schema, dashboard-friendly.
  // Supports both monthly series (month_no 1-12) and non-monthly dimensional rows (month_no=0 + dim_value).
  const createSql = `
    CREATE TABLE IF NOT EXISTS \`${tableName}\` (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      source_id INT NOT NULL,
      source_name VARCHAR(255) NULL,
      signature VARCHAR(255) NULL,
      th_id VARCHAR(32) NOT NULL,
      year SMALLINT NOT NULL,
      month_no TINYINT NOT NULL DEFAULT 0,
      month_name VARCHAR(32) NOT NULL DEFAULT '',
      hs2 VARCHAR(8) NOT NULL DEFAULT '',
      hs2_name VARCHAR(255) NOT NULL DEFAULT '',
      pod VARCHAR(255) NOT NULL DEFAULT '',
      ctr VARCHAR(255) NOT NULL DEFAULT '',
      kodehs VARCHAR(255) NOT NULL DEFAULT '',
      dim_key VARCHAR(64) NOT NULL DEFAULT '',
      dim_value VARCHAR(255) NOT NULL DEFAULT '',
      dim_hash VARCHAR(64) NOT NULL DEFAULT '',
      metric VARCHAR(255) NOT NULL,
      value DECIMAL(30,6) NULL,
      value_code VARCHAR(8) NULL,
      last_update DATETIME NULL,
      created_at DATETIME NULL,
      updated_at DATETIME NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_th_month_hash_metric (th_id, month_no, dim_hash, metric),
      KEY idx_year_month (year, month_no),
      KEY idx_dim (dim_value),
      KEY idx_metric (metric),
      KEY idx_dim_hash (dim_hash),
      KEY idx_hs2 (hs2)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  await sequelizeBps.query(createSql);

  // Best-effort migration for existing tables created with older schema.
  let dbName = null;
  try {
    const [rows] = await sequelizeBps.query('SELECT DATABASE() AS dbName');
    dbName = rows?.[0]?.dbName || null;
  } catch {
    dbName = null;
  }

  if (!dbName) return;

  const colExists = async (col) => {
    const [rows] = await sequelizeBps.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.columns WHERE table_schema=? AND table_name=? AND column_name=?`,
      { replacements: [dbName, tableName, col] }
    );
    return Number(rows?.[0]?.cnt || 0) > 0;
  };

  const idxExists = async (idx) => {
    const [rows] = await sequelizeBps.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.statistics WHERE table_schema=? AND table_name=? AND index_name=?`,
      { replacements: [dbName, tableName, idx] }
    );
    return Number(rows?.[0]?.cnt || 0) > 0;
  };

  const dedupeByBusinessKey = async () => {
    // Keep the newest row (max id) per business key.
    // This is needed for older tables that were created without the unique index,
    // which can cause double rows for the same period/dimension/metric.
    const sql = `
      DELETE t
      FROM \`${tableName}\` t
      JOIN (
        SELECT th_id, month_no, dim_hash, metric, MAX(id) AS keep_id, COUNT(*) AS c
        FROM \`${tableName}\`
        GROUP BY th_id, month_no, dim_hash, metric
        HAVING c > 1
      ) d
        ON t.th_id = d.th_id
       AND t.month_no = d.month_no
       AND t.dim_hash = d.dim_hash
       AND t.metric = d.metric
      WHERE t.id <> d.keep_id;
    `;

    try {
      await queryWithRetry(sequelizeBps, sql, [], { maxAttempts: 3 });
    } catch {
      // best-effort
    }
  };

  try {
    if (!(await colExists('hs2'))) {
      await sequelizeBps.query(`ALTER TABLE \`${tableName}\` ADD COLUMN hs2 VARCHAR(8) NOT NULL DEFAULT '' AFTER month_name`);
    }
    if (!(await colExists('hs2_name'))) {
      await sequelizeBps.query(`ALTER TABLE \`${tableName}\` ADD COLUMN hs2_name VARCHAR(255) NOT NULL DEFAULT '' AFTER hs2`);
    }
    if (!(await colExists('pod'))) {
      await sequelizeBps.query(`ALTER TABLE \`${tableName}\` ADD COLUMN pod VARCHAR(255) NOT NULL DEFAULT '' AFTER hs2_name`);
    }
    if (!(await colExists('ctr'))) {
      await sequelizeBps.query(`ALTER TABLE \`${tableName}\` ADD COLUMN ctr VARCHAR(255) NOT NULL DEFAULT '' AFTER pod`);
    }
    if (!(await colExists('kodehs'))) {
      await sequelizeBps.query(`ALTER TABLE \`${tableName}\` ADD COLUMN kodehs VARCHAR(255) NOT NULL DEFAULT '' AFTER ctr`);
    }
    if (!(await colExists('dim_key'))) {
      await sequelizeBps.query(`ALTER TABLE \`${tableName}\` ADD COLUMN dim_key VARCHAR(64) NOT NULL DEFAULT '' AFTER month_name`);
    }
    if (!(await colExists('dim_value'))) {
      await sequelizeBps.query(`ALTER TABLE \`${tableName}\` ADD COLUMN dim_value VARCHAR(255) NOT NULL DEFAULT '' AFTER dim_key`);
    }
    if (!(await colExists('dim_hash'))) {
      await sequelizeBps.query(`ALTER TABLE \`${tableName}\` ADD COLUMN dim_hash VARCHAR(64) NOT NULL DEFAULT '' AFTER dim_value`);
    }
    if (!(await colExists('value_code'))) {
      await sequelizeBps.query(`ALTER TABLE \`${tableName}\` ADD COLUMN value_code VARCHAR(8) NULL AFTER value`);
    }

    // Backfill dim_hash for legacy rows so we can safely enforce uniqueness.
    // Only fill when dim_hash is empty but dim_key/value exist.
    try {
      if ((await colExists('dim_hash')) && (await colExists('dim_key')) && (await colExists('dim_value'))) {
        await sequelizeBps.query(
          `UPDATE \`${tableName}\`
           SET dim_hash = SHA1(CONCAT(IFNULL(dim_key,''), '||', IFNULL(dim_value,'')))
           WHERE dim_hash = '' AND (dim_key <> '' OR dim_value <> '')`
        );
      }
    } catch {
      // best-effort
    }

    // Ensure `value` can store large rupiah numbers (older tables used smaller DECIMAL).
    await ensureIndicatorValueColumnWide(sequelizeBps, tableName);

    // Ensure `metric` can store long interop variable names (older tables used VARCHAR(64)).
    await ensureIndicatorMetricColumnWide(sequelizeBps, tableName);

    if (await idxExists('uniq_th_month_metric')) {
      await sequelizeBps.query(`ALTER TABLE \`${tableName}\` DROP INDEX uniq_th_month_metric`);
    }
    if (await idxExists('uniq_th_month_dim_metric')) {
      await sequelizeBps.query(`ALTER TABLE \`${tableName}\` DROP INDEX uniq_th_month_dim_metric`);
    }
    if (!(await idxExists('uniq_th_month_hash_metric'))) {
      try {
        await sequelizeBps.query(
          `ALTER TABLE \`${tableName}\` ADD UNIQUE INDEX uniq_th_month_hash_metric (th_id, month_no, dim_hash, metric)`
        );
      } catch {
        // If adding the unique index fails (duplicates), dedupe then retry once.
        await dedupeByBusinessKey();
        try {
          await sequelizeBps.query(
            `ALTER TABLE \`${tableName}\` ADD UNIQUE INDEX uniq_th_month_hash_metric (th_id, month_no, dim_hash, metric)`
          );
        } catch {
          // still best-effort
        }
      }
    }
  } catch {
    // best-effort migration
  }
}

function sha1Hex(input) {
  return crypto.createHash('sha1').update(String(input || ''), 'utf8').digest('hex');
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Replicate merged table output into a per-indicator table on DB `data_bps`.
 * Shape: one row per (th_id, month_no, metric).
 */
async function replicateMergedToIndicatorTableBps({
  sequelizeBps,
  source,
  signature,
  metrics,
  tableRows,
  lastUpdate,
  log,
  podAllowlist,
}) {
  if (!sequelizeBps) return;
  if (!source?.id) return;
  if (!Array.isArray(metrics) || !Array.isArray(tableRows)) return;

  const emit = typeof log === 'function' ? log : null;
  const info = (m) => emit && emit(`[${new Date().toISOString()}] ${m}`);

  const tableName = getIndicatorTableName(source.id);
  await ensureIndicatorTable(sequelizeBps, tableName);

  // Optional EXIM POD filter (performance): only applies for EXIM signatures.
  // Keeps schema/columns unchanged; it only reduces rows written to the production table.
  // When enabled, we also delete old rows for pods that are no longer selected (same signature)
  // so dashboard queries get faster over time.
  let rowsForReplication = tableRows;
  try {
    const sig = String(signature || '');
    const isExim = sig.startsWith('exim:');
    const allow = Array.isArray(podAllowlist)
      ? Array.from(new Set(podAllowlist.map((x) => String(x).trim()).filter(Boolean)))
      : [];

    if (isExim && allow.length > 0) {
      info(`EXIM POD filter enabled: pods=${allow.length} (signature=${sig})`);

      // Cleanup old pods (best-effort) so non-selected pods don't remain in production.
      const placeholders = allow.map(() => '?').join(',');
      const sqlDelete = `DELETE FROM \`${tableName}\` WHERE signature = ? AND pod <> '' AND pod NOT IN (${placeholders})`;
      try {
        const beforeRows = Array.isArray(rowsForReplication) ? rowsForReplication.length : 0;
        await queryWithRetry(sequelizeBps, sqlDelete, [sig, ...allow], { maxAttempts: 3 });
        info(`EXIM POD filter cleanup done (signature=${sig})`);
        rowsForReplication = (Array.isArray(rowsForReplication) ? rowsForReplication : []).filter((r) => {
          const pod = String(r?.pod || '').trim();
          return pod && allow.includes(pod);
        });
        info(`EXIM POD filter applied: rows ${beforeRows} -> ${rowsForReplication.length}`);
      } catch (e) {
        info(`WARN: EXIM POD filter cleanup failed: ${e?.message || String(e)}`);
        rowsForReplication = (Array.isArray(rowsForReplication) ? rowsForReplication : []).filter((r) => {
          const pod = String(r?.pod || '').trim();
          return pod && allow.includes(pod);
        });
      }
    }
  } catch {
    // Never break replication due to filter parsing.
    rowsForReplication = tableRows;
  }

  // IMPORTANT: keep the production table idempotent even if upstream "th_id" normalization changes.
  // Example: older runs may have th_id="125" while newer runs use th_id="2025" for the same year.
  // Dashboard queries grouped by (year, month_no, metric) will then show double entries.
  // Strategy: for each year where the incoming dataset has exactly 1 distinct th_id,
  // delete existing rows for that (year, signature) whose th_id differs.
  try {
    const sig = String(signature || '');
    const yearToThIds = new Map();
    for (const r of rowsForReplication) {
      const y = Number(r?.year);
      const th = String(r?.th_id || '').trim();
      if (!Number.isFinite(y) || !th) continue;
      if (!yearToThIds.has(y)) yearToThIds.set(y, new Set());
      yearToThIds.get(y).add(th);
    }

    for (const [yearNum, thSet] of yearToThIds.entries()) {
      if (!thSet || thSet.size !== 1) continue;
      const canonicalThId = Array.from(thSet)[0];

      // Also treat legacy rows with signature NULL/'' as the same bucket.
      const sqlDelete = `
        DELETE FROM \`${tableName}\`
        WHERE year = ?
          AND (signature = ? OR signature IS NULL OR signature = '')
          AND th_id <> ?
      `;

      await queryWithRetry(sequelizeBps, sqlDelete, [yearNum, sig, canonicalThId], { maxAttempts: 3 });
    }
  } catch (e) {
    info(`WARN: th_id normalization cleanup failed: ${e?.message || String(e)}`);
  }

  const now = new Date();
  const records = [];

  // If incoming dataset uses quarterly/tahunan codes (31-35), we want idempotency even if
  // previous runs used a buggy mapping. We'll clean quarterly rows per (year, signature)
  // before inserting. This does NOT affect monthly rows (1-12) and does not change schema.
  const incomingYears = new Set();
  let hasQuarterly = false;

  const pickDimKey = (row) => {
    if (row && typeof row.Wilayah === 'string' && row.Wilayah.trim()) return 'Wilayah';
    // Fallback: first string metric in the row (excluding year/month/th_id)
    for (const k of Object.keys(row || {})) {
      if (k === 'year' || k === 'month' || k === 'th_id') continue;
      const v = row?.[k];
      if (typeof v === 'string' && v.trim()) return k;
    }
    return '';
  };

  for (const row of rowsForReplication) {
    const monthName = row.month;
    const monthNo = getMonthNo(monthName);

    const yearNum = Number(row.year);
    // Reject NaN, year=0 (corrupt), and out-of-range. Schema CHECK enforces 2000-2100;
    // matching guard here surfaces the rejection earlier with cleaner error trail.
    if (!Number.isFinite(yearNum) || yearNum < 2000 || yearNum > 2100) continue;

    incomingYears.add(yearNum);
    if (Number.isFinite(monthNo) && monthNo >= 31 && monthNo <= 35) hasQuarterly = true;

    const thId = String(row.th_id || "").trim();
    if (!thId) continue;

    const isMonthly = Boolean(monthNo);

    // For EXIM, preserve pod/ctr as dimensional value even for monthly rows.
    const hasPod = row && typeof row.pod === 'string' && row.pod.trim();
    const hasCtr = row && typeof row.ctr === 'string' && row.ctr.trim();

    const hasKodehs = row && typeof row.kodehs === 'string' && row.kodehs.trim();

    const hasHs2 = row && typeof row.hs2 === 'string' && row.hs2.trim();
    const hasHs2Name = row && typeof row.hs2_name === 'string' && row.hs2_name.trim();

    const podCol = hasPod ? stripHtml(row.pod) : '';
    const ctrCol = hasCtr ? stripHtml(row.ctr) : '';
    const kodehsCol = hasKodehs ? stripHtml(row.kodehs) : '';
    const hs2Col = hasHs2 ? stripHtml(row.hs2) : '';
    const hs2NameCol = hasHs2Name ? stripHtml(row.hs2_name) : '';

    let dimKey = '';
    let dimValueFull = '';
    if (isMonthly && (hasPod || hasCtr)) {
      dimKey = 'hs2|pod|ctr|kodehs';
      dimValueFull = [hs2Col, podCol, ctrCol, kodehsCol].filter(Boolean).join(' | ');
    } else if (isMonthly) {
      // Allow non-EXIM dimension columns for periodic rows (e.g., quarterly-by-wilayah).
      dimKey = pickDimKey(row);
      const dimValueRaw = dimKey ? row?.[dimKey] : '';
      dimValueFull = dimValueRaw != null ? stripHtml(dimValueRaw) : '';
    } else {
      dimKey = pickDimKey(row);
      const dimValueRaw = dimKey ? row?.[dimKey] : '';
      dimValueFull = dimValueRaw != null ? stripHtml(dimValueRaw) : '';
    }

    const dimValue = dimValueFull.length > 255 ? dimValueFull.slice(0, 255) : dimValueFull;
    const dimHash = dimKey || dimValueFull ? sha1Hex(`${dimKey}||${dimValueFull}`) : '';

    const metricsToWrite = Array.isArray(metrics)
      ? metrics.filter((m) => String(m) !== String(dimKey))
      : [];

    for (const metric of metricsToWrite) {
      const codeRaw = row?.value_codes?.[metric];
      const code = codeRaw == null || codeRaw === '' ? null : String(codeRaw).slice(0, 8);
      records.push({
        source_id: Number(source.id),
        source_name: source.name || null,
        signature: signature || null,
        th_id: thId,
        year: yearNum,
        month_no: isMonthly ? monthNo : 0,
        month_name: isMonthly ? String(monthName) : '',
        hs2: hs2Col,
        hs2_name: hs2NameCol,
        pod: podCol,
        ctr: ctrCol,
        kodehs: kodehsCol,
        dim_key: dimKey,
        dim_value: dimValue,
        dim_hash: dimHash,
        metric: normalizeMetricKey(metric),
        value: normalizeDecimalValue(row[metric]),
        value_code: code,
        last_update: lastUpdate ? new Date(lastUpdate) : null,
        created_at: now,
        updated_at: now,
      });
    }
  }

  // Cleanup old quarterly rows for these years/signature (best-effort)
  if (hasQuarterly && incomingYears.size > 0) {
    try {
      const sig = String(signature || '');
      for (const y of incomingYears) {
        const sqlDelete = `
          DELETE FROM \`${tableName}\`
          WHERE year = ?
            AND (signature = ? OR signature IS NULL OR signature = '')
            AND month_no BETWEEN 31 AND 35
        `;
        await queryWithRetry(sequelizeBps, sqlDelete, [y, sig], { maxAttempts: 3 });
      }
      info(`Quarterly cleanup done for years=${incomingYears.size} (signature=${String(signature || '')})`);
    } catch (e) {
      info(`WARN: quarterly cleanup failed: ${e?.message || String(e)}`);
    }
  }

  if (!records.length) return;

  info(`BPS replicate: prepared ${records.length} records into ${getIndicatorTableName(source.id)}`);

  const columns = [
    "source_id",
    "source_name",
    "signature",
    "th_id",
    "year",
    "month_no",
    "month_name",
    "hs2",
    "hs2_name",
    "pod",
    "ctr",
    "kodehs",
    "dim_key",
    "dim_value",
    "dim_hash",
    "metric",
    "value",
    "value_code",
    "last_update",
    "created_at",
    "updated_at",
  ];

  const chunkSize = 150;
  const chunks = chunkArray(records, chunkSize);
  const totalChunks = chunks.length;
  for (let idx = 0; idx < totalChunks; idx++) {
    const chunk = chunks[idx];
    if (idx % 10 === 0 || idx === totalChunks - 1) {
      info(`BPS replicate: inserting chunk ${idx + 1}/${totalChunks} (rows=${chunk.length})`);
    }
    const placeholders = chunk
      .map(() => `(${columns.map(() => "?").join(",")})`)
      .join(",");

    const values = [];
    for (const rec of chunk) {
      for (const c of columns) values.push(rec[c]);
    }

    const sql = `
      INSERT INTO \`${tableName}\` (${columns.map((c) => `\`${c}\``).join(",")})
      VALUES ${placeholders}
      ON DUPLICATE KEY UPDATE
        source_id = VALUES(source_id),
        source_name = VALUES(source_name),
        signature = VALUES(signature),
        year = VALUES(year),
        month_name = VALUES(month_name),
        hs2 = VALUES(hs2),
        hs2_name = VALUES(hs2_name),
        pod = VALUES(pod),
        ctr = VALUES(ctr),
        kodehs = VALUES(kodehs),
        dim_key = VALUES(dim_key),
        dim_value = VALUES(dim_value),
        dim_hash = VALUES(dim_hash),
        value = VALUES(value),
        value_code = VALUES(value_code),
        last_update = VALUES(last_update),
        updated_at = VALUES(updated_at);
    `;

    try {
      await queryWithRetry(sequelizeBps, sql, values, { maxAttempts: 3 });
    } catch (err) {
      if (isValueOutOfRangeError(err)) {
        await ensureIndicatorValueColumnWide(sequelizeBps, tableName);
        await queryWithRetry(sequelizeBps, sql, values, { maxAttempts: 3 });
      } else {
        throw err;
      }
    }
  }

  info(`BPS replicate: finished (${records.length} rows processed)`);
}

module.exports = {
  replicateMergedToIndicatorTableBps,
};
