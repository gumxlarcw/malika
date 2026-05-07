#!/usr/bin/env node
/**
 * Benchmark: Flash (gpt-4.1) vs Deep (gpt-5-mini)
 * Full token input/output analysis + comparison with model max limits.
 */
const http = require('http');

const BASE = 'http://localhost:5000';
const UID = 'bench-tokens-' + Date.now();
const HEADERS = { 'Content-Type': 'application/json', 'x-malika-uid': UID };

const QUERIES = [
  { label: 'Simple lookup',     text: 'berapa jumlah penduduk maluku utara 2024?' },
  { label: 'Multi-indicator',   text: 'bandingkan IPM dan kemiskinan semua kabupaten di Maluku Utara 2023-2024' },
  { label: 'Deep analytical',   text: 'analisis mendalam faktor penyebab kemiskinan di Maluku Utara dan proyeksi 2026' },
];

const MODELS = [
  { key: 'flash', model: 'gpt-4.1', mode: 'flash' },
  { key: 'deep',  model: 'gpt-5-mini', mode: 'deep' },
];

// ── Model specifications (from OpenAI docs) ──
const MODEL_SPECS = {
  'gpt-4.1': {
    name: 'GPT-4.1',
    alias: 'MALIKA Flash',
    contextWindow: 1_048_576,    // 1M tokens
    maxOutputTokens: 32_768,     // 32K
    reasoning: false,
    inputCost: 2.00,              // $/1M tokens
    outputCost: 8.00,             // $/1M tokens
    cachedInputCost: 0.50,        // $/1M tokens (cached)
  },
  'gpt-5-mini': {
    name: 'GPT-5-mini',
    alias: 'MALIKA Deep',
    contextWindow: 1_048_576,    // 1M tokens
    maxOutputTokens: 65_536,     // 65K (includes reasoning)
    reasoning: true,
    inputCost: 1.10,              // $/1M tokens  
    outputCost: 4.40,             // $/1M tokens
    cachedInputCost: 0.275,       // $/1M tokens (cached)
    reasoningCost: 4.40,          // $/1M tokens
  },
};

// ── App-level limits (from modelRouter.service.js) ──
const APP_LIMITS = {
  flash: {
    GREETING: { max_tokens: 300, temperature: 0.7 },
    SIMPLE:   { max_tokens: 3_000, temperature: 0.3 },
    COMPLEX:  { max_tokens: 6_000, temperature: 0.3 },
  },
  deep: {
    DEEP: {
      max_tokens: 12_000,
      maxCompletionTokens: 48_000, // max_tokens × 4 for reasoning headroom
      temperature: 0.3,
    },
  },
};

