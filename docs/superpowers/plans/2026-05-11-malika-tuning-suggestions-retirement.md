# MALIKA Tuning — Assisted Suggestions + Auto-Retirement

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans / subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Close the tuning loop on `/backend/malika-analysis` so admins get pre-drafted pattern suggestions from flag clusters (Level A) and stale patterns auto-retire after 90 days idle (Level C). Builds on the 13-commit loop closure from the same day.

**Architecture:** Phase 1 extends `analyzeFlags()` to compose draft patterns with fix-content templates keyed to `flag_type`, surfaces them in the admin Analytics tab, and adds a one-click promote modal. Phase 2 adds a daily WIT-aware scheduler that deactivates patterns where `last_occurrence_at < NOW() - 90 DAY AND occurrence_count < 5 AND is_active=true`. Phase 3 verifies + documents.

**Tech Stack:** Same as parent — Express 5 + Sequelize 6, Next.js 16 admin, MariaDB, Jest. No new dependencies.

**Pre-flight:**
- Working dir: `/var/www/html/project-data-strategis`, branch `main`
- Backup before edit: `cp file file.backup`
- NO `Co-Authored-By` trailer
- Stage individual files (`git add <path>`, NEVER `-A`)
- Backend reload: `pm2 reload pds-backend --update-env`
- **Admin reload requires build**: `cd backend/admin && npm run build && pm2 reload pds-admin --update-env` (per CLAUDE.md, learned 2026-05-11)

---

## File Structure

**Backend modifications:**
- `backend/src/services/chat/errorLearning.service.js` — extend `analyzeFlags()` to emit draft patterns
- `backend/src/controllers/errorLearning.controller.js` — `analyzeFlags` handler already exists, wraps the service output as-is

**Backend new file:**
- `backend/src/services/chat/patternRetirement.service.js` — `retireStalePatterns()` + `startPatternRetirementScheduler()`

**Backend wiring:**
- `backend/server.js` — add `pattern-retirement` slot to scheduler bootstrap array

**Admin modifications:**
- `backend/admin/app/malika-analysis/page.tsx` — Analytics tab gets a "Suggestions" section + Promote modal

**Tests:**
- `backend/src/services/chat/__tests__/errorLearning.service.test.js` — append draft-pattern composition tests
- `backend/src/services/chat/__tests__/patternRetirement.service.test.js` — new

**Docs/memory:**
- `docs/workspace/chat-pipeline.md` — Change Log row
- `/root/.claude/projects/-var-www-html/memory/malika_analysis_loop_2026-05-11.md` — append tuning section
- `/root/.claude/projects/-var-www-html/memory/MEMORY.md` — pointer line update

---

## Phase 1 — Assisted Suggestions (Level A)

### Task 1: Extend `analyzeFlags()` to compose draft patterns

**Files:**
- Modify: `backend/src/services/chat/errorLearning.service.js:155-205`
- Test: `backend/src/services/chat/__tests__/errorLearning.service.test.js` (append)

**Background:** `analyzeFlags()` already returns `{ ok: true, totalPending, byType: { hallucination: { count, topKeywords, sampleQueries }, ... } }`. Extend each cluster with a `suggestedDraft` object the UI can render directly.

**Draft composition rules — keyed by `flag_type`:**

| flag_type | fix_type | fix_content template |
|---|---|---|
| `hallucination` | `add_to_prompt` | `"JANGAN mengarang data. Jika data tidak tersedia untuk pertanyaan ini, katakan eksplisit: 'Data tersebut belum tersedia di sistem MALIKA.'"` |
| `incomplete` | `add_to_prompt` | `"Berikan jawaban LENGKAP: data spesifik dengan angka, periode/tahun, dan sumber. Hindari jawaban satu baris."` |
| `context_lost` | `special_handling` | `"Pengguna sedang melanjutkan diskusi sebelumnya. Tetap fokus pada topik yang sama dan jangan ganti subjek."` |
| `irrelevant` | `special_handling` | `"Pertanyaan ini tidak terkait dengan lingkup MALIKA (statistik BPS Maluku Utara). Arahkan pengguna ke topik yang relevan."` |
| `wrong_data` / `wrong_source` | `(no draft — needs correction_text)` | UI shows "Use Add to Knowledge for this flag type" instead |
| `formatting_issue` / `other` | `(no draft)` | UI shows "Manual review recommended" |

A draft is omitted when (a) cluster size < 2 OR (b) flag_type is in the no-draft set.

**Pattern name auto-suggestion:** `"Auto: <flag_type> cluster — '<top_keyword>'"`

- [ ] **Step 1: Backup**

