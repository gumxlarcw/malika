'use strict';

const fs = require('fs');
const path = require('path');
const { httpGetJson } = require('../httpClient');
const { scoreStructural } = require('../scoring');

const FIXTURE_PATH = path.join(__dirname, '..', '..', 'fixtures', 'search-cases.json');

function loadFixture() {
  const raw = fs.readFileSync(FIXTURE_PATH, 'utf8');
  return JSON.parse(raw).cases;
}

async function runStageDropdown(q, apiBase) {
  const url = `${apiBase}/search/datasource?q=${encodeURIComponent(q)}&limit=10`;
  const r = await httpGetJson(url, 15000);
  return { items: r.data?.items || [], latencyMs: r.latencyMs, status: r.status };
}

async function runStageIntent(q, apiBase, { noLlm }) {
  const url = `${apiBase}/search/intent?q=${encodeURIComponent(q)}&includeCandidates=1&limit=25${noLlm ? '&noLlm=1' : ''}`;
  const r = await httpGetJson(url, 30000);
  const qb = r.data?.query_builder || {};
  const ds = r.data?.datasource || {};
  const flat = {
    type: qb.type || null,
    year: (qb.params && qb.params.year) || null,
    month: (qb.params && qb.params.month) || null,
    geo: (qb.params && qb.params.geo) || null,
    source_id: ds.source_id || null,
  };
  return { result: flat, raw: r.data, latencyMs: r.latencyMs, status: r.status };
}

async function runStageKnowledge(q, apiBase) {
  const url = `${apiBase}/search/knowledge?q=${encodeURIComponent(q)}&limit=5`;
  const r = await httpGetJson(url, 15000);
  return { items: r.data?.items || [], latencyMs: r.latencyMs };
}

async function runStageE2E(q, bffBase) {
  const url = `${bffBase}/api/search?q=${encodeURIComponent(q)}`;
  const r = await httpGetJson(url, 30000);
  return { data: r.data, latencyMs: r.latencyMs };
}

async function runCase(testCase, ctx) {
  const { apiBase, bffBase, stageFilter } = ctx;
  const stages = {};
  const want = (name) => !stageFilter || stageFilter.has(name);

  if (testCase.expect_dropdown && want('dropdown')) {
    const r = await runStageDropdown(testCase.query, apiBase);
    const gotIds = r.items.map((it) => it.id);
    const exp = testCase.expect_dropdown;
    let passed = true;
    const diffs = [];
    if (exp.top_source_ids && exp.top_source_ids.length) {
      if (gotIds[0] !== exp.top_source_ids[0]) {
        passed = false;
        diffs.push(`top_source_ids[0]: expected ${exp.top_source_ids[0]}, got ${gotIds[0]}`);
      }
    }
    if (exp.must_appear_in_top_k) {
      const k = exp.must_appear_in_top_k.k || 5;
      const topK = gotIds.slice(0, k);
      for (const id of exp.must_appear_in_top_k.ids || []) {
        if (!topK.includes(id)) { passed = false; diffs.push(`must_appear_in_top_${k}: missing ${id}`); }
      }
    }
    stages.dropdown = { passed, diffs, got: gotIds, latencyMs: r.latencyMs };
  }

  if (testCase.expect_intent_llm && want('intent_llm')) {
    const r = await runStageIntent(testCase.query, apiBase, { noLlm: false });
    stages.intent_llm = { ...scoreStructural(r.result, testCase.expect_intent_llm), latencyMs: r.latencyMs, _raw: r.raw };
  }

  if (testCase.expect_intent_det && want('intent_det')) {
    const r = await runStageIntent(testCase.query, apiBase, { noLlm: true });
    stages.intent_det = { ...scoreStructural(r.result, testCase.expect_intent_det), latencyMs: r.latencyMs, _raw: r.raw };
  }

  if (testCase.expect_knowledge && want('knowledge')) {
    const r = await runStageKnowledge(testCase.query, apiBase);
    const gotIds = r.items.map((it) => it.id);
    const exp = testCase.expect_knowledge;
    let passed = true;
    const diffs = [];
    if (exp.must_contain_ids && exp.must_contain_ids.length) {
      const intersect = gotIds.filter((id) => exp.must_contain_ids.includes(id));
      const needed = exp.min_overlap || 1;
      if (intersect.length < needed) {
        passed = false;
        diffs.push(`knowledge overlap: expected ≥${needed}, got ${intersect.length}`);
      }
    }
    if (exp.min_precision_at_5 != null) {
      const top5 = gotIds.slice(0, 5);
      const hits = top5.filter((id) => (exp.must_contain_ids || []).includes(id)).length;
      const prec = top5.length ? hits / top5.length : 0;
      if (prec < exp.min_precision_at_5) {
        passed = false;
        diffs.push(`precision@5: expected ≥${exp.min_precision_at_5}, got ${prec}`);
      }
    }
    stages.knowledge = { passed, diffs, got: gotIds, latencyMs: r.latencyMs };
  }

  if (testCase.expect_plan && want('plan')) {
    let planSource;
    if (stages.intent_det && stages.intent_det._raw) planSource = stages.intent_det._raw;
    else if (stages.intent_llm && stages.intent_llm._raw) planSource = stages.intent_llm._raw;
    else {
      const r = await runStageIntent(testCase.query, apiBase, { noLlm: true });
      planSource = r.raw;
    }
    const plan = planSource?.plan || {};
    const gotShape = { action: plan.action || null };
    if (testCase.expect_plan.source_id != null) {
      gotShape.source_id = plan.action === 'deeplink' ? (planSource?.datasource?.source_id || null) : null;
    }
    stages.plan = scoreStructural(gotShape, testCase.expect_plan);
  }

  if (testCase.expect_e2e && bffBase && want('e2e')) {
    const r = await runStageE2E(testCase.query, bffBase);
    const topDs = r.data?.exact?.datasources?.[0]?.id || null;
    const exp = testCase.expect_e2e;
    const passed = topDs === exp.top_datasource_id;
    stages.e2e = {
      passed,
      got: topDs,
      expected: exp.top_datasource_id,
      latencyMs: r.latencyMs,
      diffs: passed ? [] : [`e2e top_datasource_id: expected ${exp.top_datasource_id}, got ${topDs}`],
    };
  }

  return { id: testCase.id, query: testCase.query, tags: testCase.tags || [], stages };
}

