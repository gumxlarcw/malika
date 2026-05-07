/**
 * Gate Agent Service — Front-gate Query Classifier
 *
 * Runs BEFORE the pipeline begins. Classifies each incoming query into a
 * route that determines which pipeline stages to execute (or skip).
 *
 * Architecture:
 *   1. Rule-based fast-lane handles high-confidence cases (< 5 ms, $0):
 *      greeting, creative writing, jailbreak, OOS, individual data, EXIM, fast-path
 *   2. LLM classifier (gpt-4.1, always-on) handles everything else (~600-1400ms)
 *   3. Rule-based fallback if LLM fails or is disabled
 *   4. Returns a GateResult with route + confidence + metadata
 *
 * Routes:
 *   greeting              → template response, skip ALL pipeline stages
 *   decline               → canned out-of-scope response, skip ALL
 *   decline_individual    → Pasal 21 compliance response, skip ALL
 *   statistical_fast      → fast-path intent, skip full RAG/intent
 *   statistical_exim      → route to EXIM pipeline directly
 *   statistical           → normal data pipeline (full stages)
 *   knowledge             → knowledge-only mode (skip data preview)
 *   bps_institutional     → PPID/institutional (knowledge + keep PPID)
 *   followup              → context-dependent, merge with previous
 *   full_pipeline         → ambiguous, run everything + supervisor
 *
 * The supervisor agent still runs at the end as a safety net.
 *
 * @module gateAgent.service
 */

'use strict';

const logger = require('../../../utils/logger').child({ service: 'GateAgent' });
const QC = require('../../../shared/queryClassification');
const { expandAbbreviationsInline, buildAbbreviationReference, ANTI_HALLUCINATION_RULE } = require('../../../shared/bpsAbbreviations');
const { openAiStructuredOutput } = require('../../ai/openaiChat.service');
const requestContext = require('./requestContext');

// ── Configuration ────────────────────────────────────────────────────────
const GATE_ENABLED = process.env.GATE_AGENT_ENABLED !== 'false'; // default ON
const GATE_LLM_ENABLED = process.env.GATE_LLM_ENABLED !== 'false'; // default ON
const GATE_LLM_MODEL = process.env.GATE_LLM_MODEL || 'gemini-3-flash-preview';
const GATE_LLM_TIMEOUT_MS = 25000; // 25s — increased for larger models (gpt-5-mini)

// ── Structured Output schema for gate classification ──
const GATE_CLASSIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    route: {
      type: 'string',
      enum: ['statistical', 'knowledge', 'decline', 'decline_individual', 'creative', 'greeting', 'ambiguous'],
    },
    reason: { type: 'string' },
  },
  required: ['route', 'reason'],
  additionalProperties: false,
};

// _expandAbbreviationsForGate removed (was deprecated wrapper for expandAbbreviationsInline)

// ── Route constants ─────────────────────────────────────────────────────
const ROUTES = {
  GREETING: 'greeting',
  CHITCHAT: 'chitchat',
  DECLINE: 'decline',
  DECLINE_INDIVIDUAL: 'decline_individual',
  STATISTICAL_FAST: 'statistical_fast',
  STATISTICAL_EXIM: 'statistical_exim',
  STATISTICAL: 'statistical',
  KNOWLEDGE: 'knowledge',
  BPS_INSTITUTIONAL: 'bps_institutional',
  FOLLOWUP: 'followup',
  FULL_PIPELINE: 'full_pipeline',
};

// ── Canned response texts ───────────────────────────────────────────────

const DECLINE_RESPONSE = 'Mohon maaf, topik tersebut di luar cakupan layanan MALIKA. ' +
  'Saya adalah asisten data statistik untuk Provinsi Maluku Utara. ' +
  'Silakan tanyakan tentang data statistik, indikator ekonomi/sosial, ' +
  'atau layanan BPS lainnya. 😊';

const DECLINE_INDIVIDUAL_RESPONSE = 'Mohon maaf, sesuai **UU No. 16 Tahun 1997 tentang Statistik (Pasal 21)**, ' +
  'data individu yang dikumpulkan dalam kegiatan statistik bersifat **rahasia**. ' +
  'BPS hanya menyajikan data dalam bentuk **agregat/makro** dan tidak dapat ' +
  'memberikan data perorangan, data mikro, maupun identitas responden.\n\n' +
  'Silakan tanyakan data agregat seperti jumlah penduduk, angka kemiskinan, inflasi, dll.';

// ── Follow-up detection patterns ────────────────────────────────────────

