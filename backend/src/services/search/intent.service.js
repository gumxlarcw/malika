const { Op } = require('sequelize');
const crypto = require('crypto');
const DataSource = require('../../models/DataSource.model');
const DataPeriod = require('../../models/DataPeriod.model');
const { searchDatasources } = require('./datasourceSearch.service');
const { buildQueryFromText } = require('../ai/queryBuilder.service');
const { indicatorTableExistsInBps } = require('../bpsRead/indicatorAvailability.service');
const logger = require('../../utils/logger');
const { intentStats } = require('./intentStats.service');
const { rankByQuery, applyClickPrior, deriveConfidence } = require('./fulltextRanker');
const { recordDivergence } = require('./shadowLogger.service');

// Production guardrail: exclude noisy indicators from intent selection.
const IGNORED_SOURCE_IDS = new Set([166, 167, 168, 169]);

function normalizeText(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function shouldLogIntent() {
  const raw = String(process.env.SEARCH_INTENT_LOG || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function getLogSampleRate() {
  const raw = String(process.env.SEARCH_INTENT_LOG_SAMPLE_RATE || '').trim();
  if (!raw) return 1;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(1, n));
}

function shouldSample(rate) {
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  return Math.random() < rate;
}

function getReasonStatsEvery() {
  const raw = String(process.env.SEARCH_INTENT_REASON_STATS_EVERY || '').trim();
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(5000, Math.max(10, n));
}


function hashQuery(q) {
  const s = String(q || '');
  if (!s) return '';
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
}

function isValidMonth(month) {
  return Number.isInteger(month) && month >= 1 && month <= 12;
}

function extractMentionedMonthsFromText(query) {
  const raw = String(query || '').toLowerCase();
  const months = new Set();
  if (!raw) return months;

  const monthMap = {
    januari: 1,
    jan: 1,
    februari: 2,
    feb: 2,
    maret: 3,
    mar: 3,
    april: 4,
    apr: 4,
    mei: 5,
    juni: 6,
    jun: 6,
    juli: 7,
    jul: 7,
    agustus: 8,
    agu: 8,
    ags: 8,
    september: 9,
    sep: 9,
    oktober: 10,
    okt: 10,
    november: 11,
    nov: 11,
    desember: 12,
    des: 12,
  };

  for (const [name, no] of Object.entries(monthMap)) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(raw)) months.add(no);
  }

  // Numeric patterns: YYYY-MM / YYYY/MM
  for (const m of raw.matchAll(/\b(19\d{2}|20\d{2}|2100)\s*[-\/]\s*(0?[1-9]|1[0-2])\b/g)) {
    const mo = Number(m[2]);
    if (Number.isInteger(mo) && mo >= 1 && mo <= 12) months.add(mo);
  }
  // Numeric patterns: MM-YYYY / MM/YYYY
  for (const m of raw.matchAll(/\b(0?[1-9]|1[0-2])\s*[-\/]\s*(19\d{2}|20\d{2}|2100)\b/g)) {
    const mo = Number(m[1]);
    if (Number.isInteger(mo) && mo >= 1 && mo <= 12) months.add(mo);
  }

  return months;
}

function resolveSingleMonthForLink(query, monthFromQb) {
  const months = extractMentionedMonthsFromText(query);
  if (months.size > 1) return null;
  if (months.size === 1) return Array.from(months)[0];
  return monthFromQb;
}

function pickYear(params) {
  const year = Number(params?.year);
  if (Number.isInteger(year) && year >= 1900 && year <= 2100) return year;
  return null;
}

function pickMonth(params) {
  const month = Number(params?.month);
  return isValidMonth(month) ? month : null;
}

function pickTimeFromClauses(clauses) {
  const list = Array.isArray(clauses) ? clauses : [];
  for (const c of list) {
    if (!c || String(c.kind || '').toLowerCase() !== 'time') continue;
    const year = Number(c.year);
    const month = Number(c.month);
    const y = Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null;
    const m = isValidMonth(month) ? month : null;
    if (y) return { year: y, month: m };
  }
  return { year: null, month: null };
}

