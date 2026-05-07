const DataPeriod = require("../../models/DataPeriod.model");
const DataSource = require("../../models/DataSource.model");
const { convertYearToBpsCode } = require("../../utils/period");
const { fetchAPI } = require("../datasource/fetch.service");

function createHttpError(status, message) {
    const err = new Error(message);
    err.status = status;
    return err;
}

function parseInteropUrlParts(apiUrl) {
    let url;
    try {
        url = new URL(apiUrl);
    } catch (e) {
        throw createHttpError(400, "Invalid interop api_url: must be a full URL");
    }

    const pathname = url.pathname;
    const match = pathname.match(/\/interoperabilitas\/datasource\/simdasi\/id\/(\d+)\/tahun\/(\{period\}|[^/]+)\/id_tabel\/([^/]+)\/wilayah\/([^/]+)\/key\/([^/]+)\/?/);
    if (!match) {
        throw createHttpError(400, "Interop api_url tidak sesuai pola. Wajib mengandung /tahun/{period}/id_tabel/<...>/wilayah/<...>/key/<...>");
    }

    const datasourceId = match[1];
    const id_tabel = match[3];
    const wilayah = match[4];
    const key = match[5];

    return {
        origin: url.origin,
        datasourceId,
        id_tabel,
        wilayah,
        key,
    };
}

function extractInteropTableListPayload(resp) {
    const blocks = resp?.data;
    if (!Array.isArray(blocks)) return null;

    for (const block of blocks) {
        if (block && Array.isArray(block.data)) {
            const first = block.data[0];
            if (first && typeof first === 'object' && ('id_tabel' in first || 'ketersediaan_tahun' in first)) {
                return block.data;
            }
        }
    }

    return null;
}

async function discoverInteropAvailableYears(source) {
    const { origin, datasourceId, id_tabel, wilayah, key } = parseInteropUrlParts(source.api_url);

    const candidates = [
        `${origin}/v1/api/interoperabilitas/datasource/simdasi/id/23/wilayah/${wilayah}/key/${key}/`,
        `${origin}/v1/api/interoperabilitas/datasource/simdasi/id/${datasourceId}/wilayah/${wilayah}/key/${key}/`,
    ];

    let lastError;
    for (const url of candidates) {
        try {
            const resp = await fetchAPI(url, source.id);
            const tableList = extractInteropTableListPayload(resp);
            if (!tableList) {
                throw createHttpError(502, 'Format response interop tidak dikenali (tidak ada daftar tabel)');
            }

            const table = tableList.find((t) => String(t?.id_tabel) === String(id_tabel));
            const years = table?.ketersediaan_tahun;
            if (!Array.isArray(years) || years.length === 0) {
                throw createHttpError(404, `ketersediaan_tahun tidak ditemukan untuk id_tabel=${id_tabel}`);
            }

            const normalized = years
                .map((y) => Number(y))
                .filter((y) => Number.isFinite(y))
                .sort((a, b) => a - b);

            if (normalized.length === 0) {
                throw createHttpError(502, 'ketersediaan_tahun ada tapi tidak valid');
            }

            return normalized;
        } catch (err) {
            lastError = err;
        }
    }

    throw lastError || createHttpError(502, 'Gagal mengambil ketersediaan_tahun interop');
}

/**
 * Discover available BPS th_id for dynamic datasources.
 * Queries BPS API: /v1/api/list/model/th/domain/{domain}/var/{var}/key/{key}/
 */
