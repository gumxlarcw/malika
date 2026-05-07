# MALIKA Pipeline Simplification Proposal

**Date**: 2026-02-26 (updated 2026-02-27)  
**Status**: Research / Proposal — Option D recommended, prototype-first approach

---

## Executive Summary

This document evaluates whether MALIKA's current 17-agent, 10-stage chat pipeline can be simplified to a **single Master Agent with tool-calling** that searches 3 knowledge bases (Datasource, BRS/Publication, Non-statistical context) — without losing functionality or accuracy.

**Verdict (Updated 2026-02-27)**: **Option D — Master Agent + Agentic Sub-Agents with Maximum Parallelism** is now recommended. This architecture uses a single Main Agent brain that commands 3 specialized sub-agents (Datasource, Publication KB, Non-Statistical KB) running in parallel. Each sub-agent has its own LLM for intelligent search, ranking, and iterative retrieval — critically solving the **unstable publication retrieval problem** where 300-page BPS documents produce inconsistent results with pure embedding/cosine search.

This reduces sequential wait points from 5-7 → **3**, maintains 5-6 LLM calls per typical query (vs 8-10 current), and achieves **~10.5s latency** with significantly higher accuracy on publication/BRS queries.

Previous recommendation (Option B) prioritized cost savings but sacrificed accuracy on complex publication retrieval. With cost no longer a constraint, Option D maximizes accuracy through LLM-powered sub-agents while minimizing latency through aggressive parallelism.

---

## 1. Current Architecture — Complexity Audit

### 1.1 LLM Call Count Per Query

| Scenario | LLM Calls | Embedding Calls | Total API | Est. Latency |
|----------|-----------|-----------------|-----------|-------------|
| Greeting/Chitchat | 1 (gate) | 0 | **1** | ~1.5s |
| Fast-path data | 1+0+0+1+1+1 | 0 | **4** | ~5s |
| **Typical data query** | gate+syn+QB+syn(KB)+judge+stream+sup+sugg | 2-3 emb | **8-10** | ~12s |
| + reranker + reconciler | above + reranker + reconciler + chart | same | **11-13** | ~18s |
| Complex analytical | above + planner + 2-4 workers | same | **14-17** | ~25s |
| **Maximum possible** | all optional triggers | 3 emb | **~20** | ~35s |

### 1.2 Current 17 LLM Agents (by function)

| # | Agent | Model | Purpose | Can Merge? |
|---|-------|-------|---------|------------|
| 1 | **Gate Agent** | gpt-5-mini | Route classification | ⚠️ Keep (safety) |
| 2 | **Synonym Expansion (DS)** | gpt-5-mini | Datasource search synonyms | ✅ Merge into tool |
| 3 | **Synonym Expansion (KB)** | gpt-5-mini | KB search synonyms | ✅ Merge into tool |
| 4 | **Query Builder** | gpt-5-mini | NL → API params | ✅ Merge into tool |
| 5 | **Reranker** | gpt-5-mini | Rerank datasource candidates | ✅ Merge into tool |
| 6 | **Document Judge** | gpt-4.1 | Filter/rank KB docs | ✅ Merge into tool |
| 7 | **Reconciler** | gpt-4.1 | Cross-source overlap | ✅ Merge into stream prompt |
| 8 | **Chart Agent** | gpt-4.1 | Chart config generation | ✅ Merge into stream |
| 9 | **Orchestrator Planner** | gpt-4.1 | Decompose complex queries | ✅ Merge into stream |
| 10-13 | **Orchestrator Workers** | gpt-4.1 | Sub-question answering | ✅ Merge into stream |
| 14 | **Main Stream** | gpt-5-mini | User-facing response | 🔒 Core (keep) |
| 15 | **Supervisor** | gpt-5-mini | BPS compliance check | ⚠️ Keep (quality) |
| 16 | **Suggestions** | gpt-4.1 | Follow-up question gen | ✅ Merge into stream |
| 17 | **Compaction** | gpt-5-mini | History summarization | 🔒 Independent (keep) |

### 1.3 Non-LLM Stages (Rule-based, must keep)

| Stage | What it does | LLM? |
|-------|-------------|------|
| stageValidate | Thread ownership, save message | No |
| stageContext | Load history, merge follow-ups | No |
| stageNormalize | Typo fix, year/geo inference | No |
| stageDnaPreEnrich | BPS metadata API lookup | No (external API) |
| stagePreview | DB/cache data table fetch | No |
| enrichKnowledgeWithExtraction | Indicator-guided extraction | No |
| checkTableRelevance | Keyword overlap check | No |

---

## 2. Three Architecture Options

### Option A: Pure Single-Agent with Tool Calling

```
User Query
    │
    ▼
┌─────────────────────────────────────────────────┐
│  MASTER AGENT (gpt-5-mini)                      │
│  System prompt: BPS Malut data analyst           │
│  Tools available:                                │
│    1. search_datasources(query) → table data     │
│    2. search_brs(query) → BRS documents          │
│    3. search_publications(query) → Pub documents │
│    4. search_nonstatistical(query) → PPID, etc  │
│    5. get_chart_config(data) → chart spec        │
│    6. check_compliance(text) → OK/revision       │
│  ─────────────────────────────────────────────  │
│  Agent loop:                                     │
│    1. Analyze query → decide which tools to call │
│    2. Call tools (parallel if model supports)     │
│    3. Receive results                            │
│    4. Generate response OR call more tools        │
│    5. Stream final response to user              │
└─────────────────────────────────────────────────┘
```

**How it works**: One LLM call with tools defined. The model decides to call `search_datasources` and `search_brs` in parallel, receives results, then generates the final response with data context injected.

**Pros**:
- Dramatically simpler code (~500 lines vs ~3,500)
- Model makes contextual decisions (may skip unnecessary searches)
- Single-model consistency (no conflicting agent conclusions)
- Easy to add new tools without pipeline changes
- ~2-3 LLM round-trips max (plan → tools → respond)

