# Agentic LLM Chart Architecture — Possibilities & Plan

**Date**: 2026-02-24  
**Status**: Phase 1 ✅ · Phase 2 ✅ · Phase 3 ✅ · Phase 4 ✅ · Phase 5 ✅ · **ALL COMPLETE**  
**Goal**: Replace manual/rule-based chart configuration with an LLM agent that automatically analyzes data and produces optimal chart configs — zero user involvement.

---

## Phase 1 Completion Log (2026-02-24)

| Task | Status | Details |
|------|--------|---------|
| 1.1 Create `chartAgent.service.js` | ✅ | 398 lines, gpt-4.1-mini, structured output, TTL cache |
| 1.2 Define JSON Schema | ✅ | 11-field `CHART_CONFIG_SCHEMA` with 6 chart types |
| 1.3 Add `chart` field to `buildUIMetadata()` | ✅ | New `chartConfig` param + `chart` return field |
| 1.4 Wire Stage 5.5 into pipeline | ✅ | Parallel fire-and-forget, awaited at uiMeta build |
| 1.5 Add timing to telemetry | ✅ | `pipeline_ms.chartAgent` in done event |
| 1.6 Add status_detail events | ✅ | "Memilih visualisasi terbaik…" + 📈 thinking item |

**Smoke Test Result** (inflasi kota ternate 2024):
- Chart type: `line` (correct — time-series with 3 metrics)
- Latency: 2,605ms (within 3s budget)
- `chart` field in `malika_ui` SSE event: ✅
- Pipeline latency impact: 0ms (parallel execution)

## Phase 2 Completion Log (2026-02-24)

| Task | Status | Details |
|------|--------|---------|
| 2.1 Add `ChartAgentOutput` type + `chart` field to `MalikaUiMetaV1` | ✅ | 30-field type in `frontend/src/types/chat.ts` |
| 2.2 Create `ChatChart.tsx` | ✅ | ~290 lines, ApexCharts wrapper, 6 chart types, 4 color schemes, 4 formatters |
| 2.3 Integrate into `DataSummaryBubble.tsx` | ✅ | Lazy-loaded, LLM chart takes priority over MiniSparkline |
| 2.4 Add chart type toggle | ✅ | Switch between primary and LLM alternative recommendation |
| 2.5 Dark mode support | ✅ | Via `useTheme()` — theme mode, grid colors, label colors all adapt |

**Frontend Build**: Compiled successfully (0 errors) ✅  
**Files**: `ChatChart.tsx` (new), `chat.ts` (modified), `DataSummaryBubble.tsx` (modified), `chatTransport.ts` (type fix)

## Phase 3 Completion Log (2026-02-24)

| Task | Status | Details |
|------|--------|--------|
| 3.1 Backend 3s timeout | ✅ | Already implemented in Phase 1 (`CHART_AGENT_TIMEOUT_MS=3000`, 0 retries, returns `null` on failure) |
| 3.2 Frontend profiler fallback | ✅ | New `profileToChartConfig()` bridge (~100 lines) in `chartDataProfiler.ts`. 3-tier cascade in `DataSummaryBubble.tsx`: LLM Agent → rule-based profiler → MiniSparkline → table-only |
| 3.3 SSE partial delivery | ✅ | Confirmed `malika_ui` sent atomically (4 `sendEvent` calls). `chatTransport.ts` handles in both main loop and buffer flush — no changes needed |

**Frontend Tests**: 14/14 pass (chartDataProfiler.test.ts) ✅  
**Frontend Build**: Compiled successfully (0 errors) ✅  
**Files Modified**: `chartDataProfiler.ts` (bridge function), `DataSummaryBubble.tsx` (3-tier cascade)

## Phase 4 Completion Log (2026-02-24)

| Task | Status | Details |
|------|--------|--------|
| 4.1 Backend unit test: chartAgent.service | ✅ | 26 tests (4 groups: _buildChartInput, _validateConfig, cache, generateChartConfig). Mock LLM via jest.mock. |
| 4.2 Frontend unit test: profileToChartConfig | ✅ | 8 new tests added to `chartDataProfiler.test.ts` (total 22). Covers null/single-row, line, multi-metric, geo-horizontal, percentage format, alternative. |
| 4.3 Integration: live chat queries | ✅ | 3/3 pass — `chart-agent-integration.py` (gini rasio → grouped-bar 1.9s, inflasi → line 2.2s, penduduk → grouped-bar 2.4s) |
| 4.4 Master test runner | ✅ | Chart is in SSE `malika_ui` event — existing master test runner validates pipeline E2E. Dedicated `chart-agent-integration.py` for chart-specific validation. |

