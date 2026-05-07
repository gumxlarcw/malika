/**
 * Query Orchestrator (Sub-Agent Option C)
 *
 * For complex analytical queries, decomposes the user question into focused
 * sub-tasks, runs parallel worker agents for targeted extraction, and injects
 * their pre-analyzed findings into the system prompt for the final response model.
 *
 * Architecture:
 *   1. Planner  (gpt-4.1): Decomposes query into 2-4 sub-questions
 *   2. Workers  (gpt-4.1, parallel): Each answers one sub-question
 *   3. Injector: Appends combined worker output to system prompt
 *
 * Activation:
 *   - Model tier is COMPLEX / DEEP / USER_OVERRIDE
 *   - Query matches analytical patterns (comparison, trend, ranking, etc.)
 *   - OR has both data preview AND knowledge context
 *
 * Cost:   ~$0.003-0.005 per activation (3-5 nano calls)
 * Latency: +3-8s (planner 1-2s + parallel workers 2-6s)
 *
 * @module services/chat/streaming/orchestrator
 */

'use strict';

const { createOpenAI } = require('@ai-sdk/openai');
const { generateText } = require('ai');
const logger = require('../../../utils/logger').child({ service: 'Orchestrator' });
const requestContext = require('./requestContext');

// ── Configuration ──────────────────────────────────────────────────────────
const ORCH_CONFIG = {
  // LLM model for planner + workers (default fallback; overridden by user's model choice)
  MODEL: 'gpt-4.1',
  TEMPERATURE: 0.1,

  // Token limits
  PLANNER_MAX_TOKENS: 1024,
  WORKER_MAX_TOKENS: 3000,

  // Timeout per call (25s — workers do complex LLM analysis)
  TIMEOUT_MS: 25_000,

  // Global wall-clock timeout for entire orchestration (planner + all workers)
  GLOBAL_TIMEOUT_MS: 60_000,

  // Maximum number of parallel workers
  MAX_WORKERS: 4,

  // Context size limits per worker (chars)
  MAX_DATA_CHARS_PER_WORKER: 15_000,
  MAX_KNOWLEDGE_CHARS_PER_WORKER: 10_000,

  // Analytical query patterns (trigger orchestrator)
  ANALYTICAL_PATTERNS: [
    /bandingan|bandingkan|compare|komparasi|versus|\bvs\b/i,
    /tren|trend|pertumbuhan|growth|perkembangan/i,
    /tertinggi|terendah|paling|ranking|rangking|peringkat/i,
    /distribusi|proporsi|komposisi/i,
    /sebab|mengapa|faktor|penyebab|kenapa/i,
    /analisis|analisa|elaborate|mendalam|detail/i,
    /hubungan|korelasi|correlation|dampak|pengaruh/i,
    /semua.*kabupaten|per.*kabupaten|antar.*wilayah|per.*kota/i,
    /perbandingan|kontribusi|share|pangsa/i,
    /proyeksi|prediksi|forecast/i,
  ],
};

// ── Activation Check ───────────────────────────────────────────────────────

/**
 * Determine if the orchestrator should activate for this pipeline context.
 *
 * @param {Object} ctx - Pipeline context (after stageModelSelect)
 * @returns {boolean}
 */
function shouldActivateOrchestrator(ctx) {
  // Never activate for greetings
  if (ctx.isGreeting) return false;

  // Must have substantive context
  const hasData = ctx.dataPreview?.rows?.length > 0;
  const hasKnowledge = ctx.knowledgeContext?.length > 0;
  if (!hasData && !hasKnowledge) return false;

  // Check for analytical query patterns
  const query = (ctx.effectiveQuery || ctx.userMessage || '').toLowerCase();
  const isAnalytical = ORCH_CONFIG.ANALYTICAL_PATTERNS.some(p => p.test(query));

  // Tier-based activation for non-analytical queries
  const tier = ctx.modelRoute?.tier;
  const isComplexTier = tier && ['complex', 'deep', 'user_override'].includes(tier);

  // Also activate when BOTH data table and knowledge docs are present
  // (complex cross-referencing scenario) AND tier is complex+
  const hasBothSources = hasData && hasKnowledge;

  // Activate if:
  // 1. Analytical pattern detected (ANY tier — patterns are reliable enough)
  // 2. Both data + knowledge AND complex tier (cross-referencing)
  const shouldActivate = isAnalytical || (hasBothSources && isComplexTier);

  if (!shouldActivate) {
    logger.debug({ query: query.slice(0, 80), isAnalytical, tier, hasData, hasKnowledge, hasBothSources },
      'Orchestrator: skipped');
  }

  return shouldActivate;
}

