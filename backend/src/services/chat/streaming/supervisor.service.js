/**
 * Supervisor Agent Service
 *
 * Post-processing review layer that evaluates the final AI response + UI metadata
 * before sending to the client. Enforces three policy dimensions:
 *
 * 1. BPS COMPLIANCE (UU No. 16/1997 tentang Statistik)
 *    - BPS cannot provide individual/respondent data (Pasal 21 kerahasiaan)
 *    - Only aggregate/macro statistics may be shared
 *    - Detects requests for micro-data, personal data, etc.
 *
 * 2. STATISTICAL CONTEXT DETECTION
 *    - Classifies whether the conversation is about statistical data or not
 *    - Suppresses second bubble (table, candidates, knowledge) for non-statistical context
 *    - Prevents data UI from appearing for greetings, chitchat, meta-questions
 *
 * 3. NARRATIVE QUALITY REVIEW
 *    - Reviews response tone and appropriateness for BPS
 *    - Can append disclaimers or corrections when needed
 *    - Uses LLM for nuanced narrative adjustment (optional, gpt-4.1)
 *
 * Architecture:
 *   - Fast rule-based checks (< 1ms): handle 80%+ of cases
 *   - LLM review (500-1500ms): only for ambiguous cases or narrative adjustment
 *   - Runs AFTER stream completes, BEFORE malika_ui SSE event
 *
 * @module supervisor.service
 */

'use strict';

const logger = require('../../../utils/logger').child({ service: 'Supervisor' });
const { chatCompletion } = require('../../ai/client/openaiClient');

// Import canonical patterns from shared module (single source of truth)
const QC = require('../../../shared/queryClassification');
const { expandAbbreviationsInline } = require('../../../shared/bpsAbbreviations');
const requestContext = require('./requestContext');

// ── Configuration ────────────────────────────────────────────────────────
const SUPERVISOR_ENABLED = process.env.SUPERVISOR_ENABLED !== 'false'; // default: ON
const SUPERVISOR_LLM_ENABLED = process.env.SUPERVISOR_LLM_ENABLED !== 'false'; // default: ON
const SUPERVISOR_LLM_MODEL = process.env.SUPERVISOR_LLM_MODEL || 'gemini-3-flash-preview';
const SUPERVISOR_TIMEOUT_MS = parseInt(process.env.SUPERVISOR_TIMEOUT_MS, 10) || 25000; // 25s (increased for larger models)

// ── Structured Output schema for supervisor review (OpenAI JSON Schema) ──
const SUPERVISOR_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'supervisor_review',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        bps_compliant: { type: 'boolean' },
        compliance_note: { type: ['string', 'null'] },
        is_statistical: { type: 'boolean' },
        suppress_data_display: { type: 'boolean' },
        data_fabrication_detected: { type: 'boolean' },
        revised_text: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['bps_compliant', 'compliance_note', 'is_statistical', 'suppress_data_display', 'data_fabrication_detected', 'revised_text', 'reason'],
      additionalProperties: false,
    },
  },
};

// ── Patterns — import from shared queryClassification ────────────────────
// These were previously defined inline. Now they reference the canonical source.
const INDIVIDUAL_DATA_REQUEST_PATTERNS = QC.INDIVIDUAL_DATA_REQUEST_PATTERNS;
const RESPONSE_DISCLOSURE_PATTERNS = QC.RESPONSE_DISCLOSURE_PATTERNS;
const RESPONSE_REFUSAL_PATTERNS = QC.RESPONSE_REFUSAL_PATTERNS;
const RESPONSE_HAS_REAL_DATA_PATTERNS = QC.RESPONSE_HAS_REAL_DATA_PATTERNS;
const NON_STATISTICAL_QUERY_PATTERNS = QC.NON_STATISTICAL_QUERY_PATTERNS;
const STATISTICAL_CONTEXT_INDICATORS = QC.STATISTICAL_CONTEXT_INDICATORS;
const BPS_INSTITUTIONAL_INDICATORS = QC.BPS_INSTITUTIONAL_INDICATORS;
const PPID_CATEGORIES = QC.PPID_CATEGORIES;

// BPS compliance disclaimer text
const BPS_COMPLIANCE_DISCLAIMER = (
  '\n\n---\n' +
  '⚠️ **Catatan Kerahasiaan Statistik:**\n' +
  'Sesuai **UU No. 16 Tahun 1997 tentang Statistik (Pasal 21)**, ' +
  'data individu yang dikumpulkan dalam kegiatan statistik bersifat **rahasia**. ' +
  'BPS hanya menyajikan data dalam bentuk **agregat/makro** dan tidak dapat ' +
  'memberikan data perorangan, data mikro, maupun identitas responden.'
);

// Short inline warning for responses that already discuss aggregate data
const BPS_COMPLIANCE_INLINE = (
  '\n\n> ℹ️ *BPS hanya menyediakan data agregat. ' +
  'Data individu bersifat rahasia sesuai UU 16/1997 Pasal 21.*'
);

// ── Supervisor Review Function ───────────────────────────────────────────

/**
 * Review the final AI response and UI metadata.
 * Returns possibly-modified fullText and uiMeta.
 *
 * @param {Object} ctx - Pipeline context
 * @param {string} fullText - Complete AI response text
 * @param {Object} uiMeta - UI metadata object (will be mutated)
 * @param {string} [openaiKey] - OpenAI API key for LLM review
 * @returns {Promise<SupervisorResult>}
 *
 * @typedef {Object} SupervisorResult
 * @property {string} fullText - Possibly modified response text
 * @property {Object} uiMeta - Possibly modified UI metadata
 * @property {Object} flags - Supervisor decision flags
 * @property {number} latencyMs - Time taken for review
 */
