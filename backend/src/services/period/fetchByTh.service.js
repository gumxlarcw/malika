const { fetchAPI } = require("../datasource/fetch.service");
const DataSource = require("../../models/DataSource.model");

function buildDataUrl(domain, variable, thId, apiKey) {
  return `https://webapi.bps.go.id/v1/api/list/model/data/lang/ind/domain/${domain}/var/${variable}/th/${thId}/key/${apiKey}`;
}

async function getDomainVarKey(ds) {
  const { api_url, metadata } = ds;
  let domain = metadata?.domain || metadata?.domain_id;
  let variable = metadata?.var || metadata?.variable || metadata?.var_id;
  let apiKey = metadata?.key || metadata?.api_key;
  if (!domain) {
    const mDom = api_url && api_url.match(/\/domain\/(\d+)/);
    domain = mDom ? mDom[1] : null;
  }
  if (!variable) {
    const mVar = api_url && api_url.match(/\/var\/(\d+)/);
    variable = mVar ? mVar[1] : null;
  }
  if (!apiKey) {
    const mKey = api_url && api_url.match(/\/key\/([a-f0-9]{32})/i);
    apiKey = mKey ? mKey[1] : null;
  }
  if (!domain || !variable || !apiKey) throw new Error("Missing domain/var/key in datasource");
  return { domain, variable, apiKey };
}

// Fetch raw model/data for a given datasource and th_id
async function fetchRawByTh(sourceId, thId) {
  const ds = await DataSource.findByPk(sourceId);
  if (!ds) throw new Error("DataSource not found");
  const { domain, variable, apiKey } = await getDomainVarKey(ds);
  const url = buildDataUrl(domain, variable, thId, apiKey);
  const resp = await fetchAPI(url, sourceId);
  // Attach request context to help processors filter multi-year payloads.
  // Safe: additional property is internal and ignored by upstream.
  try {
    if (resp && typeof resp === 'object') resp.__th_id = String(thId);
  } catch {
    // ignore
  }
  return resp;
}

module.exports = { fetchRawByTh };
