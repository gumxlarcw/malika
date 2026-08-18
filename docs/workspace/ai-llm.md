# AI & LLM — Project Line

> Last updated: 2026-03-02

## Current State
- **Primary model**: claude-sonnet-4-6 (all tiers)
- **Proxy**: malika-llm-proxy (:3031) — terpisah dari openclaw
- **Fallback**: Google Gemini (10-key rotation)
- **Anthropic token**: oat01 (sk-ant-oat01-eJX...)

## Architecture
```
pds-backend → http://127.0.0.1:3031/v1/chat/completions → malika-llm-proxy
  → Anthropic API (claude-sonnet-4-6)
  → fallback: Google Gemini (10 keys, rotation)
```

## Why frontend keeps a hardcoded proxy URL fallback

Backend services (`backend/src/utils/requireProxyUrl.js`) throw at module
load if `OPENAI_API_URL` is missing. The Next.js `/api/insights` route
silently falls back to `http://127.0.0.1:3031/v1/chat/completions`
because Next server routes don't auto-load `backend/.env`. The fallback
is safe because the proxy is always co-located on this host. Both
codepaths target the same URL in practice.

## Google API Keys (10 working)
wisnucandragumelar, ipdsmalut, gumelarwork, perpustakaankaryapertiwi, saparysimon161, igbpssula, hasmanumakaapa40, irwandi.sula, taibannaji, bista.malut
**SUSPENDED**: socmedbpssula

## AI Services (backend/src/services/ai/)
- `openaiChat.service.js` — LLM call
- `embedding.service.js` — Text embeddings
- `vectorSearch.service.js` — Vector similarity (27K+ docs in memory)
- `multiStrategySearch.service.js` — Multi-strategy search
- `hybridSearch.service.js` — Vector + FULLTEXT hybrid
- `reranker.service.js` — Result reranking
- `queryBuilder.service.js` — SQL query via LLM
- `knowledgeDoc.service.js` — RAG document processing
- `documentJudge.service.js` — LLM-based doc ranking (MAX_CANDIDATES=20, high-confidence bypass ≥0.85)
- `contentFilter.service.js`
- `abbrevExpansion.service.js`, `synonymExpansion.service.js`, `keywordExtractor.service.js`
- `tableUnderstanding.service.js`, `visionOcr.service.js`
- `client/geminiKeyRotation.js` — Key rotation

## Allowed Models (chat validation)
`gemini-3-flash-preview`, `gemini-3-pro-preview`, `claude-sonnet-4-6`, `claude-haiku-4-5`

## DocumentJudge Optimization
- MAX_CANDIDATES_INPUT: 20 (was 50)
- windowSize: 200 chars (was 300)
- Content scan limit: 20K chars (was 50K)
- High-confidence bypass: if top similarity ≥ 0.85, skip LLM call entirely
- `skipRerank` flag threads through: publicationAgent → knowledgeSearch → multiStrategySearch → vectorSearch

## Change Log
| Date | Change | Files Affected |
|---|---|---|
| 2026-08-18 | **DeepSeek does emit a reasoning trace — it is just gated behind a request parameter.** Default output has no `reasoning` field, which is why the first pass concluded it was impossible. Three parameters unlock it on the NeuralWatt tier: `reasoning_effort`, `chat_template_kwargs.enable_thinking`, and `chat_template_kwargs.thinking`. We use `reasoning_effort: 'high'` — counter-intuitively the shortest and cheapest of the three levels here (4272 chars / 1614 output tokens / $0.000460, versus `low` rambling to 12626 chars and blowing a 4000-token budget without answering). The proxy needs no change: `handleNeuralWatt` spreads `{...body}` upstream, so the field passes through. Reasoning roughly doubles output tokens (1714 → 3483 on an A/B with identical prompt and ceiling). **`NEURALWATT_HTTP_TIMEOUT_MS` raised 60000 → 180000**: reasoning-enabled generations legitimately run ~85s, so the old ceiling killed them mid-flight and retried from scratch, turning a 31s answer into a 137s one and producing user-visible 503s. Also logged `err.code`/`err.syscall`/elapsed on NeuralWatt failures — of 46 sampled, 40 fail fast (<10s) with an empty `err.message`, and those remain uncharacterised. | `/opt/malika-llm-proxy/{src/index.js,.env}`, `backend/src/services/chat/streaming/{openaiClient,modelRouter.service}.js` |
| 2026-08-18 | **openclaw dependency cut from malika-llm-proxy.** Tier chain is now env-only (`PROXY_PRIMARY_TIER`); `loadOpenclawTier()` → `loadBaseTier()`, and the `fs.watch` on `~/.openclaw/openclaw.json` + `auth-profiles.json` is gone. `loadGoogleKeys()` no longer falls back to openclaw auth-profiles. Removed the two providers that authenticated through openclaw — `google-gemini-cli` (+ its `execCLI` helper) and `openai-codex` (+ `getOpenAIToken`, `OPENAI_RESPONSES_URL`). `handleClaudeCLI` stays: it serves the live `anthropic/claude-sonnet-4-6` backstop, not just `claude-cli`. `/debug/tier` now reports `tierSource: 'env:PROXY_PRIMARY_TIER'`. Chain then narrowed to DeepSeek only on request: `neuralwatt/deepseek-v4-flash → neuralwatt/deepseek-v4-flash-flex`, `PROXY_ALLOWED_PROVIDERS=neuralwatt`. The `-flex` variant is kept as a same-family fallback because NeuralWatt errors out on ~9% of requests (43/477) with a fast empty-message network error at random — a single-entry chain would surface every one as a 503. Measured cost $0.001024/turn, 87% of tokens on the input side. Reasoning is unavailable on this chain: of NeuralWatt's 19 models only `glm-5.2` emits a `reasoning` field (~16× the cost); `deepseek-v4-flash`, `deepseek-v4-flash-flex` and `openagentic/glm-5` emit none. Proxy suite 90/90. Also corrected stale OpenAI-era model defaults (`gpt-4.1`, `gpt-4.1-mini` → `claude-sonnet-4-6`) and pointed `autoTune`'s proxy address at `OPENAI_API_URL` so there is one address to change. | `/opt/malika-llm-proxy/src/index.js`, `/opt/malika-llm-proxy/.env`, `backend/src/services/chat/streaming/config.js`, `backend/src/services/chat/{streaming,chat}.service.js`, `backend/src/services/autoTune/agent.service.js` |
| 2026-05-16 | Add OPENAI_API_URL to frontend env; document fallback asymmetry vs backend requireProxyUrl | frontend/.env.production.local, frontend/src/app/api/insights/route.ts |
| 2026-03-02 | DocumentJudge optimization (candidates 50→20, high-confidence bypass) | documentJudge.service.js |
| 2026-03-02 | Fix skipRerank passthrough chain | knowledgeSearch.service.js, multiStrategySearch.service.js |
| 2026-03-02 | Supervisor JSON parse fix (Gemini markdown fences) | supervisor.service.js |
| 2026-03-02 | Initial audit. All tiers using claude-sonnet-4-6 | - |
