/**
 * AI Reranker Service
 * 
 * Uses LLM to disambiguate between close-scoring candidates.
 * Only called when score gap between top candidates is small (< threshold).
 */

const { openAiChatJson, openAiStructuredOutput } = require('./openaiChat.service');
const DataPeriod = require('../../models/DataPeriod.model');
const { extractPeriodFromQuery } = require('../../utils/queryAnalysis');
const { extractGeoFromQuery } = require('../../utils/geoAnalysis');
const { expandAbbreviationsInline, buildAbbreviationReference, ANTI_HALLUCINATION_RULE } = require('../../shared/bpsAbbreviations');
const requestContext = require('../chat/streaming/requestContext');

// Configuration
const RERANK_SCORE_GAP_THRESHOLD = 20; // Wider window — more queries get AI reranking (was 15)
const RERANK_MODEL = process.env.OPENAI_MODEL_RERANKER || 'gemini-3-flash-preview';
const RERANK_API_KEY_ENV = 'OPENAI_API_KEY_QUERY_BUILDER'; // Share with query builder (same cost bucket)

/**
 * Check if reranking is needed based on score gap
 */
function needsReranking(candidates) {
  if (!candidates || candidates.length < 2) return false;
  const gap = (candidates[0]?.score || 0) - (candidates[1]?.score || 0);
  return gap < RERANK_SCORE_GAP_THRESHOLD;
}

/**
 * Build the reranking prompt
 */
function buildRerankPrompt(query, candidates) {
  const expandedQuery = expandAbbreviationsInline(query);
  const candidateList = candidates
    .slice(0, 8)
    .map((c, i) => `${i + 1}. [id:${c.id}] ${c.name}`)
    .join('\n');

  return `Anda adalah sistem pencarian data statistik BPS Maluku Utara.

SINGKATAN RESMI BPS:
${buildAbbreviationReference('compact')}
${ANTI_HALLUCINATION_RULE}

Pengguna mencari: "${expandedQuery}"

Kandidat yang ditemukan:
${candidateList}

Tugas: Pilih kandidat yang PALING SESUAI dengan query pengguna.

Pertimbangkan:
1. Kecocokan topik/subjek (PDRB, Inflasi, Kemiskinan, dll)
2. Dimensi data (kabupaten/kota, provinsi, lapangan usaha, pengeluaran)
3. Periode (triwulanan vs tahunan)
4. Spesifisitas (prefer yang lebih spesifik jika query spesifik)

Jawab dalam format JSON:
{
  "picked_rank": <nomor 0-8, 0 jika TIDAK ADA yang cocok>,
  "picked_id": <id datasource>,
  "reason": "<alasan singkat dalam 1 kalimat>"
}`;
}

/**
 * Parse AI response to extract picked candidate
 */
function parseRerankResponse(responseText) {
  try {
    const text = String(responseText || '').trim();
    
    // Try to extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[Reranker] No JSON object found in response:', text.slice(0, 200));
      return null;
    }
    
    const parsed = JSON.parse(jsonMatch[0]);
    
    // Handle picked_rank: 0 as "no good match found" - return null to skip reranking
    if (parsed.picked_rank === 0) {
      console.log('[Reranker] AI returned picked_rank=0 (no good match), skipping rerank');
      return null;
    }
    
    if (typeof parsed.picked_rank === 'number' && parsed.picked_rank >= 1 && parsed.picked_rank <= 8) {
      return {
        pickedRank: parsed.picked_rank,
        pickedId: parsed.picked_id,
        reason: parsed.reason || '',
      };
    }
    
    // Try alternate field names (snake_case vs camelCase)
    const rank = parsed.picked_rank || parsed.pickedRank || parsed.rank;
    const id = parsed.picked_id || parsed.pickedId || parsed.id;
    if (typeof rank === 'number' && rank >= 1 && rank <= 10) {
      return {
        pickedRank: rank,
        pickedId: id,
        reason: parsed.reason || '',
      };
    }
    
    console.warn('[Reranker] Parsed JSON but missing required fields:', JSON.stringify(parsed).slice(0, 200));
    return null;
  } catch (e) {
    console.warn('[Reranker] Failed to parse response:', e.message, '- Raw:', String(responseText).slice(0, 100));
    return null;
  }
}

