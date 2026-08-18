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

### Root cause (superseded — see "Update 2026-08-18" below)

When the repo was first created and pushed, GitHub Actions encountered an unparseable
workflow file at registration time. It allocated a workflow ID (`272866782`) for the
broken file but never properly cleared the stale association even after the file was
fixed. The phantom workflow now intercepts triggers but always reports startup_failure.

### Update 2026-08-18 — the workflow files were never the problem

Three experiments, all against the live repo:

1. **A branch carrying ONE minimal workflow, with `cd.yml` and `checks.yml`
   deleted**, still produced a nameless `BuildFailed` / `startup_failure`. If a
   malformed file were to blame there was nothing left to malform.

2. **`ci.yml` restored at its original path** (the file `b340328` renamed away)
   registered as a *new* workflow, id `272866773` — **not** the phantom's
   `272866782`. So "make the phantom active again by restoring its path, then
   disable it" is not available: `272866782` never belonged to `ci.yml`, and its
   real path remains unidentified. `disable` still returns 403, `DELETE` still 404.

3. **`workflow_dispatch` against that brand-new, valid registration** produced
   run `32119304764`: `path: .github/workflows/ci.yml` — attributed correctly,
   *not* `BuildFailed` — and still `startup_failure` with zero jobs.

Experiment 3 is the one that matters: a correctly-registered workflow with valid
content failed to start on its own entry. Nothing intercepted it. So the phantom
is a **symptom** of the repo being unable to start any workflow, not the cause of
it — which is the opposite of what this document assumed.

Consistent with all of it: something blocks workflow startup repo- or
account-wide. `GET /repos/:owner/:repo/actions/permissions` reports
`enabled: true, allowed_actions: all`, so it is not the repo Actions toggle. The
timeline fits a billing block: 16 runs genuinely executed (conclusion `failure`,
i.e. jobs ran) up to 2026-05-08T01:22Z, then every run since has been
`startup_failure`. Monthly minute quotas reset; this never recovered in three
months, which points at a **failed payment or a spending limit**, not exhausted
included minutes. Option 4 below ("wait") can now be marked as tried and failed.

**Next step:** check <https://github.com/settings/billing> for a payment failure
or an Actions spending limit of $0. This could not be verified from the CLI — the
billing API needs the `user` token scope, and the token in use has only
`gist, read:org, repo, workflow`.

### What does NOT work

- `gh api -X PUT .../workflows/272866782/disable` → `403: Unable to disable a workflow that is not active`
- `gh api -X DELETE .../workflows/272866782` → `404: Not Found`
- Renaming workflow files (forces re-registration, but phantom still fires alongside)
- Adding totally-new workflow files (phantom takes precedence over them)
- Fixing real workflow files so they're parser-valid (phantom now intercepts them entirely — `cd.yml` validates locally and on GitHub's content API but `workflow_dispatch` returns `startup_failure` with zero jobs created)
- **Disable + re-enable Actions at the repo level** (PUT `/actions/permissions` with `enabled=false` then `enabled=true`). Tested 2026-05-08, commit `426da3b` after the cycle still gets only the phantom run, no real workflow execution. The phantom association is stickier than the workflow registration table.

### Pathology has worsened

As of 2026-05-08, the phantom appears to be intercepting ALL workflow runs, not just running alongside them:

- Push to `main` after commit `231b9de` (cd.yml fix): only the phantom fires; neither `cd.yml` nor `checks.yml` show new runs.
- Manual `workflow_dispatch` against `cd.yml` (with valid file content): `conclusion=startup_failure`, zero jobs.

This means GitHub Actions on this repo is functionally non-operational until the phantom is cleared.

### What MIGHT work (untested, escalate if it matters)

1. **Contact GitHub support** with phantom workflow_id 272866782
2. **Delete + recreate the repo** (heavy-handed, loses all run history)
3. **Push from a different account** (forces re-evaluation of trigger associations)
4. ~~**Wait** — sometimes GitHub clears phantom associations after weeks~~ — tried, failed: still broken after three months (2026-05-08 → 2026-08-18).

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

---

## Configuring `cd.yml` (deploy / rollback)

`cd.yml` is parser-valid and inert until you opt-in via repo variables. By
default every job runs the "Skip" branch — no deploy can fire accidentally.

### Why `vars` not `secrets`

GitHub Actions disallows `${{ secrets.X }}` inside step-level `if:` conditions.
The previous version of `cd.yml` used that pattern and failed at parse time
(0-second `failure` runs on every push). Repo *variables* (`vars`) are allowed
in `if:` and are the correct home for boolean toggles. Sensitive values like
the Slack webhook URL stay in `secrets` and are referenced only inside `run:`
via an `env:` mapping.

### To enable staging deploy

1. Settings → Secrets and variables → Actions → **Variables** tab → New variable:
   - `STAGING_DEPLOY_ENABLED = true`
2. Push to `main` → `deploy-staging` job runs `./scripts/deploy-public-pwa.sh`.

### To enable production deploy

1. Same place → New variable:
   - `PROD_DEPLOY_ENABLED = true`
2. Tag the release: `git tag v0.X.Y && git push --tags` → `deploy-production` runs.

### To enable Slack notifications

1. Variables tab → `SLACK_NOTIFY_ENABLED = true`
2. **Secrets** tab → `SLACK_WEBHOOK_URL = https://hooks.slack.com/...`

If `SLACK_NOTIFY_ENABLED=true` is set but the webhook secret is missing, the
Notify step skips with a log line instead of failing the run.

### To enable rollback

`workflow_dispatch` only — go to Actions → CD → "Run workflow", pick environment
and `rollback`. Variable `ROLLBACK_ENABLED = true` must be set first. The
rollback step itself is a stub — wire your actual rollback script into the
`Rollback` step before relying on it.

