'use strict';
/**
 * Auto Tune tools — invoked by the Anthropic agentic loop via tool_use.
 *
 * Each tool operates on the DB and mutates jobContext (stagedPatternIds,
 * stagedKbIds, log) so the caller can roll back this job's stagings on
 * regression failure and inspect the call log post-mortem.
 */
const ChatMessageFlag = require('../../models/ChatMessageFlag.model');
const ChatMessage = require('../../models/ChatMessage.model');
const ChatErrorPattern = require('../../models/ChatErrorPattern.model');
const KnowledgeBase = require('../../models/KnowledgeBase.model');
const sequelize = require('../../config/db');
const regressionService = require('./regression.service');

// Dedupe threshold: cosine similarity above this rejects a propose_pattern with
// a duplicate hint. 0.85 is empirically picked — Pattern #13/#14 share a
// canonical_query ("bantu saya analisis kondisi ekonomi di malut sepanjang
// 2025") and would have scored ~1.0, while #15 ("kalau data kabupaten atau
// kota ada?") scores ~0.3-0.4 against the same. 0.85 catches near-twins
// while leaving complementary patterns (different angles, same keyword space)
// alone.
const DEDUPE_SIMILARITY_THRESHOLD = 0.85;

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Check whether a proposed canonical_query is a near-duplicate of any existing
 * active pattern's canonical_query (cosine similarity > threshold).
 * @returns null if no duplicate, OR { id, name, canonical_query, similarity }
 */
async function findDuplicatePattern(proposedQuery) {
  const candidates = await ChatErrorPattern.findAll({
    where: { is_active: true },
    attributes: ['id', 'pattern_name', 'canonical_query'],
  });
  const withQueries = candidates.filter((p) => p.canonical_query);
  if (withQueries.length === 0) return null;

  // Lazy-require to keep xenova load off the module-init path
  const { embedQuery } = require('../bpsMetadata/embedding.service');
  const proposedEmb = await embedQuery(proposedQuery);

  let best = null;
  for (const p of withQueries) {
    const candEmb = await embedQuery(p.canonical_query);
    const sim = cosineSimilarity(proposedEmb, candEmb);
    if (!best || sim > best.similarity) {
      best = { id: p.id, name: p.pattern_name, canonical_query: p.canonical_query, similarity: sim };
    }
  }
  if (best && best.similarity > DEDUPE_SIMILARITY_THRESHOLD) return best;
  return null;
}

function logCall(jobContext, tool, payload) {
  jobContext.log.push({ tool, ts: Date.now(), ...payload });
}

async function rollbackStagings(jobContext) {
  for (const pid of jobContext.stagedPatternIds) {
    try { await ChatErrorPattern.destroy({ where: { id: pid } }); } catch (e) { /* ignore */ }
  }
  for (const kid of jobContext.stagedKbIds) {
    try {
      await sequelize.query(
        `DELETE FROM retrieval_chunks WHERE source_kind=? AND source_ref_id=?`,
        { replacements: ['knowledge_doc', kid] }
      );
    } catch (e) { /* ignore */ }
    try { await KnowledgeBase.destroy({ where: { id: kid } }); } catch (e) { /* ignore */ }
  }
  jobContext.stagedPatternIds = [];
  jobContext.stagedKbIds = [];
}