function httpJson(method, path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(BASE + path, { method, headers: HEADERS }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function streamChat(threadId, text, model) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const body = JSON.stringify({ text, model });
    let fullText = '';
    let sseChunks = 0;
    let firstTokenAt = null;
    let uiMetadata = null;
    let stages = {};
    let stageOrder = [];
    let statusDetails = [];
    
    const req = http.request(BASE + `/chat/threads/${threadId}/stream`, {
      method: 'POST',
      headers: HEADERS,
    }, (res) => {
      res.setEncoding('utf8');
      let buffer = '';
      
      res.on('data', (chunk) => {
        buffer += chunk;
        const events = buffer.split('\n\n');
        buffer = events.pop();
        
        for (const evt of events) {
          if (!evt.trim()) continue;
          sseChunks++;
          
          let eventName = '';
          let dataStr = '';
          for (const line of evt.split('\n')) {
            if (line.startsWith('event: ')) eventName = line.slice(7).trim();
            if (line.startsWith('data: ')) dataStr = line.slice(6);
          }
          
          if (!dataStr) continue;
          try {
            const data = JSON.parse(dataStr);
            
            if (eventName === 'status') {
              const elapsed = Date.now() - start;
              const stage = data.stage;
              if (stage && !stages[stage]) {
                stages[stage] = { start: elapsed };
                stageOrder.push(stage);
              }
              if (stage && (data.status === 'done' || data.status === 'complete')) {
                if (stages[stage]) stages[stage].end = elapsed;
              }
            }
            
            if (eventName === 'status_detail') {
              statusDetails.push(data);
            }
            
            if (eventName === 'text' || eventName === 'text-delta') {
              if (!firstTokenAt) firstTokenAt = Date.now() - start;
              if (data.content) fullText += data.content;
              if (data.textDelta) fullText += data.textDelta;
            }
            
            if (eventName === 'malika_ui') {
              uiMetadata = data;
            }
            
            if (eventName === 'done') {
              if (data.full_text) fullText = data.full_text;
              // done event also has metadata
              if (data.metadata && !uiMetadata?.metadata) {
                uiMetadata = { metadata: data.metadata };
              }
            }
          } catch {}
        }
      });
      
      res.on('end', () => {
        const totalMs = Date.now() - start;
        resolve({
          totalMs,
          firstTokenMs: firstTokenAt || totalMs,
          textLen: fullText.length,
          sseChunks,
          stages,
          stageOrder,
          statusDetails,
          uiMetadata,
          fullText,
        });
      });
    });
    
    req.on('error', reject);
    req.setTimeout(600000);
    req.write(body);
    req.end();
  });
}

function fmtNum(n) {
  return n ? n.toLocaleString() : '0';
}

function calcCost(model, inputTokens, outputTokens, cachedTokens = 0, reasoningTokens = 0) {
  const spec = MODEL_SPECS[model];
  if (!spec) return 0;
  const regularInput = inputTokens - (cachedTokens || 0);
  let cost = (regularInput / 1_000_000) * spec.inputCost;
  if (cachedTokens) cost += (cachedTokens / 1_000_000) * spec.cachedInputCost;
  cost += (outputTokens / 1_000_000) * spec.outputCost;
  if (reasoningTokens && spec.reasoningCost) {
    cost += (reasoningTokens / 1_000_000) * spec.reasoningCost;
  }
  return cost;
}

