'use strict';
/**
 * Auto Tune regression eval.
 *
 * Two checks run together; both must pass for proposed changes to commit:
 *   1. Pattern preservation — every active pattern with canonical_query still fires
 *      via getPromptFixes() (or checkQueryPattern() for special_handling).
 *   2. KB preservation — every koreksi knowledge_base entry still has its
 *      retrieval_chunks row present (existence-only check in MVP).
 *
 * Designed to run AFTER proposed changes are staged in the DB:
 *   - proposed pattern inserted with is_active=true
 *   - proposed KB row inserted + indexed via xenova (rc row created)
 *
 * If regression fails, the CALLER (tools.js run_regression_and_commit) is
 * responsible for rolling back this job's staged inserts.
 */
const ChatErrorPattern = require('../../models/ChatErrorPattern.model');
const KnowledgeBase = require('../../models/KnowledgeBase.model');
const errorLearning = require('../chat/errorLearning.service');
const sequelize = require('../../config/db');

async function checkPatternStillFires(pattern) {
  if (!pattern.canonical_query) {
    return {
      patternId: pattern.id,
      name: pattern.pattern_name,
      passed: true,
      reason: 'no canonical_query (legacy pattern, skipped)',
    };
  }

  const fixes = await errorLearning.getPromptFixes(pattern.canonical_query);
  const fixesArr = Array.isArray(fixes) ? fixes : [];

  if (pattern.fix_type === 'add_to_prompt' && fixesArr.includes(pattern.fix_content)) {
    return { patternId: pattern.id, name: pattern.pattern_name, passed: true };
  }

  // special_handling patterns: getPromptFixes surfaces them with "[SPECIAL HANDLING — name]" prefix (per Task 7 wiring)
  if (pattern.fix_type === 'special_handling') {
    const hasMarker = fixesArr.some((f) =>
      typeof f === 'string' && f.includes(`[SPECIAL HANDLING — ${pattern.pattern_name}]`)
    );
    if (hasMarker) {
      return { patternId: pattern.id, name: pattern.pattern_name, passed: true };
    }
    // Fall back to direct checkQueryPattern lookup
    const sh = await errorLearning.checkQueryPattern(pattern.canonical_query);
    if (sh && sh.patternId === pattern.id) {
      return { patternId: pattern.id, name: pattern.pattern_name, passed: true };
    }
  }

  return {
    patternId: pattern.id,
    name: pattern.pattern_name,
    passed: false,
    reason: `Pattern did not fire on canonical_query="${pattern.canonical_query}". Fixes returned: ${fixesArr.length} item(s).`,
  };
}

async function checkKbStillRetrieves(kbRow) {
  // MVP: existence-only check. The retrieval_chunks row must exist for the KB id.
  // True top-K vector retrieval check is deferred (would cost 5-10s per koreksi entry).
  const [rows] = await sequelize.query(
    `SELECT id FROM retrieval_chunks WHERE source_kind = 'knowledge_doc' AND source_ref_id = ? LIMIT 1`,
    { replacements: [kbRow.id] }
  );
  if (rows.length === 0) {
    return {
      kbId: kbRow.id,
      title: kbRow.title,
      passed: false,
      reason: 'retrieval_chunks row missing (KB entry exists but its embedding is gone)',
    };
  }
  return { kbId: kbRow.id, title: kbRow.title, passed: true };
}

async function runRegression() {
  const t0 = Date.now();
  const [patterns, kbRows] = await Promise.all([
    ChatErrorPattern.findAll({ where: { is_active: true } }),
    KnowledgeBase.findAll({ where: { category: 'koreksi', status: 'ready' } }),
  ]);

  const patternChecks = [];
  for (const p of patterns) {
    try {
      patternChecks.push(await checkPatternStillFires(p));
    } catch (e) {
      patternChecks.push({
        patternId: p.id,
        name: p.pattern_name,
        passed: false,
        reason: `check threw: ${e.message}`,
      });
    }
  }

  const kbChecks = [];
  for (const k of kbRows) {
    try {
      kbChecks.push(await checkKbStillRetrieves(k));
    } catch (e) {
      kbChecks.push({
        kbId: k.id,
        title: k.title,
        passed: false,
        reason: `check threw: ${e.message}`,
      });
    }
  }

  const allPassed = patternChecks.every((c) => c.passed) && kbChecks.every((c) => c.passed);
  return {
    ok: allPassed,
    patternChecks,
    kbChecks,
    durationMs: Date.now() - t0,
  };
}

module.exports = { runRegression, checkPatternStillFires, checkKbStillRetrieves };
