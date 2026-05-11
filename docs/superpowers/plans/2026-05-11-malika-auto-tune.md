# MALIKA Auto Tune — Agentic Remediation per Flag

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans / subagent-driven-development.

**Goal:** Add an "Auto Tune" button on each flag that launches a constrained Anthropic agentic loop to propose + commit a fix (pattern OR knowledge_base correction), gated by a regression test that protects existing patterns + KB entries from being broken.

**Architecture:** Backend endpoint receives an Auto Tune request, spawns a setImmediate background job that runs a max-8-step agentic loop using Anthropic Messages API with tool_use. The agent has 6 tools (read flag, search patterns, search KB, propose pattern, propose KB correction, run regression + commit). On regression pass, changes flip live. On regression fail, agent gets the failure list and can revise or abandon. All steps logged to a new `auto_tune_logs` table.

**Tech Stack:** Anthropic SDK (`@anthropic-ai/sdk`), Sequelize 6, Next.js 16. Bypasses the malika-llm-proxy (proxy is for chat streaming; tool-use needs multi-turn).

**Pre-flight:**
- Working dir: `/var/www/html/project-data-strategis`, branch `main`
- Backup before edit: `cp file file.backup`
- NO `Co-Authored-By` trailer
- Stage individual files (`git add <path>`, NEVER `-A`)
- Backend reload: `pm2 reload pds-backend --update-env`
- Admin requires build first: `cd backend/admin && npm run build && pm2 reload pds-admin --update-env`
- Tests at `backend/src/services/<area>/__tests__/<name>.test.js`
- Anthropic API key — check existing env vars first; reuse `ANTHROPIC_API_KEY` or `MALIKA_PROXY_ANTHROPIC_KEY` (look in `backend/.env`)

---

## File Structure

**Backend new files:**
- `backend/src/services/autoTune/agent.service.js` — agentic loop with Anthropic tool_use
- `backend/src/services/autoTune/tools.js` — 6 tool implementations (read_flag, search_patterns, search_kb, propose_pattern, propose_kb_correction, run_regression_and_commit)
- `backend/src/services/autoTune/regression.service.js` — pattern preserve + KB preserve checks
- `backend/src/services/autoTune/jobRunner.service.js` — background job state mgmt via app_settings
- `backend/src/controllers/autoTune.controller.js` — HTTP handlers
- `backend/src/routes/autoTune.routes.js` — route mounting
- `backend/src/models/AutoTuneLog.model.js` — audit log row

**Backend modifications:**
- `backend/app.js` — mount auto-tune routes
- `backend/src/models/ChatErrorPattern.model.js` — add `canonical_query` column (sequelize.sync will alter)
- `backend/server.js` — add `auto_tune_logs` model require

**Admin modifications:**
- `backend/admin/app/malika-analysis/page.tsx` — Auto Tune button on each flag + status modal

**Tests:**
- `backend/src/services/autoTune/__tests__/regression.service.test.js`
- `backend/src/services/autoTune/__tests__/tools.test.js`
- `backend/src/services/autoTune/__tests__/jobRunner.service.test.js`

**Docs/memory:**
- `docs/workspace/chat-pipeline.md` — Change Log
- `/root/.claude/projects/-var-www-html/memory/malika_analysis_loop_2026-05-11.md` — Auto Tune section
- `/root/.claude/projects/-var-www-html/memory/MEMORY.md` — pointer update

---

## Phase 1 — Schema + Models

### Task 1: AutoTuneLog model + canonical_query column

**Files:**
- Create: `backend/src/models/AutoTuneLog.model.js`
- Modify: `backend/src/models/ChatErrorPattern.model.js` (add `canonical_query`)
- Modify: `backend/server.js` (require new model so sequelize.sync creates the table)

**AutoTuneLog schema:**
```
id, flag_id (FK chat_message_flags), job_id (string),
model_used, total_input_tokens, total_output_tokens, cost_usd (decimal),
proposed_changes (LONGTEXT JSON),
regression_result (LONGTEXT JSON),
final_status (ENUM: 'queued', 'running', 'committed', 'abandoned', 'failed', 'regression_failed'),
abandon_reason (TEXT NULL),
tool_call_log (LONGTEXT JSON),
created_at, completed_at, duration_ms (INT NULL)
```

- [ ] **Step 1: Backup**

```bash
cp backend/src/models/ChatErrorPattern.model.js backend/src/models/ChatErrorPattern.model.js.backup
cp backend/server.js backend/server.js.backup
```

- [ ] **Step 2: Add `canonical_query` to ChatErrorPattern**

In `ChatErrorPattern.model.js`, add to the column definitions (sibling to `trigger_keywords`):

```js
canonical_query: {
  type: DataTypes.TEXT,
  allowNull: true,
  comment: 'Sample query that triggered this pattern at creation time, used by Auto Tune regression eval to verify the pattern still fires.',
},
```

- [ ] **Step 3: Create AutoTuneLog model**

Create `backend/src/models/AutoTuneLog.model.js`:

```js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const AutoTuneLog = sequelize.define('AutoTuneLog', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  flag_id: { type: DataTypes.INTEGER, allowNull: false },
  job_id: { type: DataTypes.STRING(64), allowNull: false, unique: true },
  model_used: { type: DataTypes.STRING(128), allowNull: true },
  total_input_tokens: { type: DataTypes.INTEGER, defaultValue: 0 },
  total_output_tokens: { type: DataTypes.INTEGER, defaultValue: 0 },
  cost_usd: { type: DataTypes.DECIMAL(10, 4), defaultValue: 0 },
  proposed_changes: {
    type: DataTypes.TEXT('long'),
    allowNull: true,
    get() {
      const raw = this.getDataValue('proposed_changes');
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    },
    set(val) { this.setDataValue('proposed_changes', val ? JSON.stringify(val) : null); },
  },
  regression_result: {
    type: DataTypes.TEXT('long'),
    allowNull: true,
    get() {
      const raw = this.getDataValue('regression_result');
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    },
    set(val) { this.setDataValue('regression_result', val ? JSON.stringify(val) : null); },
  },
  final_status: {
    type: DataTypes.ENUM('queued', 'running', 'committed', 'abandoned', 'failed', 'regression_failed'),
    defaultValue: 'queued',
  },
  abandon_reason: { type: DataTypes.TEXT, allowNull: true },
  tool_call_log: {
    type: DataTypes.TEXT('long'),
    allowNull: true,
    get() {
      const raw = this.getDataValue('tool_call_log');
      if (!raw) return [];
      try { return JSON.parse(raw); } catch { return []; }
    },
    set(val) { this.setDataValue('tool_call_log', val ? JSON.stringify(val) : null); },
  },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  completed_at: { type: DataTypes.DATE, allowNull: true },
  duration_ms: { type: DataTypes.INTEGER, allowNull: true },
}, {
  tableName: 'auto_tune_logs',
  timestamps: false,
});

module.exports = AutoTuneLog;
```

