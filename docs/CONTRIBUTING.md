# Contributing Guide

## Code Style
- Use existing formatting and conventions per folder.
- Avoid reformatting unrelated code.
- Prefer small, reviewable diffs.

## Branching & PRs
- Create feature branches from main.
- Keep PRs scoped to a single roadmap item when possible.
- Include a short summary and test results in PR description.

## Testing Requirements
- Backend: npm test (backend)
- Admin: npm run lint (backend/admin)
- PWA: npm run test:nonexim (frontend)
- Load tests only when explicitly requested

## Security & Secrets
- Do not commit .env files or secrets.
- OpenAI keys must remain server-side.

## Docs
- Update IMPROVEMENT_ROADMAP_2026-01-23.md when completing roadmap tasks.
- Update docs/ when behavior or architecture changes.

## Review Checklist
- [ ] Tests run and documented
- [ ] No secrets committed
- [ ] Docs updated if needed
- [ ] No breaking changes to public API
