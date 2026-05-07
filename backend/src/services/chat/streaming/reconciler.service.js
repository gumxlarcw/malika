/**
 * Data Reconciler Sub-Agent Service
 *
 * Performs cell-level comparison between data from multiple sources
 * (Datasource Table vs BRS vs Publikasi) to determine which data point
 * is more recent for each row/dimension.
 *
 * Architecture:
 *   1. Triggered ONLY when multi-source overlap is detected
 *      (table + BRS/Pub on same topic via _hasTopicOverlap)
 *   2. Sends both sources to gpt-5-mini with structured output
 *   3. Returns reconciliation map: per-row source selection
 *   4. Map is injected into context messages so main LLM follows it
 *
 * Model: gpt-5-mini (reasoning needed for period extraction from prose)
 * Cost: ~$0.01-0.02 per call (only when overlap detected)
 * Latency: ~1.5-2.5s
 *
 * @module reconciler.service
 */

'use strict';

const logger = require('../../../utils/logger').child({ service: 'Reconciler' });
const { chatCompletion } = require('../../ai/client/openaiClient');

// ── Configuration ────────────────────────────────────────────────────────
const RECONCILER_ENABLED = process.env.RECONCILER_ENABLED !== 'false'; // default ON
const RECONCILER_MODEL = process.env.RECONCILER_MODEL || 'gemini-3-flash-preview';
const RECONCILER_TIMEOUT_MS = parseInt(process.env.RECONCILER_TIMEOUT_MS, 10) || 45000; // 45s

// ── Structured Output Schema ─────────────────────────────────────────────
const RECONCILER_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'data_reconciliation',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        has_overlap: {
          type: 'boolean',
          description: 'Whether actual data overlap was found between table and knowledge',
        },
        reconciliation: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              dimension: {
                type: 'string',
                description: 'Row/data point identifier (e.g., "Inflasi Kota Ternate")',
              },
              table_value: {
                type: ['string', 'null'],
                description: 'Value from datasource table (null if not present)',
              },
              table_period: {
                type: ['string', 'null'],
                description: 'Reference period of table value (e.g., "September 2024")',
              },
              knowledge_value: {
                type: ['string', 'null'],
                description: 'Value from BRS/Publikasi (null if not present)',
              },
              knowledge_period: {
                type: ['string', 'null'],
                description: 'Reference period of BRS/Pub value (e.g., "Desember 2024")',
              },
              knowledge_source: {
                type: ['string', 'null'],
                description: 'Source type: "BRS" or "Publikasi" (null if not present)',
              },
              use_source: {
                type: 'string',
                enum: ['table', 'knowledge', 'both'],
                description: 'Which source to use: table, knowledge (BRS/Pub), or both (complementary)',
              },
              reason: {
                type: 'string',
                description: 'Brief reason for the choice (e.g., "BRS Dec 2024 more recent than Table Sep 2024")',
              },
            },
            required: ['dimension', 'table_value', 'table_period', 'knowledge_value', 'knowledge_period', 'knowledge_source', 'use_source', 'reason'],
            additionalProperties: false,
          },
        },
        summary: {
          type: 'string',
          description: 'Brief summary of reconciliation decisions',
        },
      },
      required: ['has_overlap', 'reconciliation', 'summary'],
      additionalProperties: false,
    },
  },
};

// ── System Prompt ────────────────────────────────────────────────────────
const RECONCILER_SYSTEM_PROMPT = `Anda adalah Data Reconciler Agent untuk MALIKA (Asisten Data BPS Maluku Utara).

TUGAS: Bandingkan data dari TABEL DATABASE dan DOKUMEN BRS/Publikasi, lalu tentukan sumber mana yang memiliki data LEBIH BARU untuk setiap baris/data point.

ATURAN KEPUTUSAN:
1. Identifikasi DIMENSI yang sama antara tabel dan BRS/Publikasi
   (indikator × wilayah × kategori yang sama)
2. Untuk setiap dimensi yang OVERLAP:
   - Bandingkan PERIODE REFERENSI dari masing-masing sumber
   - Pilih sumber dengan periode LEBIH BARU → use_source
   - Jika periode SAMA → pilih "table" (lebih presisi/terstruktur)
   - Jika TIDAK BISA dibandingkan (periode tidak jelas) → pilih "both"
3. Untuk data yang HANYA ada di satu sumber → use_source = sumber tersebut
4. "both" = data saling melengkapi (dimensi berbeda, bukan duplikat)

ATURAN PERIODE BPS:
- Publikasi "Dalam Angka 2025" berisi data referensi tahun 2024, BUKAN 2025
- BRS "Februari 2025" berisi data per Februari 2025
- Triwulan I = Jan-Mar, Triwulan II = Apr-Jun, Triwulan III = Jul-Sep, Triwulan IV = Okt-Des
- Semester I = Jan-Jun, Semester II = Jul-Des

CONTOH:
- Tabel: "Inflasi YoY Kota Ternate September 2024 = 2,10%"
  BRS: "laju inflasi year-on-year Kota Ternate Desember 2024 mencapai 2,34 persen"
  → dimension: "Inflasi YoY Kota Ternate"
  → table_value: "2,10%", table_period: "September 2024"
  → knowledge_value: "2,34%", knowledge_period: "Desember 2024"
  → use_source: "knowledge" (Des > Sep)
  → reason: "BRS Desember 2024 lebih baru dari Tabel September 2024"

FORMAT OUTPUT: JSON sesuai schema (has_overlap, reconciliation[], summary)
Analisis SETIAP baris/data point yang bisa dibandingkan.
Jika tidak ada overlap sama sekali, set has_overlap=false dan reconciliation=[].`;

