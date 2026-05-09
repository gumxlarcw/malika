# Repo Structure Cleanup + Sync Safeguards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up the 27 legacy root-level Markdown files into a sane `docs/{archive,runbook,reference}/` taxonomy, harden `.gitignore` to prevent backup-file leakage, and add a Stop hook that catches uncommitted/unpushed work at session end so production stays in sync with GitHub on every change.

**Architecture:** Production tree at `/var/www/html/project-data-strategis/` IS the GitHub-tracked repo (consolidated 2026-05-09 from prior worktree-based setup). This plan organizes its content + adds an end-of-session safeguard. Three layers:

1. **Static cleanup** — `git mv` the 27 root MDs into doc subfolders, update cross-refs.
2. **Pattern hygiene** — extend `.gitignore` so the CLAUDE.md `cp file file.backup` convention can never accidentally commit backup files or scratch dirs.
3. **Behavioral safeguard** — Stop hook checks `git status` + `git log origin/main..HEAD` at every session end and warns Claude if state is dirty or unpushed. Combined with the existing SessionStart hook (refreshes origin + prints state), every session is bookended by sync awareness.

**Tech Stack:** Git, bash, jq for hook JSON output, Claude Code hooks (SessionStart already exists, adding Stop), Node 25 + MariaDB 11.8 for the underlying app (unchanged by this plan).

---

## File Structure

**New files:**
- `docs/archive/` — directory holding 14 historical MDs (CHECKPOINT_*, *_AUDIT_*, COMPLETION_CHECKLIST, IMPLEMENTATION_MANIFEST, NAVIGATION_PERFORMANCE_FIX, REPORT_TABLE_ROW_ORDERING)
- `docs/archive/README.md` — one-line "frozen historical docs, see git history for context"
- `docs/runbook/` — directory holding 1 ops doc (RUNBOOK_PUBLIC_PWA_DEPLOY)
- `docs/runbook/README.md` — one-line index
- `docs/reference/` — directory holding ~9 technical refs (CHART_*, DATA_BPS_SCHEMA, ERROR_LEARNING_SYSTEM, EXTENDED_MERGE_IMPLEMENTATION, MALIKA_FINETUNING_WORKFLOW, OPENAI_QUERY_BUILDER, OPENAI_QUERY_BUILDER_SCHEMA.json, PIPELINE_EXHAUSTIVE_MAP, PROPOSAL_PIPELINE_SIMPLIFICATION, RAG_IMPLEMENTATION, REPORT_TABLE_ROW_ORDERING)
- `docs/reference/README.md` — one-line index
- `.claude/hooks/session-stop.sh` — new hook script: warns about uncommitted/unpushed work
- `scripts/sync-status.sh` — small standalone CLI helper users can run any time: `bash scripts/sync-status.sh` to see same info as the SessionStart/Stop hook

**Modified files:**
- `.gitignore` — add `backups/`, `**/*.backup`, `tmp/` (the latter two are existing leakage paths)
- `.claude/settings.json` — add Stop hook entry alongside the SessionStart hook
- `CLAUDE.md` — update workspace pointers + reference the new doc subfolders
- `REFERENCE.md` — update any links pointing to moved files
- `PROJECT_COMPREHENSIVE_DOC.md` — same (cross-refs)
- `docs/workspace/infra.md` — document the new layout in the change log

**Files moved (no content change, just `git mv`):**

To `docs/archive/` (historical, 14 files):
- `ADMIN_PANEL_AUDIT.md`
- `ADMIN_PANEL_SECURITY_AUDIT_2026-01-20.md`
- `BACKWARD_COMPATIBILITY.md`
- `CHECKPOINT_ADMIN_REFACTOR_2026-01-20.md`
- `CHECKPOINT_CHAT_ANALYSIS_2026-01-21.md`
- `CHECKPOINT_CHAT_QUERY_RESPONSE_IMPROVEMENT.md`
- `CHECKPOINT_KATEGORI_PAGE_2026-01-20.md`
- `CHECKPOINT_MOBILE_UX_2026-01-19.md`
- `CHECKPOINT_SEARCH_STABILITY_2026-01-06.md`
- `COMPLETION_CHECKLIST.md`
- `DARKMODE_ANALYSIS_2026-01-21.md`
- `IMPLEMENTATION_MANIFEST.md`
- `NAVIGATION_PERFORMANCE_FIX.md`
- `REPORT_TABLE_ROW_ORDERING.md`

