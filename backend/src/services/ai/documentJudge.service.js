/**
 * Unified Document Judge + Reranker Service
 * 
 * MERGED from separate documentJudge.service.js + rerankKnowledge() in reranker.service.js
 * into a SINGLE LLM call that does selection, dedup, AND ranking in one pass.
 * 
 * Handles:
 * 1. Topic relevance — filter out irrelevant docs
 * 2. Temporal recency — newer docs preferred for same-topic queries
 * 3. Publication series deduplication — keeps only latest N per series
 * 4. Period/geo matching — prioritize docs matching requested period/region
 * 5. Topic specificity — prefers topic-specific pubs over general yearbooks
 * 6. Category diversity — ensures both BRS + Publikasi represented
 * 7. Final ranking — ordered from most to least relevant
 * 
 * Architecture: Single-pass Judge+Rank (Anthropic Contextual Retrieval pattern)
 * Positioned BETWEEN category-aware pool and content extraction in the pipeline.
 * Replaces the old 2-step Judge → Reranker serial chain.
 * 
 * Model: gpt-4.1 (configurable via OPENAI_MODEL_DOCUMENT_JUDGE env)
 */

const { openAiChatJson } = require('./openaiChat.service');
const { expandAbbreviationsInline, buildAbbreviationReference, ANTI_HALLUCINATION_RULE } = require('../../shared/bpsAbbreviations');
const requestContext = require('../chat/streaming/requestContext');
const { parseDocPeriod, selectDocsByPeriod } = require('../chat/chatUtils');
const logger = require('../../utils/logger').child({ service: 'DocumentJudge' });
const crypto = require('crypto');

// ── Configuration ──
const JUDGE_MODEL = process.env.OPENAI_MODEL_DOCUMENT_JUDGE || 'claude-sonnet-4-6';
const JUDGE_API_KEY_ENV = 'OPENAI_API_KEY_QUERY_BUILDER';
const MAX_CANDIDATES_INPUT = 20;   // Max docs sent to judge (reduced from 50 — top-20 cosine captures relevant docs, cuts prompt ~60%)
const MAX_SELECTED_OUTPUT = 10;    // Max docs returned (was Judge→20→Reranker→8; now single pass → 10)
const ENABLE_JUDGE = true;         // Kill switch

// ── TTL Cache for Judge results ──
const JUDGE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const JUDGE_CACHE_MAX_SIZE = 200;           // Max cached entries
const judgeCache = new Map();

/**
 * Build a cache key from query + candidate doc IDs.
 * Normalizes query to lowercase trimmed, sorts doc IDs for stable hashing.
 */
function _buildCacheKey(query, candidates) {
  const normQuery = String(query || '').toLowerCase().trim();
  const docIds = candidates.map(c => c.id).sort((a, b) => a - b).join(',');
  const raw = `${normQuery}|${docIds}`;
  return crypto.createHash('md5').update(raw).digest('hex');
}

/**
 * Evict expired entries and enforce max size.
 */