async function reviewResponse(ctx, fullText, uiMeta, openaiKey) {
  if (!SUPERVISOR_ENABLED) {
    return { fullText, uiMeta, flags: { skipped: true }, latencyMs: 0 };
  }

  const startTime = Date.now();
  const userQuery = ctx.effectiveQuery || ctx.userMessage || '';
  const flags = {
    isStatistical: null,
    bpsCompliant: true,
    complianceAction: null,
    suppressDataDisplay: false,
    narrativeAdjusted: false,
    reviewMethod: 'rules', // 'rules' | 'llm'
  };

  try {
    // ── Step 1: BPS Compliance Check (rule-based) ────────────────────
    const complianceResult = checkBPSCompliance(userQuery, fullText);
    flags.bpsCompliant = complianceResult.compliant;
    flags.complianceAction = complianceResult.action;

    if (!complianceResult.compliant) {
      logger.info({
        threadId: ctx.threadId,
        action: complianceResult.action,
        reason: complianceResult.reason,
      }, 'BPS compliance issue detected');

      // Append appropriate disclaimer
      if (complianceResult.action === 'disclaimer') {
        fullText = fullText + BPS_COMPLIANCE_INLINE;
      } else if (complianceResult.action === 'block') {
        fullText = fullText + BPS_COMPLIANCE_DISCLAIMER;
      }

      // BPS compliance violation → suppress data candidates (they're irrelevant for individual data requests)
      flags.suppressDataDisplay = true;
      logger.info({ threadId: ctx.threadId }, 'BPS compliance issue → forcing data display suppression');
    }

    // ── Step 1b: Response Refusal Detection ──────────────────────────
    // If the LLM response itself declines the request, the data candidates
    // shown in the second bubble are likely irrelevant/misleading.
    if (!flags.suppressDataDisplay) {
      const hasRefusal = RESPONSE_REFUSAL_PATTERNS.some(p => p.test(fullText));
      if (hasRefusal) {
        // Check if response actually contains real statistical data despite the refusal
        const hasRealData = RESPONSE_HAS_REAL_DATA_PATTERNS.some(p => p.test(fullText));
        if (!hasRealData) {
          flags.suppressDataDisplay = true;
          flags.responseRefusal = true;
          logger.info({
            threadId: ctx.threadId,
            query: userQuery.slice(0, 100),
          }, 'Response contains refusal without real data → suppressing data display');
        }
      }
    }

    // ── Step 1c: Table Relevance Check ───────────────────────────────
    // If the pipeline returned a table that is topically IRRELEVANT to the
    // user's query, suppress the table/candidates to avoid confusion.
    if (!flags.suppressDataDisplay && uiMeta.table) {
      const relevanceResult = checkTableRelevance(userQuery, uiMeta.table, ctx);
      if (!relevanceResult.isRelevant) {
        flags.suppressDataDisplay = true;
        flags.tableIrrelevant = true;
        flags.tableRelevanceReason = relevanceResult.reason;
        logger.info({
          threadId: ctx.threadId,
          tableTitle: (uiMeta.table.title || '').slice(0, 80),
          query: userQuery.slice(0, 100),
          reason: relevanceResult.reason,
        }, 'Table irrelevant to query → suppressing data display');
      }
    }

    // ── Step 2: Statistical Context Detection (rule-based) ───────────
    const contextResult = classifyStatisticalContext(ctx, userQuery, fullText, uiMeta);
    flags.isStatistical = contextResult.isStatistical;

    if (!contextResult.isStatistical) {
      flags.suppressDataDisplay = true;
      logger.info({
        threadId: ctx.threadId,
        reason: contextResult.reason,
        query: userQuery.slice(0, 100),
      }, 'Non-statistical context → suppressing data display');
    }

    // ── Step 3: LLM Review (skip for low-risk responses) ──────────────
    // Skip LLM review for greetings, chitchat, and short responses — rule-based
    // checks above already handle compliance; LLM adds 10-15s for no benefit here.
    const gateRoute = ctx.gate?.route || '';
    const tier = ctx.tier || ctx.gate?.tier || '';
    const isLowRisk = gateRoute === 'greeting' || gateRoute === 'chitchat'
      || tier === 'GREETING' || tier === 'greeting'
      || fullText.length < 500; // Raised from 200: short statistical answers need fabrication check too
    if (isLowRisk) {
      logger.info({ threadId: ctx.threadId, gateRoute, tier, textLen: fullText.length }, 'Supervisor: skipping LLM review (low-risk)');
    }

    if (SUPERVISOR_LLM_ENABLED && openaiKey && !isLowRisk) {
      flags.reviewMethod = 'llm';
      const llmResult = await runLLMReview(ctx, userQuery, fullText, uiMeta, openaiKey);

      if (llmResult) {
        // Apply LLM decisions — but don't let LLM override high-confidence gate decisions.
        // If the gate explicitly routed to a statistical path, trust it over the supervisor LLM.
        const gateIsStatistical = [
          'statistical_fast', 'statistical_exim', 'statistical', 'followup'
        ].includes(gateRoute);

        if (llmResult.suppress_data_display !== undefined) {
          // Gate said statistical? Only allow suppression if LLM also says non-compliant
          if (gateIsStatistical && llmResult.suppress_data_display && llmResult.bps_compliant !== false) {
            logger.info({ threadId: ctx.threadId, gateRoute }, 'Supervisor LLM wanted to suppress, but gate route is statistical — keeping data display');
            // Don't override — keep the gate's statistical decision
          } else {
            flags.suppressDataDisplay = llmResult.suppress_data_display;
            flags.isStatistical = !llmResult.suppress_data_display;
          }
        }

        // Save original text before applying revised_text so we can revert
        // if fabrication turns out to be a false positive.
        const preRevisedText = fullText;

        if (llmResult.revised_text && llmResult.revised_text.length > 30) {
          fullText = llmResult.revised_text;
          flags.narrativeAdjusted = true;
          flags.formatted = true;
        }

        // Handle data fabrication detection from LLM
        if (llmResult.data_fabrication_detected) {
          const hasKnowledge = (ctx.knowledgeContext || []).length > 0;
          const hasReconciliation = Boolean(ctx.reconciliationResult?.has_overlap);
          if (gateIsStatistical && (hasKnowledge || hasReconciliation)) {
            // Gate routed to statistical AND context exists.
            // Check whether the "fabricated" numbers actually appear in the context.
            // If the numbers DO exist in context → false positive (LLM cited real data).
            // If the numbers DON'T exist → genuine fabrication, don't revert.
            const contextText = (ctx.knowledgeContext || []).map(d => d.content || '').join(' ').slice(0, 50000);
            const numbersInResponse = (fullText.match(/\d{1,3}(?:[.,]\d{1,3})*(?:[.,]\d{1,2})?/g) || [])
              .filter(n => n.length >= 3); // Only check substantial numbers (3+ digits)
            const numbersVerified = numbersInResponse.length === 0 ||
              numbersInResponse.some(n => contextText.includes(n));

            if (numbersVerified) {
              // Numbers found in context OR no numbers to verify → likely false positive
              logger.info({
                threadId: ctx.threadId,
                gateRoute,
                knowledgeCount: (ctx.knowledgeContext || []).length,
                numbersChecked: numbersInResponse.length,
                query: userQuery.slice(0, 100),
              }, 'Supervisor LLM detected fabrication but numbers exist in context — ignoring false positive');

              if (flags.narrativeAdjusted && /belum tersedia|tidak.{0,20}tersedia|tidak dapat diverifikasi/i.test(fullText)) {
                logger.info({ threadId: ctx.threadId }, 'Reverting supervisor revised_text (fabrication false positive rewrite detected)');
                fullText = quickFormat(preRevisedText);
                flags.narrativeAdjusted = false;
                flags.fabricationRevertApplied = true;
              }
            } else {
              // Numbers NOT found in context — genuine fabrication, keep supervisor's correction
              logger.warn({
                threadId: ctx.threadId,
                numbersNotInContext: numbersInResponse.slice(0, 5),
                query: userQuery.slice(0, 100),
              }, 'Supervisor fabrication confirmed: numbers not found in RAG context');
              flags.suppressDataDisplay = true;
              flags.dataFabricationDetected = true;
            }
          } else {
            flags.suppressDataDisplay = true;
            flags.dataFabricationDetected = true;
            logger.warn({
              threadId: ctx.threadId,
              query: userQuery.slice(0, 100),
            }, 'Supervisor LLM detected data fabrication → suppressing data display + using revised text');
            // LLM should have already provided a corrected revised_text
          }
        }

        if (llmResult.compliance_note) {
          flags.complianceAction = 'llm_flagged';
          if (!fullText.includes('Kerahasiaan') && !fullText.includes('UU')) {
            fullText = fullText + '\n\n> ℹ️ *' + llmResult.compliance_note + '*';
          }
        }
      }
    }

    // ── Step 3b: Regex fallback formatting (if LLM didn't format) ────
    if (!flags.formatted && flags.isStatistical && fullText.length > 50) {
      fullText = quickFormat(fullText);
      flags.formatted = 'regex';
    }

    // ── Step 4: Apply suppressions to uiMeta ─────────────────────────
    if (flags.suppressDataDisplay) {
      // Decide whether to keep knowledge candidates in the UI:
      // - Keep if PPID/institutional docs exist
      // - Keep if the table was irrelevant but knowledge context has data
      //   (e.g., query about "restoran" with PDRB table but knowledge has real restaurant data)
      // - Keep if knowledge context has any content at all and suppression was due to table irrelevance
      const hasPPIDKnowledge = (ctx.knowledgeContext || []).some(
        d => PPID_CATEGORIES.has(d.category)
      );
      const hasAnyKnowledge = (ctx.knowledgeContext || []).length > 0
        || (uiMeta.knowledgeCandidates && uiMeta.knowledgeCandidates.length > 0);
      const shouldKeepKnowledge = hasPPIDKnowledge
        || (flags.tableIrrelevant && hasAnyKnowledge)
        || (flags.dataFabricationDetected && hasAnyKnowledge);

      suppressDataUI(uiMeta, { keepKnowledge: shouldKeepKnowledge });
      if (shouldKeepKnowledge) {
        flags.suppressDataDisplay = 'partial';
        const reason = flags.tableIrrelevant ? 'table-irrelevant' : hasPPIDKnowledge ? 'ppid' : 'fabrication-but-knowledge';
        logger.info({ threadId: ctx.threadId, reason }, 'Partial suppression — knowledge candidates preserved');
      }
    }

  } catch (err) {
    logger.warn({ error: err.message, threadId: ctx.threadId }, 'Supervisor review error — passing through');
    // Non-critical: continue with original response
  }

  const latencyMs = Date.now() - startTime;
  logger.info({
    threadId: ctx.threadId,
    flags,
    latencyMs,
  }, 'Supervisor review complete');

  return { fullText, uiMeta, flags, latencyMs };
}