function computeLlmVsDet(results) {
  let llmWins = 0;
  let detWins = 0;
  let bothPass = 0;
  let bothFail = 0;
  for (const r of results) {
    const llm = r.stages?.intent_llm;
    const det = r.stages?.intent_det;
    if (!llm || !det) continue;
    if (llm.passed && det.passed) bothPass++;
    else if (llm.passed && !det.passed) llmWins++;
    else if (!llm.passed && det.passed) detWins++;
    else bothFail++;
  }
  const compared = llmWins + detWins + bothPass + bothFail;
  const retireSafe = llmWins === 0;
  const reason = retireSafe
    ? `det matches or exceeds llm on all ${compared} compared cases`
    : `${llmWins} case${llmWins === 1 ? '' : 's'} where llm succeeds but det fails — strengthen deterministic path first`;
  return {
    llm_wins: llmWins,
    det_wins: detWins,
    both_pass: bothPass,
    both_fail: bothFail,
    retire_llm_safe: retireSafe,
    retire_llm_reason: reason,
  };
}

function summarize(results) {
  const stageNames = ['dropdown', 'intent_llm', 'intent_det', 'knowledge', 'plan', 'e2e'];
  const stages = {};
  for (const name of stageNames) {
    const exercised = results.filter((r) => r.stages && r.stages[name]);
    const passed = exercised.filter((r) => r.stages[name].passed).length;
    const latencies = exercised.map((r) => r.stages[name].latencyMs).filter((v) => typeof v === 'number').sort((a, b) => a - b);
    const p95 = latencies.length ? latencies[Math.floor(latencies.length * 0.95)] : 0;
    const meanLatency = latencies.length ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length) : 0;
    stages[name] = {
      cases: exercised.length,
      pass_rate: exercised.length ? Math.round((passed / exercised.length) * 1000) / 1000 : 0,
      mean_latency_ms: meanLatency,
      p95_latency_ms: p95,
    };
  }

  const comparison = computeLlmVsDet(results);

  return {
    cases_total: results.length,
    stages,
    comparison_llm_vs_det: comparison,
  };
}

module.exports = { name: 'search', loadFixture, runCase, summarize };