function pickGeoFromClauses(clauses) {
  const list = Array.isArray(clauses) ? clauses : [];
  for (const c of list) {
    if (!c || String(c.kind || '').toLowerCase() !== 'geo') continue;
    const name = String(c.name || c.text || '').trim();
    if (name) return name;
  }
  return null;
}

function normalizeQueryBuilder(qb) {
  if (!qb || typeof qb !== 'object') return qb;
  const params = qb.params && typeof qb.params === 'object' ? { ...qb.params } : {};

  // Older/newer query builder outputs may place time/geo in clauses instead of params.
  // Promote them into params so downstream logic remains stable.
  const pYear = pickYear(params);
  const pMonth = pickMonth(params);
  const fromClauses = pickTimeFromClauses(qb.clauses);
  if (!pYear && fromClauses.year) params.year = fromClauses.year;
  if (!pMonth && fromClauses.month) params.month = fromClauses.month;

  if (!params.geo) {
    const geo = pickGeoFromClauses(qb.clauses);
    if (geo) params.geo = geo;
  }

  return { ...qb, params };
}

function normalizeEximMetric(metric) {
  const m = String(metric || '').toLowerCase();
  if (m === 'value' || m === 'nilai') return 'value';
  if (m === 'netweight' || m === 'volume' || m === 'berat' || m === 'netto' || m === 'berat bersih') return 'netweight';
  return null;
}

function normalizeEximGroup(group) {
  const g = String(group || '').toLowerCase();
  if (!g) return null;
  if (g === 'hs2' || g === 'hs' || g === 'commodity' || g === 'komoditas') return 'hs2';
  if (g === 'pod' || g === 'pelabuhan' || g === 'port') return 'pod';
  if (g === 'ctr' || g === 'negara' || g === 'country') return 'ctr';
  if (g === 'detail') return 'detail';
  if (g === 'hs2ctr') return 'hs2ctr';
  if (g === 'hs2pod') return 'hs2pod';
  return null;
}

function inferEximGroupFromText(query, qb) {
  const q = String(query || '').toLowerCase();
  if (!q) return null;

  // Prefer explicit "menurut/by" phrasing when present.
  if (/\b(menurut|berdasarkan|berdasar|per|by)\s+(negara|country|ctr)\b/i.test(q)) return 'ctr';
  if (/\b(menurut|berdasarkan|berdasar|per|by)\s+(pelabuhan|port|pod)\b/i.test(q)) return 'pod';
  if (/\b(menurut|berdasarkan|berdasar|per|by)\s+(komoditas|barang|hs2|hs)\b/i.test(q)) return 'hs2';

  const clauses = Array.isArray(qb?.clauses) ? qb.clauses : [];
  const dimNames = clauses
    .filter((c) => c && String(c.kind || '').toLowerCase() === 'dimension')
    .map((c) => String(c.name || c.text || '').toLowerCase());
  const dimJoined = dimNames.join(' | ');

  if (/\b(negara|country|ctr)\b/i.test(q) || /\b(negara|country|ctr)\b/i.test(dimJoined)) return 'ctr';
  if (/\b(pelabuhan|port|pod)\b/i.test(q) || /\b(pelabuhan|port|pod)\b/i.test(dimJoined)) return 'pod';
  if (/\b(komoditas|barang|hs2|kode\s*hs|kodehs|\bhs\b)\b/i.test(q) || /\b(komoditas|barang|hs2|hs)\b/i.test(dimJoined)) return 'hs2';

  // Multi-dimension hints.
  const mentionsHs = /\b(komoditas|barang|hs2|kode\s*hs|kodehs|\bhs\b)\b/i.test(q);
  const mentionsCtr = /\b(negara|country|ctr)\b/i.test(q) || /\bnegara\s*(asal|tujuan)\b/i.test(q) || /\b(asal|tujuan)\b/i.test(q);
  const mentionsPod = /\b(pelabuhan|port|pod)\b/i.test(q);
  const hasLinker = /\b(dan|&)\b/i.test(q);
  if (hasLinker && mentionsHs && mentionsCtr && !mentionsPod) return 'hs2ctr';
  if (hasLinker && mentionsHs && mentionsPod && !mentionsCtr) return 'hs2pod';
  if (hasLinker && mentionsCtr && mentionsPod && !mentionsHs) return 'detail';

  return null;
}