async function discoverDynamicAvailableYears(source) {
    const { api_url, metadata } = source;

    // Extract domain and var from metadata or api_url
    let domain, variable;
    if (metadata && typeof metadata === "object") {
        domain = metadata.domain || metadata.domain_id;
        variable = metadata.var || metadata.variable || metadata.var_id;
    }
    if (!domain || !variable) {
        const mDom = api_url && api_url.match(/\/domain\/(\d+)/);
        const mVar = api_url && api_url.match(/\/var\/(\d+)/);
        domain = domain || (mDom ? mDom[1] : null);
        variable = variable || (mVar ? mVar[1] : null);
    }

    // Extract API key
    let apiKey = (metadata && (metadata.key || metadata.api_key)) || null;
    if (!apiKey) {
        const mKey = api_url && api_url.match(/\/key\/([a-f0-9]{32})/i);
        apiKey = mKey ? mKey[1] : null;
    }

    if (!domain || !variable || !apiKey) {
        throw createHttpError(400, 'Missing domain/var/key in DataSource metadata or api_url for dynamic type');
    }

    // Build availability URL
    const url = `https://webapi.bps.go.id/v1/api/list/model/th/domain/${domain}/var/${variable}/key/${apiKey}/`;
    const resp = await fetchAPI(url, source.id);
    
    if (!resp || resp.status !== "OK") {
        throw createHttpError(502, 'Failed to fetch th availability from BPS API');
    }

    // Response shape: { status, data: [meta, [ { th_id, th }, ... ] ] }
    const arr = Array.isArray(resp.data) ? resp.data : [];
    const list = Array.isArray(arr[1]) ? arr[1] : [];
    
    // Extract years from th_id (convert th_id like "125" to year 2025)
    const years = list
        .map((item) => {
            const thId = item.th_id;
            const thLabel = item.th; // e.g., "2025"
            if (thLabel && /^\d{4}$/.test(String(thLabel))) {
                return Number(thLabel);
            }
            // Fallback: convert th_id to year
            if (thId && /^\d{1,3}$/.test(String(thId))) {
                return 1900 + Number(thId);
            }
            return null;
        })
        .filter((y) => y !== null && Number.isFinite(y))
        .sort((a, b) => a - b);

    if (years.length === 0) {
        throw createHttpError(404, 'Tidak ada th_id ditemukan dari BPS API');
    }

    return years;
}

async function generatePeriodMap(source_id, startYear, endYear) {
    const source = await DataSource.findByPk(source_id);
    if (!source) throw new Error("Source not found");

    const type = String(source.type || '').toLowerCase();

    let yearsToGenerate = null;
    if (type === 'interop') {
        if (Number.isFinite(startYear) && Number.isFinite(endYear)) {
            yearsToGenerate = [];
            for (let yr = startYear; yr <= endYear; yr++) yearsToGenerate.push(yr);
        } else {
            yearsToGenerate = await discoverInteropAvailableYears(source);
        }
    } else if (type === 'dynamic') {
        if (Number.isFinite(startYear) && Number.isFinite(endYear)) {
            yearsToGenerate = [];
            for (let yr = startYear; yr <= endYear; yr++) yearsToGenerate.push(yr);
        } else {
            // Auto-discover from BPS API
            yearsToGenerate = await discoverDynamicAvailableYears(source);
        }
    } else {
        // Other types: require manual start/end
        if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) {
            throw createHttpError(400, 'Query start dan end wajib diisi (contoh: ?start=2020&end=2025)');
        }
        yearsToGenerate = [];
        for (let yr = startYear; yr <= endYear; yr++) yearsToGenerate.push(yr);
    }

    for (const yr of yearsToGenerate) {

        let periodToken = String(yr);
        // Dynamic BPS uses th_id-style codes, interop uses plain year
        if (type !== 'interop') {
            periodToken = convertYearToBpsCode(yr);
        }

        const api_url = source.api_url.replace("{period}", periodToken);

        // Use findOne + create/update instead of upsert to avoid duplicates
        // (table doesn't have unique constraint on source_id + period_value)
        const existing = await DataPeriod.findOne({
            where: { source_id, period_value: yr.toString() }
        });
        
        if (existing) {
            // Update if api_url_override changed
            if (existing.api_url_override !== api_url) {
                await existing.update({ api_url_override: api_url });
            }
        } else {
            await DataPeriod.create({
                source_id,
                period_value: yr.toString(),
                api_url_override: api_url
            });
        }
    }

    return true;
}

module.exports = { generatePeriodMap };