**Cons**:
- **Latency**: Tool-calling adds round-trip overhead. Each tool call = model generates JSON → execute → send back → model continues. Even with parallel tool calling, minimum is 2 round-trips (~4-8s for planning alone). Current parallel execution takes ~5s.
- **Accuracy risk**: Model may choose wrong tools or skip necessary searches. Current pipeline always searches both datasources AND knowledge base in parallel — the model can't accidentally skip one.
- **No streaming during tool execution**: User sees nothing while tools run (30-60s for complex queries). Current pipeline streams status events throughout.
- **Token cost explosion**: All tool results must fit in context simultaneously (table data + 5-7 KB documents + history can exceed 100K tokens per round).
- **Non-deterministic**: Same query may take different tool paths each time.
- **SSE protocol break**: Current SSE events (status, thinking, intent, suggestions, done) are generated by explicit stages. Tool-calling model can't emit these.
- **No fast-path optimization**: Current pipeline has gate → fast-path that answers greetings in 1.5s and known statistical queries in 5s. Tool-calling model must always plan first.

**Estimated latency**: 15-40s per query (vs 8-12s current). Not acceptable for production.

---

### Option B: Hybrid — Consolidated Pipeline with Tool-Augmented Stream (RECOMMENDED)

```
User Query
    │
    ▼
Stage 1: validate (rule-based, ~1ms)
    │
    ▼
Stage 2: gate (1 LLM call — KEEP)
    │  ├─ GREETING → template (no LLM)
    │  ├─ CHITCHAT → template (no LLM)
    │  └─ DECLINE → canned response
    ▼
Stage 3: context + normalize (rule-based)
    │
    ▼
Stage 4: UNIFIED SEARCH TOOL (replaces 5 separate agents)
    │  ┌──────────────────────────────────────────┐
    │  │  search_all(query, geo, year)             │
    │  │  Internally:                              │
    │  │   ├─ Datasource search (embed + cosine)   │
    │  │   ├─ KB search (embed + cosine + BM25)    │
    │  │   └─ Data preview (DB lookup)             │
    │  │  All parallel — ZERO LLM calls inside     │
    │  │  Returns: {candidates, kbDocs, preview}   │
    │  └──────────────────────────────────────────┘
    ▼
Stage 5: MASTER STREAM (1 LLM call — replaces 7 current agents)
    │  System prompt includes:
    │   ├─ Data table (from search tool)
    │   ├─ KB documents (from search tool)  
    │   ├─ Reconciliation instructions (in prompt, not separate agent)
    │   ├─ Chart generation instructions (structured output section)
    │   ├─ Orchestration instructions (for complex queries, self-decompose)
    │   └─ Suggestion generation (appended to response)
    │
    │  Structured output at end:
    │   └─ JSON block: {chart_config, suggestions[], compliance_notes}
    ▼
Done (suggestions extracted from structured output)
```

**Key changes from current**:

| Current (17 agents) | Proposed (3-4 agents) | How |
|---------------------|----------------------|-----|
| Synonym Expansion (DS) | **Eliminated** | Use BM25 + existing embedding search. Accept minor recall loss (~2-3%) vs 1-1.5s per call. 1hr TTL cache already catches most repeated queries. |
| Synonym Expansion (KB) | **Eliminated** | Same as above. Static synonym dictionary handles 80% of cases. |
| Query Builder (LLM) | **Rule-based extractor** | Use regex + geo/year/period extraction (already exists in `stageNormalize`). For complex API params, embed rules in search tool. |
| Reranker (LLM) | **Eliminated** | Cosine similarity + BPS priority scoring is already 90% accurate. Gate agent can flag ambiguous queries for top-1 selection instead. |
| Document Judge (LLM) | **Eliminated** | Use cosine threshold (0.35+) + keyword overlap scoring. Already has 10-min TTL cache; many queries hit cache anyway. |
| Reconciler (LLM) | **In-prompt instructions** | Add reconciliation rules to main stream system prompt. Model sees both table data and BRS text — can reconcile inline. |
| Chart Agent (LLM) | **In-prompt structured output** | Main stream generates chart config as structured JSON suffix. One fewer round-trip. |
| Orchestrator (LLM) | **In-prompt self-decomposition** | For complex queries, system prompt includes "decompose into sub-questions and address each." gpt-5-mini reasoning handles this natively. |
| Supervisor (LLM) | **KEEP** | BPS compliance check is safety-critical. Runs parallel with stream, costs 0.5-1s. |
| Suggestions (LLM) | **In-prompt structured output** | Generated as JSON suffix in main stream response. Eliminates 1 LLM call. |
| Compaction (LLM) | **KEEP** | Background, runs independently when history exceeds threshold. |

**Call count**: 1 gate + 0-1 embedding + 1 main stream + 1 supervisor = **3-4 total** (vs 8-10 current)

**Pros**:
- 50-60% fewer LLM calls
- ~30-40% latency reduction (remove synonym+QB+reranker+judge = ~4-6s saved)
- Keep SSE protocol, thinking events, status updates unchanged
- Keep fast-path optimization (gate → greeting in 1.5s)
- Keep parallel datasource+KB search (proven reliable)
- Rule-based search is more deterministic than LLM-driven search
- Main stream model is powerful enough to reconcile + chart + suggest inline
- Supervisor safety net preserved

**Cons**:
- ~3-5% accuracy drop on edge cases where LLM synonym expansion catches unusual terms
- Query Builder loss means some API params may be suboptimal (mitigated by enriched prompts)
- Reranker loss means occasionally wrong datasource selected for ambiguous queries
- Document Judge loss means some irrelevant KB docs pass through (mitigated by cosine threshold + SMART_CONTEXT sizing)
- Larger system prompt for main stream (~20% more tokens)
- Chart config quality may drop slightly vs dedicated agent

**Migration risk**: LOW — changes are additive (disable agents one by one, measure accuracy)

---

### Option C: Agentic Search Router (Your Original Vision)

```
User Query
    │
    ▼
Stage 1: validate + context + normalize (rule-based)
    │
    ▼
Stage 2: MASTER AGENT (gpt-5-mini with tool-calling)
    │  Available tools:
    │   ├─ search_statistical_datasource(query, geo, year)
    │   │   → Returns: table data with columns/rows
    │   │   │
    │   ├─ search_brs_publications(query, topic)
    │   │   → Returns: BRS/Publikasi text + metadata
    │   │   │
    │   └─ search_nonstatistical(query)
    │       → Returns: PPID/custom KB documents
    │
    │  Agent decides which tools to call based on query:
    │   "inflasi Ternate 2024" → search_statistical + search_brs
    │   "apa itu IPM?"         → search_brs only
    │   "anggaran PPID"        → search_nonstatistical only
    │
    │  After tools return, streams response with all context
    ▼
Done
```

**How it works**: Master agent receives query + chat history, decides which of 3 KB tools to call, gets results, then generates response. Single agent, single model, but with tool augmentation.