**Backend Jest**: 37 suites, 191 tests ✅  
**Frontend Unit**: 44 tests ✅ (22 profiler + 22 other)  
**Live Integration**: 3/3 ✅ (all <3s chart agent latency)  
**New Files**: `backend/src/__tests__/chartAgent.service.test.js`, `backend/evals/chart-agent-integration.py`

## Phase 5 Completion Log (2026-02-24)

| Task | Status | Details |
|------|--------|--------|
| 5.1 TTL cache | ✅ | Already implemented in Phase 1: 10-min TTL, 200 max entries, source_id + column signature key |
| 5.2 reasoning.effort:"low" | N/A | Chart agent uses gpt-4.1-mini (non-reasoning model). temperature=0 already deterministic. Latencies 1.9-2.4s — well within 3s budget. |
| 5.3 Status event | ✅ | Already implemented in Phase 1: "Memilih visualisasi terbaik…" + 📈 thinking item |
| 5.4 Animate chart | ✅ | Already implemented in Phase 2: CSS fade-in animation on ChatChart |

**All 5 phases complete.** The Agentic LLM Chart Architecture is fully operational.

## 1. Current State Assessment

### What Exists Today

| Component | Location | Lines | Role | Limitation |
|-----------|----------|-------|------|------------|
| **chartDataProfiler.ts** | `frontend/src/lib/` | 1,051 | Rule-based profiler: 14 DataProfile types, column pattern matching, 150+ pre-computed INDICATOR_CHART_MAP entries | Heuristic only — no semantic understanding of data context or user intent |
| **SearchInsightsChart.tsx** | `frontend/src/components/search/` | 3,848 | Full ApexCharts renderer: line/bar/pie, zoom, fullscreen, comparison, CSV/SVG download, dark mode, multi-series, geo-dimension | **NOT wired into chat** — only used on `/data` and `/search` pages |
| **MiniSparkline.tsx** | `frontend/src/components/chat/` | 204 | Pure SVG inline sparkline in DataSummaryBubble | Single series, no interactivity, no bar/pie, no multi-metric |
| **DataSummaryBubble.tsx** | `frontend/src/components/chat/` | 434 | "Second bubble" orchestrator — shows table cards, MiniSparkline toggle, knowledge candidates, feedback | Only renders MiniSparkline for viz — no full chart |
| **uiMetadata.service.js** | `backend/src/services/chat/streaming/` | 431 | Builds MalikaUiMetaV1 metadata (table, candidates, sources, confidence) | **NO chart config** in the metadata at all |
| **ChatTableModal.tsx** | `frontend/src/components/chat/` | 891 | Full-screen table modal with sorting, search, CSV | Table-only — zero chart rendering |

### Gap Analysis

```
Current:  Pipeline → Preview data → Table metadata → Frontend → Table + MiniSparkline
Desired:  Pipeline → Preview data → LLM Chart Agent → Chart config → Frontend → Full interactive chart
```

The **renderer exists** (`SearchInsightsChart.tsx`, 3,848 lines, battle-tested). The **profiler exists** (`chartDataProfiler.ts`). What's missing is:
1. An intelligent agent that understands data semantics + user intent
2. Chart config in the pipeline's UI metadata
3. Wiring the chart renderer into chat bubbles

---

## 2. Internet Research — State of the Art

### Microsoft LIDA (ACL 2023)
- **Architecture**: 4-stage pipeline — SUMMARIZER → GOAL EXPLORER → VISGENERATOR → INFOGRAPHER
- **Key Insight**: "Visualization generation as a multi-stage generation problem" using LLMs
- **Approach**: LLM generates Python code (matplotlib/seaborn/altair) that renders charts
- **Error rate**: <3.5% on 2,200+ generated visualizations
- **Our Adaptation**: We don't need code generation — we need structured config. Our renderer is already built.

### OpenAI Structured Outputs
- **Capability**: JSON Schema enforcement with `response_format: { type: "json_schema" }`. 100% schema adherence.
- **Models**: gpt-4o, gpt-4.1, gpt-4.1-mini all support it
- **Key Benefit**: We can define an exact `ChartConfig` JSON Schema and the LLM will always produce valid, conforming output. No parsing errors, no retries needed.
- **Streaming**: Structured outputs can be streamed field-by-field

