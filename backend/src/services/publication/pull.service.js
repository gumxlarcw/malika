const { getCache, saveCache } = require('../cache/cache.service');
const { resolveBpsApiKey } = require('../pressrelease/apiKey.service');
const { fetchPublicationPage } = require('./list.service');
const { ensurePublicationSystemDatasource } = require('./systemDatasource.service');

function safeDate(value, fallback = null) {
  const d = value ? new Date(value) : null;
  if (d && !Number.isNaN(d.getTime())) return d;
  return fallback;
}

function normalizeItems(items) {
  const rows = Array.isArray(items) ? items : [];
  return rows
    .map((x) => {
      const pub_id = x?.pub_id != null ? String(x.pub_id) : null;
      if (!pub_id) return null;
      return {
        pub_id,
        title: x?.title != null ? String(x.title) : null,
        abstract: x?.abstract != null ? String(x.abstract) : null,
        rl_date: x?.rl_date != null ? String(x.rl_date) : null,
        cover: x?.cover != null ? String(x.cover) : null,
        pdf: x?.pdf != null ? String(x.pdf) : null,
        size: x?.size != null ? String(x.size) : null,
      };
    })
    .filter(Boolean);
}

async function pullPublications({
  domainId = 8200,
  forceRefresh,
  log,
} = {}) {
  const domain_id = Number(domainId) || 8200;
  const emit = typeof log === 'function' ? log : null;
  const info = (m) => emit && emit(String(m));

  const ds = await ensurePublicationSystemDatasource();

  const cacheKey = `publication:domain:${domain_id}`;
  const cacheSourceId = Number(ds.id);
  const fetchLogSourceId = Number(ds.id);

  const cache = await getCache(cacheSourceId, cacheKey);
  const shouldForceRefresh = String(forceRefresh || '').trim().toLowerCase() === 'true' || forceRefresh === true;

  if (cache && !shouldForceRefresh) {
    try {
      const cachedData = JSON.parse(cache.processed_json);
      info('[publication] cache hit');
      return { cached: true, updated: false, data: cachedData, domain_id };
    } catch {
      info('[publication] cache parse failed; refetch');
    }
  }

  let prevIds = [];
  let prevMaxRlDate = null;
  if (cache && shouldForceRefresh) {
    try {
      const cachedData = JSON.parse(cache.processed_json);
      const rows = normalizeItems(cachedData?.items);
      prevIds = rows.map((r) => String(r.pub_id));
      const dates = rows
        .map((r) => safeDate(r?.rl_date, null))
        .filter(Boolean)
        .map((d) => d.getTime());
      if (dates.length > 0) prevMaxRlDate = new Date(Math.max(...dates));
      info(`[publication] force refresh enabled; previous ids=${prevIds.length}`);
    } catch {
      // ignore
    }
  }

  const api_key = await resolveBpsApiKey();
  if (!api_key) {
    throw new Error(
      'BPS API key belum dikonfigurasi. Set env BPS_API_KEY (disarankan) atau pastikan ada datasource lain yang api_url-nya mengandung "/key/<api_key>/" untuk dijadikan fallback.'
    );
  }

  info('[publication] fetching from API (page=1)');
  const { meta, items } = await fetchPublicationPage({
    source_id: fetchLogSourceId,
    domain_id,
    page: 1,
    api_key,
  });

  const prevSet = prevIds && prevIds.length > 0 ? new Set(prevIds.map(String)) : null;
  const maxPagesScan = Math.max(1, Math.min(200, Number(process.env.PUBLICATION_MAX_PAGES_SCAN || 10)));
  const totalPages = Math.max(1, Number(meta?.pages) || 1);
  const pagesToScan = Math.min(totalPages, maxPagesScan);

  const allItems = Array.isArray(items) ? items.slice() : [];

  // Stop-early: if we have a previous snapshot (force refresh), scan next pages
  // until we hit a page with no new pub_id.
  if (prevSet && pagesToScan > 1) {
    for (let page = 2; page <= pagesToScan; page += 1) {
      try {
        info(`[publication] scanning page=${page}`);
        const next = await fetchPublicationPage({ source_id: fetchLogSourceId, domain_id, page, api_key });
        const nextItems = Array.isArray(next?.items) ? next.items : [];
        allItems.push(...nextItems);

        const normalizedNext = normalizeItems(nextItems);
        const newCount = normalizedNext.filter((x) => x?.pub_id && !prevSet.has(String(x.pub_id))).length;
        if (newCount === 0) {
          info(`[publication] stop early at page=${page} (no new items)`);
          break;
        }
      } catch (e) {
        info(`[publication] stop scanning (page=${page}) due to error: ${e?.message || String(e)}`);
        break;
      }
    }
  }

  const normalized = normalizeItems(allItems);
  const sorted = normalized.slice().sort((a, b) => {
    const da = Date.parse(a?.rl_date || '') || 0;
    const db = Date.parse(b?.rl_date || '') || 0;
    return db - da;
  });

  const payload = {
    meta,
    items: sorted,
    last_update: new Date().toISOString(),
  };

  await saveCache(cacheSourceId, cacheKey, payload);

  // Emit notifications for newly discovered publications (best-effort)
  try {
    const { createNotification } = require('../notification/notification.service');

    if (prevIds && prevIds.length > 0) {
      const prevSet = new Set(prevIds.map(String));
      const maxNew = Math.max(1, Math.min(200, Number(process.env.PUBLICATION_NOTIFICATIONS_MAX_NEW || 50)));
      const newItems = sorted.filter((x) => !prevSet.has(String(x.pub_id))).slice(0, maxNew);

      // Rely on ID-diffing (prevIds) so multiple items on the same rl_date are still notified.
      for (const it of newItems) {
        const itemTitle = it?.title ? String(it.title) : `Publikasi ${it.pub_id}`;
        const rlDate = it?.rl_date ? String(it.rl_date) : null;
        const pdf = it?.pdf ? String(it.pdf) : null;

        await createNotification({
          uniqueKey: `publication:${it.pub_id}`,
          type: 'publication',
          title: 'Publikasi',
          message: `${itemTitle} — ketuk untuk lihat`,
          link: `/publikasi?pub_id=${encodeURIComponent(String(it.pub_id))}`,
          metadata: {
            domain_id,
            pub_id: it.pub_id,
            rl_date: rlDate,
            pdf_url: pdf,
          },
          createdAt: rlDate,
        });
      }
    } else if (shouldForceRefresh && (!prevIds || prevIds.length === 0)) {
      const latest = sorted && sorted.length > 0 ? sorted[0] : null;
      if (latest?.pub_id) {
        const itemTitle = latest?.title ? String(latest.title) : `Publikasi ${latest.pub_id}`;
        const rlDate = latest?.rl_date ? String(latest.rl_date) : null;
        const pdf = latest?.pdf ? String(latest.pdf) : null;

        await createNotification({
          uniqueKey: `publication:${latest.pub_id}`,
          type: 'publication',
          title: 'Publikasi',
          message: `${itemTitle} — ketuk untuk lihat`,
          link: `/publikasi?pub_id=${encodeURIComponent(String(latest.pub_id))}`,
          metadata: {
            domain_id,
            pub_id: latest.pub_id,
            rl_date: rlDate,
            pdf_url: pdf,
            kind: 'publication:init:latest',
          },
          createdAt: rlDate,
        });
      }
    }
  } catch {
    // best-effort
  }

  return { cached: false, updated: true, data: payload, domain_id };
}

module.exports = {
  pullPublications,
};