```bash
cp backend/src/services/chat/errorLearning.service.js backend/src/services/chat/errorLearning.service.js.backup
```

- [ ] **Step 2: Append failing test**

Add to `backend/src/services/chat/__tests__/errorLearning.service.test.js`:

```js
describe('analyzeFlags draft suggestions', () => {
  beforeEach(() => {
    ChatMessageFlag.findAll.mockResolvedValue([
      { flag_type: 'hallucination', user_query: 'berapa proyeksi penduduk halmahera 2024' },
      { flag_type: 'hallucination', user_query: 'proyeksi penduduk maluku utara' },
      { flag_type: 'hallucination', user_query: 'angka proyeksi penduduk ternate' },
      { flag_type: 'formatting_issue', user_query: 'kasih tabel rapi' },
      { flag_type: 'formatting_issue', user_query: 'tolong tabelnya' },
    ]);
  });

  it('emits suggestedDraft for flag types in the drafting set with ≥2 flags', async () => {
    const res = await errorLearningService.analyzeFlags();
    expect(res.byType.hallucination.suggestedDraft).toBeDefined();
    expect(res.byType.hallucination.suggestedDraft).toEqual(expect.objectContaining({
      pattern_name: expect.stringContaining('hallucination'),
      pattern_type: 'query_pattern',
      trigger_keywords: expect.any(Array),
      fix_type: 'add_to_prompt',
      fix_content: expect.stringContaining('JANGAN mengarang data'),
    }));
    // trigger_keywords should be drawn from topKeywords
    expect(res.byType.hallucination.suggestedDraft.trigger_keywords.length).toBeGreaterThan(0);
  });

  it('omits suggestedDraft for flag types without a template', async () => {
    const res = await errorLearningService.analyzeFlags();
    expect(res.byType.formatting_issue.suggestedDraft).toBeUndefined();
  });

  it('omits suggestedDraft for clusters smaller than 2', async () => {
    ChatMessageFlag.findAll.mockResolvedValueOnce([
      { flag_type: 'hallucination', user_query: 'only one flag' },
    ]);
    const res = await errorLearningService.analyzeFlags();
    expect(res.byType.hallucination.suggestedDraft).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd backend && npx jest src/services/chat/__tests__/errorLearning.service.test.js --no-coverage -t "draft suggestions" 2>&1 | tail -15
```

Expected: 3 tests failing on `expect(...suggestedDraft).toBeDefined()`.

- [ ] **Step 4: Implement draft composition**

In `errorLearning.service.js`, ABOVE the existing `analyzeFlags` function, add this helper:

```js
const DRAFT_TEMPLATES = {
  hallucination: {
    fix_type: 'add_to_prompt',
    fix_content: "JANGAN mengarang data. Jika data tidak tersedia untuk pertanyaan ini, katakan eksplisit: 'Data tersebut belum tersedia di sistem MALIKA.'",
  },
  incomplete: {
    fix_type: 'add_to_prompt',
    fix_content: "Berikan jawaban LENGKAP: data spesifik dengan angka, periode/tahun, dan sumber. Hindari jawaban satu baris.",
  },
  context_lost: {
    fix_type: 'special_handling',
    fix_content: "Pengguna sedang melanjutkan diskusi sebelumnya. Tetap fokus pada topik yang sama dan jangan ganti subjek.",
  },
  irrelevant: {
    fix_type: 'special_handling',
    fix_content: "Pertanyaan ini tidak terkait dengan lingkup MALIKA (statistik BPS Maluku Utara). Arahkan pengguna ke topik yang relevan.",
  },
};

const MIN_CLUSTER_SIZE_FOR_DRAFT = 2;

function composeDraftPattern(flagType, cluster) {
  const template = DRAFT_TEMPLATES[flagType];
  if (!template) return null;
  if (cluster.count < MIN_CLUSTER_SIZE_FOR_DRAFT) return null;
  const topKw = (cluster.topKeywords || []).slice(0, 6).map(k => k.word);
  if (topKw.length === 0) return null;
  return {
    pattern_name: `Auto: ${flagType} cluster — '${topKw[0]}'`,
    pattern_type: 'query_pattern',
    trigger_keywords: topKw,
    error_description: `Auto-generated draft from ${cluster.count} pending ${flagType} flags. Top keywords: ${topKw.slice(0,3).join(', ')}.`,
    fix_type: template.fix_type,
    fix_content: template.fix_content,
  };
}
```

Then modify the existing `analyzeFlags()` function. Find the loop that builds `analysis[type] = { count, topKeywords, sampleQueries }` and add the draft composition:

