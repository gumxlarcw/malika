/**
 * Vector Search Service
 * In-memory cosine similarity search for datasources and knowledge documents
 */

const DataSource = require('../../models/DataSource.model');
const KnowledgeBase = require('../../models/KnowledgeBase.model');
const IndexedBrsPublikasi = require('../../models/IndexedBrsPublikasi.model');
const { generateEmbedding, EMBEDDING_DIMENSIONS, LEGACY_EMBEDDING_DIMENSIONS } = require('./embedding.service');
const { rerankCandidates, rerankMixed } = require('./reranker.service');
const { judgeDocuments } = require('./documentJudge.service');
const { expandQueryWithLLM } = require('./synonymExpansion.service');
const { SHORT_WORD_WHITELIST } = require('../../shared/bpsAbbreviations');
const { BPS_DOMAIN_SYNONYMS } = require('../../shared/bpsDomainSynonyms');
const { MONTH_MAP_NUMERIC } = require('../../utils/queryAnalysis');
const { GEO_EXPANSION_MAP, REGION_NAMES_MAP, GEO_TYPO_PATTERNS, GEO_STOP_WORDS } = require('../../utils/geoAnalysis');
const { cosineSimilarity } = require('../../utils/math');
const { Sequelize } = require('sequelize');
const logger = require('../../utils/logger').child({ service: 'VectorSearch' });

// FT-1: ANN search with hnswlib (opt-in via env var)
const USE_ANN_SEARCH = process.env.USE_ANN_SEARCH === 'true';
let hnswIndex = null;       // HierarchicalNSW instance
let hnswIdMap = [];          // index position → doc ID mapping

// ── STEM MAP: maps query words to related stems for keyword matching ──
// Solves: "kemiskinan" query should match title containing "miskin"
// Extended with comprehensive BPS domain coverage
const STEM_MAP = {
  // Poverty
  kemiskinan: ['miskin', 'kemiskinan', 'poverty', 'penduduk miskin', 'garis kemiskinan'],
  miskin: ['miskin', 'kemiskinan', 'poverty', 'penduduk miskin'],
  // Employment
  pengangguran: ['pengangguran', 'nganggur', 'ketenagakerjaan', 'tpt', 'angkatan kerja', 'penganggur'],
  ketenagakerjaan: ['ketenagakerjaan', 'pengangguran', 'nganggur', 'tpt', 'tenaga kerja', 'pekerja', 'angkatan kerja', 'angkatan'],
  // Inflation
  inflasi: ['inflasi', 'ihk', 'harga konsumen', 'kenaikan harga', 'deflasi'],
  ihk: ['ihk', 'inflasi', 'harga konsumen', 'indeks harga'],
  // PDRB / Economy
  pdrb: ['pdrb', 'ekonomi', 'pertumbuhan ekonomi', 'domestik regional bruto', 'perekonomian'],
  ekonomi: ['ekonomi', 'pdrb', 'pertumbuhan ekonomi', 'perekonomian', 'lapangan usaha'],
  pertumbuhan: ['pertumbuhan', 'growth', 'laju', 'perkembangan', 'tren'],
  tren: ['tren', 'trend', 'perkembangan', 'kecenderungan', 'pertumbuhan'],
  // Population
  penduduk: ['penduduk', 'demografi', 'kependudukan', 'populasi', 'jumlah penduduk'],
  kependudukan: ['kependudukan', 'penduduk', 'demografi', 'populasi'],
  // Human Development
  ipm: ['ipm', 'pembangunan manusia', 'human development'],
  // Inequality
  gini: ['gini', 'ketimpangan', 'inequality', 'rasio gini', 'distribusi pendapatan'],
  ketimpangan: ['ketimpangan', 'gini', 'inequality', 'kesenjangan'],
  // Trade
  ekspor: ['ekspor', 'export', 'perdagangan', 'exim'],
  impor: ['impor', 'import', 'perdagangan', 'exim'],
  perdagangan: ['perdagangan', 'ekspor', 'impor', 'trade', 'neraca'],
  // Wages
  upah: ['upah', 'gaji', 'umr', 'ump', 'wages', 'upah minimum'],
  gaji: ['gaji', 'upah', 'pendapatan', 'wage'],
  // Tourism
  restoran: ['restoran', 'rumah makan', 'restaurant', 'cafe'],
  hotel: ['hotel', 'penghunian kamar', 'tpk', 'akomodasi', 'okupansi'],
  wisatawan: ['wisatawan', 'turis', 'pariwisata', 'kunjungan', 'tourism'],
  pariwisata: ['pariwisata', 'wisatawan', 'tourism', 'hotel', 'kunjungan'],
  // Industry
  industri: ['industri', 'manufaktur', 'pabrik', 'pengolahan', 'manufacturing'],
  manufaktur: ['manufaktur', 'industri', 'pengolahan', 'pabrik'],
  // Agriculture
  pertanian: ['pertanian', 'pangan', 'tanaman', 'padi', 'petani', 'agriculture'],
  petani: ['petani', 'pertanian', 'ntp', 'nilai tukar petani'],
  // Transport
  transportasi: ['transportasi', 'angkutan', 'kendaraan', 'transport'],
  // Education
  pendidikan: ['pendidikan', 'sekolah', 'education', 'siswa', 'partisipasi'],
  sekolah: ['sekolah', 'pendidikan', 'education', 'siswa'],
  // Health
  kesehatan: ['kesehatan', 'health', 'rumah sakit', 'puskesmas'],
  // Gender
  gender: ['gender', 'jenis kelamin', 'ipg', 'idg', 'ikg', 'kesetaraan'],
  // Welfare
  kesejahteraan: ['kesejahteraan', 'welfare', 'taraf hidup', 'konsumsi'],
  // Construction
  konstruksi: ['konstruksi', 'bangunan', 'construction', 'infrastruktur'],
  // Publications
  publikasi: ['publikasi', 'publication', 'terbitan', 'laporan'],
  brs: ['brs', 'berita resmi statistik', 'press release'],
};

/**
 * Check if a text contains any stem variant of a query word.
 * Returns true if any stem of the word appears in text.
 */
function stemMatch(word, text) {
  const stems = STEM_MAP[word];
  if (stems) {
    return stems.some(s => text.includes(s));
  }
  return text.includes(word);
}

