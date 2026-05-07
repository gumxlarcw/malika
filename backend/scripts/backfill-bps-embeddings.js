#!/usr/bin/env node
'use strict';

/**
 * Generate vector embeddings for indicator_meta + indicator_metric_meta
 * `flat_text` columns. Uses the existing OpenAI text-embedding-3-small
 * pipeline (1536-dim).
 *
 * Idempotent — re-run is safe; only rows with NULL embedding (or rows whose
 * flat_text changed since last embed) are processed when --refresh is set.
 *
 * Usage:
 *   node backend/scripts/backfill-bps-embeddings.js                # all NULL
 *   node backend/scripts/backfill-bps-embeddings.js --refresh      # ALL rows
 *   node backend/scripts/backfill-bps-embeddings.js --metrics-only # skip indicator_meta
 *   node backend/scripts/backfill-bps-embeddings.js --indicators-only
 *   node backend/scripts/backfill-bps-embeddings.js --limit=10
 *
 * Throttled to 5 req/sec for OpenAI rate-limit headroom (their tier-1 limit
 * is 3000 RPM for embeddings, so 5/sec = 300 RPM = 10% headroom).
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const sequelize = require('../src/config/db');
const { QueryTypes } = require('sequelize');
const { generateEmbedding, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } = require('../src/services/bpsMetadata/embedding.service');

const args = parseArgs(process.argv.slice(2));
const THROTTLE_MS = 200; // 5 req/sec

function parseArgs(argv) {
  const out = {
    refresh: false, metricsOnly: false, indicatorsOnly: false,
    limit: null, stale: false,
  };
  for (const a of argv) {
    if (a === '--refresh') out.refresh = true;
    else if (a === '--metrics-only') out.metricsOnly = true;
    else if (a === '--indicators-only') out.indicatorsOnly = true;
    else if (a === '--stale') out.stale = true;
    else if (a.startsWith('--limit=')) out.limit = Number(a.slice(8));
  }
  return out;
}

/**
 * Tables differ in PK shape:
 *  - indicator_meta: source_id is the PK (no separate id column).
 *  - indicator_metric_meta: id AUTO_INCREMENT, source_id is FK-style.
 * pkCol abstracts this — query + update both use it as the WHERE/UPDATE key.
 */
async function listPending(table, pkCol) {
  const limit = args.limit ? `LIMIT ${Number(args.limit)}` : '';
  let filter;
  if (args.refresh) {
    // Embed every row, regardless of state.
    filter = 'flat_text IS NOT NULL AND flat_text != ""';
  } else if (args.stale) {
    // "Stale" = missing embedding, OR the metadata was refreshed AFTER the
    // embedding. Use UNIX_TIMESTAMP() rather than TIMESTAMPDIFF on the bare
    // columns: TIMESTAMP and DATETIME are compared inconsistently across
    // session timezones (Sequelize defaults to UTC; CLI uses system zone).
    // UNIX_TIMESTAMP normalizes both sides to epoch seconds. 60-second
    // tolerance prevents flapping from sub-second insert ordering.
    filter = table === 'indicator_meta'
      ? `flat_text IS NOT NULL AND flat_text != "" AND
         (embedding IS NULL
           OR embedding_updated_at IS NULL
           OR UNIX_TIMESTAMP(fetched_at) - UNIX_TIMESTAMP(embedding_updated_at) > 60)`
      : `flat_text IS NOT NULL AND flat_text != "" AND
         (embedding IS NULL
           OR embedding_updated_at IS NULL
           OR UNIX_TIMESTAMP(
                (SELECT fetched_at FROM indicator_meta WHERE source_id = ${table}.source_id)
              ) - UNIX_TIMESTAMP(embedding_updated_at) > 60)`;
  } else {
    // Default: only embed rows that have no embedding yet.
    filter = 'flat_text IS NOT NULL AND flat_text != "" AND embedding IS NULL';
  }
  const sql = `SELECT ${pkCol} AS pk, source_id, flat_text FROM ${table}
     WHERE ${filter}
     ORDER BY ${pkCol} ${limit}`;
  return sequelize.query(sql, { type: QueryTypes.SELECT });
}

async function processOne(table, pkCol, row) {
  try {
    const vec = await generateEmbedding(row.flat_text);
    await sequelize.query(
      `UPDATE ${table}
       SET embedding = :vec, embedding_updated_at = NOW()
       WHERE ${pkCol} = :pk`,
      {
        replacements: { pk: row.pk, vec: JSON.stringify(vec) },
        type: QueryTypes.UPDATE,
      },
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function processTable(table, pkCol, label) {
  const rows = await listPending(table, pkCol);
  if (rows.length === 0) {
    console.log(`[${label}] nothing to embed`);
    return { ok: 0, fail: 0 };
  }
  console.log(`[${label}] ${rows.length} rows pending`);

  const summary = { ok: 0, fail: 0 };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const result = await processOne(table, pkCol, r);
    if (result.ok) summary.ok++;
    else summary.fail++;

    const status = result.ok ? '✓' : '✗';
    const detail = result.ok ? '' : ` ← ${result.error}`;
    if (i % 25 === 0 || !result.ok || i === rows.length - 1) {
      console.log(`  [${i + 1}/${rows.length}] ${status} ${table} pk=${r.pk} src=${r.source_id}${detail}`);
    }

    if (i < rows.length - 1) await sleep(THROTTLE_MS);
  }
  console.log(`[${label}] DONE — ok=${summary.ok}, fail=${summary.fail}`);
  return summary;
}

async function main() {
  console.log(`[embed] config:`, args);
  console.log(`[embed] model: ${EMBEDDING_MODEL} (${EMBEDDING_DIMENSIONS}-dim)`);
  let total = { ok: 0, fail: 0 };

  if (!args.metricsOnly) {
    const r = await processTable('indicator_meta', 'source_id', 'indicator_meta');
    total.ok += r.ok;
    total.fail += r.fail;
  }
  if (!args.indicatorsOnly) {
    const r = await processTable('indicator_metric_meta', 'id', 'indicator_metric_meta');
    total.ok += r.ok;
    total.fail += r.fail;
  }

  console.log('');
  console.log(`[embed] GRAND TOTAL — ok=${total.ok}, fail=${total.fail}`);
  process.exit(total.fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('[embed] fatal:', e);
  process.exit(2);
});
