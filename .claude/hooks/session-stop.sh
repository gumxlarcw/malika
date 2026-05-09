#!/bin/bash
# MALIKA Stop hook — runs at the end of every Claude Code session.
# Emits a systemMessage if working tree is dirty or local commits are unpushed,
# so the user sees a clear "you have N uncommitted / N unpushed" reminder.

cd /var/www/html/project-data-strategis 2>/dev/null || exit 0

git rev-parse --git-dir >/dev/null 2>&1 || exit 0

uncommitted=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
unpushed=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)

if [ "$uncommitted" = "0" ] && [ "$unpushed" = "0" ]; then
  exit 0
fi

msg="🔄 sync check: "
[ "$uncommitted" != "0" ] && msg+="$uncommitted uncommitted file(s)"
[ "$uncommitted" != "0" ] && [ "$unpushed" != "0" ] && msg+=", "
[ "$unpushed" != "0" ] && msg+="$unpushed unpushed commit(s)"
msg+=". Run \`git status -s\` and \`git push origin main\` before drift accumulates."

jq -n --arg m "$msg" '{ "systemMessage": $m }'