**Pros**:
- Clean 3-tool architecture matching your mental model
- Agent dynamically routes (no hardcoded gate)
- Can call multiple tools in parallel (OpenAI supports parallel function calling)
- Simpler to reason about than 10-stage pipeline

**Cons**:
- Still has tool-calling round-trip latency (2 model calls minimum: plan+respond)
- Agent may skip tools it shouldn't (e.g., always search statistical but skip BRS)
- No SSE status events during tool planning phase (30s+ silence)
- No fast-path — every query goes through tool planning
- Tool results must ALL fit in one context window (token budget challenge)
- Harder to cache (tool selection varies per query vs fixed pipeline always searching both)

**Estimated latency**: 10-25s (faster than Option A, slower than Option B)

---

### Option D: Master Agent + Agentic Sub-Agents with Maximum Parallelism (NEW RECOMMENDATION)

**Added**: 2026-02-27  
**Motivation**: Option B eliminates LLM calls from sub-agents to save cost, but this causes **unstable retrieval accuracy** for 300-page BPS publications. The chunking + embedding approach (4000-char chunks, cosine similarity) is inherently noisy for large documents — the relevant chunk may not surface consistently. A dedicated KB sub-agent with its own LLM can compensate by reasoning over chunks, judging relevance, and retrying with reformulated queries.

```
T=0ms    ┌─────────────────────────────────────────────────────────┐
         │ LAYER 1: GATE + NORMALIZE + CONTEXT (all parallel)      │
         │                                                         │
         │  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐  │
         │  │ Gate LLM │  │ Normalize    │  │ Load history +   │  │
         │  │ classify │  │ (rule-based) │  │ context (DB)     │  │
         │  └──────────┘  └──────────────┘  └──────────────────┘  │
         └─────────────────────────────────────────────────────────┘
                              │
T=1.5s                        ▼ (gate result decides route)
         ┌─────────────────────────────────────────────────────────┐
         │ LAYER 2: ALL 3 SUB-AGENTS IN PARALLEL (Promise.all)     │
         │                                                         │
         │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
         │  │ DATASOURCE  │  │ PUBLICATION  │  │ NON-STAT    │    │
         │  │ AGENT       │  │ KB AGENT     │  │ KB AGENT    │    │
         │  │ (gpt-5-mini)│  │ (gpt-4.1)   │  │ (gpt-5-mini)│    │
         │  │             │  │              │  │             │    │
         │  │ embed+cosine│  │ wide retrieve│  │ embed+BM25  │    │
         │  │ LLM rerank  │  │ LLM judge   │  │ LLM filter  │    │
         │  │ fetch data  │  │ retry if low │  │ extract     │    │
         │  │             │  │ LLM extract  │  │             │    │
         │  └──────┬──────┘  └──────┬───────┘  └──────┬──────┘    │
         │         │                │                  │           │
         └─────────┼────────────────┼──────────────────┼───────────┘
                   │                │                  │
T=4-6s             ▼                ▼                  ▼
         ┌─────────────────────────────────────────────────────────┐
         │ LAYER 3: MAIN AGENT + SUPERVISOR (parallel)             │
         │                                                         │
         │  MAIN AGENT (gpt-4.1) receives ALL results              │
         │  Generates: answer + chart + suggestions (streaming)    │
         │                                                         │
         │  SUPERVISOR (gpt-5-mini) runs parallel with stream      │
         └─────────────────────────────────────────────────────────┘
                              │
T=10-12s                      ▼
                           DONE
```

**Architecture Principles**:

1. **3 sequential layers, maximum parallelism within each layer**
2. **Sub-agents are specialized LLM-powered workers**, not simple tools
3. **Main Agent is the single brain** — commands sub-agents, collects results, synthesizes answer
4. **One window in, one window out** — all information flows through the Main Agent
5. **Publication KB Agent can iterate** — if first retrieval confidence < 0.7, reformulates and re-searches

**Layer 1: Gate + Normalize + Context (T=0 → T=1.5s)**

All three run simultaneously. Gate doesn't need normalized query — it classifies raw input. Normalize doesn't need gate result. Context loading is pure DB.

```javascript
const [gateResult, normalizedQuery, context] = await Promise.all([
  gateAgent.classify(rawQuery),           // LLM ~1.5s
  normalizer.normalize(rawQuery),          // Rule-based ~50ms
  contextLoader.load(threadId, userId),    // DB ~100ms
]);
// Wait point: gate result determines if we proceed or early-exit
```

**Layer 2: All Sub-Agents in Parallel (T=1.5s → T=4-6s)**

No sub-agent depends on another. All three receive the same normalized query + context.

```javascript
const [dsResult, pubResult, nonstatResult] = await Promise.allSettled([
  datasourceAgent.search(normalizedQuery, context),    // ~2-3s
  publicationAgent.search(normalizedQuery, context),   // ~3-5s (may retry)
  nonstatAgent.search(normalizedQuery, context),       // ~1-2s
]);
// Total time = max(datasource, publication, nonstat) ≈ 4-5s
```

Using `Promise.allSettled` so one failure doesn't kill the others.

**Layer 3: Main Agent + Supervisor in Parallel (T=5s → T=10s)**

Supervisor reads the stream as it generates — doesn't wait for completion.

```javascript
const streamPromise = mainAgent.generateStream(query, {
  datasource: dsResult, publication: pubResult, nonstat: nonstatResult,
  history: context.history,
});
const supervisorPromise = supervisor.checkCompliance(streamPromise.chunks);
await Promise.all([streamPromise.done, supervisorPromise]);
```

**Sub-Agent Internal Design**:

| Sub-Agent | Model | Internal Steps | LLM Calls | Latency |
|-----------|-------|---------------|-----------|---------|
| **Datasource Agent** | gpt-5-mini | embed+cosine → LLM rerank top-10 → fetch preview | 1 | ~2.5s |
| **Publication KB Agent** | gpt-4.1 | embed+BM25 (top 30) → LLM judge+extract → retry if confidence < 0.7 → LLM re-extract | 1-2 | ~3-5s |
| **Non-Stat KB Agent** | gpt-5-mini | embed+BM25 → LLM filter+extract | 1 | ~1.5s |

**Publication KB Agent Detail** (solves the 300-page document instability):