To `docs/runbook/` (1 file):
- `RUNBOOK_PUBLIC_PWA_DEPLOY.md`

To `docs/reference/` (technical refs, ~10 files):
- `CHART_CONFIG_SYSTEM.md`
- `CHART_PROFILER_REFERENCE.md`
- `CHAT_MALIKA_COMPREHENSIVE_DOC.md`
- `DATA_BPS_SCHEMA.md`
- `DATASOURCES_PRESSRELEASE_UPDATE.md`
- `ERROR_LEARNING_SYSTEM.md`
- `EXTENDED_MERGE_IMPLEMENTATION.md`
- `MALIKA_FINETUNING_WORKFLOW.md`
- `OPENAI_QUERY_BUILDER.md`
- `OPENAI_QUERY_BUILDER_SCHEMA.json`
- `PIPELINE_EXHAUSTIVE_MAP_2026-02-26.md`
- `PRESSRELEASE_IMPLEMENTATION.md`
- `PRESSRELEASE_TESTING.md`
- `PROPOSAL_PIPELINE_SIMPLIFICATION_2026-02.md`
- `RAG_IMPLEMENTATION.md`
- `README_PRESSRELEASE.md`

**Files deleted (truly obsolete):**
- `START_HERE.txt` — superseded by `CLAUDE.md` + `README.md`. Verify it's not referenced anywhere first.

**Files that stay at root (4 + dotfiles):**
- `CLAUDE.md` — Claude Code project instructions
- `README.md` — primary project entrypoint
- `REFERENCE.md` — quick navigation
- `PROJECT_COMPREHENSIVE_DOC.md` — full architecture overview

---

## Task 1: Pre-flight audit — verify the file classification

**Files:**
- Read: every MD listed above to confirm it's truly "archival" / "reference" / "runbook"

This task verifies the plan's classification before any moves. If any file turns out to be active/current, re-classify it.

- [ ] **Step 1: List all root MDs and inspect their last-modified date**

```bash
cd /var/www/html/project-data-strategis
ls -la *.md *.txt *.json 2>/dev/null | grep -v "^total" | sort -k 6,8
```

- [ ] **Step 2: For each "archive candidate", grep for inbound links**

```bash
cd /var/www/html/project-data-strategis
for f in ADMIN_PANEL_AUDIT.md ADMIN_PANEL_SECURITY_AUDIT_2026-01-20.md BACKWARD_COMPATIBILITY.md CHECKPOINT_ADMIN_REFACTOR_2026-01-20.md CHECKPOINT_CHAT_ANALYSIS_2026-01-21.md CHECKPOINT_CHAT_QUERY_RESPONSE_IMPROVEMENT.md CHECKPOINT_KATEGORI_PAGE_2026-01-20.md CHECKPOINT_MOBILE_UX_2026-01-19.md CHECKPOINT_SEARCH_STABILITY_2026-01-06.md COMPLETION_CHECKLIST.md DARKMODE_ANALYSIS_2026-01-21.md IMPLEMENTATION_MANIFEST.md NAVIGATION_PERFORMANCE_FIX.md REPORT_TABLE_ROW_ORDERING.md; do
  count=$(grep -rln "$f" --include="*.md" --include="*.json" --include="*.js" --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v "^./$f$" | wc -l)
  printf "%-50s inbound_links=%s\n" "$f" "$count"
done
```

Expected: most show `inbound_links=0` or low counts. Files with high inbound counts may need staying at root or moving with link rewrites.

- [ ] **Step 3: Confirm START_HERE.txt is truly orphaned**

```bash
cd /var/www/html/project-data-strategis
grep -rln "START_HERE" --include="*.md" --include="*.json" --include="*.js" --include="*.ts" --include="*.tsx" 2>/dev/null
```

Expected: empty or only references inside `START_HERE.txt` itself. If non-empty, do NOT delete it; reclassify.

- [ ] **Step 4: Record classification decisions** in this plan as inline edits if anything changes from the spec above. Then proceed.