- [ ] **Step 4: Require model in server.js**

In `backend/server.js`, find the section "LOAD SEMUA MODEL SEBELUM SYNC" (around line 75-99). Add:

```js
require("./src/models/AutoTuneLog.model");
```

at the bottom of that block.

- [ ] **Step 5: Reload + verify table created**

```bash
pm2 reload pds-backend --update-env && sleep 6
cd backend && node -e "
require('dotenv').config({quiet:true});
const sequelize = require('./src/config/db');
sequelize.query('SHOW COLUMNS FROM auto_tune_logs').then(([rows]) => {
  console.log('auto_tune_logs columns:', rows.map(r => r.Field).join(', '));
  return sequelize.query(\"SHOW COLUMNS FROM chat_error_patterns LIKE 'canonical_query'\");
}).then(([rows]) => {
  console.log('canonical_query column present:', rows.length > 0);
  process.exit(0);
});" 2>&1 | tail -5
```

Expected:
- `auto_tune_logs columns: id, flag_id, job_id, model_used, ..., duration_ms`
- `canonical_query column present: true`

- [ ] **Step 6: Commit**

```bash
git add backend/src/models/AutoTuneLog.model.js backend/src/models/ChatErrorPattern.model.js backend/server.js
git commit -m "feat(auto-tune): add AutoTuneLog model + canonical_query column"
```

---

## Phase 2 — Regression Eval

### Task 2: Regression service

**Files:**
- Create: `backend/src/services/autoTune/regression.service.js`
- Test: `backend/src/services/autoTune/__tests__/regression.service.test.js`

**Behavior:** Two preservation checks, run together:
1. **Pattern preservation**: for every `is_active=true` pattern with a `canonical_query`, call `getPromptFixes(canonical_query)` AND/OR `checkQueryPattern(canonical_query)` and assert the pattern's `fix_content` (or special_handling pattern name) is in the result. Patterns without `canonical_query` (legacy) are skipped with a warning.
2. **KB preservation**: for every `koreksi` knowledge_base row, embed its title with xenova and call vector retrieval, assert the row's `source_ref_id=kb.id` is in top-10.

Returns `{ ok: boolean, patternChecks: [{patternId, name, passed, reason?}], kbChecks: [{kbId, title, passed, reason?}], durationMs }`.

- [ ] **Step 1: Test first**

Create `backend/src/services/autoTune/__tests__/regression.service.test.js`:

```js
const ChatErrorPattern = require('../../../models/ChatErrorPattern.model');
const KnowledgeBase = require('../../../models/KnowledgeBase.model');
const errorLearning = require('../../chat/errorLearning.service');

jest.mock('../../../models/ChatErrorPattern.model');
jest.mock('../../../models/KnowledgeBase.model');
jest.mock('../../chat/errorLearning.service');

const { runRegression } = require('../regression.service');

describe('runRegression', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('returns ok=true when every active pattern fires on its canonical_query', async () => {
    ChatErrorPattern.findAll = jest.fn().mockResolvedValue([
      { id: 1, pattern_name: 'P1', canonical_query: 'tpt 2024 halmahera', fix_type: 'add_to_prompt', fix_content: 'FIX_ONE_TEXT' },
      { id: 2, pattern_name: 'P2', canonical_query: 'inflasi ternate', fix_type: 'add_to_prompt', fix_content: 'FIX_TWO_TEXT' },
    ]);
    KnowledgeBase.findAll = jest.fn().mockResolvedValue([]);
    errorLearning.getPromptFixes = jest.fn().mockImplementation((q) => {
      if (q === 'tpt 2024 halmahera') return Promise.resolve(['FIX_ONE_TEXT']);
      if (q === 'inflasi ternate') return Promise.resolve(['FIX_TWO_TEXT']);
      return Promise.resolve([]);
    });
    errorLearning.checkQueryPattern = jest.fn().mockResolvedValue(null);

    const r = await runRegression();
    expect(r.ok).toBe(true);
    expect(r.patternChecks).toHaveLength(2);
    expect(r.patternChecks.every(c => c.passed)).toBe(true);
  });

  it('returns ok=false when a pattern no longer fires on its canonical_query', async () => {
    ChatErrorPattern.findAll = jest.fn().mockResolvedValue([
      { id: 1, pattern_name: 'P_broken', canonical_query: 'q1', fix_type: 'add_to_prompt', fix_content: 'BROKEN_FIX' },
    ]);
    KnowledgeBase.findAll = jest.fn().mockResolvedValue([]);
    errorLearning.getPromptFixes = jest.fn().mockResolvedValue([]);   // empty — broken
    errorLearning.checkQueryPattern = jest.fn().mockResolvedValue(null);

    const r = await runRegression();
    expect(r.ok).toBe(false);
    expect(r.patternChecks[0].passed).toBe(false);
    expect(r.patternChecks[0].reason).toBeTruthy();
  });

  it('skips patterns without canonical_query and includes a warning entry', async () => {
    ChatErrorPattern.findAll = jest.fn().mockResolvedValue([
      { id: 1, pattern_name: 'P_legacy', canonical_query: null, fix_content: 'X' },
    ]);
    KnowledgeBase.findAll = jest.fn().mockResolvedValue([]);
    errorLearning.getPromptFixes = jest.fn();
    errorLearning.checkQueryPattern = jest.fn();

    const r = await runRegression();
    expect(r.patternChecks[0].passed).toBe(true);
    expect(r.patternChecks[0].reason).toMatch(/no canonical_query/i);
    expect(errorLearning.getPromptFixes).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to fail**

```bash
cd backend && npx jest src/services/autoTune/__tests__/regression.service.test.js --no-coverage 2>&1 | tail -10
```

Expected: "Cannot find module '../regression.service'".

- [ ] **Step 3: Implement**

Create `backend/src/services/autoTune/regression.service.js`:

```js
'use strict';
/**
 * Auto Tune regression eval.
 *
 * Two checks run together; both must pass for proposed changes to commit:
 *   1. Pattern preservation — every active pattern with canonical_query still fires.
 *   2. KB preservation — every koreksi entry still retrieves in top-K on its title query.
 *
 * Designed to run AFTER proposed changes are staged in the DB (proposed pattern
 * inserted with is_active=true; proposed KB row inserted + indexed via xenova).
 * If regression fails, the caller is responsible for rolling back the staged
 * changes (delete pattern, delete KB row + retrieval_chunks row).
 */
const ChatErrorPattern = require('../../models/ChatErrorPattern.model');
const KnowledgeBase = require('../../models/KnowledgeBase.model');
const errorLearning = require('../chat/errorLearning.service');