```javascript
async search(query, context) {
  // Step 1: Wide retrieval — embed + BM25 in parallel
  const [embedding, bm25Hits] = await Promise.all([
    embed(query),                          // ~300ms
    bm25SearchKnowledge(query),            // ~50ms
  ]);
  const cosineHits = cosineSimilarity(embedding, kbEmbeddings, top30);
  const merged = mergeAndDeduplicate(cosineHits, bm25Hits, top30);
  
  // Step 2: LLM judges all 30 chunks in ONE call — identifies relevant ones
  const judged = await llmJudgeAndExtract(query, merged, context);
  // Returns: { relevant: [...], confidence: 0.85, extracted_data: "...",
  //            suggested_reformulation: "..." }
  
  // Step 3: If confidence < 0.7, retry with reformulated query
  if (judged.confidence < 0.7 && judged.suggested_reformulation) {
    const [newEmb, newBm25] = await Promise.all([
      embed(judged.suggested_reformulation),
      bm25SearchKnowledge(judged.suggested_reformulation),
    ]);
    const newMerged = mergeAndDeduplicate(
      cosineSimilarity(newEmb, kbEmbeddings, top30), newBm25, top30
    );
    return await llmJudgeAndExtract(query, newMerged, context);
  }
  
  return judged;
}
```

**Communication Protocol** (Sub-Agent → Main Agent):

```json
{
  "status": "found",
  "confidence": 0.92,
  "sources": [
    {"title": "Indeks Pembangunan Manusia 2024", "type": "BRS", "year": 2024}
  ],
  "extracted_data": "IPM Maluku Utara tahun 2024 sebesar 69,45...",
  "raw_chunks": ["..."],
  "search_attempts": 1
}
```

**LLM Call Count**:

| Scenario | LLM Calls | Latency Est. |
|----------|-----------|-------------|
| Greeting | 1 (gate) | ~1.5s |
| Simple data query | gate + main + datasource = 3 | ~6s |
| Publication query | gate + main + pub_agent = 3 | ~8s |
| Full query (data + pub) | gate + main + ds_agent + pub_agent + supervisor = 5 | ~10.5s |
| Complex (all 3 KBs) | gate + main + 3 sub-agents + supervisor = 6 | ~12s |
| Pub agent retries | +1-2 per retry | +3-4s |

**Pros**:
- **Solves publication instability** — KB sub-agent can reason over chunks and retry
- **Maximum parallelism** — only 3 sequential wait points in entire pipeline
- **Single brain** — Main Agent sees all results, reconciles inline, no conflicting conclusions
- **SSE events preserved** — sub-agents emit status events that Main Agent forwards
- **Fast-path preserved** — gate → greeting in 1.5s (no sub-agents fired)
- **Graceful degradation** — if one sub-agent fails, Main Agent uses whatever data it has
- **Each sub-agent is independently testable** — clear input/output contract
- **Deterministic routing** — gate decides which sub-agents to fire, not the model

**Cons**:
- More LLM calls than Option B (5-6 vs 3-4) — higher cost per query
- Sub-agent LLMs add ~2-3s vs pure tool approach
- Main Agent context window must hold all sub-agent results (~50-80K tokens)
- More complex than Option B (but simpler than current 17-agent pipeline)
- Publication retry adds 3-4s when triggered (~20% of queries)

**Migration risk**: MEDIUM — requires new sub-agent services but can reuse existing search infrastructure

---

## 3. Detailed Comparison Matrix

| Criterion | Current (17 agents) | Option A (Pure Agent) | Option B (Hybrid) | Option C (Agent+Tools) | **Option D (Master+Sub-Agents)** |
|-----------|--------------------|-----------------------|----------------------|----------------------|-------------------------------|
| LLM calls/query | 8-10 | 2-3 | 3-4 | 3-4 | **5-6** |
| Embedding calls | 2-3 | 1-2 | 1-2 | 1-2 | **2-3** |
| Typical latency | ~12s | ~25s | ~8s | ~15s | **~10.5s** |
| Greeting latency | ~1.5s | ~3s | ~1.5s | ~5s | **~1.5s** |
| Token cost/query | ~40K in + ~2K out | ~80K in + ~3K out | ~35K in + ~2.5K out | ~60K in + ~3K out | **~55K in + ~4K out** |
| SSE status events | ✅ Rich | ❌ None during tools | ✅ Rich | ⚠️ Partial | **✅ Rich** |
| Fast-path (greeting) | ✅ 1.5s | ❌ Always plans | ✅ 1.5s | ❌ Always plans | **✅ 1.5s** |
| Accuracy (data) | 95%+ | ~90% | ~93% | ~91% | **~96%** |
| Accuracy (knowledge) | 93%+ | ~88% | ~90% | ~89% | **~95%+** |
| Publication stability | ⚠️ Inconsistent | ❌ Worse | ❌ No LLM judge | ⚠️ Model-dependent | **✅ Retry-capable** |
| Code complexity | ~14,700 lines | ~800 lines | ~8,000 lines | ~2,500 lines | **~5,000 lines** |
| Migration risk | N/A (current) | HIGH (rewrite) | LOW (incremental) | MEDIUM (partial rewrite) | **MEDIUM (prototype first)** |
| Determinism | HIGH | LOW | HIGH | MEDIUM | **HIGH** |
| Debugging | Complex but traceable | Hard (model decides) | Good (stages + less agents) | Medium | **Good (clear sub-agent contracts)** |
| Sequential wait points | 5-7 | 2-3 | 4-5 | 2-3 | **3** |

---

## 4. Recommended Approach: Option D — Prototype-First Master Agent Architecture

> **Updated 2026-02-27**: Changed from Option B to Option D based on real-world observation that publication retrieval instability cannot be solved by removing LLM judges — it requires LLM-powered sub-agents that can reason and retry.

### Strategy: Build Prototype → Test → Migrate

Instead of incrementally disabling agents (Option B approach), we build a **parallel prototype pipeline** that can be A/B tested against the current pipeline. This avoids the risk of degrading production while testing.

### Phase 1: Prototype Architecture (Week 1-3)
**Target**: Build standalone `pipelineV2.service.js` alongside existing `pipeline.service.js`

