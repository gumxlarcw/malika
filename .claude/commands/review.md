---
description: Review the current branch's changes against main using the project rule files
argument-hint: "[optional: path or area to focus on]"
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git merge-base:*), Read, Grep, Glob
---

Review the changes on this branch against `main`. Focus area (optional): $ARGUMENTS

## Gather the diff
1. `git status -s` — see staged, unstaged, and untracked files.
2. `git diff main...HEAD` — committed changes since branching from main.
3. `git diff` — unstaged working-tree changes.
   (If `$ARGUMENTS` names a path/area, scope the review to it.)

## Check every changed file against the project rules
- @.claude/rules/code-style.md
- @.claude/rules/testing.md
- @.claude/rules/api-conventions.md

## Flag, grouped by severity (Critical → High → Medium → Low)
- **Secrets:** anything matching the CI secret-scan patterns (`AIzaSy…`, `sk-ant-…`, `sk-proj-…`, `gh[ops]_…`) or a committed `.env`.
- **Auth:** new/changed backend routes missing a `RequireAuth` gate; broken JWT handling.
- **Correctness & security:** injection, unparameterized SQL, XSS, credential/internal leakage in responses or URLs.
- **Tests:** new endpoint/component without a corresponding Jest/Vitest/Playwright test.
- **Style:** deviations from code-style.md; oversized diffs; CommonJS↔ESM mistakes in `backend/`.

Report findings with `file:line` references. Do not modify code — this is review-only.