const FOLLOWUP_PATTERNS = [
  // Comparison follow-ups
  /^bandingkan\s+(dengan|sama)/i,
  /\bbagaimana\s+(dengan|di)\s+(kabupaten|kota|wilayah)/i,
  /\b(kabupaten|kota|wilayah|daerah|provinsi)\s+(lain|lainnya)/i,
  /^tampilkan\s+(semua|seluruh|per)\s+(kabupaten|kota|wilayah)/i,
  /\bperbandingan\s+(dengan|antar)/i,
  // Alternative source requests
  /\b(dari|coba)\s+(survei|sumber|data)\s*(lain|lainnya)/i,
  // Short follow-ups (geo, period, confirm handled by pipeline context stage)
];

// ── Main classification function ────────────────────────────────────────

/**
 * @typedef {Object} GateResult
 * @property {string}  route            - One of ROUTES values
 * @property {string}  confidence       - 'high' | 'medium' | 'low'
 * @property {string}  [reason]         - Human-readable reason for routing
 * @property {string}  [declineText]    - Pre-built response for decline routes
 * @property {number[]} [fastPathIds]   - Datasource IDs for fast-path route
 * @property {object}  [fastPathResult] - Full fast-path match result
 * @property {boolean} [skipIntent]     - Skip intent resolution stage
 * @property {boolean} [skipPreview]    - Skip data preview stage
 * @property {boolean} [skipSupervisor] - Skip supervisor stage
 * @property {boolean} [forceKnowledge] - Force knowledge mode
 * @property {number}  latencyMs        - Time taken for classification
 */

/**
 * Classify a user query before the pipeline runs.
 *
 * @param {string} query          - Raw user message
 * @param {Object} [threadCtx]    - Thread context (history, previous uiMeta)
 * @param {Array}  [threadCtx.historyArray] - Conversation history
 * @param {Object} [threadCtx.prevUiMeta]   - Previous assistant's UI metadata
 * @returns {Promise<GateResult>}
 */