```js
analysis[type] = {
  count: typeFlags.length,
  topKeywords: topWords,
  sampleQueries: typeFlags.slice(0, 3).map(f => f.user_query),
};
const draft = composeDraftPattern(type, analysis[type]);
if (draft) analysis[type].suggestedDraft = draft;
```

- [ ] **Step 5: Run tests to verify pass**

```bash
cd backend && npx jest src/services/chat/__tests__/errorLearning.service.test.js --no-coverage 2>&1 | tail -10
```

Expected: all tests passing (5 prior + 3 new = 8 total or thereabouts).

- [ ] **Step 6: Live smoke**

```bash
pm2 reload pds-backend --update-env && sleep 3
JWT=$(cd backend && node -e "require('dotenv').config({quiet:true});console.log(require('jsonwebtoken').sign({id:1,email:'admin@bps.go.id',role:'admin'},process.env.JWT_SECRET,{expiresIn:'10m'}))" 2>/dev/null)
curl -s -H "Authorization: Bearer $JWT" "http://127.0.0.1:5000/error-learning/analyze" | python3 -m json.tool | head -40
```

Expected: JSON containing `byType.hallucination.suggestedDraft.{pattern_name, fix_type, fix_content, trigger_keywords}` with values populated.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/chat/errorLearning.service.js backend/src/services/chat/__tests__/errorLearning.service.test.js
git commit -m "feat(error-learning): compose draft patterns from flag clusters in analyzeFlags"
```

---

### Task 2: Surface suggestions in Analytics tab + Promote modal

**Files:**
- Modify: `backend/admin/app/malika-analysis/page.tsx`

**Behavior:**
- Analytics tab gets a new "Pattern Suggestions" section below "Most Triggered Patterns"
- Each cluster with a `suggestedDraft` renders a card: cluster size + top keywords (chips) + 3 sample queries (truncated) + "Promote to Pattern" button
- Clicking Promote opens a modal pre-filled with the draft fields (pattern_name, trigger_keywords, fix_type, fix_content, error_description); admin can edit any field before clicking "Create Pattern" (POSTs to `/error-learning/patterns`)
- After success: modal closes, fetchStats + fetchPatterns refresh

- [ ] **Step 1: Add state + analysis fetcher**

In `page.tsx`, after the existing `useState` lines (around line 91-95), add:

```tsx
type SuggestedDraft = {
  pattern_name: string;
  pattern_type: string;
  trigger_keywords: string[];
  error_description: string;
  fix_type: string;
  fix_content: string;
};

type AnalysisCluster = {
  count: number;
  topKeywords: { word: string; count: number }[];
  sampleQueries: (string | null)[];
  suggestedDraft?: SuggestedDraft;
};

type AnalysisResponse = {
  ok: boolean;
  totalPending: number;
  byType: Record<string, AnalysisCluster>;
};

