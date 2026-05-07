#!/usr/bin/env node
/**
 * Deep Document Retrieval Test — FRONTEND ROUTE
 *
 * Same ground-truth test as test-deep-document.js but routes all
 * requests through the Next.js frontend API (port 6060) instead of
 * hitting the Express backend directly (port 5000).
 *
 * This validates the FULL deployed stack:
 *   Browser → Next.js API route → Express backend → DB/KB → LLM
 *
 * Usage:
 *   node scripts/test-deep-document-frontend.js
 *   node scripts/test-deep-document-frontend.js --quick   # Run 3 tests only
 */
'use strict';

const http = require('http');
const FRONTEND_BASE = 'http://localhost:6060';

// ─── HTTP helpers ───────────────────────────────────────────────────

function httpPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers, 'Content-Length': Buffer.byteLength(data) },
      timeout: 30000,
    }, (res) => {
      let chunks = '';
      res.on('data', (d) => { chunks += d.toString(); });
      res.on('end', () => {
        try { resolve(JSON.parse(chunks)); }
        catch { resolve(chunks); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('Request timeout')); });
    req.write(data);
    req.end();
  });
}

function sseChat(threadId, message, uid, model) {
  return new Promise((resolve, reject) => {
    // Only include model if it's in the allowed list; otherwise omit to use default
    const allowed = ['gemini-3-flash-preview', 'gemini-3-pro-preview', 'claude-sonnet-4-6', 'claude-haiku-4-5'];
    const payload = { text: message };
    if (model && allowed.includes(model)) payload.model = model;
    const body = JSON.stringify(payload);
    const req = http.request({
      hostname: 'localhost', port: 6060,   // ← FRONTEND
      path: `/api/chat/threads/${threadId}/stream`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'x-malika-uid': uid,
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 180000,  // 3 min — frontend has 300s proxy timeout
    }, (res) => {
      let raw = '';
      let content = '';
      let tokens = null;
      let smartContext = null;
      let tier = null;

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
            if (eventName === 'text') content = data.content || content;
            if (eventName === 'text_delta') content += data.text || '';
            if (eventName === 'malika_ui') {
              tokens = data.metadata?.tokens || null;
              smartContext = data.metadata?.smartContext || null;
              tier = data.metadata?.tier || null;
            }
          } catch {}
        }
        resolve({ content, tokens, smartContext, tier, rawLength: raw.length });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('Stream timeout')); });
    req.write(body);
    req.end();
  });
}

// ─── Test cases ─────────────────────────────────────────────────────

