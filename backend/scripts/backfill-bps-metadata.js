#!/usr/bin/env node
'use strict';

/**
 * One-shot script: hit BPS API for every active data_sources row and populate
 * the new metadata tables (indicator_meta, indicator_metric_meta, indicator_static_table).
 *
 * Usage:
 *   node backend/scripts/backfill-bps-metadata.js [--type=<type>] [--id=<sourceId>] [--limit=N] [--dry] [--retry-failed]
 *
 * Examples:
 *   node backend/scripts/backfill-bps-metadata.js                       # all 313
 *   node backend/scripts/backfill-bps-metadata.js --type=dynamic        # dynamic only
 *   node backend/scripts/backfill-bps-metadata.js --id=393              # single source
 *   node backend/scripts/backfill-bps-metadata.js --retry-failed        # only previously-failed
 *
 * Throttled to 1 req/sec to be polite to BPS. Idempotent — safe to re-run.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const sequelize = require('../src/config/db');
const { QueryTypes } = require('sequelize');
const { fetchAPI } = require('../src/services/datasource/fetch.service');
const { ingestSourceMetadata } = require('../src/services/bpsMetadata');

const args = parseArgs(process.argv.slice(2));
const FETCH_DELAY_MS = 1000;
const DEFAULT_PERIOD = 2023; // BPS API requires a year placeholder; metadata is mostly year-invariant
const DEFAULT_HS = '01';

function parseArgs(argv) {
  const out = { type: null, id: null, limit: null, dry: false, retryFailed: false, staleDays: null };
  for (const a of argv) {
    if (a.startsWith('--type=')) out.type = a.slice(7);
    else if (a.startsWith('--id=')) out.id = Number(a.slice(5));
    else if (a.startsWith('--limit=')) out.limit = Number(a.slice(8));
    else if (a === '--dry') out.dry = true;
    else if (a === '--retry-failed') out.retryFailed = true;
    else if (a.startsWith('--stale-days=')) out.staleDays = Number(a.slice(13));
  }
  return out;
}

async function loadSources() {
  // Skip system markers (api_url like 'system:...') and placeholder rows
  // whose api_url isn't a real BPS API endpoint.
  const where = [
    "status = 1",
    "type IN ('static','dynamic','interop','exim')",
    "api_url LIKE 'http%'",
    "name NOT LIKE 'System:%'",
  ];
  const replacements = {};
  if (args.type) {
    where.push('type = :type');
    replacements.type = args.type;
  }
  if (args.id) {
    where.push('id = :id');
    replacements.id = args.id;
  }
  if (args.retryFailed) {
    where.push("(bps_last_metadata_status IS NULL OR bps_last_metadata_status NOT LIKE 'success%')");
  }
  if (args.staleDays != null && Number.isFinite(args.staleDays)) {
    // "Stale" = never fetched, OR fetched longer ago than N days. Letting the
    // never-fetched rows match means cron jobs naturally pick up new sources
    // without a separate first-run pass.
    where.push('(bps_last_metadata_fetch IS NULL OR bps_last_metadata_fetch < NOW() - INTERVAL :stale DAY)');
    replacements.stale = Number(args.staleDays);
  }
  const limit = args.limit ? `LIMIT ${Number(args.limit)}` : '';
  const sql = `
    SELECT id, name, type, api_url
    FROM data_sources
    WHERE ${where.join(' AND ')}
    ORDER BY type, id
    ${limit}
  `;
  return sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
}

function resolveUrl(apiUrl, period = DEFAULT_PERIOD, codeHs = DEFAULT_HS) {
  if (!apiUrl) return null;
  let u = String(apiUrl);
  u = u.replace(/\{period\}/g, String(period));
  u = u.replace(/\{code_hs\}/g, codeHs);
  return u;
}

async function processOne(source) {
  if (!source.api_url) {
    return { sourceId: source.id, type: source.type, ok: false, error: 'no api_url' };
  }
  if (args.dry) {
    return { sourceId: source.id, type: source.type, ok: true, dry: true, url: resolveUrl(source.api_url) };
  }

  // BPS returns empty payloads (and empty `var:[]` for dynamic) when the
  // requested period has no data. Metadata is still bound to the var/table,
  // but only emitted alongside data. Walk through both recent and historical
  // periods to find one with data. Static doesn't have a period dimension.
  const periods = source.type === 'static'
    ? [DEFAULT_PERIOD]
    : [2024, 2023, 2022, 2021, 2020, 2019, 2018];

  let lastErr = null;
  for (const period of periods) {
    const url = resolveUrl(source.api_url, period);
    let api;
    try {
      api = await fetchAPI(url, source.id);
    } catch (e) {
      lastErr = `fetch (${period}): ${e.message}`;
      continue;
    }
    if (api && typeof api === 'object') api.__source_url = url;

    // Try ingestion. For dynamic, if extraction returned "no metadata extracted"
    // it means var was empty for this period — walk to next period.
    // For interop/exim, metricsCount=0 also indicates empty period.
    const result = await ingestSourceMetadata(source, api).catch((e) => ({ ok: false, error: e.message }));
    if (result.ok && (source.type === 'static' || (result.metricsCount && result.metricsCount > 0))) {
      return { ...result, period };
    }
    lastErr = result.error || `empty payload at period=${period}`;
  }
  return { sourceId: source.id, type: source.type, ok: false, error: lastErr || 'all periods empty' };
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const sources = await loadSources();
  console.log(`[backfill] ${sources.length} sources to process` + (args.dry ? ' (DRY RUN)' : ''));
  console.log(`[backfill] filters:`, args);
  console.log('');

  const summary = { ok: 0, fail: 0, byType: {} };
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const result = await processOne(s);
    summary.byType[s.type] = (summary.byType[s.type] || 0) + 1;
    if (result.ok) summary.ok++;
    else summary.fail++;

    const status = result.ok ? '✓' : '✗';
    const detail = result.ok
      ? `metrics=${result.metricsCount ?? 0}${result.valueCodesCount ? ` vc=${result.valueCodesCount}` : ''}${result.hasStaticTable ? ' static' : ''}`
      : result.error;
    console.log(`[${i + 1}/${sources.length}] ${status} [${s.type}] id=${s.id} ${truncate(s.name, 60)} → ${detail}`);

    if (i < sources.length - 1) await sleep(FETCH_DELAY_MS);
  }

  console.log('');
  console.log(`[backfill] DONE — ok=${summary.ok}, fail=${summary.fail}`);
  console.log(`[backfill] by type:`, summary.byType);
  process.exit(summary.fail > 0 ? 1 : 0);
}

function truncate(s, n) {
  return String(s ?? '').length > n ? String(s).slice(0, n - 1) + '…' : String(s ?? '');
}

main().catch((e) => {
  console.error('[backfill] fatal:', e);
  process.exit(2);
});
