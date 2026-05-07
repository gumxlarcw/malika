const { fetchAPI } = require("../datasource/fetch.service");

function buildEximUrl(ds, year, codeHs) {
  let url = String(ds?.api_url || "");
  url = url.replace("{period}", String(year));

  if (url.includes("{code_hs}")) {
    if (!codeHs) {
      const err = new Error("EXIM membutuhkan code_hs (URL masih mengandung {code_hs})");
      err.status = 400;
      throw err;
    }
    url = url.replace("{code_hs}", String(codeHs));
  }

  return url;
}

function responseHasData(resp) {
  const ok = resp && resp.status === "OK";
  if (!ok) return false;
  const availability = String(resp["data-availability"] || "").toLowerCase();
  if (availability && availability !== "available") return false;
  const rows = Array.isArray(resp.data) ? resp.data : [];
  return rows.length > 0;
}

async function findLatestAvailableEximYear({ ds, sourceId, startYear = 2020, endYear = new Date().getFullYear(), codeHs }) {
  for (let y = endYear; y >= startYear; y--) {
    const url = buildEximUrl(ds, y, codeHs);
    const resp = await fetchAPI(url, sourceId);
    if (responseHasData(resp)) return y;
  }
  return null;
}

module.exports = {
  buildEximUrl,
  responseHasData,
  findLatestAvailableEximYear,
};
