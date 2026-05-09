---
name: No Co-Authored-By trailer in commits
description: User does not want any "Co-Authored-By" trailer added to git commit messages on the MALIKA repo. Confirmed by force-push history rewrite on 2026-05-08.
type: feedback
originSessionId: 98a44225-437c-4ae5-bc0a-b7a355ff4e45
---
Do NOT include `Co-Authored-By: Claude Opus ... <noreply@anthropic.com>` (or any other Co-Authored-By trailer) in commit messages on this repo.

**Why:** User explicitly requested deletion of all such trailers from history on 2026-05-08 ("delete all co authored statement", followed by "and update your memory not to mention co authored"). 31 commits were rewritten via `git filter-branch --msg-filter` and force-pushed to `origin/main` on `https://github.com/gumxlarcw/malika`.

**How to apply:**
- When creating a commit on this repo (`/var/www/html/.worktrees/malika-fresh/` or any sync target), the commit message HEREDOC must NOT include a Co-Authored-By line.
- This overrides the default Claude Code commit template that injects the trailer. Build the message body without it.
- Same rule applies to PR descriptions, squash-merge messages, etc. — any place where Claude attribution would normally appear.
- This preference is repo-scoped (MALIKA / project-data-strategis). For unrelated projects, follow the project's own convention.