// ── BPS Compliance Check ─────────────────────────────────────────────────

/**
 * Check if the query/response violates BPS data confidentiality rules.
 * @returns {{ compliant: boolean, action: string|null, reason: string|null }}
 */
function checkBPSCompliance(userQuery, responseText) {
  // Check if user is requesting individual/confidential data
  for (const pattern of INDIVIDUAL_DATA_REQUEST_PATTERNS) {
    if (pattern.test(userQuery)) {
      return {
        compliant: false,
        action: 'block',
        reason: `User requesting confidential data: ${pattern.source}`,
      };
    }
  }

  // Check if response discloses individual data
  for (const pattern of RESPONSE_DISCLOSURE_PATTERNS) {
    if (pattern.test(responseText)) {
      return {
        compliant: false,
        action: 'disclaimer',
        reason: `Response may disclose individual data: ${pattern.source}`,
      };
    }
  }

  return { compliant: true, action: null, reason: null };
}

// ── Table Relevance Check ────────────────────────────────────────────────

/**
 * Check if the table returned by the pipeline is topically relevant to the user query.
 * Prevents showing e.g. PDRB table when user asks "jumlah restoran".
 *
 * Uses keyword overlap between query and table title/columns.
 * @returns {{ isRelevant: boolean, reason: string }}
 */