/**
 * Reorder candidates by moving picked one to top
 */
function reorderCandidates(candidates, pickedRank) {
  if (pickedRank < 1 || pickedRank > candidates.length) return candidates;
  
  const idx = pickedRank - 1;
  if (idx === 0) return candidates; // Already at top
  
  const reordered = [...candidates];
  const [picked] = reordered.splice(idx, 1);
  reordered.unshift(picked);
  
  return reordered;
}

/**
 * Main reranking function
 * 
 * @param {string} query - User search query
 * @param {Array} candidates - Array of {id, name, score, ...}
 * @returns {Promise<{candidates: Array, reranked: boolean, reason?: string}>}
 */
async function rerankCandidates(query, candidates) {
  // Quick return if no reranking needed
  if (!needsReranking(candidates)) {
    return { candidates, reranked: false };
  }

  const startTime = Date.now();
  
  try {
    const prompt = buildRerankPrompt(query, candidates);
    
    const response = await openAiStructuredOutput({
      apiKeyEnv: RERANK_API_KEY_ENV,
      model: requestContext.getModelOverride() || RERANK_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a search reranking assistant. Always respond with valid JSON only.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0,
      schemaName: 'rerank_result',
      purpose: 'reranker',
      reasoning: { effort: 'low' },
      schema: {
        type: 'object',
        properties: {
          picked_rank: {
            type: 'integer',
            description: 'Rank of the picked candidate (1-5, or 0 if none match)',
          },
          picked_id: {
            type: 'integer',
            description: 'ID of the picked datasource',
          },
          reason: {
            type: 'string',
            description: 'Brief reason for the pick in 1 sentence',
          },
        },
        required: ['picked_rank', 'picked_id', 'reason'],
        additionalProperties: false,
      },
    });

    const latencyMs = Date.now() - startTime;
    const content = response?.choices?.[0]?.message?.content || '';
    
    const parsed = parseRerankResponse(content);
    
    if (parsed) {
      const reordered = reorderCandidates(candidates, parsed.pickedRank);
      
      console.log(`[Reranker] Query: "${query}" -> Picked rank ${parsed.pickedRank} (id:${parsed.pickedId}) in ${latencyMs}ms. Reason: ${parsed.reason}`);
      
      return {
        candidates: reordered,
        reranked: true,
        pickedId: parsed.pickedId,
        reason: parsed.reason,
        latencyMs,
      };
    }
    
    console.warn(`[Reranker] Failed to parse AI response for query: "${query}"`);
    return { candidates, reranked: false };
    
  } catch (e) {
    const latencyMs = Date.now() - startTime;
    console.error(`[Reranker] Error for query "${query}" (${latencyMs}ms):`, e.message);
    
    // Return original order on error (graceful degradation)
    return { candidates, reranked: false, error: e.message };
  }
}

/**
 * Lightweight check to see if query might benefit from reranking
 * (e.g., contains disambiguating terms like "lapangan usaha", "kabupaten kota", etc.)
 */
function queryMayNeedDisambiguation(query) {
  const q = String(query || '').toLowerCase();
  
  // These patterns often need disambiguation
  const disambiguationPatterns = [
    /\b(lapangan\s*usaha|pengeluaran|sektoral|sektor)\b/,
    /\b(kabupaten|kota|kab\/?kota)\b/,
    /\b(triwulan|tahunan|bulanan)\b/,
    /\b(adhb|adhk|harga\s*(berlaku|konstan))\b/,
    /\b(per\s*kapita|perkapita)\b/,
    /\b(laju|pertumbuhan|growth)\b/,
    /\b(distribusi|share|kontribusi)\b/,
  ];
  
  return disambiguationPatterns.some(p => p.test(q));
}

// ========== KNOWLEDGE BASE RERANKER (V2 — Rich Context) ==========

const KNOWLEDGE_RERANK_MAX_CANDIDATES = 24; // Category-aware pool from vectorSearch (BRS:10 + Pub:10 + PPID:4)