| Task | Description | Files to Create |
|------|-------------|----------------|
| **Datasource Sub-Agent** | Encapsulate: embed → cosine → LLM rerank → fetch preview. Input: normalized query + context. Output: structured result. | `streaming/agents/datasourceAgent.service.js` |
| **Publication KB Sub-Agent** | Encapsulate: embed+BM25 → LLM judge+extract → retry if low confidence. Input: normalized query + context. Output: structured result with extracted data. | `streaming/agents/publicationAgent.service.js` |
| **Non-Stat KB Sub-Agent** | Encapsulate: embed+BM25 → LLM filter+extract. Input: normalized query + context. Output: structured result. | `streaming/agents/nonstatAgent.service.js` |
| **Main Agent** | Receives all sub-agent results. Generates response with chart config + suggestions inline. Uses gpt-4.1. | `streaming/agents/mainAgent.service.js` |
| **Pipeline V2 Orchestrator** | 3-layer parallel execution: Layer 1 (gate‖normalize‖context) → Layer 2 (3 sub-agents) → Layer 3 (main stream‖supervisor). | `streaming/pipelineV2.service.js` |
| **Agent Communication Protocol** | Shared TypeScript-like interface for sub-agent input/output contracts. | `streaming/agents/agentProtocol.js` |

**Reuse from existing code** (no rewrite needed):
- `gateAgent.service.js` — keep as-is
- `supervisor.service.js` — keep as-is  
- `sse.service.js` — keep as-is
- `prompt.service.js` — adapt for Main Agent system prompt
- `embedding.service.js` — shared by all sub-agents
- `vectorSearch.service.js` — search functions reused inside sub-agents
- `knowledgeDoc.service.js` — chunking logic reused
- `queryNormalizer.service.js` — reused in Layer 1
- `yearInference.service.js` / `geoInference.service.js` — reused in Layer 1

**Key design decisions for prototype**:

```javascript
// streaming/agents/agentProtocol.js — Shared contract

/**
 * Sub-Agent Input (sent by Main Agent / Pipeline Orchestrator)
 */
const AgentInput = {
  query: '',              // Normalized user query
  rawQuery: '',           // Original user message
  context: {
    geo: null,            // { code, name, level } from geoInference
    year: null,           // From yearInference
    month: null,          // From queryAnalysis
    topic: null,          // From gate classification
    chatHistory: [],      // Last 5 messages (compacted)
    dnaContext: null,      // BPS metadata API results
  },
  options: {
    maxResults: 10,       // Max items to return
    minConfidence: 0.5,   // Minimum confidence threshold
    enableRetry: true,    // Allow query reformulation retry
    timeoutMs: 15000,     // Per-agent timeout
  },
};

/**
 * Sub-Agent Output (returned to Main Agent)
 */
const AgentOutput = {
  status: 'found',        // 'found' | 'not_found' | 'partial' | 'error'
  confidence: 0.92,       // 0-1 overall confidence
  sources: [],            // Array of { title, type, year, id, similarity }
  extracted_data: '',     // Pre-extracted relevant text/data
  raw_preview: null,      // For datasource: { columns, rows, title }
  search_attempts: 1,     // How many search rounds needed
  latencyMs: 2500,        // Self-reported latency
  sseEvents: [],          // Status events to forward to frontend
};
```

### Phase 2: Parallel Testing (Week 4-5)
**Target**: Run prototype alongside production, compare accuracy

| Task | Description |
|------|-------------|
| **Route flag** | Add `PIPELINE_VERSION=v1|v2|ab` env var. `v1` = current, `v2` = prototype, `ab` = random 50/50 split |
| **Shadow mode** | Run V2 in background for every V1 request, log results without sending to user |
| **Accuracy comparison** | For each query, compare: (a) datasource selected, (b) KB documents retrieved, (c) extracted data quality |
| **Latency comparison** | Log p50/p95/p99 for both pipelines side-by-side |
| **Publication stability test** | Run same 50 publication queries 10 times each. Measure: how often does the correct document appear in results? V1 vs V2 consistency rate. |
| **Eval suite** | Run `master-test-runner.sh --chat` against V2 endpoint. Must match or exceed V1 pass rate. |

**Key test queries for publication stability**:

```
1. "berapa IPM Maluku Utara 2024?"           → Must find BRS IPM consistently
2. "apa isi publikasi PDRB 2024?"            → Must extract from 300-page pub
3. "data kemiskinan menurut kabupaten"        → Must find correct BRS + table
4. "tren inflasi Ternate 5 tahun terakhir"   → Must find multiple BRS across years
5. "ekspor perikanan Maluku Utara"            → Must find EXIM + BRS trade
```

### Phase 3: Migration & Optimization (Week 6-8)
**Target**: Switch production to V2, optimize based on test results

| Task | Description |
|------|-------------|
| **Gradual rollout** | 10% → 25% → 50% → 100% traffic to V2 |
| **Sub-agent tuning** | Adjust confidence thresholds, retry strategies based on shadow mode data |
| **Main Agent prompt optimization** | Refine system prompt for reconciliation, chart, suggestions quality |
| **Remove V1 code** | Once V2 is stable at 100%, deprecate old pipeline stages |
| **Performance optimization** | Embedding cache, prompt caching, connection pooling |

### Phase 1 (Legacy — Option B approach, kept for reference)

<details>
<summary>Click to expand original Option B phases (superseded by Option D)</summary>

#### Phase 1 (Old): Eliminate Redundant LLM Calls (Week 1-2)
**Target**: Remove 4 agents, save ~4s per query

| Change | Risk | Fallback |
|--------|------|----------|
| Remove **Synonym Expansion** (both DS and KB) | LOW — 1hr TTL cache catches most; static dictionary handles rest. Test with `--chat` eval suite. | Re-enable via env flag `SYNONYM_LLM_ENABLED=true` |
| Remove **Query Builder LLM** → use rule-based param extraction | MEDIUM — some complex API params may degrade. Test with period/geo edge cases. | Keep QB but only for `needsDisambiguation` flag |
| Remove **Reranker LLM** → use cosine + priority scoring | LOW — reranker is conditional (only fires for ambiguous queries). Test with overlap eval set. | Re-enable for specific query patterns |

#### Phase 2 (Old): Merge Satellite Agents into Stream (Week 3-4)

| Change | Risk | Fallback |
|--------|------|----------|
| Remove **Document Judge** → use cosine threshold + keyword scoring | MEDIUM — some low-quality docs may pass through. SMART_CONTEXT limits damage. | Keep judge for queries with >10 candidates |
| Merge **Chart Agent** into main stream structured output | LOW — chart config is simple JSON. Add to system prompt. | Keep parallel chart agent for complex charts |
| Merge **Suggestions** into main stream structured output | LOW — suggestions are simple. Model generates inline. | Keep separate if quality drops |
| Merge **Reconciler** into main stream prompt instructions | MEDIUM — reconciliation quality depends on LLM seeing both table + BRS. Test with overlap category. | Keep reconciler for confirmed multi-source queries |