const KB_RETRIEVAL_TOPK = 10;

async function checkPatternStillFires(pattern) {
  if (!pattern.canonical_query) {
    return { patternId: pattern.id, name: pattern.pattern_name, passed: true, reason: 'no canonical_query (legacy pattern, skipped)' };
  }
  const fixes = await errorLearning.getPromptFixes(pattern.canonical_query);
  const fixesArr = Array.isArray(fixes) ? fixes : [];
  // add_to_prompt patterns appear as raw fix_content
  if (pattern.fix_type === 'add_to_prompt' && fixesArr.includes(pattern.fix_content)) {
    return { patternId: pattern.id, name: pattern.pattern_name, passed: true };
  }
  // special_handling patterns: getPromptFixes ALSO surfaces them with a "[SPECIAL HANDLING — name]" prefix (per Task 7 wiring)
  const hasSpecialMarker = fixesArr.some((f) => typeof f === 'string' && f.includes(`[SPECIAL HANDLING — ${pattern.pattern_name}]`));
  if (pattern.fix_type === 'special_handling' && hasSpecialMarker) {
    return { patternId: pattern.id, name: pattern.pattern_name, passed: true };
  }
  // Fall back to direct checkQueryPattern lookup for special_handling
  if (pattern.fix_type === 'special_handling') {
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
  // We can't easily call the real retrieval service here without a known interface,
  // so we use the most direct check: confirm the retrieval_chunks row exists.
  // Top-K retrieval check is OPTIONAL and skipped in MVP (would require xenova + vector query);
  // existence check is sufficient to catch a delete-side regression.
  const sequelize = require('../../config/db');
  const [rows] = await sequelize.query(
    `SELECT id FROM retrieval_chunks WHERE source_kind='knowledge_doc' AND source_ref_id=? LIMIT 1`,
    { replacements: [kbRow.id] }
  );
  if (rows.length === 0) {
    return { kbId: kbRow.id, title: kbRow.title, passed: false, reason: 'retrieval_chunks row missing' };
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
      patternChecks.push({ patternId: p.id, name: p.pattern_name, passed: false, reason: `check threw: ${e.message}` });
    }
  }

  const kbChecks = [];
  for (const k of kbRows) {
    try {
      kbChecks.push(await checkKbStillRetrieves(k));
    } catch (e) {
      kbChecks.push({ kbId: k.id, title: k.title, passed: false, reason: `check threw: ${e.message}` });
    }
  }

  const allPassed = patternChecks.every(c => c.passed) && kbChecks.every(c => c.passed);
  return {
    ok: allPassed,
    patternChecks,
    kbChecks,
    durationMs: Date.now() - t0,
  };
}

module.exports = { runRegression, checkPatternStillFires, checkKbStillRetrieves };
```

- [ ] **Step 4: Run tests to pass**

```bash
cd backend && npx jest src/services/autoTune/__tests__/regression.service.test.js --no-coverage 2>&1 | tail -10
```

Expected: `Tests: 3 passed`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/autoTune/regression.service.js backend/src/services/autoTune/__tests__/regression.service.test.js
git commit -m "feat(auto-tune): regression service (pattern + KB preservation checks)"
```

---

## Phase 3 — Tools + Job Runner

### Task 3: Tool implementations + job runner

**Files:**
- Create: `backend/src/services/autoTune/tools.js`
- Create: `backend/src/services/autoTune/jobRunner.service.js`
- Test: `backend/src/services/autoTune/__tests__/tools.test.js`

**The 6 tools (called by the agent):**

1. `read_flag(flagId)` — returns `{ flag, thread_messages: [...last 4 messages], related_patterns_count }`
2. `search_existing_patterns({ keywords })` — returns top 5 active patterns matching any keyword
3. `search_knowledge_base({ query, limit=5 })` — queries retrieval_chunks via xenova, returns top results
4. `propose_pattern({ name, type, keywords, fix_type, fix_content, canonical_query })` — INSERT pattern with is_active=true (so regression checks include it), returns `{ ok, patternId, proposalId }`
5. `propose_kb_correction({ title, content })` — creates knowledge_base + retrieval_chunks via existing addToKnowledgeBase-style path
6. `run_regression_and_commit()` — calls `runRegression()`. If pass, return `{ ok: true, committed: true }`. If fail, rollback all this job's staged changes and return `{ ok: false, failures: [...], committed: false }`.

Also export `abandon({ reason })` — sets the job status to abandoned + clears staged changes.

Each tool takes `{ jobContext, args }` so the runner can track per-job state (which IDs were staged for rollback).

**Job runner state:** in-memory Map keyed by `jobId` → `{ flagId, stagedPatternIds: [], stagedKbIds: [], status, log: [] }`. Also written to `auto_tune_logs` row.

- [ ] **Step 1: Test (focus on the regression-and-rollback behavior of tools, NOT the LLM)**

Create `backend/src/services/autoTune/__tests__/tools.test.js`:

```js
const ChatMessageFlag = require('../../../models/ChatMessageFlag.model');
const ChatMessage = require('../../../models/ChatMessage.model');
const ChatErrorPattern = require('../../../models/ChatErrorPattern.model');

jest.mock('../../../models/ChatMessageFlag.model');
jest.mock('../../../models/ChatMessage.model');
jest.mock('../../../models/ChatErrorPattern.model');

const { createToolset } = require('../tools');

describe('Auto Tune tools', () => {
  let jobContext;

  beforeEach(() => {
    jest.clearAllMocks();
    jobContext = { jobId: 'test-job', flagId: 99, stagedPatternIds: [], stagedKbIds: [], log: [] };
  });

  it('read_flag returns flag + recent thread messages', async () => {
    ChatMessageFlag.findByPk = jest.fn().mockResolvedValue({
      id: 99, flag_type: 'hallucination', user_query: 'Q', assistant_response: 'A', thread_id: 5, context_snapshot: {},
    });
    ChatMessage.findAll = jest.fn().mockResolvedValue([{ role: 'user', content: 'hi' }]);
    const tools = createToolset(jobContext);
    const out = await tools.read_flag({});
    expect(out.flag).toEqual(expect.objectContaining({ id: 99, flag_type: 'hallucination' }));
    expect(out.thread_messages).toBeInstanceOf(Array);
  });

  it('propose_pattern stages with is_active=true and tracks id for rollback', async () => {
    ChatErrorPattern.create = jest.fn().mockResolvedValue({ id: 555 });
    const tools = createToolset(jobContext);
    const out = await tools.propose_pattern({
      name: 'T', type: 'query_pattern', keywords: ['x'],
      fix_type: 'add_to_prompt', fix_content: 'FIX', canonical_query: 'cq',
    });
    expect(out.ok).toBe(true);
    expect(out.patternId).toBe(555);
    expect(jobContext.stagedPatternIds).toEqual([555]);
    expect(ChatErrorPattern.create).toHaveBeenCalledWith(expect.objectContaining({ is_active: true }));
  });
});
```

