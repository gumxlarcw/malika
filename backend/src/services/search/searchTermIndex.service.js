function normalizeText(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function stripPunctuation(input) {
  return String(input || '')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[^\p{L}\p{N}\s\-\/\(\)\.]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOPWORDS = new Set([
  'dan',
  'atau',
  'yang',
  'dengan',
  'untuk',
  'pada',
  'di',
  'ke',
  'dari',
  'menurut',
  'berdasarkan',
  'per',
  'tahun',
  'bulan',
  'triwulan',
  'kuartal',
  'semester',
  'total',
  'jumlah',
  'rata',
  'rata-rata',
  'persen',
  'persentase',
  'index',
  'indeks',
  'nilai',
  'value',
  'netweight',
  'volume',
  'data',
  'maluku',
  'utara',
  'provinsi',
  'kabupaten',
  'kota',
]);

function tokenizeTerm(term) {
  const cleaned = stripPunctuation(term);
  const parts = cleaned
    .split(/[^\p{L}\p{N}]+/gu)
    .map((t) => normalizeText(t))
    .filter(Boolean);

  return parts
    .filter((t) => t.length >= 3)
    .filter((t) => !STOPWORDS.has(t))
    .slice(0, 10);
}

function makeTermEntries({ sourceId, terms, kind, weightPhrase = 3, weightToken = 1 }) {
  const sid = Number(sourceId);
  if (!Number.isFinite(sid) || sid <= 0) return [];

  const list = Array.isArray(terms) ? terms : [];
  const out = [];
  const seen = new Set();

  for (const raw of list) {
    const phrase = stripPunctuation(String(raw || '')).trim();
    if (!phrase) continue;

    const phraseNorm = normalizeText(phrase);
    if (phraseNorm.length < 3) continue;

    // Skip too-generic phrases
    if (STOPWORDS.has(phraseNorm)) continue;

    const phraseKey = `${kind}|${phraseNorm}`;
    if (!seen.has(phraseKey)) {
      seen.add(phraseKey);
      out.push({
        source_id: sid,
        kind,
        term: phrase,
        term_norm: phraseNorm,
        weight: weightPhrase,
      });
    }

    const tokens = tokenizeTerm(phrase);
    for (const tok of tokens) {
      const k = `${kind}_token|${tok}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({
        source_id: sid,
        kind: `${kind}_token`,
        term: tok,
        term_norm: tok,
        weight: weightToken,
      });
    }
  }

  return out;
}

function extractQueryTokensForTermIndex(q) {
  const norm = normalizeText(q);
  if (!norm) return [];

  const tokens = norm
    .split(/[^\p{L}\p{N}]+/gu)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t.length >= 3)
    .filter((t) => !STOPWORDS.has(t));

  return Array.from(new Set(tokens)).slice(0, 8);
}

module.exports = {
  normalizeText,
  extractQueryTokensForTermIndex,
  makeTermEntries,
};
