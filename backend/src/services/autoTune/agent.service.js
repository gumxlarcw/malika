'use strict';
/**
 * Auto Tune agentic loop via malika-llm-proxy /v1/chat/completions + pseudo-tool-use.
 *
 * The proxy uses `claude -p` CLI subprocess with OAuth subscription billing
 * (preserves Claude Pro/Team plan instead of pay-per-token). The CLI doesn't
 * support arbitrary external tool_use, so we emulate it: model emits tool
 * calls as JSON in fenced code blocks, we parse + dispatch + feed result back.
 *
 * Sessions: each Auto Tune job uses X-Chat-Session-Id='auto-tune-<jobId>' so
 * the proxy's worker pool keeps the claude CLI warm across the 4-8 agentic
 * turns (saves ~10s per turn after the first cold start).
 */
const axios = require('axios');
const { createToolset } = require('./tools');

const PROXY_URL = process.env.AUTO_TUNE_PROXY_URL || 'http://127.0.0.1:3031';
const MAX_STEPS = 8;
const MAX_PARSE_RETRIES = 2;

const TOOL_DOCS = `Available tools (each takes a JSON args object — empty {} if no args):

read_flag() — Read full flag context. CALL THIS FIRST.

search_existing_patterns({keywords: string[]}) — Find active patterns with overlapping trigger keywords. Use to avoid duplicating an existing fix.

search_knowledge_base({query: string, limit?: number}) — Vector-search knowledge_base for similar content via xenova embedder.

propose_pattern({name, type, keywords, fix_type, fix_content, canonical_query})
  - type: one of query_pattern | data_pattern | context_pattern | hallucination_pattern | prompt_issue
  - keywords: array of trigger strings (Indonesian)
  - fix_type: one of add_to_prompt | special_handling
  - fix_content: the actual guidance text injected into chat (Indonesian, <280 chars, specific)
  - canonical_query: a real query (use the flagged user_query verbatim) that this pattern should fire on
  Stages a pattern with is_active=true; will be subject to regression check.

propose_kb_correction({title: string, content: string}) — Stage a knowledge_base correction (category=koreksi). Will be indexed via xenova.

run_regression_and_commit() — Run regression eval on all currently-staged changes. Returns ok+committed:true OR ok:false with failure list. Call ONCE after staging proposals. If fail, you may revise (max 1 retry) or abandon.

abandon({reason: string}) — Give up. Rolls back any staged changes. Use when no fix is suitable (e.g. flag requires code changes, missing data, ambiguous intent).`;

const OUTPUT_PROTOCOL = `Output protocol:

To call a tool, output your reasoning in plain text, then end your response with a fenced JSON block:

\`\`\`json
{"tool": "<tool_name>", "args": {<args>}}
\`\`\`

EXACTLY ONE tool call per turn. The next user message will be the tool result, formatted as: {"tool_result": "<tool_name>", "data": <return value>}.

After staging proposals, you MUST call run_regression_and_commit. If it returns ok:false, either revise (call propose_* again then re-run regression) or call abandon.`;

function extractToolCall(responseText) {
  // Find first fenced json block. Tolerant of ```json, ```JSON, ``` (no lang).
  const fenced = responseText.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (!fenced) return { error: 'no_fenced_json' };
  let parsed;
  try {
    parsed = JSON.parse(fenced[1].trim());
  } catch (e) {
    return { error: 'bad_json', detail: e.message, raw: fenced[1].slice(0, 200) };
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.tool) {
    return { error: 'missing_tool_field' };
  }
  return { tool: String(parsed.tool), args: parsed.args || {} };
}

async function callProxy({ messages, sessionId, model, maxTokens = 1024 }) {
  const res = await axios.post(
    `${PROXY_URL}/v1/chat/completions`,
    { model, messages, max_tokens: maxTokens },
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Chat-Session-Id': sessionId,
      },
      timeout: 120000,
    }
  );
  const content = res.data?.choices?.[0]?.message?.content || '';
  const usage = res.data?.usage || {};
  return {
    content: String(content),
    inputTokens: usage.prompt_tokens || 0,
    outputTokens: usage.completion_tokens || 0,
  };
}