/**
 * Build rich context for a single knowledge result.
 * Provides the AI reranker with category, year, matching indicator lines,
 * and a smart content excerpt instead of just first 150 chars.
 *
 * @param {Object} result - Knowledge search result
 * @param {string[]} queryWords - Tokenized query words (lowercased)
 * @returns {string} - Rich context string for the AI prompt
 */
function buildRichContext(result, queryWords) {
  const parts = [];

  // Line 1: Category + Year
  const category = result.category || 'unknown';
  const titleYear = String(result.name || result.title || '').match(/\b(20[12]\d)\b/);
  const year = titleYear ? titleYear[1] : (result.year || '?');
  parts.push(`Kategori: ${category} | Tahun: ${year}`);

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

  // Line 3: Smart content excerpt — find query terms in content, show surrounding context
  const content = String(result.content || '');
  if (content.length > 0) {
    const contentLower = content.toLowerCase();
    let bestExcerpt = '';
    let bestScore = 0;

    // Scan content in 300-char windows for highest density of query words
    const windowSize = 300;
    const step = 150;
    for (let i = 0; i < Math.min(contentLower.length, 50000); i += step) {
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
    } else {
      // Fallback to first 200 chars
      parts.push(`Ringkasan: ${content.slice(0, 200).replace(/\n/g, ' ').trim()}...`);
    }
  }

  return parts.join('\n    ');
}

/**
 * Build prompt for knowledge reranking with rich context.
 * Accepts up to 20 candidates and asks AI to RANK them (not just pick 1).
 */
function buildKnowledgeRerankPrompt(query, results, mode = 'knowledge') {
  const expandedQuery = expandAbbreviationsInline(query);
  const queryLower = String(query || '').toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w =>
    (w.length >= 3) && !['yang', 'dan', 'atau', 'untuk', 'dari', 'bps', 'data'].includes(w)
  );

  const resultList = results
    .slice(0, KNOWLEDGE_RERANK_MAX_CANDIDATES)
    .map((r, i) => {
      const sourceLabel = r.source === 'knowledge' ? '[KB]' : '[DATA]';
      const richCtx = buildRichContext(r, queryWords);
      return `${i + 1}. ${sourceLabel} [id:${r.id}] ${r.name}\n    ${richCtx}`;
    })
    .join('\n');

  const contextDesc = mode === 'mixed'
    ? 'pencarian gabungan (data statistik + knowledge base)'
    : 'pencarian knowledge base (BRS, Publikasi, FAQ, panduan)';

  // Detect if user is asking for latest/terbaru data
  const wantsLatest = /\b(terbaru|terakhir|terkini|latest|newest|recent)\b/.test(queryLower);

  // Detect explicit year in query
  const explicitYearMatch = queryLower.match(/\b(20[12]\d)\b/);
  const explicitYear = explicitYearMatch ? explicitYearMatch[1] : null;

  // Detect explicit quarter in query
  const explicitQuarterMatch = queryLower.match(/triwulan\s+(i{1,3}v?|iv)/i);
  const explicitQuarter = explicitQuarterMatch ? explicitQuarterMatch[1].toUpperCase() : null;

  // Detect statistical topic queries - prefer latest for these
  const statisticalTopics = [
    'kemiskinan', 'miskin', 'inflasi', 'ihk', 'pengangguran', 'tpt',
    'pdrb', 'pertumbuhan ekonomi', 'ipm', 'gini', 'ekspor', 'impor',
    'tpak', 'penduduk', 'upah', 'umr',
  ];
  const isStatisticalTopic = statisticalTopics.some(t => queryLower.includes(t));

  // Build period instructions
  let periodInstruction = '';
  if (explicitYear && explicitQuarter) {
    periodInstruction = `\nPERIODE SPESIFIK: User mencari "Triwulan ${explicitQuarter} ${explicitYear}".\n- WAJIB prioritaskan hasil Triwulan ${explicitQuarter} ${explicitYear}\n- Jangan pilih tahun/triwulan lain kecuali tidak ada yang cocok`;
  } else if (explicitYear) {
    periodInstruction = `\nTAHUN SPESIFIK: User mencari tahun "${explicitYear}".\n- WAJIB prioritaskan hasil yang mengandung "${explicitYear}"\n- Untuk yearbook "Dalam Angka YYYY", data sebenarnya adalah tahun YYYY-1`;
  } else if (wantsLatest || isStatisticalTopic) {
    periodInstruction = `\nDATA TERBARU: User mencari data terbaru${isStatisticalTopic ? ' (topik statistik → otomatis terbaru)' : ''}.\n- Prioritaskan TAHUN paling besar, lalu BULAN paling akhir\n- Desember 2025 > Februari 2025 > Desember 2024`;
  }

  return `Anda adalah AI reranker untuk ${contextDesc} BPS Maluku Utara.

SINGKATAN RESMI BPS:
${buildAbbreviationReference('compact')}
${ANTI_HALLUCINATION_RULE}

Query pengguna: "${expandedQuery}"
${periodInstruction}

Hasil pencarian (${results.length} kandidat):
${resultList}

TUGAS: Pilih dan urutkan hasil yang PALING RELEVAN dengan query pengguna.

Kriteria penilaian (urutan prioritas):
1. TOPIK — apakah dokumen membahas topik yang ditanyakan?
   Contoh: "restoran" → cari yang di Topik/Ringkasan ada "restoran/rumah makan"
2. PERIODE — apakah sesuai tahun/bulan yang diminta?
3. WILAYAH — apakah sesuai wilayah yang diminta?
4. SPESIFISITAS — prefer BRS spesifik > publikasi umum untuk topik spesifik
5. KEKINIAN — untuk topik statistik, prefer data terbaru

PENTING:
- Hanya masukkan hasil yang BENAR-BENAR menjawab query
- Buang hasil yang topiknya BERBEDA meski similarity tinggi
- Urutan = yang paling relevan di posisi pertama
- Minimum 1, maksimum 8 hasil

Jawab dalam format JSON:
{
  "ranked_ids": [<id1>, <id2>, ...],
  "reason": "<alasan singkat 1-2 kalimat>"
}`;
}