// ── Context Serialization ──────────────────────────────────────────────────

/**
 * Build a compact summary of available context (for planner input).
 * Does NOT include full content — just metadata about what's available.
 *
 * @param {Object} ctx - Pipeline context
 * @returns {string}
 */
function buildContextSummary(ctx) {
  const parts = [];

  // Data table summary
  if (ctx.dataPreview?.rows?.length > 0) {
    const dp = ctx.dataPreview;
    const cols = dp.columns || [];
    const sampleRow = dp.rows[0] || {};
    const sampleValues = cols.slice(0, 6).map(c => `${c}: ${sampleRow[c] ?? '-'}`);
    parts.push(`[DATA TABEL] "${dp.title}" — ${dp.total_rows || dp.rows.length} baris × ${cols.length} kolom`);
    parts.push(`  Kolom: ${cols.join(', ')}`);
    parts.push(`  Contoh baris 1: ${sampleValues.join(', ')}`);
    if (dp.geo) parts.push(`  Filter wilayah: ${dp.geo}`);
    if (dp.periodRange) parts.push(`  Rentang periode: ${dp.periodRange.requested?.start}–${dp.periodRange.requested?.end}`);
  }

  // Knowledge context summary
  if (ctx.knowledgeContext?.length > 0) {
    parts.push(`[DOKUMEN REFERENSI] ${ctx.knowledgeContext.length} dokumen:`);
    for (const doc of ctx.knowledgeContext.slice(0, 5)) {
      const type = doc.category === 'BRS' ? 'BRS' : doc.category === 'Publikasi' ? 'Pub' : 'Doc';
      const charCount = (doc.content || '').length;
      parts.push(`  - [${type}] "${doc.title}" (${charCount} chars, rel: ${Math.round((doc.similarity || 0) * 100)}%)`);
    }
  }

  // Data preview secondary
  if (ctx.dataPreviewSecondary?.rows?.length > 0) {
    const dp2 = ctx.dataPreviewSecondary;
    parts.push(`[DATA TABEL 2] "${dp2.title}" — ${dp2.total_rows || dp2.rows.length} baris`);
  }

  return parts.join('\n');
}

/**
 * Serialize data table to text for worker input.
 *
 * @param {Object} dataPreview - ctx.dataPreview
 * @param {number} maxChars - Maximum chars to output
 * @returns {string}
 */
function serializeDataTable(dataPreview, maxChars = 15_000) {
  if (!dataPreview?.rows?.length) return '';

  const cols = dataPreview.columns || [];
  const lines = [];
  lines.push(`TABEL: ${dataPreview.title || 'Data Statistik'}`);
  if (dataPreview.geo) lines.push(`Wilayah: ${dataPreview.geo}`);
  lines.push('');

  // Markdown table
  lines.push('| ' + cols.join(' | ') + ' |');
  lines.push('| ' + cols.map(() => '---').join(' | ') + ' |');

  for (const row of dataPreview.rows.slice(0, 100)) {
    const vals = cols.map(c => {
      const v = row[c];
      if (v == null || v === '') return '-';
      return String(v).replace(/\|/g, '\\|');
    });
    lines.push('| ' + vals.join(' | ') + ' |');
  }

  let text = lines.join('\n');
  if (text.length > maxChars) {
    // Find a clean row break near the limit
    const cutIdx = text.lastIndexOf('\n', maxChars);
    text = text.slice(0, cutIdx > maxChars * 0.5 ? cutIdx : maxChars) + '\n[tabel terpotong]';
  }
  return text;
}

/**
 * Serialize knowledge documents to text for worker input.
 *
 * @param {Array} knowledgeContext - ctx.knowledgeContext
 * @param {number} maxChars - Maximum chars to output
 * @returns {string}
 */