// In-memory cache
let embeddingsCache = null;
let knowledgeCache = null;
let cacheLoadedAt = null;          // For datasource embeddings
let knowledgeCacheLoadedAt = null;  // For knowledge embeddings (separate TTL)
const CACHE_TTL_MS = parseInt(process.env.VECTOR_CACHE_TTL_MINUTES || '30', 10) * 60 * 1000; // Configurable (default 30 min)

// ── Knowledge Search Result Cache (2026-02-25: saves 14-37s on repeated queries) ──
const _knowledgeSearchCache = new Map();
const KNOWLEDGE_SEARCH_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const KNOWLEDGE_SEARCH_CACHE_MAX = 100;

function _ksrcGet(key) {
  const entry = _knowledgeSearchCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > KNOWLEDGE_SEARCH_CACHE_TTL_MS) {
    _knowledgeSearchCache.delete(key);
    return null;
  }
  return entry.value;
}

function _ksrcSet(key, value) {
  if (_knowledgeSearchCache.size >= KNOWLEDGE_SEARCH_CACHE_MAX) {
    const oldest = _knowledgeSearchCache.keys().next().value;
    _knowledgeSearchCache.delete(oldest);
  }
  _knowledgeSearchCache.set(key, { value, ts: Date.now() });
}

// NOTE: cosineSimilarity imported from utils/math.js (canonical location)

/**
 * Load all embeddings into memory cache
 * @param {boolean} force - Force reload even if cache is fresh
 * @returns {Promise<Map<number, {id: number, name: string, type: string, description: string, embedding: number[]}>>}
 */
async function loadEmbeddings(force = false) {
  // Return cached if fresh
  if (!force && embeddingsCache && cacheLoadedAt) {
    const age = Date.now() - cacheLoadedAt;
    if (age < CACHE_TTL_MS) {
      return embeddingsCache;
    }
  }

  const sources = await DataSource.findAll({
    where: {
      status: true,
      embedding: { [Sequelize.Op.ne]: null },
      // Exclude pressrelease - BRS already indexed in knowledge_base
      type: { [Sequelize.Op.ne]: 'pressrelease' },
    },
    attributes: ['id', 'name', 'type', 'description', 'embedding'],
  });

  const cache = new Map();
  
  for (const source of sources) {
    try {
      const rawEmb = JSON.parse(source.embedding);
      // Accept both current (3072) and legacy (1536) dimensions during migration
      if (Array.isArray(rawEmb) && (rawEmb.length === EMBEDDING_DIMENSIONS || rawEmb.length === LEGACY_EMBEDDING_DIMENSIONS)) {
        cache.set(source.id, {
          id: source.id,
          name: source.name,
          type: source.type,
          description: source.description || '',
          embedding: new Float32Array(rawEmb),
        });
      }
    } catch {
      // Skip invalid embeddings
    }
  }

  embeddingsCache = cache;
  cacheLoadedAt = Date.now();

  return cache;
}

/**
 * Load knowledge document embeddings into memory cache
 */
async function loadKnowledgeEmbeddings(force = false) {
  if (!force && knowledgeCache && knowledgeCacheLoadedAt) {
    const age = Date.now() - knowledgeCacheLoadedAt;
    if (age < CACHE_TTL_MS) {
      return knowledgeCache;
    }
  }

  const indexedDocs = await IndexedBrsPublikasi.findAll({
    where: {
      status: 'success',
      knowledge_doc_id: { [Sequelize.Op.ne]: null },
    },
    attributes: ['knowledge_doc_id', 'release_date', 'year', 'doc_type'],
  });

  const indexedMeta = new Map();
  for (const item of indexedDocs) {
    indexedMeta.set(item.knowledge_doc_id, {
      releaseDate: item.release_date || null,
      year: Number.isInteger(item.year) ? item.year : null,
      docType: item.doc_type || null,
    });
  }

  // ── Batched loading (2026-02-25): reduces peak memory by ~70-80% ──
  // Instead of loading 27K rows in 2 giant queries, load 5K rows at a time.
  // GC can reclaim between batches, preventing memory spikes that trigger PM2 restarts.
  const BATCH_SIZE = 5000;
  const cache = new Map();

  // 1) Parent docs (with content for keyword matching): ~1,300 rows (single batch)
  const parentDocs = await KnowledgeBase.findAll({
    where: {
      status: 'ready',
      embedding: { [Sequelize.Op.ne]: null },
      parent_id: null,
    },
    attributes: ['id', 'title', 'category', 'content', 'embedding', 'parent_id', 'keywords', 'indicator_index'],
  });

  for (let di = 0; di < parentDocs.length; di++) {
    const doc = parentDocs[di];
    try {
      const rawEmb = JSON.parse(doc.embedding);
      if (Array.isArray(rawEmb) && (rawEmb.length === EMBEDDING_DIMENSIONS || rawEmb.length === LEGACY_EMBEDDING_DIMENSIONS)) {
        const embedding = new Float32Array(rawEmb);
        const meta = indexedMeta.get(doc.id) || {};
        cache.set(doc.id, {
          id: doc.id,
          title: doc.title,
          category: doc.category || '',
          contentPreview: (doc.content || '').slice(0, 2000),  // ST-1: truncated for scoring (~80% RAM saving)
          contentLength: (doc.content || '').length,
          keywords: doc.keywords || '',
          indicatorIndex: doc.indicator_index || '',
          embedding,
          isChunk: false,
          parentId: doc.id,
          releaseDate: meta.releaseDate || null,
          year: meta.year || null,
          docType: meta.docType || null,
        });
      }
    } catch { /* Skip invalid embeddings */ }
    parentDocs[di] = null; // Allow GC
  }
  console.log(`[knowledge] Loaded ${cache.size} parent docs`);

  // 2) Chunk docs: ~26,000 rows loaded in batches of BATCH_SIZE
  //    Load chunk content for full in-document search coverage (+~91MB RAM)
  let chunkOffset = 0;
  let chunkBatchNum = 0;
  let totalChunks = 0;
  while (true) {
    const chunkBatch = await KnowledgeBase.findAll({
      where: {
        status: 'ready',
        embedding: { [Sequelize.Op.ne]: null },
        parent_id: { [Sequelize.Op.ne]: null },
      },
      attributes: ['id', 'title', 'category', 'content', 'embedding', 'parent_id'],
      order: [['id', 'ASC']],
      limit: BATCH_SIZE,
      offset: chunkOffset,
    });

    if (chunkBatch.length === 0) break;
    chunkBatchNum++;

    for (let di = 0; di < chunkBatch.length; di++) {
      const doc = chunkBatch[di];
      try {
        const rawEmb = JSON.parse(doc.embedding);
        if (Array.isArray(rawEmb) && (rawEmb.length === EMBEDDING_DIMENSIONS || rawEmb.length === LEGACY_EMBEDDING_DIMENSIONS)) {
          const embedding = new Float32Array(rawEmb);
          const meta = indexedMeta.get(doc.id) || {};
          cache.set(doc.id, {
            id: doc.id,
            title: doc.title,
            category: doc.category || '',
            contentPreview: (doc.content || '').slice(0, 2000),  // ST-1: truncated for scoring
            contentLength: (doc.content || '').length,
            keywords: '', // Chunks inherit parent keywords via dedup
            embedding,
            isChunk: true,
            parentId: doc.parent_id,
            releaseDate: meta.releaseDate || null,
            year: meta.year || null,
            docType: meta.docType || null,
          });
        }
      } catch { /* Skip invalid embeddings */ }
      chunkBatch[di] = null; // Allow GC
    }

    totalChunks += chunkBatch.length;
    chunkOffset += chunkBatch.length;
    console.log(`[knowledge] Batch ${chunkBatchNum}: loaded ${chunkBatch.length} chunks (total: ${totalChunks})`);

    // If we got fewer than BATCH_SIZE, we've reached the end
    if (chunkBatch.length < BATCH_SIZE) break;
  }

  knowledgeCache = cache;
  knowledgeCacheLoadedAt = Date.now();

  // FT-1: Build HNSW ANN index if enabled
  if (USE_ANN_SEARCH) {
    try {
      const { HierarchicalNSW } = require('hnswlib-node');
      const t0 = Date.now();
      // Only index 3072-dim docs (skip legacy 1536-dim)
      const entries3072 = [];
      for (const [id, data] of cache) {
        if (data.embedding.length === EMBEDDING_DIMENSIONS) {
          entries3072.push({ id, embedding: data.embedding });
        }
      }
      const numElements = entries3072.length;
      const index = new HierarchicalNSW('cosine', EMBEDDING_DIMENSIONS);
      index.initIndex(numElements, 16, 200, 100); // M=16, efConstruction=200, seed=100
      for (let i = 0; i < numElements; i++) {
        index.addPoint(Array.from(entries3072[i].embedding), i);
      }
      index.setEf(100); // ef for search (higher = more accurate, slower)
      hnswIndex = index;
      hnswIdMap = entries3072.map(e => e.id);
      console.log(`[knowledge] HNSW ANN index built: ${numElements} vectors, ${EMBEDDING_DIMENSIONS}d, ${Date.now() - t0}ms`);
    } catch (err) {
      console.error(`[knowledge] HNSW index build failed: ${err.message}. Falling back to linear scan.`);
      hnswIndex = null;
    }
  }

  return cache;
}