function createToolset(jobContext) {
  return {
    async read_flag() {
      const flag = await ChatMessageFlag.findByPk(jobContext.flagId);
      if (!flag) throw new Error(`flag ${jobContext.flagId} not found`);
      const recent = await ChatMessage.findAll({
        where: { thread_id: flag.thread_id },
        order: [['id', 'DESC']],
        limit: 4,
        attributes: ['id', 'role', 'content', 'created_at'],
      });
      logCall(jobContext, 'read_flag', { flagId: flag.id });
      return {
        flag: {
          id: flag.id,
          flag_type: flag.flag_type,
          severity: flag.severity,
          user_query: flag.user_query,
          assistant_response: flag.assistant_response,
          context_snapshot: flag.context_snapshot,
          thread_id: flag.thread_id,
        },
        thread_messages: recent
          .slice()
          .reverse()
          .map((m) => ({
            role: m.role,
            content: String(m.content || '').slice(0, 800),
          })),
      };
    },

    async search_existing_patterns({ keywords = [] }) {
      const kws = Array.isArray(keywords) ? keywords.slice(0, 10).map((k) => String(k).toLowerCase()) : [];
      const patterns = await ChatErrorPattern.findAll({ where: { is_active: true }, limit: 100 });
      const hits = patterns
        .filter((p) => {
          const triggers = (p.trigger_keywords || []).map((k) => String(k).toLowerCase());
          return kws.some((kw) => triggers.includes(kw));
        })
        .slice(0, 5);
      logCall(jobContext, 'search_existing_patterns', { keywords: kws, hits: hits.length });
      return hits.map((p) => ({
        id: p.id,
        pattern_name: p.pattern_name,
        fix_type: p.fix_type,
        fix_content: String(p.fix_content || '').slice(0, 200),
        trigger_keywords: p.trigger_keywords,
        occurrence_count: p.occurrence_count,
      }));
    },

    async search_knowledge_base({ query, limit = 5 }) {
      const { embedQuery } = require('../bpsMetadata/embedding.service');
      const emb = await embedQuery(String(query || ''));
      const [rows] = await sequelize.query(
        `SELECT rc.id AS rc_id, rc.source_ref_id AS kb_id, rc.title, rc.content_text,
                VEC_DISTANCE_COSINE(rc.embedding, VEC_FromText(?)) AS distance
         FROM retrieval_chunks rc
         WHERE rc.source_kind = 'knowledge_doc'
         ORDER BY distance ASC
         LIMIT ?`,
        { replacements: [JSON.stringify(emb), parseInt(limit, 10) || 5] }
      );
      logCall(jobContext, 'search_knowledge_base', { query, hits: rows.length });
      return rows.map((r) => ({
        kb_id: r.kb_id,
        title: r.title,
        snippet: String(r.content_text || '').slice(0, 200),
        similarity: 1 - parseFloat(r.distance),
      }));
    },

    async propose_pattern({ name, type, keywords, fix_type, fix_content, canonical_query }) {
      // Dedupe gate: if the canonical_query is near-identical to an existing
      // active pattern, reject with a hint instead of staging a duplicate.
      try {
        const dup = await findDuplicatePattern(canonical_query);
        if (dup) {
          logCall(jobContext, 'propose_pattern', { duplicate_of: dup.id, similarity: dup.similarity.toFixed(3), name });
          return {
            ok: false,
            reason: 'duplicate_likely',
            similar_to: dup,
            hint: `Pattern #${dup.id} ("${dup.name}") already covers a query similar to "${canonical_query}" (cosine ${dup.similarity.toFixed(3)} > ${DEDUPE_SIMILARITY_THRESHOLD}). Either: (a) revise your proposal to target a different angle/canonical_query, or (b) call abandon if no novel fix exists.`,
          };
        }
      } catch (e) {
        // Dedupe is best-effort. If xenova or DB hiccups, log + proceed —
        // regression eval still gates final commit, so we don't block on this.
        logCall(jobContext, 'propose_pattern_dedupe_skipped', { err: e.message });
      }

      const pattern = await ChatErrorPattern.create({
        pattern_name: name,
        pattern_type: type,
        trigger_keywords: keywords,
        error_description: `Auto Tune proposal for flag ${jobContext.flagId}`,
        fix_type,
        fix_content,
        canonical_query,
        is_active: true,
        occurrence_count: 0,
      });
      jobContext.stagedPatternIds.push(pattern.id);
      logCall(jobContext, 'propose_pattern', { patternId: pattern.id, name });
      return { ok: true, patternId: pattern.id };
    },

    async propose_kb_correction({ title, content }) {
      const { processEmbeddings } = require('../ai/knowledgeDoc.service');
      const kb = await KnowledgeBase.create({
        title,
        description: `Auto Tune correction for flag ${jobContext.flagId}`,
        category: 'koreksi',
        source_type: 'text',
        content,
        content_length: String(content || '').length,
        status: 'pending',
      });
      try {
        await processEmbeddings([kb.id]);
        await kb.reload();
        if (kb.status !== 'ready') {
          throw new Error(`KB indexing did not reach 'ready' (status=${kb.status})`);
        }
      } catch (e) {
        await kb.destroy().catch(() => {});
        throw new Error(`KB indexing failed: ${e.message}`);
      }
      jobContext.stagedKbIds.push(kb.id);
      logCall(jobContext, 'propose_kb_correction', { kbId: kb.id, title });
      return { ok: true, kbId: kb.id };
    },

    async run_regression_and_commit() {
      const regression = await regressionService.runRegression();
      logCall(jobContext, 'run_regression_and_commit', { ok: regression.ok });

      if (regression.ok) {
        return { ok: true, committed: true, regression };
      }

      // ROLLBACK this job's stagings
      const failedPatterns = regression.patternChecks.filter((c) => !c.passed);
      const failedKb = regression.kbChecks.filter((c) => !c.passed);
      await rollbackStagings(jobContext);

      return {
        ok: false,
        committed: false,
        regression,
        rolled_back_pattern_failures: failedPatterns,
        rolled_back_kb_failures: failedKb,
      };
    },

    async abandon({ reason }) {
      await rollbackStagings(jobContext);
      logCall(jobContext, 'abandon', { reason });
      return { ok: true, abandoned: true, reason };
    },
  };
}

module.exports = { createToolset };