function normalizeCodeHs(code_hs) {
  const raw = String(code_hs || '').trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '').slice(0, 2);
  if (digits.length === 2) return digits;
  return null;
}

function ensureTypeIsAllowed(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'dynamic' || t === 'interop' || t === 'static' || t === 'exim' || t === 'pressrelease') return t;
  return null;
}

function computeDeepLinkPlan({ q, qb, mapped }) {
  const query = String(q || '').trim();
  const type = ensureTypeIsAllowed(qb?.type);
  const intent = String(qb?.intent || '').toLowerCase();
  const params = qb?.params || {};
  const year = pickYear(params);
  const monthQb = pickMonth(params);
  const month = resolveSingleMonthForLink(query, monthQb);
  const geo = params?.geo ? String(params.geo).trim() : '';

  const canDeepLinkData = intent === 'data' && year;

  if (!type || intent !== 'data') {
    return {
      action: 'search',
      href: `/search?q=${encodeURIComponent(query)}`,
      reason: 'NOT_DATA_INTENT',
    };
  }

  if (!canDeepLinkData) {
    return {
      action: 'search',
      href: `/search?q=${encodeURIComponent(query)}`,
      reason: 'MISSING_YEAR',
    };
  }

  if (!mapped?.source_id) {
    return {
      action: 'search',
      href: `/search?q=${encodeURIComponent(query)}`,
      reason: 'NO_DATASOURCE_MATCH',
    };
  }

  if (type === 'exim') {
    const metric = normalizeEximMetric(params.metric);
    const inferredGroup = inferEximGroupFromText(query, qb);
    const group = inferredGroup || normalizeEximGroup(params.group);
    const code_hs = normalizeCodeHs(params.code_hs);
    const pod = params.pod ? String(params.pod).trim() : null;
    const ctr = params.ctr ? String(params.ctr).trim() : null;

    const qp = new URLSearchParams();
    qp.set('source_id', String(mapped.source_id));
    qp.set('type', 'exim');
    qp.set('period', String(year));
    if (month) qp.set('month', String(month));
    // If user doesn't specify metric, show both (value + netweight) in one table.
    if (metric) qp.set('metric', metric);
    if (group) qp.set('group', group);
    if (code_hs) qp.set('code_hs', code_hs);
    if (pod) qp.set('pod', pod);
    if (ctr) qp.set('ctr', ctr);
    return {
      action: 'deeplink',
      href: `/data?${qp.toString()}`,
      reason: 'OK',
    };
  }

  const qp = new URLSearchParams();
  qp.set('source_id', String(mapped.source_id));
  if (type === 'dynamic' || type === 'interop' || type === 'static') qp.set('type', type);
  qp.set('period', String(year));
  if (month) qp.set('month', String(month));
  if (geo && type !== 'static') qp.set('geo', geo);
  return {
    action: 'deeplink',
    href: `/data?${qp.toString()}`,
    reason: 'OK',
  };
}

function getMinConfidenceForDeeplink() {
  const raw = process.env.SEARCH_INTENT_MIN_CONFIDENCE_FOR_DEEPLINK;
  if (raw == null || String(raw).trim() === '') return 0.55;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0.55;
  return Math.max(0, Math.min(1, n));
}

async function pickFirstAvailableInBps(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  const top = list.slice(0, 6);
  for (const c of top) {
    const sid = Number(c?.id);
    if (!Number.isFinite(sid) || sid <= 0) continue;
    const avail = await indicatorTableExistsInBps({ sourceId: sid });
    if (avail?.available) return sid;
  }
  return null;
}