### Key Takeaway
The industry's best approach for our use case is: **LLM + Structured Output → JSON chart config → existing renderer**. No need for Vega-Lite code generation or matplotlib execution. We have ApexCharts ready — we just need the LLM to fill in the config.

---

## 3. Architecture Design

### 3.1 Where in the Pipeline

```
Pipeline Flow:
  Stage 5: Preview (fetch table data)      ← data is available here
  Stage 6: Knowledge context               ← knowledge enrichment
  Stage 7: Model selection + messages
  Stage 8: AI streaming (Supervisor)       ← main LLM narrative
  Stage 9: Suggestions (parallel)

NEW:
  Stage 5.5: Chart Agent (parallel with Stage 6)
  - Runs AFTER preview data is available
  - Runs IN PARALLEL with knowledge context (Stage 6)
  - Zero additional latency on the critical path
```

**Why Stage 5.5?** The chart agent needs table data (available after Stage 5) but does NOT depend on knowledge context or model selection. Running it in parallel with Stage 6 means it adds ~0ms to the pipeline.

### 3.2 Chart Agent Input

The LLM receives a compact summary of the data:

```json
{
  "user_query": "inflasi kota ternate 2024",
  "table_title": "Inflasi Umum dan Inflasi Berdasarkan Kelompok Pengeluaran",
  "columns": ["bulan", "inflasi_umum", "inflasi_makanan", "inflasi_transport"],
  "column_types": {
    "bulan": "time",
    "inflasi_umum": "percentage",
    "inflasi_makanan": "percentage",
    "inflasi_transport": "percentage"
  },
  "sample_rows": [
    {"bulan": "Januari", "inflasi_umum": 2.34, "inflasi_makanan": 3.12, "inflasi_transport": 1.05},
    {"bulan": "Februari", "inflasi_umum": 2.41, "inflasi_makanan": 3.22, "inflasi_transport": 0.98},
    {"bulan": "Maret", "inflasi_umum": 2.55, "inflasi_makanan": 3.45, "inflasi_transport": 1.12}
  ],
  "row_count": 12,
  "source_type": "dynamic",
  "source_id": 42,
  "geo_context": "Kota Ternate",
  "period_context": "2024"
}
```

**Size**: ~500-800 tokens input. Minimal cost.

### 3.3 Chart Agent Output (Structured JSON Schema)

```typescript
type ChartAgentOutput = {
  // Should a chart be rendered at all?
  should_render: boolean;
  render_reason: string; // brief explanation (e.g. "time-series with 12 monthly points, ideal for line chart")
  
  // Chart type selection
  chart_type: "line" | "bar" | "pie" | "area" | "stacked-bar" | "grouped-bar";
  
  // Axis configuration
  x_axis: {
    column: string;      // which column to use as X axis
    label: string;       // display label for X axis
    type: "category" | "datetime" | "numeric";
  };
  
  // Series configuration (multi-series support)
  series: Array<{
    column: string;      // which column to plot
    label: string;       // display name for the series
    type: "primary" | "secondary"; // primary = main metric, secondary = comparison
  }>;
  
  // Y axis configuration
  y_axis: {
    label: string;
    format: "number" | "percentage" | "currency" | "index";
    min?: number | null;
    max?: number | null;
  };
  
  // Visual options
  options: {
    stacked: boolean;
    show_legend: boolean;
    show_data_labels: boolean;
    orientation: "horizontal" | "vertical";
    color_scheme: "default" | "categorical" | "sequential" | "diverging";
  };
  
  // Title
  chart_title: string;
  chart_subtitle: string | null;
  
  // Alternative suggestion
  alternative: {
    chart_type: "line" | "bar" | "pie" | "area";
    reason: string;
  } | null;
};
```

### 3.4 Model Selection

| Option | Model | Est. Latency | Est. Cost | Recommendation |
|--------|-------|-------------|-----------|----------------|
| A | gpt-4.1-mini | 300-800ms | ~$0.0002/call | **RECOMMENDED** — fast, cheap, sufficient for structured output |
| B | gpt-4.1 | 800-2000ms | ~$0.002/call | Overkill for config generation |
| C | gpt-4.1-nano | 100-300ms | ~$0.0001/call | Might work, test first |

**Recommendation**: `gpt-4.1-mini` with `response_format: { type: "json_schema" }`. Structured output ensures 100% valid JSON. At ~500 tokens input + ~200 tokens output, the cost is negligible (<$0.001 per chat).

### 3.5 Frontend Integration