No commit yet — this task is investigative.

---

## Task 2: Harden `.gitignore` for backups + untrack existing

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Backup**

```bash
cp /var/www/html/project-data-strategis/.gitignore /var/www/html/project-data-strategis/.gitignore.backup
```

- [ ] **Step 2: Read current .gitignore to find a good insertion point**

```bash
cat /var/www/html/project-data-strategis/.gitignore
```

- [ ] **Step 3: Append the new rules**

Open `.gitignore` and append this block at the end:

```gitignore
# ─── CLAUDE.md backup convention (added 2026-05-09) ──────────────────────────
# The "always cp before edit" rule from ~/.claude/CLAUDE.md creates these.
# They must NEVER reach git — they are scratch only.
**/*.backup
backups/

# ─── Temporary scratch ───────────────────────────────────────────────────────
tmp/
```

- [ ] **Step 4: Stop tracking files that match the new ignore rules**

```bash
cd /var/www/html/project-data-strategis
git rm -r --cached backups/ tmp/ 2>/dev/null || true
git ls-files | grep -E '\.backup$' | xargs -r git rm --cached
```

- [ ] **Step 5: Verify**

```bash
git status -s | grep -E "backups/|tmp/|\.backup$" | head -10
```

Expected: shows `D` (deleted from index) for the previously-tracked files. The files remain on disk.

- [ ] **Step 6: Commit**

```bash
git add .gitignore
git commit -m "chore(repo): gitignore backups + tmp + *.backup pattern

The CLAUDE.md backup convention (cp file file.backup before edit) creates
.backup files. Without these gitignore rules, they accumulate in tracked
dirs. Untracking what's already there + adding the pattern prevents future
leakage. backups/ is the convention dir; \\\`**/*.backup\\\` catches stragglers
created next to source files."
```

---

## Task 3: Create new doc subdirectories + indexes

**Files:**
- Create: `docs/archive/README.md`
- Create: `docs/runbook/README.md`
- Create: `docs/reference/README.md`

- [ ] **Step 1: Make the dirs**

```bash
cd /var/www/html/project-data-strategis
mkdir -p docs/archive docs/runbook docs/reference
```

- [ ] **Step 2: Author `docs/archive/README.md`**

```markdown
# Archive

Frozen historical documents — checkpoint reports, completed audits, retired implementation manifests. Kept for audit trail; not actively maintained.

For current architecture, see:
- Root [CLAUDE.md](../../CLAUDE.md) — project entrypoint
- Root [PROJECT_COMPREHENSIVE_DOC.md](../../PROJECT_COMPREHENSIVE_DOC.md) — full overview
- [`docs/workspace/`](../workspace/) — per-area living docs (backend, frontend, admin, chat-pipeline, ai-llm, database, infra)
```

- [ ] **Step 3: Author `docs/runbook/README.md`**

```markdown
# Runbooks

Step-by-step ops guides for production deployment + incident response. Read these before performing the operation, not after.
```

- [ ] **Step 4: Author `docs/reference/README.md`**

```markdown
# Reference

Technical reference docs — schema specs, design proposals, system descriptions. Read on demand when working on the relevant area.

For per-area living docs, see [`docs/workspace/`](../workspace/) instead — those are the source of truth.
```

- [ ] **Step 5: Commit**

```bash
cd /var/www/html/project-data-strategis
git add docs/archive/README.md docs/runbook/README.md docs/reference/README.md
git commit -m "docs: scaffold archive/runbook/reference subfolders with READMEs"
```

---

## Task 4: Move historical docs to `docs/archive/`

**Files:**
- Move via `git mv` (preserves history): 14 files into `docs/archive/`

- [ ] **Step 1: Move all archive-classified files**