/**
 * Build the user prompt for the reconciler with actual data from both sources.
 *
 * @param {Object} dataPreview - Table data from datasource
 * @param {Array<Object>} knowledgeDocs - BRS/Pub docs with topic overlap
 * @returns {string} User prompt text
 */
function _buildReconcilerPrompt(dataPreview, knowledgeDocs) {
  const parts = [];

  // ── Part 1: Table data ──────────────────────────────────────────
  parts.push('=== SUMBER 1: TABEL DATABASE ===');
  parts.push(`Judul: ${dataPreview.title}`);
  if (dataPreview.unit) parts.push(`Satuan: ${dataPreview.unit}`);
  if (dataPreview.geo) parts.push(`Wilayah filter: ${dataPreview.geo}`);
  if (dataPreview.latestPeriodLabel) parts.push(`Periode terbaru: ${dataPreview.latestPeriodLabel}`);

  // Build markdown table (max 50 rows to fit context)
  const cols = dataPreview.columns || Object.keys(dataPreview.rows?.[0] || {});
  const displayRows = (dataPreview.rows || []).slice(0, 50);

  if (cols.length > 0 && displayRows.length > 0) {
    const headerRow = '| ' + cols.join(' | ') + ' |';
    const separatorRow = '| ' + cols.map(() => '---').join(' | ') + ' |';
    const bodyRows = displayRows.map(row => {
      const values = cols.map(col => {
        const val = row[col];
        if (val == null || val === '') return '-';
        return String(val).replace(/\|/g, '\\|');
      });
      return '| ' + values.join(' | ') + ' |';
    }).join('\n');
    parts.push(`\n${headerRow}\n${separatorRow}\n${bodyRows}`);
  }

  // ── Part 2: Knowledge docs ──────────────────────────────────────
  parts.push('\n=== SUMBER 2: DOKUMEN BRS/PUBLIKASI ===');
  for (const doc of knowledgeDocs) {
    const type = doc.category === 'BRS' ? '📰 BRS' : '📕 Publikasi';
    parts.push(`\n--- ${type}: ${doc.title || 'Untitled'} ---`);
    if (doc._extractedTableTitle) {
      parts.push(`Tabel diekstrak: ${doc._extractedTableTitle}`);
    }
    // Include content (truncated to 2000 chars per doc to keep total prompt lean)
    const content = (doc.content || '').slice(0, 2000);
    parts.push(content);
  }

  parts.push('\n=== INSTRUKSI ===');
  parts.push('Bandingkan kedua sumber di atas. Identifikasi data point yang SAMA dimensinya, dan tentukan sumber mana yang LEBIH BARU per-baris.');

  return parts.join('\n');
}

/**
 * Run the Data Reconciler to compare table data with overlapping knowledge docs.
 *
 * @param {Object} ctx - Pipeline context
 * @param {Object} dataPreview - Table data preview
 * @param {Array<Object>} overlappingDocs - Knowledge docs with topic overlap
 * @returns {Promise<ReconciliationResult|null>} Reconciliation map or null if skipped/failed
 *
 * @typedef {Object} ReconciliationResult
 * @property {boolean} has_overlap - Whether actual overlap was found
 * @property {Array<Object>} reconciliation - Per-row source decisions
 * @property {string} summary - Brief summary
 * @property {number} latencyMs - Time taken
 */