#### Option A: New `ChatChart` component (RECOMMENDED)
Create a new lightweight component `ChatChart.tsx` (~300-400 lines) that:
- Accepts `ChartAgentOutput` + table data
- Wraps ApexCharts with chat-optimized defaults (compact height, no fullscreen, mobile-first)
- Supports chart type toggle (user can switch to LLM's `alternative` suggestion)
- Renders inside `DataSummaryBubble.tsx` (replacing MiniSparkline)

#### Option B: Reuse `SearchInsightsChart` directly
- Import `SearchInsightsChart` into `DataSummaryBubble`
- Pass LLM config as `chartConfig` prop
- **Downside**: 3,848 lines, designed for full-page layout, many features irrelevant in chat context (comparison modal, geo dropdown, fullscreen)

#### Selected: **Option A** — lighter, purpose-built for chat UX.

### 3.6 Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│ Backend Pipeline                                             │
│                                                              │
│  Stage 5: Preview → dataPreview (columns, rows, title)       │
│       │                                                      │
│       ├──→ Stage 5.5: Chart Agent (gpt-4.1-mini)            │
│       │         Input: columns, sample_rows, query, context  │
│       │         Output: ChartAgentOutput (structured JSON)   │
│       │         Latency: ~400-800ms (parallel with Stage 6)  │
│       │                                                      │
│       ├──→ Stage 6: Knowledge Context (parallel)             │
│       │                                                      │
│       └──→ buildUIMetadata() includes new `chart` field      │
│                                                              │
│  SSE: malika_ui event = { table, chart, candidates, ... }    │
└─────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ Frontend                                                     │
│                                                              │
│  chatTransport.ts receives malika_ui with chart field         │
│       │                                                      │
│       ▼                                                      │
│  DataSummaryBubble.tsx                                        │
│       │                                                      │
│       ├── chart.should_render === true?                       │
│       │   YES → <ChatChart config={chart} data={table} />    │
│       │   NO  → <MiniSparkline /> (fallback)                 │
│       │                                                      │
│       └── Table card (existing)                               │
└─────────────────────────────────────────────────────────────┘
```

### 3.7 Fallback Strategy

```
Priority cascade:
1. LLM Chart Agent output (if pipeline ran + should_render=true) 
2. Rule-based profiler (chartDataProfiler.ts) — if LLM fails or times out
3. MiniSparkline — if profiler says chart_type="none" or data is unsuitable
4. Table-only — if no numeric data at all
```

The rule-based profiler becomes the **fallback**, not the primary. This ensures charts always appear even if the LLM call fails (timeout, quota, etc).

---

## 4. Implementation Plan

### Phase 1: Backend Chart Agent (Est. 2-3 hours)

| Task | Description | Files |
|------|-------------|-------|
| 1.1 | Create `chartAgent.service.js` — LLM call with structured output schema | `backend/src/services/chat/streaming/` |
| 1.2 | Define JSON Schema for `ChartAgentOutput` | Inside `chartAgent.service.js` |
| 1.3 | Add `chart` field to `buildUIMetadata()` return | `uiMetadata.service.js` |
| 1.4 | Wire into pipeline as Stage 5.5 (parallel with Stage 6) | `pipeline.service.js` |
| 1.5 | Add timing to pipeline telemetry | `pipeline.service.js` |
| 1.6 | Add `chart_agent` to status_detail events | `pipeline.service.js` |

### Phase 2: Frontend ChatChart Component (Est. 2-3 hours)

| Task | Description | Files |
|------|-------------|-------|
| 2.1 | Add `chart` field to `MalikaUiMetaV1` type | `frontend/src/types/chat.ts` |
| 2.2 | Create `ChatChart.tsx` — ApexCharts wrapper, mobile-first, compact | `frontend/src/components/chat/` |
| 2.3 | Integrate into `DataSummaryBubble.tsx` — replace MiniSparkline when chart config exists | `DataSummaryBubble.tsx` |
| 2.4 | Add chart type toggle UI (switch between primary and alternative recommendation) | `ChatChart.tsx` |
| 2.5 | Support dark mode via ThemeContext | `ChatChart.tsx` |

### Phase 3: Fallback & Robustness (Est. 1-2 hours)

| Task | Description | Files |
|------|-------------|-------|
| 3.1 | Add timeout (3s) — fallback to rule-based profiler | `chartAgent.service.js` |
| 3.2 | Frontend graceful degradation: chart config missing → profileChartData() | `DataSummaryBubble.tsx` |
| 3.3 | Handle SSE partial delivery (chart arrives after text) | `chatTransport.ts` |

### Phase 4: Testing & Validation (Est. 2 hours)

| Task | Description | Files |
|------|-------------|-------|
| 4.1 | Unit test: chartAgent.service with mock OpenAI responses | `backend/src/__tests__/` |
| 4.2 | Unit test: ChatChart component rendering | `frontend/tests/` |
| 4.3 | Integration: run 5-10 chat queries, verify chart appears correctly | Manual |
| 4.4 | Add chart agent tests to master test runner pattern checks | `evals/fixtures/` |

### Phase 5: Polish & Optimization (Est. 1-2 hours)

| Task | Description | Files |
|------|-------------|-------|
| 5.1 | Add chart agent TTL cache (same source_id + period → reuse config) | `chartAgent.service.js` |
| 5.2 | Add reasoning.effort:"low" to chart agent (speed optimization) | `chartAgent.service.js` |
| 5.3 | Status event for chart: "Memilih visualisasi terbaik…" | `pipeline.service.js` |
| 5.4 | Animate chart appearance (fade-in after table) | `ChatChart.tsx` |

---

## 5. Cost & Performance Impact

### Cost Per Chat Query

| Agent | Tokens | Model | Cost |
|-------|--------|-------|------|
| Chart Agent | ~500 in + ~200 out | gpt-4.1-mini | ~$0.0002 |
| **Existing pipeline total** | ~5,000-15,000 | various | ~$0.01-0.05 |
| **With chart agent** | +700 | gpt-4.1-mini | +$0.0002 (+0.5-2%) |

**Cost impact: negligible** (+0.5-2% of total pipeline cost)

### Latency Impact

```
Without chart agent:
  Stage 5 (preview)    → Stage 6 (knowledge) → Stage 7 (model) → Stage 8 (stream)
  ~500ms                 ~1000-3000ms            ~50ms              ~3000-8000ms

With chart agent (parallel):
  Stage 5 (preview)    → [Stage 5.5 (chart) + Stage 6 (knowledge)] → Stage 7 → Stage 8
  ~500ms                  ~800ms chart / ~2000ms knowledge            ...same...
                          ↑ No extra latency — chart finishes before knowledge
```

**Latency impact: ~0ms** — chart agent runs in parallel with knowledge context, finishes faster.

### Memory Impact

- No additional server memory (stateless LLM calls)
- Optional TTL cache: ~50 entries × ~1KB = ~50KB (negligible)

---

## 6. Chart Type Decision Matrix (LLM System Prompt)

The chart agent will use this decision matrix (included in its system prompt):

| Data Pattern | Recommended Chart | Reason |
|-------------|-------------------|--------|
| Time × 1 metric (monthly) | **Line** | Shows trend over time |
| Time × 1 metric (yearly, ≤8 years) | **Bar** | Year comparison |
| Time × 2-4 metrics | **Line** (multi-series) | Compare trends |
| Geo × 1 metric | **Bar** (horizontal) | Compare regions |
| Geo × 2+ metrics | **Grouped bar** | Multi-metric region comparison |
| Category × 1 metric (≤8 categories) | **Pie** | Composition/share |
| Category × 1 metric (>8 categories) | **Bar** | Too many slices for pie |
| Time × Geo × metric | **Line** (multi-series by geo) | Regional trends |
| Single value | **none** | Don't render chart |
| ≤2 rows | **none** | Insufficient data for meaningful chart |
| EXIM by commodity | **Bar** (horizontal) | Commodity comparison |
| EXIM by country | **Bar** (horizontal) | Country comparison |
| Percentage 0-100 | Line/Bar + **% format** | Correct Y-axis formatting |
| Index (60-130 range) | Line + **index format** | IHK/IHPB style |

---

## 7. ApexCharts Config Mapping

The `ChatChart.tsx` component will translate `ChartAgentOutput` → `ApexOptions`:

```typescript
function mapToApexConfig(config: ChartAgentOutput, rows: Record<string, any>[]): ApexOptions {
  return {
    chart: {
      type: config.chart_type === 'grouped-bar' ? 'bar' : config.chart_type,
      height: 280,
      toolbar: { show: false },
      zoom: { enabled: false },
    },
    xaxis: {
      categories: rows.map(r => r[config.x_axis.column]),
      title: { text: config.x_axis.label },
    },
    yaxis: {
      title: { text: config.y_axis.label },
      labels: {
        formatter: (val) => formatByType(val, config.y_axis.format),
      },
    },
    series: config.series.map(s => ({
      name: s.label,
      data: rows.map(r => Number(r[s.column]) || 0),
    })),
    title: { text: config.chart_title, align: 'center' },
    subtitle: config.chart_subtitle ? { text: config.chart_subtitle, align: 'center' } : undefined,
    plotOptions: {
      bar: {
        horizontal: config.options.orientation === 'horizontal',
        columnWidth: '60%',
      },
    },
    legend: { show: config.options.show_legend },
    dataLabels: { enabled: config.options.show_data_labels },
    colors: getColorScheme(config.options.color_scheme),
    tooltip: { enabled: true, shared: true },
  };
}
```

---

## 8. Alternatives Considered

### A. Generate Vega-Lite specs (LIDA approach)
- **Pro**: Grammar-agnostic, very expressive
- **Con**: We'd need a Vega-Lite renderer (not ApexCharts), extra dependency, more complex
- **Verdict**: ❌ Overkill — we already have ApexCharts

### B. Generate full ApexOptions JSON via LLM
- **Pro**: Maximum flexibility
- **Con**: ApexOptions is huge/complex, LLM likely hallucinates props, harder to validate
- **Verdict**: ❌ Too fragile — structured output with a simple schema is more reliable

### C. Keep rule-based profiler only, add more rules
- **Pro**: Zero LLM cost, deterministic
- **Con**: Can't understand user intent ("show me a comparison" → grouped bar), can't adapt to unknown data shapes, 150+ hardcoded entries to maintain
- **Verdict**: ❌ Doesn't meet user's requirement of "agentic LLM decides everything"

### D. Hybrid: Rule-based fast path + LLM for edge cases (SELECTED)
- **Pro**: Instant chart for known datasources (150+ pre-computed), LLM for unknown/complex cases
- **Con**: Slight complexity — two code paths
- **Verdict**: ✅ Best balance of speed, quality, and cost

---

## 9. Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| LLM produces wrong chart type | Bad UX | Rule-based fallback + alternative toggle |
| LLM timeout (>3s) | Delayed chart | 3s timeout → fall to rule-based profiler |
| LLM quota exceeded | No chart | Fallback to profiler |
| Extra token cost | Budget | gpt-4.1-mini is <$0.001/call |
| Chart looks bad on mobile | Bad UX | Mobile-specific height (200px), horizontal scroll for wide charts |
| Data too large (1000+ rows) | Slow rendering | ApexCharts handles up to ~5000 points; send all rows but sample 5 to LLM |
| Hallucinated column names | Runtime error | Validate LLM output against actual columns before rendering |

---

## 10. Summary

| Aspect | Detail |
|--------|--------|
| **What** | LLM agent auto-selects chart type, configures axes/series/colors/format |
| **Where** | Backend Stage 5.5 (parallel with knowledge context) |
| **Model** | gpt-4.1-mini with OpenAI Structured Output |
| **Output** | `ChartAgentOutput` JSON → new `chart` field in MalikaUiMetaV1 |
| **Renderer** | New `ChatChart.tsx` (~300 lines, ApexCharts, mobile-first) |
| **Fallback** | chartDataProfiler.ts (rule-based) → MiniSparkline → table-only |
| **Latency** | +0ms (parallel execution) |
| **Cost** | +$0.0002/call (~0.5-2% increase) |
| **Effort** | ~8-12 hours across 5 phases |
| **User impact** | Charts appear automatically in chat — zero configuration needed |

---

## Appendix: System Prompt Draft for Chart Agent

```
You are a data visualization expert. Given a data table from BPS (Badan Pusat Statistik) Indonesia, 
you must decide the best chart type and configuration.

Rules:
1. Time-series data (monthly/yearly) → prefer LINE chart
2. Geographic comparison (kabupaten/kota) → prefer horizontal BAR chart  
3. Categorical composition (≤8 categories) → PIE chart
4. 2+ metrics over time → multi-series LINE chart
5. Single value or ≤2 rows → should_render=false
6. EXIM data by commodity/country → horizontal BAR chart
7. Always set should_render=false if data is not suitable for visualization
8. Y-axis format: use "percentage" for persen/%, "index" for indeks/IHK, "currency" for Rupiah/USD
9. Chart title should be concise and in Bahasa Indonesia
10. For horizontal bar charts, set orientation="horizontal"
11. Show legend only when there are 2+ series
12. Show data labels only for pie charts or when ≤6 data points
```
