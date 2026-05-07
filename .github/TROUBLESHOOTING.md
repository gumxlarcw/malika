# GitHub Actions troubleshooting

## Stuck "phantom" workflow on every push (BuildFailed startup_failure)

### Symptom

Every `git push` triggers a workflow run that:
- Shows `conclusion: startup_failure`
- Empty `name`
- `path: BuildFailed`
- `workflow_id: 272866782` (deleted, but still active)

The actual `Checks` (`checks.yml`) and `CD` (`cd.yml`) workflows DO run alongside it
— but the phantom run pollutes the PR/commit status checks.

### Root cause

When the repo was first created and pushed, GitHub Actions encountered an unparseable
workflow file at registration time. It allocated a workflow ID (`272866782`) for the
broken file but never properly cleared the stale association even after the file was
fixed. The phantom workflow now intercepts triggers but always reports startup_failure.

### What does NOT work

- `gh api -X PUT .../workflows/272866782/disable` → `403: Unable to disable a workflow that is not active`
- `gh api -X DELETE .../workflows/272866782` → `404: Not Found`
- Renaming workflow files (forces re-registration, but phantom still fires alongside)
- Adding totally-new workflow files (phantom takes precedence over them)

### What MIGHT work (untested, escalate if it matters)

1. **Contact GitHub support** with phantom workflow_id 272866782
2. **Delete + recreate the repo** (heavy-handed, loses all run history)
3. **Push from a different account** (forces re-evaluation of trigger associations)
4. **Wait** — sometimes GitHub clears phantom associations after weeks

### Why we're not blocking on this

Production deploys via PM2 from `/var/www/html/project-data-strategis/`, NOT
via GitHub Actions. The phantom CI failure is annoying but doesn't block anything
real. When CI eventually starts working (or we delete + recreate the repo), our
workflow files in `.github/workflows/checks.yml` are ready to run as-is.

### What to do until then

- Treat the phantom startup_failure as expected noise on every push.
- Use the local pre-push secret scan in `.scripts/sync-from-production.sh` as the
  effective CI substitute.
- Run `npm test`, `npm run build`, `npx tsc --noEmit` manually before commits if
  you want CI-equivalent confidence.
