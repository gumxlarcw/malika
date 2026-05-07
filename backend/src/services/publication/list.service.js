const { fetchAPI } = require('../datasource/fetch.service');

function buildPublicationListUrl({ domain_id, page, api_key }) {
  return `https://webapi.bps.go.id/v1/api/list/model/publication/domain/${domain_id}/key/${api_key}/page/${page}`;
}

function parsePublicationListResponse(raw) {
  const meta = raw?.data?.[0] || null;
  const items = Array.isArray(raw?.data?.[1]) ? raw.data[1] : [];
  return { meta, items };
}

async function fetchPublicationPage({ source_id = null, domain_id = 8200, page = 1, api_key }) {
  const url = buildPublicationListUrl({ domain_id, page, api_key });
  const raw = await fetchAPI(url, source_id);
  return parsePublicationListResponse(raw);
}

module.exports = {
  fetchPublicationPage,
};