/**
 * Simple Levenshtein distance for fuzzy matching
 */
function levenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  
  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Expand acronyms/abbreviations to full forms with fuzzy matching
 * Includes common synonyms for better semantic search
 */
function expandQuery(query) {
  // ── Geo-specific expansions (Maluku Utara regions) ──
  const geoExpansions = GEO_EXPANSION_MAP;
  
  // ── Abbreviation-only expansions (not in domain synonyms) ──
  const abbrExpansions = {
    'tpt': ['tpt', 'tingkat pengangguran terbuka'],
    'tpak': ['tpak', 'tingkat partisipasi angkatan kerja'],
    'ipg': ['ipg', 'indeks pembangunan gender'],
    'ntb': ['ntb', 'nilai tambah bruto'],
    'kab': ['kab', 'kabupaten'],
    'pmtb': ['pmtb', 'pembentukan modal tetap bruto'],
  };
  
  // ── Combined: domain synonyms + abbreviations + geo ──
  // Domain synonyms from the shared comprehensive dictionary
  const expansions = {
    ...abbrExpansions,
    ...geoExpansions,
  };
  
  // Full region names for typo correction — from geoAnalysis canonical source
  const regionNames = REGION_NAMES_MAP;
  
  // Common typo patterns for direct replacement — from geoAnalysis canonical source
  const typoPatterns = GEO_TYPO_PATTERNS;
  
  let q = String(query || '').toLowerCase();
  
  // Normalize: remove dashes, extra spaces
  q = q.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  
  // Apply common typo fixes
  for (const [pattern, replacement] of typoPatterns) {
    q = q.replace(pattern, replacement);
  }
  
  let expanded = q;
  const addedTerms = new Set(); // Track what was already added to avoid duplicates
  
  // First: domain synonym expansion from comprehensive dictionary (100+ entries)
  for (const [trigger, synonyms] of Object.entries(BPS_DOMAIN_SYNONYMS)) {
    if (q.includes(trigger)) {
      for (const syn of synonyms) {
        if (!addedTerms.has(syn) && !q.includes(syn)) {
          addedTerms.add(syn);
        }
      }
    }
  }
  
  // Second: abbreviation + geo expansion
  for (const [abbr, forms] of Object.entries(expansions)) {
    if (q.includes(abbr)) {
      for (const form of forms) {
        if (!addedTerms.has(form) && !q.includes(form)) {
          addedTerms.add(form);
        }
      }
    }
  }
  
  // Append all unique expansion terms
  if (addedTerms.size > 0) {
    expanded = expanded + ' ' + [...addedTerms].join(' ');
  }
  
  // Third: fuzzy match for typos in domain synonym keys + abbreviation keys
  const words = q.split(/\s+/);
  const allKeys = [...Object.keys(BPS_DOMAIN_SYNONYMS), ...Object.keys(expansions)];
  const fuzzyKeys = allKeys.filter(k => k.length >= 4);
  
  for (const word of words) {
    if (word.length < 4 || word.length > 20) continue;
    
    // Skip if word is already a known key
    if (BPS_DOMAIN_SYNONYMS[word] || expansions[word]) continue;
    
    for (const key of fuzzyKeys) {
      if (Math.abs(word.length - key.length) > 1) continue;
      
      const distance = levenshteinDistance(word, key);
      const maxDistance = Math.floor(key.length / 3);
      
      if (distance > 0 && distance <= maxDistance) {
        // Found a typo - add the correct expansion
        const forms = BPS_DOMAIN_SYNONYMS[key] || expansions[key] || [];
        expanded = expanded + ' ' + key + ' ' + forms.join(' ');
        break;
      }
    }
  }
  
  // Fourth: fuzzy match for typos in full region names (e.g., "halmhera" -> "halmahera")
  for (const regionName of Object.keys(regionNames)) {
    const regionWords = regionName.split(' ');
    for (const rWord of regionWords) {
      if (rWord.length < 5) continue;
      
      for (const qWord of words) {
        if (qWord.length < 4) continue;
        
        const distance = levenshteinDistance(qWord, rWord);
        if (distance > 0 && distance <= 2 && qWord.length >= rWord.length - 2) {
          expanded = expanded + ' ' + regionName;
          break;
        }
      }
    }
  }
  
  return expanded;
}