/**
 * Parse AI response for ranked knowledge reranker (returns ordered list of IDs)
 */
function parseKnowledgeRerankResponse(responseText) {
  try {
    const text = String(responseText || '').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[Reranker:KB] No JSON object found in response:', text.slice(0, 200));
      return null;
    }
    const parsed = JSON.parse(jsonMatch[0]);

    // Accept ranked_ids (new format) — including empty array (means "none relevant")
    if (Array.isArray(parsed.ranked_ids)) {
      return {
        rankedIds: parsed.ranked_ids.map(id => parseInt(id, 10)).filter(id => !isNaN(id)),
        reason: parsed.reason || '',
      };
    }

    // Fallback: accept old picked_rank format
    if (typeof parsed.picked_rank === 'number' && parsed.picked_rank >= 1) {
      return {
        rankedIds: null,
        pickedRank: parsed.picked_rank,
        reason: parsed.reason || '',
      };
    }

    console.warn('[Reranker:KB] Parsed JSON but missing ranked_ids:', JSON.stringify(parsed).slice(0, 200));
    return null;
  } catch (e) {
    console.warn('[Reranker:KB] Failed to parse response:', e.message);
    return null;
  }
}

/**
 * Rerank knowledge base results using AI with rich context.
 * ALWAYS called (no similarity gap gate) — the AI is the sole decision maker.
 *
 * @param {string} query - User search query
 * @param {Array} results - Array of {id, name, similarity, content, category, indicatorIndex, ...}
 * @param {Object} options - { topN: number, mode: 'knowledge'|'mixed' }
 * @returns {Promise<{results: Array, reranked: boolean, reason?: string}>}
 */
