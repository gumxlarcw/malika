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
| 2026-05-16 | Add OPENAI_API_URL to frontend env; document fallback asymmetry vs backend requireProxyUrl | frontend/.env.production.local, frontend/src/app/api/insights/route.ts |
| 2026-03-02 | DocumentJudge optimization (candidates 50→20, high-confidence bypass) | documentJudge.service.js |
| 2026-03-02 | Fix skipRerank passthrough chain | knowledgeSearch.service.js, multiStrategySearch.service.js |
| 2026-03-02 | Supervisor JSON parse fix (Gemini markdown fences) | supervisor.service.js |
| 2026-03-02 | Initial audit. All tiers using claude-sonnet-4-6 | - |