async function classifyQuery(query, threadCtx = {}) {
  if (!GATE_ENABLED) {
    return {
      route: ROUTES.FULL_PIPELINE,
      confidence: 'high',
      reason: 'Gate agent disabled',
      latencyMs: 0,
    };
  }

  const startTime = Date.now();
  const q = String(query || '').trim();

  if (!q) {
    return _result(ROUTES.DECLINE, 'high', 'Empty query', startTime, {
      declineText: 'Silakan ketik pertanyaan Anda tentang data statistik Maluku Utara.',
    });
  }

  // ── Rule 1: Greeting ────────────────────────────────────────────────
  if (QC.isGreeting(q)) {
    return _result(ROUTES.GREETING, 'high', 'Greeting detected', startTime, {
      skipIntent: true,
      skipPreview: true,
      skipSupervisor: true,
    });
  }

  // ── Rule 1b: Chitchat (thanks, farewell, acknowledgment) ───────────
  if (QC.isChitchat(q)) {
    return _result(ROUTES.CHITCHAT, 'high', 'Chitchat detected (thanks/farewell/ack)', startTime, {
      skipIntent: true,
      skipPreview: true,
      skipSupervisor: true,
    });
  }

  // ── Rule 1c: Meta about MALIKA (identity, capabilities) ─────────────
  if (QC.isMetaAboutMalika(q)) {
    return _result(ROUTES.CHITCHAT, 'high', 'Meta question about MALIKA', startTime, {
      skipIntent: true,
      skipPreview: true,
      skipSupervisor: true,
    });
  }

  // ── Rule 1d: Opinion/advice request ─────────────────────────────────
  if (QC.isOpinionRequest(q)) {
    return _result(ROUTES.CHITCHAT, 'high', 'Opinion/advice request', startTime, {
      skipIntent: true,
      skipPreview: true,
      skipSupervisor: true,
    });
  }

  // ── Rule 2: Individual data request (Pasal 21) ─────────────────────
  // Must check BEFORE out-of-scope so compliance is never bypassed
  if (QC.isIndividualDataRequest(q)) {
    return _result(ROUTES.DECLINE_INDIVIDUAL, 'high', 'Individual data request (Pasal 21)', startTime, {
      declineText: DECLINE_INDIVIDUAL_RESPONSE,
      skipIntent: true,
      skipPreview: true,
      skipSupervisor: false, // supervisor still verifies compliance in response
    });
  }

  // ── Rule 3a: Creative writing request ────────────────────────────────
  // Must fire BEFORE out-of-scope & data signals — "pantun tentang kemiskinan" is creative, not statistical
  if (QC.isCreativeWriting(q)) {
    return _result(ROUTES.DECLINE, 'high', 'Creative writing request', startTime, {
      declineText: 'Mohon maaf, MALIKA tidak dapat membuat pantun, puisi, cerita, atau karya kreatif lainnya. ' +
        'Saya adalah asisten data statistik BPS Maluku Utara. ' +
        'Silakan tanyakan tentang data statistik, indikator ekonomi/sosial, atau layanan BPS. 😊',
      skipIntent: true,
      skipPreview: true,
      skipSupervisor: false,
    });
  }

  // ── Rule 3b: Prompt injection / jailbreak ────────────────────────────
  if (QC.isPromptInjection(q)) {
    return _result(ROUTES.DECLINE, 'high', 'Prompt injection attempt', startTime, {
      declineText: 'Maaf, saya tidak dapat memproses permintaan tersebut. ' +
        'Saya adalah MALIKA, asisten data statistik BPS Maluku Utara. ' +
        'Silakan tanyakan tentang data statistik atau layanan BPS. 😊',
      skipIntent: true,
      skipPreview: true,
      skipSupervisor: false,
    });
  }

  // ── Rule 3c: Out-of-scope ───────────────────────────────────────────
  if (QC.isOutOfScope(q)) {
    return _result(ROUTES.DECLINE, 'high', 'Out-of-scope topic', startTime, {
      declineText: DECLINE_RESPONSE,
      skipIntent: true,
      skipPreview: true,
      skipSupervisor: false, // keep supervisor as safety net
    });
  }

  // ── Rule 4: EXIM query ─────────────────────────────────────────────
  // Guard: skip EXIM route if query is clearly procedural/service ("cara akses data ekspor")
  const SERVICE_GUARD_RX = /\b(cara|akses|panduan|prosedur|tutorial|langkah|download|unduh)\b/i;
  if (QC.isEximTrigger(q) && !SERVICE_GUARD_RX.test(q)) {
    return _result(ROUTES.STATISTICAL_EXIM, 'high', 'EXIM query detected', startTime);
  }

  // ── Rule 5: Fast-path statistical ──────────────────────────────────
  // Skip fast-path if the previous message was decline_individual — the user might
  // be rephrasing the same personal-name query with a stat prefix (e.g. "Data IPM Ghalib Yudha").
  // Let the LLM gate handle it instead so it can detect the personal name.
  const prevRoute = threadCtx.prevUiMeta?.metadata?.gate?.route;
  const afterDeclineIndividual = prevRoute === 'decline_individual' || prevRoute === ROUTES.DECLINE_INDIVIDUAL;

  if (!afterDeclineIndividual) {
    try {
      const { matchFastPath } = require('../../chat/queryFastPath.service');
      const fp = matchFastPath(q);
      if (fp && fp.datasourceIds?.length > 0) {
        return _result(ROUTES.STATISTICAL_FAST, 'high', `Fast-path: ${fp.id}`, startTime, {
          fastPathIds: fp.datasourceIds,
          fastPathResult: fp,
          skipIntent: true, // fast-path replaces full intent
        });
      }
    } catch (e) {
      logger.debug({ error: e.message }, 'Fast-path check error');
    }
  }

  // ── Rule 6: BPS Institutional / PPID ───────────────────────────────
  // Guard: don't route to institutional if query has strong data signals
  // (e.g., "data BPS tentang kemiskinan apa saja?" → should go to data pipeline)
  const hasStrongDataSignal = QC.hasDataSignal?.(q) || /\b(berapa|jumlah|angka|persentase|persen)\b/i.test(q);
  if (QC.isBPSInstitutional(q) && !hasStrongDataSignal) {
    return _result(ROUTES.BPS_INSTITUTIONAL, 'high', 'BPS institutional query', startTime, {
      forceKnowledge: true,
    });
  }

  // ── Rule 7: Strong service/procedural patterns ─────────────────────
  // Guard: don't override data signals for queries like "data sakernas 2023"
  if (QC.isServiceQuery(q) && !hasStrongDataSignal) {
    return _result(ROUTES.KNOWLEDGE, 'high', 'Service/procedural query', startTime, {
      forceKnowledge: true,
      skipPreview: true,
    });
  }

  // ── Rule 8: Follow-up detection (needs thread context) ─────────────
  if (threadCtx.historyArray?.length > 0) {
    // Don't treat messages right after a greeting as follow-ups.
    // The greeting mentions example topics ("inflasi", "penduduk") that would bleed into context.
    const prevRoute = threadCtx.prevUiMeta?.metadata?.gate?.route;
    const afterGreeting = prevRoute === 'greeting' || prevRoute === ROUTES.GREETING;

    if (!afterGreeting) {
      const isFollowUp = FOLLOWUP_PATTERNS.some(p => p.test(q));
      if (isFollowUp) {
        return _result(ROUTES.FOLLOWUP, 'medium', 'Follow-up query detected', startTime);
      }

      // Short message with prev context → likely follow-up
      const wordCount = q.split(/\s+/).length;
      if (wordCount <= 3 && threadCtx.prevUiMeta) {
        // Don't classify as follow-up if it's clearly a new topic
        const hasNewTopic = QC.hasDataSignal(q) || QC.hasKnowledgeSignal(q);
        // Don't classify as follow-up if it starts with "data" — let LLM gate handle it
        // (prevents "data <person_name>" from being merged with previous stat context)
        const startsWithData = /^data\b/i.test(q);
        if (!hasNewTopic && !startsWithData) {
          return _result(ROUTES.FOLLOWUP, 'low', 'Short message with conversation context', startTime);
        }
      }
    }
  }

  // ── Rule 9: High-confidence rule-based signals (skip LLM) ──────────
  // When rule-based signals are strong and unambiguous, skip the LLM
  // entirely to save 500-1400ms latency on ~40% of queries.
  const hasData = QC.hasDataSignal(q);
  const hasKnowledge = QC.hasKnowledgeSignal(q);

  if (hasData && !hasKnowledge) {
    return _result(ROUTES.STATISTICAL, 'high', 'Strong data signals (LLM skipped)', startTime);
  }

  if (hasKnowledge && !hasData) {
    return _result(ROUTES.KNOWLEDGE, 'medium', 'Knowledge signals without data signals (LLM skipped)', startTime, {
      forceKnowledge: true,
    });
  }

  // ── Rule 10: LLM classifier (for truly ambiguous queries) ─────────
  // LLM handles: personal names, mixed signals, non-obvious stat queries,
  // anything that regex can't confidently classify.
  if (GATE_LLM_ENABLED) {
    try {
      const llmResult = await _classifyWithLLM(q);
      if (llmResult) {
        return _result(
          llmResult.route,
          'medium',
          `LLM classified: ${llmResult.reason}`,
          startTime,
          llmResult.flags || {},
        );
      }
    } catch (e) {
      logger.debug({ error: e.message }, 'Gate LLM fallback failed — falling through to rule-based');
    }
  }

  // ── Rule 11: Rule-based fallbacks (when LLM is off or fails) ───────
  if (hasData && hasKnowledge) {
    return _result(ROUTES.FULL_PIPELINE, 'low', 'Mixed data + knowledge signals', startTime);
  }

  // ── Rule 12: Non-statistical meta questions ────────────────────────
  if (QC.isNonStatistical(q)) {
    return _result(ROUTES.KNOWLEDGE, 'medium', 'Non-statistical meta query', startTime, {
      forceKnowledge: true,
    });
  }

  // ── Default: full pipeline (safest) ────────────────────────────────
  return _result(ROUTES.FULL_PIPELINE, 'low', 'No clear signals — full pipeline', startTime);
}

