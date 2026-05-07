/**
 * Knowledge Analyst Sub-Agent (Sub-Agent Option A)
 *
 * When knowledge context is very large (>30K chars), this sub-agent uses a fast
 * LLM (gpt-4.1) to distill the raw BRS/Publication content into a compact,
 * structured analysis focused on the user's query.
 *
 * This preserves accuracy by letting an LLM decide what's relevant (instead of
 * brute-force character trimming), while keeping the context size manageable
 * for the main response model.
 *
 * Flow:
 *   1. Receive user query + large knowledge documents
 *   2. Build a focused analysis prompt
 *   3. Call gpt-4.1 for fast extraction (~2-4s)
 *   4. Return structured analysis (5-15K chars) to replace raw content
 *
 * @module services/chat/streaming/knowledgeAnalyst
 */

'use strict';

const { createOpenAI } = require('@ai-sdk/openai');
const { generateText } = require('ai');
const logger = require('../../../utils/logger').child({ service: 'KnowledgeAnalyst' });
const requestContext = require('./requestContext');

// ── Configuration ──────────────────────────────────────────────────────────
const ANALYST_CONFIG = {
  // Threshold: if total knowledge content exceeds this, activate the analyst.
  //
  // With gpt-4.1 / gpt-5-mini having 1M token context (~4M chars), and
  // SMART_CONTEXT trimming docs to perDocChars (deep: 10×80K = 800K max),
  // the analyst is rarely needed. Its aggressive compression (700K→5K)
  // loses specific numeric values needed for comparison queries.
  //
  // Set to 2M chars so the analyst only activates for truly extreme contexts
  // (e.g., multiple 400K+ yearbooks). For typical queries (10 docs, 300-700K
  // total), SMART_CONTEXT handles sizing without lossy compression.
  //
  // Override via env KNOWLEDGE_ANALYST_THRESHOLD if needed.
  ACTIVATION_THRESHOLD_CHARS: parseInt(process.env.KNOWLEDGE_ANALYST_THRESHOLD || '2000000', 10),

  // Target output size for the analyst's summary
  TARGET_OUTPUT_CHARS: parseInt(process.env.KNOWLEDGE_ANALYST_TARGET_OUTPUT || '40000', 10),

  // Maximum input to send to the analyst (per document)
  MAX_INPUT_PER_DOC_CHARS: 80_000,

  // Maximum TOTAL input to the analyst (all docs combined)
  // With 1M token context, we can afford to send much more raw text.
  // 150K chars ≈ 37K tokens — well within budget.
  MAX_TOTAL_INPUT_CHARS: parseInt(process.env.KNOWLEDGE_ANALYST_BUDGET || '150000', 10),

  // Model for analysis (default fallback; overridden by user's model choice via requestContext)
  MODEL: 'gpt-4.1',

  // Temperature — low for factual extraction
  TEMPERATURE: 0.1,

  // Max output tokens
  MAX_TOKENS: parseInt(process.env.KNOWLEDGE_ANALYST_MAX_TOKENS || '4096', 10),

  // Timeout for the analyst call (ms) — increased for larger models like gpt-5-mini
  TIMEOUT_MS: parseInt(process.env.KNOWLEDGE_ANALYST_TIMEOUT_MS || '30000', 10),
};

/**
 * Check if knowledge analyst should be activated.
 * @param {Array} knowledgeContext - Array of knowledge documents
 * @returns {boolean}
 */
function shouldActivateAnalyst(knowledgeContext) {
  if (!knowledgeContext || knowledgeContext.length === 0) return false;

  const totalChars = knowledgeContext.reduce(
    (sum, doc) => sum + (doc.content?.length || 0), 0
  );

  return totalChars > ANALYST_CONFIG.ACTIVATION_THRESHOLD_CHARS;
}

/**
 * Build the analyst prompt for extracting relevant data from knowledge documents.
 * @param {string} userQuery - The user's query
 * @param {Array} knowledgeContext - Array of knowledge documents
 * @param {Object} options - Additional context
 * @param {string} options.geoLabel - Detected geography (e.g., "Kota Ternate")
 * @param {string} options.year - Detected year
 * @param {string} options.month - Detected month
 * @returns {string} The analysis prompt
 */