function serializeKnowledge(knowledgeContext, maxChars = 10_000) {
  if (!knowledgeContext?.length) return '';

  let totalUsed = 0;
  const sections = [];

  for (const doc of knowledgeContext) {
    if (totalUsed >= maxChars) break;
    const available = maxChars - totalUsed;
    const type = doc.category === 'BRS' ? 'BRS' : doc.category === 'Publikasi' ? 'Publikasi' : 'Dokumen';
    const content = (doc.content || '').slice(0, available);
    const section = `[${type}: ${doc.title}]\n${content}`;
    sections.push(section);
    totalUsed += section.length;
  }

  return sections.join('\n\n---\n\n');
}

// ── Planner ────────────────────────────────────────────────────────────────

/**
 * Call the Planner LLM to decompose the query into sub-tasks.
 *
 * @param {string} userQuery - The user's query
 * @param {string} contextSummary - Summary of available context
 * @param {Object} options - { geoLabel, year, month }
 * @returns {Promise<Object|null>} Parsed plan or null on failure
 */
async function planAnalysis(userQuery, contextSummary, options = {}) {
  const { geoLabel, year, month } = options;

  const contextHints = [];
  if (geoLabel) contextHints.push(`Wilayah: ${geoLabel}`);
  if (year) contextHints.push(`Tahun: ${year}`);
  if (month) contextHints.push(`Bulan: ${month}`);
  const hintsStr = contextHints.length > 0 ? `\nKonteks: ${contextHints.join(', ')}\n` : '';

  const prompt = `Kamu adalah perencana analisis data statistik BPS.

TUGAS: Dekomposisi pertanyaan user menjadi 2-4 sub-pertanyaan spesifik yang dapat dijawab oleh spesialis data.

PERTANYAAN USER: "${userQuery}"
${hintsStr}
KONTEKS TERSEDIA:
${contextSummary}

ATURAN:
1. Buat 2-4 sub-pertanyaan yang FOKUS dan SPESIFIK
2. Setiap sub-pertanyaan harus mengarah ke SATU aspek analisis
3. Tentukan sumber konteks yang dibutuhkan: "data_table", "knowledge", atau "both"
4. Tentukan tipe analisis: "extraction" (ambil angka), "comparison" (bandingkan), "trend" (tren temporal), "ranking" (peringkat)
5. Tambahkan panduan sintesis untuk menggabungkan jawaban

OUTPUT FORMAT (JSON ketat, tanpa komentar):
{
  "sub_tasks": [
    {
      "question": "pertanyaan spesifik",
      "context_source": "data_table",
      "analysis_type": "extraction"
    }
  ],
  "synthesis_guidance": "cara menggabungkan jawaban sub-pertanyaan"
}

Contoh untuk "bandingkan kemiskinan per kabupaten 2023 vs 2024":
{
  "sub_tasks": [
    {"question": "Berapa persentase kemiskinan per kabupaten/kota tahun 2024?", "context_source": "data_table", "analysis_type": "extraction"},
    {"question": "Kabupaten mana yang memiliki kemiskinan tertinggi dan terendah?", "context_source": "data_table", "analysis_type": "ranking"},
    {"question": "Bagaimana perubahan kemiskinan dibanding tahun sebelumnya menurut BRS?", "context_source": "knowledge", "analysis_type": "comparison"}
  ],
  "synthesis_guidance": "Gabungkan angka per kabupaten 2024 dari tabel dengan tren perubahan dari BRS untuk analisis komprehensif"
}`;

  try {
    const openai = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY_CHAT || '',
      baseURL: process.env.OPENAI_API_BASE_URL || 'http://127.0.0.1:3030/v1',
    });

    const result = await generateText({
      model: openai.chat(ORCH_CONFIG.MODEL), // always fast model for sub-agent
      messages: [{ role: 'user', content: prompt }],
      temperature: ORCH_CONFIG.TEMPERATURE,
      maxTokens: ORCH_CONFIG.PLANNER_MAX_TOKENS,
      abortSignal: AbortSignal.timeout(ORCH_CONFIG.TIMEOUT_MS),
    });

    const text = (result.text || '').trim();

    // Parse JSON from response (handle markdown code blocks)
    let jsonStr = text;
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlock) jsonStr = codeBlock[1].trim();

    const plan = JSON.parse(jsonStr);

    // Validate plan structure
    if (!plan.sub_tasks || !Array.isArray(plan.sub_tasks) || plan.sub_tasks.length === 0) {
      logger.warn({ planRaw: text.slice(0, 300) }, 'Orchestrator: planner returned invalid plan');
      return null;
    }

    // Cap workers
    plan.sub_tasks = plan.sub_tasks.slice(0, ORCH_CONFIG.MAX_WORKERS);

    logger.info({
      taskCount: plan.sub_tasks.length,
      types: plan.sub_tasks.map(t => t.analysis_type).join(','),
      sources: plan.sub_tasks.map(t => t.context_source).join(','),
    }, 'Orchestrator: plan created');

    return plan;
  } catch (err) {
    logger.warn({ error: err.message }, 'Orchestrator: planner failed');
    return null;
  }
}

