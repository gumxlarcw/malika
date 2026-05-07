/**
 * Tool Use Service (Function Calling for Chat Pipeline)
 *
 * HYBRID DESIGN: The pipeline runs deterministic stages (intent, knowledge,
 * preview) BEFORE streaming, populating ctx with pre-fetched data. Tools
 * provide INCREMENTAL capability — the LLM calls them only when pre-fetched
 * context isn't sufficient (comparisons, follow-ups, deeper knowledge search).
 *
 * Available tools:
 *   1. search_data       → Search datasources (context-aware: reuses if available)
 *   2. get_data_preview  → Fetch data table (context-aware: reuses if available)
 *   3. search_knowledge  → Search BRS/Publikasi knowledge base
 *   4. get_exim_data     → Fetch EXIM trade data
 *   5. recall_memory     → Search user's past conversations
 */

'use strict';

const { tool, jsonSchema } = require('ai');
const logger = require('../../../utils/logger').child({ service: 'ToolUse' });
const { resolveSearchIntent, buildDatasourceCandidates } = require('../../search/intent.service');
const { EXIM } = require('./config');
const memoryService = require('../threadMemory.service');
const KnowledgeBase = require('../../../models/KnowledgeBase.model');

// ── Helpers ────────────────────────────────────────────────────────────────

/** Simple word-overlap similarity (>50% overlap → "similar"), but year-aware. */
function isSimilarQuery(q1, q2) {
  if (!q1 || !q2) return false;
  // Extract years — if both mention different years, they are NOT similar
  const yearRegex = /\b(20\d{2})\b/g;
  const years1 = [...(q1.match(yearRegex) || [])];
  const years2 = [...(q2.match(yearRegex) || [])];
  if (years1.length > 0 && years2.length > 0) {
    const hasCommonYear = years1.some(y => years2.includes(y));
    if (!hasCommonYear) return false; // Different years → not similar
  }
  const toWords = s => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2));
  const w1 = toWords(q1);
  const w2 = toWords(q2);
  if (w1.size === 0 || w2.size === 0) return false;
  let overlap = 0;
  for (const w of w1) if (w2.has(w)) overlap++;
  return overlap / Math.min(w1.size, w2.size) > 0.5;
}

/** Format a candidate for tool response (compact, LLM-context oriented).
 *  Includes BPS metadata (unit, subject, responsible_party) when available
 *  — populated by datasourceAgent._loadCandidatesById from `indicator_meta`.
 *  These extra fields cost ~50-100 chars per candidate and let the LLM
 *  ground its responses in the actual unit + data steward.
 */
function formatCandidate(c) {
  const out = {
    id: c.id,
    name: c.name,
    type: c.type,
    score: c.score,
    category: c.category || null,
    description: c.description?.slice(0, 200) || '',
  };
  if (c.unit) out.unit = c.unit;
  if (c.subject_label) out.subject = c.subject_label;
  if (c.responsible_party) out.source = c.responsible_party;
  return out;
}

/** Format a knowledge doc for tool response. */
function formatKnowledgeDoc(d) {
  return {
    id: d.id,
    title: d.title,
    category: d.category,
    similarity: d.similarity ? +d.similarity.toFixed(3) : null,
    excerpt: d.content?.slice(0, 600) || '',
  };
}

// ── System Prompt (tool instructions appended when tools are enabled) ──────