- [ ] **Step 2: Run test to fail**

```bash
cd backend && npx jest src/services/autoTune/__tests__/tools.test.js --no-coverage 2>&1 | tail -10
```

Expected: "Cannot find module '../tools'".

- [ ] **Step 3: Implement tools.js**

Create `backend/src/services/autoTune/tools.js`:

```js
'use strict';
const ChatMessageFlag = require('../../models/ChatMessageFlag.model');
const ChatMessage = require('../../models/ChatMessage.model');
const ChatErrorPattern = require('../../models/ChatErrorPattern.model');
const KnowledgeBase = require('../../models/KnowledgeBase.model');
const sequelize = require('../../config/db');
const { Op } = require('sequelize');
const { runRegression } = require('./regression.service');

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
      jobContext.log.push({ tool: 'read_flag', ts: Date.now() });
      return {
        flag: {
          id: flag.id, flag_type: flag.flag_type, severity: flag.severity,
          user_query: flag.user_query, assistant_response: flag.assistant_response,
          context_snapshot: flag.context_snapshot, thread_id: flag.thread_id,
        },
        thread_messages: recent.reverse().map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 800) })),
      };
    },

    async search_existing_patterns({ keywords = [] }) {
      const kws = Array.isArray(keywords) ? keywords.slice(0, 10) : [];
      const patterns = await ChatErrorPattern.findAll({ where: { is_active: true }, limit: 100 });
      const hits = patterns.filter((p) => {
        const triggers = (p.trigger_keywords || []).map((k) => String(k).toLowerCase());
        return kws.some((kw) => triggers.includes(String(kw).toLowerCase()));
      }).slice(0, 5);
      jobContext.log.push({ tool: 'search_existing_patterns', keywords: kws, hits: hits.length, ts: Date.now() });
      return hits.map((p) => ({
        id: p.id, pattern_name: p.pattern_name, fix_type: p.fix_type,
        fix_content: String(p.fix_content || '').slice(0, 200),
        trigger_keywords: p.trigger_keywords, occurrence_count: p.occurrence_count,
      }));
    },

    async search_knowledge_base({ query, limit = 5 }) {
      const { embedQuery } = require('../bpsMetadata/embedding.service');
      const emb = await embedQuery(query);
      const [rows] = await sequelize.query(
        `SELECT rc.id AS rc_id, rc.source_ref_id AS kb_id, rc.title, rc.content_text,
                VEC_DISTANCE_COSINE(rc.embedding, VEC_FromText(?)) AS distance
         FROM retrieval_chunks rc
         WHERE rc.source_kind='knowledge_doc'
         ORDER BY distance ASC LIMIT ?`,
        { replacements: [JSON.stringify(emb), limit] }
      );
      jobContext.log.push({ tool: 'search_knowledge_base', query, hits: rows.length, ts: Date.now() });
      return rows.map((r) => ({
        kb_id: r.kb_id, title: r.title,
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
      jobContext.log.push({ tool: 'propose_pattern', patternId: pattern.id, name, ts: Date.now() });
      return { ok: true, patternId: pattern.id };
    },

    async propose_kb_correction({ title, content }) {
      const { upsertKnowledgeChunk } = (() => {
        // Resolve once and cache — handles whichever public API exists in knowledgeDoc.service.js
        const mod = require('../ai/knowledgeDoc.service');
        return { upsertKnowledgeChunk: mod.processEmbeddings || mod.upsertKnowledgeChunk };
      })();
      const kb = await KnowledgeBase.create({
        title, description: `Auto Tune correction for flag ${jobContext.flagId}`,
        category: 'koreksi', source_type: 'text',
        content, content_length: String(content || '').length, status: 'pending',
      });
      try {
        // processEmbeddings expects an array of ids
        await upsertKnowledgeChunk([kb.id]);
        await kb.reload();
        if (kb.status !== 'ready') {
          throw new Error(`KB indexing did not reach 'ready' (status=${kb.status})`);
        }
      } catch (e) {
        await kb.destroy().catch(() => {});
        throw new Error(`KB indexing failed: ${e.message}`);
      }
      jobContext.stagedKbIds.push(kb.id);
      jobContext.log.push({ tool: 'propose_kb_correction', kbId: kb.id, title, ts: Date.now() });
      return { ok: true, kbId: kb.id };
    },

    async run_regression_and_commit() {
      const regression = await runRegression();
      jobContext.log.push({ tool: 'run_regression_and_commit', ok: regression.ok, ts: Date.now() });

      if (regression.ok) {
        // Staged changes are already in DB with is_active=true / status=ready.
        // Mark them as the final committed state by leaving them in place.
        return { ok: true, committed: true, regression };
      }

      // ROLLBACK
      const failedPatternIds = regression.patternChecks.filter((c) => !c.passed).map((c) => c.patternId);
      const failedKbIds = regression.kbChecks.filter((c) => !c.passed).map((c) => c.kbId);

      // Remove ONLY this job's stagings
      for (const pid of jobContext.stagedPatternIds) {
        await ChatErrorPattern.destroy({ where: { id: pid } }).catch(() => {});
      }
      for (const kid of jobContext.stagedKbIds) {
        await sequelize.query('DELETE FROM retrieval_chunks WHERE source_kind=? AND source_ref_id=?',
          { replacements: ['knowledge_doc', kid] }).catch(() => {});
        await KnowledgeBase.destroy({ where: { id: kid } }).catch(() => {});
      }
      jobContext.stagedPatternIds = [];
      jobContext.stagedKbIds = [];

      return { ok: false, committed: false, regression, rolled_back_pattern_ids: failedPatternIds, rolled_back_kb_ids: failedKbIds };
    },

    async abandon({ reason }) {
      // Roll back any staged changes
      for (const pid of jobContext.stagedPatternIds) {
        await ChatErrorPattern.destroy({ where: { id: pid } }).catch(() => {});
      }
      for (const kid of jobContext.stagedKbIds) {
        await sequelize.query('DELETE FROM retrieval_chunks WHERE source_kind=? AND source_ref_id=?',
          { replacements: ['knowledge_doc', kid] }).catch(() => {});
        await KnowledgeBase.destroy({ where: { id: kid } }).catch(() => {});
      }
      jobContext.stagedPatternIds = [];
      jobContext.stagedKbIds = [];
      jobContext.log.push({ tool: 'abandon', reason, ts: Date.now() });
      return { ok: true, abandoned: true, reason };
    },
  };
}

module.exports = { createToolset };
```

- [ ] **Step 4: Run tests to pass**

```bash
cd backend && npx jest src/services/autoTune/__tests__/tools.test.js --no-coverage 2>&1 | tail -10
```

