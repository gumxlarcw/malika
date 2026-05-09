#!/bin/bash
# MALIKA SessionStart hook — runs every time a Claude Code session starts in this dir.
# Refreshes origin/main and emits the current git state + memory pointer as
# SessionStart hookSpecificOutput so Claude has it in context before any work.

set -e
cd /var/www/html/project-data-strategis

# Refresh remote state (no merge — just pull metadata)
git fetch origin main 2>/dev/null || true

branch=$(git branch --show-current 2>/dev/null || echo "?")
uncommitted=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
ahead=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo "?")
behind=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo "?")
recent_commits=$(git log origin/main --pretty=format:"  %h %ad %s" --date=short -5 2>/dev/null || echo "  (no commits available)")

text="=== MALIKA git state at session start ===
branch: $branch (ahead=$ahead behind=$behind vs origin/main)
uncommitted: $uncommitted files in working tree
recent origin/main commits:
$recent_commits

single source of truth: /var/www/html/project-data-strategis  (origin: gumxlarcw/malika)
auto-memory: /root/.claude/projects/-var-www-html/memory/MEMORY.md (auto-loaded)
workspace docs: docs/workspace/{backend,frontend,admin,chat-pipeline,ai-llm,database,infra}.md

if behind > 0: run \`git pull --ff-only origin main\` before editing
if uncommitted > 0: review with \`git status -s\` — commit + push at end of session"

# Emit JSON: Claude Code injects additionalContext into the model's session context
jq -n --arg text "$text" '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: $text
  }
}'