// ── Worker Execution ───────────────────────────────────────────────────────

/**
 * Execute a single worker — answer one sub-question with focused context.
 *
 * @param {Object} task - { question, context_source, analysis_type }
 * @param {Object} ctx - Pipeline context
 * @param {number} workerIdx - Worker index (for logging)
 * @returns {Promise<{question: string, answer: string, analysis_type: string, latencyMs: number} | null>}
 */
async function executeWorker(task, ctx, workerIdx = 0) {
  const startTime = Date.now();

  // Build context based on the task's source requirement
  let contextText = '';
  switch (task.context_source) {
    case 'data_table':
      contextText = serializeDataTable(ctx.dataPreview, ORCH_CONFIG.MAX_DATA_CHARS_PER_WORKER);
      break;
    case 'knowledge':
      contextText = serializeKnowledge(ctx.knowledgeContext, ORCH_CONFIG.MAX_KNOWLEDGE_CHARS_PER_WORKER);
      break;
    case 'both':
      contextText = [
        serializeDataTable(ctx.dataPreview, Math.floor(ORCH_CONFIG.MAX_DATA_CHARS_PER_WORKER * 0.6)),
        serializeKnowledge(ctx.knowledgeContext, Math.floor(ORCH_CONFIG.MAX_KNOWLEDGE_CHARS_PER_WORKER * 0.6)),
      ].filter(Boolean).join('\n\n===\n\n');
      break;
    default:
      contextText = [
        serializeDataTable(ctx.dataPreview, Math.floor(ORCH_CONFIG.MAX_DATA_CHARS_PER_WORKER * 0.5)),
        serializeKnowledge(ctx.knowledgeContext, Math.floor(ORCH_CONFIG.MAX_KNOWLEDGE_CHARS_PER_WORKER * 0.5)),
      ].filter(Boolean).join('\n\n===\n\n');
  }

  if (!contextText.trim()) {
    logger.debug({ workerIdx, question: task.question.slice(0, 60) }, 'Orchestrator worker: no context available');
    return null;
  }

  // Build type-specific extraction instructions
  const typeInstructions = {
    extraction: 'Ekstrak angka/nilai SPESIFIK yang langsung menjawab pertanyaan. Sertakan unit dan keterangan. Format: daftar berpoin.',
    comparison: 'Bandingkan 2+ entitas/periode. Sebutkan PERBEDAAN (naik/turun, +/-) dan BESARAN perubahannya. Format: daftar berpoin.',
    trend: 'Identifikasi arah tren (naik/turun/stabil) dan titik perubahan signifikan. Sebutkan angka per periode. Format: kronologis.',
    ranking: 'Urutkan dari tertinggi ke terendah (atau sebaliknya). Sertakan angka spesifik untuk setiap peringkat. Format: ranking bernomor.',
  };

  const instruction = typeInstructions[task.analysis_type] || typeInstructions.extraction;

  const workerPrompt = `Kamu adalah spesialis analisis data statistik BPS.

PERTANYAAN: ${task.question}

INSTRUKSI ANALISIS (${task.analysis_type}):
${instruction}

ATURAN KETAT:
1. JAWAB LANGSUNG pertanyaan — JANGAN bertanya balik
2. Gunakan HANYA angka/fakta yang ada di konteks — JANGAN mengarang
3. Pertahankan PRESISI angka (jangan bulatkan)
4. Jawaban RINGKAS dan TERSTRUKTUR (max 500 kata)
5. Jika data tidak tersedia di konteks, katakan "Data tidak tersedia"

DATA/KONTEKS:
${contextText}`;

  try {
    const openai = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY_CHAT || '',
      baseURL: process.env.OPENAI_API_BASE_URL || 'http://127.0.0.1:3030/v1',
    });

    const result = await generateText({
      model: openai.chat(ORCH_CONFIG.MODEL), // always fast model for sub-agent
      messages: [{ role: 'user', content: workerPrompt }],
      temperature: ORCH_CONFIG.TEMPERATURE,
      maxTokens: ORCH_CONFIG.WORKER_MAX_TOKENS,
      abortSignal: AbortSignal.timeout(ORCH_CONFIG.TIMEOUT_MS),
    });

    const answer = (result.text || '').trim();
    const latencyMs = Date.now() - startTime;

    logger.debug({
      workerIdx,
      type: task.analysis_type,
      source: task.context_source,
      answerChars: answer.length,
      latencyMs,
    }, 'Orchestrator worker completed');

    return {
      question: task.question,
      answer,
      analysis_type: task.analysis_type,
      latencyMs,
    };
  } catch (err) {
    logger.warn({
      workerIdx,
      error: err.message,
      question: task.question.slice(0, 60),
    }, 'Orchestrator worker failed');
    return null;
  }
}