async function mapDatasourceFromQuery({ q, qb }) {
  const type = ensureTypeIsAllowed(qb?.type);
  const query = String(q || '').trim();
  const norm = normalizeText(query);

  if (type === 'exim') {
    const isImport = /\bimpor\b/.test(norm) || /\bimport\b/.test(norm);
    const isExport = /\bekspor\b/.test(norm) || /\bexport\b/.test(norm);

    if (isImport !== isExport) {
      const keyword = isImport ? 'impor' : 'ekspor';
      const ds = await DataSource.findOne({
        where: {
          type: 'exim',
          visible: true,
          status: true,
          id: { [Op.notIn]: Array.from(IGNORED_SOURCE_IDS) },
          name: { [Op.like]: `%${keyword}%` },
        },
        attributes: ['id'],
        order: [['display_order', 'ASC'], ['id', 'ASC']],
      });
      if (ds?.id) return { source_id: ds.id, strategy: 'EXIM_NAME_KEYWORD', type: 'exim' };
    }

    const ranked = await searchDatasources({ q: query, limit: 10 });
    const rankedFiltered = ranked.filter((r) => !IGNORED_SOURCE_IDS.has(Number(r?.id)));
    const exim = rankedFiltered.find((r) => r.type === 'exim');
    if (exim) {
      // Prefer a datasource that exists in data_bps (if configured)
      const preferred = await pickFirstAvailableInBps(rankedFiltered.filter((r) => r.type === 'exim'));
      if (preferred) return { source_id: preferred, strategy: 'RANKED_BPS_AVAILABLE', type: 'exim' };
      return { source_id: exim.id, strategy: 'RANKED_SEARCH', type: 'exim' };
    }

    return { source_id: null, strategy: 'NO_MATCH', type: type || null };
  }

  const ranked = await searchDatasources({ q: query, limit: 10 });
  const rankedFiltered = ranked.filter((r) => !IGNORED_SOURCE_IDS.has(Number(r?.id)));
  const byType = rankedFiltered.filter((r) => (type ? r.type === type : true));
  const preferred = await pickFirstAvailableInBps(byType);
  if (preferred) return { source_id: preferred, strategy: 'RANKED_BPS_AVAILABLE', type: type || null };

  const pick = rankedFiltered.find((r) => r.type === type) || rankedFiltered[0];
  if (!pick) return { source_id: null, strategy: 'NO_MATCH' };
  return {
    source_id: pick.id,
    strategy: pick.type === type ? 'RANKED_TYPE_MATCH' : 'RANKED_FALLBACK',
    type: pick.type || type || null,
  };
}

function inferYearFromText(q) {
  const s = String(q || '');
  const m = s.match(/\b(19\d{2}|20\d{2}|2100)\b/);
  if (!m) return null;
  const y = Number(m[1]);
  if (!Number.isFinite(y)) return null;
  return y;
}

function inferMonthFromText(q) {
  const norm = normalizeText(q);
  if (!norm) return null;
  const monthMap = {
    januari: 1,
    februari: 2,
    maret: 3,
    april: 4,
    mei: 5,
    juni: 6,
    juli: 7,
    agustus: 8,
    september: 9,
    oktober: 10,
    november: 11,
    desember: 12,
  };
  for (const [name, no] of Object.entries(monthMap)) {
    if (norm.includes(name)) return no;
  }
  return null;
}

function inferIntentFromText(q) {
  const norm = normalizeText(q);
  if (!norm) return 'search';
  const hasYear = Boolean(inferYearFromText(norm));
  const wantsLink = /\b(link|tautan)\b/.test(norm) || /\bbuat\s+link\b/.test(norm) || /\blink\s+data\b/.test(norm);
  const wantsData = /\b(data|tampilkan|lihat|grafik|trend|tren|indikator)\b/.test(norm);
  if (hasYear && (wantsLink || wantsData)) return 'data';
  return 'search';
}