/**
 * Extract important keywords from query
 * Returns array of { word, weight }
 */
function extractQueryKeywords(query) {
  const expanded = expandQuery(query);
  const words = expanded.split(/\s+/).filter(w => w.length >= 3 || SHORT_WORD_WHITELIST.has(w.toLowerCase()));
  
  // High-value domain keywords (statistik terms)
  const highValueKeywords = [
    'pdrb', 'produk', 'domestik', 'regional', 'bruto',
    'inflasi', 'kemiskinan', 'pengangguran', 'penduduk', 'pertumbuhan',
    'ekspor', 'impor', 'exim', 'harga', 'produksi', 'konsumsi', 'investasi',
    'tenaga', 'kesehatan', 'pendidikan', 'pertanian', 'industri', 'konstruksi',
    'transportasi', 'komunikasi', 'pariwisata', 'energi', 'listrik',
    'gross', 'product', 'gdp', 'grdp',
  ];
  
  // Low-value connecting words
  const lowValueWords = ['menurut', 'berdasarkan', 'untuk', 'dari', 'dengan', 'dan', 'atau', 'yang'];
  
  // Dedupe and weight
  const seen = new Set();
  const result = [];
  
  for (const w of words) {
    if (seen.has(w)) continue;
    seen.add(w);
    
    if (highValueKeywords.some(hv => w.includes(hv) || hv.includes(w))) {
      result.push({ word: w, weight: 0.12 }); // High weight for domain terms
    } else if (lowValueWords.includes(w)) {
      result.push({ word: w, weight: 0.02 }); // Low weight for connectors
    } else {
      result.push({ word: w, weight: 0.06 }); // Medium weight for others
    }
  }
  
  return result;
}

function hasTopicMatch(query, title, content) {
  const aliasMap = {
    kemiskinan: ['miskin', 'kemiskin', 'penduduk miskin', 'garis kemiskinan'],
    inflasi: ['ihk', 'indeks harga konsumen'],
    pengangguran: ['penganggur', 'nganggur', 'tpt'],
    pdrb: ['produk domestik regional bruto', 'pertumbuhan ekonomi', 'ekonomi'],
    ekspor: ['ekspor', 'export'],
    impor: ['impor', 'import'],
    ipm: ['indeks pembangunan manusia'],
    gini: ['ketimpangan', 'gini rasio'],
    tpak: ['angkatan kerja', 'partisipasi angkatan kerja'],
  };

  const normalizeAlias = (input) => {
    const raw = String(input || '').toLowerCase();
    if (!raw) return raw;
    for (const [key, aliases] of Object.entries(aliasMap)) {
      for (const alias of aliases) {
        if (raw.includes(alias)) return key;
      }
    }
    return raw;
  };

  const geoStop = GEO_STOP_WORDS;
  const genericStop = new Set([
    'data',
    'statistik',
    'bps',
    'terbaru',
    'terkini',
    'terakhir',
    'laporan',
    'publikasi',
    'brs',
  ]);

  const keywords = extractQueryKeywords(query)
    .map(k => k.word)
    .map(normalizeAlias)
    .filter(w => w.length >= 4)
    .filter(w => !geoStop.has(w) && !genericStop.has(w));
  if (keywords.length === 0) return false;
  const t = normalizeAlias(title);
  const c = normalizeAlias(content);

  const anchorTopics = [
    'kemiskinan',
    'inflasi',
    'pengangguran',
    'pdrb',
    'ekspor',
    'impor',
    'ipm',
    'gini',
    'tpt',
    'tpak',
  ];
  const qLower = normalizeAlias(query);
  const anchorsInQuery = anchorTopics.filter(a => qLower.includes(a));
  if (anchorsInQuery.length > 0) {
    return anchorsInQuery.some(a => t.includes(a));
  }

  let matches = 0;
  for (const w of keywords) {
    if (t.includes(w) || c.includes(w)) matches += 1;
  }

  return matches >= 1;
}

function parseReleaseDate(dateStr) {
  const raw = String(dateStr || '').trim();
  if (!raw) return null;

  let m = raw.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (m) {
    return { year: Number(m[1]), month: Number(m[2]) };
  }

  m = raw.match(/\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2})\b/);
  if (m) {
    return { year: Number(m[3]), month: Number(m[2]) };
  }

  m = raw.match(/\b(20\d{2})\b/);
  if (m) {
    return { year: Number(m[1]), month: 1 };
  }

  return null;
}