function _evictCache() {
  const now = Date.now();
  for (const [key, entry] of judgeCache) {
    if (now - entry.ts > JUDGE_CACHE_TTL_MS) {
      judgeCache.delete(key);
    }
  }
  // If still over limit, remove oldest entries
  if (judgeCache.size > JUDGE_CACHE_MAX_SIZE) {
    const entries = [...judgeCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    const toRemove = entries.slice(0, judgeCache.size - JUDGE_CACHE_MAX_SIZE);
    for (const [key] of toRemove) judgeCache.delete(key);
  }
}

/**
 * Extract publication series signature from a title.
 * Maps different year editions to the same series key.
 * e.g. "Provinsi Maluku Utara Dalam Angka 2025" → "provinsi maluku utara dalam angka"
 */
function extractSeriesKey(title) {
  if (!title) return null;
  return title
    .toLowerCase()
    .replace(/\b(20[012]\d|19\d{2})\b/g, '')
    .replace(/\b(semester|triwulan|kuartal)\s*(i{1,3}|iv|[1-4])\b/gi, '')
    .replace(/\b(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detect obvious publication series (multiple docs with same series key)
 * Returns a Map<seriesKey, doc[]>
 */
function detectSeriesGroups(candidates) {
  const groups = new Map();
  for (const doc of candidates) {
    const key = extractSeriesKey(doc.title || doc.name);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(doc);
  }
  const series = new Map();
  for (const [key, docs] of groups) {
    if (docs.length >= 2) {
      series.set(key, docs);
    }
  }
  return series;
}

/**
 * Build rich context for a single candidate document.
 * Provides the LLM with category, year, matching indicator lines,
 * and a smart content excerpt showing best query-term-density window.
 */
function buildRichContext(result, queryWords) {
  const parts = [];

  // Line 1: Category + Year + Release date + Similarity
  const category = result.category || 'unknown';
  const titleYear = String(result.name || result.title || '').match(/\b(20[12]\d)\b/);
  const year = titleYear ? titleYear[1] : (result.year || '?');
  const relDate = result.releaseDate
    ? (typeof result.releaseDate === 'string' ? result.releaseDate.slice(0, 10) : String(result.releaseDate))
    : null;
  const sim = result.similarity?.toFixed(3) || '?';
  parts.push(`Kategori: ${category} | Tahun: ${year}${relDate ? ` | Released: ${relDate}` : ''} | Sim: ${sim}`);

  // Line 2: Matching indicator_index lines (max 5)
  const indicatorIndex = result.indicatorIndex || '';
  if (indicatorIndex.length > 10) {
    const lines = indicatorIndex.split('\n').filter(l => l.trim().length > 5);
    const matchingLines = [];
    for (const line of lines) {
      const ll = line.toLowerCase();
      const matches = queryWords.filter(w => ll.includes(w)).length;
      if (matches > 0) matchingLines.push({ line: line.trim(), matches });
    }
    matchingLines.sort((a, b) => b.matches - a.matches);
    const topLines = matchingLines.slice(0, 5).map(m => m.line);
    if (topLines.length > 0) {
      parts.push(`Topik: ${topLines.join('; ')}`);
    }
  }

  // Line 3: Smart content excerpt — best query-term-density 300-char window
  const content = String(result.content || result.matchedChunkText || '');
  if (content.length > 0) {
    const contentLower = content.toLowerCase();
    let bestExcerpt = '';
    let bestScore = 0;

    const windowSize = 200;
    const step = 100;
    for (let i = 0; i < Math.min(contentLower.length, 20000); i += step) {
      const window = contentLower.slice(i, i + windowSize);
      let score = 0;
      for (const w of queryWords) {
        if (window.includes(w)) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestExcerpt = content.slice(i, i + windowSize).replace(/\n/g, ' ').trim();
      }
    }
    if (bestExcerpt) {
      parts.push(`Ringkasan: ...${bestExcerpt}...`);
    } else if (content.length > 0) {
      parts.push(`Ringkasan: ${content.slice(0, 200).replace(/\n/g, ' ').trim()}...`);
    }
  }

  return parts.join('\n    ');
}

/**
 * Build the unified Judge+Rank prompt.
 * Combines the old Judge's dedup/recency criteria with the Reranker's
 * period matching, geo matching, and rich context.
 */
/**
 * What period, if any, the question actually names.
 *
 * The judge already spotted a bare year, but not a month — so "garis kemiskinan
 * Maret 2025" reached it as "tahun 2025" and the Maret 2026 release satisfied
 * that just as well. Month parsing is delegated to parseDocPeriod, the same
 * reader used on document titles, so a question and a title are interpreted by
 * one set of rules.
 *
 * "terbaru" is deliberately not a period: it is a request for recency, which the
 * default rules already handle.
 */
function detectQueryPeriod(query) {
  const q = String(query || '');
  const parsed = parseDocPeriod(q) || {};
  const year = Number.isFinite(parsed.year) && parsed.year >= 2000 && parsed.year <= 2099
    ? parsed.year
    : null;
  const month = Number.isFinite(parsed.month) && parsed.month >= 1 && parsed.month <= 12
    ? parsed.month
    : null;
  const qm = q.match(/\b(?:triwulan|kuartal)\s+(i{1,3}v?|iv|[1-4])\b/i);
  const quarter = qm ? qm[1].toUpperCase() : null;
  const label = month && year ? parsed.label : null;
  return { year, month, quarter, label, hasExplicit: Boolean(year || quarter) };
}

function buildUnifiedPrompt(query, candidates, seriesGroups) {
  const expandedQuery = expandAbbreviationsInline(query);
  const queryLower = String(query || '').toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w =>
    (w.length >= 3) && !['yang', 'dan', 'atau', 'untuk', 'dari', 'bps', 'data'].includes(w)
  );

  const askedPeriodForSeries = detectQueryPeriod(query);

  // Build candidate list with rich context
  const candidateList = candidates
    .slice(0, MAX_CANDIDATES_INPUT)
    .map((doc, i) => {
      const richCtx = buildRichContext(doc, queryWords);
      return `${i + 1}. [id:${doc.id}] ${doc.title || doc.name}\n    ${richCtx}`;
    })
    .join('\n');

  // ── Series dedup info ──
  let seriesInfo = '';
  if (seriesGroups.size > 0) {
    const seriesLines = [];
    for (const [key, docs] of seriesGroups) {
      const years = docs.map(d => d.year || '?').sort().join(', ');
      seriesLines.push(`  "${key.slice(0, 60)}..." → ${docs.length} edisi (tahun: ${years})`);
    }
    // When the question names a period, "keep the newest edition" is the rule that
    // throws the answer away: the Maret 2025 release was dropped in favour of Maret
    // 2026 for a question that said Maret 2025.
    const seriesRule = askedPeriodForSeries.hasExplicit
      ? `→ Untuk setiap seri, pilih edisi yang PERIODENYA COCOK dengan permintaan user, bukan yang paling baru.`
      : `→ Untuk setiap seri, pilih HANYA 1-2 edisi terbaru.`;
    seriesInfo = `\nSERI PUBLIKASI TERDETEKSI:
${seriesLines.join('\n')}
${seriesRule}`;
  }

  // ── Period detection ──
  const wantsLatest = /\b(terbaru|terakhir|terkini|latest|newest|recent)\b/.test(queryLower);
  const askedPeriod = detectQueryPeriod(query);
  const explicitYear = askedPeriod.year ? String(askedPeriod.year) : null;
  const explicitQuarter = askedPeriod.quarter;
  // A named month is the case the judge used to be blind to.
  const explicitPeriodLabel = askedPeriod.label
    || (explicitQuarter && explicitYear ? `Triwulan ${explicitQuarter} ${explicitYear}` : null)
    || explicitYear;

  const statisticalTopics = [
    'kemiskinan', 'miskin', 'inflasi', 'ihk', 'pengangguran', 'tpt',
    'pdrb', 'pertumbuhan ekonomi', 'ipm', 'gini', 'ekspor', 'impor',
    'tpak', 'penduduk', 'upah', 'umr',
  ];
  const isStatisticalTopic = statisticalTopics.some(t => queryLower.includes(t));

  let periodInstruction = '';
  if (explicitYear && explicitQuarter) {
    periodInstruction = `\nPERIODE SPESIFIK: User mencari "Triwulan ${explicitQuarter} ${explicitYear}".
- WAJIB prioritaskan hasil Triwulan ${explicitQuarter} ${explicitYear}
- Jangan pilih tahun/triwulan lain kecuali tidak ada yang cocok`;
  } else if (askedPeriod.month && explicitYear) {
    periodInstruction = `\nPERIODE SPESIFIK: User mencari "${explicitPeriodLabel}".
- WAJIB prioritaskan rilis periode "${explicitPeriodLabel}"
- JANGAN menggantinya dengan rilis yang lebih baru dari seri yang sama
- Untuk yearbook "Dalam Angka YYYY", data sebenarnya adalah tahun YYYY-1`;
  } else if (explicitYear) {
    periodInstruction = `\nTAHUN SPESIFIK: User mencari tahun "${explicitYear}".
- WAJIB prioritaskan hasil yang mengandung "${explicitYear}"
- JANGAN menggantinya dengan rilis yang lebih baru dari seri yang sama
- Untuk yearbook "Dalam Angka YYYY", data sebenarnya adalah tahun YYYY-1`;
  } else if (wantsLatest || isStatisticalTopic) {
    periodInstruction = `\nDATA TERBARU: User mencari data terbaru${isStatisticalTopic ? ' (topik statistik → otomatis terbaru)' : ''}.
- Prioritaskan TAHUN paling besar, lalu BULAN paling akhir
- Desember 2025 > Februari 2025 > Desember 2024`;
  }

  // ── Geo detection ──
  const geoPatterns = [
    { pattern: /\bternate\b/i, label: 'Kota Ternate' },
    { pattern: /\btidore\b/i, label: 'Kota Tidore Kepulauan' },
    { pattern: /\bhalmahera\s*utara|halut\b/i, label: 'Kab. Halmahera Utara' },
    { pattern: /\bhalmahera\s*selatan|halsel\b/i, label: 'Kab. Halmahera Selatan' },
    { pattern: /\bhalmahera\s*tengah|halteng\b/i, label: 'Kab. Halmahera Tengah' },
    { pattern: /\bhalmahera\s*barat|halbar\b/i, label: 'Kab. Halmahera Barat' },
    { pattern: /\bhalmahera\s*timur|haltim\b/i, label: 'Kab. Halmahera Timur' },
    { pattern: /\bsula\b/i, label: 'Kab. Kepulauan Sula' },
    { pattern: /\bmorotai\b/i, label: 'Kab. Pulau Morotai' },
    { pattern: /\btaliabu\b/i, label: 'Kab. Pulau Taliabu' },
  ];
  let geoInstruction = '';
  for (const g of geoPatterns) {
    if (g.pattern.test(query)) {
      geoInstruction = `\nWILAYAH: User mencari data ${g.label}. Prioritaskan dokumen terkait ${g.label}.`;
      break;
    }
  }

  // Recency is the right default, but only until the user names a period. Ranking
  // "always newest" above "match the requested period" is what made a question
  // about Maret 2025 return the Maret 2026 release.
  const recencyRule = askedPeriod.hasExplicit
    ? `2. KESESUAIAN PERIODE — user menyebut periode tertentu. Pilih dokumen yang PERIODENYA SESUAI permintaan, meskipun ada edisi yang lebih baru.
   - Query "Maret 2025" → pilih rilis Maret 2025, BUKAN Maret 2026
   - Edisi lebih baru hanya dipakai jika periode yang diminta benar-benar tidak ada`
    : `2. KEKINIAN — untuk topik yang sama, SELALU pilih yang terbaru.
   - BRS Kemiskinan Sep 2025 > BRS Kemiskinan 2020
   - Tahun lebih besar = lebih baru. Jika tahun sama, bulan lebih akhir = lebih baru.`;

  const seriesDedupRule = askedPeriod.hasExplicit
    ? `3. DEDUPLIKASI SERI — jika ada beberapa edisi publikasi yang sama, pilih edisi yang PERIODENYA COCOK dengan permintaan user.`
    : `3. DEDUPLIKASI SERI — jika ada beberapa edisi publikasi yang sama (misal "Dalam Angka 2025", "Dalam Angka 2024", dst), pilih HANYA 1-2 edisi terbaru.`;

  return `Anda adalah Document Judge + Reranker untuk sistem RAG statistik BPS Maluku Utara.

SINGKATAN RESMI BPS:
${buildAbbreviationReference('compact')}
${ANTI_HALLUCINATION_RULE}

TUGAS: Dari ${candidates.length} dokumen kandidat, PILIH dan URUTKAN ${MAX_SELECTED_OUTPUT} dokumen terbaik untuk menjawab query pengguna.

ATURAN SELEKSI & RANKING (urutan prioritas):
1. RELEVANSI TOPIK — dokumen HARUS sesuai topik query. Buang yang tidak relevan meski similarity tinggi.
   Contoh: "restoran" → cari yang di Topik/Ringkasan ada "restoran/rumah makan"
${recencyRule}
${seriesDedupRule}
4. PERIODE — prioritaskan dokumen yang sesuai periode yang diminta user.
5. WILAYAH — prioritaskan dokumen yang sesuai wilayah yang diminta user.
6. SPESIFISITAS — untuk query spesifik, prefer publikasi spesifik > buku umum.
   - Query "kemiskinan" → "Profil Kemiskinan 2024" > "Maluku Utara Dalam Angka 2025"
   - Query "ekspor impor" → "Statistik Perdagangan Luar Negeri" > "Dalam Angka 2025"
7. KERAGAMAN — sertakan campuran BRS dan Publikasi jika tersedia.
8. HISTORIS — sertakan dokumen lama HANYA jika user eksplisit minta tren/perbandingan antar tahun.
${seriesInfo}${periodInstruction}${geoInstruction}

QUERY PENGGUNA: "${expandedQuery}"

DOKUMEN KANDIDAT (${candidates.length}):
${candidateList}

PENTING:
- Hanya masukkan hasil yang BENAR-BENAR menjawab query
- Buang hasil yang topiknya BERBEDA meski similarity tinggi
- Urutan = yang paling relevan di posisi pertama
- Minimum 3, maksimum ${MAX_SELECTED_OUTPUT} hasil

Jawab dalam format JSON:
{
  "ranked_ids": [<id1>, <id2>, ...],
  "reasoning": "<alasan 1-2 kalimat>",
  "dropped_series": ["<nama seri yang di-dedup jika ada>"]
}`;
}

/**
 * Whether a document's own period can answer a question about `asked`.
 *
 * Mirrors selectDocsByPeriod: an exact year (with the month too when the question
 * names one) or the year after, since BPS titles annual compendia by publication
 * year while they report the year before.
 */
function docMatchesQueryPeriod(title, asked) {
  if (!asked || !asked.year) return false;
  const p = parseDocPeriod(title);
  if (!p || !p.year) return false;
  if (p.year === asked.year) return !(asked.month && p.month) || p.month === asked.month;
  // The year+1 tolerance is about annual compendia titled by publication year.
  // A title naming a month has already said exactly which period it covers, so
  // "Maret 2026" is not a source for Maret 2025 — and treating it as one let those
  // releases consume the slots reserved for the period actually requested.
  return p.year === asked.year + 1 && !p.month;
}

/**
 * Choose which candidates the judge is allowed to see.
 *
 * Only MAX_CANDIDATES_INPUT of them fit, and the cut is by similarity. That cut
 * already reserved slots for Publikasi, because otherwise a top-20 by score came
 * out all BRS and the judge never saw a publication at all. A named period has
 * exactly the same problem and now gets the same remedy: the chunk holding the
 * Maret 2025 commodity table sat at rank 22 by cosine and was discarded before
 * the judge could weigh it — no ranking rule can rescue an answer that was never
 * shown. With no period named the behaviour is unchanged.
 */
function selectJudgeInput(query, candidates) {
  const MIN_PUB_SLOTS = 4;   // reserve slots for Publikasi
  const MIN_PERIOD_SLOTS = 4; // reserve slots for the period actually asked for

  const asked = detectQueryPeriod(query);
  const pubDocs = candidates.filter(c => c.category === 'Publikasi');
  const topPub = pubDocs.slice(0, MIN_PUB_SLOTS);
  const reserved = new Map(topPub.map(d => [d.id, d]));

  if (asked.hasExplicit) {
    // Exact period first, compendia only with slots left over: otherwise a run of
    // near-miss editions fills the reservation before the requested one is reached.
    const exact = (d) => {
      const p = parseDocPeriod(d.title || d.name);
      return p && p.year === asked.year && (!(asked.month && p.month) || p.month === asked.month);
    };
    const cap = MIN_PUB_SLOTS + MIN_PERIOD_SLOTS;
    for (const pass of [exact, (d) => docMatchesQueryPeriod(d.title || d.name, asked)]) {
      for (const doc of candidates) {
        if (reserved.size >= cap) break;
        if (reserved.has(doc.id)) continue;
        if (pass(doc)) reserved.set(doc.id, doc);
      }
    }
  }

  const fill = candidates
    .filter(d => !reserved.has(d.id))
    .slice(0, Math.max(0, MAX_CANDIDATES_INPUT - reserved.size));

  return [...fill, ...reserved.values()]
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, MAX_CANDIDATES_INPUT);
}

/**
 * Run the unified Document Judge + Reranker on a pool of candidates.
 * Single LLM call that selects, deduplicates, AND ranks.
 * 
 * @param {string} query - User search query
 * @param {Array} candidates - Pool candidates from category-aware selection (up to 50)
 * @param {Object} options - { topN: max results to return }
 * @returns {Promise<{results: Array, judged: boolean, reranked: boolean, reasoning?: string, latencyMs: number}>}
 */
async function judgeDocuments(query, candidates, options = {}) {
  const { topN = MAX_SELECTED_OUTPUT } = options;
  const maxOutput = Math.min(topN, MAX_SELECTED_OUTPUT);
  const startTime = Date.now();

  // Bypass if disabled or too few candidates
  if (!ENABLE_JUDGE || !candidates || candidates.length < 3) {
    return {
      results: (candidates || []).slice(0, maxOutput),
      judged: false,
      reranked: false,
      reasoning: 'Judge bypassed (disabled or <3 candidates)',
      latencyMs: Date.now() - startTime,
    };
  }

  // Bypass LLM judge if top result has very high similarity.
  // Threshold raised from 0.85 to 0.92 — the combined score (cosine + keyword 0.20
  // + recency 0.10) made 0.85 too easy to reach (cosine 0.56 was enough).
  // Even when bypassing, apply basic series dedup to prevent same-series flooding.
  if (candidates[0]?.similarity >= 0.92) {
    // Inline series dedup: keep only the newest edition per title series
    const yearRe = /\b(19|20)\d{2}\b/g;
    const seenSeries = new Map();
    const dedupedResults = [];
    // "Newest wins" is right only until the user names a period; otherwise this
    // silently drops the very edition that was asked for.
    const askedBypass = detectQueryPeriod(query);
    const orderedForBypass = askedBypass.hasExplicit
      ? selectDocsByPeriod(candidates, { year: askedBypass.year, month: askedBypass.month, limit: candidates.length })
      : candidates;
    for (const doc of orderedForBypass) {
      const title = (doc.title || doc.name || '').trim();
      const years = title.match(yearRe);
      const latestYear = years?.length ? Math.max(...years.map(Number)) : 0;
      const seriesKey = title.replace(yearRe, '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (seenSeries.has(seriesKey)) {
        const prev = seenSeries.get(seriesKey);
        if (!askedBypass.hasExplicit && latestYear > prev.year) {
          // Replace older edition
          const idx = dedupedResults.indexOf(prev.doc);
          if (idx !== -1) dedupedResults[idx] = doc;
          seenSeries.set(seriesKey, { doc, year: latestYear });
        }
        // else skip older edition
      } else {
        seenSeries.set(seriesKey, { doc, year: latestYear });
        dedupedResults.push(doc);
      }
      if (dedupedResults.length >= maxOutput) break;
    }
    const latencyMs = Date.now() - startTime;
    logger.info({
      query: query.slice(0, 80),
      topSimilarity: candidates[0].similarity.toFixed(3),
      outputCount: dedupedResults.length,
      deduped: candidates.length - dedupedResults.length,
      latencyMs,
    }, 'Document Judge: high-confidence bypass (similarity >= 0.92) with series dedup');
    return {
      results: dedupedResults,
      judged: false,
      reranked: false,
      reasoning: `High-confidence bypass: top similarity ${candidates[0].similarity.toFixed(3)} >= 0.92 (deduped ${candidates.length - dedupedResults.length} series duplicates)`,
      latencyMs,
    };
  }

  const input = selectJudgeInput(query, candidates);

  // ── Cache check ──
  const cacheKey = _buildCacheKey(query, input);
  const cached = judgeCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts < JUDGE_CACHE_TTL_MS)) {
    // Rebuild results from cached rankedIds using current candidate objects
    const candidateMap = new Map(input.map(c => [c.id, c]));
    const cachedResults = [];
    const usedIds = new Set();
    for (const id of cached.rankedIds) {
      const doc = candidateMap.get(id);
      if (doc && !usedIds.has(id)) {
        doc.judgeSelected = true;
        doc.aiReranked = true;
        doc.rerankReason = cached.reasoning;
        cachedResults.push(doc);
        usedIds.add(id);
      }
    }
    // Append remaining
    for (const doc of input) {
      if (!usedIds.has(doc.id)) {
        cachedResults.push(doc);
        usedIds.add(doc.id);
      }
    }
    const finalCached = cachedResults.slice(0, maxOutput);
    const latencyMs = Date.now() - startTime;
    logger.info({ query: query.slice(0, 80), cacheHit: true, latencyMs }, 'Document Judge: cache hit');
    return {
      results: finalCached,
      judged: true,
      reranked: true,
      reasoning: `[cached] ${cached.reasoning}`,
      droppedSeries: cached.droppedSeries,
      rankedIds: cached.rankedIds,
      latencyMs,
    };
  }

  try {
    // Detect publication series for the prompt
    const seriesGroups = detectSeriesGroups(input);

    const prompt = buildUnifiedPrompt(query, input, seriesGroups);

    logger.info({
      query: query.slice(0, 80),
      candidateCount: input.length,
      seriesDetected: seriesGroups.size,
    }, 'Document Judge+Rank: starting unified evaluation');

    const response = await openAiChatJson({
      apiKeyEnv: JUDGE_API_KEY_ENV,
      model: requestContext.getModelOverride() || JUDGE_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a document selection and ranking judge for BPS statistical knowledge base. Respond with valid JSON only.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0,
      purpose: 'document_judge_rank',
    });

    const latencyMs = Date.now() - startTime;
    const content = response?.choices?.[0]?.message?.content || '';

    // Parse response
    const parsed = parseJudgeResponse(content);

    if (parsed && parsed.rankedIds && parsed.rankedIds.length > 0) {
      // Reorder candidates by judge's ranked selection
      const candidateMap = new Map(input.map(c => [c.id, c]));
      const selected = [];
      const usedIds = new Set();

      for (const id of parsed.rankedIds) {
        const doc = candidateMap.get(id);
        if (doc && !usedIds.has(id)) {
          doc.judgeSelected = true;
          doc.aiReranked = true;
          doc.rerankReason = parsed.reasoning;
          selected.push(doc);
          usedIds.add(id);
        }
      }

      // Append remaining (not selected) in original score order as safety fallback
      for (const doc of input) {
        if (!usedIds.has(doc.id)) {
          selected.push(doc);
          usedIds.add(doc.id);
        }
      }

      // Cap to maxOutput
      const finalResults = selected.slice(0, maxOutput);

      logger.info({
        query: query.slice(0, 80),
        inputCount: input.length,
        judgeSelected: parsed.rankedIds.length,
        outputCount: finalResults.length,
        droppedSeries: parsed.droppedSeries?.length || 0,
        reasoning: parsed.reasoning?.slice(0, 150),
        latencyMs,
      }, 'Document Judge+Rank: unified evaluation complete');

      // ── Cache store ──
      _evictCache();
      judgeCache.set(cacheKey, {
        rankedIds: parsed.rankedIds,
        reasoning: parsed.reasoning,
        droppedSeries: parsed.droppedSeries,
        ts: Date.now(),
      });

      return {
        results: finalResults,
        judged: true,
        reranked: true,
        reasoning: parsed.reasoning,
        droppedSeries: parsed.droppedSeries,
        rankedIds: parsed.rankedIds,
        latencyMs,
      };
    }

    // Judge returned no valid selection — fall through to original order
    logger.warn({
      response: content.slice(0, 300),
      latencyMs,
    }, 'Document Judge+Rank: no valid selection, using original order');

    return {
      results: input.slice(0, maxOutput),
      judged: false,
      reranked: false,
      reasoning: 'Judge returned no valid selection',
      latencyMs,
    };

  } catch (error) {
    const latencyMs = Date.now() - startTime;
    logger.error({
      error: error.message,
      latencyMs,
    }, 'Document Judge+Rank: error, falling back to original order');

    // Graceful degradation
    return {
      results: input.slice(0, maxOutput),
      judged: false,
      reranked: false,
      reasoning: `Judge error: ${error.message}`,
      latencyMs,
    };
  }
}