#### Phase 3 (Old): Consolidate Search into Unified Tool (Week 5-6)

```javascript
// OLD: Unified search function (no LLM calls inside) — SUPERSEDED by sub-agents
async function searchAll(query, { geo, year, topic }) {
  const [datasources, kbDocs, preview] = await Promise.all([
    searchDatasourcesRuleBased(query, { geo, year }),
    searchKnowledgeBase(query, 15, { skipRerank: true }),
    fetchDataPreview(datasources),
  ]);
  const enrichedKb = await enrichKnowledgeWithExtraction(kbDocs, query);
  return { datasources, kbDocs: enrichedKb, preview };
}
```

#### Phase 4 (Old): Optimize Main Stream Prompt (Week 7-8)
Still relevant — Main Agent prompt in Option D needs the same enhancements:
1. **Reconciliation rules**: "If table data conflicts with BRS data, note discrepancy and explain possible reasons"
2. **Chart config generation**: "After your response text, output a JSON block with chart configuration"
3. **Self-decomposition**: "For complex multi-part questions, address each aspect systematically"
4. **Suggestion generation**: "End with 3-5 follow-up question suggestions"

</details>

---

## 5. What CANNOT Be Merged (Must Keep Separate)

| Agent | Why it must stay | Option D role |
|-------|-----------------|---------------|
| **Gate Agent** | Safety-critical routing. Must classify DECLINE/INDIVIDUAL before any data search. Running as first stage prevents wasted compute. If merged into master, model might leak individual data before classification completes. | Layer 1 — runs parallel with normalize + context |
| **Supervisor** | Post-stream compliance check. Must review AFTER response is generated. Runs parallel with stream — zero critical path cost. BPS statistical integrity requires independent verification. | Layer 3 — runs parallel with Main Agent stream |
| **Compaction** | Background job triggered by message count threshold. Completely independent of query pipeline. Different lifecycle. | Unchanged — background job |
| **Embedding** | API call, not LLM reasoning. Always needed for vector search. Cannot be eliminated (only optimized with caching). | Shared by all 3 sub-agents in Layer 2 |

---

## 6. Accuracy Risk Analysis

### What Synonym Expansion Currently Catches

From the 1-hour TTL cache analysis:
- ~70% of queries hit cache (same or similar queries repeated)
- ~20% of queries don't benefit from synonym expansion (exact terms match)
- ~10% of queries genuinely benefit from LLM-generated synonyms

**Risk**: ~3-5% of queries may return lower-quality search results without LLM synonyms.

**Mitigation**: 
- Static synonym dictionary (already exists for top 50 statistical terms)
- Expand dictionary to cover BPS-specific abbreviations (IPM, PDRB, TPT, etc.)
- Use BM25 keyword search as fallback when cosine similarity is low

### What Query Builder Currently Catches

Query Builder translates queries like "inflasi Ternate Maret 2024" into structured API params:
```json
{"year": "2024", "month": "03", "geo": "kota_ternate"}
```

**Current rule-based extraction already handles**:
- Year extraction (yearInference.service.js) — 95% coverage
- Geo extraction (geoInference.service.js) — 98% coverage  
- Month extraction (queryAnalysis.js MONTH_MAP) — 99% coverage

**What rule-based CANNOT handle**: 
- Complex faceted queries ("ekspor kelapa sawit ke Jepang per pelabuhan")
- Ambiguous datasource selection when multiple match

**Mitigation**: Keep QB only for EXIM queries (complex faceted) and ambiguous multi-source queries. Rule-based for everything else.

### What Reranker Currently Catches

Reranker fires only when `needsReranking` AND `queryMayNeedDisambiguation` are both true:
- ~30% of queries never trigger reranker (fast-path or clear single match)
- ~50% of queries trigger reranker but cosine top-1 was already correct
- ~20% of queries genuinely benefit from reranker disambiguation

**Risk**: ~5-8% of ambiguous queries may select wrong datasource.

**Mitigation**: 
- Improve datasource alias coverage (add more aliases to `data_sources` table)
- Use gate agent's topic classification to narrow candidate pool
- Fall back to top-1 cosine match (usually correct)

---

## 7. Latency Impact Projection

### Current Waterfall (Typical Data Query, ~12s)
```
Gate               1.5s
Normalize+DNA      0.5s (parallel)
Intent path:       3.5s (syn 1s + QB 2s + reranker 1s, sequential)
KB path:           2.5s (syn 1s + embed 0.5s + judge 1.5s, sequential)
                   ─── Intent||KB parallel: max(3.5, 2.5) = 3.5s
Preview            0.3s
Model select       0.1s
Main stream        5.0s
Supervisor||Sugg   1.0s (parallel)
                   ────────────────
TOTAL              ~12s
```

### Option B Waterfall (Projected, ~8s)
```
Gate               1.5s
Normalize          0.3s
Unified search:    1.5s (embed 0.5s + cosine 0.1s + BM25 0.1s + preview 0.3s + enrichment 0.5s)
                   ─── All parallel: max = 1.5s
Model select       0.1s
Main stream        4.5s (longer prompt but no separate agents needed)
Supervisor         0.8s (parallel with tail of stream)
                   ────────────────
TOTAL              ~8s (33% faster)
```

**Savings breakdown**:
- Synonym Expansion x2: -1.5s
- Query Builder: -2s
- Reranker: -1s
- Document Judge: -1.5s
- Suggestions (merged): -0s (was already parallel)
- Reconciler (merged): -0 to -5s per affected query

### Option D Waterfall (Projected, ~10.5s) — RECOMMENDED
```
LAYER 1 (parallel):
  Gate(LLM)            1.5s ─┐
  Normalize(rule)      0.05s │ max = 1.5s
  Context(DB)          0.1s ─┘

LAYER 2 (parallel, 3 sub-agents):
  DatasourceAgent      2.5s (embed 0.3s + cosine 0.01s + LLM rerank 1.5s + preview 0.3s) ─┐
  PublicationAgent     4.0s (embed 0.3s + BM25 0.05s + LLM judge 2.5s + extract 1.0s)     │ max = 4.0s
  NonStatAgent         1.5s (embed 0.3s + BM25 0.05s + LLM filter 1.0s)                   ─┘

LAYER 3 (parallel):
  MainAgent(LLM)       5.0s (streaming response + chart + suggestions) ─┐
  Supervisor(LLM)      0.8s (parallel with stream tail)                 │ max = 5.0s
                                                                        ─┘
                       ────────────────
TOTAL                  ~10.5s

With publication retry (20% of queries):
  PublicationAgent     7.0s (first attempt 4s + retry 3s) ─┐
  Other agents         already done                        │ max = 7.0s
                       ────────────────                    ─┘
TOTAL with retry       ~13.5s
```