function checkTableRelevance(userQuery, table, ctx) {
  if (!table || !table.title) {
    return { isRelevant: true, reason: 'No table to check' };
  }

  const query = (userQuery || '').toLowerCase().trim();
  const tableTitle = (table.title || '').toLowerCase();

  // Skip relevance check for very short queries (follow-ups) or EXIM
  if (query.split(/\s+/).length <= 2) {
    return { isRelevant: true, reason: 'Short query — skip relevance check' };
  }
  if (ctx.eximParams || /\b(ekspor|impor|exim)\b/i.test(query)) {
    return { isRelevant: true, reason: 'EXIM query — skip' };
  }

  // Extract meaningful keywords from query (strip common words)
  const stopWords = new Set([
    'data', 'jumlah', 'berapa', 'banyak', 'angka', 'statistik', 'terbaru',
    'tahun', 'bulan', 'per', 'di', 'dan', 'atau', 'yang', 'untuk', 'dari',
    'provinsi', 'maluku', 'utara', 'kabupaten', 'kota', 'kab', 'seri',
    'apa', 'bagaimana', 'dimana', 'kapan', 'kenapa', 'mengapa',
    'menurut', 'berdasarkan', '2020', '2021', '2022', '2023', '2024', '2025', '2026',
  ]);
  const queryWords = query.split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));

  if (queryWords.length === 0) {
    return { isRelevant: true, reason: 'No meaningful query keywords' };
  }

  // Build topic keyword groups — maps query topics to table title topics they match
  // This handles cases where the query topic is expressed differently from the table title
  const TOPIC_ALIASES = {
    'restoran': ['restoran', 'rumah makan', 'akomodasi', 'makan minum', 'hotel', 'penginapan'],
    'hotel': ['hotel', 'penginapan', 'akomodasi', 'makan minum'],
    'kemiskinan': ['miskin', 'kemiskinan', 'garis kemiskinan', 'penduduk miskin'],
    'penduduk': ['penduduk', 'kependudukan', 'populasi', 'jiwa', 'demografi', 'kepadatan'],
    'inflasi': ['inflasi', 'ihk', 'harga konsumen', 'deflasi', 'indeks harga'],
    'pengangguran': ['pengangguran', 'tpt', 'tpak', 'angkatan kerja', 'tenaga kerja', 'ketenagakerjaan'],
    'pdrb': ['pdrb', 'produk domestik', 'pertumbuhan ekonomi', 'lapangan usaha', 'ekonomi'],
    'ipm': ['ipm', 'pembangunan manusia', 'human development'],
    'gini': ['gini', 'ketimpangan', 'inequality', 'rasio gini'],
    'upah': ['upah', 'gaji', 'ump', 'umr'],
    'pertanian': ['pertanian', 'padi', 'jagung', 'tanaman', 'panen', 'tanam', 'produksi pertanian', 'luas panen', 'luas tanam'],
    'perkebunan': ['perkebunan', 'kelapa', 'sawit', 'kopi', 'kakao', 'cengkeh', 'produksi perkebunan'],
    'pendidikan': ['pendidikan', 'sekolah', 'guru', 'murid', 'siswa', 'lama sekolah'],
    'kesehatan': ['kesehatan', 'rumah sakit', 'puskesmas', 'morbiditas', 'harapan hidup', 'ahh', 'keluhan kesehatan'],
    'kendaraan': ['kendaraan', 'kendaraan bermotor', 'mobil', 'sepeda motor'],
    'investasi': ['investasi', 'pmtb', 'pembentukan modal', 'modal tetap bruto'],
    'ekspor': ['ekspor', 'export', 'perdagangan luar negeri'],
    'impor': ['impor', 'import'],
    'pariwisata': ['pariwisata', 'wisata', 'wisatawan', 'turis'],
    'iklim': ['iklim', 'curah hujan', 'suhu', 'cuaca'],
    'konsumsi': ['konsumsi', 'pengeluaran', 'belanja rumah tangga'],
  };

  // Identify the primary topic of the query
  let queryTopic = null;
  for (const [topic, aliases] of Object.entries(TOPIC_ALIASES)) {
    if (aliases.some(a => query.includes(a)) || queryWords.some(w => topic.includes(w) || w.includes(topic))) {
      queryTopic = topic;
      break;
    }
  }

  // If we identified a query topic, check if the table title relates to that topic
  if (queryTopic) {
    const topicAliases = TOPIC_ALIASES[queryTopic] || [queryTopic];
    const titleMatchesTopic = topicAliases.some(alias => tableTitle.includes(alias));

    if (titleMatchesTopic) {
      return { isRelevant: true, reason: `Table title matches query topic "${queryTopic}"` };
    }

    // Check if the table title contains a DIFFERENT major topic
    const tableTopic = Object.entries(TOPIC_ALIASES).find(([, aliases]) =>
      aliases.some(a => tableTitle.includes(a))
    );

    if (tableTopic && tableTopic[0] !== queryTopic) {
      // Query is about one topic, table is about a clearly different topic
      // Exception: If query topic can be a sub-component of the table topic, allow it
      const allowedOverlaps = {
        'restoran': ['pdrb'], // restoran is NOT a sub-topic of PDRB — PDRB just has "Akomodasi dan Makan Minum" as sector name
        'hotel': ['pdrb'],
      };
      const blocked = allowedOverlaps[queryTopic]?.includes(tableTopic[0]);
      if (blocked) {
        return {
          isRelevant: false,
          reason: `Query topic "${queryTopic}" ≠ table topic "${tableTopic[0]}" (${tableTitle.slice(0, 60)})`,
        };
      }
    }
  }

  // Fallback: check keyword overlap between query and table title
  const titleWords = new Set(tableTitle.split(/[\s,·•]+/).filter(w => w.length > 2));
  const overlap = queryWords.filter(w => {
    for (const tw of titleWords) {
      if (tw.includes(w) || w.includes(tw)) return true;
    }
    return false;
  });

  // Require at least one substantive keyword match
  if (overlap.length === 0 && queryWords.length >= 2) {
    // Also check columns for keyword match
    const columns = (table.columns || []).map(c => (c || '').toLowerCase()).join(' ');
    const colOverlap = queryWords.filter(w => columns.includes(w));
    if (colOverlap.length === 0) {
      return {
        isRelevant: false,
        reason: `No keyword overlap: query=[${queryWords.join(',')}] vs title="${tableTitle.slice(0, 60)}"`,
      };
    }
  }

  return { isRelevant: true, reason: 'Keywords overlap or no clear mismatch' };
}