async function rerankKnowledge(query, results, options = {}) {
  const { topN = 5, mode = 'knowledge' } = options;

  // Need at least 2 results to rerank
  if (!results || results.length < 2) {
    return { results: results || [], reranked: false };
  }

  const startTime = Date.now();

  try {
    const prompt = buildKnowledgeRerankPrompt(query, results, mode);

    const response = await openAiChatJson({
      apiKeyEnv: RERANK_API_KEY_ENV,
      model: requestContext.getModelOverride() || RERANK_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a knowledge base reranking assistant for BPS statistics. Respond with valid JSON only.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0,
      purpose: 'knowledge_reranker',
      reasoning: { effort: 'low' },
    });

    const latencyMs = Date.now() - startTime;
    const content = response?.choices?.[0]?.message?.content || '';

    const parsed = parseKnowledgeRerankResponse(content);

    if (parsed && parsed.rankedIds && parsed.rankedIds.length > 0) {
      // New format: reorder results by ranked_ids
      const resultMap = new Map(results.map(r => [r.id, r]));
      const reordered = [];
      const usedIds = new Set();

      for (const id of parsed.rankedIds) {
        const item = resultMap.get(id);
        if (item && !usedIds.has(id)) {
          reordered.push(item);
          usedIds.add(id);
          if (item.id !== results[0]?.id) {
            item.aiReranked = true;
            item.rerankReason = parsed.reason;
          }
        }
      }

      // Append remaining results not picked by AI (in original order, capped)
      for (const r of results) {
        if (!usedIds.has(r.id)) reordered.push(r);
      }

      const finalResults = reordered.slice(0, topN);

      console.log(`[Reranker:KB] Query: "${query}" -> Ranked ${parsed.rankedIds.length} items in ${latencyMs}ms. Top: id=${finalResults[0]?.id}. Reason: ${parsed.reason}`);

      return {
        results: finalResults,
        reranked: true,
        rankedIds: parsed.rankedIds,
        reason: parsed.reason,
        latencyMs,
      };
    }

    // Fallback: old pick-1 format
    if (parsed && parsed.pickedRank) {
      const reordered = reorderCandidates(results, parsed.pickedRank);
      console.log(`[Reranker:KB] Query: "${query}" -> Picked rank ${parsed.pickedRank} in ${latencyMs}ms (fallback). Reason: ${parsed.reason}`);
      return {
        results: reordered.slice(0, topN),
        reranked: parsed.pickedRank > 1,
        reason: parsed.reason,
        latencyMs,
      };
    }

    // Handle empty ranked_ids (AI says "none relevant") — return original order
    if (parsed && parsed.rankedIds && parsed.rankedIds.length === 0) {
      console.log(`[Reranker:KB] Query: "${query}" -> AI returned empty ranked_ids in ${latencyMs}ms. Reason: ${parsed.reason}. Returning original order.`);
      return { results: results.slice(0, topN), reranked: false, reason: parsed.reason, latencyMs };
    }

    console.warn(`[Reranker:KB] Failed to parse AI response for query: "${query}"`);
    return { results: results.slice(0, topN), reranked: false };

  } catch (e) {
    const latencyMs = Date.now() - startTime;
    console.error(`[Reranker:KB] Error for query "${query}" (${latencyMs}ms):`, e.message);
    return { results: results.slice(0, topN), reranked: false, error: e.message };
  }
}

/**
 * Rerank mixed results (datasources + knowledge)
 * Uses same rich-context reranker as knowledge, in 'mixed' mode
 */
async function rerankMixed(query, results, options = {}) {
  return rerankKnowledge(query, results, { ...options, mode: 'mixed' });
}

// =====================================================
// AI RELEVANCE FILTER FOR STATISTICAL PACKAGE
// =====================================================

// Month name mappings (Indonesian)

/**
 * Build period context for AI prompt
 * @param {Object} periodInfo - From extractPeriodFromQuery
 * @param {Object} geoInfo - From extractGeoFromQuery
 * @param {Map} periodsMap - Available periods for datasources
 * @returns {string} - Context string for AI
 */