Expected: `Tests: 2 passed`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/autoTune/tools.js backend/src/services/autoTune/__tests__/tools.test.js
git commit -m "feat(auto-tune): tool implementations (read/search/propose/regression/abandon)"
```

---

## Phase 4 — Agentic Loop + HTTP

### Task 4: Anthropic agentic loop + jobRunner + controller + routes

**Files:**
- Create: `backend/src/services/autoTune/agent.service.js`
- Create: `backend/src/services/autoTune/jobRunner.service.js`
- Create: `backend/src/controllers/autoTune.controller.js`
- Create: `backend/src/routes/autoTune.routes.js`
- Modify: `backend/app.js` (mount routes)

**Anthropic SDK setup:**
- Check if `@anthropic-ai/sdk` is in `backend/package.json`. If not, `cd backend && npm install @anthropic-ai/sdk`.
- API key: look for `ANTHROPIC_API_KEY` in `backend/.env`. If absent but a different name exists (e.g. `MALIKA_PROXY_ANTHROPIC_KEY`), use that. If no key found at all, REPORT and STOP — do not invent.
- Model: `claude-sonnet-4-6` (or whatever the env has set; do not hardcode if there's an env var).

**Agentic loop architecture (`agent.service.js`):**

```js
async function runAgent({ jobId, flagId, model }) {
  const toolset = createToolset({ jobId, flagId, stagedPatternIds: [], stagedKbIds: [], log: [] });

  const initialFlag = await toolset.read_flag();

  const systemPrompt = `You are an Auto Tune agent for MALIKA — the Indonesian BPS (Badan Pusat Statistik) statistics chatbot for Maluku Utara province.

A user-facing chat response was flagged as bad. Your job: investigate the flag, propose a fix (add a pattern OR add a knowledge_base correction), then run regression to validate.

You can call up to 8 tool uses total. After staging your proposed changes, you MUST call run_regression_and_commit. If it fails, you may revise (max 1 retry) or abandon with a reason.

Available fix shapes:
- pattern with fix_type=add_to_prompt: text injected into chat system prompt when user query matches the trigger keywords
- pattern with fix_type=special_handling: text injected with [SPECIAL HANDLING] prefix for matched queries
- knowledge_base correction (category=koreksi): factual content indexed into retrieval_chunks; surfaces during similar queries

The flagged interaction:
${JSON.stringify(initialFlag, null, 2)}

If the flag is unfixable at the pattern/KB layer (e.g. requires code changes, missing data, ambiguous user intent), call abandon with a clear reason.

Output preferences:
- Indonesian language for fix_content (matches MALIKA's audience)
- Concise (under 280 chars per fix_content)
- Specific (avoid generic "give complete answers" without context)
`;

  const tools = [
    { name: 'search_existing_patterns', description: 'Find active patterns matching keywords. Avoid duplicating existing fixes.', input_schema: { type: 'object', properties: { keywords: { type: 'array', items: { type: 'string' }}}, required: ['keywords']}},
    { name: 'search_knowledge_base', description: 'Vector search the knowledge base for similar content.', input_schema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', default: 5 }}, required: ['query']}},
    { name: 'propose_pattern', description: 'Stage a new pattern. Will be subject to regression check.', input_schema: { type: 'object', properties: { name: {type:'string'}, type: {type:'string', enum:['query_pattern','data_pattern','context_pattern','hallucination_pattern','prompt_issue']}, keywords: {type:'array',items:{type:'string'}}, fix_type: {type:'string', enum:['add_to_prompt','special_handling']}, fix_content: {type:'string'}, canonical_query: {type:'string'}}, required: ['name','type','keywords','fix_type','fix_content','canonical_query']}},
    { name: 'propose_kb_correction', description: 'Stage a knowledge_base correction (koreksi). Will be indexed via xenova.', input_schema: { type: 'object', properties: { title: {type:'string'}, content: {type:'string'}}, required: ['title','content']}},
    { name: 'run_regression_and_commit', description: 'Run regression on staged changes. Commits if pass, rolls back if fail.', input_schema: { type: 'object', properties: {}}},
    { name: 'abandon', description: 'Give up and escalate to human review.', input_schema: { type: 'object', properties: { reason: {type:'string'}}, required: ['reason']}},
  ];

  const Anthropic = require('@anthropic-ai/sdk').default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || process.env.MALIKA_PROXY_ANTHROPIC_KEY });

  let messages = [{ role: 'user', content: 'Investigate this flag and apply a fix using the available tools.' }];
  let totalInput = 0, totalOutput = 0;
  let finalResult = null;
  const MAX_STEPS = 8;

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await client.messages.create({
      model, max_tokens: 1024, system: systemPrompt, tools, messages,
    });
    totalInput += response.usage?.input_tokens || 0;
    totalOutput += response.usage?.output_tokens || 0;

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') {
      finalResult = { kind: 'no_tool', text: response.content.filter(b => b.type === 'text').map(b => b.text).join('\n') };
      break;
    }

    const toolUses = response.content.filter((b) => b.type === 'tool_use');
    const toolResults = [];
    for (const tu of toolUses) {
      const fn = toolset[tu.name];
      if (!fn) {
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: `Tool ${tu.name} not found`, is_error: true });
        continue;
      }
      try {
        const out = await fn(tu.input || {});
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out).slice(0, 8000) });
        if (tu.name === 'run_regression_and_commit' && out.committed) {
          finalResult = { kind: 'committed', result: out };
        }
        if (tu.name === 'abandon') {
          finalResult = { kind: 'abandoned', reason: tu.input?.reason };
        }
      } catch (e) {
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: `Error: ${e.message}`, is_error: true });
      }
    }
    messages.push({ role: 'user', content: toolResults });
    if (finalResult) break;
  }

  if (!finalResult) {
    // Max steps exceeded — force abandon
    await toolset.abandon({ reason: 'max steps exceeded' });
    finalResult = { kind: 'abandoned', reason: 'max steps exceeded' };
  }

  return {
    finalResult,
    totalInput, totalOutput,
    toolLog: toolset && toolset.read_flag.jobContext?.log,   // not reliable; we'll capture differently
    stagedPatternIds: [],
    stagedKbIds: [],
  };
}

module.exports = { runAgent };
```

(Note: capturing `toolLog` from inside the toolset closure is tricky. Adjust by exposing `jobContext` from `createToolset` directly — modify `tools.js` to return `{ toolset, jobContext }` or accept a passed-in `jobContext`. Pick whichever is cleaner; just don't lose the log.)

**JobRunner (`jobRunner.service.js`):**

```js
'use strict';
const crypto = require('crypto');
const AutoTuneLog = require('../../models/AutoTuneLog.model');
const ChatMessageFlag = require('../../models/ChatMessageFlag.model');