/**
 * Parse the judge's JSON response.
 * Accepts both ranked_ids (new unified format) and selected_ids (old format).
 */
function parseJudgeResponse(responseText) {
  try {
    const text = String(responseText || '').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn({ preview: text.slice(0, 200) }, 'Document Judge: no JSON found in response');
      return null;
    }
    const parsed = JSON.parse(jsonMatch[0]);

    // New unified format: ranked_ids
    if (Array.isArray(parsed.ranked_ids)) {
      return {
        rankedIds: parsed.ranked_ids.map(id => parseInt(id, 10)).filter(id => !isNaN(id)),
        reasoning: parsed.reasoning || parsed.reason || '',
        droppedSeries: Array.isArray(parsed.dropped_series) ? parsed.dropped_series : [],
      };
    }

    // Legacy format: selected_ids
    if (Array.isArray(parsed.selected_ids)) {
      return {
        rankedIds: parsed.selected_ids.map(id => parseInt(id, 10)).filter(id => !isNaN(id)),
        reasoning: parsed.reasoning || parsed.reason || '',
        droppedSeries: Array.isArray(parsed.dropped_series) ? parsed.dropped_series : [],
      };
    }

    logger.warn({ keys: Object.keys(parsed) }, 'Document Judge: parsed JSON but missing ranked_ids/selected_ids');
    return null;
  } catch (e) {
    logger.warn({ error: e.message }, 'Document Judge: JSON parse error');
    return null;
  }
}

module.exports = {
  judgeDocuments,
  detectQueryPeriod,
  buildUnifiedPrompt,
  selectJudgeInput,
  docMatchesQueryPeriod,
  extractSeriesKey,
  detectSeriesGroups,
  buildRichContext,
  JUDGE_MODEL,
  MAX_SELECTED_OUTPUT,
};