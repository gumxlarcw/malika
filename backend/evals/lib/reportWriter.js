'use strict';

const fs = require('fs');
const path = require('path');

function timestampString(now) {
  return now.toISOString().replace(/[T:]/g, '-').slice(0, 16);
}

function writeJsonReport({ dir, report, now = new Date() }) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filename = `eval-${timestampString(now)}.json`;
  const p = path.join(dir, filename);
  fs.writeFileSync(p, JSON.stringify(report, null, 2));
  return p;
}

function findPreviousJsonReport(dir, currentFilename) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter((f) => f.startsWith('eval-') && f.endsWith('.json') && f !== currentFilename)
    .sort();
  return files.length ? path.join(dir, files[files.length - 1]) : null;
}

function computeRegressionDiff(currentReport, previousReport) {
  if (!previousReport) return null;
  const out = {};
  for (const profile of Object.keys(currentReport.profiles || {})) {
    const cur = currentReport.profiles[profile]?.summary;
    const prev = previousReport.profiles?.[profile]?.summary;
    if (!cur || !prev) continue;
    const entry = {};
    if (typeof cur.overall_score === 'number' && typeof prev.overall_score === 'number') {
      entry.overall = { prev: prev.overall_score, now: cur.overall_score, delta: Math.round((cur.overall_score - prev.overall_score) * 1000) / 1000 };
    }
    if (cur.stages && prev.stages) {
      entry.stages = {};
      for (const s of Object.keys(cur.stages)) {
        if (prev.stages[s] && typeof cur.stages[s].pass_rate === 'number' && typeof prev.stages[s].pass_rate === 'number') {
          entry.stages[s] = {
            prev: prev.stages[s].pass_rate,
            now: cur.stages[s].pass_rate,
            delta: Math.round((cur.stages[s].pass_rate - prev.stages[s].pass_rate) * 1000) / 1000,
          };
        }
      }
    }
    out[profile] = entry;
  }
  return out;
}

function writeMarkdownReport({ dir, report, now = new Date() }) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filename = `eval-${timestampString(now)}.md`;
  const md = renderMarkdown(report);
  const p = path.join(dir, filename);
  fs.writeFileSync(p, md);
  return p;
}

function renderMarkdown(report) {
  const lines = [];
  lines.push(`# Eval Report — ${report.meta?.started_at || ''}`);
  lines.push('');
  lines.push(`Duration: ${report.meta?.duration_ms || 0} ms · Base: ${report.meta?.host?.base || '?'} · BFF: ${report.meta?.host?.bff || '?'}`);
  lines.push('');

  const search = report.profiles?.search;
  if (search) {
    lines.push(`## Search profile — ${search.summary?.cases_total || 0} cases`);
    lines.push('');
    lines.push('| Stage | Cases | Pass rate | p95 ms |');
    lines.push('|---|---|---|---|');
    for (const [name, s] of Object.entries(search.summary?.stages || {})) {
      lines.push(`| ${name} | ${s.cases} | ${s.pass_rate} | ${s.p95_latency_ms} |`);
    }
    const cmp = search.summary?.comparison_llm_vs_det;
    if (cmp) {
      lines.push('');
      lines.push(`LLM vs det: ${cmp.both_pass} both-pass · ${cmp.llm_wins} llm-only · ${cmp.det_wins} det-only · ${cmp.both_fail} both-fail`);
      lines.push(`Retire LLM safe: **${cmp.retire_llm_safe ? 'YES' : 'NO'}** — ${cmp.retire_llm_reason}`);
    }
    lines.push('');
  }

  const chat = report.profiles?.chat;
  if (chat) {
    lines.push(`## Chat profile — ${chat.summary?.cases_total || 0} cases`);
    lines.push('');
    lines.push('| Category | Passed | Total | Score |');
    lines.push('|---|---|---|---|');
    for (const [cat, v] of Object.entries(chat.summary?.by_category || {})) {
      lines.push(`| ${cat} | ${v.passed} | ${v.total} | ${v.score} |`);
    }
    lines.push(`| **Overall** | **${chat.summary?.cases_passed || 0}** | **${chat.summary?.cases_total || 0}** | **${chat.summary?.overall_score || 0}** |`);
    lines.push('');
  }

  if (report.regression) {
    lines.push('## Regression vs previous run');
    lines.push('');
    for (const [profile, entry] of Object.entries(report.regression)) {
      lines.push(`### ${profile}`);
      if (entry.overall) lines.push(`- overall: ${entry.overall.prev} → ${entry.overall.now} (Δ ${entry.overall.delta >= 0 ? '+' : ''}${entry.overall.delta})`);
      if (entry.stages) {
        for (const [s, v] of Object.entries(entry.stages)) {
          lines.push(`- ${s}: ${v.prev} → ${v.now} (Δ ${v.delta >= 0 ? '+' : ''}${v.delta})`);
        }
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

module.exports = { writeJsonReport, writeMarkdownReport, findPreviousJsonReport, computeRegressionDiff, timestampString };
