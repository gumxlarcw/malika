---
name: MALIKA GitHub repo (consolidated 2026-05-09)
description: GitHub repo for MALIKA at gumxlarcw/malika. As of 2026-05-09 production tree at /var/www/html/project-data-strategis is its OWN git repo backed by origin (consolidated from previous worktree-based setup that caused drift). Edit + commit + push directly.
type: project
originSessionId: 701d1992-8b19-4e01-ae1b-c294cbda954f
---

# MALIKA GitHub repo

**Repo**: https://github.com/gumxlarcw/malika (private, SSH key authed as `gumxlarcw`).

## Current setup (2026-05-09 onward)

**Production IS the GitHub-tracked tree.** No worktree, no sync script.

```
/var/www/html/project-data-strategis/          ← live, PM2 reads from here
└── .git/                                       ← origin = git@github.com:gumxlarcw/malika.git, branch main
```

Workflow: edit → `git add` → `git commit` → `git push origin main`. PRs via GitHub UI for review.

If you hit "dubious ownership" on first git operation as root in this dir (it's owned by www-data):
```bash
git config --global --add safe.directory /var/www/html/project-data-strategis
```

## Sibling git tree (untouched by this migration)

`/var/www/html/.git` is the **local-only monorepo** that tracks 17+ sibling projects (agenda_work, opac-pst-malut, sipentas, flightclaw, etc.). It has NO remote — purely local audit trail. The `project-data-strategis/` subtree was untracked from this monorepo on 2026-05-09 in commit "chore(monorepo): untrack project-data-strategis subtree".

Other projects in `/var/www/html/` continue to use `/var/www/html/.git`. They have their own GitHub repos (or none).

## Migration history

- **2026-05-07**: GitHub repo created. Initial setup: worktree at `/var/www/html/.worktrees/malika-fresh/` with rsync sync from production via `.scripts/sync-from-production.sh`. Frontend de-submoduled in worktree.
- **2026-05-09**: Worktree-based setup deleted because it caused drift. Audit found 114 untracked production files when malika-fresh was supposedly "in sync". Consolidated:
  - `git rm -r --cached project-data-strategis` from monorepo
  - `git init` inside production tree
  - `git remote add origin git@github.com:gumxlarcw/malika.git`
  - `git fetch origin && git checkout -b main origin/main --force` (working tree already matched origin/main)
  - `rm -rf /var/www/html/.worktrees/malika-fresh/` (freed 751 MB)

## Branches on origin (as of 2026-05-09)

- `main` — production-deployed
- `fix/data-audit-regressions` — closed PR
- `fix/data-audit-second-pass` — closed PR
- `fix/data-audit-third-pass` — closed PR

## CI/CD status

Blocked by GitHub phantom workflow (see `.github/TROUBLESHOOTING.md` in repo). Workflow YAML in repo is clean and ready for when phantom clears.
