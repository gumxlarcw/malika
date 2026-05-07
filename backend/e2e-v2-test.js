#!/usr/bin/env node
/**
 * E2E test for Pipeline V2: 5 chat queries via SSE.
 * Usage: node e2e-v2-test.js
 */
'use strict';

const http = require('http');
const API_BASE = 'http://localhost:5000';

function fetchJSON(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const req = http.request(url, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(JSON.stringify(opts.body));
    req.end();
  });
}

function streamSSE(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const events = [];
    let fullText = '';
    const startMs = Date.now();

    const req = http.get(url, { headers }, (res) => {
      let buffer = '';
      res.on('data', chunk => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();
        let currentEvent = null;
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ') && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));
              events.push({ event: currentEvent, data });
              if (currentEvent === 'text' && data.content) fullText += data.content;
              if (currentEvent === 'done') {
                const elapsed = Date.now() - startMs;
                resolve({ events, fullText: fullText || data.full_text, elapsed, eventCount: events.length });
                req.destroy();
              }
              if (currentEvent === 'error') {
                resolve({ events, fullText, elapsed: Date.now() - startMs, error: data.message, eventCount: events.length });
                req.destroy();
              }
            } catch {}
            currentEvent = null;
          }
        }
      });
      res.on('end', () => {
        resolve({ events, fullText, elapsed: Date.now() - startMs, eventCount: events.length });
      });
    });
    req.on('error', reject);

    setTimeout(() => {
      req.destroy();
      resolve({ events, fullText, elapsed: Date.now() - startMs, error: 'timeout', eventCount: events.length });
    }, 120000);
  });
}

async function main() {
  console.log('=== Pipeline V2 E2E Test ===\n');

  const HEADERS = { 'x-malika-uid': 'e2e-test-v2' };

  // Create a test thread
  const threadRes = await fetchJSON('/chat/threads', {
    method: 'POST',
    headers: HEADERS,
    body: {},
  });

  if (threadRes.status !== 200 && threadRes.status !== 201) {
    console.error('Failed to create thread:', JSON.stringify(threadRes).slice(0, 200));
    process.exit(1);
  }
  const threadId = threadRes.data?.thread?.id || threadRes.data?.data?.id || threadRes.data?.id;
  console.log('Thread created:', threadId, '\n');

  const queries = [
    { q: 'Halo MALIKA', desc: 'Q1: Greeting' },
    { q: 'Data kemiskinan Maluku Utara 2024', desc: 'Q2: Statistical data' },
    { q: 'Inflasi per kabupaten', desc: 'Q3: Per-region inflation' },
    { q: 'Apa itu IPM?', desc: 'Q4: Knowledge/definition' },
    { q: 'PDRB terbaru', desc: 'Q5: Latest PDRB' },
  ];

  let passed = 0;
  let failed = 0;

  for (const { q, desc } of queries) {
    console.log('\u2500'.repeat(60));
    console.log(desc + ': "' + q + '"');

    const result = await streamSSE(
      '/chat/threads/' + threadId + '/stream' +
      '?text=' + encodeURIComponent(q),
      HEADERS
    );

    const hasText = result.fullText && result.fullText.length > 10;
    const hasDone = result.events.some(e => e.event === 'done');
    const hasError = result.events.some(e => e.event === 'error');
    const hasUiMeta = result.events.some(e => e.event === 'malika_ui');
    const uiMetaEvt = result.events.find(e => e.event === 'malika_ui');
    const pipelineVersion = uiMetaEvt?.data?.metadata?.pipeline_version;
    const tier = uiMetaEvt?.data?.metadata?.tier;
    const gateRoute = uiMetaEvt?.data?.metadata?.gate?.route;
    const model = uiMetaEvt?.data?.metadata?.model;

    const ok = hasText && hasDone && !hasError;
    const status = ok ? '\u2705 PASS' : '\u274C FAIL';
    if (ok) passed++; else failed++;

    console.log(status + '  | ' + (result.elapsed / 1000).toFixed(1) + 's | ' + result.eventCount + ' events | ' + (result.fullText?.length || 0) + ' chars');
    console.log('  Pipeline: ' + (pipelineVersion || 'unknown') + ' | Tier: ' + (tier || '-') + ' | Gate: ' + (gateRoute || '-') + ' | Model: ' + (model || '-'));
    console.log('  Text: ' + (result.fullText || '').slice(0, 150).replace(/\n/g, ' ') + ((result.fullText?.length || 0) > 150 ? '...' : ''));
    if (hasError) console.log('  ERROR:', result.events.find(e => e.event === 'error')?.data?.message);
    console.log();
  }

  console.log('\u2500'.repeat(60));
  console.log('Results: ' + passed + '/' + (passed + failed) + ' passed');
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