const _jobs = new Map();   // jobId -> { status, startedAt, result?, error? }

async function startAutoTuneJob({ flagId }) {
  const jobId = crypto.randomBytes(8).toString('hex');
  _jobs.set(jobId, { status: 'queued', startedAt: Date.now(), flagId });

  const logRow = await AutoTuneLog.create({
    job_id: jobId, flag_id: flagId, final_status: 'queued',
  });

  setImmediate(async () => {
    const job = _jobs.get(jobId);
    job.status = 'running';
    await logRow.update({ final_status: 'running' });
    try {
      const { runAgent } = require('./agent.service');
      const model = process.env.AUTO_TUNE_MODEL || 'claude-sonnet-4-6';
      const result = await runAgent({ jobId, flagId, model });
      const status = result.finalResult.kind === 'committed' ? 'committed'
                  : result.finalResult.kind === 'abandoned' ? 'abandoned' : 'failed';
      job.status = status;
      job.result = result;
      await logRow.update({
        final_status: status,
        model_used: model,
        total_input_tokens: result.totalInput,
        total_output_tokens: result.totalOutput,
        proposed_changes: result.finalResult,
        regression_result: result.finalResult?.result?.regression || null,
        tool_call_log: result.toolLog || [],
        abandon_reason: result.finalResult?.reason || null,
        completed_at: new Date(),
        duration_ms: Date.now() - job.startedAt,
      });
      // If committed AND we proposed something, mark flag resolved
      if (status === 'committed') {
        await ChatMessageFlag.update(
          { resolution_status: 'training_added', resolved_at: new Date() },
          { where: { id: flagId } }
        );
      }
    } catch (e) {
      job.status = 'failed';
      job.error = e.message;
      await logRow.update({ final_status: 'failed', abandon_reason: e.message, completed_at: new Date(), duration_ms: Date.now() - job.startedAt });
    }
  });

  return { jobId, status: 'queued' };
}

async function getJobStatus(jobId) {
  const job = _jobs.get(jobId);
  if (job) return job;
  // Fall back to DB
  const row = await AutoTuneLog.findOne({ where: { job_id: jobId } });
  if (!row) return null;
  return { status: row.final_status, flagId: row.flag_id, durationMs: row.duration_ms, finishedAt: row.completed_at };
}

module.exports = { startAutoTuneJob, getJobStatus };
```

**Controller + routes:**

`backend/src/controllers/autoTune.controller.js`:

```js
const { startAutoTuneJob, getJobStatus } = require('../services/autoTune/jobRunner.service');

