import geoConfig from "../shared/geo-regions.json";

function norm(input: string) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function expandGeoAbbrev(raw: string) {
  // Deterministic shorthands commonly used in Maluku Utara queries.
  // Keep conservative (word-boundary based) to avoid false positives.
  return raw
    .replace(/\bhal\s*teng\b/g, 'halmahera tengah')
    .replace(/\bhal\s*ut\b/g, 'halmahera utara')
    .replace(/\bhalut\b/g, 'halmahera utara')
    .replace(/\bhal\s*sel\b/g, 'halmahera selatan')
    .replace(/\bhalsel\b/g, 'halmahera selatan')
    .replace(/\bhal\s*tim\b/g, 'halmahera timur')
    .replace(/\bhaltim\b/g, 'halmahera timur')
    .replace(/\bhal\s*bar\b/g, 'halmahera barat')
    .replace(/\bhalbar\b/g, 'halmahera barat')
    .replace(/\btikep\b/g, 'tidore kepulauan')
    .replace(/\bkepsul\b/g, 'kepulauan sula')
    .replace(/\bpultal\b/g, 'pulau taliabu')
    .replace(/\bpul\s*tal\b/g, 'pulau taliabu')
    .replace(/\bpulmor\b/g, 'pulau morotai')
    .replace(/\bpul\s*mor\b/g, 'pulau morotai');
}

const regionPhraseMap = new Map<string, string>();

geoConfig.regions.forEach((region) => {
  const key = String(region.key).toLowerCase();
  regionPhraseMap.set(key, key);
  (region.aliases || []).forEach((alias) => {
    regionPhraseMap.set(String(alias).toLowerCase(), key);
  });
});

const regionPhrases = Array.from(regionPhraseMap.keys()).sort((a, b) => b.length - a.length);

const provinceAliases = (geoConfig.provinceAliases || []).map((p) => String(p).toLowerCase());

export function extractGeoFromQuery(q: string): string {
  const raw = expandGeoAbbrev(norm(q));
  if (!raw) return '';

  // Fast-path: common province shorthand.
  if (provinceAliases.some((alias) => raw.includes(alias))) return 'maluku utara';

  // Prefer known Maluku Utara kab/kota phrases anywhere in the query.
  // This avoids misclassifying indicator topics (e.g. "jumlah kamar") as geo.
  for (const p of regionPhrases) {
    if (p && raw.includes(p)) return regionPhraseMap.get(p) || p;
  }

  const tokens = raw.split(' ').filter(Boolean);

  // Capture common admin-area phrases: "provinsi X", "kota X", "kabupaten X", "kab X".
  const keys = new Set(['provinsi', 'kota', 'kabupaten', 'kab']);
  const stop = new Set([
    'bulan',
    'tahun',
    'triwulan',
    'kuartal',
    'semester',
    'dan',
    'atau',
    'di',
    'pada',
    'untuk',
    'menurut',
    'berdasarkan',
    'berdasar',
    // EXIM words (avoid stealing those)
    'ekspor',
    'impor',
    'negara',
    'pelabuhan',
    'komoditas',
    'hs',
    'hs2',
    'kode',
    'kodehs',
    'nilai',
    'volume',
  ]);

  const takeAfter = (idx: number) => {
    const out: string[] = [];
    for (let i = idx + 1; i < tokens.length; i++) {
      const t = tokens[i];
      if (!t) break;
      if (stop.has(t)) break;
      if (/^(19\d{2}|20\d{2}|2100)$/.test(t)) break;
      if (/^\d+$/.test(t)) break;
      out.push(t);
      if (out.length >= 4) break;
    }
    return out.join(' ').trim();
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!keys.has(t)) continue;
    const geo = takeAfter(i);
    if (geo) return geo;
  }

  return '';
}