const ALL_QUERIES = [
  {
    label: 'T1: Hotel occupancy rate (73.8% deep, page 558/750)',
    text: 'berapa tingkat penghunian kamar hotel bintang di maluku utara tahun 2024?',
    groundTruth: 'Sept: 52,24%, Des: 49,00%, Jan: 35,38%',
    checkWords: ['52,24', '49,00', '47,89', '35,38'],
  },
  {
    label: 'T2: Restaurant count per kab/kota (73.8% deep, page 559/750)',
    text: 'berapa jumlah rumah makan restoran di maluku utara per kabupaten kota 2024?',
    groundTruth: 'Kota Ternate: 207, Total: 663, Halsel: 79, Haltim: 67',
    checkWords: ['207', '663', '75', '90', '67'],
  },
  {
    label: 'T3: PDRB harga berlaku by sector (88.8% deep, page 662/750)',
    text: 'berapa PDRB harga berlaku pertambangan dan industri pengolahan maluku utara 2024?',
    groundTruth: 'Pertambangan: 17.741,97, Industri: 32.487,41',
    checkWords: ['17.74', '32.487'],
  },
  {
    label: 'T4: Drinking water source (41% deep in doc 866, Kesejahteraan)',
    text: 'sumber air minum rumah tangga per kabupaten kota maluku utara 2024?',
    groundTruth: 'Kota Ternate: 59,19% kemasan, Maluku Utara: 33,63%, Halteng: 52,88%',
    checkWords: ['59,19', '33,63', '52,88'],
  },
  {
    label: 'T5: Housing floor material (deep in yearbook/Kesejahteraan)',
    text: 'bahan bangunan utama lantai rumah per kabupaten kota di maluku utara 2024?',
    groundTruth: 'Percentage data from Table 4.3.7 or Table 6.7 (floor materials)',
    checkWords: ['tanah', 'Ternate'],
  },
  {
    label: 'T6: Rice production by kab/kota (BRS 161 or MDAA Table 5.1.1)',
    text: 'berapa produksi padi per kabupaten kota di maluku utara 2024?',
    groundTruth: 'BRS Jan-Sep: 27.408/17.145/3.679 OR Yearbook: 31.232/17.555/7.631',
    checkWords: ['17.145', '27.408', '3.679', '31.232', '17.555', '7.631'],
    minMatch: 2,
  },
  {
    label: 'T7: PLN electricity production (67.6% deep, page 510/750, doc 855)',
    text: 'berapa produksi listrik PLN per kabupaten kota di maluku utara 2024?',
    groundTruth: 'Ternate: 253.646.951, Halut: 104.233.438, Haltim: 78.702.871 KWh',
    checkWords: ['253.646', '104.233', '78.702'],
  },
  {
    label: 'T8: Labor force per kab/kota Aug 2024 (doc 847, standalone publication)',
    text: 'berapa jumlah penduduk bekerja dan pengangguran per kabupaten kota maluku utara agustus 2024?',
    groundTruth: 'Ternate bekerja: 94.543, MalUt pengangguran: 27.747, MalUt bekerja: 661.488',
    checkWords: ['94.543', '27.747', '661.488'],
    minMatch: 2,
  },
  {
    label: 'T9: TK school count per kab/kota (36.5% deep, page 207/750, doc 855)',
    text: 'berapa jumlah sekolah taman kanak-kanak per kabupaten kota di maluku utara?',
    groundTruth: 'New: MalUt 665, Ternate 83 OR Old: MalUt 661, Ternate 102',
    checkWords: ['665', '83', '115', '63', '661', '102', '114', '36'],
    minMatch: 3,
  },
  {
    label: 'T10: Puskesmas count per kab/kota 2024 (41.6% deep, page 262/750, doc 855)',
    text: 'berapa jumlah puskesmas per kabupaten kota di maluku utara tahun 2024?',
    groundTruth: 'MalUt: 153, HalSel: 32, Ternate: 11, Morotai: 13',
    checkWords: ['153', '32', '11', '13'],
    minMatch: 3,
  },
  {
    label: 'T11: Morbidity rate per kab/kota 2025 (32.6% deep, doc 833, Kesejahteraan 2025)',
    text: 'berapa angka kesakitan menurut kabupaten kota di maluku utara 2025?',
    groundTruth: 'MalUt: 7,36%, HalSel: 9,30%, Ternate: 6,29%, HalTim: 8,15%',
    checkWords: ['7,36', '9,30', '6,29', '8,15'],
    minMatch: 3,
  },
];

// ─── Quick mode: pick 3 diverse tests ───────────────────────────────
const QUICK_INDICES = [0, 6, 10]; // T1 (hotel), T7 (electricity), T11 (morbidity)