function selectLatestByCategory(items, query, category) {
  const monthNames = MONTH_MAP_NUMERIC;
  const qToM = { 'i': 3, 'ii': 6, 'iii': 9, 'iv': 12 };

  const filtered = items
    .filter(r => r.category === category)
    .filter(r => hasTopicMatch(query, r.title, r.contentPreview || ''))
    .map(r => {
      // Priority 1: metadata from IndexedBrsPublikasi
      const meta = parseReleaseDate(r.releaseDate) || (r.year ? { year: r.year, month: 1 } : null);
      if (meta) {
        return { ...r, dateScore: meta.year * 100 + (meta.month || 1) };
      }
      // Priority 2: extract date from title (fallback for docs without metadata)
      const titleLower = String(r.title || '').toLowerCase();
      const monthMatch = titleLower.match(/\b(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+(\d{4})\b/);
      if (monthMatch) {
        return { ...r, dateScore: parseInt(monthMatch[2], 10) * 100 + (monthNames[monthMatch[1]] || 1) };
      }
      const quarterMatch = titleLower.match(/triwulan\s+(i{1,3}v?|iv)[-\s]+(\d{4})/i);
      if (quarterMatch) {
        const mNum = qToM[quarterMatch[1].toLowerCase()] || 12;
        return { ...r, dateScore: parseInt(quarterMatch[2], 10) * 100 + mNum };
      }
      const yearMatch = titleLower.match(/\b(20\d{2})\b/);
      if (yearMatch) {
        return { ...r, dateScore: parseInt(yearMatch[1], 10) * 100 + 1 };
      }
      return null;
    })
    .filter(Boolean);

  if (filtered.length === 0) return null;
  return filtered.reduce((max, r) => (r.dateScore || 0) > (max.dateScore || 0) ? r : max, filtered[0]);
}

/**
 * Hybrid keyword boost for scoring
 * Returns a boost value (0 to 0.5) based on weighted keyword matches
 */
function calculateKeywordBoost(query, name, description = '') {
  const n = String(name || '').toLowerCase();
  const d = String(description || '').toLowerCase();
  const text = n + ' ' + d;
  
  const keywords = extractQueryKeywords(query);
  if (keywords.length === 0) return 0;
  
  let boost = 0;
  for (const { word, weight } of keywords) {
    if (text.includes(word)) {
      boost += weight;
    }
  }
  
  // Cap at 0.5 max
  return Math.min(0.5, boost);
}

/**
 * Search ALL sources (datasources + knowledge docs)
 * @param {string} query - Search query
 * @param {number} topN - Number of results
 * @param {object} options - { useKeywordBoost: boolean }
 * NOTE: AI Reranker is ALWAYS enabled for maximum accuracy
 * NOTE: LLM Synonym Expansion is ALWAYS called before embedding
 */
async function searchAll(query, topN = 10, options = {}) {
  const { useKeywordBoost = true } = options;
  const startTime = Date.now();
  
  // Step 1: Static expansion (abbreviations, typos)
  const staticExpanded = expandQuery(query);
  
  // Step 2: LLM synonym expansion on ORIGINAL query (not static-expanded)
  // Static expansion already handles domain synonyms; LLM adds novel/creative synonyms
  const llmExpanded = await expandQueryWithLLM(query);
  
  // Combine: static synonyms + LLM synonyms (deduped via embedding input)
  const combinedExpanded = llmExpanded !== query
    ? staticExpanded + ' ' + llmExpanded.split(/\s+/).filter(w => !staticExpanded.includes(w)).join(' ')
    : staticExpanded;
  
  // Generate embedding from fully expanded query
  const queryEmbedding = await generateEmbedding(combinedExpanded);

  // Load both caches
  const [dsEmbeddings, kbEmbeddings] = await Promise.all([
    loadEmbeddings(),
    loadKnowledgeEmbeddings(),
  ]);

  const scored = [];

  // Score datasources (with optional keyword boost)
  for (const [id, data] of dsEmbeddings) {
    const similarity = cosineSimilarity(queryEmbedding, data.embedding);
    const keywordBoost = useKeywordBoost ? calculateKeywordBoost(query, data.name, data.description) : 0;
    const hybridScore = similarity + keywordBoost;
    
    scored.push({
      id,
      name: data.name,
      type: data.type,
      source: 'datasource',
      description: data.description,
      similarity: hybridScore, // Use hybrid score for ranking
      vectorSim: similarity,
      keywordBoost,
    });
  }

  // Score knowledge documents (with optional keyword boost)
  for (const [id, data] of kbEmbeddings) {
    const similarity = cosineSimilarity(queryEmbedding, data.embedding);
    const keywordBoost = useKeywordBoost ? calculateKeywordBoost(query, data.title, data.contentPreview || '') : 0;
    const hybridScore = similarity + keywordBoost;
    
    scored.push({
      id,
      name: data.title,
      type: 'knowledge',
      source: 'knowledge',
      category: data.category,
      content: '',  // ST-1: loaded on-demand at dedup stage
      _needsContentLoad: true,
      similarity: hybridScore,
      vectorSim: similarity,
      keywordBoost,
      parentId: data.parentId || id,
    });
  }

  // Sort by similarity descending
  scored.sort((a, b) => b.similarity - a.similarity);
  
  let results = scored.slice(0, topN);
  let reranked = false;
  let rerankReason = null;

  // ALWAYS apply AI reranker for maximum accuracy
  if (results.length >= 2) {
    const rerankResult = await rerankMixed(query, results);
    if (rerankResult.reranked) {
      results = rerankResult.results;
      reranked = true;
      rerankReason = rerankResult.reason;
    }
  }

  return {
    results,
    reranked,
    rerankReason,
    duration_ms: Date.now() - startTime,
    totalDatasources: dsEmbeddings.size,
    totalKnowledge: kbEmbeddings.size,
  };
}

/**
 * Invalidate the embeddings cache
 */
function invalidateCache() {
  embeddingsCache = null;
  knowledgeCache = null;
  cacheLoadedAt = null;
  knowledgeCacheLoadedAt = null;
  _knowledgeSearchCache.clear();
}

/**
 * Search datasources by semantic similarity
 * @param {string} query - Search query
 * @param {number} topN - Number of results to return
 * NOTE: LLM Synonym Expansion is ALWAYS called before embedding
 * @returns {Promise<{results: object[], duration_ms: number}>}
 */
async function searchDatasources(query, topN = 5) {
  const startTime = Date.now();

  // Step 1: Static expansion (abbreviations, typos) - fast, no API call
  const staticExpanded = expandQuery(query);
  
  // Step 2: LLM synonym expansion on ORIGINAL query (not static-expanded)
  const llmExpanded = await expandQueryWithLLM(query);
  
  // Combine: static synonyms + LLM synonyms
  const combinedExpanded = llmExpanded !== query
    ? staticExpanded + ' ' + llmExpanded.split(/\s+/).filter(w => !staticExpanded.includes(w)).join(' ')
    : staticExpanded;
  
  // Generate query embedding from fully expanded query
  const queryEmbedding = await generateEmbedding(combinedExpanded);

  // Load all datasource embeddings
  const embeddings = await loadEmbeddings();

  if (embeddings.size === 0) {
    return {
      results: [],
      duration_ms: Date.now() - startTime,
      message: 'No embeddings available. Please embed datasources first.',
    };
  }

  // Calculate similarity for each datasource
  const scored = [];
  for (const [id, data] of embeddings) {
    const similarity = cosineSimilarity(queryEmbedding, data.embedding);
    scored.push({
      id,
      name: data.name,
      type: data.type,
      description: data.description,
      similarity,
    });
  }

  // Sort by similarity descending
  scored.sort((a, b) => b.similarity - a.similarity);

  // Return top N
  const results = scored.slice(0, topN);

  return {
    results,
    duration_ms: Date.now() - startTime,
    totalEmbedded: embeddings.size,
  };
}

/**
 * Search datasources and format for Query Builder context
 * @param {string} query - User query
 * @param {number} topN - Number of candidates
 * @returns {Promise<string>} - Formatted context string
 */
async function searchForQueryBuilder(query, topN = 5) {
  try {
    const { results } = await searchDatasources(query, topN);
    
    if (results.length === 0) {
      return '';
    }

    const lines = results.map((r, i) => {
      const desc = r.description ? ` - ${r.description.slice(0, 100)}` : '';
      return `${i + 1}. [ID:${r.id}] ${r.name} (${r.type})${desc}`;
    });

    return `Available datasources (ranked by relevance):\n${lines.join('\n')}`;
  } catch (e) {
    console.error('[VectorSearch] searchForQueryBuilder error:', e.message);
    return '';
  }
}

/**
 * Search ONLY knowledge documents
 * @param {string} query 
 * @param {number} topN 
 * @param {object} options - (reserved for future use)
 * NOTE: AI Reranker is ALWAYS enabled for maximum accuracy
 * NOTE: LLM Synonym Expansion is ALWAYS called before embedding
 * @returns {Promise<{results: object[], duration_ms: number}>}
 */
async function searchKnowledge(query, topN = 5, options = {}) {
  const { skipRerank = false, skipLLMSynonyms = false } = options;
  const startTime = Date.now();

  // ── Knowledge search result cache (saves 14-37s on repeated queries) ──
  const searchCacheKey = `${query}|${topN}|${skipLLMSynonyms ? '1' : '0'}|${skipRerank ? '1' : '0'}`;
  const cachedResult = _ksrcGet(searchCacheKey);
  if (cachedResult) {
    logger.info({ query, cachedMs: Date.now() - startTime }, 'Knowledge search cache HIT');
    return { ...cachedResult, duration_ms: Date.now() - startTime, cached: true };
  }
  
  // Step 1: Static expansion (abbreviations, typos) - fast, no API call
  const staticExpanded = expandQuery(query);
  
  // Step 2+3 PARALLELIZED: LLM synonym expansion + embedding generation
  // These are independent I/O operations — running them in parallel saves 1-4s.
  // Embedding is generated from static expansion (always available immediately),
  // then synonym keywords are extracted separately for boosting.
  const [llmExpanded, staticEmbedding] = await Promise.all([
    skipLLMSynonyms ? Promise.resolve(query) : expandQueryWithLLM(query),
    generateEmbedding(staticExpanded),
  ]);
  
  // Combine: static synonyms + LLM synonyms (if LLM returned anything new)
  const combinedExpanded = (!skipLLMSynonyms && llmExpanded !== query)
    ? staticExpanded + ' ' + llmExpanded.split(/\s+/).filter(w => !staticExpanded.includes(w)).join(' ')
    : staticExpanded;
  
  // If LLM added new terms, re-embed the combined query for better vector match.
  // Otherwise, reuse the static embedding (saves 1s).
  let queryEmbedding = staticEmbedding;
  if (!skipLLMSynonyms && llmExpanded !== query) {
    try {
      queryEmbedding = await generateEmbedding(combinedExpanded);
    } catch {
      // Fall back to static embedding if re-embed fails
      logger.warn('Re-embed with LLM synonyms failed, using static embedding');
    }
  }
  
  // Extract the SYNONYM KEYWORDS for boosting (not just for embedding)
  const originalWords = query.toLowerCase().split(/\s+/).filter(w => w.length >= 3 || SHORT_WORD_WHITELIST.has(w));
  const allExpandedWords = combinedExpanded.toLowerCase().split(/\s+/).filter(w => w.length >= 3 || SHORT_WORD_WHITELIST.has(w));
  const synonymKeywords = [...new Set(allExpandedWords)]
    .filter(w => !originalWords.includes(w))
    .slice(0, 30);
  
  logger.info({ 
    original: query, 
    staticExpanded: staticExpanded !== query ? staticExpanded : undefined,
    llmExpanded: llmExpanded !== query ? llmExpanded.slice(0, 200) : undefined,
    synonymKeywords: synonymKeywords.length > 0 ? synonymKeywords.slice(0, 10) : undefined,
    skipLLMSynonyms,
  }, 'Query expansion complete');
  
  const kbEmbeddings = await loadKnowledgeEmbeddings();

  if (kbEmbeddings.size === 0) {
    return {
      results: [],
      duration_ms: Date.now() - startTime,
      message: 'No knowledge embeddings available.',
    };
  }


  // Extract keywords for fallback keyword matching
  const queryLower = String(query || '').toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length >= 3 || SHORT_WORD_WHITELIST.has(w));
  
  const scored = [];

  // ── FT-1: ANN pre-filter or full linear scan ─────────────────────────
  // When HNSW is available, get top-200 candidates by cosine, then re-score.
  // Otherwise fall back to full linear scan (O(n) over all 28K docs).
  let candidateEntries;
  if (hnswIndex && queryEmbedding.length === EMBEDDING_DIMENSIONS) {
    const ANN_K = 200; // Retrieve top-200 by cosine similarity
    const result = hnswIndex.searchKnn(Array.from(queryEmbedding), ANN_K);
    candidateEntries = [];
    for (let i = 0; i < result.neighbors.length; i++) {
      const docId = hnswIdMap[result.neighbors[i]];
      const data = kbEmbeddings.get(docId);
      if (data) candidateEntries.push([docId, data, 1 - result.distances[i]]); // cosine distance → similarity
    }
    logger.debug({ annCandidates: candidateEntries.length, totalDocs: kbEmbeddings.size }, 'ANN pre-filter applied');
  } else {
    candidateEntries = [];
    for (const [id, data] of kbEmbeddings) {
      candidateEntries.push([id, data, null]); // null = compute cosine inline
    }
  }

  // ── SCORING: cosine + keyword + recency ─────────────────────────
  // All topic relevance, period matching, indicator matching
  // is now delegated to the AI reranker which sees rich context.
  for (const [id, data, precomputedSim] of candidateEntries) {
    const similarity = precomputedSim !== null ? precomputedSim : cosineSimilarity(queryEmbedding, data.embedding);
    
    // Keyword boost: if query words (or their stems) appear in title/content
    let keywordBoost = 0;
    const contentLower = String(data.contentPreview || '').toLowerCase();
    const titleLower = String(data.title || '').toLowerCase();
    
    for (const word of queryWords) {
      if (['yang', 'dan', 'atau', 'untuk', 'dari', 'bps', 'kepala', 'siapa'].includes(word)) continue;
      if (stemMatch(word, titleLower)) {
        keywordBoost += 0.08;
      } else if (stemMatch(word, contentLower)) {
        keywordBoost += 0.04;
      }
    }
    
    // Exact phrase match bonus
    if (queryLower.length > 10 && contentLower.includes(queryLower)) {
      keywordBoost += 0.15;
    }
    
    // Cap keyword boost
    keywordBoost = Math.min(keywordBoost, 0.20);

    // Recency decay: newer docs get a boost (exponential, current year ≈ +0.10)
    let recencyBoost = 0;
    const docYear = data.year || (() => {
      const m = String(data.title || '').match(/\b(20[12]\d)\b/);
      return m ? parseInt(m[1], 10) : 0;
    })();
    if (docYear > 0) {
      const currentYear = new Date().getFullYear();
      const yearDiff = Math.max(0, currentYear - docYear);
      recencyBoost = 0.10 * Math.exp(-yearDiff / 4); // ~0.10 current, ~0.03 for 5y old
    }

    // Combined score = embedding similarity + keyword boost + recency (3 signals)
    const combinedSimilarity = Math.max(similarity + keywordBoost + recencyBoost, 0.0);
    
    scored.push({
      id,
      name: data.title,
      title: data.title,
      type: 'knowledge',
      source: 'knowledge',
      category: data.category,
      content: '',  // ST-1: loaded on-demand at dedup stage
      _needsContentLoad: true,
      similarity: combinedSimilarity,
      rawSimilarity: similarity,
      keywordBoost,
      recencyBoost,
      parentId: data.parentId || id,
      isChunk: data.isChunk || false,
      indicatorIndex: data.indicatorIndex || '',
      releaseDate: data.releaseDate || null,
      year: data.year || null,
      docType: data.docType || null,
    });
  }

  // Sort by combined score, break ties with raw cosine
  scored.sort((a, b) => {
    const diff = b.similarity - a.similarity;
    if (Math.abs(diff) < 0.001) return b.rawSimilarity - a.rawSimilarity;
    return diff;
  });

  // ── CHUNK DEDUP: Group chunks by parent, keep highest-scoring entry per parent ──
  const deduped = [];
  const seenParents = new Set();
  let chunksDeduplicated = 0;
  // ST-1: Collect IDs that need full content from DB
  const contentNeededIds = new Set();

  for (const item of scored) {
    const parentId = item.parentId || item.id;
    if (seenParents.has(parentId)) {
      chunksDeduplicated++;
      continue;
    }
    seenParents.add(parentId);

    // If a chunk won, resolve to parent metadata but defer content load
    if (item.isChunk && item.parentId) {
      const parentData = knowledgeCache.get(item.parentId);
      if (parentData) {
        // Need both chunk content (for matchedChunkText) and parent content
        contentNeededIds.add(item.id);        // chunk's own content
        contentNeededIds.add(item.parentId);   // parent's full content
        item._chunkId = item.id;  // remember original chunk ID
        item.keywords = parentData.keywords || '';
        item.indicatorIndex = parentData.indicatorIndex || '';
        item.name = parentData.title || item.name;
        item.title = parentData.title || item.title;
        item.id = item.parentId;
      }
    } else {
      // Parent doc — need its own content
      contentNeededIds.add(item.id);
    }

    // ── PARENT-AWARE CHUNK EXPANSION ──────────────────────────────────
    if (!item.isChunk && !item.matchedChunkText) {
      const childChunks = scored
        .filter(s => s.isChunk && s.parentId === item.id && s.rawSimilarity > 0.30)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 3);
      if (childChunks.length > 0) {
        // Collect chunk IDs for content load
        for (const c of childChunks) contentNeededIds.add(c.id);
        item._childChunkIds = childChunks.map(c => c.id);
        item.matchedChunkCount = childChunks.length;
        item.matchedChunkScores = childChunks.map(c => c.similarity?.toFixed(3));
        logger.debug({
          docId: item.id,
          title: item.title?.slice(0, 40),
          chunkCount: childChunks.length,
          bestChunkSim: childChunks[0]?.similarity?.toFixed(3),
        }, 'Parent chunk expansion: attached best chunks');
      }
    }

    deduped.push(item);
  }
  if (chunksDeduplicated > 0) {
    logger.info({ chunksDeduplicated, beforeCount: scored.length, afterCount: deduped.length }, 'Chunk deduplication applied');
  }

  // ── ST-1: Batch-load full content for deduped results only ──────────
  const contentMap = new Map();
  if (contentNeededIds.size > 0) {
    const idsArr = [...contentNeededIds];
    const rows = await KnowledgeBase.findAll({
      attributes: ['id', 'content'],
      where: { id: idsArr },
    });
    for (const r of rows) contentMap.set(r.id, r.content || '');
    logger.debug({ loaded: rows.length, requested: idsArr.length }, 'ST-1: On-demand content loaded for deduped results');
  }

  // Populate content fields from DB results
  for (const item of deduped) {
    if (item._chunkId) {
      // Chunk won → chunk content becomes matchedChunkText, parent content becomes content
      item.matchedChunkText = contentMap.get(item._chunkId) || '';
      item.content = contentMap.get(item.id) || '';
      delete item._chunkId;
    } else {
      item.content = contentMap.get(item.id) || '';
    }
    if (item._childChunkIds) {
      item.matchedChunkText = item._childChunkIds.map(cid => contentMap.get(cid) || '').join('\n---\n');
      delete item._childChunkIds;
    }
    delete item._needsContentLoad;
  }

  // ── Hybrid Search: BM25 boost via MySQL FULLTEXT ─────────────────────
  try {
    const hybridSearch = require('./hybridSearch.service');
    if (hybridSearch.CONFIG.ENABLED) {
      const bm25Results = await hybridSearch.bm25Search(query);
      if (bm25Results.length > 0) {
        const bm25Map = new Map(bm25Results.map(r => [r.id, r.score]));
        let bm25Boosted = 0;
        for (const item of deduped) {
          const bm25Score = bm25Map.get(item.id) || bm25Map.get(item.parentId);
          if (bm25Score != null && bm25Score > 0) {
            const blendedBoost = bm25Score * 0.15;
            item.similarity = Math.min(item.similarity + blendedBoost, 1.0);
            item.bm25Score = bm25Score;
            bm25Boosted++;
          }
        }
        if (bm25Boosted > 0) {
          deduped.sort((a, b) => b.similarity - a.similarity);
          logger.debug({ bm25Hits: bm25Results.length, boosted: bm25Boosted }, 'BM25 hybrid boost applied');
        }
      }
    }
  } catch (e) {
    logger.debug({ error: e.message }, 'BM25 hybrid search skipped');
  }

  // ── CATEGORY-AWARE POOL → AI RERANKER ────────────────────────────────
  // Instead of a global top-20 (dominated by broad yearbooks), take top-N
  // from each category to guarantee diversity. The AI reranker then
  // decides the final ranking with rich context.
  const POOL_CONFIG = {
    BRS:       { max: 15 },   // BRS press releases (enlarged for Judge)
    Publikasi: { max: 15 },   // Publications (enlarged for Judge)
    PPID:      { max: 6 },    // PPID/custom documents
  };
  const TOTAL_POOL_MAX = 50;  // Enlarged: Judge trims to ~20 before reranker
  const MIN_SIMILARITY_FOR_POOL = 0.25; // Low threshold for wide recall

  const eligible = deduped.filter(r => r.similarity >= MIN_SIMILARITY_FOR_POOL);
  const poolCandidates = [];
  const poolIds = new Set();

  // Helper: extract year from title or metadata for recency sorting
  const _extractYear = (r) => {
    if (r.year) return r.year;
    const m = String(r.title || '').match(/\b(20[12]\d)\b/);
    return m ? parseInt(m[1], 10) : 0;
  };

  // Take top-N from each category + per-category topic-aware recency guarantee
  // Within each category, after taking top-N by score, also include the top-3
  // newest docs whose titles match query topic (via stemMatch). This ensures
  // recent BRS about the queried topic always reach the reranker.
  const topicWords = queryWords.filter(w =>
    !['maluku', 'utara', 'provinsi', 'kabupaten', 'kota', 'ternate',
      'tidore', 'halmahera', 'sula', 'morotai', 'taliabu',
      'data', 'terbaru', 'terakhir', 'terkini', 'tahun'].includes(w)
  );

  for (const [cat, config] of Object.entries(POOL_CONFIG)) {
    const catAll = eligible.filter(r => r.category === cat);
    const byScore = catAll.filter(r => !poolIds.has(r.id)).slice(0, config.max);
    for (const doc of byScore) {
      poolCandidates.push(doc);
      poolIds.add(doc.id);
    }

    // Topic-aware recency: inject newest docs from this category that match
    // query topic keywords but didn't make the top-N by score
    if (topicWords.length > 0) {
      const RECENCY_SLOTS = 6;  // Enlarged: more recent docs reach Judge/reranker
      const byYear = catAll
        .filter(r => {
          if (poolIds.has(r.id)) return false;
          const tl = (r.title || '').toLowerCase();
          return topicWords.some(w => stemMatch(w, tl));
        })
        .sort((a, b) => _extractYear(b) - _extractYear(a) || b.similarity - a.similarity)
        .slice(0, RECENCY_SLOTS);
      for (const doc of byYear) {
        poolCandidates.push(doc);
        poolIds.add(doc.id);
      }
    }
  }

  // Fill remaining slots from any category for uncategorized or overflow
  const remainingSlots = Math.max(0, TOTAL_POOL_MAX - poolCandidates.length);
  if (remainingSlots > 0) {
    const remaining = eligible
      .filter(r => !poolIds.has(r.id))
      .slice(0, remainingSlots);
    for (const doc of remaining) {
      poolCandidates.push(doc);
      poolIds.add(doc.id);
    }
  }

  logger.info({
    poolSize: poolCandidates.length,
    brs: poolCandidates.filter(r => r.category === 'BRS').length,
    pub: poolCandidates.filter(r => r.category === 'Publikasi').length,
    ppid: poolCandidates.filter(r => r.category === 'PPID').length,
    other: poolCandidates.filter(r => !['BRS','Publikasi','PPID'].includes(r.category)).length,
  }, 'Category-aware pool selection');

  // ── UNIFIED DOCUMENT JUDGE+RANK: Single LLM call for selection + ranking ──
  let judged = false;
  let reranked = false;
  let rerankReason = null;
  let results;

  if (!skipRerank && poolCandidates.length >= 3) {
    const judgeResult = await judgeDocuments(query, poolCandidates, { topN });
    results = judgeResult.results;
    judged = judgeResult.judged || false;
    reranked = judgeResult.reranked || false;
    rerankReason = judgeResult.reasoning || null;

    if (judged) {
      logger.info({
        inputCount: poolCandidates.length,
        outputCount: results.length,
        reasoning: (judgeResult.reasoning || '').slice(0, 150),
        latencyMs: judgeResult.latencyMs,
      }, 'Unified Judge+Rank applied');
    }
  } else {
    // Fallback: no judge (skipRerank or <3 results)
    // Sort by score so category-insertion order doesn't dominate (BRS first → Pub never returned)
    poolCandidates.sort((a, b) => b.similarity - a.similarity);
    results = poolCandidates.slice(0, topN);
  }

  const searchResult = {
    results,
    reranked,
    judged,
    rerankReason,
    duration_ms: Date.now() - startTime,
    totalKnowledge: kbEmbeddings.size,
  };

  // Cache the result for repeated queries (10-min TTL)
  _ksrcSet(searchCacheKey, { results, reranked, judged, rerankReason, totalKnowledge: kbEmbeddings.size });

  return searchResult;
}

/**
 * Get cache stats
 */
function getCacheStats() {
  return {
    cached: embeddingsCache ? embeddingsCache.size : 0,
    loadedAt: cacheLoadedAt ? new Date(cacheLoadedAt).toISOString() : null,
    ttlMs: CACHE_TTL_MS,
  };
}

module.exports = {
  cosineSimilarity,
  loadEmbeddings,
  loadKnowledgeEmbeddings,
  invalidateCache,
  searchDatasources,
  searchKnowledge,
  searchAll,
  searchForQueryBuilder,
  getCacheStats,
};