const TOOL_INSTRUCTIONS = `## PENGGUNAAN TOOLS
Kamu memiliki akses ke tools berikut:
- search_data: Cari datasource/indikator statistik BPS berdasarkan kata kunci
- get_data_preview: Ambil data tabel dari datasource tertentu (perlu source_id dari search_data)
- search_knowledge: Cari dokumen BRS (Berita Resmi Statistik) dan Publikasi BPS
- search_document_table: Cari dan ekstrak TABEL SPESIFIK dari dokumen yang sudah ada di konteks (gunakan doc_id)
- get_exim_data: Ambil data ekspor/impor perdagangan luar negeri Maluku Utara
- recall_memory: Cari informasi dari riwayat percakapan sebelumnya

ATURAN PENGGUNAAN TOOLS:
1. Data/konteks mungkin SUDAH tersedia dari sistem. Periksa pesan konteks terlebih dahulu.
2. Gunakan tools HANYA jika konteks yang ada TIDAK CUKUP untuk menjawab pertanyaan.
3. Contoh kapan perlu tools:
   - User minta data indikator LAIN yang belum ada di konteks
   - User minta PERBANDINGAN multi-indikator (misal kemiskinan vs PDRB)
   - User bertanya tentang dokumen/laporan BPS yang belum ditemukan
   - Konteks dokumen terlalu panjang dan data yang relevan TIDAK jelas → gunakan search_document_table
   - User merujuk percakapan sebelumnya
4. JANGAN panggil tools jika konteks yang ada sudah cukup — langsung jawab.
5. Jika memanggil search_data, lanjutkan dengan get_data_preview untuk source_id yang relevan.
6. Untuk data ekspor/impor, gunakan get_exim_data langsung (jangan search_data). Jika user bertanya tentang ekspor DAN impor sekaligus, panggil get_exim_data DUA KALI: sekali dengan mode="ekspor" dan sekali dengan mode="impor".
7. WAJIB: Setelah mendapat hasil tool (termasuk jika tool mengembalikan "tidak ditemukan"), kamu HARUS tetap memberikan respons teks kepada user. JANGAN pernah memberikan respons kosong.
8. Jika tabel data tingkat PROVINSI sudah tersedia di konteks tapi user bertanya tentang kab/kota tertentu: JANGAN panggil tools lagi. LANGSUNG gunakan data provinsi yang ada, jelaskan bahwa data spesifik kab/kota tersebut belum tersedia untuk indikator ini, dan sajikan data provinsi sebagai referensi.
9. Jika konteks dokumen mengandung tanda ⭐ TABEL RESMI DIEKSTRAK — data sudah fokus, LANGSUNG gunakan tanpa memanggil tools lagi.
10. Gunakan search_document_table ketika dokumen besar (>100K) ada di konteks tapi kamu tidak yakin data yang tepat sudah diekstrak.`;

/** Data interpretation note added to tool results */
const DATA_INTERPRETATION_NOTE = 'Sajikan angka spesifik dari data ini. Jangan tampilkan JSON mentah. Jika sample terbatas, sebutkan total baris yang tersedia.';

// ── Tool Definitions ───────────────────────────────────────────────────────

/**
 * Build tool definitions for AI SDK streamText.
 *
 * Context-aware: tools check ctx for pre-fetched data before making
 * redundant calls. New results are merged (not overwritten) into ctx.
 *
 * @param {Object} ctx - Pipeline context (populated by deterministic stages)
 * @param {Object} svc - Legacy service reference
 * @returns {Object} - Tools object for streamText({ tools: ... })
 */
