function norm(input: string) {
  return String(input || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export type EximGroup = "hs2" | "pod" | "ctr" | "detail" | "hs2ctr" | "hs2pod" | "";

export function inferEximGroupFromQuery(q: string): EximGroup {
  const raw = norm(q);
  if (!raw) return "";

  const hasMenurut = /\b(menurut|berdasarkan|berdasar|per)\b/i.test(raw) || /\bby\b/i.test(raw);

  const mentionsPod = /\b(pelabuhan|port|pod)\b/i.test(raw);
  const mentionsCtr =
    /\b(negara|country|ctr)\b/i.test(raw) ||
    /\bnegara\s*(asal|tujuan)\b/i.test(raw) ||
    /\b(asal|tujuan)\b/i.test(raw);
  const mentionsHs = /\b(komoditas|barang|hs2|hs\s*code|kode\s*hs|kodehs|\bhs\b)\b/i.test(raw);

  const hasDan = /(\bdan\b|&)/i.test(raw);

  const wantsPodSolo =
    /\b(menurut|berdasarkan|berdasar|per)\s+(pelabuhan|port|pod)\b/i.test(raw) ||
    /\bby\s+(pelabuhan|port|pod)\b/i.test(raw);
  const wantsCtrSolo =
    /\b(menurut|berdasarkan|berdasar|per)\s+(negara|country|ctr)\b/i.test(raw) ||
    /\bby\s+(negara|country|ctr)\b/i.test(raw) ||
    /\b(menurut|berdasarkan|berdasar|per)\s+negara\s*(asal|tujuan)\b/i.test(raw);
  const wantsHsSolo =
    /\b(menurut|berdasarkan|berdasar|per)\s+(komoditas|barang|hs2|hs)\b/i.test(raw) ||
    /\bby\s+(komoditas|barang|hs2|hs)\b/i.test(raw);

  // Handle "<A> dan <B>" multi-dimension intent.
  // Primary signal: presence of a grouping keyword (menurut/berdasarkan/per/by).
  // Secondary fallback: users often omit that keyword but still write "... komoditas dan negara".
  if ((hasMenurut || hasDan) && mentionsHs && mentionsCtr && !mentionsPod) return "hs2ctr";
  if ((hasMenurut || hasDan) && mentionsHs && mentionsPod && !mentionsCtr) return "hs2pod";
  if ((hasMenurut || hasDan) && mentionsCtr && mentionsPod && !mentionsHs) return "detail";

  // Fallback: direct single-target phrases
  if (wantsPodSolo) return "pod";
  if (wantsCtrSolo) return "ctr";
  if (wantsHsSolo) return "hs2";
  return "";
}

export function filterEximColumnsForQuery(columns: string[], q: string, params: any) {
  const cols = Array.isArray(columns) ? columns : [];
  if (cols.length === 0) return cols;

  const raw = String(q || "").toLowerCase();
  const group = String(params?.group || "").toLowerCase();

  const metricParam = String(params?.metric || '').trim().toLowerCase();

  const hasNilaiWord = /\b(nilai|value)\b/i.test(raw);
  const hasVolumeWord = /\b(volume|berat|netweight)\b/i.test(raw);
  const metricFromQuery = hasNilaiWord && !hasVolumeWord
    ? 'value'
    : hasVolumeWord && !hasNilaiWord
      ? 'netweight'
      : '';

  const metricWanted =
    metricParam === 'value' || metricParam === 'netweight'
      ? metricParam
      : metricFromQuery;

  const hasPodWord = /\bpelabuhan\b/.test(raw);
  const hasCtrWord = /\bnegara\b/.test(raw);
  const hasHsWord = /\b(komoditas|hs2|kode\s*hs|kodehs|\bhs\b)\b/.test(raw);

  const hasPodFacet = !!String(params?.pod || "").trim();
  const hasCtrFacet = !!String(params?.ctr || "").trim();
  const hasHsFacet = !!String(params?.code_hs || "").trim();

  const wantPod =
    group === "pod" || group === "hs2pod" || group === "detail" || hasPodWord || hasPodFacet;
  const wantCtr =
    group === "ctr" || group === "hs2ctr" || group === "detail" || hasCtrWord || hasCtrFacet;
  const wantHs =
    group === "hs2" || group === "hs2ctr" || group === "hs2pod" || hasHsWord || hasHsFacet;

  const monthCol =
    cols.find((c) => /^(bulan|month)$/i.test(String(c).trim())) ||
    cols.find((c) => /(bulan|month)/i.test(String(c).trim())) ||
    cols[0];

  return cols.filter((c) => {
    const cc = String(c || "").trim();
    if (!cc) return false;
    if (cc === monthCol) return true;
    if (/^value$/i.test(cc)) return metricWanted ? metricWanted === 'value' : true;
    if (/^netweight$/i.test(cc)) return metricWanted ? metricWanted === 'netweight' : true;
    if (/^pod$/i.test(cc)) return wantPod;
    if (/^ctr$/i.test(cc)) return wantCtr;
    if (/^kodehs$/i.test(cc)) return wantHs;
    return false;
  });
}