// ── Statistical Context Classification ───────────────────────────────────

/**
 * Determine if the conversation is about statistical data or non-statistical topics.
 * Uses multi-signal approach: query patterns, pipeline context, UI metadata.
 *
 * @returns {{ isStatistical: boolean, confidence: 'high'|'medium'|'low', reason: string }}
 */
function classifyStatisticalContext(ctx, userQuery, responseText, uiMeta) {
  // Signal 1: Pipeline already flagged as greeting
  if (ctx.isGreeting) {
    return { isStatistical: false, confidence: 'high', reason: 'Pipeline flagged as greeting' };
  }

  // Signal 2: Query matches non-statistical patterns
  const queryTrimmed = userQuery.trim();
  let matchedNonStatPattern = false;
  for (const pattern of NON_STATISTICAL_QUERY_PATTERNS) {
    if (pattern.test(queryTrimmed)) {
      matchedNonStatPattern = true;
      break;
    }
  }

  // Signal 2b: Check BPS institutional patterns BEFORE deciding non-statistical.
  // Queries about BPS services/organization use PPID knowledge and should NOT be suppressed.
  if (matchedNonStatPattern) {
    const isBPSInstitutional = BPS_INSTITUTIONAL_INDICATORS.some(p => p.test(queryTrimmed));
    const hasPPIDKnowledge = (ctx.knowledgeContext || []).some(d => PPID_CATEGORIES.has(d.category));
    if (isBPSInstitutional || hasPPIDKnowledge) {
      return { isStatistical: true, confidence: 'high', reason: 'BPS institutional query with PPID knowledge', isBPSInstitutional: true };
    }
    return { isStatistical: false, confidence: 'high', reason: `Non-statistical pattern` };
  }

  // Signal 3: Query matches statistical indicators → definitely statistical
  for (const pattern of STATISTICAL_CONTEXT_INDICATORS) {
    if (pattern.test(queryTrimmed)) {
      return { isStatistical: true, confidence: 'high', reason: `Statistical indicator: ${pattern.source}` };
    }
  }

  // Signal 3b: BPS institutional → also keep display
  for (const pattern of BPS_INSTITUTIONAL_INDICATORS) {
    if (pattern.test(queryTrimmed)) {
      return { isStatistical: true, confidence: 'high', reason: `BPS institutional: ${pattern.source}`, isBPSInstitutional: true };
    }
  }

  // Signal 4: Pipeline context — data preview or candidates present
  const hasDataPreview = Boolean(ctx.dataPreview);
  const hasCandidates = ctx.candidates && ctx.candidates.length > 0;
  const hasKnowledge = ctx.knowledgeContext && ctx.knowledgeContext.length > 0;
  const hasEximParams = Boolean(ctx.eximParams);
  const isKnowledgeMode = Boolean(ctx.isKnowledgeMode);

  if (hasDataPreview || hasEximParams) {
    return { isStatistical: true, confidence: 'high', reason: 'Has data preview or EXIM params' };
  }

  if (hasCandidates && ctx.candidates.length >= 2) {
    return { isStatistical: true, confidence: 'medium', reason: `Has ${ctx.candidates.length} candidates` };
  }

  if (isKnowledgeMode && hasKnowledge) {
    const hasPPIDKB = (ctx.knowledgeContext || []).some(d => PPID_CATEGORIES.has(d.category));
    return {
      isStatistical: true, confidence: 'medium',
      reason: hasPPIDKB ? 'Knowledge mode with PPID results' : 'Knowledge mode with results',
      isBPSInstitutional: hasPPIDKB,
    };
  }

  // Signal 5: Conversation topic from context detection
  if (ctx.conversationTopic) {
    // If we have a conversation topic, the pipeline identified a statistical context
    return { isStatistical: true, confidence: 'medium', reason: `Conversation topic: ${ctx.conversationTopic}` };
  }

  // Signal 6: Short query without any data context → likely non-statistical follow-up
  if (queryTrimmed.split(/\s+/).length <= 3 && !hasCandidates && !hasDataPreview && !hasKnowledge) {
    return { isStatistical: false, confidence: 'low', reason: 'Short query with no data context' };
  }

  // Signal 7: Check if response text mentions statistical terms
  const responseHasStats = STATISTICAL_CONTEXT_INDICATORS.some(p => p.test(responseText));
  if (responseHasStats) {
    return { isStatistical: true, confidence: 'medium', reason: 'Response contains statistical terms' };
  }

  // Default: ambiguous — if there's ANY ui data, keep it; otherwise suppress
  const hasAnyUIData = Boolean(
    uiMeta.table || uiMeta.table2 ||
    (uiMeta.candidates && uiMeta.candidates.length > 0) ||
    (uiMeta.knowledgeCandidates && uiMeta.knowledgeCandidates.length > 0)
  );

  if (hasAnyUIData) {
    return { isStatistical: true, confidence: 'low', reason: 'Default: has UI data' };
  }

  return { isStatistical: false, confidence: 'low', reason: 'Default: no statistical signals' };
}