async function startJob(req, res) {
  try {
    const flagId = parseInt(req.params.id, 10);
    if (!flagId) return res.status(400).json({ ok: false, error: 'flag id required' });
    const result = await startAutoTuneJob({ flagId });
    return res.json({ ok: true, ...result });
  } catch (error) {
    console.error('[AutoTune] startJob error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}

async function status(req, res) {
  try {
    const jobId = req.params.jobId;
    const result = await getJobStatus(jobId);
    if (!result) return res.status(404).json({ ok: false, error: 'job not found' });
    return res.json({ ok: true, job: result });
  } catch (error) {
    console.error('[AutoTune] status error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}

module.exports = { startJob, status };
```

`backend/src/routes/autoTune.routes.js`:

```js
const express = require('express');
const router = express.Router();
const { authMiddleware, requireAdmin } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/autoTune.controller');

router.post('/flags/:id/auto-tune', authMiddleware, requireAdmin, ctrl.startJob);
router.get('/auto-tune/:jobId', authMiddleware, requireAdmin, ctrl.status);

module.exports = router;
```

Mount in `backend/app.js` near the existing `/error-learning` mount:

```js
app.use('/error-learning', chatLimiter, errorLearningRoutes);
app.use('/error-learning', authMiddleware, requireAdmin, require('./src/routes/autoTune.routes'));   // OR mount separately
```

Actually cleaner: mount `auto-tune` routes under `/error-learning` so the URLs are `POST /error-learning/flags/:id/auto-tune` and `GET /error-learning/auto-tune/:jobId`. Adapt route prefixes accordingly — the routes file declares them without a prefix, so just register at the right base path.

- [ ] **Step 1: Check Anthropic SDK availability**

```bash
grep '"@anthropic-ai/sdk"' backend/package.json
ls backend/node_modules/@anthropic-ai/sdk 2>/dev/null | head -2
```

If installed → proceed. If NOT → `cd backend && npm install @anthropic-ai/sdk` (do NOT update `package-lock.json` aggressively — use `--save`).

Check env:

```bash
grep -E '^(ANTHROPIC_API_KEY|MALIKA_PROXY_ANTHROPIC_KEY|AUTO_TUNE_MODEL)' backend/.env | head -3
```

If no Anthropic key in `.env` → REPORT and STOP. Ask user for key placement.

- [ ] **Step 2: Create agent + jobRunner + controller + routes**

Use the code from this task body. Adapt the toolset return shape to expose `jobContext` so agent.service can read the log.

- [ ] **Step 3: Mount routes in app.js**

Use Edit on `backend/app.js`. Find the existing `errorLearningRoutes` mount, add the new routes right after.

- [ ] **Step 4: Reload + verify endpoint responds**

```bash
pm2 reload pds-backend --update-env && sleep 5
JWT=$(cd backend && node -e "require('dotenv').config({quiet:true});console.log(require('jsonwebtoken').sign({id:1,email:'admin@bps.go.id',role:'admin'},process.env.JWT_SECRET,{expiresIn:'10m'}))" 2>/dev/null)
curl -sw "\nHTTP=%{http_code}\n" -X POST -H "Authorization: Bearer $JWT" "http://127.0.0.1:5000/error-learning/flags/9999999/auto-tune"
```

Expected: HTTP 200 with `{ok:true, jobId:"...", status:"queued"}` OR HTTP 500 with a meaningful error (e.g. "flag not found"). NOT a 404 — that would mean the route isn't wired.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/autoTune/agent.service.js backend/src/services/autoTune/jobRunner.service.js backend/src/controllers/autoTune.controller.js backend/src/routes/autoTune.routes.js backend/app.js
git commit -m "feat(auto-tune): agentic loop + job runner + HTTP endpoints"
```

---

### Task 5: Live agentic smoke (real Anthropic call against an existing flag)

This is a REAL end-to-end smoke that costs ~$0.05-0.20 in Anthropic API spend. Acceptable for one validation pass.

- [ ] **Step 1: Pick a low-risk pending flag**

```bash
JWT=$(cd backend && node -e "require('dotenv').config({quiet:true});console.log(require('jsonwebtoken').sign({id:1,email:'admin@bps.go.id',role:'admin'},process.env.JWT_SECRET,{expiresIn:'10m'}))" 2>/dev/null)
curl -s -H "Authorization: Bearer $JWT" "http://127.0.0.1:5000/error-learning/flags?status=pending&limit=1" | python3 -c "import json,sys;f=json.load(sys.stdin)['flags'][0];print('id=%d type=%s severity=%s' % (f['id'], f['flag_type'], f['severity']))"
```

Pick the printed flag id for the test.

- [ ] **Step 2: Trigger Auto Tune**

```bash
FLAG_ID=<id from step 1>
curl -sw "\nHTTP=%{http_code}\n" -X POST -H "Authorization: Bearer $JWT" "http://127.0.0.1:5000/error-learning/flags/$FLAG_ID/auto-tune"
```

Expected: `{ok:true, jobId:"<hex>", status:"queued"}`.

- [ ] **Step 3: Poll job status (up to 90s)**

```bash
JOB_ID=<jobId from step 2>
for i in 1 2 3 4 5 6 7 8 9; do
  sleep 10
  curl -s -H "Authorization: Bearer $JWT" "http://127.0.0.1:5000/error-learning/auto-tune/$JOB_ID" | python3 -c "import json,sys;d=json.load(sys.stdin);print('iter='+'$i'+' status='+d['job']['status'])"
  curl -s -H "Authorization: Bearer $JWT" "http://127.0.0.1:5000/error-learning/auto-tune/$JOB_ID" | python3 -c "import json,sys;d=json.load(sys.stdin);exit(0 if d['job']['status'] in ('committed','abandoned','failed') else 1)" && break
done
```

Expected: status transitions queued → running → (committed | abandoned | failed) within ~90s.

- [ ] **Step 4: Inspect the audit log**

```bash
cd backend && node -e "
require('dotenv').config({quiet:true});
const sequelize = require('./src/config/db');
sequelize.query(\"SELECT id, flag_id, final_status, model_used, total_input_tokens, total_output_tokens, duration_ms, abandon_reason FROM auto_tune_logs ORDER BY id DESC LIMIT 1\").then(([rows]) => {
  console.log(rows[0]);
  process.exit(0);
});" 2>&1 | tail -3
```

- [ ] **Step 5: Report what happened**

The agent's behavior is non-deterministic. Document:
- final_status (committed / abandoned / regression_failed / failed)
- If committed: which pattern / KB row was created (id, name)
- If abandoned: the reason
- Token usage + duration

If committed AND the result looks reasonable → leave it. If looks unreasonable → manually delete the created pattern/KB row and toggle the flag back to pending.

No commit for Task 5 — it's verification.

---

## Phase 5 — UI + Final

### Task 6: Auto Tune button in admin UI

**Files:**
- Modify: `backend/admin/app/malika-analysis/page.tsx`

**UX:**
- Add a small "Auto Tune" button next to the "View" button on each flag row (or in the flag detail modal, alongside the existing Promote-equivalent buttons)
- Clicking it POSTs `/error-learning/flags/:id/auto-tune`, opens a small status overlay that polls `/error-learning/auto-tune/:jobId` every 3s
- Status overlay shows: jobId, current status, elapsed time
- On terminal status (committed/abandoned/failed): displays the result + refreshes flags list

- [ ] **Step 1: Add state + functions**

In `page.tsx`, after the existing state declarations, add:

```tsx
const [autoTuneJob, setAutoTuneJob] = useState<{ jobId: string; flagId: number; status: string; startedAt: number } | null>(null);

const triggerAutoTune = useCallback(async (flagId: number) => {
  try {
    const res = await api.post(`/error-learning/flags/${flagId}/auto-tune`);
    if (!res.data?.ok) throw new Error(res.data?.error || 'failed');
    setAutoTuneJob({ jobId: res.data.jobId, flagId, status: 'queued', startedAt: Date.now() });
  } catch (e) {
    setError(getErrorMessage(e, 'Auto Tune failed to start'));
  }
}, []);

useEffect(() => {
  if (!autoTuneJob) return;
  if (['committed', 'abandoned', 'failed', 'regression_failed'].includes(autoTuneJob.status)) return;
  const t = setInterval(async () => {
    try {
      const res = await api.get(`/error-learning/auto-tune/${autoTuneJob.jobId}`);
      const status = res.data?.job?.status;
      if (status) setAutoTuneJob((j) => j ? { ...j, status } : j);
      if (['committed', 'abandoned', 'failed', 'regression_failed'].includes(status)) {
        clearInterval(t);
        await Promise.all([fetchFlags(), fetchStats(), fetchPatterns(), fetchAnalysis()]);
      }
    } catch (e) { /* keep polling */ }
  }, 3000);
  return () => clearInterval(t);
}, [autoTuneJob, fetchFlags, fetchStats, fetchPatterns, fetchAnalysis]);
```

- [ ] **Step 2: Add the button to the flags table row**

In the flags table tbody, find the existing `<button onClick={() => setSelectedFlag(flag)}>View</button>` cell. Add the Auto Tune button next to it:

```tsx
<td className="px-4 py-3">
  <div className="flex items-center gap-2">
    <button
      onClick={() => setSelectedFlag(flag)}
      className="text-blue-600 hover:text-blue-800 dark:text-blue-400 text-sm"
    >
      View
    </button>
    <button
      onClick={() => triggerAutoTune(flag.id)}
      disabled={Boolean(autoTuneJob) && autoTuneJob.flagId === flag.id && !['committed','abandoned','failed','regression_failed'].includes(autoTuneJob.status)}
      className="text-purple-600 hover:text-purple-800 dark:text-purple-400 text-sm disabled:opacity-40"
      title="Run Auto Tune agent on this flag"
    >
      Auto Tune
    </button>
  </div>
</td>
```

- [ ] **Step 3: Add the status overlay**

At the BOTTOM of the file, after the Promote Pattern Modal, append:

```tsx
{autoTuneJob && (
  <div className="fixed bottom-6 right-6 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 p-4 max-w-sm z-50">
    <div className="flex items-start justify-between gap-3 mb-2">
      <div>
        <div className="text-sm font-medium">Auto Tune — flag #{autoTuneJob.flagId}</div>
        <div className="text-xs text-gray-500">job {autoTuneJob.jobId.slice(0, 8)}…</div>
      </div>
      <button onClick={() => setAutoTuneJob(null)} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
    </div>
    <div className="flex items-center gap-2 text-xs">
      <span className={`px-2 py-0.5 rounded font-medium ${
        autoTuneJob.status === 'committed' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' :
        autoTuneJob.status === 'abandoned' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' :
        ['failed','regression_failed'].includes(autoTuneJob.status) ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' :
        'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
      }`}>{autoTuneJob.status}</span>
      <span className="text-gray-500">{Math.floor((Date.now() - autoTuneJob.startedAt) / 1000)}s</span>
    </div>
  </div>
)}
```

- [ ] **Step 4: TypeScript check + build + reload**

```bash
cd backend/admin && npx tsc --noEmit 2>&1 | grep -E "malika-analysis|error TS" | head -10
cd backend/admin && npm run build 2>&1 | tail -5
pm2 reload pds-admin --update-env && sleep 5
```

- [ ] **Step 5: Manual UI verify**

Open `/backend/malika-analysis` → Flags tab. Each row has an "Auto Tune" button. Click on one. Overlay appears bottom-right. Wait ~30-90s for terminal status.

- [ ] **Step 6: Commit**

```bash
git add backend/admin/app/malika-analysis/page.tsx
git commit -m "feat(malika-analysis): Auto Tune button per flag + status overlay"
```

---

### Task 7: Docs + memory

**Files:**
- Modify: `docs/workspace/chat-pipeline.md`
- Modify: `/root/.claude/projects/-var-www-html/memory/malika_analysis_loop_2026-05-11.md`
- Modify: `/root/.claude/projects/-var-www-html/memory/MEMORY.md`

- [ ] **Step 1: Append Change Log row to chat-pipeline.md**

```
| 2026-05-11 | MALIKA Auto Tune (agentic remediation per flag): admin clicks "Auto Tune" on a flag → backend kicks off background job → Anthropic agentic loop (max 8 tool_use steps) with 6 constrained tools (read_flag/search_existing_patterns/search_knowledge_base/propose_pattern/propose_kb_correction/run_regression_and_commit/abandon) → regression eval gates commit (every active pattern still fires on its canonical_query; every koreksi entry still has retrieval_chunks row) → on regression pass, changes commit and flag auto-resolves to training_added; on regression fail, staged changes rolled back and agent can revise once or abandon. New `auto_tune_logs` audit table tracks every attempt with token usage, cost, tool_call_log, regression_result. New `canonical_query` column on chat_error_patterns. Plan: `docs/superpowers/plans/2026-05-11-malika-auto-tune.md` | `backend/src/services/autoTune/{agent,jobRunner,regression,tools}.service.js`, `backend/src/controllers/autoTune.controller.js`, `backend/src/routes/autoTune.routes.js`, `backend/src/models/{AutoTuneLog,ChatErrorPattern}.model.js`, `backend/admin/app/malika-analysis/page.tsx`, `backend/app.js` |
```

- [ ] **Step 2: Append Auto Tune section to memory file**

After the "Tuning automation" section in `malika_analysis_loop_2026-05-11.md`:

```markdown
## Auto Tune — agentic remediation (2026-05-11 deep evening)

**What it does:** Admin clicks "Auto Tune" on a flag → 30-90s later, the flag is either resolved with an auto-proposed pattern/KB correction (regression-validated) OR abandoned with a reason.

**Tool surface (6 tools, max 8 calls per job):**
1. `read_flag` — flag + last 4 thread messages + context_snapshot
2. `search_existing_patterns({keywords})` — find duplicates before proposing
3. `search_knowledge_base({query})` — xenova retrieval against retrieval_chunks
4. `propose_pattern({...})` — INSERTs with is_active=true (subject to regression)
5. `propose_kb_correction({title,content})` — creates KB + retrieval_chunks via processEmbeddings
6. `run_regression_and_commit()` — runs regression; commits or rolls back
7. `abandon({reason})` — escalates to human; rolls back any staged changes

**Regression eval (`regression.service.js`):**
- Pattern preservation: every `is_active=true` pattern with `canonical_query` is replayed via `getPromptFixes()` / `checkQueryPattern()`; assert each pattern still fires
- KB preservation: every koreksi entry has its `retrieval_chunks` row checked (existence-only in MVP; full top-K retrieval check deferred)

**Audit:** `auto_tune_logs` table. Schema includes `final_status`, `proposed_changes`, `regression_result`, `tool_call_log`, `total_input_tokens`, `total_output_tokens`, `duration_ms`, `abandon_reason`.

**Cost guard:** Per-job max 8 tool steps, force-abandon at step 9. Per-job typical cost: $0.05-0.20 (Anthropic Sonnet).

**Gotchas:**
- `canonical_query` was added to `chat_error_patterns` 2026-05-11; existing rows have NULL — regression treats those as "skip with warning" rather than failing.
- KB regression in MVP is existence-only (checks retrieval_chunks row exists). True top-K retrieval check would require running xenova on every koreksi title — deferred to avoid 5-10s regression overhead per Auto Tune job.
- Anthropic API is called DIRECTLY (not via malika-llm-proxy) because tool_use needs multi-turn message exchange the chat proxy doesn't support.
- If regression fails and agent doesn't get a clean fix on retry, status becomes `regression_failed` (NOT `committed`); flag stays pending.

**Reset / kill switch:** No special toggle yet. Disable by removing the route mount in `app.js` (line near `/error-learning/auto-tune`) and reloading backend. The cron-style schedulers from Task 4/Level C are unaffected.
```

- [ ] **Step 3: Update MEMORY.md pointer**

```
- [MALIKA analysis loop (2026-05-11)](malika_analysis_loop_2026-05-11.md) — `/backend/malika-analysis` audit fixes + loop closure (auto-flag, special_handling, xenova corrections, PWA Laporkan) + tuning (cluster drafts, auto-retire ≥90d at 06:45 WIT) + Auto Tune agentic remediation (Anthropic tool_use loop with regression gate). **DONE 2026-05-11**.
```

- [ ] **Step 4: Commit**

```bash
git add docs/workspace/chat-pipeline.md
git commit -m "docs: record Auto Tune agentic remediation feature"
```

---

## Self-Review

- ✅ Schema: AutoTuneLog model + canonical_query column → Task 1
- ✅ Regression eval: pattern preserve + KB preserve → Task 2
- ✅ Tools (6 of them): read_flag, search_*, propose_*, run_regression_and_commit, abandon → Task 3
- ✅ Agentic loop + job runner + HTTP → Task 4
- ✅ Live agentic smoke (one real Anthropic call) → Task 5
- ✅ UI button + status overlay → Task 6
- ✅ Docs + memory → Task 7

**Placeholder scan:** All code blocks contain runnable code. The agent.service.js `toolLog` capture line is flagged with a comment; implementer must wire it cleanly (return jobContext from createToolset).

**Risk flags:**
- Anthropic key availability is the biggest blocker. Task 4 Step 1 MUST stop and ask if no key found.
- HNSW index lag (per Task 12 of prior plan): KB regression check is existence-only. A "true" retrieval check would catch new KB entries that don't surface in indexed query until reorg. MVP scope chose existence; flag this in docs.
- The first real agentic call (Task 5 Step 2) will spend ~$0.05-0.20. If you want to dry-run instead, mock the Anthropic client; but for actual proof-of-life, a real call is the only meaningful smoke.
