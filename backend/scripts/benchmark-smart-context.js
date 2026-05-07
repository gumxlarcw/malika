#!/usr/bin/env node
/**
 * Benchmark: Smart Context Selection Before/After
 * 
 * Sends the same 3 queries as previous benchmarks to both Flash and Deep,
 * captures SSE events for: tokens, smart context metadata, latency, content.
 * Saves full response text for accuracy comparison.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:5000';
const QUERIES = [
  { label: 'Q1 (simple factual)', text: 'berapa jumlah penduduk maluku utara 2024?' },
  { label: 'Q2 (comparison)', text: 'kemiskinan 2023 bandingkan ipm dan kemiskinan semua maluku utara' },
  { label: 'Q3 (deep analysis)', text: 'kemiskinan 2026 analisis mendalam faktor penyebab kemiskinan maluku utara dan proyeksi' },
];

const MODELS = [
  { label: 'Flash (gpt-4.1)', model: 'gpt-4.1' },
  { label: 'Deep (gpt-5-mini)', model: 'gpt-5-mini' },
];

// Output directory for full responses
const OUT_DIR = path.join(__dirname, '..', 'evals', 'smart-context-benchmark');

function httpPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers, 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let chunks = '';
      res.on('data', (d) => chunks += d.toString());
      res.on('end', () => {
        try { resolve(JSON.parse(chunks)); } catch { resolve(chunks); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function sseChat(threadId, message, uid, model) {
  return new Promise((resolve, reject) => {
    const pathStr = `/chat/threads/${threadId}/stream`;
    const body = JSON.stringify({ text: message, model: model });
    const req = http.request({
      hostname: 'localhost',
      port: 5000,
      path: pathStr,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'x-malika-uid': uid,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let raw = '';
      let content = '';
      let tokens = null;
      let malikaMeta = null;
      let smartContext = null;
      let analystEvent = null;

      res.on('data', (chunk) => { raw += chunk.toString(); });

      res.on('end', () => {
        const blocks = raw.split('\n\n');
        for (const block of blocks) {
          const lines = block.split('\n');
          let eventName = '';
          let dataStr = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) eventName = line.slice(7).trim();
            if (line.startsWith('data: ')) dataStr += (dataStr ? '\n' : '') + line.slice(6);
          }
          if (!eventName || !dataStr) continue;
          try {
            const data = JSON.parse(dataStr);
            if (eventName === 'text_delta') {
              content += data.text || '';
            }
            if (eventName === 'text') {
              // Buffered text (post-supervisor)
              content = data.content || content;
            }
            if (eventName === 'malika_ui') {
              malikaMeta = data;
              tokens = data.metadata?.tokens || null;
              smartContext = data.metadata?.smartContext || null;
            }
            if (eventName === 'status_detail' && data.stage === 'analyst') {
              analystEvent = data;
            }
          } catch {}
        }

        resolve({
          content,
          contentLength: content.length,
          tokens,
          smartContext,
          malikaMeta,
          analystEvent,
          rawLength: raw.length,
        });
      });

      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function createThread(uid) {
  const res = await httpPost(`${BASE}/chat/threads`, {}, { 'x-malika-uid': uid });
  if (!res.ok) {
    console.error('  ⚠️ Thread creation failed:', JSON.stringify(res));
    return null;
  }
  return res.thread?.id;
}

async function main() {
  // Create output directory
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const uid = `bench-smart-ctx-${Date.now()}`;
  const results = [];
  const responses = {};

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Smart Context Selection Benchmark');
  console.log('  Tier-based: SIMPLE=5docs/15K, COMPLEX=7docs/25K, DEEP=10docs/80K');
  console.log('  Budget:     SIMPLE=120K, COMPLEX=200K, DEEP=400K');
  console.log('═══════════════════════════════════════════════════════════\n');

  for (const modelInfo of MODELS) {
    console.log(`\n── ${modelInfo.label} ──────────────────────────────`);

    for (let qi = 0; qi < QUERIES.length; qi++) {
      const q = QUERIES[qi];
      const threadId = await createThread(uid);

      if (!threadId) {
        console.log(`  ❌ Skipping ${q.label} — thread creation failed`);
        continue;
      }

      console.log(`\n  ${q.label}: "${q.text.slice(0, 60)}..."`);
      console.log(`  Thread: ${threadId}, Model: ${modelInfo.model}`);

      const startTime = Date.now();
      const result = await sseChat(threadId, q.text, uid, modelInfo.model);
      const totalMs = Date.now() - startTime;

      const sc = result.smartContext || {};
      const r = {
        model: modelInfo.label,
        modelId: modelInfo.model,
        query: q.label,
        queryText: q.text,
        totalMs,
        contentChars: result.contentLength,
        inputTokens: result.tokens?.input || 0,
        outputTokens: result.tokens?.output || 0,
        totalTokens: result.tokens?.total || 0,
        cachedTokens: result.tokens?.cached || 0,
        reasoningTokens: result.tokens?.reasoning || 0,
        analystActivated: !!result.analystEvent,
        tier: result.malikaMeta?.metadata?.tier || 'unknown',
        smartContext: sc,
      };
      results.push(r);

      // Save full response for accuracy analysis
      const key = `${modelInfo.model}_Q${qi + 1}`;
      responses[key] = {
        query: q.text,
        model: modelInfo.model,
        tier: r.tier,
        content: result.content,
        tokens: result.tokens,
        smartContext: sc,
        totalMs,
      };

      console.log(`  ⏱️  ${(totalMs / 1000).toFixed(1)}s | Tier: ${r.tier}`);
      console.log(`  📊 Tokens: IN=${r.inputTokens} OUT=${r.outputTokens} CACHED=${r.cachedTokens} REASONING=${r.reasoningTokens}`);
      console.log(`  📝 Response: ${r.contentChars} chars`);
      console.log(`  🎯 SmartCtx: maxDocs=${sc.maxDocs || '-'} perDoc=${sc.perDocChars || '-'} budget=${sc.totalBudget || '-'} docsDropped=${sc.docsDropped || 0} charsTrimmed=${sc.charsTrimmed || 0}`);
      console.log(`  🧪 Analyst: ${r.analystActivated ? 'ACTIVATED' : 'SKIPPED'}`);
    }
  }

  // Save full responses to disk
  const respFile = path.join(OUT_DIR, `responses-${Date.now()}.json`);
  fs.writeFileSync(respFile, JSON.stringify(responses, null, 2));
  console.log(`\n💾 Full responses saved to: ${respFile}`);

  // Summary table
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('  SUMMARY TABLE');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('Model           | Query                  | Tier     | Time   | IN Tok | OUT Tok | Docs Drop | Chars Trim | Budget  | Response');
  console.log('────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────');

  for (const r of results) {
    const model = r.model.padEnd(15);
    const q = r.query.padEnd(22);
    const tier = (r.tier || '-').padEnd(8);
    const time = ((r.totalMs / 1000).toFixed(1) + 's').padStart(6);
    const inTok = String(r.inputTokens).padStart(6);
    const outTok = String(r.outputTokens).padStart(7);
    const docsDrop = String(r.smartContext?.docsDropped || 0).padStart(9);
    const charsTrim = String(r.smartContext?.charsTrimmed || 0).padStart(10);
    const budget = String(r.smartContext?.totalBudget || '-').padStart(7);
    const resp = (r.contentChars + 'c').padStart(8);
    console.log(`${model} | ${q} | ${tier} | ${time} | ${inTok} | ${outTok} | ${docsDrop} | ${charsTrim} | ${budget} | ${resp}`);
  }

  // Averages per model
  const flashResults = results.filter(r => r.modelId === 'gpt-4.1');
  const deepResults = results.filter(r => r.modelId === 'gpt-5-mini');

  function avg(arr, field) { return arr.length ? Math.round(arr.reduce((s, r) => s + r[field], 0) / arr.length) : 0; }

  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('  AVERAGES');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`Flash (n=${flashResults.length}): Time=${(avg(flashResults, 'totalMs')/1000).toFixed(1)}s | IN=${avg(flashResults, 'inputTokens')} | OUT=${avg(flashResults, 'outputTokens')} | Analyst=${flashResults.filter(r => r.analystActivated).length}/${flashResults.length}`);
  console.log(`Deep  (n=${deepResults.length}): Time=${(avg(deepResults, 'totalMs')/1000).toFixed(1)}s | IN=${avg(deepResults, 'inputTokens')} | OUT=${avg(deepResults, 'outputTokens')} | Analyst=${deepResults.filter(r => r.analystActivated).length}/${deepResults.length}`);

  // Cost estimation
  const flashCostIn = avg(flashResults, 'inputTokens') * 2.00 / 1_000_000;
  const flashCostOut = avg(flashResults, 'outputTokens') * 8.00 / 1_000_000;
  const deepCostIn = avg(deepResults, 'inputTokens') * 1.10 / 1_000_000;
  const deepCostOut = avg(deepResults, 'outputTokens') * 4.40 / 1_000_000;

  console.log(`\nCost per query:`);
  console.log(`  Flash: $${(flashCostIn + flashCostOut).toFixed(4)} (in: $${flashCostIn.toFixed(4)} + out: $${flashCostOut.toFixed(4)})`);
  console.log(`  Deep:  $${(deepCostIn + deepCostOut).toFixed(4)} (in: $${deepCostIn.toFixed(4)} + out: $${deepCostOut.toFixed(4)})`);

  // Token reduction comparison
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('  TOKEN REDUCTION vs PREVIOUS (raw 400K budget)');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Previous baseline (from conversation)
  const prevFlash = { Q1: 55162, Q2: 85528, Q3: 91312 };
  const prevDeep = { Q1: 54742, Q2: 85131, Q3: 90678 };

  for (const r of results) {
    const qNum = r.query.match(/Q(\d)/)?.[1] || '?';
    const prevTokens = r.modelId === 'gpt-4.1' ? prevFlash[`Q${qNum}`] : prevDeep[`Q${qNum}`];
    if (prevTokens) {
      const reduction = ((1 - r.inputTokens / prevTokens) * 100).toFixed(1);
      console.log(`  ${r.model} ${r.query}: ${prevTokens} → ${r.inputTokens} tokens (${reduction}% reduction)`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  Benchmark complete. Check evals/ for full response text.');
  console.log('═══════════════════════════════════════════════════════════');
}

main().catch(e => { console.error(e); process.exit(1); });