```bash
cd /var/www/html/project-data-strategis
git mv ADMIN_PANEL_AUDIT.md docs/archive/
git mv ADMIN_PANEL_SECURITY_AUDIT_2026-01-20.md docs/archive/
git mv BACKWARD_COMPATIBILITY.md docs/archive/
git mv CHECKPOINT_ADMIN_REFACTOR_2026-01-20.md docs/archive/
git mv CHECKPOINT_CHAT_ANALYSIS_2026-01-21.md docs/archive/
git mv CHECKPOINT_CHAT_QUERY_RESPONSE_IMPROVEMENT.md docs/archive/
git mv CHECKPOINT_KATEGORI_PAGE_2026-01-20.md docs/archive/
git mv CHECKPOINT_MOBILE_UX_2026-01-19.md docs/archive/
git mv CHECKPOINT_SEARCH_STABILITY_2026-01-06.md docs/archive/
git mv COMPLETION_CHECKLIST.md docs/archive/
git mv DARKMODE_ANALYSIS_2026-01-21.md docs/archive/
git mv IMPLEMENTATION_MANIFEST.md docs/archive/
git mv NAVIGATION_PERFORMANCE_FIX.md docs/archive/
git mv REPORT_TABLE_ROW_ORDERING.md docs/archive/
```

- [ ] **Step 2: Verify**

```bash
ls /var/www/html/project-data-strategis/docs/archive/ | wc -l
```

Expected: 15 (14 moves + README.md from Task 3).

- [ ] **Step 3: Commit**

```bash
git add -A docs/archive/
git status -s | head -20
git commit -m "docs(archive): move 14 historical docs (checkpoints, audits) to docs/archive/

Files moved with git mv to preserve history. Content unchanged. Root-level
clutter reduced from 27+ MDs to 4 (CLAUDE.md, README.md, REFERENCE.md,
PROJECT_COMPREHENSIVE_DOC.md)."
```

---

## Task 5: Move runbook doc

- [ ] **Step 1: Move + commit**

```bash
cd /var/www/html/project-data-strategis
git mv RUNBOOK_PUBLIC_PWA_DEPLOY.md docs/runbook/
git status -s
git commit -am "docs(runbook): move RUNBOOK_PUBLIC_PWA_DEPLOY.md to docs/runbook/"
```

---

## Task 6: Move reference docs

- [ ] **Step 1: Move all reference-classified files**

```bash
cd /var/www/html/project-data-strategis
git mv CHART_CONFIG_SYSTEM.md docs/reference/
git mv CHART_PROFILER_REFERENCE.md docs/reference/
git mv CHAT_MALIKA_COMPREHENSIVE_DOC.md docs/reference/
git mv DATA_BPS_SCHEMA.md docs/reference/
git mv DATASOURCES_PRESSRELEASE_UPDATE.md docs/reference/
git mv ERROR_LEARNING_SYSTEM.md docs/reference/
git mv EXTENDED_MERGE_IMPLEMENTATION.md docs/reference/
git mv MALIKA_FINETUNING_WORKFLOW.md docs/reference/
git mv OPENAI_QUERY_BUILDER.md docs/reference/
git mv OPENAI_QUERY_BUILDER_SCHEMA.json docs/reference/
git mv PIPELINE_EXHAUSTIVE_MAP_2026-02-26.md docs/reference/
git mv PRESSRELEASE_IMPLEMENTATION.md docs/reference/
git mv PRESSRELEASE_TESTING.md docs/reference/
git mv PROPOSAL_PIPELINE_SIMPLIFICATION_2026-02.md docs/reference/
git mv RAG_IMPLEMENTATION.md docs/reference/
git mv README_PRESSRELEASE.md docs/reference/
```

- [ ] **Step 2: Verify**

```bash
ls /var/www/html/project-data-strategis/docs/reference/ | wc -l
```

Expected: 17 (16 moves + README.md from Task 3).

- [ ] **Step 3: Commit**

```bash
git status -s | head -20
git commit -am "docs(reference): move 16 technical reference docs to docs/reference/"
```

---

## Task 7: Delete truly obsolete `START_HERE.txt`

**Pre-condition:** Task 1 Step 3 confirmed no inbound references.

- [ ] **Step 1: Delete + commit**

```bash
cd /var/www/html/project-data-strategis
git rm START_HERE.txt
git commit -m "docs: remove orphaned START_HERE.txt — superseded by CLAUDE.md + README.md"
```

If Task 1 found inbound references, SKIP this task and add a note to update those references first.

---

## Task 8: Update cross-references in remaining root docs

**Files:**
- Read + Modify: `CLAUDE.md`, `README.md`, `REFERENCE.md`, `PROJECT_COMPREHENSIVE_DOC.md`