function buildAnalystPrompt(userQuery, knowledgeContext, options = {}) {
  const { geoLabel, year, month } = options;

  // Budget: distribute total chars across documents, prioritizing higher-similarity docs
  const totalBudget = ANALYST_CONFIG.MAX_TOTAL_INPUT_CHARS;
  const perDocMax = ANALYST_CONFIG.MAX_INPUT_PER_DOC_CHARS;
  const docCount = knowledgeContext.length;

  // Calculate per-doc budget: allocate more to higher-similarity docs
  // First doc gets up to 40%, rest share remaining 60%
  const firstDocBudget = Math.min(perDocMax, Math.floor(totalBudget * 0.4));
  const remainingBudget = totalBudget - firstDocBudget;
  const otherDocBudget = docCount > 1
    ? Math.min(perDocMax, Math.floor(remainingBudget / (docCount - 1)))
    : 0;

  // Build document content sections with budget enforcement
  let totalUsed = 0;
  const docSections = [];
  for (let i = 0; i < knowledgeContext.length; i++) {
    const doc = knowledgeContext[i];
    if (totalUsed >= totalBudget) break; // Hard stop

    const budget = i === 0 ? firstDocBudget : otherDocBudget;
    const available = Math.min(budget, totalBudget - totalUsed);
    const content = (doc.content || '').slice(0, available);

    const docType = doc.category === 'BRS' ? 'BRS (Berita Resmi Statistik)' :
      doc.category === 'Publikasi' ? 'Publikasi' : 'Dokumen';
    const truncNote = (doc.content || '').length > available ? ' [terpotong]' : '';
    const section = `=== DOKUMEN ${i + 1}: ${doc.title} (${docType}, relevansi: ${Math.round((doc.similarity || 0) * 100)}%${truncNote}) ===\n${content}`;
    docSections.push(section);
    totalUsed += section.length;
  }

  // Build context hints
  const contextHints = [];
  if (geoLabel) contextHints.push(`Wilayah yang ditanya: ${geoLabel}`);
  if (year) contextHints.push(`Tahun yang ditanya: ${year}`);
  if (month) contextHints.push(`Bulan yang ditanya: ${month}`);
  const contextStr = contextHints.length > 0
    ? `\nKONTEKS TAMBAHAN:\n${contextHints.join('\n')}\n`
    : '';

  return `Kamu adalah analis data BPS (Badan Pusat Statistik) yang ahli mengekstrak data statistik.

TUGAS: Ekstrak SEMUA data dan fakta yang relevan dari dokumen berikut untuk menjawab pertanyaan user.

PERTANYAAN USER: "${userQuery}"
${contextStr}
ATURAN EKSTRAKSI:
1. FOKUS pada data yang LANGSUNG menjawab pertanyaan user
2. SERTAKAN angka-angka spesifik (persentase, indeks, jumlah) — JANGAN hanya deskripsi
3. Jika ada tabel, ekstrak BARIS yang relevan dengan format terstruktur
4. Jika ada tren (naik/turun), sertakan perbandingan antar periode
5. Sertakan breakdown per wilayah/kelompok jika tersedia
6. Sertakan sumber/judul dokumen di awal ringkasan
7. JANGAN mengarang data yang tidak ada di dokumen
8. Jika ada data per kab/kota, prioritaskan wilayah yang ditanya user
9. Pertahankan PRESISI angka (jangan bulatkan)
10. Batasi output ke data PALING RELEVAN — hindari appendix/lampiran berulang

FORMAT OUTPUT:
[JUDUL SUMBER]: {judul dokumen}
[PERIODE]: {periode data}

[DATA UTAMA]:
- {fakta 1 dengan angka spesifik}
- {fakta 2 dengan angka spesifik}
...

[TABEL RINGKASAN] (jika ada):
{tabel ringkas dalam format teks}

[TREN/PERBANDINGAN] (jika ada):
- {perbandingan antar periode}

DOKUMEN YANG HARUS DIANALISIS:

${docSections.join('\n\n')}`;
}

