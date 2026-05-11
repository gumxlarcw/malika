'use strict';
/**
 * Auto Tune agentic loop using Anthropic Messages API + tool_use.
 *
 * Up to MAX_STEPS tool-use round trips. Each step:
 *   1. Send messages to Anthropic
 *   2. Inspect response.content for tool_use blocks
 *   3. Call each tool via createToolset(jobContext)
 *   4. Feed tool_result blocks back as the next user turn
 *   5. Stop on text-only response, commit, abandon, or max steps.
 */

// SDK shape (v0.95.1): module is itself a constructor function; .default and
// .Anthropic also exist. Triple-fallback resolves to .default first.
const Anthropic = require('@anthropic-ai/sdk').default
                  || require('@anthropic-ai/sdk').Anthropic
                  || require('@anthropic-ai/sdk');

const { createToolset } = require('./tools');

const MAX_STEPS = 8;
const MAX_TOKENS_PER_CALL = 1024;

const TOOLS_SCHEMA = [
  { name: 'read_flag', description: 'Read the full context of the flagged chat interaction (user_query, assistant_response, last 4 thread messages, context_snapshot). Call this FIRST to understand what went wrong.',
    input_schema: { type: 'object', properties: {} }},
  { name: 'search_existing_patterns', description: 'Find active patterns whose trigger_keywords overlap with provided keywords. Use this to avoid duplicating an existing fix.',
    input_schema: { type: 'object', properties: { keywords: { type: 'array', items: { type: 'string' }}}, required: ['keywords']}},
  { name: 'search_knowledge_base', description: 'Vector-search the knowledge_base (corrections + BRS articles) for similar content. Use to see if relevant info exists.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', default: 5 }}, required: ['query']}},
  { name: 'propose_pattern', description: 'Stage a new pattern. Will be subject to regression check before going live.',
    input_schema: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string', enum: ['query_pattern', 'data_pattern', 'context_pattern', 'hallucination_pattern', 'prompt_issue'] }, keywords: { type: 'array', items: { type: 'string' }}, fix_type: { type: 'string', enum: ['add_to_prompt', 'special_handling'] }, fix_content: { type: 'string' }, canonical_query: { type: 'string', description: 'A real query that this pattern should fire on (use the flagged user_query verbatim)' }}, required: ['name','type','keywords','fix_type','fix_content','canonical_query']}},
  { name: 'propose_kb_correction', description: 'Stage a knowledge_base correction (category=koreksi). Will be indexed via xenova.',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' }}, required: ['title','content']}},
  { name: 'run_regression_and_commit', description: 'Run regression eval on all currently-staged changes. If pass, commits. If fail, rollback and return failure list; you may revise OR abandon.',
    input_schema: { type: 'object', properties: {} }},
  { name: 'abandon', description: 'Give up. Use when no fix is suitable. Rolls back any staged changes.',
    input_schema: { type: 'object', properties: { reason: { type: 'string' }}, required: ['reason']}},
];

async function runAgent({ jobId, flagId, model }) {
  const jobContext = { jobId, flagId, stagedPatternIds: [], stagedKbIds: [], log: [] };
  const toolset = createToolset(jobContext);

  const initialFlag = await toolset.read_flag();

  const systemPrompt = `You are an Auto Tune agent for MALIKA — the Indonesian BPS (Badan Pusat Statistik) statistics chatbot for Maluku Utara province.

A user-facing chat response was flagged as bad. Your job: investigate the flag, propose a fix (add a pattern OR add a knowledge_base correction), then run regression to validate.

You have up to ${MAX_STEPS} tool-use steps. After staging your proposed changes, you MUST call run_regression_and_commit. If it fails, you may revise (max 1 retry) or abandon with a clear reason.

Fix shapes:
- pattern with fix_type=add_to_prompt: text injected into chat system prompt when user query matches trigger keywords
- pattern with fix_type=special_handling: text injected with [SPECIAL HANDLING] prefix
- knowledge_base correction (category=koreksi): factual content indexed into retrieval_chunks

The flagged interaction:
${JSON.stringify(initialFlag, null, 2)}

If unfixable at the pattern/KB layer (requires code changes, missing data, ambiguous intent), call abandon with a clear reason.

Output preferences:
- Indonesian language for fix_content
- Concise (under 280 chars per fix_content)
- Specific to the flagged scenario (avoid generic advice)`;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const messages = [{ role: 'user', content: 'Investigate this flag and apply a fix using the available tools.' }];
  let totalInput = 0;
  let totalOutput = 0;
  let finalResult = null;

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS_PER_CALL,
      system: systemPrompt,
      tools: TOOLS_SCHEMA,
      messages,
    });

    totalInput += response.usage?.input_tokens || 0;
    totalOutput += response.usage?.output_tokens || 0;
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') {
      const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      finalResult = { kind: 'no_tool', text };
      break;
    }

    const toolUses = response.content.filter((b) => b.type === 'tool_use');
    const toolResults = [];
    for (const tu of toolUses) {
      const fn = toolset[tu.name];
      if (!fn) {
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: `Tool ${tu.name} not found`, is_error: true });
        continue;
      }
      try {
        const out = await fn(tu.input || {});
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out).slice(0, 8000) });
        if (tu.name === 'run_regression_and_commit' && out.committed) finalResult = { kind: 'committed', result: out };
        if (tu.name === 'abandon') finalResult = { kind: 'abandoned', reason: tu.input?.reason };
      } catch (e) {
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: `Error: ${e.message}`, is_error: true });
      }
    }
    messages.push({ role: 'user', content: toolResults });
    if (finalResult) break;
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

module.exports = { runAgent };