function buildPeriodContext(periodInfo, geoInfo, periodsMap) {
  const {
    year,
    month,
    monthName,
    quarter,
    quarterInfo,
    semester,
    semesterInfo,
    hasExplicitPeriod,
  } = periodInfo;
  const { region, isExplicit: geoExplicit } = geoInfo;
  
  let context = '';
  
  // Geo context
  if (geoExplicit) {
    context += `Wilayah yang diminta: ${region}\n`;
  } else {
    context += `Wilayah: ${region} (default karena tidak disebutkan spesifik)\n`;
  }
  
  // Period context
  if (!hasExplicitPeriod) {
    context += `Periode: TERBARU (user tidak menyebutkan periode spesifik, cari data terbaru yang tersedia)\n`;
  } else {
    if (year && month) {
      const monthLabel = monthName || month;
      context += `Periode yang diminta: ${year}-${month} (bulan ${monthLabel} tahun ${year})\n`;
    } else if (year && quarterInfo) {
      context += `Periode yang diminta: ${year}-${quarterInfo.label.replace('Triwulan ', 'Q')} (${quarterInfo.label} tahun ${year})\n`;
    } else if (year && semester) {
      const semesterLabel = semesterInfo?.label || `Semester ${semester.replace('S', '')}`;
      context += `Periode yang diminta: ${year}-${semester} (${semesterLabel} tahun ${year})\n`;
    } else if (year) {
      context += `Periode yang diminta: Tahun ${year} (cari bulan/triwulan terbaru di tahun ${year})\n`;
    } else if (month) {
      const monthLabel = monthName || month;
      context += `Periode yang diminta: Bulan ${monthLabel} (cari tahun terbaru yang memiliki bulan ${month})\n`;
    } else if (quarterInfo) {
      context += `Periode yang diminta: ${quarterInfo.label} (cari tahun terbaru yang memiliki ${quarterInfo.label})\n`;
    } else if (semester) {
      const semesterLabel = semesterInfo?.label || `Semester ${semester.replace('S', '')}`;
      context += `Periode yang diminta: ${semesterLabel} (cari tahun terbaru yang memiliki ${semesterLabel})\n`;
    }
  }
  
  return context;
}

/**
 * Get available periods for datasources (for relevance filtering)
 * @param {number[]} sourceIds - Array of datasource IDs
 * @returns {Promise<Map<number, {periods: string[], latestPeriod: string, periodCount: number}>>}
 */
async function getPeriodsForDatasources(sourceIds) {
  const periodsMap = new Map();
  
  if (!sourceIds || sourceIds.length === 0) return periodsMap;
  
  try {
    const periodRows = await DataPeriod.findAll({
      where: { source_id: sourceIds },
      attributes: ['source_id', 'period_value'],
      order: [['period_value', 'DESC']],
      raw: true,
    });
    
    // Group by source_id
    for (const row of periodRows) {
      if (!periodsMap.has(row.source_id)) {
        periodsMap.set(row.source_id, {
          periods: [],
          latestPeriod: row.period_value,  // First is latest due to DESC order
          periodCount: 0,
        });
      }
      const entry = periodsMap.get(row.source_id);
      entry.periods.push(row.period_value);
      entry.periodCount++;
    }
  } catch (err) {
    console.warn('[RelevanceFilter] Failed to fetch periods:', err.message);
  }
  
  return periodsMap;
}

/**
 * Format period info for AI prompt
 * @param {string[]} periods - Array of period values
 * @returns {string} - Formatted string like "2023-2025, monthly up to 2025-12"
 */
function formatPeriodInfo(periods) {
  if (!periods || periods.length === 0) return 'no data';
  
  // Detect granularity from period format
  const latest = periods[0];
  const oldest = periods[periods.length - 1];
  
  // Monthly: "2025-12", "202512"
  // Quarterly: "2025-Q4", "2025Q4"
  // Yearly: "2025"
  
  if (latest.includes('-') && latest.length >= 7) {
    // Monthly format: YYYY-MM
    return `${oldest} to ${latest} (${periods.length} periods)`;
  } else if (latest.includes('Q')) {
    // Quarterly format
    return `${oldest} to ${latest} (${periods.length} quarters)`;
  } else if (latest.length === 4) {
    // Yearly format
    return `${oldest}-${latest} (${periods.length} years)`;
  } else if (latest.length === 6) {
    // YYYYMM format
    const latestFormatted = `${latest.slice(0, 4)}-${latest.slice(4)}`;
    const oldestFormatted = `${oldest.slice(0, 4)}-${oldest.slice(4)}`;
    return `${oldestFormatted} to ${latestFormatted} (${periods.length} periods)`;
  }
  
  // Fallback
  return `${periods.length} periods, latest: ${latest}`;
}

