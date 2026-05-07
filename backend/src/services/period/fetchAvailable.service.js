const { fetchAPI } = require("../datasource/fetch.service");
const DataSource = require("../../models/DataSource.model");
const DataPeriod = require("../../models/DataPeriod.model");
const { findLatestAvailableEximYear } = require("../exim/eximYearDiscovery.service");

// Fetch available years (th) for a datasource's domain+var from BPS API
// Returns array of strings like ["2025","2024", ...]
async function fetchAvailablePeriodsForSource(sourceId) {
  const ds = await DataSource.findByPk(sourceId);
  if (!ds) throw new Error("DataSource not found");

  const dsType = String(ds.type || "dynamic").toLowerCase();
  if (dsType === "exim") {
    // Year discovery for EXIM needs a sample HS2 code when the datasource is a
    // template/master URL containing `{code_hs}`.
    const apiUrl = String(ds?.api_url || "");
    const md = ds?.metadata && typeof ds.metadata === "object" ? ds.metadata : null;

    let probeHs2 = null;
    if (md) {
      probeHs2 = md.code_hs ?? md.codeHs ?? md.hs2 ?? md.default_code_hs ?? md.defaultHs2 ?? null;
    }

    let codeHs = undefined;
    if (apiUrl.includes("{code_hs}")) {
      const raw = String(probeHs2 || "01").trim();
      codeHs = /^\d+$/.test(raw) ? raw.padStart(2, "0") : raw;
    }

    const latest = await findLatestAvailableEximYear({
      ds,
      sourceId: Number(sourceId),
      startYear: 2020,
      codeHs,
    });
    if (!latest) return [];
    const out = [];
    for (let y = 2020; y <= latest; y++) {
      out.push({ th_id: String(y), year: String(y) });
    }
    return out;
  }

  // Prefer locally generated period map (data_period_map) to avoid slow/fragile
  // upstream availability calls during search previews.
  try {
    const maps = await DataPeriod.findAll({
      where: { source_id: Number(sourceId) },
      attributes: ["period_value"],
      order: [["period_value", "DESC"]],
    });

    const periodValues = maps
      .map((m) => String(m?.period_value || "").trim())
      .filter(Boolean);

    const uniqueValues = Array.from(new Set(periodValues));
    if (uniqueValues.length > 0) {
      // IMPORTANT: data_period_map.period_value meaning depends on datasource type:
      // - dynamic: it's usually BPS th_id (3-digit like 125) whose label/year is 4-digit (2025)
      // - interop: it's usually the real year (4-digit)
      // Some older maps might store 4-digit year for dynamic; normalize it here to avoid
      // producing 4-digit th_id in merged/replicated outputs.
      if (dsType === 'dynamic') {
        return uniqueValues
          .map((raw) => {
            const s = String(raw);
            if (/^\d{1,3}$/.test(s)) {
              const n = Number(s);
              const year = Number.isFinite(n) ? String(1900 + n) : s;
              return { th_id: s, year };
            }
            if (/^\d{4}$/.test(s)) {
              const y = Number(s);
              const th = Number.isFinite(y) ? String(y - 1900) : s;
              return { th_id: th, year: s };
            }
            return { th_id: s, year: s };
          })
          .filter((x) => x.th_id && x.year);
      }

      // Default: treat map values as already-year-like.
      return uniqueValues.map((y) => ({ th_id: y, year: y }));
    }
  } catch {
    // Best-effort only; fall back to upstream availability discovery.
  }

  const { api_url, metadata } = ds;
  // Expect metadata to contain domain and var codes; fallback by parsing api_url
  let domain, variable;
  if (metadata && typeof metadata === "object") {
    domain = metadata.domain || metadata.domain_id;
    variable = metadata.var || metadata.variable || metadata.var_id;
  }
  if (!domain || !variable) {
    // Try to parse from api_url patterns
    // e.g. .../domain/8200/var/378/...
    const mDom = api_url && api_url.match(/\/domain\/(\d+)/);
    const mVar = api_url && api_url.match(/\/var\/(\d+)/);
    domain = domain || (mDom ? mDom[1] : null);
    variable = variable || (mVar ? mVar[1] : null);
  }
  if (!domain || !variable) {
    throw new Error("Missing domain/var in DataSource metadata or api_url");
  }

  // Build availability URL: /v1/api/list/model/th/domain/{domain}/var/{var}/key/{key}/
  // API key: prefer ds.api_key in metadata; else try to parse from api_url
  let apiKey = (metadata && (metadata.key || metadata.api_key)) || null;
  if (!apiKey) {
    const mKey = api_url && api_url.match(/\/key\/([a-f0-9]{32})/i);
    apiKey = mKey ? mKey[1] : null;
  }
  if (!apiKey) throw new Error("Missing BPS API key for datasource");

  const url = `https://webapi.bps.go.id/v1/api/list/model/th/domain/${domain}/var/${variable}/key/${apiKey}/`;
  const resp = await fetchAPI(url, sourceId);
  if (!resp || resp.status !== "OK") {
    throw new Error("Failed to fetch availability from BPS");
  }

  // Response shape: { status, data: [meta, [ { th_id, th }, ... ] ] }
  const arr = Array.isArray(resp.data) ? resp.data : [];
  const list = Array.isArray(arr[1]) ? arr[1] : [];
  // Return richer objects { th_id, year }
  return list
    .map((item) => ({ th_id: item.th_id, year: String(item.th || "") }))
    .filter((x) => x.year);
}

module.exports = { fetchAvailablePeriodsForSource };

// Fetch available months for a given year for the datasource
// Returns array like ["01","02", ...]
async function fetchAvailableMonthsForSource(sourceId, year) {
  const ds = await DataSource.findByPk(sourceId);
  if (!ds) throw new Error("DataSource not found");
  const { api_url, metadata } = ds;
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
  let apiKey = (metadata && (metadata.key || metadata.api_key)) || null;
  if (!apiKey) {
    const mKey = api_url && api_url.match(/\/key\/([a-f0-9]{32})/i);
    apiKey = mKey ? mKey[1] : null;
  }
  if (!domain || !variable || !apiKey) throw new Error("Missing domain/var/key");
  if (!year) throw new Error("Missing year for month availability");

  // BPS month availability: model/bln with th/{year}
  const url = `https://webapi.bps.go.id/v1/api/list/model/bln/domain/${domain}/var/${variable}/th/${year}/key/${apiKey}/`;
  const resp = await fetchAPI(url, sourceId);
  if (!resp || resp.status !== "OK") throw new Error("Failed to fetch month availability");
  const arr = Array.isArray(resp.data) ? resp.data : [];
  const list = Array.isArray(arr[1]) ? arr[1] : [];
  // API returns objects with bln like "01"; map accordingly
  return list.map((item) => item.bln || item.bulan || item.month).filter(Boolean);
}

module.exports.fetchAvailableMonthsForSource = fetchAvailableMonthsForSource;