- [ ] **Step 1: Find any links pointing to moved files inside the 4 root docs**

```bash
cd /var/www/html/project-data-strategis
for f in CLAUDE.md README.md REFERENCE.md PROJECT_COMPREHENSIVE_DOC.md; do
  echo "--- $f ---"
  grep -nE "\\(/?[A-Z_0-9-]+\\.(md|txt|json)\\)" "$f" 2>/dev/null | head -10
done
```

Expected: shows `[Title](FILENAME.md)` style links. For each link pointing to a now-moved file, rewrite the path.

- [ ] **Step 2: Apply path rewrites**

For example, if CLAUDE.md says `[CHECKPOINT_X.md](CHECKPOINT_X.md)`, change to `[CHECKPOINT_X.md](docs/archive/CHECKPOINT_X.md)`. Use `Edit` per file.

- [ ] **Step 3: Update CLAUDE.md to add the new doc subfolders**

In `CLAUDE.md` under the "Workspace docs" section, append:

```markdown
## Other doc subfolders

- `docs/archive/` — frozen historical docs (checkpoints, completed audits)
- `docs/runbook/` — step-by-step ops guides
- `docs/reference/` — technical reference + schema specs
```

- [ ] **Step 4: Smoke-check links**

```bash
cd /var/www/html/project-data-strategis
for f in CLAUDE.md README.md REFERENCE.md PROJECT_COMPREHENSIVE_DOC.md; do
  echo "--- $f links ---"
  grep -oE "\\([^)]+\\.(md|json|txt)\\)" "$f" 2>/dev/null | sed 's/^(//;s/)$//' | while read link; do
    if [ -f "$link" ] || [ -f "$(dirname $f)/$link" ]; then echo "  ✓ $link"; else echo "  ✗ $link (BROKEN)"; fi
  done
done
```

Expected: zero "BROKEN" entries. Fix any that show as broken.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md REFERENCE.md PROJECT_COMPREHENSIVE_DOC.md
git commit -m "docs: rewrite cross-refs after archive/runbook/reference moves + add subfolder index in CLAUDE.md"
```

---

## Task 9: Author the Stop hook script

**Files:**
- Create: `.claude/hooks/session-stop.sh`

Hook fires when Claude session ends. Warns if uncommitted/unpushed work remains. Combined with the existing SessionStart hook, every session is bookended by sync awareness.

- [ ] **Step 1: Author the script**

```bash
cat > /var/www/html/project-data-strategis/.claude/hooks/session-stop.sh << 'EOF'
#!/bin/bash
# MALIKA Stop hook — runs at the end of every Claude Code session.
# Emits a systemMessage if working tree is dirty or local commits are unpushed,
# so the user sees a clear "you have N uncommitted / N unpushed" reminder.

cd /var/www/html/project-data-strategis 2>/dev/null || exit 0

# Skip silently if not a git repo (defensive)
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

uncommitted=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
unpushed=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)

if [ "$uncommitted" = "0" ] && [ "$unpushed" = "0" ]; then
  # Clean state — emit nothing, exit silently
  exit 0
fi

msg="🔄 sync check: "
[ "$uncommitted" != "0" ] && msg+="$uncommitted uncommitted file(s)"
[ "$uncommitted" != "0" ] && [ "$unpushed" != "0" ] && msg+=", "
[ "$unpushed" != "0" ] && msg+="$unpushed unpushed commit(s)"
msg+=". Run \`git status -s\` and \`git push origin main\` before drift accumulates."

