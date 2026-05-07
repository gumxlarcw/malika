const { fetchAPI } = require("../datasource/fetch.service");
const processExim = require("../processor/exim.processor");
const { buildEximUrl, responseHasData } = require("./eximYearDiscovery.service");

function parseSumberFromApiUrl(apiUrl) {
  const m = String(apiUrl || "").match(/\/sumber\/(\d{1,2})\b/i);
  return m ? Number(m[1]) : null;
}

function buildMasterUrlFromTemplate(templateUrl, year, hs2) {
  return String(templateUrl || "")
    .replace("{period}", String(year))
    .replace("{code_hs}", String(hs2));
}

async function mapWithConcurrency(items, limit, worker) {
  const arr = Array.isArray(items) ? items : [];
  const cap = Math.max(1, Number(limit) || 1);

  let idx = 0;
  const results = new Array(arr.length);

  const runners = Array.from({ length: Math.min(cap, arr.length) }, async () => {
    while (idx < arr.length) {
      const cur = idx++;
      try {
        results[cur] = await worker(arr[cur], cur);
      } catch (e) {
        results[cur] = { __error: e };
      }
    }
  });

  await Promise.all(runners);
  return results;
}

function monthNoToLabel(monthNo) {
  const n = Number(monthNo);
  if (!Number.isFinite(n) || n < 1 || n > 12) return null;
  const names = [
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember",
  ];
  return `[${n}] ${names[n - 1]}`;
}

/**
 * Build an aggregated (ALL HS2) EXIM dataset for a master datasource.
 *
 * Output is a small table per month:
 * - Bulan (label)
 * - month_no
 * - value
 * - netweight
 */
async function buildEximAllHs2Summary({ source, sourceId, year }) {
  const ds = source;
  const y = String(year || "").trim();
  if (!y) throw new Error("Missing year");

  const apiUrlTemplate = String(ds?.api_url || "");
  if (!apiUrlTemplate.includes("{code_hs}")) {
    // Not a master datasource; caller should use normal flow.
    const err = new Error("Datasource bukan EXIM master");
    err.status = 400;
    throw err;
  }

  const hs2List = Array.from({ length: 99 }, (_, idx) => String(idx + 1).padStart(2, "0"));

  const totalsByMonth = new Map();

  await mapWithConcurrency(hs2List, 6, async (hs2) => {
    // Avoid buildEximUrl() since it throws if code_hs missing; we already have hs2 here.
    const url = buildMasterUrlFromTemplate(apiUrlTemplate, y, hs2);

    const resp = await fetchAPI(url, sourceId);
    if (!responseHasData(resp)) return null;

    const processed = processExim(resp, { year: y });
    const rows = Array.isArray(processed?.data) ? processed.data : [];

    for (const r of rows) {
      const m = Number(r?.month_no);
      if (!Number.isFinite(m) || m < 1 || m > 12) continue;

      const value = Number(r?.value);
      const netweight = Number(r?.netweight);

      const cur = totalsByMonth.get(m) || { value: 0, netweight: 0 };
      if (Number.isFinite(value)) cur.value += value;
      if (Number.isFinite(netweight)) cur.netweight += netweight;
      totalsByMonth.set(m, cur);
    }

    return null;
  });

  const data = Array.from(totalsByMonth.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([month_no, sums]) => ({
      Bulan: monthNoToLabel(month_no) || String(month_no),
      month_no,
      pod: null,
      ctr: null,
      kodehs: "ALL HS2",
      value: Number.isFinite(sums?.value) ? sums.value : null,
      netweight: Number.isFinite(sums?.netweight) ? sums.netweight : null,
    }));

  // Keep the same column set as processExim() to minimize UI assumptions.
  return {
    period: y,
    columns: ["Bulan", "pod", "ctr", "kodehs", "value", "netweight"],
    labels: {
      value: "Value",
      netweight: "Netweight",
      kodehs: "Kode HS",
      pod: "POD",
      ctr: "CTR",
    },
    data,
    source: "EXIM",
    last_update: null,
    meta: {
      mode: "all_hs2_summary",
      sumber: parseSumberFromApiUrl(apiUrlTemplate),
    },
  };
}

module.exports = {
  buildEximAllHs2Summary,
};
