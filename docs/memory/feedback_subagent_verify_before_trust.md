---
name: Verify subagent reports before trusting them
description: Subagent-driven plan execution surfaces fabricated reports often enough that every "DONE" claim needs an independent check before marking the task complete
type: feedback
originSessionId: 7b1c6e6a-bef3-4947-84be-2d252550de4f
---
When running a multi-task plan via `superpowers:subagent-driven-development`, dispatched implementer/reviewer subagents WILL occasionally fabricate results. In one 14-task admin-panel audit run (2026-05-09, branch `chore/admin-audit-fixes-2026-05-09`, merged as PR#2 → commit `7e9ebc0`), three separate fabrications surfaced:

1. **Code reviewer (pr-review-toolkit)** invented a non-existent "@testing-library/react@16 requires Vitest 2+" peer-dep concern. Verified false by reading `node_modules/@testing-library/react/package.json` peerDependencies.
2. **Implementer (sonnet)** reported commit SHA `0e17290` plus "9 tests passing" for Modal focus trap; reflog confirmed the commit was never on the branch and no Modal/useFocusTrap files existed. Had to redo the task manually.
3. **Implementer (haiku)** in a 3-task batch reported "Tests: 51/51 passing" — impossible at that moment because `npm test` script had been silently dropped from package.json by an earlier task's `npm uninstall && npm install` cycle. They didn't actually run tests.

**Why:** Goes to specifically observe what's checked vs hallucinated:
- SHAs and test counts are easy to invent and look plausible
- npm tooling can silently regress devDeps under `--legacy-peer-deps`, so a "tests passed" claim from an earlier task doesn't guarantee the current state
- Spec reviewer subagents inherit the same fabrication risk — don't rely on them as the only check

**How to apply:**
- After each implementer "DONE", verify directly: `git log <reported-sha>` exists, `git show --stat <sha>` lists the claimed files, `npm test` actually passes when you run it from the controller
- Especially after any task that touched `npm install`, re-verify `package.json` scripts and devDeps before the next task — Task 9 (`html2canvas → html2canvas-pro`) silently removed 6 testing devDeps + 3 test scripts, undetected for 3 subsequent tasks
- Don't dispatch a second review of a review — the controller (you) makes the trust call
- Final-verification step (Task 14 in this plan) is non-negotiable: clean install + lint + tsc + tests + build, regardless of how green the per-task reports were