async function runAgent({ jobId, flagId, model }) {
  const jobContext = { jobId, flagId, stagedPatternIds: [], stagedKbIds: [], log: [] };
  const toolset = createToolset(jobContext);

  // Pre-fetch flag for system prompt context
  const initialFlag = await toolset.read_flag();

  const systemPrompt = `You are an Auto Tune agent for MALIKA — the Indonesian BPS (Badan Pusat Statistik) statistics chatbot for Maluku Utara province.

A user-facing chat response was flagged as bad. Your job: investigate the flag, propose a fix (add a pattern OR add a knowledge_base correction), then run regression to validate.

You have up to ${MAX_STEPS} turns. After staging your proposed changes, you MUST call run_regression_and_commit. If it fails, you may revise (max 1 retry) or abandon with a clear reason.

Fix shapes:
- pattern with fix_type=add_to_prompt: text injected into chat system prompt when user query matches trigger keywords
- pattern with fix_type=special_handling: text injected with [SPECIAL HANDLING] prefix
- knowledge_base correction (category=koreksi): factual content indexed into retrieval_chunks

The flagged interaction (already fetched):
${JSON.stringify(initialFlag, null, 2)}

${TOOL_DOCS}

${OUTPUT_PROTOCOL}

If unfixable at the pattern/KB layer (requires code changes, missing source data, or ambiguous intent), call abandon with a clear reason.

Output preferences:
- Indonesian language for fix_content (matches MALIKA's audience)
- Concise (under 280 chars per fix_content)
- Specific to the flagged scenario (avoid generic advice like "give complete answers")`;

  const sessionId = `auto-tune-${jobId}`;
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Investigate this flag and apply a fix. Start by calling read_flag if you need more context, otherwise propose a fix based on the data above.' },
  ];

  let totalInput = 0;
  let totalOutput = 0;
  let finalResult = null;
  let parseRetries = 0;

  for (let step = 0; step < MAX_STEPS; step++) {
    const { content, inputTokens, outputTokens } = await callProxy({ messages, sessionId, model });
    totalInput += inputTokens;
    totalOutput += outputTokens;
    messages.push({ role: 'assistant', content });

    const parsed = extractToolCall(content);

    if (parsed.error) {
      if (parseRetries >= MAX_PARSE_RETRIES) {
        await toolset.abandon({ reason: `model emitted ${parseRetries + 1} unparseable responses; last error: ${parsed.error}` });
        finalResult = { kind: 'abandoned', reason: `parser failure (${parsed.error})` };
        break;
      }
      parseRetries += 1;
      messages.push({
        role: 'user',
        content: `Your previous response could not be parsed as a tool call (${parsed.error}${parsed.detail ? ': ' + parsed.detail : ''}). Please respond with ONE tool call as a fenced JSON block: \`\`\`json\n{"tool":"<name>","args":{...}}\n\`\`\``,
      });
      continue;
    }

    parseRetries = 0;
    const fn = toolset[parsed.tool];
    if (!fn) {
      messages.push({
        role: 'user',
        content: JSON.stringify({ tool_result: parsed.tool, error: `Unknown tool: ${parsed.tool}` }),
      });
      continue;
    }

    let toolOutput;
    try {
      toolOutput = await fn(parsed.args || {});
    } catch (e) {
      toolOutput = { error: e.message };
    }

    messages.push({
      role: 'user',
      content: JSON.stringify({ tool_result: parsed.tool, data: toolOutput }).slice(0, 8000),
    });

    if (parsed.tool === 'run_regression_and_commit' && toolOutput?.committed) {
      finalResult = { kind: 'committed', result: toolOutput };
      break;
    }
    if (parsed.tool === 'abandon') {
      finalResult = { kind: 'abandoned', reason: parsed.args?.reason || '(no reason given)' };
      break;
    }
  }

  if (!finalResult) {
    await toolset.abandon({ reason: `max steps (${MAX_STEPS}) exceeded without commit` });
    finalResult = { kind: 'abandoned', reason: `max steps (${MAX_STEPS}) exceeded` };
  }

  return {
    finalResult,
    totalInput,
    totalOutput,
    toolLog: jobContext.log,
    stagedPatternIds: jobContext.stagedPatternIds,
    stagedKbIds: jobContext.stagedKbIds,
  };
}

module.exports = { runAgent, extractToolCall };
