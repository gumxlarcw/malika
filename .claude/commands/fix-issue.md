---
description: Implement a fix for a GitHub issue (number or description) with a test
argument-hint: "<issue-number | short description>"
allowed-tools: Bash(gh issue view:*), Bash(git status:*), Bash(git diff:*), Bash(npm test:*), Bash(npx vitest:*), Bash(npx playwright:*), Bash(npx tsc:*), Read, Edit, Write, Grep, Glob
---

Fix: $ARGUMENTS

## 1. Understand the issue
- If `$ARGUMENTS` is a number, fetch it: `gh issue view $ARGUMENTS`.
- Otherwise treat the text as the bug/feature description.
- Restate the expected vs. actual behavior in one line before touching code.

## 2. Locate
- Grep/Glob to find the responsible sub-project (`backend/`, `backend/admin/`, or `frontend/`) and file(s). Read them fully before editing.

## 3. Fix test-first
- Write a failing test that captures the bug:
  - backend → Jest (`backend/`, `npm test`)
  - admin → Vitest (`backend/admin/`, `npm test`)
  - frontend → Playwright (`frontend/`, `npx playwright test`)
- Implement the minimal change to make it pass. Back up each file first (`cp {file} {file}.backup`). Keep the diff small and follow @.claude/rules/code-style.md and @.claude/rules/api-conventions.md.

## 4. Verify
- Run that sub-project's test suite; for TS changes also run `npx tsc --noEmit`.
- Re-read the diff (`git diff`) against the rules.

## 5. Report
- Summarize root cause, the fix, and how it's tested. **Do not commit or push unless explicitly asked.**