async function main() {
  const isQuick = process.argv.includes('--quick');
  const queries = isQuick
    ? QUICK_INDICES.map(i => ALL_QUERIES[i])
    : ALL_QUERIES;

  const uid = `fe-deep-test-${Date.now()}`;

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  DEEP DOCUMENT RETRIEVAL TEST — VIA FRONTEND (port 6060)');
  console.log(isQuick ? '  MODE: --quick (3 tests)' : `  MODE: full (${queries.length} tests)`);
  console.log('  Route: Frontend API → Next.js proxy → Express backend');
  console.log('═══════════════════════════════════════════════════════════');

  const results = [];

  for (const q of queries) {
    console.log(`\n── ${q.label} ──`);
    console.log(`  Query: "${q.text}"`);
    console.log(`  Ground Truth: ${q.groundTruth}`);

    // Create thread through frontend
    const threadRes = await httpPost(
      `${FRONTEND_BASE}/api/chat/threads`,
      {},
      { 'x-malika-uid': uid }
    );
    if (!threadRes.ok) {
      console.log(`  ❌ Thread creation failed: ${JSON.stringify(threadRes).slice(0, 200)}`);
      results.push({ label: q.label, passed: false, error: 'thread_fail' });
      continue;
    }

    const threadId = threadRes.thread?.id;
    console.log(`  🧵 Thread #${threadId}`);

    const start = Date.now();
    let r;
    try {
      r = await sseChat(threadId, q.text, uid, 'gpt-4.1');
    } catch (e) {
      console.log(`  ❌ Stream failed: ${e.message}`);
      results.push({ label: q.label, passed: false, error: e.message });
      continue;
    }
    const ms = Date.now() - start;

    const sc = r.smartContext || {};
    console.log(`  ⏱️  ${(ms / 1000).toFixed(1)}s | Tier: ${r.tier || '?'} | IN=${r.tokens?.input || '?'} OUT=${r.tokens?.output || '?'}`);
    console.log(`  🎯 SmartCtx: maxDocs=${sc.maxDocs || '-'} perDoc=${sc.perDocChars || '-'} budget=${sc.totalBudget || '-'}`);

    // Accuracy check
    const contentLower = r.content.toLowerCase();
    const found = q.checkWords.filter(w => contentLower.includes(w.toLowerCase()));
    const missed = q.checkWords.filter(w => !contentLower.includes(w.toLowerCase()));
    const requiredMatch = q.minMatch || q.checkWords.length;
    const passed = found.length >= requiredMatch;

    console.log(`  ${passed ? '✅' : '❌'} Found: ${found.length}/${q.checkWords.length} ground truth values (need ≥${requiredMatch}): [${found.join(', ')}]`);
    if (missed.length > 0 && !passed) {
      console.log(`  ❌ Missing: [${missed.join(', ')}]`);
    }

    // Print first 500 chars of response for inspection
    const preview = r.content.length > 500
      ? r.content.slice(0, 500) + `... (${r.content.length} chars total)`
      : r.content;
    console.log(`  📝 Response: ${preview}`);

    results.push({
      label: q.label,
      tier: r.tier,
      inputTokens: r.tokens?.input || 0,
      outputTokens: r.tokens?.output || 0,
      timeMs: ms,
      found: found.length,
      total: q.checkWords.length,
      requiredMatch,
      passed,
    });
  }

  // ── Summary ─────────────────────────────────────────────────────
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('  SUMMARY (Frontend Route)');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('Test                                            | Tier    | Time   | Accuracy | Status');
  console.log('──────────────────────────────────────────────────────────────────────────────────────');
  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    const label = r.label.padEnd(47);
    const tier = (r.tier || r.error || '-').padEnd(7);
    const time = r.timeMs ? `${(r.timeMs / 1000).toFixed(1)}s`.padStart(6) : '  err ';
    const acc = r.total ? `${r.found}≥${r.requiredMatch}`.padStart(8) : '   -/- ';
    console.log(`${icon} ${label} | ${tier} | ${time} | ${acc} | ${r.passed ? 'PASS' : 'FAIL'}`);
  }

  const totalPassed = results.filter(r => r.passed).length;
  const totalTests = results.length;
  const avgTime = results.filter(r => r.timeMs).reduce((s, r) => s + r.timeMs, 0) / (results.filter(r => r.timeMs).length || 1);

  console.log(`\n🏁 Overall: ${totalPassed}/${totalTests} tests passed | Avg: ${(avgTime / 1000).toFixed(1)}s per query`);
  console.log(`   Route: localhost:6060 (frontend) → localhost:5000 (backend)`);

  if (totalPassed === totalTests) {
    console.log('\n✅ ALL TESTS PASSED — frontend deployment verified!');
  } else {
    console.log(`\n⚠️  ${totalTests - totalPassed} test(s) failed — check above for details`);
  }

  console.log('\n═══════════════════════════════════════════════════════════');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
