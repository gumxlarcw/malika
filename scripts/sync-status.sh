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
