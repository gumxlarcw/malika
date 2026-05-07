#!/usr/bin/env node
'use strict';

/**
 * MALIKA Eval Runner — profile dispatcher
 *
 * Usage:
 *   node evals/run-eval.js                        # all profiles
 *   node evals/run-eval.js --profile=chat
 *   node evals/run-eval.js --profile=search       # wired in Task 13
 *   node evals/run-eval.js --id=greeting-01
 *   node evals/run-eval.js --category=period
 *   node evals/run-eval.js --verbose
 *
 * Output: evals/reports/eval-YYYY-MM-DD-HH-MM.json
 */

const path = require('path');
const { writeJsonReport, writeMarkdownReport, findPreviousJsonReport, computeRegressionDiff } = require('./lib/reportWriter');

const API_BASE = process.env.EVAL_API_BASE || 'http://localhost:5000';
const BFF_BASE = process.env.EVAL_BFF_BASE || 'http://localhost:6060';

// ── CLI parsing ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

function flag(name) {
  return args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
}

function flagValue(name, fallback) {
  const f = flag(name);
  if (!f) return fallback;
  if (!f.includes('=')) return true;
  return f.split('=').slice(1).join('=');
}

const profileArg = String(flagValue('profile', 'all'));
const categoryFilter = flagValue('category', null);
const idFilter = flagValue('id', null);
const tagFilter = flagValue('tag', null);
const verbose = !!flag('verbose');

const stageArg = flagValue('stage', null);
const stubLlm = !!flag('stub-llm');
const baseOverride = flagValue('base', null);
const bffOverride = flagValue('bff', null);
const failOn = (() => { const v = flagValue('fail-on', null); return v ? Number(v) : null; })();

const API_BASE_RESOLVED = baseOverride || API_BASE;
const BFF_BASE_RESOLVED = bffOverride || BFF_BASE;
const stageFilter = stageArg ? new Set(String(stageArg).split(',').map((s) => s.trim()).filter(Boolean)) : null;

// Inter-case delay (ms). EVAL_DELAY_MS env var overrides the chat default —
// chat uses 5s by default because the backend's LLM proxy has TPM limits.
const PROFILE_DELAYS = {
  chat: parseInt(process.env.EVAL_DELAY_MS || '5000', 10),
  search: 100,
};

// ── Core loop ──────────────────────────────────────────────────────────────
async function runProfile(profile, ctx) {
  let cases = profile.loadFixture();
  if (idFilter) cases = cases.filter((c) => c.id === idFilter);
  if (categoryFilter) cases = cases.filter((c) => c.category === categoryFilter);
  if (tagFilter) cases = cases.filter((c) => Array.isArray(c.tags) && c.tags.includes(tagFilter));

  console.log(`\n🧪 Profile: ${profile.name} — ${cases.length} cases`);
  if (cases.length === 0) {
    return { summary: profile.summarize([]), cases: [] };
  }

  const results = [];
  const delay = PROFILE_DELAYS[profile.name] || 100;

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    process.stdout.write(`[${i + 1}/${cases.length}] ${c.id}: "${c.query}" ... `);
    try {
      const result = await profile.runCase(c, ctx);
      results.push(result);
      if (result.score?.grade) {
        const g = result.score.grade;
        const icon = g === 'A' || g === 'B' ? '✅' : g === 'C' ? '⚠️' : '❌';
        const ms = result.response?.latencyMs || 0;
        const len = result.response?.content?.length || 0;
        console.log(`${icon} ${g} (${Math.round((result.score.composite || 0) * 100)}%) — ${ms}ms — ${len} chars`);
        if (ctx.verbose && g !== 'A' && result.score.details) {
          for (const [key, detail] of Object.entries(result.score.details)) {
            if (detail.score < 1) {
              console.log(`   ↳ ${key}: ${JSON.stringify(detail)}`);
            }
          }
        }
      } else {
        console.log('done');
      }
    } catch (err) {
      console.log(`❌ EXCEPTION: ${err.message}`);
      results.push({
        id: c.id,
        category: c.category,
        query: c.query,
        score: { composite: 0, grade: 'F', error: err.message },
      });
    }
    if (i < cases.length - 1) await new Promise((r) => setTimeout(r, delay));
  }

  return { summary: profile.summarize(results), cases: results };
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const profilesToRun = [];
  if (profileArg === 'all' || profileArg === 'chat') {
    profilesToRun.push(require('./lib/profiles/chat'));
  }
  if (profileArg === 'all' || profileArg === 'search') {
    profilesToRun.push(require('./lib/profiles/search'));
  }

  if (profilesToRun.length === 0) {
    console.error(`Unknown profile: ${profileArg}`);
    process.exit(2);
  }

  const ctx = {
    apiBase: API_BASE_RESOLVED,
    bffBase: BFF_BASE_RESOLVED,
    verbose,
    stubLlm,
    stageFilter,
  };
  const startedAt = new Date();
  const profileResults = {};
  for (const profile of profilesToRun) {
    if (stageFilter && profile.name === 'chat') {
      console.error('--stage is not supported on chat profile');
      process.exit(2);
    }
    profileResults[profile.name] = await runProfile(profile, ctx);
  }
  const finishedAt = new Date();

  const report = {
    meta: {
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt - startedAt,
      host: { base: API_BASE_RESOLVED, bff: BFF_BASE_RESOLVED },
      flags: {
        profile: profileArg,
        verbose,
        id: idFilter,
        category: categoryFilter,
        tag: tagFilter,
        stage: stageArg,
        stub_llm: stubLlm,
      },
    },
    profiles: profileResults,
  };

  if (failOn != null) {
    const scores = [];
    for (const p of Object.values(profileResults)) {
      if (p.summary?.overall_score != null) scores.push(p.summary.overall_score);
      if (p.summary?.stages) {
        for (const s of Object.values(p.summary.stages)) {
          if (s.pass_rate != null && s.cases > 0) scores.push(s.pass_rate);
        }
      }
    }
    const min = scores.length ? Math.min(...scores) : 1;
    if (min < failOn) {
      console.error(`\n❌ FAIL: minimum score ${min} < threshold ${failOn}`);
      process.exitCode = 1;
    }
  }

  const reportDir = path.join(__dirname, 'reports');
  const reportPath = writeJsonReport({ dir: reportDir, report, now: finishedAt });
  const currentFilename = path.basename(reportPath);
  const prevPath = findPreviousJsonReport(reportDir, currentFilename);
  if (prevPath) {
    try {
      const prev = JSON.parse(require('fs').readFileSync(prevPath, 'utf8'));
      report.regression = computeRegressionDiff(report, prev);
      require('fs').writeFileSync(reportPath, JSON.stringify(report, null, 2));
    } catch {
      // previous report unreadable — skip diff
    }
  }
  const mdPath = writeMarkdownReport({ dir: reportDir, report, now: finishedAt });
  console.log(`\n💾 Report saved: ${reportPath}`);
  console.log(`📝 Markdown:    ${mdPath}`);
}

process.on('uncaughtException', (err) => {
  console.error('\n💀 Uncaught:', err.message, err.stack);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('\n💀 Rejection:', reason);
  process.exit(1);
});

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