**Comparison: Sequential wait points**
```
Current pipeline:  validate → gate → context → normalize‖DNA → intent‖KB → preview → model → stream
                   = 7 sequential stages (some with internal parallelism)

Option D:          Layer1(gate‖norm‖ctx) → Layer2(ds‖pub‖nonstat) → Layer3(main‖supervisor)
                   = 3 sequential layers (maximum parallelism within each)
```

---

## 8. Token Cost Impact

### Current (per typical query)
| Agent | Input tokens | Output tokens |
|-------|-------------|---------------|
| Gate | ~2K | ~100 |
| Synonym x2 | ~1K x2 | ~200 x2 |
| Query Builder | ~3K | ~500 |
| Reranker | ~4K | ~300 |
| Document Judge | ~5K | ~400 |
| Main Stream | ~20K | ~1.5K |
| Supervisor | ~3K | ~200 |
| Suggestions | ~2K | ~300 |
| **Total** | **~41K** | **~3.7K** |

### Option B (per typical query)
| Agent | Input tokens | Output tokens |
|-------|-------------|---------------|
| Gate | ~2K | ~100 |
| Main Stream (enriched) | ~25K | ~2.5K |
| Supervisor | ~3K | ~200 |
| **Total** | **~30K** | **~2.8K** |

**Savings vs current**: ~27% less input tokens, ~24% less output tokens per query.

### Option D (per typical query) — RECOMMENDED
| Agent | Input tokens | Output tokens |
|-------|-------------|---------------|
| Gate | ~2K | ~100 |
| Datasource Agent (rerank) | ~5K | ~400 |
| Publication KB Agent (judge+extract) | ~12K | ~800 |
| Non-Stat KB Agent (filter) | ~4K | ~300 |
| Main Agent (synthesize) | ~25K | ~2.5K |
| Supervisor | ~3K | ~200 |
| **Total** | **~51K** | **~4.3K** |

| With publication retry | +~12K | +~800 |
|-------|-------------|---------------|
| **Total (retry)** | **~63K** | **~5.1K** |

**Cost vs current**: ~24% more input tokens, ~16% more output tokens per query. **Cost is higher but accuracy is significantly better**, especially for publication queries. With cost not a constraint, this is the right trade-off.

---

## 9. Implementation Checklist (Option D)

### Prerequisites
- [ ] Baseline accuracy: Run full `master-test-runner.sh --chat` and record per-category scores
- [ ] Baseline latency: Record p50/p95/p99 from 100+ production queries
- [ ] Publication stability baseline: Run 50 publication queries × 10 repetitions, record consistency rate
- [ ] Create `streaming/agents/` directory structure
- [ ] Add `PIPELINE_VERSION=v1` env var (default to current pipeline)

### Phase 1: Prototype Build (Week 1-3)
- [ ] Create `streaming/agents/agentProtocol.js` — shared input/output contracts
- [ ] Create `streaming/agents/datasourceAgent.service.js` — encapsulate intent search + LLM rerank + preview fetch
- [ ] Create `streaming/agents/publicationAgent.service.js` — encapsulate KB search + LLM judge + retry logic
- [ ] Create `streaming/agents/nonstatAgent.service.js` — encapsulate non-stat KB search + LLM filter
- [ ] Create `streaming/agents/mainAgent.service.js` — Main Agent that receives all results, generates response
- [ ] Create `streaming/pipelineV2.service.js` — 3-layer parallel orchestrator
- [ ] Wire V2 pipeline to existing SSE protocol (reuse `sse.service.js`)
- [ ] Wire V2 pipeline to existing gate agent (reuse `gateAgent.service.js`)
- [ ] Wire V2 pipeline to existing supervisor (reuse `supervisor.service.js`)
- [ ] Add route handler: `POST /api/chat/stream?pipeline=v2` for testing
- [ ] Unit tests for each sub-agent (mock LLM, test input/output contract)

### Phase 2: Parallel Testing (Week 4-5)
- [ ] Implement shadow mode: V2 runs in background for every V1 request, logs results
- [ ] Add `PIPELINE_VERSION=ab` mode for 50/50 random split
- [ ] Run publication stability test: 50 queries × 10 reps, compare V1 vs V2 consistency
- [ ] Run accuracy comparison: 100 queries, compare datasource selection + KB retrieval
- [ ] Run latency comparison: log p50/p95/p99 for both pipelines
- [ ] Run eval suite against V2: `master-test-runner.sh --chat --pipeline=v2`
- [ ] Tune sub-agent confidence thresholds based on shadow mode data
- [ ] Tune Publication KB Agent retry strategy (when to retry, how to reformulate)

### Phase 3: Migration (Week 6-8)
- [ ] Gradual rollout: `PIPELINE_VERSION=v2` for 10% traffic
- [ ] Monitor error rates, latency, user feedback for 48 hours
- [ ] Increase to 25% → 50% → 100%
- [ ] Optimize Main Agent system prompt (reconciliation, chart, suggestions)
- [ ] Implement embedding cache for top 200 recurring queries
- [ ] Implement prompt caching for repeated system prompts
- [ ] Deprecate V1 pipeline stages (keep code for 30 days, then remove)
- [ ] Update documentation and architecture diagrams

---

## 10. Why Option D Over Full Agentic (Option A) and Pure Tool (Option B)

### Why NOT Full Agentic (Option A)

Anthropic's own guidance states:

> "When building applications with LLMs, we recommend finding the simplest solution possible, and only increasing complexity when needed."

MALIKA's chat pipeline is fundamentally a **deterministic workflow** — not an open-ended agent task. The tasks are predictable:

1. **Always** classify the query route (gate)
2. **Always** search datasources AND knowledge base (parallel)
3. **Always** generate a response with data context
4. **Sometimes** reconcile, chart, or decompose

Making it fully agentic (Option A — letting the model decide which tools to call) introduces non-determinism that hurts a statistical data system where consistency and accuracy are paramount.

### Why NOT Pure Tool (Option B)

Option B eliminates LLM calls from search stages to save cost. However, real-world testing revealed a critical flaw: **publication retrieval is unstable without LLM reasoning**.