/**
 * Filter statistical package results using AI to determine true relevance
 * This is different from reranking - it REMOVES irrelevant results, not reorders them
 * 
 * @param {string} query - User search query
 * @param {Array} datasources - Array of datasource results [{id, name, similarity, ...}]
 * @param {Array} knowledgeDocs - Array of knowledge results [{id, title, category, similarity, ...}]
 * @param {Object} options - Options like minResultsToFilter, maxCandidates
 * @returns {Promise<{datasources: Array, knowledge: Array, filtered: boolean, reason?: string}>}
 */
async function filterStatisticalRelevance(query, datasources = [], knowledgeDocs = [], options = {}) {
  const {
    minResultsToFilter = 3,  // Only filter if we have at least this many results
    maxCandidates = 8,       // Max items to send to AI for filtering
  } = options;
  
  // Quick return if not enough results to filter
  const totalResults = datasources.length + knowledgeDocs.length;
  if (totalResults < minResultsToFilter) {
    return { datasources, knowledge: knowledgeDocs, filtered: false, reason: 'Not enough results to filter' };
  }
  
  const startTime = Date.now();
  
  try {
    // Fetch available periods for datasources
    const dsIds = datasources.slice(0, maxCandidates).map(ds => ds.id);
    const periodsMap = await getPeriodsForDatasources(dsIds);
    
    // Build candidate list for AI
    const candidates = [];
    
    // Add datasources (prefix with DS:) - include period info
    datasources.slice(0, maxCandidates).forEach((ds, i) => {
      const periodInfo = periodsMap.get(ds.id);
      const periodStr = periodInfo ? formatPeriodInfo(periodInfo.periods) : 'unknown';
      
      candidates.push({
        refId: `DS:${ds.id}`,
        type: 'datasource',
        name: ds.name,
        periodInfo: periodStr,
        latestPeriod: periodInfo?.latestPeriod || null,
        similarity: ds.similarity,
        originalIndex: i,
        original: ds,
      });
    });
    
    // Add knowledge docs (prefix with KB:)
    knowledgeDocs.slice(0, maxCandidates).forEach((kb, i) => {
      candidates.push({
        refId: `KB:${kb.id}`,
        type: kb.category?.toLowerCase() || 'knowledge',
        name: kb.title,
        periodInfo: null,  // KB doesn't have period info in the same way
        similarity: kb.similarity,
        originalIndex: i,
        original: kb,
      });
    });
    
    // Sort by similarity for better context to AI
    candidates.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
    
    // Extract period and geo context from query
    const periodInfo = extractPeriodFromQuery(query);
    const geoInfo = extractGeoFromQuery(query);
    const periodGeoContext = buildPeriodContext(periodInfo, geoInfo, periodsMap);
    
    // Build prompt - include period info for datasources
    const candidateList = candidates
      .slice(0, maxCandidates * 2)
      .map((c, i) => {
        const periodPart = c.periodInfo ? `, data: ${c.periodInfo}` : '';
        return `${i + 1}. [${c.refId}] ${c.name} (${c.type}${periodPart})`;
      })
      .join('\n');
    
    const prompt = `Anda adalah sistem pencarian data statistik BPS Maluku Utara.

Query pengguna: "${expandAbbreviationsInline(query)}"

Konteks yang dipahami:
${periodGeoContext}
Berikut kandidat hasil pencarian (datasource & BRS/publikasi):
${candidateList}

Tugas: Tentukan mana yang BENAR-BENAR RELEVAN dengan query pengguna.

Aturan pemilihan periode:
1. Jika user TIDAK menyebutkan periode → pilih datasource dengan data TERBARU yang tersedia
2. Jika user menyebutkan HANYA tahun (misal "2024") → pilih datasource yang punya data tahun tersebut, prioritaskan bulan/triwulan terbaru di tahun itu
3. Jika user menyebutkan HANYA bulan (misal "desember") → cari bulan tersebut dengan tahun TERBARU
4. Jika user menyebutkan bulan DAN tahun → harus ada data untuk bulan+tahun tersebut

Aturan pemilihan wilayah:
1. Jika user TIDAK menyebutkan wilayah → default Provinsi Maluku Utara
2. Jika user menyebutkan kabupaten/kota spesifik → prioritaskan data untuk wilayah tersebut

Kriteria relevansi topik:
1. Topik harus SAMA atau sangat terkait langsung dengan query
2. "migrasi penduduk" TIDAK sama dengan "pertumbuhan penduduk" atau "kepadatan penduduk"
3. "ekspor impor" TIDAK sama dengan "PDRB" atau "pendapatan"
4. Jika tidak ada yang relevan sama sekali, kembalikan array kosong

Jawab dalam format JSON:
{
  "relevant_ids": ["DS:123", "KB:456", ...],
  "reason": "<alasan singkat mengapa item lain tidak relevan>"
}

Hanya masukkan ID yang BENAR-BENAR menjawab query pengguna dengan data yang tersedia!`;

    const response = await openAiStructuredOutput({
      apiKeyEnv: RERANK_API_KEY_ENV,
      model: requestContext.getModelOverride() || RERANK_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a search relevance filter. Only include truly relevant results. Respond with valid JSON only.',
        },
        { role: 'user', content: prompt },
      ],
      maxTokens: 500,
      temperature: 0.1,
      schemaName: 'relevance_filter',
      purpose: 'relevance_filter',
      reasoning: { effort: 'low' },
      schema: {
        type: 'object',
        properties: {
          relevant_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'IDs of relevant items (e.g. "DS:123", "KB:456")',
          },
          reason: {
            type: 'string',
            description: 'Brief reason why other items were filtered out',
          },
        },
        required: ['relevant_ids', 'reason'],
        additionalProperties: false,
      },
    });
    
    const latencyMs = Date.now() - startTime;
    
    // Extract content from OpenAI response object
    let text = '';
    if (typeof response === 'string') {
      text = response;
    } else if (response?.choices?.[0]?.message?.content) {
      text = response.choices[0].message.content;
    } else if (response?.content) {
      text = response.content;
    }
    text = String(text || '').trim();
    
    // With structured output the response is guaranteed valid JSON,
    // but keep regex fallback for robustness
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn(`[RelevanceFilter] No JSON found in response for "${query}". Raw:`, text.slice(0, 200));
        return { datasources, knowledge: knowledgeDocs, filtered: false };
      }
      parsed = JSON.parse(jsonMatch[0]);
    }
    
    const relevantIds = Array.isArray(parsed.relevant_ids) ? parsed.relevant_ids : [];
    
    console.log(`[RelevanceFilter] Query: "${query}" -> ${relevantIds.length} relevant items in ${latencyMs}ms. Reason: ${parsed.reason || 'N/A'}`);
    
    // Filter results based on AI decision
    const filteredDatasources = datasources.filter(ds => relevantIds.includes(`DS:${ds.id}`));
    const filteredKnowledge = knowledgeDocs.filter(kb => relevantIds.includes(`KB:${kb.id}`));
    
    return {
      datasources: filteredDatasources,
      knowledge: filteredKnowledge,
      filtered: true,
      relevantIds,
      reason: parsed.reason,
      latencyMs,
      stats: {
        before: { datasources: datasources.length, knowledge: knowledgeDocs.length },
        after: { datasources: filteredDatasources.length, knowledge: filteredKnowledge.length },
      },
    };
    
  } catch (e) {
    const latencyMs = Date.now() - startTime;
    console.error(`[RelevanceFilter] Error for "${query}" (${latencyMs}ms):`, e.message);
    return { datasources, knowledge: knowledgeDocs, filtered: false, error: e.message };
  }
}

module.exports = {
  // Datasource reranker
  rerankCandidates,
  needsReranking,
  queryMayNeedDisambiguation,
  RERANK_SCORE_GAP_THRESHOLD,
  // Knowledge base reranker (V2 — rich context, ranked output)
  rerankKnowledge,
  rerankMixed,
  buildRichContext,
  KNOWLEDGE_RERANK_MAX_CANDIDATES,
  // Relevance filter for statistical package
  filterStatisticalRelevance,
  // Period helpers (exported for testing)
  getPeriodsForDatasources,
  formatPeriodInfo,
  // Query parsing helpers (exported for testing)
  extractPeriodFromQuery,
  extractGeoFromQuery,
  buildPeriodContext,
};