/**
 * Execute all workers in parallel.
 *
 * @param {Object} plan - Output from planAnalysis()
 * @param {Object} ctx - Pipeline context
 * @returns {Promise<Array>} Worker results (may contain nulls for failures)
 */
async function executeWorkers(plan, ctx) {
  const tasks = plan.sub_tasks || [];
  if (tasks.length === 0) return [];

  const results = await Promise.all(
    tasks.map((task, idx) => executeWorker(task, ctx, idx))
  );

  return results.filter(Boolean);
}

// ── Pre-Analysis Injection ─────────────────────────────────────────────────

/**
 * Format worker results into a pre-analysis text block.
 *
 * @param {Array} workerResults - Array of { question, answer, analysis_type }
 * @param {Object} plan - The original plan with synthesis_guidance
 * @returns {string} Formatted pre-analysis text
 */
function formatPreAnalysis(workerResults, plan) {
  if (!workerResults || workerResults.length === 0) return '';

  const sections = workerResults.map((w, i) => {
    const typeLabel = {
      extraction: '📊 Ekstraksi',
      comparison: '⚖️ Perbandingan',
      trend: '📈 Tren',
      ranking: '🏆 Ranking',
    }[w.analysis_type] || '📋 Analisis';

    return `### Sub-analisis ${i + 1}: ${typeLabel}
**Pertanyaan:** ${w.question}
**Hasil:**
${w.answer}`;
  });

  let output = `[PRE-ANALISIS DARI SPESIALIS DATA]

${sections.join('\n\n---\n\n')}`;

  if (plan?.synthesis_guidance) {
    output += `\n\n---\n[PANDUAN SINTESIS]: ${plan.synthesis_guidance}`;
  }

  output += `\n\n[INSTRUKSI]: Gunakan pre-analisis di atas sebagai KERANGKA utama jawaban. Verifikasi angka dengan data tabel/referensi di bawah. Sajikan dalam narasi yang runut dan informatif.`;

  return output;
}

/**
 * Inject pre-analysis into the pipeline context's openAiMessages.
 * Appends the pre-analysis to the system prompt (first message).
 *
 * @param {Object} ctx - Pipeline context (has ctx.openAiMessages)
 * @param {string} preAnalysis - Formatted pre-analysis text
 */
function injectPreAnalysis(ctx, preAnalysis) {
  if (!preAnalysis || !ctx.openAiMessages?.length) return;

  // Find the first system message (main system prompt)
  const sysIdx = ctx.openAiMessages.findIndex(m => m.role === 'system');
  if (sysIdx >= 0) {
    ctx.openAiMessages[sysIdx].content += '\n\n' + preAnalysis;
  }
}

// ── Main Orchestration Function ────────────────────────────────────────────

/**
 * Run the full orchestration pipeline: plan → workers → inject.
 *
 * @param {Object} ctx - Pipeline context (after stageModelSelect)
 * @returns {Promise<{activated: boolean, taskCount: number, workerResults: number, planLatencyMs: number, workerLatencyMs: number, totalLatencyMs: number} | null>}
 */