// ── Internal helpers ────────────────────────────────────────────────────

function _result(route, confidence, reason, startTime, extra = {}) {
  const latencyMs = Date.now() - startTime;
  const result = { route, confidence, reason, latencyMs, ...extra };

  logger.info({
    route,
    confidence,
    reason,
    latencyMs,
    skipIntent: extra.skipIntent || false,
    skipPreview: extra.skipPreview || false,
    skipSupervisor: extra.skipSupervisor || false,
  }, 'Gate classification');

  return result;
}

/**
 * Optional LLM classifier for ambiguous queries.
 * Uses gpt-4.1 with structured JSON output.
 * Only called when GATE_LLM_ENABLED=true.
 */
async function _classifyWithLLM(query) {
  const apiKeyEnv = process.env.OPENAI_API_KEY_CHAT ? 'OPENAI_API_KEY_CHAT'
    : process.env.OPENAI_API_KEY_INTERPRETATION ? 'OPENAI_API_KEY_INTERPRETATION'
    : 'OPENAI_API_KEY_QUERY_BUILDER';

  try {
    const messages = [
      {
        role: 'system',
        content: `Anda adalah router untuk MALIKA, asisten data statistik BPS Maluku Utara.
Klasifikasikan pesan user ke SATU kategori:
- "statistical": pertanyaan tentang data/angka/statistik
- "knowledge": pertanyaan prosedural/layanan/publikasi/informasi BPS
- "decline_individual": meminta data pribadi/individual tentang ORANG TERTENTU (nama orang, identitas, data perorangan) → pelanggaran Pasal 21 UU Statistik
- "decline": di luar cakupan BPS (politik, agama, hiburan, resep, cuaca non-statistik)
- "creative": permintaan menulis kreatif (pantun, puisi, cerita, lagu)
- "greeting": sapaan/salam/terima kasih
- "ambiguous": benar-benar tidak jelas

SINGKATAN RESMI BPS (JANGAN mengarang kepanjangan sendiri!):
${buildAbbreviationReference('compact')}

${ANTI_HALLUCINATION_RULE}

Contoh:
- "data kemiskinan 2024" → statistical
- "data nabila nanda" → decline_individual (nama orang)
- "data pmtb" → statistical (PMTB = Pembentukan Modal Tetap Bruto)
- "data naker malut" → statistical (naker = ketenagakerjaan)
- "inflasi kota ternate" → statistical
- "daftar nama warga miskin" → decline_individual (data individu)
- "siapa presiden" → decline (politik)
- "buatkan pantun inflasi" → creative

Balas HANYA JSON: {"route":"...","reason":"alasan singkat"}`,
      },
      { role: 'user', content: expandAbbreviationsInline(query).slice(0, 400) },
    ];

    const data = await openAiStructuredOutput({
      apiKeyEnv,
      model: GATE_LLM_MODEL,
      messages,
      temperature: 0,
      schema: GATE_CLASSIFICATION_SCHEMA,
      schemaName: 'gate_classification',
      purpose: 'gate_classification',
      timeoutMs: GATE_LLM_TIMEOUT_MS,
      retries: 1, // 1 retry (2 attempts total) — gate is latency-sensitive
    });

    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content);
    logger.info({ llmRoute: parsed.route, llmReason: parsed.reason }, 'Gate LLM result');

    // Map LLM routes to our route system
    const routeMap = {
      'statistical': ROUTES.STATISTICAL,
      'knowledge': ROUTES.KNOWLEDGE,
      'greeting': ROUTES.GREETING,
      'decline': ROUTES.DECLINE,
      'decline_individual': ROUTES.DECLINE_INDIVIDUAL,
      'creative': ROUTES.DECLINE,
      'ambiguous': ROUTES.FULL_PIPELINE,
    };

    const route = routeMap[parsed.route] || ROUTES.FULL_PIPELINE;
    const flags = {};
    if (route === ROUTES.KNOWLEDGE) {
      flags.forceKnowledge = true;
      flags.skipIntent = true;  // Knowledge queries don't need datasource intent search
    }
    if (route === ROUTES.GREETING) {
      flags.skipIntent = true;
      flags.skipPreview = true;
      flags.skipSupervisor = true;
    }
    if (route === ROUTES.DECLINE) {
      flags.declineText = parsed.route === 'creative'
        ? 'Mohon maaf, MALIKA tidak dapat membuat pantun, puisi, cerita, atau karya kreatif lainnya. ' +
          'Saya adalah asisten data statistik BPS Maluku Utara. ' +
          'Silakan tanyakan tentang data statistik, indikator ekonomi/sosial, atau layanan BPS. 😊'
        : DECLINE_RESPONSE;
      flags.skipIntent = true;
      flags.skipPreview = true;
    }
    if (route === ROUTES.DECLINE_INDIVIDUAL) {
      flags.declineText = DECLINE_INDIVIDUAL_RESPONSE;
      flags.skipIntent = true;
      flags.skipPreview = true;
      flags.skipSupervisor = false;
    }

    return { route, reason: parsed.reason || 'LLM classified', flags };
  } catch (err) {
    const msg = err?.message || '';
    if (msg.includes('timeout') || msg.includes('CIRCUIT_OPEN')) {
      logger.warn({ error: msg, query: query.slice(0, 80) },
        'Gate LLM timed out or circuit open — falling back to regex classification');
    } else {
      logger.warn({ error: msg }, 'Gate LLM error — falling back to regex');
    }
    return null;
  }
}

// ── Exports ─────────────────────────────────────────────────────────────

module.exports = {
  classifyQuery,
  ROUTES,
  GATE_ENABLED,
  // Expose for testing
  DECLINE_RESPONSE,
  DECLINE_INDIVIDUAL_RESPONSE,
};