# Emit JSON for Claude Code to display via systemMessage
jq -n --arg m "$msg" '{ "systemMessage": $m }'
EOF
chmod +x /var/www/html/project-data-strategis/.claude/hooks/session-stop.sh
```

- [ ] **Step 2: Pipe-test (clean state)**

```bash
echo '{}' | /var/www/html/project-data-strategis/.claude/hooks/session-stop.sh
```

Expected: empty output, exit 0 (because we'll be on a clean state at this point in the plan execution).

- [ ] **Step 3: Pipe-test (dirty state) by simulating uncommitted work**

```bash
cd /var/www/html/project-data-strategis
touch /tmp/_test_dirty_marker.md
cp /tmp/_test_dirty_marker.md .
echo '{}' | .claude/hooks/session-stop.sh
rm _test_dirty_marker.md
```

Expected: prints JSON like `{"systemMessage":"🔄 sync check: 1 uncommitted file(s). Run \`git status -s\` and \`git push origin main\` before drift accumulates."}`.

- [ ] **Step 4: Commit**

```bash
git add .claude/hooks/session-stop.sh
git commit -m "feat(claude-code): add Stop hook to warn on uncommitted/unpushed work at session end"
```

---

## Task 10: Wire the Stop hook into `.claude/settings.json`

**Files:**
- Modify: `.claude/settings.json`

- [ ] **Step 1: Read current settings**

```bash
cat /var/www/html/project-data-strategis/.claude/settings.json
```

Confirms the existing SessionStart hook structure.

- [ ] **Step 2: Backup + edit**

```bash
cp /var/www/html/project-data-strategis/.claude/settings.json /var/www/html/project-data-strategis/.claude/settings.json.backup
```

Replace contents with:

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/var/www/html/project-data-strategis/.claude/hooks/session-start.sh",
            "timeout": 10
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/var/www/html/project-data-strategis/.claude/hooks/session-stop.sh",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 3: Validate JSON**

```bash
jq -e '.hooks.SessionStart[].hooks[].command, .hooks.Stop[].hooks[].command' /var/www/html/project-data-strategis/.claude/settings.json
```

Expected: prints both commands, exit 0.

- [ ] **Step 4: Commit**

```bash
git add .claude/settings.json
git commit -m "feat(claude-code): wire Stop hook in settings.json (alongside SessionStart)"
```

---

## Task 11: Author standalone CLI sync helper

**Files:**
- Create: `scripts/sync-status.sh`

Simple bash script users (or future automation) can run any time outside a Claude session: `bash scripts/sync-status.sh`. Same info as the SessionStart/Stop hook but without the JSON wrapping.

- [ ] **Step 1: Author**

```bash
cat > /var/www/html/project-data-strategis/scripts/sync-status.sh << 'EOF'
#!/bin/bash
# MALIKA sync-status — print git state vs origin/main. Run any time.
# Same checks the SessionStart/Stop hooks do, but for human consumption.

cd "$(dirname "$0")/.."
git fetch origin main 2>/dev/null || true

branch=$(git branch --show-current)
uncommitted=$(git status --porcelain | wc -l | tr -d ' ')
ahead=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo "?")
behind=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo "?")

echo "=== MALIKA sync status ==="
echo "branch:       $branch"
echo "uncommitted:  $uncommitted file(s)"
echo "ahead:        $ahead commit(s) vs origin/main"
echo "behind:       $behind commit(s) vs origin/main"
echo ""
if [ "$uncommitted" != "0" ]; then
  echo "→ uncommitted files:"
  git status -s | head -10 | sed 's/^/    /'
  echo ""
fi
if [ "$ahead" != "0" ]; then
  echo "→ unpushed commits:"
  git log origin/main..HEAD --oneline | head -5 | sed 's/^/    /'
  echo ""
fi
if [ "$behind" != "0" ]; then
  echo "⚠️  origin/main has $behind commit(s) ahead of you. Run: git pull --ff-only origin main"
  echo ""
fi
if [ "$uncommitted" = "0" ] && [ "$ahead" = "0" ] && [ "$behind" = "0" ]; then
  echo "✅ in sync"
