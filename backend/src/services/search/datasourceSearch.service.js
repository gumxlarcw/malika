const { Op } = require('sequelize');
const sequelize = require('../../config/db');
const DataSource = require('../../models/DataSource.model');
const DataPeriod = require('../../models/DataPeriod.model');
const DataSourceSearchTerm = require('../../models/DataSourceSearchTerm.model');
const { expandIndicatorAbbreviations } = require('../ai/abbrevExpansion.service');
const { extractQueryTokensForTermIndex } = require('./searchTermIndex.service');

// Production guardrail: exclude noisy indicators from search ranking.
const IGNORED_SOURCE_IDS = new Set([166, 167, 168, 169]);

function normalizeText(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(input) {
  return String(input || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const KNOWN_GEO_PHRASES = [
  'pulau morotai',
  'kepulauan sula',
  'pulau taliabu',
  'tidore kepulauan',
  'halmahera barat',
  'halmahera selatan',
  'halmahera tengah',
  'halmahera timur',
  'halmahera utara',
  'maluku utara',
  'ternate',
  'tidore',
  'morotai',
  'taliabu',
  'sula',
];

function expandGeoAbbreviations(input) {
  const norm = normalizeText(input);
  // Common local shorthand used by users in Maluku Utara queries.
  // Keep this deterministic and conservative (word-boundary based).
  return norm
    .replace(/\bhal[-\s]?teng\b/g, 'halmahera tengah')
    .replace(/\bhal[-\s]?ut\b/g, 'halmahera utara')
    .replace(/\bhalut\b/g, 'halmahera utara')
    .replace(/\bhal[-\s]?sel\b/g, 'halmahera selatan')
    .replace(/\bhalsel\b/g, 'halmahera selatan')
    .replace(/\bhal[-\s]?tim\b/g, 'halmahera timur')
    .replace(/\bhaltim\b/g, 'halmahera timur')
    .replace(/\bhal[-\s]?bar\b/g, 'halmahera barat')
    .replace(/\bhalbar\b/g, 'halmahera barat')
    .replace(/\btikep\b/g, 'tidore kepulauan')
    .replace(/\bkepsul\b/g, 'kepulauan sula')
    .replace(/\bpul\s*tal\b/g, 'pulau taliabu')
    .replace(/\bpultal\b/g, 'pulau taliabu')
    .replace(/\bpul\s*mor\b/g, 'pulau morotai')
    .replace(/\bpulmor\b/g, 'pulau morotai');
}

function normalizeMonthWords(input) {
  let s = normalizeText(input);
  if (!s) return s;

  // English -> Indonesian canonical
  s = s
    .replace(/\bjanuary\b/g, 'januari')
    .replace(/\bjan\b/g, 'januari')
    .replace(/\bjan\.\b/g, 'januari')
    .replace(/\bfebruary\b/g, 'februari')
    .replace(/\bfeb\b/g, 'februari')
    .replace(/\bfeb\.\b/g, 'februari')
    .replace(/\bfebr\b/g, 'februari')
    .replace(/\bmarch\b/g, 'maret')
    .replace(/\bmar\b/g, 'maret')
    .replace(/\bmar\.\b/g, 'maret')
    .replace(/\bmrt\b/g, 'maret')
    .replace(/\bapril\b/g, 'april')
    .replace(/\bapr\b/g, 'april')
    .replace(/\bapr\.\b/g, 'april')
    .replace(/\bmay\b/g, 'mei')
    .replace(/\bjune\b/g, 'juni')
    .replace(/\bjun\b/g, 'juni')
    .replace(/\bjun\.\b/g, 'juni')
    .replace(/\bjuly\b/g, 'juli')
    .replace(/\bjul\b/g, 'juli')
    .replace(/\bjul\.\b/g, 'juli')
    .replace(/\baugust\b/g, 'agustus')
    .replace(/\baug\b/g, 'agustus')
    .replace(/\baug\.\b/g, 'agustus')
    .replace(/\bseptember\b/g, 'september')
    .replace(/\bsept\b/g, 'september')
    .replace(/\bsep\b/g, 'september')
    .replace(/\bsep\.\b/g, 'september')
    .replace(/\boctober\b/g, 'oktober')
    .replace(/\boct\b/g, 'oktober')
    .replace(/\bokt\b/g, 'oktober')
    .replace(/\bokt\.\b/g, 'oktober')
    .replace(/\bnovember\b/g, 'november')
    .replace(/\bnov\b/g, 'november')
    .replace(/\bnov\.\b/g, 'november')
    .replace(/\bdecember\b/g, 'desember')
    .replace(/\bdec\b/g, 'desember')
    .replace(/\bdes\b/g, 'desember');

  // Common typos / local shorthand
  s = s
    // Januari
    .replace(/\bjanuar(i)+\b/g, 'januari')
    .replace(/\bjanuri\b/g, 'januari')
    .replace(/\bjanwari\b/g, 'januari')
    .replace(/\bjanuari\b/g, 'januari')

    // Februari
    .replace(/\bfebruar(i)+\b/g, 'februari')
    .replace(/\bfebuari\b/g, 'februari')
    .replace(/\bfebuary\b/g, 'februari')
    .replace(/\bpebruari\b/g, 'februari')
    .replace(/\bfebruari\b/g, 'februari')

    // Maret
    .replace(/\bmaret\b/g, 'maret')

    // April
    .replace(/\bapril\b/g, 'april')

    // Mei
    .replace(/\bmei\b/g, 'mei')

    // Juni/Juli
    .replace(/\bjuni\b/g, 'juni')
    .replace(/\bjuli\b/g, 'juli')

    // Agustus
    .replace(/\bagst\b/g, 'agustus')
    .replace(/\bagst\.\b/g, 'agustus')
    .replace(/\bags\b/g, 'agustus')
    .replace(/\bagt\b/g, 'agustus')
    .replace(/\bagt\.\b/g, 'agustus')
    .replace(/\bagu\b/g, 'agustus')
    .replace(/\bagus\b/g, 'agustus')
    .replace(/\bagustus\b/g, 'agustus')

    // September
    .replace(/\bsept\b/g, 'september')
    .replace(/\bsept\.\b/g, 'september')
    .replace(/\bseptembe?r\b/g, 'september')

    // Oktober
    .replace(/\boktbr\b/g, 'oktober')
    .replace(/\boktober\b/g, 'oktober')

    // November
    .replace(/\bnovembar\b/g, 'november')
    .replace(/\bnopember\b/g, 'november')
    .replace(/\bnovem\b/g, 'november')

    // Desember
    .replace(/\bdesember\b/g, 'desember')
    .replace(/\bdessember\b/g, 'desember')
    .replace(/\bdesemberr\b/g, 'desember')
    .replace(/\bdesmbr\b/g, 'desember');

  return s;
}

/**
 * Normalize repeated characters in geo names to handle common typos
 * e.g. "morotaiii" → "morotai", "ternatee" → "ternate"
 */
function normalizeGeoTypos(input) {
  let s = String(input || '').toLowerCase().trim();
  
  // Remove repeated trailing vowels/consonants (common typo pattern)
  // e.g. "morotaiii" → "morotai", "ternatee" → "ternate", "sulaaa" → "sula"
  s = s.replace(/([aeiou])\1+$/g, '$1'); // trailing repeated vowels
  s = s.replace(/([bcdfghjklmnpqrstvwxyz])\1+$/g, '$1'); // trailing repeated consonants
  
  // Normalize common geo typos/aliases for Maluku Utara kab/kota
  const geoAliases = {
    // Morotai variants
    'morotay': 'morotai',
    'mortai': 'morotai',
    'mrotai': 'morotai',
    'pulaumorotai': 'pulau morotai',
    'p morotai': 'pulau morotai',
    'p. morotai': 'pulau morotai',
    
    // Ternate variants
    'trnate': 'ternate',
    'ternte': 'ternate',
    
    // Tidore variants
    'tdore': 'tidore',
    'tidorekepulauan': 'tidore kepulauan',
    'tidore kep': 'tidore kepulauan',
    
    // Sula variants
    'kepsula': 'kepulauan sula',
    'kep sula': 'kepulauan sula',
    'kep. sula': 'kepulauan sula',
    
    // Taliabu variants
    'pulautaliabu': 'pulau taliabu',
    'p taliabu': 'pulau taliabu',
    'p. taliabu': 'pulau taliabu',
    'talibu': 'taliabu',
    
    // Halmahera variants
    'halbar': 'halmahera barat',
    'halsel': 'halmahera selatan',
    'halteng': 'halmahera tengah',
    'haltim': 'halmahera timur',
    'halut': 'halmahera utara',
    'hal barat': 'halmahera barat',
    'hal selatan': 'halmahera selatan',
    'hal tengah': 'halmahera tengah',
    'hal timur': 'halmahera timur',
    'hal utara': 'halmahera utara',
  };
  
  // Check if normalized string matches any alias
  if (geoAliases[s]) {
    return geoAliases[s];
  }
  
  return s;
}

function detectKnownGeoPhrases(normQuery) {
  const q = String(normQuery || '');
  if (!q) return [];

  // Maluku Utara known areas (longer first).
  const known = [
    'pulau morotai',
    'kepulauan sula',
    'pulau taliabu',
    'tidore kepulauan',
    'halmahera barat',
    'halmahera selatan',
    'halmahera tengah',
    'halmahera timur',
    'halmahera utara',
    'maluku utara',
    // single-word common locations
    'ternate',
    'tidore',
    'morotai',
    'taliabu',
    'sula',
  ];

  const out = [];
  
  // First check exact matches
  for (const p of known) {
    if (p && q.includes(p)) out.push(p);
  }
  
  // If no exact matches, try fuzzy match on individual tokens
  if (out.length === 0) {
    const tokens = q.split(/\s+/).filter(Boolean);
    for (const tok of tokens) {
      const normalized = normalizeGeoTypos(tok);
      // Check if normalized token matches any known geo
      for (const p of known) {
        if (normalized === p || p.split(' ').includes(normalized)) {
          if (!out.includes(normalized) && !out.includes(p)) {
            // Use the canonical known name if single word matches
            const matchedKnown = known.find(k => k === normalized || k.split(' ').includes(normalized));
            if (matchedKnown && !out.includes(matchedKnown)) {
              out.push(matchedKnown.split(' ').length === 1 ? matchedKnown : normalized);
            }
          }
          break;
        }
      }
    }
  }
  
  return out;
}

function extractQuerySignals(q) {
  const norm = normalizeMonthWords(expandGeoAbbreviations(q));
  const rawTokens = norm.split(' ').filter(Boolean);

  const years = Array.from(norm.matchAll(/\b(19\d{2}|20\d{2}|2100)\b/g)).map((m) => Number(m[1]));
  const yearTokens = years
    .filter((y) => Number.isFinite(y))
    .flatMap((y) => {
      const t = [String(y)];
      const three = y - 1900;
      if (three >= 0 && three <= 999) t.push(String(three));
      return t;
    });

  const monthMap = {
    januari: 1,
    februari: 2,
    maret: 3,
    april: 4,
    mei: 5,
    juni: 6,
    juli: 7,
    agustus: 8,
    september: 9,
    oktober: 10,
    november: 11,
    desember: 12,
  };
  const monthEntry = Object.entries(monthMap).find(([k]) => norm.includes(k)) || null;
  const monthNo = monthEntry?.[1] || null;
  const monthTokens = monthNo ? [String(monthNo), String(monthNo).padStart(2, '0')] : [];

  const wilayahCodes = [];
  if (norm.includes('maluku utara') || norm.includes('malut')) {
    wilayahCodes.push('8200', '8200000');
  }
  const numericCodes = Array.from(norm.matchAll(/\b\d{4,10}\b/g)).map((m) => m[0]);
  for (const c of numericCodes) wilayahCodes.push(c);

  const stopwords = new Set([
    'bulan',
    'tahun',
    'triwulan',
    'kuartal',
    'provinsi',
    'kabupaten',
    'kota',
    'di',
    'pada',
    'untuk',
    'dan',
  ]);

  const monthNames = new Set(Object.keys(monthMap));
  const geoPhrases = detectKnownGeoPhrases(norm);
  const hasKabKotaKeyword = /\b(kabupaten|kab\.?|kota|kab\s*\/\s*kota|kabupaten\s*\/\s*kota)\b/i.test(norm);
  const hasSpecificKabKotaName = geoPhrases.some((p) => String(p || '') && String(p).toLowerCase() !== 'maluku utara');
  const hasKabKotaIntent = hasKabKotaKeyword || hasSpecificKabKotaName;
  
  // Build geoTokens from detected phrases AND original tokens that normalize to geo names
  const geoTokens = new Set(
    geoPhrases
      .flatMap((p) => String(p || '').split(' '))
      .map((t) => t.trim())
      .filter(Boolean)
  );
  
  // Also add original tokens that normalize to known geo names (handles typos like "morotaiii")
  for (const tok of rawTokens) {
    const normalized = normalizeGeoTypos(tok);
    if (geoTokens.has(normalized)) {
      geoTokens.add(tok); // Add original typo token so it gets filtered from topicTerms
    }
  }

  // For candidate retrieval we should NOT require geo words (kab/kota) to appear
  // in datasource names; many indicators are province-only.
  // We'll use geo words as a scoring hint instead.
  const topicTerms = rawTokens
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .filter((t) => !stopwords.has(t))
    .filter((t) => !monthNames.has(t))
    .filter((t) => !/^\d+$/.test(t))
    .filter((t) => !geoTokens.has(t));

  const synonymPhrases = new Set();
  const hasInflasi = norm.includes('inflasi');
  const hasIhk = norm.includes('ihk') || norm.includes('indeks harga konsumen');
  if (hasInflasi || hasIhk) {
    synonymPhrases.add('inflasi');
    synonymPhrases.add('ihk');
    synonymPhrases.add('indeks harga konsumen');
  }

  // Synonym expansion for common statistical terms
  // GDP/PDRB
  if (norm.includes('pdrb') || norm.includes('produk domestik') || norm.includes('gdp')) {
    synonymPhrases.add('pdrb');
    synonymPhrases.add('produk domestik regional bruto');
    synonymPhrases.add('pertumbuhan ekonomi');
  }

  // Unemployment/Pengangguran
  if (norm.includes('pengangguran') || norm.includes('tpt') || norm.includes('tingkat pengangguran')) {
    synonymPhrases.add('pengangguran');
    synonymPhrases.add('tpt');
    synonymPhrases.add('tingkat pengangguran terbuka');
  }

  // Poverty/Kemiskinan
  if (norm.includes('kemiskinan') || norm.includes('miskin') || norm.includes('garis kemiskinan')) {
    synonymPhrases.add('kemiskinan');
    synonymPhrases.add('penduduk miskin');
    synonymPhrases.add('garis kemiskinan');
  }

  // Population/Penduduk
  if (norm.includes('penduduk') || norm.includes('populasi') || norm.includes('demografi')) {
    synonymPhrases.add('penduduk');
    synonymPhrases.add('jumlah penduduk');
    synonymPhrases.add('kependudukan');
  }

  // Labor/Ketenagakerjaan
  if (norm.includes('ketenagakerjaan') || norm.includes('tenaga kerja') || norm.includes('angkatan kerja')) {
    synonymPhrases.add('ketenagakerjaan');
    synonymPhrases.add('tenaga kerja');
    synonymPhrases.add('angkatan kerja');
  }

  // Export/Import
  if (norm.includes('ekspor') || norm.includes('impor') || norm.includes('perdagangan luar')) {
    synonymPhrases.add('ekspor');
    synonymPhrases.add('impor');
    synonymPhrases.add('perdagangan');
  }

  // Gini/Inequality
  if (norm.includes('gini') || norm.includes('ketimpangan')) {
    synonymPhrases.add('gini');
    synonymPhrases.add('ketimpangan');
    synonymPhrases.add('rasio gini');
  }

  // IPM/HDI
  if (norm.includes('ipm') || norm.includes('indeks pembangunan manusia') || norm.includes('hdi')) {
    synonymPhrases.add('ipm');
    synonymPhrases.add('indeks pembangunan manusia');
  }

  // Detect quarterly/triwulan signal
  // Matches: "triwulan 1/2/3/4", "triwulan I/II/III/IV", "Q1/Q2/Q3/Q4", "kuartal 1/2/3/4"
  const hasQuarterlySignal = /\b(triwulan(an)?|kuartal|q[1-4])\b/i.test(norm);

  const periodTokens = Array.from(new Set([...yearTokens, ...monthTokens])).slice(0, 6);

  return {
    norm,
    topicTerms,
    geoPhrases,
    hasKabKotaIntent,
    hasSpecificKabKotaName, // strict flag for geo filtering (excludes "maluku utara" province)
    yearTokens: Array.from(new Set(yearTokens)),
    monthNo,
    monthTokens,
    periodTokens,
    synonymPhrases: Array.from(synonymPhrases),
    hasInflasi,
    hasIhk,
    hasQuarterlySignal,
    wilayahCodes: Array.from(new Set(wilayahCodes)).slice(0, 5),
  };
}

function indicatesKabKotaDimensionFromText(input) {
  const s = normalizeText(input);
  if (!s) return false;
  // Strong signals (common in titles)
  if (/(kabupaten\s*\/\s*kota|kab\s*\/\s*kota)\b/.test(s)) return true;
  if (/menurut\s+(kabupaten|kab)\s*\/\s*kota\b/.test(s)) return true;
  if (/menurut\s+kabupaten\s*kota\b/.test(s)) return true;
  // Weaker fallback: contains both words.
  if (/\bkabupaten\b/.test(s) && /\bkota\b/.test(s)) return true;
  return false;
}

function scoreDatasource(ds, signals, periodHitsBySourceId, termHitsBySourceId) {
  const name = normalizeText(ds?.name);
  const desc = normalizeText(ds?.description);
  const aliases = normalizeText(ds?.aliases);
  const cat = normalizeText(ds?.category);
  const q = signals.norm;
  const type = normalizeText(ds?.type);

  const terms = Array.isArray(signals.topicTerms) ? signals.topicTerms : [];
  const synonyms = Array.isArray(signals.synonymPhrases) ? signals.synonymPhrases : [];
  const hasTopic = terms.length > 0 || synonyms.length > 0;

  let score = 0;
  if (name === q) score = 100;
  else if (name.startsWith(q)) score = 92;
  else if (name.includes(q)) score = 84;
  else {
    const allInName = terms.length > 0 && terms.every((t) => name.includes(t));
    const allInAny =
      terms.length > 0 && terms.every((t) => name.includes(t) || desc.includes(t) || aliases.includes(t) || cat.includes(t));
    if (allInName) score = 78;
    else if (allInAny) score = 70;
    else score = hasTopic ? 55 : 20;
  }

  // Generic boost: if datasource name contains key topic tokens from the query,
  // give a meaningful (but capped) bump so the intended indicator surfaces.
  // This is intentionally lower than exact/phrase matches.
  {
    if (terms.length > 0) {
      let nameHits = 0;
      let aliasHits = 0;
      for (const t of terms) {
        if (!t) continue;
        if (name.includes(t)) nameHits += 1;
        else if (aliases.includes(t)) aliasHits += 1;
      }
      if (nameHits > 0) score += Math.min(10, nameHits * 3);
      // Increased alias bonus from 4 to 12 for better discovery via synonyms
      if (aliasHits > 0) score += Math.min(12, aliasHits * 4);
    }
  }

  // Geo hint boost: if user included a known geo phrase (kab/kota), prefer datasources
  // whose titles contain that phrase. This is a boost only; it must not exclude others.
  {
    const geos = Array.isArray(signals.geoPhrases) ? signals.geoPhrases : [];
    if (geos.length > 0) {
      let geoScore = 0;
      for (const p of geos) {
        const gp = normalizeText(p);
        if (!gp) continue;
        const fullHit = hasTopic ? 10 : 4;
        const tokenHit = hasTopic ? 6 : 2;
        if (name.includes(gp)) geoScore = Math.max(geoScore, fullHit);
        else {
          const toks = gp.split(' ').filter(Boolean);
          if (toks.length > 0 && toks.every((t) => name.includes(t))) geoScore = Math.max(geoScore, tokenHit);
        }
      }
      if (geoScore > 0) score += geoScore;
    }
  }

  // Kab/Kota intent boost (non-EXIM): when user mentions a kab/kota name or keywords,
  // strongly prefer datasources that are explicitly "Kabupaten/Kota" breakdown tables.
  // ALSO penalize datasources that DON'T have kab/kota dimension when user asks for specific geo.
  {
    if (hasTopic && signals?.hasKabKotaIntent && type && type !== 'exim') {
      const hay = `${name} ${desc} ${aliases} ${cat}`;
      const hasKabKotaDimension = indicatesKabKotaDimensionFromText(hay);
      
      // Check if all topic terms are in datasource name OR aliases (critical for geo queries)
      // This allows "Penduduk... Menurut Kabupaten/Kota" with alias "jumlah penduduk" to match
      const nameOrAliases = `${name} ${aliases}`;
      const allTopicTermsMatch = terms.length > 0 && terms.every((t) => nameOrAliases.includes(t));
      
      if (hasKabKotaDimension && allTopicTermsMatch) {
        // Good match: has kab/kota dimension AND all topic terms (in name or aliases)
        score += 14;
      } else if (hasKabKotaDimension && !allTopicTermsMatch) {
        // Has kab/kota dimension but missing topic terms - penalize
        // This prevents "Jumlah Perceraian Menurut Kabupaten/Kota" from matching "jumlah penduduk morotai"
        score -= 10;
      } else {
        // PENALTY: User asked for specific kab/kota but this datasource is province-level only
        // This prevents province-level data from being shown when user wants kab/kota data
        score -= 18;
      }
    }
  }

  const periodHit = periodHitsBySourceId.get(ds.id) || 0;
  if (periodHit > 0) score += hasTopic ? 8 : 2;

  if (synonyms.length > 0) {
    const hay = `${name} ${desc} ${aliases} ${cat}`;
    let hits = 0;
    for (const p of synonyms) {
      const sp = normalizeText(p);
      if (sp && hay.includes(sp)) hits += 1;
    }
    if (hits > 0) score += Math.min(12, 4 + hits * 2);
  }

  // Topic disambiguation: if user explicitly asks "inflasi" (without explicitly asking "ihk"),
  // prefer datasources whose titles contain "inflasi" over IHK titles.
  // Symmetrically, if user explicitly asks "ihk" (without "inflasi"), prefer IHK titles.
  // This avoids IHK outranking Inflasi due to period map availability differences.
  if (signals?.hasInflasi && !signals?.hasIhk) {
    if (name.includes('inflasi')) score += 6;
    if (name.includes('ihk') || name.includes('indeks harga konsumen')) score -= 4;
  } else if (signals?.hasIhk && !signals?.hasInflasi) {
    if (name.includes('ihk') || name.includes('indeks harga konsumen')) score += 6;
    if (name.includes('inflasi')) score -= 2;
  }

  // Extra qualifier penalty: if datasource name contains important qualifier words
  // that user did NOT include in query, penalize to prefer simpler matches.
  // E.g. user asks "jumlah penduduk" but datasource is "penduduk miskin" → penalize
  {
    // High priority qualifiers - these fundamentally change the meaning or add specific breakdown
    const criticalQualifiers = [
      'miskin', 'kemiskinan', 'pengangguran', 'bekerja', 
      'ekspor', 'impor', 'inflasi', 'pdrb', 'ipm',
      'hotel', 'wisatawan', 'pariwisata', 
      'pertanian', 'perikanan', 'industri',
      'agama', // breakdown by religion changes the nature of population data
      'merokok', 'rokok', // specific health behavior, not general population
      'kejahatan', 'kriminal', // crime stats, not population
      'melek huruf', 'buta huruf', // literacy, not population count
      'bencana', 'banjir', 'gempa', // disaster data
    ];
    
    // Medium priority qualifiers - may limit scope or add dimension breakdown
    // Note: "jenis kelamin", "kelompok umur" are common breakdown dimensions 
    // that don't fundamentally change meaning for population queries
    const mediumQualifiers = [
      'sekolah', 'kesehatan', 'pendidikan', 'konstruksi', 'perdagangan',
      'transportasi', 'listrik', 'air', 'gas', 'energi',
      'perkawinan', 'kelahiran', 'kematian', 'perceraian',
      'suku', 'etnis', 'bahasa', 'ihk',
      'kegiatan', 'status pekerjaan', 'lapangan usaha',
    ];
    
    let criticalPenalty = 0;
    let mediumPenalty = 0;
    
    for (const qual of criticalQualifiers) {
      const inName = name.includes(qual);
      const inQuery = q.includes(qual);
      if (inName && !inQuery) {
        criticalPenalty++;
      }
    }
    
    for (const qual of mediumQualifiers) {
      const inName = name.includes(qual);
      const inQuery = q.includes(qual);
      if (inName && !inQuery) {
        mediumPenalty++;
      }
    }
    
    // Apply penalties: critical qualifiers cost more
    // IMPORTANT: Must exceed Kab/Kota boost (+14) to prevent wrong datasource selection
    // when user asks general query like "jumlah penduduk" without specific qualifier
    if (criticalPenalty > 0) {
      score -= 20 + (criticalPenalty - 1) * 8; // Increased from 12+6 to 20+8
    }
    if (mediumPenalty > 0) {
      score -= 6 + (mediumPenalty - 1) * 3; // Increased from 4+2 to 6+3
    }
  }

  // SEMANTIC INTENT CATEGORIZATION:
  // Boost/penalize based on detected query intent vs datasource type
  {
    // Detect intent category from query
    const isCountIntent = /\b(jumlah|banyaknya|total|angka|berapa)\s+(penduduk|orang|jiwa)/i.test(q);
    const isRateIntent = /\b(persentase|persen|rasio|proporsi|tingkat)\b/i.test(q);
    const isBehaviorIntent = /\b(merokok|bekerja|sekolah|menganggur|melek\s+huruf)\b/i.test(q);
    const isGrowthIntent = /\b(pertumbuhan|laju|growth|naik|turun|perubahan)\b/i.test(q);
    
    // Datasource type indicators
    const dsIsCount = /\b(jumlah|banyaknya|total)\b/i.test(name);
    const dsIsRate = /\b(persentase|persen|rasio|proporsi|indeks)\b/i.test(name);
    const dsIsBehavior = /\b(merokok|bekerja|sekolah|menganggur|melek\s+huruf)\b/i.test(name);
    const dsIsGrowth = /\b(pertumbuhan|laju|growth)\b/i.test(name);
    
    // Boost matching intent
    if (isCountIntent && dsIsCount && !dsIsRate && !dsIsBehavior) score += 8;
    if (isRateIntent && dsIsRate) score += 6;
    if (isBehaviorIntent && dsIsBehavior) score += 10;
    if (isGrowthIntent && dsIsGrowth) score += 8;
    
    // Penalize mismatched intent
    if (isCountIntent && !dsIsCount && (dsIsRate || dsIsBehavior)) score -= 6;
    if (isRateIntent && !dsIsRate && dsIsCount) score -= 4;
  }

  // Quarterly/Triwulan signal: boost datasources with "(Triwulanan)" in name when user asks for quarterly data
  // and penalize yearly datasources ("(Tahunan)") when quarterly data is requested
  if (signals.hasQuarterlySignal) {
    const hasTriwulanan = /\(triwulan(an)?\)|triwulan(an)?\b/i.test(name);
    const hasTahunan = /\(tahun(an)?\)|\btahun(an)?\b/i.test(name) && !/triwulan/i.test(name);
    
    if (hasTriwulanan) {
      // Strong boost for quarterly datasources
      score += 25;
    } else if (hasTahunan) {
      // Penalize yearly-only datasources when quarterly is requested
      score -= 15;
    }
  }

  const url = String(ds?.api_url || '');
  if (signals.wilayahCodes.some((c) => c && url.includes(c))) score += 4;

  const termHit = termHitsBySourceId?.get(ds.id) || 0;
  if (termHit > 0) {
    // Low-weight boost: helps when user searches using metric/column title.
    // Keep it capped so it doesn't overpower explicit name/alias matches.
    score += Math.min(10, 2 + termHit);
  }

  return { score, periodHit: periodHit > 0 };
}

async function getTermHitsBySourceId({ candidateIds, q, signals }) {
  const tokens = extractQueryTokensForTermIndex(q);
  if (tokens.length === 0) return { termHitsBySourceId: new Map(), extraCandidateIds: [] };

  const where = {
    term_norm: { [Op.in]: tokens },
  };
  if (Array.isArray(candidateIds) && candidateIds.length > 0) {
    where.source_id = { [Op.in]: candidateIds.filter((id) => !IGNORED_SOURCE_IDS.has(Number(id))) };
  } else {
    where.source_id = { [Op.notIn]: Array.from(IGNORED_SOURCE_IDS) };
  }

  const rows = await DataSourceSearchTerm.findAll({
    where,
    attributes: [
      'source_id',
      [sequelize.fn('SUM', sequelize.col('weight')), 'w'],
    ],
    group: ['source_id'],
    order: [[sequelize.literal('w'), 'DESC']],
    limit: 60,
  });

  const termHitsBySourceId = new Map();
  const sourceIds = [];
  for (const r of rows) {
    const sid = Number(r.source_id);
    const w = Number(r.get('w')) || 0;
    if (!Number.isFinite(sid) || sid <= 0) continue;
    if (w > 0) termHitsBySourceId.set(sid, Math.min(8, Math.ceil(w)));
    sourceIds.push(sid);
  }

  // If we weren't restricted to candidates, these are potential extra candidates.
  // If restricted, sourceIds will be subset of candidates.
  const extraCandidateIds = Array.isArray(candidateIds) && candidateIds.length > 0
    ? []
    : sourceIds.slice(0, 30);

  // Slightly reward if the full normalized query itself is a phrase term.
  // This only affects scoring (via termHitsBySourceId) and not candidate expansion.
  const qNorm = normalizeText(q);
  if (qNorm.length >= 3) {
    const phraseRows = await DataSourceSearchTerm.findAll({
      where: {
        term_norm: qNorm,
        kind: { [Op.in]: ['metric'] },
        ...(Array.isArray(candidateIds) && candidateIds.length > 0
          ? { source_id: { [Op.in]: candidateIds.filter((id) => !IGNORED_SOURCE_IDS.has(Number(id))) } }
          : { source_id: { [Op.notIn]: Array.from(IGNORED_SOURCE_IDS) } }),
      },
      attributes: ['source_id', 'weight'],
      limit: 60,
    });
    for (const pr of phraseRows) {
      const sid = Number(pr.source_id);
      if (!Number.isFinite(sid) || sid <= 0) continue;
      termHitsBySourceId.set(sid, Math.min(8, (termHitsBySourceId.get(sid) || 0) + 2));
    }
  }

  return { termHitsBySourceId, extraCandidateIds };
}

async function findDatasourceCandidates({ matchWhere }) {
  const where = {
    visible: true,
    status: true,
    ...(matchWhere ? matchWhere : {}),
  };

  // Ensure ignored IDs are excluded even if matchWhere already contains an `id` constraint.
  if (where.id) {
    const existingAnd = where[Op.and];
    const andClauses = Array.isArray(existingAnd) ? existingAnd.slice() : existingAnd ? [existingAnd] : [];
    andClauses.push({ id: { [Op.notIn]: Array.from(IGNORED_SOURCE_IDS) } });
    where[Op.and] = andClauses;
  } else {
    where.id = { [Op.notIn]: Array.from(IGNORED_SOURCE_IDS) };
  }

  return await DataSource.findAll({
    where,
    attributes: ['id', 'name', 'type', 'category', 'description', 'aliases', 'api_url', 'display_order', 'chart_config'],
    order: [['display_order', 'ASC'], ['id', 'ASC']],
    limit: 120,
  });
}

async function searchDatasources({ q, limit = 10, _skipGeoFallback = false }) {
  const qRaw = String(q || '').trim();
  const query = qRaw.slice(0, 80);
  const max = Math.min(50, Math.max(1, Number.parseInt(String(limit || '10'), 10) || 10));

  if (!query || query.length < 2) return [];

  // Early geo fallback: if query contains geo phrases, try topic-only search first.
  if (!_skipGeoFallback) {
    const normQ = normalizeText(query);
    const geoHits = KNOWN_GEO_PHRASES.filter((p) => p && normQ.includes(p));
    if (geoHits.length > 0) {
      let topicOnly = normQ;
      for (const p of geoHits) {
        topicOnly = topicOnly.replace(new RegExp(`\\b${escapeRegExp(p)}\\b`, 'g'), ' ');
      }
      topicOnly = topicOnly.replace(/\s+/g, ' ').trim();
      if (topicOnly.length >= 2 && topicOnly !== normQ) {
        const retry = await searchDatasources({ q: topicOnly, limit: max, _skipGeoFallback: true });
        if (retry.length > 0) {
          const filtered = retry.filter((item) => {
            const nameNorm = normalizeText(item.name);
            if (indicatesKabKotaDimensionFromText(nameNorm)) return true;
            for (const gp of geoHits) {
              if (nameNorm.includes(gp)) return true;
              const toks = gp.split(' ').filter(Boolean);
              if (toks.length > 0 && toks.every((t) => nameNorm.includes(t))) return true;
            }
            return false;
          });
          if (filtered.length > 0) return filtered.slice(0, max);
        }
      }
    }
  }

  const signals = extractQuerySignals(query);
  const normQuery = normalizeText(query);
  const geoPhrasesFallback = (signals.geoPhrases && signals.geoPhrases.length > 0)
    ? signals.geoPhrases
    : KNOWN_GEO_PHRASES.filter((p) => p && normQuery.includes(p));

  // Guardrail: if query contains no topic tokens (only geo/time/stopwords),
  // do NOT fall back to "first N datasources" by display order.
  // Instead, try the metadata term index (best-effort). If that yields nothing,
  // return empty results to avoid misleading candidates.
  if ((signals.topicTerms || []).length === 0 && (signals.synonymPhrases || []).length === 0) {
    try {
      const { extraCandidateIds } = await getTermHitsBySourceId({ candidateIds: [], q: query, signals });
      if (!extraCandidateIds || extraCandidateIds.length === 0) return [];
      const pick = extraCandidateIds
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
        .filter((id) => !IGNORED_SOURCE_IDS.has(id))
        .slice(0, 80);
      if (pick.length === 0) return [];
      const candidates = await findDatasourceCandidates({ matchWhere: { id: { [Op.in]: pick } } });

      // Continue with the normal scoring pipeline using these candidates.
      // (Period hits will likely be weak here, which is intended for low-signal queries.)
      const candidateIds = candidates.map((c) => c.id);
      const periodHitsBySourceId = new Map();
      if (candidateIds.length > 0 && (signals.periodTokens || []).length > 0) {
        const tokenLikes = signals.periodTokens.slice(0, 6).map((t) => ({ [Op.like]: `%${t}%` }));
        const periodRows = await DataPeriod.findAll({
          where: {
            source_id: { [Op.in]: candidateIds },
            period_value: { [Op.or]: tokenLikes },
          },
          attributes: ['source_id'],
          limit: 500,
        });
        for (const r of periodRows) {
          const sid = Number(r.source_id);
          periodHitsBySourceId.set(sid, (periodHitsBySourceId.get(sid) || 0) + 1);
        }
      }

      let termHitsBySourceId = new Map();
      try {
        const r = await getTermHitsBySourceId({ candidateIds, q: query, signals });
        termHitsBySourceId = r.termHitsBySourceId;
      } catch {
        // ignore
      }

      const scored = candidates
        .map((ds) => {
          const { score, periodHit } = scoreDatasource(ds, signals, periodHitsBySourceId, termHitsBySourceId);
          return {
            id: ds.id,
            name: ds.name,
            type: ds.type,
            category: ds.category || null,
            score,
            periodHit,
            display_order: ds.display_order || 0,
            chart_config: ds.chart_config || null,
          };
        })
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          if (a.display_order !== b.display_order) return a.display_order - b.display_order;
          return a.id - b.id;
        });

      // GEO FILTER: When user asks for a SPECIFIC kabupaten/kota, prefer datasources that either
      // have a kab/kota dimension OR explicitly mention the geo phrase (e.g., "Kota Ternate").
      let filtered = scored;
      if (signals?.hasSpecificKabKotaName) {
        const geoPhrases = Array.isArray(signals.geoPhrases) ? signals.geoPhrases : [];
        filtered = scored.filter((item) => {
          const nameNorm = normalizeText(item.name);
          if (indicatesKabKotaDimensionFromText(nameNorm)) return true;
          if (geoPhrases.length > 0) {
            for (const p of geoPhrases) {
              const gp = normalizeText(p);
              if (!gp) continue;
              if (nameNorm.includes(gp)) return true;
              const toks = gp.split(' ').filter(Boolean);
              if (toks.length > 0 && toks.every((t) => nameNorm.includes(t))) return true;
            }
          }
          return false;
        });

        // If strict geo filtering yields zero, fall back to scored results to avoid empty lists.
        if (filtered.length === 0) filtered = scored;
      }

      return filtered.slice(0, max);
    } catch {
      return [];
    }
  }

  const andClauses = signals.topicTerms.map((t) => ({
    [Op.or]: [
      { name: { [Op.like]: `%${t}%` } },
      { description: { [Op.like]: `%${t}%` } },
      { aliases: { [Op.like]: `%${t}%` } },
      { category: { [Op.like]: `%${t}%` } },
    ],
  }));

  const synonymClauses = (signals.synonymPhrases || [])
    .filter((p) => String(p || '').trim().length >= 2)
    .map((p) => ({
      [Op.or]: [
        { name: { [Op.like]: `%${p}%` } },
        { description: { [Op.like]: `%${p}%` } },
        { aliases: { [Op.like]: `%${p}%` } },
        { category: { [Op.like]: `%${p}%` } },
      ],
    }));

  const baseAndWhere = andClauses.length > 0 ? { [Op.and]: andClauses } : null;
  const synonymOrWhere = synonymClauses.length > 0 ? { [Op.or]: synonymClauses } : null;

  let matchWhere = null;
  if (baseAndWhere && synonymOrWhere) matchWhere = { [Op.or]: [baseAndWhere, synonymOrWhere] };
  else if (baseAndWhere) matchWhere = baseAndWhere;
  else if (synonymOrWhere) matchWhere = synonymOrWhere;

  let candidates = await findDatasourceCandidates({ matchWhere });

  // If geo terms exist and strict AND matching yields no candidates, widen to OR across topic terms.
  // This helps queries like "inflasi ternate" where geo tokens are removed from topic terms and
  // strict AND still fails to find the intended indicator.
  if (candidates.length === 0 && signals.geoPhrases?.length > 0 && andClauses.length > 1) {
    const relaxedOrWhere = { [Op.or]: andClauses };
    candidates = await findDatasourceCandidates({ matchWhere: relaxedOrWhere });
  }

  // If candidates are empty/too few, try widening via the term index (metrics/column titles).
  if (candidates.length < 5) {
    try {
      const { extraCandidateIds } = await getTermHitsBySourceId({ candidateIds: [], q: query, signals });
      const existing = new Set(candidates.map((c) => c.id));
      const toAdd = extraCandidateIds
        .filter((id) => !existing.has(id))
        .filter((id) => !IGNORED_SOURCE_IDS.has(Number(id)));
      if (toAdd.length > 0) {
        const extra = await findDatasourceCandidates({ matchWhere: { id: { [Op.in]: toAdd } } });
        if (extra.length > 0) candidates = [...candidates, ...extra];
      }
    } catch {
      // Best-effort only.
    }
  }

  // Geo-aware fallback: if query includes geo phrases and yields no candidates,
  // retry with geo tokens stripped from the query (topic-only search), then
  // re-apply geo filtering on names.
  if (!_skipGeoFallback && candidates.length === 0 && geoPhrasesFallback.length > 0) {
    let topicOnly = normQuery;
    for (const p of geoPhrasesFallback) {
      const gp = normalizeText(p);
      if (!gp) continue;
      topicOnly = topicOnly.replace(new RegExp(`\\b${escapeRegExp(gp)}\\b`, 'g'), ' ');
    }
    topicOnly = topicOnly.replace(/\s+/g, ' ').trim();

    if (topicOnly.length >= 2 && topicOnly !== normQuery) {
      const retry = await searchDatasources({ q: topicOnly, limit: max, _skipGeoFallback: true });
      if (retry.length > 0) {
        const geoPhrases = geoPhrasesFallback;
        const filtered = retry.filter((item) => {
          const nameNorm = normalizeText(item.name);
          if (indicatesKabKotaDimensionFromText(nameNorm)) return true;
          for (const gp of geoPhrases) {
            const gpn = normalizeText(gp);
            if (!gpn) continue;
            if (nameNorm.includes(gpn)) return true;
            const toks = gpn.split(' ').filter(Boolean);
            if (toks.length > 0 && toks.every((t) => nameNorm.includes(t))) return true;
          }
          return false;
        });
        return filtered.length > 0 ? filtered.slice(0, max) : retry.slice(0, max);
      }
    }
  }

  // If candidates are too few and query likely contains an abbreviation, try expanding it
  // into additional synonym phrases (alias-friendly) and retry once.
  if (candidates.length < 5) {
    try {
      const expanded = await expandIndicatorAbbreviations({ q: query });
      const extra = Array.isArray(expanded?.terms)
        ? expanded.terms.map((t) => String(t || '').trim()).filter(Boolean)
        : [];

      const uniqueExtra = extra.filter((t) => !signals.synonymPhrases.includes(t));
      if (uniqueExtra.length > 0) {
        const retrySynonymClauses = uniqueExtra.slice(0, 6).map((p) => ({
          [Op.or]: [
            { name: { [Op.like]: `%${p}%` } },
            { description: { [Op.like]: `%${p}%` } },
            { aliases: { [Op.like]: `%${p}%` } },
            { category: { [Op.like]: `%${p}%` } },
          ],
        }));

        const retrySynonymOrWhere = retrySynonymClauses.length > 0 ? { [Op.or]: retrySynonymClauses } : null;
        let retryWhere = null;
        if (baseAndWhere && retrySynonymOrWhere) retryWhere = { [Op.or]: [baseAndWhere, retrySynonymOrWhere] };
        else if (baseAndWhere) retryWhere = baseAndWhere;
        else if (retrySynonymOrWhere) retryWhere = retrySynonymOrWhere;

        const retry = await findDatasourceCandidates({ matchWhere: retryWhere });
        if (retry.length > candidates.length) {
          candidates = retry;
          signals.synonymPhrases = Array.from(new Set([...(signals.synonymPhrases || []), ...uniqueExtra]));
        }
      }
    } catch {
      // Best-effort only.
    }
  }

  const candidateIds = candidates.map((c) => c.id);
  const periodHitsBySourceId = new Map();
  if (candidateIds.length > 0 && (signals.periodTokens || []).length > 0) {
    const tokenLikes = signals.periodTokens.slice(0, 6).map((t) => ({ [Op.like]: `%${t}%` }));
    const periodRows = await DataPeriod.findAll({
      where: {
        source_id: { [Op.in]: candidateIds },
        period_value: { [Op.or]: tokenLikes },
      },
      attributes: ['source_id'],
      limit: 500,
    });
    for (const r of periodRows) {
      const sid = Number(r.source_id);
      periodHitsBySourceId.set(sid, (periodHitsBySourceId.get(sid) || 0) + 1);
    }
  }

  let termHitsBySourceId = new Map();
  try {
    const r = await getTermHitsBySourceId({ candidateIds, q: query, signals });
    termHitsBySourceId = r.termHitsBySourceId;
  } catch {
    // Best-effort only.
  }

  return candidates
    .map((ds) => {
      const { score, periodHit } = scoreDatasource(ds, signals, periodHitsBySourceId, termHitsBySourceId);
      return {
        id: ds.id,
        name: ds.name,
        type: ds.type,
        category: ds.category || null,
        score,
        periodHit,
        display_order: ds.display_order || 0,
        chart_config: ds.chart_config || null,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.display_order !== b.display_order) return a.display_order - b.display_order;
      return a.id - b.id;
    })
    // GEO FILTER: When user asks for SPECIFIC kabupaten/kota, DROP datasources without kab/kota dimension
    .filter((item) => {
      if (!signals?.hasSpecificKabKotaName) return true; // no geo filter needed
      const hasKabKotaDimension = indicatesKabKotaDimensionFromText(item.name);
      return hasKabKotaDimension;
    })
    .slice(0, max);
}

module.exports = {
  searchDatasources,
};