function buildDeterministicQueryBuilder({ q, mappedType }) {
  const query = String(q || '').trim();
  const year = inferYearFromText(query);
  const month = inferMonthFromText(query);
  const intent = inferIntentFromText(query);

  const type = ensureTypeIsAllowed(mappedType);
  // Conservative confidence: allow deeplink only when year exists.
  const confidence = year && intent === 'data' && type ? 0.66 : 0.4;

  return {
    version: 1,
    intent,
    type: type || 'unknown',
    confidence,
    params: {
      q: query,
      year: year || null,
      month: month || null,
      geo: null,
      group: null,
      metric: null,
      code_hs: null,
      pod: null,
      ctr: null,
    },
    clauses: [],
  };
}

async function checkPeriodExists({ source_id, year, month }) {
  if (!source_id || !year) return null;

  const candidates = [];
  const y = Number(year);
  candidates.push(String(y));

  const three = y - 1900;
  if (three >= 0 && three <= 999) candidates.push(String(three));

  if (isValidMonth(month)) {
    const m = String(month).padStart(2, '0');
    candidates.push(`${y}${m}`);
    candidates.push(`${three}${m}`);
  }

  const rows = await DataPeriod.findAll({
    where: {
      source_id,
      period_value: { [Op.in]: candidates },
    },
    attributes: ['period_value'],
    limit: 3,
  });

  return rows && rows.length > 0;
}