async function orchestrate(ctx) {
  if (!shouldActivateOrchestrator(ctx)) {
    return null;
  }

  // M12: Global wall-clock timeout wrapping entire orchestration
  const globalTimeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Orchestrator global timeout')), ORCH_CONFIG.GLOBAL_TIMEOUT_MS)
  );

  try {
    return await Promise.race([_orchestrateInner(ctx), globalTimeout]);
  } catch (err) {
    if (err.message === 'Orchestrator global timeout') {
      logger.warn({ timeoutMs: ORCH_CONFIG.GLOBAL_TIMEOUT_MS }, 'Orchestrator: global timeout exceeded');
      return { activated: true, taskCount: 0, workerResults: 0, timedOut: true, totalLatencyMs: ORCH_CONFIG.GLOBAL_TIMEOUT_MS };
    }
    throw err;
  }
}

/** Inner orchestration logic (separated for global timeout wrapper) */
async function _orchestrateInner(ctx) {

  const orchStartTime = Date.now();
  const query = ctx.effectiveQuery || ctx.userMessage || '';

  logger.info({
    query: query.slice(0, 100),
    tier: ctx.modelRoute?.tier,
    hasData: !!ctx.dataPreview?.rows?.length,
    hasKnowledge: !!ctx.knowledgeContext?.length,
    dataRows: ctx.dataPreview?.rows?.length || 0,
    knowledgeDocs: ctx.knowledgeContext?.length || 0,
  }, 'Orchestrator: activating');

  // ── Step 1: Build context summary for planner ──
  const contextSummary = buildContextSummary(ctx);

  // ── Step 2: Plan analysis ──
  const planStartTime = Date.now();
  const plan = await planAnalysis(query, contextSummary, {
    geoLabel: ctx.geoInference?.geoReferences?.[0]?.name || null,
    year: ctx.yearInference?.year || null,
    month: ctx.yearInference?.month || null,
  });
  const planLatencyMs = Date.now() - planStartTime;

  if (!plan) {
    logger.warn('Orchestrator: planner failed, skipping orchestration');
    return { activated: true, taskCount: 0, workerResults: 0, planLatencyMs, workerLatencyMs: 0, totalLatencyMs: Date.now() - orchStartTime };
  }

  // ── Step 3: Execute workers in parallel ──
  const workerStartTime = Date.now();
  const workerResults = await executeWorkers(plan, ctx);
  const workerLatencyMs = Date.now() - workerStartTime;

  if (workerResults.length === 0) {
    logger.warn('Orchestrator: all workers failed, skipping injection');
    return { activated: true, taskCount: plan.sub_tasks.length, workerResults: 0, planLatencyMs, workerLatencyMs, totalLatencyMs: Date.now() - orchStartTime };
  }

  // ── Step 4: Format and inject pre-analysis ──
  const preAnalysis = formatPreAnalysis(workerResults, plan);
  injectPreAnalysis(ctx, preAnalysis);

  const totalLatencyMs = Date.now() - orchStartTime;
  const totalInputChars = workerResults.reduce((s, w) => s + (w.answer?.length || 0), 0);

  logger.info({
    taskCount: plan.sub_tasks.length,
    workersCompleted: workerResults.length,
    preAnalysisChars: preAnalysis.length,
    totalWorkerAnswerChars: totalInputChars,
    planLatencyMs,
    workerLatencyMs,
    totalLatencyMs,
    workerLatencies: workerResults.map(w => w.latencyMs),
  }, 'Orchestrator: complete');

  return {
    activated: true,
    taskCount: plan.sub_tasks.length,
    workerResults: workerResults.length,
    planLatencyMs,
    workerLatencyMs,
    totalLatencyMs,
    preAnalysisChars: preAnalysis.length,
    /** Individual sub-question labels for thinking timeline */
    subQuestions: plan.sub_tasks.map((t, i) => ({
      question: t.question,
      type: t.analysis_type,
      completed: i < workerResults.length,
    })),
  };
}

module.exports = {
  shouldActivateOrchestrator,
  orchestrate,
  // Export for testing
  buildContextSummary,
  planAnalysis,
  executeWorker,
  executeWorkers,
  formatPreAnalysis,
  injectPreAnalysis,
  serializeDataTable,
  serializeKnowledge,
  ORCH_CONFIG,
};
