#!/usr/bin/env node
/**
 * Benchmark: Token Maximization Before/After
 * 
 * Sends the same 3 queries as the previous benchmark to both Flash and Deep,
 * captures SSE events for: tokens, analyst activation, latency, content length.
 */
'use strict';

const http = require('http');

const BASE = 'http://localhost:5000';
const QUERIES = [
  'berapa jumlah penduduk maluku utara 2024?',
  'kemiskinan 2023 bandingkan ipm dan kemiskinan semua maluku utara',
  'kemiskinan 2026 analisis mendalam faktor penyebab kemiskinan maluku utara dan proyeksi',
];

const MODELS = [
  { label: 'Flash (gpt-4.1)', model: 'gpt-4.1' },
  { label: 'Deep (gpt-5-mini)', model: 'gpt-5-mini' },
];

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
    const path = `/chat/threads/${threadId}/stream`;
    const body = JSON.stringify({ text: message, model: model });
    const req = http.request({
      hostname: 'localhost',
      port: 5000,
      path,
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
      const events = [];
      let analystEvent = null;
      const stageTimings = {};

      res.on('data', (chunk) => {
        raw += chunk.toString();
      });

      res.on('end', () => {
        // Parse SSE events
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
            events.push({ event: eventName, data });

            if (eventName === 'text_delta') {
              content += data.text || '';
            }
            if (eventName === 'malika_ui') {
              malikaMeta = data;
              tokens = data.metadata?.tokens || data.tokens || null;
            }
            if (eventName === 'status') {
              if (data.stage === 'analyst') {
                analystEvent = data;
              }
              if (data.detail && data.detail.includes('ms')) {
                stageTimings[data.stage] = data.detail;
              }
            }
            if (eventName === 'status_detail') {
              if (data.stage === 'analyst') {
                analystEvent = { ...(analystEvent || {}), ...data };
              }
            }
          } catch {}
        }

        resolve({
          contentLength: content.length,
          content: content.slice(0, 200),
          tokens,
          malikaMeta,
          analystEvent,
          eventCount: events.length,
          stageTimings,
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
  const uid = `bench-token-max-${Date.now()}`;
  const results = [];

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Token Maximization Benchmark (AFTER changes)');
  console.log('  P1: Analyst threshold 30K→200K');
  console.log('  P2: MAX_CONTEXT_CHARS 100K→400K');
  console.log('  P3: extractRelevantContent 50K→80K');
  console.log('  P4: Output tokens SIMPLE 3K→4K, COMPLEX 6K→8K, DEEP 12K→16K');
  console.log('═══════════════════════════════════════════════════════════\n');

  for (const modelInfo of MODELS) {
    console.log(`\n── ${modelInfo.label} ──────────────────────────────`);
    
    for (let qi = 0; qi < QUERIES.length; qi++) {
      const query = QUERIES[qi];
      const threadId = await createThread(uid);
      
      if (!threadId) {
        console.log(`  ❌ Skipping Q${qi + 1} — thread creation failed`);
        continue;
      }
      
      console.log(`\n  Q${qi + 1}: "${query.slice(0, 60)}..."`);
      console.log(`  Thread: ${threadId}, Model: ${modelInfo.model}`);
      
      const startTime = Date.now();
      const result = await sseChat(threadId, query, uid, modelInfo.model);
      const totalMs = Date.now() - startTime;
      
      const r = {
        model: modelInfo.label,
        query: query.slice(0, 50),
        totalMs,
        contentChars: result.contentLength,
        inputTokens: result.tokens?.input || result.tokens?.inputTokens || 0,
        outputTokens: result.tokens?.output || result.tokens?.outputTokens || 0,
        totalTokens: result.tokens?.total || result.tokens?.totalTokens || 0,
        cachedTokens: result.tokens?.cached || result.tokens?.cachedInputTokens || 0,
        reasoningTokens: result.tokens?.reasoning || result.tokens?.reasoningTokens || 0,
        analystActivated: !!result.analystEvent,
        analystDetail: result.analystEvent?.detail || 'N/A',
        tier: result.malikaMeta?.metadata?.tier || result.malikaMeta?.tier || 'unknown',
        rawBytes: result.rawLength,
        eventCount: result.eventCount,
      };
      results.push(r);
      
      console.log(`  ⏱️  ${(totalMs / 1000).toFixed(1)}s | Tier: ${r.tier} | Events: ${r.eventCount} | Raw: ${(r.rawBytes/1024).toFixed(0)}KB`);
      console.log(`  📊 Tokens: IN=${r.inputTokens} OUT=${r.outputTokens} TOTAL=${r.totalTokens} CACHED=${r.cachedTokens} REASONING=${r.reasoningTokens}`);
      console.log(`  📝 Response: ${r.contentChars} chars`);
      console.log(`  🧪 Analyst: ${r.analystActivated ? '⚠️ ACTIVATED — ' + r.analystDetail : '✅ SKIPPED (docs fit in context)'}`);
      if (result.tokens) console.log(`  🔍 Raw tokens obj: ${JSON.stringify(result.tokens)}`);
      if (!result.tokens) console.log(`  ⚠️ No tokens in malika_ui. malikaMeta keys: ${result.malikaMeta ? Object.keys(result.malikaMeta).join(',') : 'null'}`);
    }
  }

  // Summary table
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('  SUMMARY TABLE');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  console.log('Model           | Query                                        | Time   | IN Tok | OUT Tok | Total  | Cached | Reasoning | Analyst | Response');
  console.log('───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────');
  
  for (const r of results) {
    const model = r.model.padEnd(15);
    const q = r.query.padEnd(44);
    const time = ((r.totalMs / 1000).toFixed(1) + 's').padStart(6);
    const inTok = String(r.inputTokens).padStart(6);
    const outTok = String(r.outputTokens).padStart(7);
    const totalTok = String(r.totalTokens).padStart(6);
    const cached = String(r.cachedTokens).padStart(6);
    const reasoning = String(r.reasoningTokens).padStart(9);
    const analyst = (r.analystActivated ? 'YES' : 'NO').padStart(7);
    const resp = (r.contentChars + ' chars').padStart(8);
    console.log(`${model} | ${q} | ${time} | ${inTok} | ${outTok} | ${totalTok} | ${cached} | ${reasoning} | ${analyst} | ${resp}`);
  }

  // Averages
  const flashResults = results.filter(r => r.model.includes('Flash'));
  const deepResults = results.filter(r => r.model.includes('Deep'));
  
  function avg(arr, field) { return arr.length ? Math.round(arr.reduce((s, r) => s + r[field], 0) / arr.length) : 0; }
  
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('  AVERAGES');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  console.log(`Flash (n=${flashResults.length}): Time=${(avg(flashResults, 'totalMs')/1000).toFixed(1)}s | IN=${avg(flashResults, 'inputTokens')} | OUT=${avg(flashResults, 'outputTokens')} | TOTAL=${avg(flashResults, 'totalTokens')} | Analyst=${flashResults.filter(r => r.analystActivated).length}/${flashResults.length}`);
  console.log(`Deep  (n=${deepResults.length}): Time=${(avg(deepResults, 'totalMs')/1000).toFixed(1)}s | IN=${avg(deepResults, 'inputTokens')} | OUT=${avg(deepResults, 'outputTokens')} | TOTAL=${avg(deepResults, 'totalTokens')} | Analyst=${deepResults.filter(r => r.analystActivated).length}/${deepResults.length}`);
  
  // Cost estimation
  const flashCostIn = avg(flashResults, 'inputTokens') * 2.00 / 1_000_000;
  const flashCostOut = avg(flashResults, 'outputTokens') * 8.00 / 1_000_000;
  const deepCostIn = avg(deepResults, 'inputTokens') * 1.10 / 1_000_000;
  const deepCostOut = avg(deepResults, 'outputTokens') * 4.40 / 1_000_000;
  
  console.log(`\nCost per query:`);
  console.log(`  Flash: $${(flashCostIn + flashCostOut).toFixed(4)} (in: $${flashCostIn.toFixed(4)} + out: $${flashCostOut.toFixed(4)})`);
  console.log(`  Deep:  $${(deepCostIn + deepCostOut).toFixed(4)} (in: $${deepCostIn.toFixed(4)} + out: $${deepCostOut.toFixed(4)})`);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  Benchmark complete. Compare with BEFORE values.');
  console.log('═══════════════════════════════════════════════════════════');
}

main().catch(e => { console.error(e); process.exit(1); });