async function resolveSearchIntent({ q, context = '', noLlm = false }) {
  const query = String(q || '').trim();
  if (!query || query.length < 2) {
    return {
      ok: true,
      query,
      query_builder: null,
      datasource: null,
      plan: { action: 'search', href: `/search?q=${encodeURIComponent(query)}`, reason: 'EMPTY_QUERY' },
    };
  }

  let qbRaw = null;
  let qb = null;

  // 1) Try LLM query builder (best quality), but keep a DB-only deterministic fallback.
  //    When noLlm=true, skip the LLM call entirely — deterministic path only.
  if (!noLlm) {
    try {
      qbRaw = await buildQueryFromText({ q: query, context });
      qb = normalizeQueryBuilder(qbRaw);
    } catch {
      qbRaw = null;
      qb = null;
    }
  }

  // 2) Always map datasource candidates from DB ranking.
  const mapped = await mapDatasourceFromQuery({ q: query, qb });

  // SHADOW MODE (Phase 4): run the new ranker in parallel, record divergence.
  // Users still receive the OLD result (mapped, above). No user-visible behavior change.
  if (process.env.SEARCH_SHADOW_MODE === '1') {
    try {
      const newCandidates = await rankByQuery({ q: query, limit: 25 });
      const ranked = applyClickPrior(newCandidates);
      const newTop = ranked[0] || null;

      recordDivergence({
        q: query,
        oldSourceId: mapped?.source_id ?? null,
        newSourceId: newTop?.id ?? null,
        oldType: mapped?.type ?? null,
        newType: newTop?.type ?? null,
        newTop1Score: newTop?.effective_score ?? null,
        newConfidence: deriveConfidence(ranked),
      });
    } catch (e) {
      // Shadow errors MUST NOT affect user-facing behavior
      console.warn('[intent] shadow mode error:', e?.message || String(e));
    }
  }

  // 3) If query builder failed, synthesize a minimal QB from deterministic parsing + mapped type.
  if (!qb) {
    qb = buildDeterministicQueryBuilder({ q: query, mappedType: mapped?.type || null });
  }

  const year = pickYear(qb?.params);
  const month = pickMonth(qb?.params);

  let periodExists = null;
  if (mapped?.source_id && year) {
    periodExists = await checkPeriodExists({ source_id: mapped.source_id, year, month });
  }

  // If qb.type is missing/unknown but we have a mapped datasource type, use it.
  if (qb && (String(qb.type || '').toLowerCase() === 'unknown' || !ensureTypeIsAllowed(qb.type))) {
    qb.type = ensureTypeIsAllowed(mapped?.type) || qb.type;
  }

  let plan = computeDeepLinkPlan({ q: query, qb, mapped });

  // Guardrail: if the model is not confident, never deep-link.
  // This keeps routing deterministic and avoids sending users to the wrong /data page.
  const conf = typeof qb?.confidence === 'number' ? qb.confidence : null;
  const minConf = getMinConfidenceForDeeplink();
  if (conf != null && conf < minConf) {
    plan = {
      action: 'search',
      href: `/search?q=${encodeURIComponent(query)}`,
      reason: 'LOW_CONFIDENCE',
    };
  }

  // Guardrail: only deep-link to /data when the indicator is available in data_bps.
  // This prevents accidental fallback to upstream/nationwide sources and improves accuracy.
  let dataBps = null;
  if (mapped?.source_id && plan?.action === 'deeplink') {
    const t = String(qb?.type || '').toLowerCase();
    if (t === 'dynamic' || t === 'interop' || t === 'static' || t === 'exim') {
      dataBps = await indicatorTableExistsInBps({ sourceId: mapped.source_id });
      if (!dataBps?.available) {
        plan = {
          action: 'search',
          href: `/search?q=${encodeURIComponent(query)}`,
          reason: dataBps?.reason || 'DATA_BPS_NOT_AVAILABLE',
        };
      }
    }
  }

  // Always record per-process stats (safe: no raw query stored).
  // This is independent of SEARCH_INTENT_LOG so the admin stats endpoint works by default.
  try {
    intentStats.record({ action: plan?.action || '', reason: plan?.reason || '' });
  } catch {
    // ignore
  }

  if (shouldLogIntent()) {
    try {
      const statsEvery = getReasonStatsEvery();
      const resolved = intentStats.getResolvedCount();
      if (statsEvery > 0 && resolved % statsEvery === 0) {
        logger.info(
          {
            event: 'search_intent_stats',
            ...intentStats.snapshot(),
          },
          'search intent stats'
        );
      }

      const sampleRate = getLogSampleRate();
      if (!shouldSample(sampleRate)) {
        return {
          ok: true,
          query,
          query_builder: qb,
          datasource: {
            source_id: mapped.source_id,
            strategy: mapped.strategy,
            periodExists,
            data_bps: dataBps,
          },
          plan,
        };
      }

      const conf = typeof qb?.confidence === 'number' ? qb.confidence : null;
      logger.info(
        {
          event: 'search_intent_resolved',
          q_hash: hashQuery(query),
          q_len: query.length,
          qb_intent: qb?.intent || null,
          qb_type: qb?.type || null,
          qb_confidence: conf,
          qb_year: pickYear(qb?.params),
          qb_month: pickMonth(qb?.params),
          mapped_source_id: mapped?.source_id || null,
          mapped_strategy: mapped?.strategy || null,
          period_exists: periodExists,
          plan_action: plan?.action || null,
          plan_reason: plan?.reason || null,
          data_bps_available: dataBps?.available ?? null,
          data_bps_reason: dataBps?.reason ?? null,
          sample_rate: sampleRate,
        },
        'search intent resolved'
      );
    } catch {
      // ignore logging failures
    }
  }

  return {
    ok: true,
    query,
    query_builder: qb,
    datasource: {
      source_id: mapped.source_id,
      strategy: mapped.strategy,
      periodExists,
      data_bps: dataBps,
    },
    plan,
  };
}

