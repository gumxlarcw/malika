'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { heuristicScore } = require('../scoring');
const { request } = require('../httpClient');

const FIXTURE_PATH = path.join(__dirname, '..', '..', 'fixtures', 'chat-cases.json');
const EVAL_UID = 'eval-runner-system';

function loadFixture() {
  const raw = fs.readFileSync(FIXTURE_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  return parsed.cases;
}

async function createThread(apiBase) {
  const res = await request('POST', new URL('/chat/threads', apiBase).toString(), {
    body: { title: `eval-${Date.now()}` },
    timeoutMs: 30000,
    headers: { 'x-malika-uid': EVAL_UID },
  });
  if (!res.data?.thread?.id) throw new Error(`Failed to create thread: ${JSON.stringify(res.data)}`);
  return res.data.thread.id;
}

// LIFTED from run-eval.js sendMessageStreaming — signature adapted to accept apiBase + verbose
function sendMessageStreaming(threadId, text, apiBase, verbose = false, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const url = new URL(`/chat/threads/${threadId}/stream`, apiBase);
    const body = JSON.stringify({ text });

    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Accept-Encoding': 'identity',  // disable gzip — raw SSE text
        'Connection': 'keep-alive',     // SSE requires persistent connection
        'x-malika-uid': EVAL_UID,
      },
    };

    let fullContent = '';
    let model = '';
    let tokensIn = 0;
    let tokensOut = 0;
    let rawBuf = '';
    let chunkCount = 0;
    let totalBytes = 0;
    let gotDone = false;

    const req = http.request(opts, (res) => {
      if (res.statusCode !== 200) {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve({ content: '', latencyMs: Date.now() - start, error: `HTTP ${res.statusCode}: ${data}` });
        });
        return;
      }

      res.setEncoding('utf8'); // ensure string chunks, not Buffers

      res.on('data', (chunk) => {
        chunkCount++;
        totalBytes += chunk.length;
        rawBuf += chunk;
        // Parse SSE events: "event: <name>\ndata: <json>\n\n"
        const parts = rawBuf.split('\n\n');
        rawBuf = parts.pop() || ''; // keep incomplete event

        for (const part of parts) {
          const lines = part.split('\n');
          let eventName = '';
          let dataStr = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) eventName = line.slice(7).trim();
            else if (line.startsWith('data: ')) dataStr = line.slice(6);
          }
          if (!dataStr) continue;

          try {
            const evt = JSON.parse(dataStr);
            if (eventName === 'text' && evt.content) {
              fullContent += evt.content;
            } else if (eventName === 'done') {
              gotDone = true;
              if (evt.full_text) fullContent = evt.full_text; // use authoritative full text
              model = evt.model || model;
              tokensIn = evt.tokens_in || tokensIn;
              tokensOut = evt.tokens_out || tokensOut;
            } else if (eventName === 'error') {
              fullContent += `[Error: ${evt.message || 'unknown'}]`;
            }
          } catch {
            // ignore parse failures
          }
        }
      });

      res.on('end', () => {
        // Flush remaining buffer (last event may not end with \n\n)
        if (rawBuf.trim()) {
          const lines = rawBuf.split('\n');
          let eventName = '';
          let dataStr = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) eventName = line.slice(7).trim();
            else if (line.startsWith('data: ')) dataStr = line.slice(6);
          }
          if (dataStr) {
            try {
              const evt = JSON.parse(dataStr);
              if (eventName === 'text' && evt.content) fullContent += evt.content;
              else if (eventName === 'done' && evt.full_text) {
                gotDone = true;
                fullContent = evt.full_text;
              }
            } catch {}
          }
        }
        if (verbose && !gotDone) {
          console.log(`\n   [SSE-DEBUG] NO done event! chunks=${chunkCount} bytes=${totalBytes} contentLen=${fullContent.length} rawBufLeft=${rawBuf.length}`);
        }
        resolve({
          content: fullContent,
          model,
          tokensIn,
          tokensOut,
          latencyMs: Date.now() - start,
          _debug: { chunkCount, totalBytes, gotDone },
        });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Streaming request timeout after ${timeoutMs}ms`));
    });
    req.on('error', (err) => {
      resolve({ content: fullContent || '', latencyMs: Date.now() - start, error: err.message });
    });

    req.write(body);
    req.end();
  });
}

async function sendMessage(threadId, text, apiBase, verbose = false) {
  if (verbose) console.log(`   [DEBUG] sendMessage: starting SSE request...`);
  const streamResult = await sendMessageStreaming(threadId, text, apiBase, verbose);
  if (verbose) console.log(`   [DEBUG] sendMessage: SSE returned content=${streamResult.content?.length || 0} error=${streamResult.error || 'none'} gotDone=${streamResult._debug?.gotDone}`);
  if (streamResult.content && !streamResult.error) {
    return streamResult;
  }

  if (verbose) console.log(`   [DEBUG] sendMessage: falling back to non-streaming...`);
  // Fallback to non-streaming
  const start = Date.now();
  const res = await request(
    'POST',
    new URL(`/chat/threads/${threadId}/messages`, apiBase).toString(),
    { body: { text }, headers: { 'x-malika-uid': EVAL_UID } }
  );
  const latencyMs = Date.now() - start;
  if (verbose) console.log(`   [DEBUG] sendMessage: non-streaming status=${res.status} hasAssistant=${!!res.data?.assistant}`);

  if (!res.data?.assistant) {
    return { content: '', latencyMs, error: res.data?.message || 'No assistant response' };
  }
  return {
    content: res.data.assistant.content || '',
    model: res.data.assistant.model,
    tokensIn: res.data.assistant.tokens_in,
    tokensOut: res.data.assistant.tokens_out,
    latencyMs,
  };
}

async function runCase(testCase, ctx) {
  const { apiBase, verbose } = ctx;
  const threadId = await createThread(apiBase);
  if (verbose) console.log(`\n   [DEBUG] Sending to thread ${threadId}...`);
  const response = await sendMessage(threadId, testCase.query, apiBase, verbose);
  if (verbose) console.log(`   [DEBUG] Got response: contentLen=${response.content?.length || 0} error=${response.error || 'none'} latency=${response.latencyMs}ms`);
  if (response.error) {
    return {
      id: testCase.id,
      category: testCase.category,
      query: testCase.query,
      response: { latencyMs: response.latencyMs },
      score: { composite: 0, grade: 'F', error: response.error },
    };
  }
  const score = heuristicScore(response, testCase.expect);
  return {
    id: testCase.id,
    category: testCase.category,
    query: testCase.query,
    response: {
      content: response.content.slice(0, 1500),
      model: response.model,
      tokensIn: response.tokensIn,
      tokensOut: response.tokensOut,
      latencyMs: response.latencyMs,
    },
    score,
  };
}

function summarize(results) {
  const grades = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  const byCategory = {};
  let sum = 0;
  let latencySum = 0;
  let latencyCount = 0;
  const latencies = [];

  for (const r of results) {
    const g = r.score?.grade || 'F';
    grades[g]++;
    sum += r.score?.composite || 0;
    if (r.response?.latencyMs) {
      latencySum += r.response.latencyMs;
      latencyCount++;
      latencies.push(r.response.latencyMs);
    }
    const cat = r.category || 'unknown';
    if (!byCategory[cat]) byCategory[cat] = { total: 0, passed: 0, sum: 0 };
    byCategory[cat].total++;
    byCategory[cat].sum += r.score?.composite || 0;
    if (g === 'A' || g === 'B') byCategory[cat].passed++;
  }

  for (const cat of Object.keys(byCategory)) {
    byCategory[cat].score = byCategory[cat].total > 0
      ? Math.round((byCategory[cat].sum / byCategory[cat].total) * 1000) / 1000
      : 0;
  }

  const passed = grades.A + grades.B;
  const overall = results.length > 0 ? Math.round((sum / results.length) * 1000) / 1000 : 0;
  latencies.sort((a, b) => a - b);
  const p95 = latencies.length ? latencies[Math.floor(latencies.length * 0.95)] : 0;

  return {
    cases_total: results.length,
    cases_passed: passed,
    overall_score: overall,
    grades,
    by_category: byCategory,
    mean_latency_ms: latencyCount ? Math.round(latencySum / latencyCount) : 0,
    p95_latency_ms: p95,
  };
}

module.exports = { name: 'chat', loadFixture, runCase, summarize, sendMessageStreaming };
