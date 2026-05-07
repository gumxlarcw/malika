const MONTH_ORDER = [
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

function parseMonthLabel(raw) {
  const s = typeof raw === "string" ? raw : "";
  // Expected: "[10] Oktober"
  const match = s.match(/\[(\d{1,2})\]\s*(.+)$/);
  if (!match) return { month_no: null, month_raw: s, month_name: s };
  const monthNo = Number(match[1]);
  const monthName = String(match[2] || "").trim();
  return {
    month_no: Number.isFinite(monthNo) ? monthNo : null,
    month_raw: s,
    month_name: monthName || s,
  };
}

module.exports = function processExim(api, opts = {}) {
  const year = String(opts.year || api?.tahun || "");
  const meta = api?.metadata && typeof api.metadata === "object" ? api.metadata : {};

  const rows = Array.isArray(api?.data) ? api.data : [];

  // Keep pod/ctr/kodehs rows (do NOT aggregate away dimensions).
  // Aggregation (if desired) is done later when building merged cache.
  const data = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const { month_no, month_raw } = parseMonthLabel(r.bulan);
    data.push({
      Bulan: month_raw,
      month_no,
      kodehs: typeof r.kodehs === 'string' ? r.kodehs : (r.kodehs != null ? String(r.kodehs) : null),
      pod: typeof r.pod === 'string' ? r.pod : (r.pod != null ? String(r.pod) : null),
      ctr: typeof r.ctr === 'string' ? r.ctr : (r.ctr != null ? String(r.ctr) : null),
      value: Number.isFinite(Number(r.value)) ? Number(r.value) : null,
      netweight: Number.isFinite(Number(r.netweight)) ? Number(r.netweight) : null,
    });
  }

  data.sort((a, b) => {
    const an = a.month_no;
    const bn = b.month_no;
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    if (Number.isFinite(an)) return -1;
    if (Number.isFinite(bn)) return 1;
    return MONTH_ORDER.indexOf(a.Bulan) - MONTH_ORDER.indexOf(b.Bulan);
  });

  // Upstream EXIM responses often do not provide a reliable last_update.
  // Derive a stable pseudo-last_update from the latest available period (year + max month_no with any data).
  // This enables schedulers/watchers to detect when a new month appears.
  let derivedLastUpdate = null;
  try {
    const yearNum = Number(year);
    if (Number.isFinite(yearNum) && yearNum >= 2000) {
      let maxMonthNo = null;
      for (const r of data) {
        if (!r) continue;
        const hasAnyValue = r.value != null || r.netweight != null;
        if (!hasAnyValue) continue;
        const mn = Number(r.month_no);
        if (!Number.isFinite(mn)) continue;
        if (maxMonthNo == null || mn > maxMonthNo) maxMonthNo = mn;
      }

      if (maxMonthNo != null) {
        // Use last day-of-month in UTC as a monotonic marker.
        derivedLastUpdate = new Date(Date.UTC(yearNum, maxMonthNo, 0, 0, 0, 0));
      }
    }
  } catch {
    derivedLastUpdate = null;
  }

  return {
    period: year,
    columns: ["Bulan", "pod", "ctr", "kodehs", "value", "netweight"],
    labels: {
      value: typeof meta.value === "string" ? meta.value : "Value",
      netweight: typeof meta.netweight === "string" ? meta.netweight : "Netweight",
      kodehs: typeof meta.kodehs === "string" ? meta.kodehs : "Kode HS",
      pod: typeof meta.pod === "string" ? meta.pod : "POD",
      ctr: typeof meta.ctr === "string" ? meta.ctr : "CTR",
    },
    data,
    source: "EXIM",
    last_update: derivedLastUpdate ? derivedLastUpdate.toISOString() : null,
  };
};