async function buildDatasourceCandidates({ q, qb, limit = 20 }) {
  const query = String(q || '').trim();
  const max = Math.min(50, Math.max(1, Number.parseInt(String(limit || 20), 10) || 20));

  const qs = [query];
  const type = String(qb?.type || '').toLowerCase();
  const dir = String(qb?.params?.direction || '').toLowerCase();
  if (type === 'exim') {
    for (const f of ['exim', dir === 'impor' ? 'exim impor' : null, dir === 'ekspor' ? 'exim ekspor' : null, dir === 'impor' ? 'impor' : null, dir === 'ekspor' ? 'ekspor' : null]) {
      if (f && !qs.includes(f)) qs.push(f);
    }
  }

  const merged = new Map();
  for (const dq of qs) {
    const items = await searchDatasources({ q: dq, limit: 25 });
    for (const it of items) {
      const prev = merged.get(it.id);
      if (!prev) merged.set(it.id, it);
      else {
        merged.set(it.id, {
          ...prev,
          score: Math.max(prev.score || 0, it.score || 0),
          periodHit: Boolean(prev.periodHit || it.periodHit),
        });
      }
    }
  }

  // Check if user specified a year in query
  const hasYearInQuery = /\b(19\d{2}|20\d{2}|2100)\b/.test(query);
  const hasQuarterInQuery = /\b(triwulan|kuartal|q[1-4])\b/i.test(query);
  
  // When NO year is specified, prefer datasources with smaller granularity (quarterly > yearly)
  // and newer data. Fetch granularity + latest year for all candidates.
  const candidateIds = Array.from(merged.keys());
  if (candidateIds.length > 0 && !hasYearInQuery) {
    try {
      // Batch query to get granularity and latest period for all candidates
      const periodRows = await DataPeriod.findAll({
        where: { source_id: { [Op.in]: candidateIds } },
        attributes: ['source_id', 'granularity', 'period_value'],
        order: [['period_value', 'DESC']],
      });

      // Build map of source_id -> { granularity, latestYear }
      const metaBySource = new Map();
      for (const row of periodRows) {
        const sid = row.source_id;
        if (metaBySource.has(sid)) continue; // Already have latest for this source
        const pv = String(row.period_value || '');
        // Extract year from period_value (could be "2025", "202504", etc.)
        const yearMatch = pv.match(/^(20\d{2}|19\d{2})/);
        const latestYear = yearMatch ? Number(yearMatch[1]) : null;
        metaBySource.set(sid, {
          granularity: row.granularity || 'yearly',
          latestYear,
        });
      }

      // Granularity priority: smaller = better (when no period specified)
      const granularityScore = {
        monthly: 20,    // Most granular - highest boost
        quarterly: 15,  // Second most granular
        semester: 8,    // Semi-annual
        yearly: 0,      // Default, no boost
      };

      // Apply granularity + recency boost
      const currentYear = new Date().getFullYear();
      for (const [id, item] of merged) {
        const meta = metaBySource.get(id);
        if (!meta) continue;

        // Granularity boost
        const gScore = granularityScore[meta.granularity] || 0;
        if (gScore > 0) {
          item.score = (item.score || 0) + gScore;
        }

        // Recency boost: prefer datasources with more recent data
        // This ensures "kemiskinan" prefers ID 451 (2025) over ID 429 (2023)
        if (meta.latestYear) {
          // Calculate recency boost based on how recent the data is
          // Current year (2026) or last year (2025): full boost
          // 2 years ago (2024): partial boost
          // 3+ years ago: no boost
          const yearsOld = currentYear - meta.latestYear;
          let recencyBoost = 0;
          
          if (yearsOld <= 0) {
            // Current year data - highest boost
            recencyBoost = meta.granularity === 'quarterly' ? 15 : 10;
          } else if (yearsOld === 1) {
            // Last year data (e.g., 2025 when current is 2026) - good boost
            recencyBoost = meta.granularity === 'quarterly' ? 12 : 8;
          } else if (yearsOld === 2) {
            // 2 years old - small boost
            recencyBoost = 3;
          }
          // 3+ years old: no boost (yearsOld >= 3)
          
          if (recencyBoost > 0) {
            item.score = (item.score || 0) + recencyBoost;
          }
        }

        // Store latest year for reference
        item.latestYear = meta.latestYear;
        item.granularity = meta.granularity;
      }
    } catch (err) {
      // Best-effort, don't fail the search
      console.error('[buildDatasourceCandidates] granularity lookup error:', err.message);
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => {
      if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
      return a.id - b.id;
    })
    .slice(0, max);
}

module.exports = {
  resolveSearchIntent,
  buildDatasourceCandidates,
};