fi
EOF
chmod +x /var/www/html/project-data-strategis/scripts/sync-status.sh
```

- [ ] **Step 2: Smoke test**

```bash
bash /var/www/html/project-data-strategis/scripts/sync-status.sh
```

Expected: prints branch/counts. Output format depends on current state.

- [ ] **Step 3: Commit**

```bash
git add scripts/sync-status.sh
git commit -m "feat(scripts): add sync-status.sh CLI helper for ad-hoc git state checks"
```

---

## Task 12: Update workspace doc + memory

**Files:**
- Modify: `docs/workspace/infra.md` — add a Change Log entry
- Modify: `/root/.claude/projects/-var-www-html/memory/MEMORY.md` — note the new structure

- [ ] **Step 1: Append to `docs/workspace/infra.md`** at the end of its Change Log table:

```markdown
| 2026-05-09 | Repo structure cleanup: 27 root MDs → docs/{archive,runbook,reference}/. Added Stop hook + sync-status.sh. .gitignore hardened against backup files. | CLAUDE.md, .gitignore, .claude/settings.json, .claude/hooks/session-stop.sh, scripts/sync-status.sh, docs/archive/, docs/runbook/, docs/reference/ |
```

- [ ] **Step 2: Append to MEMORY.md** under the "Key Patterns" section (after the existing git workflow line):

```markdown
- **Sync safeguards**: SessionStart hook fetches origin/main + prints state. Stop hook warns if uncommitted/unpushed at session end. Standalone check: `bash scripts/sync-status.sh`.
```

- [ ] **Step 3: Commit (workspace doc only — memory is auto-loaded, no need to commit)**

```bash
cd /var/www/html/project-data-strategis
git add docs/workspace/infra.md
git commit -m "docs(workspace): infra.md change log — repo structure + sync safeguards"
```

---

## Task 13: Final push + smoke-test the bookend hooks

- [ ] **Step 1: Push everything**

```bash
cd /var/www/html/project-data-strategis
git log origin/main..HEAD --oneline | head -20
git push origin main
```

Expected: 11 commits push (one per Task 2-12, with Task 7 only landing if START_HERE.txt was deleted).

- [ ] **Step 2: Verify origin matches**

```bash
git fetch origin main
PROD=$(git rev-parse HEAD^{tree})
ORIGIN=$(git rev-parse origin/main^{tree})
[ "$PROD" = "$ORIGIN" ] && echo "✅ trees match" || echo "❌ trees differ"
```

- [ ] **Step 3: Verify both hooks exist + execute**

```bash
echo '{}' | /var/www/html/project-data-strategis/.claude/hooks/session-start.sh | jq -r '.hookSpecificOutput.additionalContext' | head -5
echo "---"
echo '{}' | /var/www/html/project-data-strategis/.claude/hooks/session-stop.sh
echo "(if next line shows 'in sync' or empty, all good)"
bash /var/www/html/project-data-strategis/scripts/sync-status.sh
```

Expected:
- session-start emits the git-state JSON we've seen
- session-stop emits empty (clean state) or a JSON systemMessage
- sync-status prints "✅ in sync"

---

## Self-Review Checklist

Coverage check vs the user's "after the fix the work will be in sync on every change" requirement:

- [x] **Static cleanup**: 27 root MDs → 4 (Tasks 4, 5, 6, 7)
- [x] **Backup leakage prevention**: `.gitignore` hardened (Task 2)
- [x] **Session-start awareness**: existing SessionStart hook fetches origin + prints state (no change needed; verified Task 13)
- [x] **Session-end safeguard**: new Stop hook warns if uncommitted/unpushed (Tasks 9, 10)
- [x] **Ad-hoc check**: `scripts/sync-status.sh` for non-Claude usage (Task 11)
- [x] **Cross-reference fix-up**: links in CLAUDE.md / README.md / REFERENCE.md / PROJECT_COMPREHENSIVE_DOC.md (Task 8)
- [x] **Documentation**: workspace/infra.md + MEMORY.md updated (Task 12)
- [x] **Final sync**: all commits pushed + bookend hooks verified (Task 13)

Placeholder scan: every step has exact paths, exact code, exact commands. No TBD/TODO/etc.

Type consistency: `session-start.sh` outputs `hookSpecificOutput.additionalContext` (verified earlier). `session-stop.sh` outputs `systemMessage` (different field — Stop hook doesn't inject context, it shows a UI message). Both are valid per the schema.

Risks called out:
- **Task 1 (audit)**: classifications may differ from the spec — Step 4 explicitly allows in-place corrections.
- **Task 7 (delete START_HERE.txt)**: only proceeds if Step 1.3 confirmed no inbound refs.
- **Task 8 (cross-refs)**: depends on what's actually in the 4 root docs. If they reference files not in the move list, those refs stay valid; if they reference moved files, paths must update.
- **Task 13 push**: 11 commits in one push is fine, but if the user pushed something to origin/main during plan execution, push will need a `git pull --rebase` first.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-09-repo-structure-sync-safeguards.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