/**
 * Run the Knowledge Analyst sub-agent to distill large knowledge documents.
 * 
 * @param {string} userQuery - The user's query
 * @param {Array} knowledgeContext - Array of knowledge documents with content
 * @param {Object} options - Additional context (geo, year, month)
 * @returns {Promise<{analysis: string, originalChars: number, analysisChars: number, model: string, latencyMs: number} | null>}
 */
async function analyzeKnowledge(userQuery, knowledgeContext, options = {}) {
  if (!shouldActivateAnalyst(knowledgeContext)) {
    return null;
  }

  const startTime = Date.now();
  const originalChars = knowledgeContext.reduce(
    (sum, doc) => sum + (doc.content?.length || 0), 0
  );

  logger.info({
    query: userQuery.slice(0, 100),
    docCount: knowledgeContext.length,
    originalChars,
    categories: knowledgeContext.map(d => d.category).join(','),
  }, 'Knowledge Analyst: activating for large context');

  try {
    const prompt = buildAnalystPrompt(userQuery, knowledgeContext, options);

    logger.info({
      promptChars: prompt.length,
      budgetChars: ANALYST_CONFIG.MAX_TOTAL_INPUT_CHARS,
    }, 'Knowledge Analyst: prompt built');

    // Create OpenAI provider — use same proxy as main pipeline
    const openai = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY_CHAT || '',
      baseURL: process.env.OPENAI_API_BASE_URL || 'http://127.0.0.1:3030/v1',
    });

    const result = await generateText({
      // ALWAYS use gpt-4.1 for analyst sub-agent — it's internal infrastructure
      // and must be fast. User's model choice only affects the main response stream.
      model: openai.chat(ANALYST_CONFIG.MODEL),
      messages: [
        { role: 'user', content: prompt },
      ],
      temperature: ANALYST_CONFIG.TEMPERATURE,
      maxTokens: ANALYST_CONFIG.MAX_TOKENS,
      abortSignal: AbortSignal.timeout(ANALYST_CONFIG.TIMEOUT_MS),
    });

    const analysis = result.text || '';
    const latencyMs = Date.now() - startTime;

    logger.info({
      originalChars,
      analysisChars: analysis.length,
      compressionRatio: (originalChars / Math.max(1, analysis.length)).toFixed(1),
      latencyMs,
      model: ANALYST_CONFIG.MODEL, // always fast model for sub-agent
      promptTokens: result.usage?.promptTokens,
      completionTokens: result.usage?.completionTokens,
    }, 'Knowledge Analyst: analysis complete');

    return {
      analysis,
      originalChars,
      analysisChars: analysis.length,
      model: ANALYST_CONFIG.MODEL, // always fast model for sub-agent
      latencyMs,
      usage: result.usage,
    };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    logger.warn({
      error: err.message,
      latencyMs,
      docCount: knowledgeContext.length,
      originalChars,
    }, 'Knowledge Analyst: failed, falling back to raw content');
    return null;
  }
}

/**
 * Apply the analyst's analysis to the knowledge context.
 * Replaces the content of all knowledge documents with the analyst's summary.
 * This produces a single consolidated document for the response LLM.
 *
 * @param {Array} knowledgeContext - Original knowledge documents
 * @param {Object} analysisResult - Result from analyzeKnowledge()
 * @returns {Array} Modified knowledge context with analyst's summary
 */
function applyAnalysis(knowledgeContext, analysisResult) {
  if (!analysisResult || !analysisResult.analysis) return knowledgeContext;

  // Create a single consolidated document from the analyst's output
  // Preserve the first document's metadata but replace content
  const consolidated = {
    ...knowledgeContext[0],
    content: analysisResult.analysis,
    _analystProcessed: true,
    _analystOriginalChars: analysisResult.originalChars,
    _analystModel: analysisResult.model,
  };

  // Keep other documents but clear their content (they're now in the analysis)
  // This preserves metadata for UI (titles, categories) without duplicating content
  const others = knowledgeContext.slice(1).map(doc => ({
    ...doc,
    content: `[Konten sudah dianalisis dan digabungkan ke dokumen utama di atas]`,
    _analystMerged: true,
  }));

  return [consolidated, ...others];
}

module.exports = {
  shouldActivateAnalyst,
  analyzeKnowledge,
  applyAnalysis,
  ANALYST_CONFIG,
};