async function reconcileDataSources(ctx, dataPreview, overlappingDocs) {
  if (!RECONCILER_ENABLED) {
    logger.debug('Reconciler disabled, skipping');
    return null;
  }

  // Validate inputs
  if (!dataPreview?.rows?.length || !overlappingDocs?.length) {
    logger.debug('Reconciler: no table data or no overlapping docs, skipping');
    return null;
  }

  const startTime = Date.now();

  try {
    const userPrompt = _buildReconcilerPrompt(dataPreview, overlappingDocs);

    logger.info({
      threadId: ctx.threadId,
      tableTitle: dataPreview.title?.slice(0, 80),
      overlappingDocCount: overlappingDocs.length,
      docTitles: overlappingDocs.map(d => d.title?.slice(0, 60)),
      promptLength: userPrompt.length,
    }, 'Reconciler: starting data reconciliation');

    const data = await chatCompletion({
      apiKeyEnv: 'OPENAI_API_KEY_CHAT',
      payload: {
        model: RECONCILER_MODEL,
        messages: [
          { role: 'system', content: RECONCILER_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 2000,
        response_format: RECONCILER_RESPONSE_FORMAT,
      },
      timeoutMs: RECONCILER_TIMEOUT_MS,
      retries: 0, // No retry — avoids double-timeout (was 30+30=61s)
    });

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      logger.warn({ threadId: ctx.threadId }, 'Reconciler: empty response');
      return null;
    }

    const result = JSON.parse(content);
    const latencyMs = Date.now() - startTime;

    logger.info({
      threadId: ctx.threadId,
      hasOverlap: result.has_overlap,
      reconciliationCount: result.reconciliation?.length || 0,
      summary: result.summary,
      latencyMs,
    }, 'Reconciler: completed');

    return {
      ...result,
      latencyMs,
    };

  } catch (err) {
    const latencyMs = Date.now() - startTime;
    if (err.message?.includes('timeout') || err.code === 'ECONNABORTED') {
      logger.warn({ threadId: ctx.threadId, latencyMs }, 'Reconciler: timed out');
    } else {
      logger.warn({ error: err.message, threadId: ctx.threadId, latencyMs }, 'Reconciler: error');
    }
    return null;
  }
}

/**
 * Format reconciliation result as context instruction for the main LLM.
 * Returns a string to be injected into the context messages.
 *
 * @param {Object} reconciliation - Result from reconcileDataSources
 * @returns {string|null} Context instruction or null if no overlap
 */
function formatReconciliationContext(reconciliation) {
  if (!reconciliation?.has_overlap || !reconciliation.reconciliation?.length) {
    return null;
  }

  const lines = [];
  lines.push('⚖️ PETA REKONSILIASI DATA (WAJIB DIIKUTI):');
  lines.push('Data Reconciler telah membandingkan semua sumber per-baris.');
  lines.push('GUNAKAN sumber yang ditunjuk untuk setiap data point berikut:\n');

  // Group by decision
  const useTable = [];
  const useKnowledge = [];
  const useBoth = [];

  for (const item of reconciliation.reconciliation) {
    const entry = `• ${item.dimension}: `;
    if (item.use_source === 'table') {
      useTable.push(entry + `GUNAKAN TABEL → ${item.table_value} (${item.table_period}) — ${item.reason}`);
    } else if (item.use_source === 'knowledge') {
      useKnowledge.push(entry + `GUNAKAN ${item.knowledge_source || 'BRS/PUB'} → ${item.knowledge_value} (${item.knowledge_period}) — ${item.reason}`);
    } else {
      useBoth.push(entry + `GABUNGKAN kedua sumber — ${item.reason}`);
    }
  }

  if (useKnowledge.length > 0) {
    lines.push('📰 Data LEBIH BARU dari BRS/Publikasi (PRIORITAS):');
    lines.push(...useKnowledge);
    lines.push('');
  }

  if (useTable.length > 0) {
    lines.push('📊 Data LEBIH BARU dari Tabel Database:');
    lines.push(...useTable);
    lines.push('');
  }

  if (useBoth.length > 0) {
    lines.push('🔗 Data saling melengkapi (gabungkan):');
    lines.push(...useBoth);
    lines.push('');
  }

  lines.push(`Ringkasan: ${reconciliation.summary}`);
  lines.push('\n⚠️ WAJIB: Saat menyebutkan angka, kutip dari sumber yang ditunjuk di atas.');
  lines.push('Sertakan atribusi sumber per-angka, misal: "2,34% [BRS Des 2024]"');

  return lines.join('\n');
}

module.exports = {
  reconcileDataSources,
  formatReconciliationContext,
  RECONCILER_ENABLED,
};
