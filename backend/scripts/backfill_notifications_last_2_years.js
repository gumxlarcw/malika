/* eslint-disable no-console */

// Backfill notifications (pressrelease, publication, data) for the last 2 years.
// - Uses created_at = event date (rl_date/last_update) so default ordering works.
// - Uses push=false to avoid spamming.
// - Creates only missing notifications (unique_key dedupe).

const DataSource = require('../src/models/DataSource.model');
const MergedCache = require('../src/models/MergedCache.model');
const Notification = require('../src/models/Notification.model');
const { Op } = require('sequelize');

const { resolveBpsApiKey } = require('../src/services/pressrelease/apiKey.service');
const { fetchPressReleasePages } = require('../src/services/pressrelease/list.service');
const { ensurePublicationSystemDatasource } = require('../src/services/publication/systemDatasource.service');
const { fetchPublicationPage } = require('../src/services/publication/list.service');
const { createNotification } = require('../src/services/notification/notification.service');

function isoDateOnly(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

function parseDate(value) {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function cutoffDate2y(now = new Date()) {
  const d = new Date(now);
  d.setFullYear(d.getFullYear() - 2);
  return d;
}

function stripTitleDateSuffix(title) {
  const t = title == null ? '' : String(title);
  // Matches: "X • 2025-01-03" (with optional spaces)
  return t.replace(/\s*•\s*\d{4}-\d{2}-\d{2}\s*$/u, '').trim();
}

function inferPressreleaseKeyword(ds) {
  const apiUrl = ds?.api_url != null ? String(ds.api_url).trim() : '';
  if (apiUrl) {
    const lower = apiUrl.toLowerCase();
    if (lower.startsWith('keyword:')) {
      const kw = apiUrl.slice('keyword:'.length).trim();
      if (kw) return kw;
    }

    // Some deployments store api_url as the keyword itself for pressrelease sources.
    if (!lower.startsWith('http://') && !lower.startsWith('https://') && apiUrl.length <= 200) {
      return apiUrl;
    }

    // Or store a full BPS API url containing /keyword/<kw>/
    const mUrl = apiUrl.match(/\/keyword\/([^\/]+)\//i);
    if (mUrl && mUrl[1]) return decodeURIComponent(mUrl[1]);
  }

  const fromPeriodKey = ds?.period_key != null ? String(ds.period_key).trim() : '';
  if (fromPeriodKey) return fromPeriodKey;

  const fromCategory = ds?.category != null ? String(ds.category).trim() : '';
  if (fromCategory) return fromCategory;

  const name = ds?.name != null ? String(ds.name) : '';
  // e.g. "BRS: inflasi" or "Press Release - inflasi"
  if (name.includes(':')) {
    const tail = name.split(':').slice(1).join(':').trim();
    if (tail) return tail;
  }
  const mName = name.match(/press\s*release\s*[-–—]\s*([\w\- ]+)/i);
  if (mName && mName[1]) return mName[1].trim();

  return null;
}

async function backfillPressrelease({ cutoff, apiKey }) {
  const sources = await DataSource.findAll({ where: { type: 'pressrelease' }, order: [['id', 'ASC']] });

  let created = 0;
  let skippedExisting = 0;
  let totalCandidates = 0;

  for (const ds of sources) {
    const kw = inferPressreleaseKeyword(ds);
    if (!kw) {
      console.warn('[backfill][pressrelease] skip datasource without keyword:', ds?.id);
      continue;
    }

    console.log(`[backfill][pressrelease] datasource=${ds.id} keyword=${kw}`);

    const { brs_ids, list_by_id } = await fetchPressReleasePages({
      source_id: ds.id,
      keyword: kw,
      domain_id: 8200,
      api_key: apiKey,
    });

    const rows = (Array.isArray(brs_ids) ? brs_ids : [])
      .map((id) => {
        const item = list_by_id && (list_by_id[id] || list_by_id[String(id)]) ? (list_by_id[id] || list_by_id[String(id)]) : null;
        if (!item) return null;
        const rl = item?.rl_date ? String(item.rl_date) : null;
        const rlDt = parseDate(rl);
        if (!rlDt) return null;
        if (rlDt < cutoff) return null;
        return {
          brs_id: id,
          title: item?.title ? String(item.title) : `Press Release ${id}`,
          rl_date: rl,
          pdf_url: item?.pdf_url ? String(item.pdf_url) : (item?.pdf ? String(item.pdf) : null),
        };
      })
      .filter(Boolean)
      .sort((a, b) => (parseDate(b.rl_date) - parseDate(a.rl_date)));

    totalCandidates += rows.length;

    for (const it of rows) {
      const title = it.title.length > 255 ? it.title.slice(0, 255) : it.title;
      const dateStr = it.rl_date;
      const eventDt = parseDate(dateStr) || new Date();

      const result = await createNotification({
        uniqueKey: `pressrelease:${String(kw).toLowerCase()}:${it.brs_id}`,
        type: 'pressrelease',
        title: 'Berita Resmi Statistik',
        message: `${title} — ketuk untuk baca`,
        link: `/brs?brs_id=${encodeURIComponent(String(it.brs_id))}`,
        metadata: {
          source_id: ds.id,
          keyword: kw,
          brs_id: it.brs_id,
          rl_date: dateStr,
          pdf_url: it.pdf_url,
        },
        push: false,
        createdAt: eventDt,
      });

      if (result.created) created++;
      else skippedExisting++;
    }
  }

  return { created, skippedExisting, totalCandidates, sources: sources.length };
}

async function backfillPublication({ cutoff, apiKey }) {
  // Ensure system datasource exists so fetch logs have valid FK.
  const pubDs = await ensurePublicationSystemDatasource();

  let created = 0;
  let skippedExisting = 0;
  let totalCandidates = 0;

  // Fetch pages until everything in a page is older than cutoff (sorted desc by upstream, but we still guard).
  const maxPages = 200;
  for (let page = 1; page <= maxPages; page++) {
    const { items } = await fetchPublicationPage({ source_id: Number(pubDs.id), domain_id: 8200, page, api_key: apiKey });
    const rows = (Array.isArray(items) ? items : [])
      .map((x) => {
        const pub_id = x?.pub_id != null ? String(x.pub_id) : null;
        if (!pub_id) return null;
        const rl = x?.rl_date != null ? String(x.rl_date) : null;
        const rlDt = parseDate(rl);
        if (!rlDt) return null;
        if (rlDt < cutoff) return null;
        return {
          pub_id,
          title: x?.title != null ? String(x.title) : `Publikasi ${pub_id}`,
          rl_date: rl,
          pdf_url: x?.pdf != null ? String(x.pdf) : null,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (parseDate(b.rl_date) - parseDate(a.rl_date)));

    if (rows.length === 0) {
      // If upstream list is sorted by rl_date desc, once a page has no rows in range, we can stop.
      break;
    }

    totalCandidates += rows.length;

    for (const it of rows) {
      const itemTitle = it.title || `Publikasi ${it.pub_id}`;
      const title = itemTitle.length > 255 ? itemTitle.slice(0, 255) : itemTitle;
      const dateStr = it.rl_date;
      const eventDt = parseDate(dateStr) || new Date();

      const result = await createNotification({
        uniqueKey: `publication:${it.pub_id}`,
        type: 'publication',
        title: 'Publikasi',
        message: `${title} — ketuk untuk lihat`,
        link: `/publikasi?pub_id=${encodeURIComponent(String(it.pub_id))}`,
        metadata: {
          domain_id: 8200,
          pub_id: it.pub_id,
          rl_date: dateStr,
          pdf_url: it.pdf_url,
        },
        push: false,
        createdAt: eventDt,
      });

      if (result.created) created++;
      else skippedExisting++;
    }
  }

  return { created, skippedExisting, totalCandidates };
}

async function backfillData({ cutoff }) {
  let created = 0;
  let skippedExisting = 0;

  const BATCH = 500;
  let cursorLastUpdate = null;
  let cursorId = null;
  let candidates = 0;

  while (true) {
    const where = {
      last_update: { [Op.gte]: cutoff },
    };

    if (cursorLastUpdate) {
      where[Op.or] = [
        { last_update: { [Op.lt]: cursorLastUpdate } },
        { last_update: cursorLastUpdate, id: { [Op.lt]: cursorId } },
      ];
    }

    const batch = await MergedCache.findAll({
      where,
      order: [['last_update', 'DESC'], ['id', 'DESC']],
      limit: BATCH,
    });

    if (!batch || batch.length === 0) break;
    candidates += batch.length;

    const uniqueSourceIds = Array.from(new Set(batch.map((x) => Number(x.source_id)).filter((x) => Number.isFinite(x))));
    const dsRows = uniqueSourceIds.length
      ? await DataSource.findAll({ where: { id: { [Op.in]: uniqueSourceIds } }, attributes: ['id', 'name'] })
      : [];
    const dsNameById = new Map(dsRows.map((x) => [Number(x.id), x.name != null ? String(x.name).trim() : null]));

    for (const r of batch) {
      const sourceId = r.source_id;
      const signature = r.signature || 'all';
      const lastUpdate = r.last_update;
      const iso = lastUpdate instanceof Date ? lastUpdate.toISOString() : new Date(lastUpdate).toISOString();
      const dateStr = isoDateOnly(lastUpdate);

      const indicatorName = dsNameById.get(Number(sourceId)) || null;

      const result = await createNotification({
        uniqueKey: `merged:${sourceId}:${signature}:${iso}`,
        type: 'data',
        title: 'Data Statistik',
        message: indicatorName ? `${indicatorName} diperbarui` : 'Data Statistik diperbarui',
        link: '/',
        metadata: { source_id: sourceId, signature, last_update: iso },
        push: false,
        createdAt: lastUpdate,
      });

      if (result.created) created++;
      else skippedExisting++;
    }

    const last = batch[batch.length - 1];
    cursorLastUpdate = last.last_update;
    cursorId = last.id;
  }

  return { created, skippedExisting, candidates };
}

async function normalizeCreatedAtExisting() {
  // Optional: make existing notifications order correctly by setting created_at = event date.
  // pressrelease/publication use metadata.rl_date, data uses metadata.last_update.
  const all = await Notification.findAll({ where: { type: ['pressrelease', 'publication', 'data'] } });
  let updated = 0;

  const dsNameCache = new Map();

  for (const row of all) {
    let meta = null;
    try {
      meta = row.metadata_json ? JSON.parse(row.metadata_json) : null;
    } catch {
      meta = null;
    }

    const type = row.type;
    const target = type === 'data' ? parseDate(meta?.last_update) || null : parseDate(meta?.rl_date) || null;

    const current = row.created_at ? new Date(row.created_at) : null;
    const currentDay = current && !Number.isNaN(current.getTime()) ? isoDateOnly(current) : null;
    const targetDay = target ? isoDateOnly(target) : null;

    const nextTitle = stripTitleDateSuffix(row.title);
    const titleChanged = nextTitle && nextTitle !== String(row.title || '');
    const dateChanged = target && targetDay && currentDay !== targetDay;

    // Normalize Data Statistik message to use datasource name (avoid numeric indicator wording)
    // Only touch rows emitted by merged/automation to avoid altering manual/test notifications.
    const uniqueKey = row.unique_key != null ? String(row.unique_key) : '';
    const shouldNormalizeDataMessage =
      type === 'data' &&
      (uniqueKey.startsWith('merged:') || uniqueKey.startsWith('automation:merged:'));

    let messageChanged = false;
    let nextMessage = null;

    if (shouldNormalizeDataMessage) {
      const sourceId = Number(meta?.source_id);
      if (Number.isFinite(sourceId) && sourceId > 0) {
        let dsName = dsNameCache.get(sourceId);
        if (dsName === undefined) {
          try {
            const ds = await DataSource.findByPk(sourceId, { attributes: ['id', 'name'] });
            dsName = ds && ds.name != null ? String(ds.name).trim() : null;
          } catch {
            dsName = null;
          }
          dsNameCache.set(sourceId, dsName);
        }

        if (dsName) {
          const expected = `${dsName} diperbarui`;
          const currentMsg = row.message != null ? String(row.message) : '';
          if (currentMsg !== expected && (/^Indikator\s+\d+\s+diperbarui$/u.test(currentMsg) || currentMsg === 'Data Statistik diperbarui' || !currentMsg)) {
            nextMessage = expected;
            messageChanged = true;
          }
        }
      }
    }

    if (!titleChanged && !dateChanged && !messageChanged) continue;

    const patch = {};
    if (titleChanged) patch.title = nextTitle;
    if (dateChanged) patch.created_at = target;
    if (messageChanged) patch.message = nextMessage;

    await row.update(patch);
    updated++;
  }

  return { scanned: all.length, updated };
}

(async () => {
  const now = new Date();
  const cutoff = cutoffDate2y(now);
  console.log('[backfill] cutoff >=', cutoff.toISOString().slice(0, 10));

  const normalizeOnly = process.argv.includes('--normalize-only');

  const apiKey = await resolveBpsApiKey();
  if (!apiKey) throw new Error('BPS API key not configured (resolveBpsApiKey returned null).');

  const pr = normalizeOnly ? { skipped: true } : await backfillPressrelease({ cutoff, apiKey });
  const pub = normalizeOnly ? { skipped: true } : await backfillPublication({ cutoff, apiKey });
  const data = normalizeOnly ? { skipped: true } : await backfillData({ cutoff });
  const normalize = await normalizeCreatedAtExisting();

  console.log(JSON.stringify({ ok: true, pressrelease: pr, publication: pub, data, normalize }, null, 2));

  await Notification.sequelize.close();
})();
