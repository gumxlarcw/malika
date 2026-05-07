const DataSource = require('../../models/DataSource.model');
const { getCache, saveCache } = require('../cache/cache.service');
const processPressRelease = require('../processor/pressrelease.processor');
const { fetchPressReleasePages } = require('./list.service');
const { fetchPressReleaseDetail } = require('./detail.service');
const getSequelizeBps = require('../../config/db_bps');
const {
  replicatePressReleaseToKeywordTableBps,
  getPressReleaseKeywordTableName,
} = require('../replication/pressreleaseTableBps.service');
const { resolveBpsApiKey } = require('./apiKey.service');

function parseBoolTrue(v) {
  return String(v || '').trim().toLowerCase() === 'true';
}

function normalizeKeywordFromDatasource(ds) {
  const raw = String(ds?.api_url || '').trim();
  const kw = raw.toLowerCase().startsWith('keyword:') ? raw.slice('keyword:'.length).trim() : raw;
  return kw;
}

function safeDate(value, fallback = new Date()) {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d : fallback;
}

async function pullPressRelease({ sourceId, keywordOverride, saveToBps, forceRefresh, log }) {
  const id = Number(sourceId);
  if (!Number.isFinite(id) || id <= 0) throw new Error('Invalid sourceId');

  const emit = typeof log === 'function' ? log : null;
  const info = (m) => emit && emit(String(m));

  const source = await DataSource.findByPk(id);
  if (!source) {
    const err = new Error('Source not found');
    err.status = 404;
    throw err;
  }

  if (String(source.type || '').toLowerCase() !== 'pressrelease') {
    const err = new Error(`Invalid source type: expected pressrelease but got ${source.type}`);
    err.status = 400;
    throw err;
  }

  const keyword = String(keywordOverride || '').trim() || normalizeKeywordFromDatasource(source);
  if (!keyword) {
    const err = new Error('keyword is required (query ?keyword=... or datasource api_url "keyword:<kw>")');
    err.status = 400;
    throw err;
  }

  const cacheKey = `${keyword}`;

  info(`[pressrelease] source_id=${id} keyword=${keyword}`);

  const cache = await getCache(id, cacheKey);
  const shouldForceRefresh = String(forceRefresh || '').trim().toLowerCase() === 'true' || forceRefresh === true;
  if (cache && !shouldForceRefresh) {
    try {
      const cachedData = JSON.parse(cache.processed_json);
      info('[pressrelease] cache hit');

      let production = null;
      if (parseBoolTrue(saveToBps)) {
        try {
          const sequelizeBps = getSequelizeBps();
          if (!sequelizeBps) {
            production = {
              ok: false,
              skipped: true,
              reason: 'Koneksi data_bps tidak tersedia (cek DB_BPS_* env)',
              tableName: getPressReleaseKeywordTableName(keyword),
            };
          } else {
            await sequelizeBps.authenticate();
            const cachedRows = Array.isArray(cachedData?.data) ? cachedData.data : [];
            production = await replicatePressReleaseToKeywordTableBps({
              sequelizeBps,
              keyword,
              sourceId: id,
              rows: cachedRows,
              lastUpdate: cachedData?.last_update || null,
            });
          }
        } catch (e) {
          production = {
            ok: false,
            skipped: false,
            error: e?.message || String(e),
            tableName: getPressReleaseKeywordTableName(keyword),
          };
        }
      }

      return { cached: true, updated: false, data: cachedData, production, keyword };
    } catch {
      info('[pressrelease] cache parse failed; refetch');
    }
  }

  // If forced refresh and cache exists, keep a snapshot of previous brs_ids for notification diffing.
  let prevIds = [];
  let prevMaxRlDate = null;
  if (cache && shouldForceRefresh) {
    try {
      const cachedData = JSON.parse(cache.processed_json);
      const rows = Array.isArray(cachedData?.data) ? cachedData.data : [];
      prevIds = rows.map((r) => Number(r?.brs_id)).filter((n) => Number.isFinite(n));

      // Determine newest release date in previous cache to avoid emitting notifications for older backfill.
      const dates = rows
        .map((r) => (r && r.rl_date ? new Date(String(r.rl_date)) : null))
        .filter((d) => d && !Number.isNaN(d.getTime()))
        .map((d) => d.getTime());
      if (dates.length > 0) {
        prevMaxRlDate = new Date(Math.max(...dates));
      }

      info(`[pressrelease] force refresh enabled; previous ids=${prevIds.length}`);
    } catch {
      // ignore
    }
  }

  info('[pressrelease] cache miss; fetching from API');

  const api_key = await resolveBpsApiKey();
  if (!api_key) {
    throw new Error(
      'BPS API key belum dikonfigurasi. Set env BPS_API_KEY (disarankan) atau pastikan ada datasource lain yang api_url-nya mengandung "/key/<api_key>/" untuk dijadikan fallback.'
    );
  }

  const { brs_ids: allBrsIds, list_by_id: listById } = await fetchPressReleasePages({
    source_id: id,
    keyword,
    domain_id: 8200,
    api_key,
    prev_ids: prevIds && prevIds.length > 0 ? prevIds : null,
  });

  if (!allBrsIds || allBrsIds.length === 0) {
    const emptyResult = {
      source: `Press Release - ${keyword}`,
      period: new Date().toISOString(),
      columns: [
        { key: 'brs_id', label: 'ID' },
        { key: 'title', label: 'Judul' },
        { key: 'rl_date', label: 'Tanggal Rilis' },
        { key: 'abstract', label: 'Abstrak' },
        { key: 'subcsa', label: 'Kategori' },
        { key: 'pdf_url', label: 'PDF' },
        { key: 'slide_url', label: 'Slide' },
        { key: 'thumbnail_url', label: 'Thumbnail' },
      ],
      data: [],
      last_update: new Date().toISOString(),
    };

    await saveCache(id, cacheKey, emptyResult);

    return { cached: false, updated: true, data: emptyResult, production: null, keyword };
  }

  const detailsData = await fetchPressReleaseDetail({
    source_id: id,
    brs_ids: allBrsIds,
    source,
    domain_id: 8200,
    api_key,
  });

  const processed = processPressRelease({
    keyword,
    detailsById: detailsData,
    listById,
    last_update: new Date().toISOString(),
  });

  await saveCache(id, cacheKey, processed);

  // Emit notifications for newly discovered pressreleases (best-effort)
  try {
    if (prevIds && prevIds.length > 0) {
      const nextIds = Array.isArray(allBrsIds) ? allBrsIds : [];
      const prevSet = new Set(prevIds.map(String));
      const maxNew = Math.max(1, Math.min(200, Number(process.env.PRESSRELEASE_NOTIFICATIONS_MAX_NEW || 50)));
      const newIds = nextIds.filter((x) => !prevSet.has(String(x))).slice(0, maxNew);

      if (newIds.length > 0) {
        const { createNotification } = require('../notification/notification.service');

        // Rely on ID-diffing (prevIds) so multiple items on the same rl_date are still notified.
        for (const brsId of newIds) {
          const listItem = listById && listById[String(brsId)] ? listById[String(brsId)] : null;
          const title = listItem?.title ? String(listItem.title) : `Press Release ${brsId}`;
          const rlDate = listItem?.rl_date ? String(listItem.rl_date) : null;
          const pdf = listItem?.pdf_url ? String(listItem.pdf_url) : null;

          // Guardrail: avoid emitting notifications for older backfill items.
          // We still allow multiple same-day items because the dedupe key is per brs_id.
          if (prevMaxRlDate) {
            const d = rlDate ? new Date(rlDate) : null;
            const safe = d && !Number.isNaN(d.getTime()) ? d : null;
            if (!safe) continue;
            if (safe.getTime() < prevMaxRlDate.getTime()) continue;
          }

          await createNotification({
            uniqueKey: `pressrelease:${String(keyword).toLowerCase()}:${brsId}`,
            type: 'pressrelease',
            title: 'Berita Resmi Statistik',
            message: `${title} — ketuk untuk baca`,
            link: `/brs?brs_id=${encodeURIComponent(String(brsId))}`,
            metadata: { source_id: id, keyword, brs_id: brsId, rl_date: rlDate, pdf_url: pdf },
            createdAt: rlDate,
          });
        }
      }
    } else if (shouldForceRefresh && (!prevIds || prevIds.length === 0)) {
      // First ever refresh (or cache parse failed) - create a single summary notification.
      const { createNotification } = require('../notification/notification.service');
      await createNotification({
        uniqueKey: `pressrelease:init:${String(keyword).toLowerCase()}:${processed.last_update}`,
        type: 'pressrelease',
        title: 'Berita Resmi Statistik diperbarui',
        message: 'Berita Resmi Statistik diperbarui — ketuk untuk baca',
        link: '/brs',
        metadata: { source_id: id, keyword, count: Array.isArray(processed?.data) ? processed.data.length : 0 },
      });
    }
  } catch {
    // best-effort
  }

  let production = null;
  if (parseBoolTrue(saveToBps)) {
    try {
      const sequelizeBps = getSequelizeBps();
      if (!sequelizeBps) {
        production = {
          ok: false,
          skipped: true,
          reason: 'Koneksi data_bps tidak tersedia (cek DB_BPS_* env)',
          tableName: getPressReleaseKeywordTableName(keyword),
        };
      } else {
        await sequelizeBps.authenticate();
        production = await replicatePressReleaseToKeywordTableBps({
          sequelizeBps,
          keyword,
          sourceId: id,
          rows: processed.data,
          lastUpdate: processed.last_update,
        });
      }
    } catch (e) {
      production = {
        ok: false,
        skipped: false,
        error: e?.message || String(e),
        tableName: getPressReleaseKeywordTableName(keyword),
      };
    }
  }

  // Ensure last_update is parseable if needed downstream.
  processed.last_update = safeDate(processed.last_update).toISOString();

  return { cached: false, updated: true, data: processed, production, keyword };
}

module.exports = {
  pullPressRelease,
};