The problem: BPS publications are 50-300 pages. When chunked at 4000 chars with 400 overlap, a single publication produces 50-200 chunks. Cosine similarity search over these chunks is inherently noisy:
- The relevant chunk may rank #15 instead of #1 depending on query phrasing
- BM25 keyword matching helps but can't bridge semantic gaps
- The same query run twice may surface different chunks
- Without an LLM to judge "is this chunk actually answering the question?", irrelevant chunks pass through

This was observed in production: "sometimes the right document appears in the pool, sometimes it doesn't."

### Why Option D is the Right Balance

Option D keeps the **deterministic workflow structure** (gate → parallel search → synthesize) but adds **LLM reasoning inside each search sub-agent**. This is Anthropic's **"Parallelization with Specialized Workers"** pattern:

- The **pipeline** is deterministic (always gate → always search all 3 → always synthesize)
- The **sub-agents** are intelligent (can reason over chunks, judge relevance, retry)
- The **Main Agent** is the single brain (sees all results, reconciles, generates)

This avoids Option A's non-determinism (model decides what to search) while solving Option B's accuracy problem (no LLM to judge publication chunks).

The correct pattern is Anthropic's **"Parallelization Workflow"** — fixed parallel stages with programmatic aggregation.

OpenAI's function-calling best practices also recommend:
> "Keep the number of functions small for higher accuracy. Aim for fewer than 20 functions."

And critically:
> "Combine functions that are always called in sequence."

This supports Option B: combine always-sequential steps, but keep the parallel structure.

---

## 11. Future Considerations

### When to Revisit Full Agentic (Option A/C)
- When model latency drops below 1s for planning calls (currently ~1.5-3s)
- When parallel function calling supports streaming intermediate results
- When context windows exceed 1M tokens cheaply (so all search results fit)
- When model accuracy on tool selection exceeds 99% (currently ~90-95%)

### Option D Future Optimizations
- **Embedding cache**: Pre-compute embeddings for top 200 recurring queries (saves ~300ms per sub-agent)
- **Sub-agent result caching**: Cache sub-agent outputs by query hash (5-min TTL). Same query = skip sub-agent entirely.
- **Speculative execution**: Start Main Agent streaming with partial results while slowest sub-agent (Publication) completes
- **Prompt caching**: OpenAI prompt caching for repeated system prompts (Main Agent + sub-agents share common prefix)
- **Sub-agent specialization**: Fine-tune sub-agent prompts per domain (e.g., Publication agent knows BPS publication naming conventions)
- **Adaptive retry**: Publication agent learns which query reformulations work best (log successful retries, build pattern library)
- **Gate + Sub-agent routing merge**: Gate classification can pre-filter which sub-agents to fire (e.g., "apa itu IPM?" → only Publication agent, skip Datasource)

---

## Appendix A: Current vs Proposed Architecture Diagram

### Current (10 stages, 17 agents)
```
validate → gate(LLM) → context → normalize||DNA
    → intent(LLM: syn+embed+QB+reranker) || KB(LLM: syn+embed+judge)
    → preview → enrichment → reconciler(LLM)
    → modelSelect → orchestrator(LLM: plan+workers)
    → stream(LLM) || supervisor(LLM) || suggestions(LLM)
    → chart(LLM) → done
```

### Proposed Option B (6 stages, 3-4 agents) — Superseded
```
validate → gate(LLM) → context+normalize
    → searchAll(embed+cosine+BM25+preview+enrichment) ← NO LLM
    → stream(LLM: response+chart+suggestions+reconciliation)
    → supervisor(LLM, parallel)
    → done
```

### Proposed Option D (3 layers, 5-6 agents) — RECOMMENDED
```
LAYER 1 (parallel):
    gate(LLM) ‖ normalize(rule) ‖ context(DB)

LAYER 2 (parallel, after gate):
    datasourceAgent(LLM: embed+cosine+rerank+preview)
    ‖ publicationAgent(LLM: embed+BM25+judge+extract+retry)
    ‖ nonstatAgent(LLM: embed+BM25+filter+extract)

LAYER 3 (parallel):
    mainAgent(LLM: synthesize+chart+suggestions, streaming)
    ‖ supervisor(LLM: compliance check)

    → done
```

### Option D — Existing Code Reuse Map

```
NEW (to create)                    REUSES FROM (existing)
─────────────────                  ──────────────────────
agents/agentProtocol.js            (new — shared contracts)
agents/datasourceAgent.service.js  ← vectorSearch.service.js (searchDatasources)
                                   ← reranker.service.js (rerankCandidates)
                                   ← previewBuilder.service.js (fetchPreview)
                                   ← synonymExpansion.service.js (optional)

agents/publicationAgent.service.js ← vectorSearch.service.js (searchKnowledge)
                                   ← multiStrategySearch.service.js (query variants)
                                   ← documentJudge.service.js (judge logic)
                                   ← knowledgeDoc.service.js (chunking)
                                   ← hybridSearch.service.js (BM25)

agents/nonstatAgent.service.js     ← vectorSearch.service.js (searchKnowledge)
                                   ← hybridSearch.service.js (BM25)

agents/mainAgent.service.js        ← prompt.service.js (system prompt base)
                                   ← modelRouter.service.js (model selection)
                                   ← chartAgent.service.js (chart config logic)
                                   ← llmSuggestions.service.js (suggestion logic)
                                   ← reconciler.service.js (reconciliation rules)

pipelineV2.service.js              ← pipeline.service.js (SSE protocol, timings)
                                   ← gateAgent.service.js (reuse as-is)
                                   ← supervisor.service.js (reuse as-is)
                                   ← sse.service.js (reuse as-is)
                                   ← queryNormalizer.service.js (reuse as-is)
                                   ← yearInference.service.js (reuse as-is)
                                   ← geoInference.service.js (reuse as-is)
```

---

## Appendix B: References

1. Anthropic, "Building Effective Agents" (2024-12-19) — https://www.anthropic.com/engineering/building-effective-agents
2. OpenAI, "Function Calling" — https://platform.openai.com/docs/guides/function-calling
3. OpenAI, "Best practices for defining functions" — same URL
4. Anthropic, "Tool Search Tool" — https://docs.anthropic.com/en/docs/build-with-claude/tool-use/tool-search-tool
5. Lost in the Middle: How Language Models Use Long Contexts (2023) — https://arxiv.org/abs/2307.03172