function buildTools(ctx, svc) {
  const tools = {};

  // ── Tool 1: Search datasources ──────────────────────────────────────
  tools.search_data = tool({
    description:
      'Cari indikator/datasource statistik BPS berdasarkan kata kunci. ' +
      'Contoh: kemiskinan, penduduk, PDRB, inflasi, pengangguran, IPM. ' +
      'Konteks mungkin sudah berisi hasil pencarian — panggil hanya jika perlu indikator TAMBAHAN.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Kata kunci pencarian, misal "kemiskinan", "jumlah penduduk", "PDRB"' },
        limit: { type: 'number', description: 'Jumlah maksimal hasil (default 5)' },
      },
      required: ['query'],
      additionalProperties: false,
    }),
    execute: async ({ query, limit }) => {
      try {
        // Context-aware: reuse pre-fetched candidates when query is similar
        // Also check _pipelineCandidates (stashed by knowledge mode before clearing)
        const availableCandidates = ctx.candidates?.length > 0
          ? ctx.candidates
          : (ctx._pipelineCandidates?.length > 0 ? ctx._pipelineCandidates : null);

        if (availableCandidates && isSimilarQuery(query, ctx.effectiveQuery || ctx.userMessage)) {
          logger.debug({ query, source: ctx.candidates?.length > 0 ? 'candidates' : 'pipeline_stash' }, 'search_data: returning pre-fetched candidates (similar query)');
          // Restore to ctx.candidates so downstream tools (get_data_preview) can use them
          if (!ctx.candidates?.length) ctx.candidates = [...availableCandidates];
          return {
            found: true,
            count: availableCandidates.length,
            cached: true,
            candidates: availableCandidates.slice(0, limit || 5).map(formatCandidate),
          };
        }

        const intentResult = await resolveSearchIntent({ q: query, context: {} });
        let newCandidates = await buildDatasourceCandidates({
          q: query,
          qb: intentResult?.query_builder || null,
          limit: limit || 5,
        });

        // Fallback: if fresh QB returned unknown/empty but pipeline had valid results, use pipeline's QB
        if ((!newCandidates || newCandidates.length === 0) && ctx.intentResult?.query_builder) {
          logger.debug({ query }, 'search_data: fresh QB returned empty, falling back to pipeline QB');
          newCandidates = await buildDatasourceCandidates({
            q: query,
            qb: ctx.intentResult.query_builder,
            limit: limit || 5,
          });
        }

        // Fallback 2: use stashed pipeline candidates if fresh search completely failed
        if ((!newCandidates || newCandidates.length === 0) && ctx._pipelineCandidates?.length > 0) {
          logger.debug({ query }, 'search_data: using stashed pipeline candidates');
          ctx.candidates = [...ctx._pipelineCandidates];
          return {
            found: true,
            count: ctx.candidates.length,
            cached: true,
            candidates: ctx.candidates.slice(0, limit || 5).map(formatCandidate),
          };
        }

        // Merge new candidates with existing (dedup by id)
        const existingIds = new Set((ctx.candidates || []).map(c => c.id));
        const uniqueNew = (Array.isArray(newCandidates) ? newCandidates : []).filter(c => !existingIds.has(c.id));
        if (uniqueNew.length > 0) {
          ctx.candidates = [...(ctx.candidates || []), ...uniqueNew];
        }
        // Preserve first intent result (don't overwrite pipeline's)
        if (!ctx.intentResult) ctx.intentResult = intentResult;

        if (!ctx.candidates?.length) {
          return { found: false, message: 'Tidak ditemukan indikator yang cocok untuk query ini.' };
        }

        return {
          found: true,
          count: ctx.candidates.length,
          candidates: ctx.candidates.slice(0, limit || 5).map(formatCandidate),
        };
      } catch (error) {
        logger.warn({ error: error.message }, 'search_data tool failed');
        return { found: false, error: error.message };
      }
    },
  });

  // ── Tool 2: Get data preview ────────────────────────────────────────
  tools.get_data_preview = tool({
    description:
      'Ambil data tabel dari datasource tertentu. Gunakan setelah search_data menemukan datasource yang relevan. ' +
      'Jika data tahun yang diminta tidak tersedia, otomatis mencari periode terdekat.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        source_id: { type: 'number', description: 'ID datasource dari hasil search_data' },
        year: { type: 'number', description: 'Tahun data (misal 2025). Kosongkan untuk data terbaru.' },
        geo: { type: 'string', description: 'Filter wilayah, misal "Ternate", "Halmahera Utara"' },
      },
      required: ['source_id'],
      additionalProperties: false,
    }),
    execute: async ({ source_id, year, geo }) => {
      try {
        // Context-aware: if pipeline already fetched a preview for THIS source, reuse it
        if (ctx.dataPreview && ctx._previewSourceId === source_id && !geo) {
          logger.debug({ source_id }, 'get_data_preview: returning pre-fetched preview');
          return {
            found: true,
            cached: true,
            source: ctx.dataPreview.title,
            rows: ctx.dataPreview.total_rows || ctx.dataPreview.rows?.length || 0,
            columns: ctx.dataPreview.columns || [],
            sample_data: (ctx.dataPreview.rows || []).slice(0, 10),
            interpretation_note: DATA_INTERPRETATION_NOTE,
          };
        }

        // Try year-specific first
        if (svc.getProcessedPreviewFromCache) {
          const targetYear = year || null;
          const data = targetYear
            ? await svc.getProcessedPreviewFromCache({
              sourceId: source_id, year: targetYear, month: null, geo: geo || null,
            })
            : null;

          if (data?.data?.length > 0) {
            return _storeAndReturnPreview(ctx, data, source_id, targetYear, geo, null);
          }
        }

        // Fallback: find nearest available period
        if (svc.findNearestAvailablePeriod) {
          const nearest = await svc.findNearestAvailablePeriod(source_id, year || null);
          if (nearest?.period && svc.getProcessedPreviewFromCache) {
            const data = await svc.getProcessedPreviewFromCache({
              sourceId: source_id, year: nearest.period, month: null, geo: geo || null,
            });
            if (data?.data?.length > 0) {
              const fallback = year && nearest.period !== year
                ? { requestedYear: year, actualYear: nearest.period, direction: nearest.direction }
                : null;
              return _storeAndReturnPreview(ctx, data, source_id, nearest.period, geo, fallback);
            }
          }
        }

        return { found: false, message: `Data untuk source_id=${source_id} tidak ditemukan.` };
      } catch (error) {
        logger.warn({ error: error.message }, 'get_data_preview tool failed');
        return { found: false, error: error.message };
      }
    },
  });

  // ── Tool 3: Search knowledge base ───────────────────────────────────
  tools.search_knowledge = tool({
    description:
      'Cari dokumen BRS (Berita Resmi Statistik), Publikasi, dan dokumen BPS lainnya. ' +
      'Gunakan ketika user bertanya tentang laporan resmi, siaran pers, metodologi, ringkasan statistik, atau cari data naratif.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Kata kunci pencarian dokumen, misal "kemiskinan 2025", "statistik migrasi"' },
        limit: { type: 'number', description: 'Jumlah dokumen maksimal (1-5, default 3)' },
      },
      required: ['query'],
      additionalProperties: false,
    }),
    execute: async ({ query, limit }) => {
      try {
        // Context-aware: if knowledge already fetched for similar query, reuse
        if (ctx.knowledgeContext?.length > 0 && isSimilarQuery(query, ctx.effectiveQuery || ctx.userMessage)) {
          logger.debug({ query }, 'search_knowledge: returning pre-fetched knowledge');
          return {
            found: true,
            count: ctx.knowledgeContext.length,
            cached: true,
            documents: ctx.knowledgeContext.slice(0, limit || 3).map(formatKnowledgeDoc),
          };
        }

        if (!svc.searchKnowledgeBase) {
          return { found: false, message: 'Knowledge base search not available' };
        }

        const results = await svc.searchKnowledgeBase(query, Math.min(limit || 3, 5));
        const docs = results?.results || results || [];

        if (!docs.length) {
          return { found: false, message: 'Tidak ditemukan dokumen yang relevan.' };
        }

        // Merge with existing knowledge context (dedup by id)
        const existingIds = new Set((ctx.knowledgeContext || []).map(d => d.id));
        const uniqueNew = docs.filter(d => !existingIds.has(d.id));
        if (uniqueNew.length > 0) {
          ctx.knowledgeContext = [...(ctx.knowledgeContext || []), ...uniqueNew];
        }
        ctx.isKnowledgeMode = true;

        return {
          found: true,
          count: ctx.knowledgeContext.length,
          documents: ctx.knowledgeContext.slice(0, limit || 3).map(formatKnowledgeDoc),
        };
      } catch (error) {
        logger.warn({ error: error.message }, 'search_knowledge tool failed');
        return { found: false, error: error.message };
      }
    },
  });

  // ── Tool 3b: Search specific table in a document ────────────────────
  tools.search_document_table = tool({
    description:
      'Cari dan ekstrak tabel spesifik dari dokumen BRS/Publikasi BPS yang SUDAH ada di konteks. ' +
      'Gunakan ketika konteks dokumen terlalu panjang dan kamu perlu data tabel tertentu dari dokumen tersebut. ' +
      'Tool ini akan mengembalikan data tabel yang tepat berdasarkan nomor tabel atau kata kunci.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        doc_id: { type: 'number', description: 'ID dokumen dari konteks knowledge (misal 855)' },
        table_query: { type: 'string', description: 'Kata kunci tabel yang dicari, misal "sekolah TK", "kemiskinan", "padi sawah"' },
        table_number: { type: 'string', description: 'Nomor tabel spesifik jika diketahui, misal "4.1.1", "3.5"' },
      },
      required: ['doc_id', 'table_query'],
      additionalProperties: false,
    }),
    execute: async ({ doc_id, table_query, table_number }) => {
      try {
        const doc = await KnowledgeBase.findByPk(doc_id, {
          attributes: ['id', 'title', 'content', 'content_length', 'indicator_index'],
        });
        if (!doc || !doc.content) {
          return { found: false, message: `Dokumen ID ${doc_id} tidak ditemukan.` };
        }

        const indicatorIndex = doc.indicator_index || '';
        const queryLower = table_query.toLowerCase();
        const { SHORT_WORD_WHITELIST } = require('../../../shared/bpsAbbreviations');
        const stopWords = new Set(['yang', 'dan', 'atau', 'untuk', 'dari', 'bps', 'data', 'tahun',
          'provinsi', 'maluku', 'utara', 'kabupaten', 'kota', 'berapa', 'per', 'menurut', 'di']);
        const queryWords = queryLower.split(/\s+/).filter(w => (w.length >= 3 || SHORT_WORD_WHITELIST.has(w)) && !stopWords.has(w));

        // If table_number is provided, find it directly
        if (table_number) {
          const content = doc.content;
          const contentLower = content.toLowerCase();
          const patterns = [
            `tabel ${table_number}`, `table ${table_number}`,
            `tabel  ${table_number}`, `table  ${table_number}`,
          ];
          let pos = -1;
          for (const p of patterns) {
            pos = contentLower.indexOf(p, Math.floor(content.length * 0.10));
            if (pos >= 0) break;
          }
          if (pos >= 0) {
            const start = Math.max(0, pos - 200);
            const end = Math.min(content.length, pos + 5000);
            const alignedStart = start === 0 ? 0 : (content.indexOf('\n', start) + 1) || start;
            const tableData = content.slice(alignedStart, end);
            return {
              found: true,
              doc_id, title: doc.title,
              table_number, table_data: tableData,
              note: 'Data tabel diekstrak langsung. Gunakan angka dari kolom tahun TERBARU.',
            };
          }
        }

        // Search via indicator_index
        if (indicatorIndex && queryWords.length > 0) {
          const entries = indicatorIndex.split('\n');
          const METADATA_TYPES = new Set(['KEYWORDS', 'TOPICS', 'PERIOD', 'ABBREV', 'INFO']);
          const matchedEntries = [];
          for (const entry of entries) {
            const parts = entry.split('|');
            if (parts.length < 3) continue;
            const [type, num, title] = parts;
            if (METADATA_TYPES.has(type)) continue;
            const titleLower = title.toLowerCase();
            let matchCount = 0;
            for (const word of queryWords) {
              if (titleLower.includes(word)) matchCount++;
            }
            if (matchCount >= 1) {
              matchedEntries.push({ type, num, title, matchCount, entry });
            }
          }
          matchedEntries.sort((a, b) => b.matchCount - a.matchCount);

          if (matchedEntries.length > 0) {
            const best = matchedEntries[0];
            // Find the table in the document
            const content = doc.content;
            const contentLower = content.toLowerCase();
            const TYPE_PATTERNS = {
              TBL: [`tabel ${best.num}`, `table ${best.num}`],
              BAB: [`bab ${best.num}`], FIG: [`gambar ${best.num}`],
              APP: [`lampiran ${best.num}`], TOC: [`${best.num} `],
            };
            const searchPats = (TYPE_PATTERNS[best.type] || []);
            searchPats.push(`${best.num}  `);
            let pos = -1;
            for (const p of searchPats) {
              pos = contentLower.indexOf(p, Math.floor(content.length * 0.10));
              if (pos >= 0) break;
            }
            if (pos >= 0) {
              const start = Math.max(0, pos - 200);
              const end = Math.min(content.length, pos + 5000);
              const alignedStart = start === 0 ? 0 : (content.indexOf('\n', start) + 1) || start;
              const tableData = content.slice(alignedStart, end);
              // Extract year from title
              const yearMatch = best.title.match(/(20\d{2})(?:\/20\d{2})?/);
              return {
                found: true,
                doc_id, title: doc.title,
                table_number: best.num, table_title: best.title,
                table_data: tableData,
                matched_entries: matchedEntries.slice(0, 3).map(e => `${e.type}|${e.num}|${e.title}`),
                note: yearMatch ? `Data tabel berisi tahun ${yearMatch[0]}. GUNAKAN data kolom tahun TERBARU.` : 'Gunakan data kolom tahun TERBARU.',
              };
            }
          }
        }

        // Fallback: keyword search in content
        if (queryWords.length > 0) {
          const content = doc.content;
          const contentLower = content.toLowerCase();
          const deepStart = Math.floor(content.length * 0.15);
          const step = 2000;
          let bestPos = -1, bestScore = 0;
          for (let i = deepStart; i < content.length - step; i += step) {
            const section = contentLower.slice(i, i + step);
            let score = 0;
            for (const term of queryWords) {
              score += (section.split(term).length - 1);
            }
            if (/\d+[.,]\d+.*\d+[.,]\d+/.test(section)) score += 2;
            if (score > bestScore) { bestScore = score; bestPos = i; }
          }
          if (bestPos >= 0 && bestScore >= 2) {
            const start = Math.max(0, bestPos - 200);
            const end = Math.min(content.length, bestPos + 5000);
            const tableData = content.slice(start, end);
            return {
              found: true,
              doc_id, title: doc.title,
              method: 'keyword_search', keyword_score: bestScore,
              table_data: tableData,
              note: 'Data ditemukan via pencarian kata kunci. Gunakan angka yang paling relevan.',
            };
          }
        }

        return { found: false, message: `Tabel "${table_query}" tidak ditemukan di dokumen ${doc.title}.` };
      } catch (error) {
        logger.warn({ error: error.message, doc_id }, 'search_document_table tool failed');
        return { found: false, error: error.message };
      }
    },
  });

  // ── Tool 4: Get EXIM data ───────────────────────────────────────────
  tools.get_exim_data = tool({
    description:
      'Ambil data ekspor/impor perdagangan luar negeri Maluku Utara. ' +
      'Gunakan ketika user bertanya tentang ekspor, impor, perdagangan internasional, komoditas ekspor, negara tujuan, pelabuhan.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['ekspor', 'impor'], description: 'ekspor atau impor' },
        year: { type: 'number', description: 'Tahun data (misal 2025)' },
        month: { type: 'number', description: 'Bulan (1-12). Kosongkan untuk data tahunan.' },
        group: { type: 'string', enum: ['hs2', 'ctr', 'pod'], description: 'Pengelompokan: hs2=komoditas, ctr=negara tujuan, pod=pelabuhan' },
      },
      required: ['mode', 'year'],
      additionalProperties: false,
    }),
    execute: async ({ mode, year, month, group }) => {
      try {
        // Context-aware: if EXIM preview already exists for same params, reuse
        if (ctx.isEximQuery && ctx.dataPreview && ctx.eximParams?.mode === mode) {
          logger.debug({ mode, year }, 'get_exim_data: returning pre-fetched EXIM data');
          return {
            found: true,
            cached: true,
            source: ctx.dataPreview.title,
            rows: ctx.dataPreview.total_rows || ctx.dataPreview.rows?.length || 0,
            columns: ctx.dataPreview.columns || [],
            sample_data: (ctx.dataPreview.rows || []).slice(0, 10),
            interpretation_note: DATA_INTERPRETATION_NOTE,
          };
        }

        // Also check secondary preview (for dual ekspor+impor)
        if (ctx.dataPreviewSecondary && ctx.dataPreviewSecondary.eximMode === mode) {
          logger.debug({ mode, year }, 'get_exim_data: returning pre-fetched secondary EXIM data');
          return {
            found: true,
            cached: true,
            source: ctx.dataPreviewSecondary.title,
            rows: ctx.dataPreviewSecondary.total_rows || ctx.dataPreviewSecondary.rows?.length || 0,
            columns: ctx.dataPreviewSecondary.columns || [],
            sample_data: (ctx.dataPreviewSecondary.rows || []).slice(0, 10),
            interpretation_note: DATA_INTERPRETATION_NOTE,
          };
        }

        // Also check if primary preview matches this mode (for 'both' pre-fetch)
        if (ctx.dataPreview && ctx.dataPreview.eximMode === mode) {
          logger.debug({ mode, year }, 'get_exim_data: returning matching primary EXIM data');
          return {
            found: true,
            cached: true,
            source: ctx.dataPreview.title,
            rows: ctx.dataPreview.total_rows || ctx.dataPreview.rows?.length || 0,
            columns: ctx.dataPreview.columns || [],
            sample_data: (ctx.dataPreview.rows || []).slice(0, 10),
            interpretation_note: DATA_INTERPRETATION_NOTE,
          };
        }

        if (!svc.getEximPreviewFromApi) {
          return { found: false, message: 'EXIM data service not available' };
        }

        const sourceId = mode === 'impor' ? EXIM.IMPOR_SOURCE_ID : EXIM.EKSPOR_SOURCE_ID;
        ctx.isEximQuery = true;
        if (!ctx.eximParams) ctx.eximParams = { group: group || null, month: month || null, facets: {}, mode };

        const data = await svc.getEximPreviewFromApi({
          sourceId, year, month: month || null,
          group: group || null, codeHs: null, pod: null, ctr: null, metric: null,
        });

        if (data?.data?.length > 0) {
          const modeLabel = mode === 'ekspor' ? 'Ekspor' : 'Impor';
          const groupLabel = group === 'hs2' ? ' (per Komoditas)' : group === 'ctr' ? ' (per Negara)' : group === 'pod' ? ' (per Pelabuhan)' : '';
          const preview = {
            title: `${modeLabel} Maluku Utara${groupLabel} • ${year}`,
            columns: (data.columns || []).slice(0, 12),
            rows: data.data.slice(0, 20),
            total_rows: data.data.length,
            from: data.from, eximGroup: group, eximMode: mode,
          };

          // If primary preview already has a DIFFERENT exim mode, store as secondary
          if (ctx.dataPreview && ctx.dataPreview.eximMode && ctx.dataPreview.eximMode !== mode) {
            ctx.dataPreviewSecondary = preview;
          } else if (!ctx.dataPreview) {
            ctx.dataPreview = preview;
          } else {
            // Overwrite primary if same mode or non-exim
            ctx.dataPreview = preview;
          }

          return {
            found: true,
            source: `${modeLabel}${groupLabel}`,
            year, month: month || null,
            rows: data.data.length,
            columns: data.columns?.slice(0, 12) || [],
            sample_data: data.data.slice(0, 10),
            interpretation_note: DATA_INTERPRETATION_NOTE,
          };
        }

        return { found: false, message: `Data ${mode} tahun ${year} tidak ditemukan.` };
      } catch (error) {
        logger.warn({ error: error.message }, 'get_exim_data tool failed');
        return { found: false, error: error.message };
      }
    },
  });

  // ── Tool 5: Recall user memory ──────────────────────────────────────
  tools.recall_memory = tool({
    description:
      'Cari informasi dari percakapan/thread sebelumnya user ini. ' +
      'Gunakan ketika user merujuk ke percakapan sebelumnya atau kamu perlu konteks historis.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Kata kunci untuk mencari di riwayat percakapan' },
      },
      required: ['query'],
      additionalProperties: false,
    }),
    execute: async ({ query }) => {
      try {
        if (!ctx.ownerId) {
          return { found: false, message: 'User context not available for memory search.' };
        }
        const results = await memoryService.searchUserThreads(ctx.ownerId, query, { limit: 3 });

        if (!results || results.length === 0) {
          return { found: false, message: 'Tidak ditemukan percakapan sebelumnya yang relevan.' };
        }

        // Store in ctx for potential UI display
        ctx.memoryResults = results;

        return {
          found: true,
          count: results.length,
          threads: results.map(r => ({
            threadId: r.threadId,
            title: r.title,
            summary: r.summary?.slice(0, 400) || '',
            similarity: r.similarity ? +r.similarity.toFixed(3) : null,
          })),
        };
      } catch (error) {
        logger.warn({ error: error.message }, 'recall_memory tool failed');
        return { found: false, error: error.message };
      }
    },
  });

  return tools;
}