// ── Suppress Data Display ────────────────────────────────────────────────

/**
 * Remove data-related fields from uiMeta so the frontend doesn't show a second bubble.
 * Preserves suggestions and metadata for UX.
 */
function suppressDataUI(uiMeta, options = {}) {
  const { keepKnowledge = false } = options;

  // Clear table data
  uiMeta.table = null;
  uiMeta.table2 = null;

  // Clear datasource candidates (these are for statistical tables)
  uiMeta.candidates = [];

  // Clear knowledge candidates ONLY if no PPID/institutional content
  if (!keepKnowledge) {
    uiMeta.knowledgeCandidates = [];
  } else {
    logger.debug('Keeping knowledgeCandidates (PPID/institutional content)');
  }

  // Preserve external links — they provide useful BPS website references
  // even when the table data is suppressed

  // Clear query (used by frontend to detect second bubble)
  uiMeta.query = null;

  // Preserve: suggestions, recommendations, metadata, confidence
  // These are useful even for non-statistical responses

  logger.debug({ keepKnowledge }, 'Data display suppressed in uiMeta');
}

// ── Narrative Quality Heuristics ─────────────────────────────────────────

/**
 * Quick check if narrative might need LLM review.
 * Returns true only for edge cases — we don't want LLM review on every response.
 */
function shouldReviewNarrative(responseText, userQuery) {
  // Very short responses that might be incomplete
  if (responseText.trim().length < 30 && responseText.trim().length > 0) {
    return true;
  }

  // Response contains unusual patterns
  if (/\b(error|undefined|null|NaN)\b/i.test(responseText)) {
    return true;
  }

  // Response seems off-topic (mentioned irrelevant topics)
  if (/\b(politik|agama|sara|ras|suku)\b/i.test(responseText) &&
      !/\b(statistik|data|indikator|penduduk)\b/i.test(responseText)) {
    return true;
  }

  return false;
}

// ── LLM Review (Optional) ─────────────────────────────────────────────────

/**
 * Run a fast LLM review for ambiguous cases.
 * Uses gpt-4.1 for low latency (~500-1500ms).
 *
 * @returns {Promise<Object|null>} LLM review result or null if failed/skipped
 */
