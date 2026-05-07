/**
 * Fetch list pressrelease dengan strategi stop-early:
 * - Selalu mulai dari page 1 (umumnya sudah berisi item terbaru)
 * - Jika ada prev_ids (dari cache), lanjut fetch page berikutnya sampai:
 *   - 1 page tidak punya item baru (semua brs_id sudah ada di prev_ids), atau
 *   - mencapai batas max pages scan
 *
 * Ini lebih ringan daripada fetch semua halaman, tapi tetap aman ketika ada lonjakan item baru
 * yang mendorong sebagian item baru ke page 2/3.
 */

const { fetchAPI } = require("../datasource/fetch.service");

function buildListUrl({ domain_id, page, keyword, api_key }) {
    return `https://webapi.bps.go.id/v1/api/list/model/pressrelease/domain/${domain_id}/page/${page}/keyword/${encodeURIComponent(
        keyword
    )}/key/${api_key}/`;
}

async function fetchPressReleasePages({ source_id, keyword, domain_id = 8200, api_key, prev_ids = null }) {
    if (!api_key || !String(api_key).trim()) {
        throw new Error("BPS API key not set or invalid");
    }
    const kw = String(keyword || "").trim();
    if (!kw) throw new Error("keyword is required");

    const listById = {};

    try {
        const page1Url = buildListUrl({ domain_id, page: 1, keyword: kw, api_key });
        console.log(`[PressRelease] Fetching list page 1 for keyword: ${kw}`);
        const page1 = await fetchAPI(page1Url, source_id);

        if (!page1?.data || !Array.isArray(page1.data) || page1.data.length < 2) {
            console.warn("[PressRelease] Invalid list response structure");
            return { brs_ids: [], list_by_id: {}, meta: null };
        }

        const meta = page1.data[0] || {};
        const totalPages = Math.max(1, Number(meta.pages) || 1);
        console.log(`[PressRelease] Total pages: ${totalPages}, total items: ${meta.total}`);

        // Stop-early scanning settings
        const prevSet = Array.isArray(prev_ids) && prev_ids.length > 0 ? new Set(prev_ids.map((x) => String(x))) : null;
        const maxPagesScan = Math.max(1, Math.min(200, Number(process.env.PRESSRELEASE_MAX_PAGES_SCAN || 20)));
        const pagesToScan = Math.min(totalPages, maxPagesScan);

        const brsIds = [];

        function ingestPage(pageResult) {
            if (!pageResult?.data || !Array.isArray(pageResult.data) || pageResult.data.length < 2) return { count: 0, newCount: 0 };
            const items = pageResult.data[1];
            if (!Array.isArray(items)) return { count: 0, newCount: 0 };

            let count = 0;
            let newCount = 0;
            for (const item of items) {
                if (!item?.brs_id) continue;
                const id = Number(item.brs_id);
                if (!Number.isFinite(id)) continue;
                count += 1;
                brsIds.push(id);
                listById[id] = item;
                if (prevSet && !prevSet.has(String(id))) newCount += 1;
            }
            return { count, newCount };
        }

        // Ingest page 1 (already fetched)
        const page1Ingest = ingestPage(page1);

        // If we don't have a previous snapshot to compare, page 1 is enough.
        if (!prevSet) {
            const unique = [...new Set(brsIds)];
            console.log(`[PressRelease] Collected items (page=1): ${unique.length}`);
            return { brs_ids: unique, list_by_id: listById, meta };
        }

        // Otherwise, keep fetching pages until a page has no new IDs.
        for (let page = 2; page <= pagesToScan; page += 1) {
            try {
                const url = buildListUrl({ domain_id, page, keyword: kw, api_key });
                const pageRes = await fetchAPI(url, source_id);
                const { newCount } = ingestPage(pageRes);
                if (newCount === 0) {
                    console.log(`[PressRelease] Stop early at page ${page} (no new items)`);
                    break;
                }
            } catch (err) {
                console.warn(`[PressRelease] Error fetching page ${page}:`, err.message);
                break;
            }
        }

        const unique = [...new Set(brsIds)];
        console.log(`[PressRelease] Total unique items collected: ${unique.length}`);

        return { brs_ids: unique, list_by_id: listById, meta };
    } catch (err) {
        console.error("[PressRelease] List fetch error:", err.message);
        throw err;
    }
}

module.exports = { fetchPressReleasePages };