// ── Preview helper (shared by get_data_preview) ───────────────────────────

function _storeAndReturnPreview(ctx, data, sourceId, year, geo, periodFallback) {
  ctx.dataPreview = {
    title: `${data.source} • ${year}${geo ? ` • ${geo}` : ''}`,
    columns: (data.columns || []).slice(0, 12),
    total_columns: (data.columns || []).length,
    rows: data.data.slice(0, 50),
    total_rows: data.data.length,
    geo: geo || null,
    from: data.from,
  };
  ctx._previewSourceId = sourceId;
  if (periodFallback) ctx.periodFallback = periodFallback;

  return {
    found: true,
    source: data.source,
    year,
    requested_year: periodFallback?.requestedYear || null,
    period_note: periodFallback
      ? `Data tahun ${periodFallback.requestedYear} tidak tersedia, ditampilkan data ${periodFallback.actualYear}`
      : null,
    rows: data.data.length,
    columns: data.columns?.slice(0, 12) || [],
    sample_data: data.data.slice(0, 10),
    interpretation_note: DATA_INTERPRETATION_NOTE,
  };
}

// ── Configuration ──────────────────────────────────────────────────────────

/** Max tool-call round-trips before forcing a final text response. */
const MAX_TOOL_STEPS = 3;

/**
 * Check if tool use should be enabled for this query.
 * Greetings, confirmations, and very short fragments don't benefit from tools.
 */
function shouldEnableToolUse(ctx) {
  if (ctx.isGreeting) return false;
  if (ctx.isConfirm) return false;
  return true;
}

module.exports = {
  buildTools,
  shouldEnableToolUse,
  MAX_TOOL_STEPS,
  TOOL_INSTRUCTIONS,
};