const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
const [promoteDraft, setPromoteDraft] = useState<SuggestedDraft | null>(null);
```

- [ ] **Step 2: Add fetchAnalysis + wire it into the initial load**

After the existing `fetchStats` `useCallback` (around line 128-135), add:

```tsx
const fetchAnalysis = useCallback(async () => {
  try {
    const res = await api.get('/error-learning/analyze');
    setAnalysis(res.data);
  } catch (e) {
    console.warn('Analyze fetch failed:', e);
  }
}, []);
```

In the initial-load `useEffect` (around lines 138-146), update `Promise.all`:

```tsx
await Promise.all([fetchFlags(), fetchPatterns(), fetchStats(), fetchAnalysis()]);
```

Also update the dependency array to include `fetchAnalysis`.

- [ ] **Step 3: Render the Suggestions section in Analytics tab**

Find the Analytics tab's outer `{activeTab === "analytics" && stats && (...)}` block. After the "Top Patterns" panel (the one rendering `Most Triggered Patterns`), append:

```tsx
{/* Pattern Suggestions (auto-drafted from flag clusters) */}
{analysis && (
  <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
    <h3 className="font-medium mb-1">Pattern Suggestions</h3>
    <p className="text-xs text-gray-500 mb-4">
      Drafts auto-generated from pending flag clusters. Review and Promote to add as live patterns.
    </p>
    <div className="space-y-3">
      {Object.entries(analysis.byType)
        .filter(([, cluster]) => cluster.suggestedDraft)
        .sort(([, a], [, b]) => b.count - a.count)
        .map(([type, cluster]) => (
          <div key={type} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${FLAG_TYPE_COLORS[type] || ""}`}>{type}</span>
                  <span className="text-xs text-gray-500">{cluster.count} flag{cluster.count === 1 ? '' : 's'}</span>
                </div>
                <div className="text-sm font-medium mb-1">{cluster.suggestedDraft!.pattern_name}</div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {cluster.suggestedDraft!.trigger_keywords.slice(0, 6).map((kw) => (
                    <span key={kw} className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs">{kw}</span>
                  ))}
                </div>
                <details className="text-xs text-gray-500">
                  <summary className="cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">Sample queries ({cluster.sampleQueries.filter(Boolean).length})</summary>
                  <ul className="mt-1 pl-4 space-y-0.5">
                    {cluster.sampleQueries.filter((q): q is string => Boolean(q)).map((q, i) => (
                      <li key={i} className="truncate" title={q}>• {q.slice(0, 100)}{q.length > 100 ? '…' : ''}</li>
                    ))}
                  </ul>
                </details>
              </div>
              <button
                onClick={() => setPromoteDraft(cluster.suggestedDraft!)}
                className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700 whitespace-nowrap"
              >
                Promote
              </button>
            </div>
          </div>
        ))}
      {Object.values(analysis.byType).filter((c) => c.suggestedDraft).length === 0 && (
        <div className="text-sm text-gray-500 py-4 text-center">
          No flag clusters meet draft criteria (≥2 flags of a draftable type). Existing patterns may be covering things, or you may need to wait for more flag data.
        </div>
      )}
    </div>
  </div>
)}
```

- [ ] **Step 4: Render the Promote modal**

After the existing Flag Detail Modal (the `{selectedFlag && (...)}` block near the bottom of the file), append:

```tsx
{/* Promote Pattern Modal */}
{promoteDraft && (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
      <div className="p-6">
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-xl font-bold">Promote to Pattern</h2>
          <button onClick={() => setPromoteDraft(null)} className="text-gray-500 hover:text-gray-700 dark:text-gray-400">✕</button>
        </div>
        <p className="text-xs text-gray-500 mb-4">Review and edit before creating. This pattern will be active immediately.</p>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget as HTMLFormElement;
            const fd = new FormData(form);
            const keywordsRaw = String(fd.get('trigger_keywords') || '');
            const keywords = keywordsRaw.split(',').map(s => s.trim()).filter(Boolean);
            const body = {
              pattern_name: String(fd.get('pattern_name') || ''),
              pattern_type: String(fd.get('pattern_type') || 'query_pattern'),
              trigger_keywords: keywords,
              error_description: String(fd.get('error_description') || ''),
              fix_type: String(fd.get('fix_type') || ''),
              fix_content: String(fd.get('fix_content') || ''),
            };
            try {
              const res = await api.post('/error-learning/patterns', body);
              if (!res.data?.ok) throw new Error(res.data?.error || 'failed');
              await Promise.all([fetchPatterns(), fetchAnalysis(), fetchStats()]);
              setPromoteDraft(null);
            } catch (e) {
              setError(getErrorMessage(e, "Failed to create pattern"));
            }
          }}
          className="space-y-3"
        >
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Pattern Name</label>
            <input name="pattern_name" defaultValue={promoteDraft.pattern_name} required
              className="w-full border rounded p-2 text-sm dark:bg-gray-900 dark:border-gray-700" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Pattern Type</label>
            <select name="pattern_type" defaultValue={promoteDraft.pattern_type}
              className="w-full border rounded p-2 text-sm dark:bg-gray-900 dark:border-gray-700">
              <option value="query_pattern">query_pattern</option>
              <option value="data_pattern">data_pattern</option>
              <option value="context_pattern">context_pattern</option>
              <option value="hallucination_pattern">hallucination_pattern</option>
              <option value="prompt_issue">prompt_issue</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Trigger Keywords (comma-separated)</label>
            <input name="trigger_keywords" defaultValue={promoteDraft.trigger_keywords.join(', ')} required
              className="w-full border rounded p-2 text-sm dark:bg-gray-900 dark:border-gray-700" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Error Description</label>
            <textarea name="error_description" defaultValue={promoteDraft.error_description} rows={2} required
              className="w-full border rounded p-2 text-sm dark:bg-gray-900 dark:border-gray-700" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Fix Type</label>
            <select name="fix_type" defaultValue={promoteDraft.fix_type}
              className="w-full border rounded p-2 text-sm dark:bg-gray-900 dark:border-gray-700">
              <option value="add_to_prompt">add_to_prompt</option>
              <option value="special_handling">special_handling</option>
              <option value="add_to_knowledge">add_to_knowledge</option>
              <option value="data_fix">data_fix</option>
              <option value="cannot_fix">cannot_fix</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Fix Content</label>
            <textarea name="fix_content" defaultValue={promoteDraft.fix_content} rows={4} required
              className="w-full border rounded p-2 text-sm dark:bg-gray-900 dark:border-gray-700" />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={() => setPromoteDraft(null)}
              className="px-4 py-2 border rounded text-sm dark:border-gray-700">Cancel</button>
            <button type="submit"
              className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700">Create Pattern</button>
          </div>
        </form>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 5: Build + reload**

```bash
cd backend/admin && npm run build 2>&1 | tail -5
pm2 reload pds-admin --update-env && sleep 5
pm2 logs pds-admin --lines 10 --nostream | tail -10
```

Expected: build succeeds, no errors. The `npm run build` is REQUIRED — pm2 reload alone won't ship the changes.

- [ ] **Step 6: Manual UI verify**

Open `https://api-malika.bpsmalut.com/backend/malika-analysis` → Analytics tab. With existing 30 pending flags (17 incomplete, 10 hallucination, 2 context_lost), you should see Pattern Suggestions cards. Click Promote on one. Form should pre-fill. Edit something trivial. Click Create Pattern. New pattern should appear in Patterns tab.

If clicking Promote does nothing OR the form doesn't pre-fill — backout the build with `git checkout backend/admin/app/malika-analysis/page.tsx` and investigate. **Do not commit a broken UI.**

After verifying, find + delete the test pattern:

```bash
JWT=$(cd backend && node -e "require('dotenv').config({quiet:true});console.log(require('jsonwebtoken').sign({id:1,email:'admin@bps.go.id',role:'admin'},process.env.JWT_SECRET,{expiresIn:'10m'}))" 2>/dev/null)
PID=$(curl -s -H "Authorization: Bearer $JWT" http://127.0.0.1:5000/error-learning/patterns | python3 -c "import json,sys;[print(p['id']) for p in json.load(sys.stdin)['patterns'] if p['pattern_name'].startswith('Auto:')]" | head -1)
[ -n "$PID" ] && curl -s -X DELETE -H "Authorization: Bearer $JWT" "http://127.0.0.1:5000/error-learning/patterns/$PID" && echo "Deleted test pattern $PID"
```

- [ ] **Step 7: Commit**

```bash
git add backend/admin/app/malika-analysis/page.tsx
git commit -m "feat(malika-analysis): surface pattern suggestions + one-click Promote modal"
```

---

## Phase 2 — Auto-Retirement (Level C)

### Task 3: New patternRetirement service + scheduler

**Files:**
- Create: `backend/src/services/chat/patternRetirement.service.js`
- Test: `backend/src/services/chat/__tests__/patternRetirement.service.test.js`

**Behavior:** Daily WIT-aware timer at 06:45 WIT (15 min after indicator-meta at 06:30). Deactivates (NOT deletes) patterns matching ALL of:
- `is_active = true`
- `occurrence_count < 5`
- `last_occurrence_at < NOW() - INTERVAL 90 DAY` OR `last_occurrence_at IS NULL AND created_at < NOW() - INTERVAL 90 DAY`

The OR branch is critical: patterns that NEVER matched anyone won't have `last_occurrence_at`; fall back to `created_at`.

Returns `{ retired: number, names: string[], durationMs }`.

- [ ] **Step 1: Write the test FIRST**

Create `backend/src/services/chat/__tests__/patternRetirement.service.test.js`:

```js
const { Op } = require('sequelize');
const ChatErrorPattern = require('../../../models/ChatErrorPattern.model');

jest.mock('../../../models/ChatErrorPattern.model');

const { retireStalePatterns } = require('../patternRetirement.service');

describe('retireStalePatterns', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('finds patterns with last_occurrence older than 90 days AND count<5 AND is_active', async () => {
    const fakeUpdate = jest.fn().mockResolvedValue([2, []]);
    ChatErrorPattern.findAll = jest.fn().mockResolvedValue([
      { id: 1, pattern_name: 'old-cold', update: jest.fn().mockResolvedValue(true) },
      { id: 2, pattern_name: 'never-matched', update: jest.fn().mockResolvedValue(true) },
    ]);
    ChatErrorPattern.update = fakeUpdate;

    const result = await retireStalePatterns();

    expect(ChatErrorPattern.findAll).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        is_active: true,
        occurrence_count: expect.objectContaining({ [Op.lt]: 5 }),
      }),
    }));
    expect(result.retired).toBe(2);
    expect(result.names).toEqual(['old-cold', 'never-matched']);
  });

  it('returns zero retired when no stale patterns', async () => {
    ChatErrorPattern.findAll = jest.fn().mockResolvedValue([]);
    const result = await retireStalePatterns();
    expect(result.retired).toBe(0);
    expect(result.names).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to fail**

```bash
cd backend && npx jest src/services/chat/__tests__/patternRetirement.service.test.js --no-coverage 2>&1 | tail -10
```

Expected: "Cannot find module '../patternRetirement.service'".

- [ ] **Step 3: Create the service**

Create `backend/src/services/chat/patternRetirement.service.js`:

```js
'use strict';
/**
 * Pattern retirement scheduler.
 *
 * Daily at 06:45 WIT, deactivates (NOT deletes) ChatErrorPattern rows that:
 *   - is_active = true
 *   - occurrence_count < 5
 *   - last_occurrence_at < NOW() - 90 DAY  OR  (last_occurrence_at IS NULL AND created_at < NOW() - 90 DAY)
 *
 * Deactivation preserves the row for audit; admin can re-activate if needed.
 *
 * Schedule slot: 06:45 WIT (15 min after indicator-meta at 06:30, 45 min after knowledge-sync at 06:00).
 */
const { Op } = require('sequelize');
const ChatErrorPattern = require('../../models/ChatErrorPattern.model');
const logger = require('../../utils/logger').child({ service: 'PatternRetirement' });

const STALE_DAYS = 90;
const MIN_OCCURRENCE_TO_KEEP = 5;
const RUN_HOUR_WIT = 6;
const RUN_MINUTE_WIT = 45;

let _dailyTimer = null;
let _running = false;

async function retireStalePatterns() {
  const t0 = Date.now();
  const staleCutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);

  const stale = await ChatErrorPattern.findAll({
    where: {
      is_active: true,
      occurrence_count: { [Op.lt]: MIN_OCCURRENCE_TO_KEEP },
      [Op.or]: [
        { last_occurrence_at: { [Op.lt]: staleCutoff } },
        { [Op.and]: [
          { last_occurrence_at: null },
          { created_at: { [Op.lt]: staleCutoff } },
        ]},
      ],
    },
  });

  const names = [];
  for (const p of stale) {
    await p.update({ is_active: false });
    names.push(p.pattern_name);
    logger.info({ id: p.id, name: p.pattern_name, occurrence_count: p.occurrence_count }, 'retired stale pattern');
  }

  const durationMs = Date.now() - t0;
  logger.info({ retired: names.length, durationMs }, 'pattern retirement pass complete');
  return { retired: names.length, names, durationMs };
}

function getNextRunDelayMs() {
  const nowMs = Date.now();
  const witNow = new Date(nowMs + 9 * 60 * 60 * 1000);
  const witNext = new Date(witNow);
  witNext.setUTCHours(RUN_HOUR_WIT, RUN_MINUTE_WIT, 0, 0);
  if (witNext.getTime() <= witNow.getTime()) {
    witNext.setUTCDate(witNext.getUTCDate() + 1);
  }
  return Math.max(0, witNext.getTime() - 9 * 60 * 60 * 1000 - nowMs);
}

function stopPatternRetirementScheduler() {
  if (_dailyTimer) clearTimeout(_dailyTimer);
  _dailyTimer = null;
}

function startPatternRetirementScheduler() {
  stopPatternRetirementScheduler();
  const scheduleNext = () => {
    const delayMs = getNextRunDelayMs();
    const nextAt = new Date(Date.now() + delayMs);
    logger.info({ nextAt: nextAt.toISOString(), delayMs }, 'pattern-retirement scheduler armed');
    _dailyTimer = setTimeout(async () => {
      if (_running) {
        logger.warn('previous retirement still running; skipping');
        scheduleNext();
        return;
      }
      _running = true;
      try {
        await retireStalePatterns();
      } catch (e) {
        logger.warn({ err: e.message }, 'pattern-retirement failed');
      } finally {
        _running = false;
        scheduleNext();
      }
    }, delayMs);
  };
  scheduleNext();
  return true;
}

module.exports = {
  retireStalePatterns,
  startPatternRetirementScheduler,
  stopPatternRetirementScheduler,
};
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd backend && npx jest src/services/chat/__tests__/patternRetirement.service.test.js --no-coverage 2>&1 | tail -10
```

Expected: `Tests: 2 passed`.

- [ ] **Step 5: Live smoke (creates + retires + cleans a dummy stale pattern)**

```bash
cd backend && node -e "
require('dotenv').config({quiet:true});
const ChatErrorPattern = require('./src/models/ChatErrorPattern.model');
const { retireStalePatterns } = require('./src/services/chat/patternRetirement.service');

(async () => {
  // Create a dummy stale pattern (last_occurrence_at 100 days ago, count=1)
  const p = await ChatErrorPattern.create({
    pattern_name: 'retirement-smoke-test',
    pattern_type: 'query_pattern',
    trigger_keywords: ['dummy'],
    error_description: 'smoke',
    fix_type: 'add_to_prompt',
    fix_content: 'unused',
    is_active: true,
    occurrence_count: 1,
    last_occurrence_at: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
  });
  console.log('created id=' + p.id);

  const result = await retireStalePatterns();
  console.log('result:', result);

  const reloaded = await ChatErrorPattern.findByPk(p.id);
  console.log('after retire — is_active:', reloaded.is_active);

  // Cleanup
  await reloaded.destroy();
  console.log('cleaned');
  process.exit(0);
})();" 2>&1 | tail -8
```

Expected output (key lines):
- `result: { retired: 1, names: [ 'retirement-smoke-test' ], durationMs: ... }`
- `after retire — is_active: false`
- `cleaned`

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/chat/patternRetirement.service.js backend/src/services/chat/__tests__/patternRetirement.service.test.js
git commit -m "feat(error-learning): pattern retirement service (stale ≥90d, occurrence<5 → inactive)"
```

---

### Task 4: Wire retirement scheduler into server.js

**Files:**
- Modify: `backend/server.js:149-156` (the scheduler bootstrap array)

- [ ] **Step 1: Backup**

```bash
cp backend/server.js backend/server.js.backup
```

- [ ] **Step 2: Add the slot**

Find the bootstrap loop (around lines 149-163, the `for (const [label, loader] of [...])` block). Add `pattern-retirement` AFTER `indicator-meta`, BEFORE `petatematik`:

```js
['indicator-meta',     () => require('./src/services/bpsMetadata/indicatorMetaScheduler.service').startIndicatorMetaScheduler()],
['pattern-retirement', () => require('./src/services/chat/patternRetirement.service').startPatternRetirementScheduler()],
['petatematik',        () => require('./src/services/petaTematik/petaTematik.service').initIndikatorList()],
```

- [ ] **Step 3: Reload + verify scheduler armed**

```bash
pm2 reload pds-backend --update-env && sleep 5
pm2 logs pds-backend --lines 40 --nostream | grep -iE 'pattern-retirement|scheduler armed' | head -10
```

Expected: a line like `pattern-retirement scheduler armed { nextAt: '...2026-05-12T21:45:00.000Z...', delayMs: ... }` (06:45 WIT next day in UTC).

Note: the date shown is UTC; 06:45 WIT = 21:45 UTC on the previous calendar day.

- [ ] **Step 4: Commit**

```bash
git add backend/server.js
git commit -m "feat(server): wire pattern-retirement scheduler into bootstrap (06:45 WIT daily)"
```

---

## Phase 3 — Verify + Docs

### Task 5: End-to-end smoke

- [ ] **Step 1: Full loop smoke for Suggestions (Level A)**

```bash
JWT=$(cd backend && node -e "require('dotenv').config({quiet:true});console.log(require('jsonwebtoken').sign({id:1,email:'admin@bps.go.id',role:'admin'},process.env.JWT_SECRET,{expiresIn:'10m'}))" 2>/dev/null)

# 1. Confirm /analyze surfaces suggestedDraft objects
curl -s -H "Authorization: Bearer $JWT" http://127.0.0.1:5000/error-learning/analyze | python3 -c "
import json,sys
d = json.load(sys.stdin)
print('totalPending:', d.get('totalPending'))
for ftype, cluster in (d.get('byType') or {}).items():
    has_draft = 'suggestedDraft' in cluster
    print(f'  {ftype}: count={cluster[\"count\"]}, has_draft={has_draft}', f'fix_type={cluster[\"suggestedDraft\"][\"fix_type\"]}' if has_draft else '')
"
```

Expected: `hallucination`/`incomplete`/`context_lost` clusters show `has_draft=True`; `other` and small clusters show False.

- [ ] **Step 2: Full loop smoke for Retirement (Level C)**

Re-run the Task 3 Step 5 smoke. Confirm the dummy pattern is retired AND cleaned up.

- [ ] **Step 3: Live admin UI verify**

Browse to `https://api-malika.bpsmalut.com/backend/malika-analysis` → Analytics. Suggestions section appears. Promote modal opens with pre-filled fields when clicked.

- [ ] **Step 4: Unit suite regression check**

```bash
cd backend && npx jest --passWithNoTests --no-coverage 2>&1 | tail -10
```

Compare pass/fail counts vs baseline (was 269 passed / 19 failed after the prior plan). Expect ≥271 passed (2 new in patternRetirement) and same 19 failed.

---

### Task 6: Update docs + memory

**Files:**
- Modify: `docs/workspace/chat-pipeline.md`
- Modify: `/root/.claude/projects/-var-www-html/memory/malika_analysis_loop_2026-05-11.md`
- Modify: `/root/.claude/projects/-var-www-html/memory/MEMORY.md`

- [ ] **Step 1: Append to chat-pipeline.md Change Log**

Add row (newest-first):

```
| 2026-05-11 | MALIKA tuning loop: (Level A) `analyzeFlags()` composes draft patterns from flag clusters keyed to `flag_type` templates (hallucination/incomplete → `add_to_prompt`; context_lost/irrelevant → `special_handling`); min cluster size 2. Admin Analytics tab gains "Pattern Suggestions" + one-click Promote modal that POSTs to existing `/patterns`. (Level C) New `patternRetirement.service.js` + scheduler at 06:45 WIT daily deactivates `is_active=true AND occurrence_count<5 AND last_occurrence_at<NOW()-90 DAY` (preserves row). Wired in server.js bootstrap slot 7. Plan: `docs/superpowers/plans/2026-05-11-malika-tuning-suggestions-retirement.md` | `backend/src/services/chat/{errorLearning,patternRetirement}.service.js`, `backend/admin/app/malika-analysis/page.tsx`, `backend/server.js` |
```

- [ ] **Step 2: Append to memory file**

Edit `/root/.claude/projects/-var-www-html/memory/malika_analysis_loop_2026-05-11.md`. After the existing "Loop wiring summary" table, add:

```markdown
## Tuning automation (2026-05-11 evening — Level A + C)

| Capability | Mechanism | File |
|---|---|---|
| Draft patterns from flag clusters | `analyzeFlags()` → `composeDraftPattern()` keyed on `flag_type` (hallucination/incomplete → add_to_prompt; context_lost/irrelevant → special_handling) | `errorLearning.service.js` |
| Surface drafts in UI | Analytics tab "Pattern Suggestions" section + Promote modal | `malika-analysis/page.tsx` |
| Auto-retire stale patterns | Daily 06:45 WIT cron: `is_active=true AND occurrence_count<5 AND last_occurrence_at<NOW()-90 DAY` → `is_active=false` (NOT deleted) | `patternRetirement.service.js` |

**Threshold rationale:**
- MIN_CLUSTER_SIZE_FOR_DRAFT=2: low bar but not single-flag noise
- MIN_OCCURRENCE_TO_KEEP=5 + 90-day window: a pattern that fired ≥5 times in 90d is "proven useful"; below that = trial that didn't pay off

**Schedule slots (WIT):**
- 06:00 — knowledge-sync (BRS + Publikasi daily re-index)
- 06:30 — indicator-meta (stale `indicator_meta` rows re-embed)
- 06:45 — pattern-retirement (this new one)
- staggered to avoid embed load contention with the first two
```

- [ ] **Step 3: Update MEMORY.md index pointer**

Replace the existing MALIKA analysis loop entry with an updated one that mentions tuning:

```
- [MALIKA analysis loop (2026-05-11)](malika_analysis_loop_2026-05-11.md) — `/backend/malika-analysis` audit fixes + full loop closure (auto-flag, special_handling, xenova corrections, PWA Laporkan) + tuning (draft patterns from clusters, auto-retire stale ≥90d). **DONE 2026-05-11**.
```

- [ ] **Step 4: Commit + push**

```bash
git add docs/workspace/chat-pipeline.md
git commit -m "docs: record tuning loop (Level A suggestions + Level C retirement)"
```

DO NOT push without explicit user signoff (memory file note: user prefers to OK the push step).

---

## Self-Review

**Spec coverage:**
- ✅ Level A: `analyzeFlags()` extension → Task 1
- ✅ Level A: UI surface + Promote modal → Task 2
- ✅ Level C: retirement service → Task 3
- ✅ Level C: scheduler wiring → Task 4
- ✅ End-to-end verification → Task 5
- ✅ Docs + memory → Task 6

**Placeholder scan:** No TBD/TODO. All steps contain runnable code or commands.

**Type consistency:** `SuggestedDraft` type in `page.tsx` matches the service's draft shape (pattern_name, pattern_type, trigger_keywords, error_description, fix_type, fix_content). `retireStalePatterns` return shape `{retired, names, durationMs}` matches test assertions.

**Risk notes:**
- The `formatting_issue` cluster in current production has zero `topKeywords` because BPS users tend to submit short phrases for it ("kasih tabel rapi"). Test verifies omission for `formatting_issue`, but real data will also exercise the `flag_type not in DRAFT_TEMPLATES` branch — both should short-circuit cleanly.
- The retirement service uses `Op.or` with a nested `Op.and` for the "never fired" branch. MariaDB handles this fine, but if you see a SQL syntax error in pm2 logs after deploy, drop the OR branch (just retire by `last_occurrence_at` and let never-fired patterns sit forever — they're cheap).
