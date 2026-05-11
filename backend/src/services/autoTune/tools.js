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