(async () => {
  console.log('╔════════════════════════════════════════════════════════════════════════╗');
  console.log('║     MALIKA Flash vs Deep — Token Analysis Benchmark                   ║');
  console.log('╚════════════════════════════════════════════════════════════════════════╝');
  console.log();
  
  // Print model specs
  console.log('┌─────────────────────────────────────────────────────────────────────┐');
  console.log('│  MODEL SPECIFICATIONS                                               │');
  console.log('├──────────────────┬──────────────────────┬───────────────────────────┤');
  console.log('│                  │  gpt-4.1 (Flash)     │  gpt-5-mini (Deep)        │');
  console.log('├──────────────────┼──────────────────────┼───────────────────────────┤');
  console.log(`│  Context window  │  ${fmtNum(MODEL_SPECS['gpt-4.1'].contextWindow).padEnd(20)}│  ${fmtNum(MODEL_SPECS['gpt-5-mini'].contextWindow).padEnd(25)}│`);
  console.log(`│  Max output      │  ${fmtNum(MODEL_SPECS['gpt-4.1'].maxOutputTokens).padEnd(20)}│  ${fmtNum(MODEL_SPECS['gpt-5-mini'].maxOutputTokens).padEnd(25)}│`);
  console.log(`│  Reasoning       │  ${'No'.padEnd(20)}│  ${'Yes (effort: medium)'.padEnd(25)}│`);
  console.log(`│  Input cost      │  ${'$2.00/1M'.padEnd(20)}│  ${'$1.10/1M'.padEnd(25)}│`);
  console.log(`│  Output cost     │  ${'$8.00/1M'.padEnd(20)}│  ${'$4.40/1M'.padEnd(25)}│`);
  console.log(`│  Cached input    │  ${'$0.50/1M'.padEnd(20)}│  ${'$0.275/1M'.padEnd(25)}│`);
  console.log('├──────────────────┴──────────────────────┴───────────────────────────┤');
  console.log('│  APP-LEVEL LIMITS (modelRouter.service.js)                          │');
  console.log('├──────────────────┬──────────────────────┬───────────────────────────┤');
  console.log('│  GREETING        │  max_tokens: 300     │  (uses Flash model)       │');
  console.log('│  SIMPLE          │  max_tokens: 3,000   │  (uses Flash model)       │');
  console.log('│  COMPLEX         │  max_tokens: 6,000   │  (uses Flash model)       │');
  console.log('│  DEEP            │  (not used)          │  max_tokens: 12,000       │');
  console.log('│                  │                      │  maxCompletionTokens:48,000│');
  console.log('└──────────────────┴──────────────────────┴───────────────────────────┘');
  console.log();
  
  console.log(`UID: ${UID}`);
  console.log(`Queries: ${QUERIES.length} × ${MODELS.length} models = ${QUERIES.length * MODELS.length} total`);
  console.log();

  const results = [];

  for (let qi = 0; qi < QUERIES.length; qi++) {
    const q = QUERIES[qi];
    console.log(`━━━ Query ${qi + 1}/${QUERIES.length}: "${q.label}" ━━━`);
    console.log(`    "${q.text}"`);
    console.log();

    for (const m of MODELS) {
      const threadRes = await httpJson('POST', '/chat/threads', { title: `Bench-tok ${m.key} Q${qi + 1}` });
      const threadId = threadRes.thread.id;
      
      console.log(`  ${m.key.toUpperCase()} (thread ${threadId})...`);
      
      const result = await streamChat(threadId, q.text, m.model);
      const meta = result.uiMetadata?.metadata || {};
      const tokens = meta.tokens || {};
      
      console.log(`    Latency: ${(result.totalMs / 1000).toFixed(1)}s | TTFT: ${(result.firstTokenMs / 1000).toFixed(1)}s`);
      console.log(`    Model: ${meta.model || '?'} | Tier: ${meta.tier || '?'} | Reasoning: ${meta.reasoning || false}`);
      console.log(`    Tokens IN:  ${fmtNum(tokens.input)} prompt`);
      console.log(`    Tokens OUT: ${fmtNum(tokens.output)} completion${tokens.reasoning ? ` + ${fmtNum(tokens.reasoning)} reasoning` : ''}`);
      console.log(`    Tokens TOT: ${fmtNum(tokens.total)}`);
      console.log(`    Content: ${result.textLen} chars | ${result.sseChunks} SSE events`);
      console.log(`    Finish: ${meta.finishReason || '?'}${meta.wasTruncated ? ' ⚠ TRUNCATED' : ''}`);
      
      // Calculate utilization vs limits
      const modelKey = m.model;
      const spec = MODEL_SPECS[modelKey];
      const appMaxOut = meta.reasoning
        ? APP_LIMITS.deep?.DEEP?.maxCompletionTokens || 48000
        : (meta.tier === 'complex'
          ? APP_LIMITS.flash?.COMPLEX?.max_tokens || 6000
          : APP_LIMITS.flash?.SIMPLE?.max_tokens || 3000);
      const modelMaxOut = spec?.maxOutputTokens || 0;
      
      const outputUsed = (tokens.output || 0) + (tokens.reasoning || 0);
      const appUtil = appMaxOut > 0 ? ((outputUsed / appMaxOut) * 100).toFixed(1) : '?';
      const modelUtil = modelMaxOut > 0 ? ((outputUsed / modelMaxOut) * 100).toFixed(1) : '?';
      const contextUtil = spec?.contextWindow > 0 ? ((tokens.input || 0) / spec.contextWindow * 100).toFixed(3) : '?';
      
      console.log(`    Utilization:`);
      console.log(`      Output vs App limit:     ${fmtNum(outputUsed)} / ${fmtNum(appMaxOut)} = ${appUtil}%`);
      console.log(`      Output vs Model limit:   ${fmtNum(outputUsed)} / ${fmtNum(modelMaxOut)} = ${modelUtil}%`);
      console.log(`      Input vs Context window:  ${fmtNum(tokens.input)} / ${fmtNum(spec?.contextWindow)} = ${contextUtil}%`);
      
      // Cost estimate
      const cost = calcCost(modelKey, tokens.input || 0, tokens.output || 0, 0, tokens.reasoning || 0);
      console.log(`    Est. cost: $${cost.toFixed(6)}`);
      
      if (meta.orchestrator) {
        console.log(`    Orchestrator: ${meta.orchestrator.tasks} tasks, ${meta.orchestrator.workers} workers, ${meta.orchestrator.latencyMs}ms`);
      }
      
      // Status details (include generate detail which shows token info)
      const genDetail = result.statusDetails.find(d => d.stage === 'generate');
      if (genDetail) console.log(`    Generate detail: ${genDetail.detail}`);
      
      console.log();
      
      results.push({
        query: q.label,
        model: m.key,
        modelId: m.model,
        ...result,
        meta,
        tokens,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  SUMMARY TABLE
  // ═══════════════════════════════════════════════════════════════════
  console.log();
  console.log('═'.repeat(120));
  console.log('  TOKEN & PERFORMANCE COMPARISON');
  console.log('═'.repeat(120));
  
  const hdr = 'Query'.padEnd(18) + 'Model'.padEnd(8) + 'Tier'.padEnd(10) + 'Latency'.padEnd(9) + 
              'In Tok'.padEnd(9) + 'Out Tok'.padEnd(9) + 'Reason'.padEnd(9) + 'Total'.padEnd(9) + 
              'Chars'.padEnd(8) + 'ch/s'.padEnd(7) + 'tok/s'.padEnd(7) + 'Finish'.padEnd(10) + 'Cost';
  console.log(hdr);
  console.log('─'.repeat(120));
  
  for (const r of results) {
    const t = r.tokens;
    const latS = r.totalMs / 1000;
    const cps = latS > 0 ? Math.round(r.textLen / latS) : 0;
    const tps = latS > 0 ? Math.round((t.output || 0) / latS) : 0;
    const cost = calcCost(r.modelId, t.input || 0, t.output || 0, 0, t.reasoning || 0);
    
    console.log(
      r.query.padEnd(18) +
      r.model.toUpperCase().padEnd(8) +
      (r.meta.tier || '?').padEnd(10) +
      `${latS.toFixed(1)}s`.padEnd(9) +
      fmtNum(t.input).padEnd(9) +
      fmtNum(t.output).padEnd(9) +
      fmtNum(t.reasoning || 0).padEnd(9) +
      fmtNum(t.total).padEnd(9) +
      `${r.textLen}`.padEnd(8) +
      `${cps}`.padEnd(7) +
      `${tps}`.padEnd(7) +
      (r.meta.finishReason || '?').padEnd(10) +
      `$${cost.toFixed(4)}`
    );
  }
  
  console.log('─'.repeat(120));
  
  // Averages per model
  for (const m of MODELS) {
    const mr = results.filter(r => r.model === m.key);
    const avg = (arr, fn) => arr.reduce((s, r) => s + fn(r), 0) / arr.length;
    const avgLat = avg(mr, r => r.totalMs);
    const avgIn = avg(mr, r => r.tokens.input || 0);
    const avgOut = avg(mr, r => r.tokens.output || 0);
    const avgReason = avg(mr, r => r.tokens.reasoning || 0);
    const avgTotal = avg(mr, r => r.tokens.total || 0);
    const avgChars = avg(mr, r => r.textLen);
    const avgCps = avgLat > 0 ? Math.round(avgChars / (avgLat / 1000)) : 0;
    const avgTps = avgLat > 0 ? Math.round(avgOut / (avgLat / 1000)) : 0;
    const avgCost = avg(mr, r => calcCost(r.modelId, r.tokens.input || 0, r.tokens.output || 0, 0, r.tokens.reasoning || 0));
    
    console.log(
      'AVERAGE'.padEnd(18) +
      m.key.toUpperCase().padEnd(8) +
      ''.padEnd(10) +
      `${(avgLat / 1000).toFixed(1)}s`.padEnd(9) +
      `${Math.round(avgIn)}`.padEnd(9) +
      `${Math.round(avgOut)}`.padEnd(9) +
      `${Math.round(avgReason)}`.padEnd(9) +
      `${Math.round(avgTotal)}`.padEnd(9) +
      `${Math.round(avgChars)}`.padEnd(8) +
      `${avgCps}`.padEnd(7) +
      `${avgTps}`.padEnd(7) +
      ''.padEnd(10) +
      `$${avgCost.toFixed(4)}`
    );
  }
  
  console.log('═'.repeat(120));
  
  // ═══════════════════════════════════════════════════════════════════
  //  UTILIZATION TABLE
  // ═══════════════════════════════════════════════════════════════════
  console.log();
  console.log('═'.repeat(100));
  console.log('  TOKEN UTILIZATION vs LIMITS');
  console.log('═'.repeat(100));
  
  console.log('Query'.padEnd(18) + 'Model'.padEnd(8) + 'Tier'.padEnd(10) + 
              'Output Used'.padEnd(14) + 'App Max'.padEnd(14) + '% Used'.padEnd(10) + 
              'Model Max'.padEnd(14) + '% of Model'.padEnd(12) + 'Headroom');
  console.log('─'.repeat(100));
  
  for (const r of results) {
    const outputUsed = (r.tokens.output || 0) + (r.tokens.reasoning || 0);
    const spec = MODEL_SPECS[r.modelId];
    const isReasoning = r.meta.reasoning;
    
    let appMax;
    if (isReasoning) {
      appMax = 48000; // maxCompletionTokens for DEEP tier
    } else if (r.meta.tier === 'complex') {
      appMax = 6000;
    } else if (r.meta.tier === 'greeting') {
      appMax = 300;
    } else {
      appMax = 3000;
    }
    
    const modelMax = spec?.maxOutputTokens || 0;
    const appPct = appMax > 0 ? (outputUsed / appMax * 100).toFixed(1) : '?';
    const modelPct = modelMax > 0 ? (outputUsed / modelMax * 100).toFixed(1) : '?';
    const headroom = appMax - outputUsed;
    
    console.log(
      r.query.padEnd(18) +
      r.model.toUpperCase().padEnd(8) +
      (r.meta.tier || '?').padEnd(10) +
      fmtNum(outputUsed).padEnd(14) +
      fmtNum(appMax).padEnd(14) +
      `${appPct}%`.padEnd(10) +
      fmtNum(modelMax).padEnd(14) +
      `${modelPct}%`.padEnd(12) +
      `${fmtNum(headroom)} tokens left`
    );
  }
  
  console.log('═'.repeat(100));
  
  // ═══════════════════════════════════════════════════════════════════
  //  HEAD-TO-HEAD COMPARISON
  // ═══════════════════════════════════════════════════════════════════
  console.log();
  console.log('═'.repeat(90));
  console.log('  HEAD-TO-HEAD: Flash vs Deep');
  console.log('═'.repeat(90));
  
  for (let i = 0; i < QUERIES.length; i++) {
    const f = results.find(r => r.query === QUERIES[i].label && r.model === 'flash');
    const d = results.find(r => r.query === QUERIES[i].label && r.model === 'deep');
    if (!f || !d) continue;
    
    const ft = f.tokens, dt = d.tokens;
    console.log(`\n  ${QUERIES[i].label}:`);
    console.log(`  ${'Metric'.padEnd(22)} ${'Flash'.padEnd(16)} ${'Deep'.padEnd(16)} ${'Ratio/Diff'}`);
    console.log(`  ${'─'.repeat(70)}`);
    console.log(`  ${'Latency'.padEnd(22)} ${(f.totalMs/1000).toFixed(1).padEnd(16)}s ${(d.totalMs/1000).toFixed(1).padEnd(16)}s ${(d.totalMs/f.totalMs).toFixed(2)}x`);
    console.log(`  ${'Input tokens'.padEnd(22)} ${fmtNum(ft.input).padEnd(16)} ${fmtNum(dt.input).padEnd(16)} ${dt.input && ft.input ? ((dt.input/ft.input)).toFixed(2) + 'x' : '?'}`);
    console.log(`  ${'Output tokens'.padEnd(22)} ${fmtNum(ft.output).padEnd(16)} ${fmtNum(dt.output).padEnd(16)} ${dt.output && ft.output ? ((dt.output/ft.output)).toFixed(2) + 'x' : '?'}`);
    console.log(`  ${'Reasoning tokens'.padEnd(22)} ${fmtNum(ft.reasoning || 0).padEnd(16)} ${fmtNum(dt.reasoning || 0).padEnd(16)} ${dt.reasoning ? 'Deep-only' : 'none'}`);
    console.log(`  ${'Total tokens'.padEnd(22)} ${fmtNum(ft.total).padEnd(16)} ${fmtNum(dt.total).padEnd(16)} ${dt.total && ft.total ? ((dt.total/ft.total)).toFixed(2) + 'x' : '?'}`);
    console.log(`  ${'Content (chars)'.padEnd(22)} ${fmtNum(f.textLen).padEnd(16)} ${fmtNum(d.textLen).padEnd(16)} ${d.textLen && f.textLen ? ((d.textLen/f.textLen)).toFixed(2) + 'x' : '?'}`);
    
    const fCost = calcCost(f.modelId, ft.input || 0, ft.output || 0, 0, ft.reasoning || 0);
    const dCost = calcCost(d.modelId, dt.input || 0, dt.output || 0, 0, dt.reasoning || 0);
    console.log(`  ${'Est. cost'.padEnd(22)} ${'$' + fCost.toFixed(4).padEnd(15)} ${'$' + dCost.toFixed(4).padEnd(15)} ${fCost > 0 ? (dCost/fCost).toFixed(2) + 'x' : '?'}`);
    console.log(`  ${'Token efficiency'.padEnd(22)} ${ft.output && f.textLen ? (f.textLen/ft.output).toFixed(1) + ' ch/tok' : '?'.padEnd(16)} ${dt.output && d.textLen ? (d.textLen/dt.output).toFixed(1) + ' ch/tok' : '?'.padEnd(16)}`);
    console.log(`  ${'Output speed'.padEnd(22)} ${(f.totalMs > 0 ? ((ft.output||0)/(f.totalMs/1000)).toFixed(1) : '?') + ' tok/s'.padEnd(16)} ${(d.totalMs > 0 ? ((dt.output||0)/(d.totalMs/1000)).toFixed(1) : '?') + ' tok/s'}`);
  }
  
  // ═══════════════════════════════════════════════════════════════════
  //  OVERALL SUMMARY
  // ═══════════════════════════════════════════════════════════════════
  console.log();
  console.log('═'.repeat(90));
  console.log('  OVERALL SUMMARY');
  console.log('═'.repeat(90));
  
  const flashR = results.filter(r => r.model === 'flash');
  const deepR = results.filter(r => r.model === 'deep');
  const sum = (arr, fn) => arr.reduce((s, r) => s + fn(r), 0);
  const avg = (arr, fn) => sum(arr, fn) / arr.length;
  
  const fAvgLat = avg(flashR, r => r.totalMs);
  const dAvgLat = avg(deepR, r => r.totalMs);
  const fAvgIn = avg(flashR, r => r.tokens.input || 0);
  const dAvgIn = avg(deepR, r => r.tokens.input || 0);
  const fAvgOut = avg(flashR, r => r.tokens.output || 0);
  const dAvgOut = avg(deepR, r => r.tokens.output || 0);
  const dAvgReason = avg(deepR, r => r.tokens.reasoning || 0);
  const fAvgChars = avg(flashR, r => r.textLen);
  const dAvgChars = avg(deepR, r => r.textLen);
  const fTotalCost = sum(flashR, r => calcCost(r.modelId, r.tokens.input || 0, r.tokens.output || 0, 0, r.tokens.reasoning || 0));
  const dTotalCost = sum(deepR, r => calcCost(r.modelId, r.tokens.input || 0, r.tokens.output || 0, 0, r.tokens.reasoning || 0));
  
  console.log(`\n  ${''.padEnd(25)} ${'Flash (gpt-4.1)'.padEnd(20)} ${'Deep (gpt-5-mini)'.padEnd(20)} Ratio`);
  console.log(`  ${'─'.repeat(75)}`);
  console.log(`  ${'Avg latency'.padEnd(25)} ${(fAvgLat/1000).toFixed(1) + 's'.padEnd(20)} ${(dAvgLat/1000).toFixed(1) + 's'.padEnd(20)} ${(dAvgLat/fAvgLat).toFixed(2)}x`);
  console.log(`  ${'Avg input tokens'.padEnd(25)} ${Math.round(fAvgIn).toLocaleString().padEnd(20)} ${Math.round(dAvgIn).toLocaleString().padEnd(20)} ${(dAvgIn/fAvgIn).toFixed(2)}x`);
  console.log(`  ${'Avg output tokens'.padEnd(25)} ${Math.round(fAvgOut).toLocaleString().padEnd(20)} ${Math.round(dAvgOut).toLocaleString().padEnd(20)} ${(dAvgOut/fAvgOut).toFixed(2)}x`);
  console.log(`  ${'Avg reasoning tokens'.padEnd(25)} ${'0'.padEnd(20)} ${Math.round(dAvgReason).toLocaleString().padEnd(20)} Deep-only`);
  console.log(`  ${'Avg content (chars)'.padEnd(25)} ${Math.round(fAvgChars).toLocaleString().padEnd(20)} ${Math.round(dAvgChars).toLocaleString().padEnd(20)} ${(dAvgChars/fAvgChars).toFixed(2)}x`);
  console.log(`  ${'Total cost (3 queries)'.padEnd(25)} ${'$' + fTotalCost.toFixed(4).padEnd(20)} ${'$' + dTotalCost.toFixed(4).padEnd(20)} ${(dTotalCost/fTotalCost).toFixed(2)}x`);
  console.log(`  ${'Output speed'.padEnd(25)} ${(fAvgOut/(fAvgLat/1000)).toFixed(1) + ' tok/s'.padEnd(20)} ${(dAvgOut/(dAvgLat/1000)).toFixed(1) + ' tok/s'.padEnd(20)} ${((dAvgOut/(dAvgLat/1000))/(fAvgOut/(fAvgLat/1000))).toFixed(2)}x`);
  console.log(`  ${'Chars per token'.padEnd(25)} ${(fAvgChars/fAvgOut).toFixed(1) + ' ch/tok'.padEnd(20)} ${(dAvgChars/dAvgOut).toFixed(1) + ' ch/tok'.padEnd(20)}`);
  
  console.log(`\n  Key insight:`);
  console.log(`    Flash: Fast & cost-efficient — best for routine data lookups`);
  console.log(`    Deep:  ${(dAvgChars/fAvgChars).toFixed(1)}x richer content, ${dAvgReason > 0 ? Math.round(dAvgReason).toLocaleString() + ' reasoning tokens avg, ' : ''}but ${(dAvgLat/fAvgLat).toFixed(1)}x slower & ${(dTotalCost/fTotalCost).toFixed(1)}x cost`);
  
  console.log();
  console.log('Benchmark complete.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
