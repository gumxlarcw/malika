#!/usr/bin/env node
/**
 * Benchmark: Flash (gpt-4.1) vs Deep (gpt-5-mini)
 * Creates separate threads per model, sends identical queries, measures latency + content.
 */
const http = require('http');

const BASE = 'http://localhost:5000';
const UID = 'benchmark-agent-' + Date.now();
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
    let stages = {};
    let stageOrder = [];
    
    const req = http.request(BASE + `/chat/threads/${threadId}/stream`, {
      method: 'POST',
      headers: HEADERS,
    }, (res) => {
      res.setEncoding('utf8');
      let buffer = '';
      
      res.on('data', (chunk) => {
        buffer += chunk;
        // SSE format: "event: <name>\ndata: <json>\n\n"
        const events = buffer.split('\n\n');
        buffer = events.pop(); // keep incomplete event
        
        for (const evt of events) {
          if (!evt.trim()) continue;
          sseChunks++;
          
          // Parse event name and data
          let eventName = '';
          let dataStr = '';
          for (const line of evt.split('\n')) {
            if (line.startsWith('event: ')) eventName = line.slice(7).trim();
            if (line.startsWith('data: ')) dataStr = line.slice(6);
          }
          
          if (!dataStr) continue;
          try {
            const data = JSON.parse(dataStr);
            
            // Track pipeline stages
            if (eventName === 'status' || eventName === 'pipeline_status') {
              const elapsed = Date.now() - start;
              const stage = data.stage || data.step || eventName;
              if (stage && !stages[stage]) {
                stages[stage] = { start: elapsed };
                stageOrder.push(stage);
              }
              if (stage && (data.status === 'done' || data.status === 'complete')) {
                if (stages[stage]) stages[stage].end = elapsed;
              }
            }
            
            // Track text content
            if (eventName === 'text' || eventName === 'text-delta') {
              if (!firstTokenAt) firstTokenAt = Date.now() - start;
              if (data.content) fullText += data.content;
              if (data.textDelta) fullText += data.textDelta;
            }
            
            // Full text on done
            if (eventName === 'done') {
              if (data.full_text) fullText = data.full_text;
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
          preview: fullText.slice(0, 200),
          fullText,
        });
      });
    });
    
    req.on('error', reject);
    req.setTimeout(600000); // 10 min
    req.write(body);
    req.end();
  });
}