async function runLLMReview(ctx, userQuery, fullText, uiMeta, _openaiKey) {
  try {
    const hasTable = Boolean(uiMeta.table?.rows?.length);
    const hasCandidates = Boolean(uiMeta.candidates?.length);
    const hasKnowledge = Boolean(uiMeta.knowledgeCandidates?.length);
    const tableTitle = uiMeta.table?.title || '';

    // Build knowledge titles for supervisor context so it can verify
    // that response data came from KB documents, not fabricated.
    const knowledgeTitles = (ctx.knowledgeContext || [])
      .slice(0, 5)
      .map(d => {
        let title = d.title || d.name || '';
        if (d._extractedTableTitle) title += ` [Tabel: ${d._extractedTableTitle}]`;
        else if (d.extractionMethod === 'indicator-guided') title += ' [tabel diekstrak]';
        return title;
      })
      .filter(Boolean);

    const reconciliationResult = ctx.reconciliationResult || null;
    // Tier-aware truncation: DEEP/COMPLEX get more context for fabrication check
    const tier = ctx.modelRoute?.tier || ctx.tier || 'simple';
    const maxResponseChars = tier === 'deep' ? 8000 : tier === 'complex' ? 5000 : 3000;
    const prompt = buildSupervisorPrompt(userQuery, fullText, hasTable, hasCandidates, hasKnowledge, tableTitle, knowledgeTitles, reconciliationResult, { maxResponseChars });

    const data = await chatCompletion({
      apiKeyEnv: 'OPENAI_API_KEY_CHAT',
      payload: {
        // ALWAYS use fast model for supervisor sub-agent — internal infrastructure,
        // not user-facing. User's model choice only affects the main response stream.
        model: SUPERVISOR_LLM_MODEL,
        messages: [
          { role: 'system', content: SUPERVISOR_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        max_tokens: 1200,
        response_format: SUPERVISOR_RESPONSE_FORMAT,
      },
      timeoutMs: SUPERVISOR_TIMEOUT_MS,
      retries: 1,
    });

    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    // Strip markdown code fences (Gemini often wraps JSON in ```json ... ```)
    const cleaned = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn({ threadId: ctx.threadId, preview: content.slice(0, 200) }, 'Supervisor LLM: no JSON found in response');
      return null;
    }
    const result = JSON.parse(jsonMatch[0]);
    logger.debug({ threadId: ctx.threadId, llmResult: result }, 'Supervisor LLM review result');

    return result;

  } catch (err) {
    if (err.message?.includes('timeout') || err.code === 'ECONNABORTED') {
      logger.warn({ threadId: ctx.threadId }, 'Supervisor LLM review timed out');
    } else {
      logger.warn({ error: err.message, threadId: ctx.threadId }, 'Supervisor LLM review error');
    }
    return null;
  }
}

// ── Prompts ──────────────────────────────────────────────────────────────

const SUPERVISOR_SYSTEM_PROMPT = `Anda adalah supervisor pengendalian mutu dan formatting untuk MALIKA, asisten AI resmi dari BPS (Badan Pusat Statistik) Provinsi Maluku Utara.

Tugas Anda:
1. KEPATUHAN BPS: Pastikan respons mematuhi UU No. 16 Tahun 1997 tentang Statistik.
   - BPS TIDAK BOLEH memberikan data individu/perorangan/mikro (Pasal 21)
   - Hanya data agregat/makro yang boleh disajikan
   - Identitas responden bersifat rahasia mutlak

2. KONTEKS STATISTIK: Tentukan apakah percakapan tentang statistik/data:
   - Statistik: data, tabel, indikator, BRS, publikasi, angka ekonomi/sosial
   - Non-statistik: sapaan, basa-basi, pertanyaan umum, opini

3. DETEKSI FABRIKASI/ESTIMASI DATA (KRITIS):
   - Cek apakah respons mengandung angka-angka SPESIFIK (terutama rincian per kabupaten/kota)
     yang TIDAK bisa ditelusuri ke tabel/konteks yang diberikan
   - Jika user bertanya tentang topik X tapi tabel berisi data topik Y yang BERBEDA,
     dan respons memberikan angka detail tentang topik X → ini FABRIKASI
   - Contoh: user tanya "jumlah restoran" tapi tabel berisi PDRB, dan respons memberikan
     "Ternate: 207, Halut: 90, ..." → ini FABRICATED, harus dihapus
   - Jika terdeteksi fabrikasi: set suppress_data_display=true DAN revised_text harus mengatakan
     data spesifik tersebut belum tersedia

4. FORMATTING & KETERBACAAN (WAJIB SELALU DITERAPKAN):
   Anda WAJIB SELALU mengembalikan revised_text dengan formatting berikut:
   a. **Bold** untuk angka kunci, persentase, nama indikator penting
      Contoh: "Persentase penduduk miskin: **5,59%**"
   b. Numbered list (1. 2. 3.) untuk data multi-item atau perbandingan antar wilayah
   c. Emoji profesional HEMAT (max 1-2 per jawaban, HANYA di akhir kalimat atau sebagai aksen):
      📈 tren naik, 📉 tren turun, ✅ penutup/konfirmasi, ℹ️ catatan
      DILARANG meletakkan emoji di AWAL paragraf/kalimat
   d. Paragraf terpisah dengan baris kosong
   e. Nada FORMAL dan informatif ala customer service pemerintah
   f. JANGAN gunakan heading (#), horizontal rule (---), bullet (-), atau code block
   g. JANGAN ubah angka, fakta, atau substansi data — hanya format presentasi
   h. Jika respons sudah singkat (greeting, konfirmasi), cukup rapikan tanpa menambah panjang berlebih
   i. PERTAHANKAN semua link markdown [label](url) yang sudah ada

Balas HANYA dalam JSON (tanpa markdown wrapper):
{
  "bps_compliant": true/false,
  "compliance_note": "string atau null",
  "is_statistical": true/false,
  "suppress_data_display": true/false,
  "data_fabrication_detected": true/false,
  "revised_text": "teks LENGKAP yang sudah diformat ulang — WAJIB selalu diisi",
  "reason": "alasan singkat"
}

PENTING:
- suppress_data_display=true berarti HAPUS tabel dan kandidat dari tampilan
- data_fabrication_detected=true jika respons mengarang angka yang tidak ada di konteks
- Jika fabrikasi terdeteksi, revised_text WAJIB mengganti angka palsu dengan pernyataan "data belum tersedia"
- revised_text WAJIB berisi teks lengkap yang sudah diformat (bold, emoji, list) — JANGAN null
- JANGAN mengubah substansi/angka, hanya formatting dan presentasi (kecuali jika fabrikasi terdeteksi)
- Pertahankan user-facing links [label](url)
- Kecepatan penting — fokus pada formatting + deteksi fabrikasi, jangan analisis berlebihan`;

/**
 * Build the user prompt for supervisor LLM.
 */
function buildSupervisorPrompt(userQuery, responseText, hasTable, hasCandidates, hasKnowledge, tableTitle, knowledgeTitles = [], reconciliationResult = null, { maxResponseChars = 3000 } = {}) {
  // Tier-aware truncation: DEEP=8000, COMPLEX=5000, default=3000
  const truncated = responseText.length > maxResponseChars
    ? responseText.slice(0, maxResponseChars) + '...[dipotong]'
    : responseText;

  let tableLine = `- Tabel data: ${hasTable ? 'ADA' : 'TIDAK ADA'}`;
  if (hasTable && tableTitle) {
    tableLine += ` (judul: "${tableTitle}")`;
  }

  let knowledgeLine = `- Referensi pengetahuan: ${hasKnowledge ? 'ADA' : 'TIDAK ADA'}`;
  if (knowledgeTitles.length > 0) {
    knowledgeLine += `\n  Dokumen RAG yang digunakan:\n${knowledgeTitles.map(t => `  • ${t}`).join('\n')}`;
  }

  // Build reconciliation info for supervisor
  let reconciliationInfo = '';
  if (reconciliationResult?.has_overlap && reconciliationResult.reconciliation?.length > 0) {
    const items = reconciliationResult.reconciliation.slice(0, 5)
      .map(r => {
        const val = r.use_source === 'table'
          ? `${r.table_value} (${r.table_period})`
          : r.use_source === 'knowledge'
            ? `${r.knowledge_value} (${r.knowledge_period}, ${r.knowledge_source})`
            : 'gabungkan';
        return `  • ${r.dimension}: gunakan ${r.use_source} → ${val} — ${r.reason}`;
      })
      .join('\n');
    reconciliationInfo = `REKONSILIASI DATA (PENTING — BUKAN FABRIKASI):
Data Reconciler Agent telah menganalisis overlap antara tabel dan BRS/Pub.
Angka-angka berikut sudah DIVERIFIKASI oleh reconciler dan BUKAN fabrikasi:
${items}
PERIKSA: Apakah respons menggunakan sumber yang SESUAI dengan keputusan reconciler di atas?
JANGAN tandai angka dari reconciliation map sebagai fabrikasi.`;
  } else {
    reconciliationInfo = 'REKONSILIASI DATA: Tidak ada reconciliation map (tidak ada overlap terdeteksi).';
  }

  return `=== PERTANYAAN USER ===
${expandAbbreviationsInline(userQuery)}

=== RESPONS ASISTEN ===
${truncated}

=== STATUS UI ===
${tableLine}
- Kandidat datasource: ${hasCandidates ? 'ADA' : 'TIDAK ADA'}
${knowledgeLine}

PERIKSA: Apakah angka-angka dalam respons BENAR-BENAR berasal dari tabel datasource ATAU dokumen RAG/pengetahuan? Jika respons menyebut angka detail tapi TIDAK ADA sumber (tabel maupun dokumen RAG) yang relevan dengan topik tersebut, itu FABRIKASI. Namun jika angka berasal dari dokumen RAG (BRS/Publikasi), itu SAH meskipun tabel datasource berisi topik berbeda.

${reconciliationInfo}

Evaluasi dan balas dalam JSON.`;
}

// ── Quick Regex-Based Formatter (fallback) ───────────────────────────────

/**
 * Fast regex-based formatting for when the LLM supervisor times out or
 * doesn't produce revised_text. Runs in <1ms.
 *
 * Applies:
 * - Bold on percentages, rupiah amounts, and large numbers with units
 * - ✅ or ℹ️ emoji closer (no opener emoji)
 */
function quickFormat(text) {
  if (!text || text.length < 50) return text;

  let f = text;

  // 1. Bold percentages: "5,59%" → "**5,59%**" (skip already bolded)
  f = f.replace(/(?<!\*\*)(\d+[.,]\d+\s*%(?:\s*poin)?)/g, '**$1**');

  // 2. Bold rupiah amounts: "Rp692.592" → "**Rp692.592**"
  f = f.replace(/(?<!\*\*)(Rp\s?[\d.,]+(?:\s*(?:ribu|juta|miliar|triliun))?)/gi, '**$1**');

  // 3. Bold large numbers with units: "74,81 ribu orang" → "**74,81 ribu orang**"
  f = f.replace(/(?<!\*\*)(\d+[.,]?\d*\s*(?:ribu|juta|miliar|triliun)\s*(?:orang|jiwa|rupiah)?)/gi, '**$1**');

  // 4. Bold standalone indices: "72,52" when preceded by colon or key term
  f = f.replace(/(:\s*)(\d{2,3}[.,]\d{1,3})(?!\s*%)/g, '$1**$2**');

  // 5. Clean double-bold artifacts: ****text**** → **text**
  f = f.replace(/\*{3,}([^*]+)\*{3,}/g, '**$1**');

  // 6. Strip any leading emoji (from prior LLM or system prompt)
  f = f.replace(/^\s*[\u{1F300}-\u{1FAD6}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}\u{1F900}-\u{1F9FF}]\s*/u, '');

  // 7. Add closing emoji if response doesn't end with one
  const trimmed = f.trimEnd();
  const endsWithEmoji = /[\u{1F300}-\u{1FAD6}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}\u{1F900}-\u{1F9FF}]\s*$/u.test(trimmed);
  if (!endsWithEmoji) {
    if (/\?\s*$/.test(trimmed)) {
      // Ends with question — no emoji needed
    } else if (/membantu|informasi|lanjut/i.test(trimmed.slice(-80))) {
      f = trimmed + ' ✅';
    } else {
      f = trimmed + ' ℹ️';
    }
  }

  return f;
}

// ── Exports ──────────────────────────────────────────────────────────────

module.exports = {
  reviewResponse,
  checkBPSCompliance,
  checkTableRelevance,
  classifyStatisticalContext,
  suppressDataUI,
  // Expose config for testing
  SUPERVISOR_ENABLED,
  SUPERVISOR_LLM_ENABLED,
};