(async () => {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║          MALIKA Flash vs Deep Benchmark                     ║');
  console.log('║          Post-optimization (timeout/token changes)          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
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
      // Create fresh thread per query+model
      const threadRes = await httpJson('POST', '/chat/threads', { title: `Bench ${m.key} Q${qi + 1}` });
      const threadId = threadRes.thread.id;
      
      console.log(`  ${m.key.toUpperCase()} (thread ${threadId})...`);
      const t0 = Date.now();
      
      const result = await streamChat(threadId, q.text, m.model);
      
      console.log(`    Total: ${(result.totalMs / 1000).toFixed(1)}s | TTFT: ${(result.firstTokenMs / 1000).toFixed(1)}s | ${result.textLen} chars | ${result.sseChunks} SSE events`);
      
      // Show stage breakdown
      if (result.stageOrder.length > 0) {
        const stageSummary = result.stageOrder.map(s => {
          const st = result.stages[s];
          const dur = st.end ? `${st.end - st.start}ms` : 'ongoing';
          return `${s}(${dur})`;
        }).join(' → ');
        console.log(`    Stages: ${stageSummary}`);
      }
      
      console.log(`    Preview: ${result.preview.slice(0, 120)}...`);
      console.log();
      
      results.push({
        query: q.label,
        queryText: q.text,
        model: m.key,
        ...result,
      });
    }
  }

  // ═══════════════════ Summary Table ═══════════════════
  console.log();
  console.log('═'.repeat(100));
  console.log('  BENCHMARK SUMMARY');
  console.log('═'.repeat(100));
  
  const hdr = 'Query'.padEnd(22) + 'Model'.padEnd(10) + 'Total'.padEnd(10) + 'TTFT'.padEnd(10) + 'Chars'.padEnd(10) + 'ch/s'.padEnd(8) + 'SSE'.padEnd(6) + 'Stages';
  console.log(hdr);
  console.log('─'.repeat(100));
  
  for (const r of results) {
    const cps = r.totalMs > 0 ? Math.round(r.textLen / (r.totalMs / 1000)) : 0;
    const stageCnt = r.stageOrder.length;
    console.log(
      r.query.padEnd(22) +
      r.model.toUpperCase().padEnd(10) +
      `${(r.totalMs / 1000).toFixed(1)}s`.padEnd(10) +
      `${(r.firstTokenMs / 1000).toFixed(1)}s`.padEnd(10) +
      `${r.textLen}`.padEnd(10) +
      `${cps}`.padEnd(8) +
      `${r.sseChunks}`.padEnd(6) +
      `${stageCnt}`
    );
  }
  
  console.log('─'.repeat(100));
  
  // Averages
  for (const m of MODELS) {
    const mr = results.filter(r => r.model === m.key);
    const avgTotal = mr.reduce((s, r) => s + r.totalMs, 0) / mr.length;
    const avgTTFT = mr.reduce((s, r) => s + r.firstTokenMs, 0) / mr.length;
    const avgLen = mr.reduce((s, r) => s + r.textLen, 0) / mr.length;
    const avgCps = avgTotal > 0 ? Math.round(avgLen / (avgTotal / 1000)) : 0;
    
    console.log(
      'AVERAGE'.padEnd(22) +
      m.key.toUpperCase().padEnd(10) +
      `${(avgTotal / 1000).toFixed(1)}s`.padEnd(10) +
      `${(avgTTFT / 1000).toFixed(1)}s`.padEnd(10) +
      `${Math.round(avgLen)}`.padEnd(10) +
      `${avgCps}`.padEnd(8)
    );
  }
  
  console.log('═'.repeat(100));
  
  // Comparison
  const flashAvg = results.filter(r => r.model === 'flash');
  const deepAvg = results.filter(r => r.model === 'deep');
  const fTotal = flashAvg.reduce((s, r) => s + r.totalMs, 0) / flashAvg.length;
  const dTotal = deepAvg.reduce((s, r) => s + r.totalMs, 0) / deepAvg.length;
  const fLen = flashAvg.reduce((s, r) => s + r.textLen, 0) / flashAvg.length;
  const dLen = deepAvg.reduce((s, r) => s + r.textLen, 0) / deepAvg.length;
  
  console.log();
  console.log('  Speed ratio:   Deep is ' + (dTotal / fTotal).toFixed(1) + 'x slower than Flash');
  console.log('  Content ratio: Deep produces ' + (dLen / fLen).toFixed(1) + 'x more content');
  console.log('  TTFT ratio:    Deep TTFT is ' + 
    (deepAvg.reduce((s,r) => s + r.firstTokenMs, 0) / deepAvg.length / 
     (flashAvg.reduce((s,r) => s + r.firstTokenMs, 0) / flashAvg.length)).toFixed(1) + 'x slower');
  console.log();
  
  // Per-query comparison
  console.log('  Per-query comparison:');
  for (let i = 0; i < QUERIES.length; i++) {
    const f = results.find(r => r.query === QUERIES[i].label && r.model === 'flash');
    const d = results.find(r => r.query === QUERIES[i].label && r.model === 'deep');
    if (f && d) {
      console.log(`    ${QUERIES[i].label}: Flash ${(f.totalMs/1000).toFixed(1)}s/${f.textLen}ch vs Deep ${(d.totalMs/1000).toFixed(1)}s/${d.textLen}ch (${(d.totalMs/f.totalMs).toFixed(1)}x slower, ${(d.textLen/Math.max(f.textLen,1)).toFixed(1)}x more)`);
    }
  }
  
  console.log();
  console.log('Benchmark complete.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
