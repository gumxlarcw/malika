# Checkpoint: Improvement Query & Response Logic Chat MALIKA

**Tanggal:** 20 Januari 2026  
**Status:** Analysis Complete - Ready for Implementation  
**Priority:** High - Scalability Improvement

---

## Executive Summary

Dokumen ini berisi analisis mendalam terhadap logic query dan response pada Chat MALIKA, dengan fokus pada:
1. **Current State Analysis** - Bagaimana sistem bekerja sekarang
2. **Bottlenecks & Pain Points** - Masalah yang teridentifikasi
3. **Improvement Roadmap** - Langkah-langkah perbaikan bertahap
4. **Scalability Considerations** - Pertimbangan untuk skala besar

---

## 1. Current State Analysis

### 1.1 Query Processing Pipeline (Current)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    CURRENT QUERY PROCESSING PIPELINE                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 1: MESSAGE TYPE DETECTION                                              │
│ ─────────────────────────────────────────────────────────────────────────── │
│ Functions:                                                                   │
│ • isGreeting() - "halo", "selamat pagi"                                     │
│ • isConfirmMessage() - "ya", "ok", "tampilkan datanya"                      │
│ • isLikelyTimeOrPeriodFragment() - "tahun 2024", "untuk kepsul"             │
│ • isLikelyGeoOnlyFragment() - "morotai", "ternate"                          │
│ • isShortFollowUp() - "2024 ada?", "tampilkan"                              │
│ • isComparisonFollowUp() - "bandingkan dengan kabupaten lain"               │
│ • isAlternativeSourceRequest() - "coba sumber lain"                         │
│ • isProceduralFaqQuery() - "cara mengunduh data", "jam buka"                │
│ • isDifferentDataTypeRequest() - "proyeksi penduduk" vs "jumlah penduduk"   │
│                                                                              │
│ ISSUES:                                                                      │
│ ⚠️ Banyak fungsi terpisah → sulit di-maintain                                │
│ ⚠️ Urutan pengecekan tidak konsisten                                         │
│ ⚠️ Overlap detection (satu query bisa match multiple types)                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 2: CONTEXT MERGING                                                     │
│ ─────────────────────────────────────────────────────────────────────────── │
│ Functions:                                                                   │
│ • findLastMeaningfulUserQuery() - cari query terakhir yang substantif       │
│ • findConversationTopic() - cari topik dari history                         │
│ • mergeQuery() - gabungkan base + fragment                                  │
│ • filterQueryFillers() - hapus stopwords                                    │
│                                                                              │
│ LOGIC:                                                                       │
│ if (isConfirm && prevQuery) → use prevQuery                                 │
│ if (isPeriodFragment && prevQuery) → merge(prevQuery, current)              │
│ if (isGeoFragment && prevQuery) → merge(prevQuery, current)                 │
│ if (isNewTopic) → reset context, use current                                │
│                                                                              │
│ ISSUES:                                                                      │
│ ⚠️ Heuristic-based, mudah salah                                              │
│ ⚠️ Tidak ada "memory" eksplisit → rely on parsing string                     │
│ ⚠️ Kadang salah merge (topic A + fragment B)                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 3: INTENT RESOLUTION                                                   │
│ ─────────────────────────────────────────────────────────────────────────── │
│ Functions:                                                                   │
│ • resolveSearchIntent() - parse query ke structured intent                  │
│ • buildDatasourceCandidates() - cari datasource yang cocok                  │
│ • detectMergeBundle() - cek apakah multi-source merge                       │
│ • detectMonthlyBundle() - cek inflasi/IHK merge                             │
│ • inferEximGroupFromQuery() - untuk data ekspor/impor                       │
│                                                                              │
│ ISSUES:                                                                      │
│ ⚠️ resolveSearchIntent() depends on external intent.service.js              │
│ ⚠️ Bundle detection hardcoded (MERGE_BUNDLES, MONTHLY_BUNDLES)              │
│ ⚠️ EXIM detection terpisah dari general intent                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 4: DATA FETCHING                                                       │
│ ─────────────────────────────────────────────────────────────────────────── │
│ Functions:                                                                   │
│ • getProcessedPreviewFromCache() - fetch dari data_bps atau cache           │
│ • getProcessedPreviewForRange() - fetch multiple years                      │
│ • getExtendedMergePreview() - merge multiple sources                        │
│ • getMonthlyMergePreview() - merge inflasi + IHK                            │
│ • getMergedMultiSourcePreview() - merge by dimension                        │
│ • getEximPreviewFromApi() - fetch EXIM data                                 │
│ • findNearestAvailablePeriod() - fallback jika tahun tidak tersedia         │
│                                                                              │
│ ISSUES:                                                                      │
│ ⚠️ Too many fetch functions → difficult to trace                            │
│ ⚠️ No unified caching strategy                                               │
│ ⚠️ Fallback chain unclear                                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 5: RAG KNOWLEDGE SEARCH                                                │
│ ─────────────────────────────────────────────────────────────────────────── │
│ • vectorSearchService.searchKnowledge() - semantic search                   │
│ • knowledgePatternsService.detectServiceQuery() - pattern match             │
│                                                                              │
│ ISSUES:                                                                      │
│ ⚠️ In-memory embeddings (RAM-bound)                                          │
│ ⚠️ Fixed 5-minute cache TTL                                                  │
│ ⚠️ Knowledge dan data search tidak terintegrasi                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Response Generation Pipeline (Current)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                   CURRENT RESPONSE GENERATION PIPELINE                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 1: BUILD SYSTEM PROMPT                                                 │
│ ─────────────────────────────────────────────────────────────────────────── │
│ Function: systemPrompt(context)                                             │
│                                                                              │
│ Context flags:                                                               │
│ • hasDataPreview - tabel data sudah ada                                     │
│ • hasCandidates - ada datasource tapi belum di-load                         │
│ • lowConfidence - kecocokan rendah                                          │
│ • periodFallback - tahun diminta tidak ada, pakai alternatif                │
│ • multiSourceDisclaimer - data dari sumber berbeda                          │
│                                                                              │
│ ISSUES:                                                                      │
│ ⚠️ System prompt terlalu panjang (~2000+ chars)                              │
│ ⚠️ Rules banyak tapi LLM sering langgar                                      │
│ ⚠️ Tidak ada structured output constraint                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 2: BUILD OPENAI MESSAGES                                               │
│ ─────────────────────────────────────────────────────────────────────────── │
│ Messages array:                                                              │
│ 1. system: base prompt + context rules                                      │
│ 2. system: knowledge context (if RAG hits)                                  │
│ 3. system: data table context (if preview exists)                           │
│ 4. history: last 16-20 messages (stripped of malika_ui)                     │
│ 5. user: current message                                                    │
│                                                                              │
│ ISSUES:                                                                      │
│ ⚠️ Multiple system messages → token wastage                                  │
│ ⚠️ History limit arbitrary (16-20)                                           │
│ ⚠️ No token counting before sending                                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 3: OPENAI STREAMING CALL                                               │
│ ─────────────────────────────────────────────────────────────────────────── │
│ • fetchOpenAIWithRetry() - with timeout + backoff                           │
│ • Stream parsing → send SSE chunks                                          │
│                                                                              │
│ ISSUES:                                                                      │
│ ⚠️ No streaming abort if user closes connection                             │
│ ⚠️ Retry logic bisa cause duplicate responses                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 4: POST-PROCESSING                                                     │
│ ─────────────────────────────────────────────────────────────────────────── │
│ Functions:                                                                   │
│ • stripMarkdownFormatting() - hapus **bold**, #heading, dll                 │
│ • linkifyWhatsAppNumber() - convert phone to wa.me link                     │
│ • buildUiMeta() - generate malika_ui JSON block                             │
│ • buildContextualSuggestions() - quick reply chips                          │
│                                                                              │
│ ISSUES:                                                                      │
│ ⚠️ Post-processing setelah streaming → user sudah lihat markdown            │
│ ⚠️ No hallucination detection post-response                                 │
│ ⚠️ UI metadata sometimes stale                                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Identified Issues & Bottlenecks

### 2.1 Query Processing Issues

| Issue ID | Severity | Description | Impact |
|----------|----------|-------------|--------|
| Q-001 | 🔴 High | **Fragmented Detection Logic** - 10+ fungsi isXxx() terpisah | Hard to maintain, inconsistent behavior |
| Q-002 | 🔴 High | **Heuristic Context Merging** - String parsing tanpa semantic | Salah merge topik A dengan fragment B |
| Q-003 | 🟡 Medium | **No Query Normalization** - Abbreviasi tidak di-expand | "TPT" tidak match "pengangguran" |
| Q-004 | 🟡 Medium | **Hardcoded Bundles** - MERGE_BUNDLES manual | Tidak scalable untuk datasource baru |
| Q-005 | 🟡 Medium | **EXIM Logic Separate** - Berbeda dari general intent | Duplicate code, maintenance burden |
| Q-006 | 🟢 Low | **No Query Logging** - Tidak track query patterns | Sulit improve dari real usage |

### 2.2 Response Generation Issues

| Issue ID | Severity | Description | Impact |
|----------|----------|-------------|--------|
| R-001 | 🔴 High | **System Prompt Too Long** - 2000+ chars | Token waste, rules ignored |
| R-002 | 🔴 High | **No Structured Output** - Free-form LLM | Inconsistent format, hallucination |
| R-003 | 🟡 Medium | **Post-stream Markdown Strip** - User sees raw ** | Poor UX during streaming |
| R-004 | 🟡 Medium | **Static Suggestions** - Tidak context-aware | Irrelevant quick replies |
| R-005 | 🟡 Medium | **No Response Caching** - Same query = same OpenAI call | Cost inefficiency |
| R-006 | 🟢 Low | **Greeting Separate Path** - Different logic | Inconsistent behavior |

### 2.3 Scalability Issues

| Issue ID | Severity | Description | Impact |
|----------|----------|-------------|--------|
| S-001 | 🔴 High | **In-Memory Embeddings** - All loaded to RAM | Memory bound, slow startup |
| S-002 | 🔴 High | **No Query Cache** - Every query hits OpenAI | High cost, latency |
| S-003 | 🟡 Medium | **Sequential Fetches** - Some operations not parallelized | Slow response |
| S-004 | 🟡 Medium | **No Rate Limiting** - Per user/IP | Abuse potential |
| S-005 | 🟡 Medium | **Single DB Connection** - No read replicas | Bottleneck under load |

---

## 3. Improvement Roadmap

### Phase 1: Quick Wins (1-2 minggu)

#### 3.1.1 Unified Message Type Classifier

**Current State:**
```javascript
// 10+ separate functions
if (isGreeting(msg)) { ... }
else if (isConfirmMessage(msg)) { ... }
else if (isLikelyTimeOrPeriodFragment(msg)) { ... }
// ... etc
```

**Proposed:**
```javascript
/**
 * Unified message classifier
 * Returns single classification with confidence
 */
const MESSAGE_TYPES = {
  GREETING: 'greeting',
  CONFIRMATION: 'confirmation',
  PERIOD_FRAGMENT: 'period_fragment',
  GEO_FRAGMENT: 'geo_fragment',
  DATA_QUERY: 'data_query',
  SERVICE_QUERY: 'service_query',
  COMPARISON: 'comparison',
  FOLLOW_UP: 'follow_up',
};

function classifyMessage(rawMessage, historyContext = null) {
  const msg = String(rawMessage || '').toLowerCase().trim();
  if (!msg) return { type: null, confidence: 0 };
  
  const classifications = [];
  
  // Priority-ordered checks (highest priority first)
  const checks = [
    { type: MESSAGE_TYPES.GREETING, check: checkGreeting, priority: 100 },
    { type: MESSAGE_TYPES.CONFIRMATION, check: checkConfirmation, priority: 90 },
    { type: MESSAGE_TYPES.SERVICE_QUERY, check: checkServiceQuery, priority: 80 },
    { type: MESSAGE_TYPES.GEO_FRAGMENT, check: checkGeoFragment, priority: 70 },
    { type: MESSAGE_TYPES.PERIOD_FRAGMENT, check: checkPeriodFragment, priority: 60 },
    { type: MESSAGE_TYPES.COMPARISON, check: checkComparison, priority: 50 },
    { type: MESSAGE_TYPES.FOLLOW_UP, check: checkFollowUp, priority: 40 },
    { type: MESSAGE_TYPES.DATA_QUERY, check: checkDataQuery, priority: 30 },
  ];
  
  for (const { type, check, priority } of checks) {
    const result = check(msg, historyContext);
    if (result.matched) {
      classifications.push({
        type,
        confidence: result.confidence,
        priority,
        details: result.details,
      });
    }
  }
  
  // Return highest priority match above threshold
  const threshold = 0.6;
  const validMatches = classifications.filter(c => c.confidence >= threshold);
  validMatches.sort((a, b) => b.priority - a.priority);
  
  return validMatches[0] || { type: MESSAGE_TYPES.DATA_QUERY, confidence: 0.5 };
}
```

**Benefits:**
- ✅ Single entry point for classification
- ✅ Priority-based disambiguation
- ✅ Confidence scores for edge cases
- ✅ Easier to test and maintain

---

#### 3.1.2 Query Normalization Layer

**Proposed Implementation:**

```javascript
// backend/src/services/chat/queryNormalization.service.js

const ABBREVIATION_MAP = {
  // Indikator
  'tpt': 'tingkat pengangguran terbuka',
  'tpak': 'tingkat partisipasi angkatan kerja',
  'ipm': 'indeks pembangunan manusia',
  'pdrb': 'produk domestik regional bruto',
  'ahh': 'angka harapan hidup',
  'hls': 'harapan lama sekolah',
  'rls': 'rata-rata lama sekolah',
  'ihk': 'indeks harga konsumen',
  'ntb': 'nilai tambah bruto',
  
  // Geo
  'kepsul': 'kepulauan sula',
  'halsel': 'halmahera selatan',
  'halut': 'halmahera utara',
  'halbar': 'halmahera barat',
  'haltim': 'halmahera timur',
  'halteng': 'halmahera tengah',
  'tikep': 'tidore kepulauan',
  'malut': 'maluku utara',
  
  // Time
  'thn': 'tahun',
  'bln': 'bulan',
};

const SYNONYM_MAP = {
  'penduduk miskin': ['orang miskin', 'warga miskin', 'masyarakat miskin'],
  'pengangguran': ['nganggur', 'tidak bekerja', 'belum bekerja'],
  'inflasi': ['kenaikan harga', 'harga naik'],
  'ekspor': ['eksport', 'export'],
  'impor': ['import'],
};

function normalizeQuery(rawQuery) {
  let q = String(rawQuery || '').toLowerCase().trim();
  if (!q) return { original: rawQuery, normalized: '', changes: [] };
  
  const changes = [];
  
  // 1. Expand abbreviations
  for (const [abbrev, full] of Object.entries(ABBREVIATION_MAP)) {
    const regex = new RegExp(`\\b${abbrev}\\b`, 'gi');
    if (regex.test(q)) {
      q = q.replace(regex, full);
      changes.push({ type: 'abbreviation', from: abbrev, to: full });
    }
  }
  
  // 2. Normalize time expressions
  q = q.replace(/thn\s*(\d{4})/gi, 'tahun $1');
  q = q.replace(/bln\s+(\w+)/gi, 'bulan $1');
  
  // 3. Normalize punctuation
  q = q.replace(/[?!.,;:]+$/, '');
  q = q.replace(/\s+/g, ' ').trim();
  
  return {
    original: rawQuery,
    normalized: q,
    changes,
  };
}

module.exports = { normalizeQuery, ABBREVIATION_MAP, SYNONYM_MAP };
```

**Integration Point:**
```javascript
// In streaming.service.js, add at start of streamChatResponse
const { normalized, changes } = normalizeQuery(userMessage);
const effectiveQuery = normalized;
// Log changes for analytics
if (changes.length > 0) {
  console.log('[QueryNorm] Expansions:', changes);
}
```

---

#### 3.1.3 Optimized System Prompt

**Current Problem:** System prompt terlalu panjang dengan banyak rules yang sering dilanggar.

**Proposed: Tiered System Prompt**

```javascript
// Prompt dipisah jadi tiers berdasarkan context

const PROMPT_TIERS = {
  // Always included - core identity (minimal)
  core: `Kamu MALIKA, customer service BPS Maluku Utara. Jawab singkat, sopan, tanpa markdown.`,
  
  // Data mode - when hasDataPreview
  data_mode: `
DATA TERSEDIA di tabel. WAJIB:
- Sebut angka spesifik dari tabel
- Bandingkan dengan rata-rata jika ada
- Jangan bilang "relatif tinggi/rendah" tanpa angka`,

  // No data mode - when !hasDataPreview && !hasCandidates
  no_data_mode: `
DATA TIDAK ADA. WAJIB:
- Katakan data tidak ditemukan
- Minta klarifikasi: indikator apa, tahun berapa, wilayah mana
- DILARANG menyebut angka apapun`,

  // Candidates mode - has datasources but not loaded
  candidates_mode: `
DATASOURCE DITEMUKAN tapi belum dimuat. 
- Sebutkan nama indikator yang cocok
- Tawarkan untuk melihat datanya
- DILARANG menyebut angka`,

  // Knowledge mode - answering service/FAQ
  knowledge_mode: `
PERTANYAAN LAYANAN/FAQ.
- Jawab berdasarkan knowledge base
- Jika tidak tahu, arahkan ke WhatsApp BPS`,

  // Anti-hallucination (always for data queries)
  anti_hallucination: `
ANTI HALUSINASI:
- Angka HANYA dari tabel yang diberikan
- Jika tidak ada di tabel, katakan "tidak tersedia di tabel ini"`,
};

function buildSystemPrompt(context) {
  const parts = [PROMPT_TIERS.core];
  
  if (context.hasDataPreview) {
    parts.push(PROMPT_TIERS.data_mode);
    parts.push(PROMPT_TIERS.anti_hallucination);
  } else if (context.hasCandidates) {
    parts.push(PROMPT_TIERS.candidates_mode);
  } else if (context.isKnowledgeMode) {
    parts.push(PROMPT_TIERS.knowledge_mode);
  } else {
    parts.push(PROMPT_TIERS.no_data_mode);
  }
  
  return parts.join('\n\n');
}
```

**Benefits:**
- ✅ Shorter prompts (save tokens)
- ✅ Context-specific rules only
- ✅ Easier to update individual tiers

---

### Phase 2: Structural Improvements (2-4 minggu)

#### 3.2.1 Explicit Conversation State Machine

**Proposed: Replace implicit heuristics with explicit state tracking**

```javascript
// backend/src/services/chat/conversationState.service.js

/**
 * Conversation State Machine
 * Tracks explicit state instead of heuristic parsing
 */
class ConversationState {
  constructor(threadId) {
    this.threadId = threadId;
    this.currentTopic = null;        // "kemiskinan", "inflasi", etc
    this.lockedSourceId = null;      // Active datasource
    this.lockedSourceName = null;
    this.requestedYear = null;       // Last requested year
    this.requestedGeo = null;        // Last requested geo
    this.mentionedYears = new Set(); // All years mentioned
    this.mentionedGeos = new Set();  // All geos mentioned
    this.mode = 'idle';              // 'idle' | 'data' | 'knowledge' | 'exim'
    this.lastIntent = null;
    this.turnCount = 0;
  }
  
  /**
   * Update state based on classified message
   */
  update(classification, intentResult) {
    this.turnCount++;
    
    switch (classification.type) {
      case 'data_query':
        this.mode = 'data';
        if (intentResult?.topic) this.currentTopic = intentResult.topic;
        if (intentResult?.year) {
          this.requestedYear = intentResult.year;
          this.mentionedYears.add(intentResult.year);
        }
        if (intentResult?.geo) {
          this.requestedGeo = intentResult.geo;
          this.mentionedGeos.add(intentResult.geo);
        }
        if (intentResult?.sourceId) {
          this.lockedSourceId = intentResult.sourceId;
          this.lockedSourceName = intentResult.sourceName;
        }
        break;
        
      case 'period_fragment':
        // Keep topic, update year
        if (classification.details?.year) {
          this.requestedYear = classification.details.year;
          this.mentionedYears.add(classification.details.year);
        }
        break;
        
      case 'geo_fragment':
        // Keep topic, update geo
        if (classification.details?.geo) {
          this.requestedGeo = classification.details.geo;
          this.mentionedGeos.add(classification.details.geo);
        }
        break;
        
      case 'confirmation':
        // Keep all state, just confirm action
        break;
        
      case 'greeting':
      case 'service_query':
        // Reset data state for greetings and service queries
        if (classification.type === 'greeting') {
          this.mode = 'idle';
        } else {
          this.mode = 'knowledge';
        }
        break;
    }
    
    this.lastIntent = intentResult;
  }
  
  /**
   * Build effective query from state
   */
  buildEffectiveQuery(currentMessage) {
    if (!this.currentTopic) return currentMessage;
    
    const parts = [this.currentTopic];
    if (this.requestedYear) parts.push(`tahun ${this.requestedYear}`);
    if (this.requestedGeo) parts.push(this.requestedGeo);
    
    return parts.join(' ');
  }
  
  /**
   * Check if should break context
   */
  shouldBreakContext(classification, intentResult) {
    // New topic detected
    if (intentResult?.topic && intentResult.topic !== this.currentTopic) {
      return true;
    }
    // Different data type requested
    if (classification.details?.wantsDifferentType) {
      return true;
    }
    return false;
  }
  
  /**
   * Serialize for storage
   */
  toJSON() {
    return {
      threadId: this.threadId,
      currentTopic: this.currentTopic,
      lockedSourceId: this.lockedSourceId,
      lockedSourceName: this.lockedSourceName,
      requestedYear: this.requestedYear,
      requestedGeo: this.requestedGeo,
      mentionedYears: Array.from(this.mentionedYears),
      mentionedGeos: Array.from(this.mentionedGeos),
      mode: this.mode,
      turnCount: this.turnCount,
    };
  }
  
  /**
   * Restore from storage
   */
  static fromJSON(json) {
    const state = new ConversationState(json.threadId);
    state.currentTopic = json.currentTopic;
    state.lockedSourceId = json.lockedSourceId;
    state.lockedSourceName = json.lockedSourceName;
    state.requestedYear = json.requestedYear;
    state.requestedGeo = json.requestedGeo;
    state.mentionedYears = new Set(json.mentionedYears || []);
    state.mentionedGeos = new Set(json.mentionedGeos || []);
    state.mode = json.mode || 'idle';
    state.turnCount = json.turnCount || 0;
    return state;
  }
}

module.exports = { ConversationState };
```

**Storage Strategy:**
```javascript
// Store in ChatThread.summary as JSON
// OR add new column: chat_threads.conversation_state JSON

async function loadConversationState(threadId) {
  const thread = await ChatThread.findByPk(threadId);
  if (thread?.conversation_state) {
    return ConversationState.fromJSON(JSON.parse(thread.conversation_state));
  }
  return new ConversationState(threadId);
}

async function saveConversationState(state) {
  await ChatThread.update(
    { conversation_state: JSON.stringify(state.toJSON()) },
    { where: { id: state.threadId } }
  );
}
```

**Benefits:**
- ✅ Explicit state vs implicit heuristics
- ✅ Survives context window limits
- ✅ Debuggable (can log state transitions)
- ✅ Supports complex conversation flows

---

#### 3.2.2 Response Template Engine

**Proposed: Structured response templates untuk consistency**

```javascript
// backend/src/services/chat/responseTemplates.service.js

const RESPONSE_TEMPLATES = {
  data_found: {
    template: `{interpretation}

Data yang ditampilkan adalah {indicator} untuk {period}{geo_suffix}.

{follow_up}`,
    requiredVars: ['interpretation', 'indicator', 'period'],
    optionalVars: ['geo_suffix', 'follow_up'],
  },
  
  data_not_found: {
    template: `Mohon maaf, saya belum menemukan data "{query}" yang sesuai.

Beberapa kemungkinan:
1. Indikator belum tersedia
2. Periode yang diminta belum ada
3. Perlu klarifikasi lebih lanjut

Bisa jelaskan lebih spesifik: indikator apa, tahun berapa, dan wilayah mana?`,
    requiredVars: ['query'],
  },
  
  period_fallback: {
    template: `Data tahun {requested_year} belum tersedia.

Tahun yang tersedia: {available_years}.

Berikut data tahun {actual_year} sebagai referensi:

{interpretation}`,
    requiredVars: ['requested_year', 'actual_year', 'available_years', 'interpretation'],
  },
  
  candidates_found: {
    template: `Saya menemukan beberapa indikator yang mungkin sesuai:

{candidate_list}

Apakah salah satu yang Anda maksud?`,
    requiredVars: ['candidate_list'],
  },
  
  knowledge_answer: {
    template: `{answer}

{contact_info}`,
    requiredVars: ['answer'],
    optionalVars: ['contact_info'],
  },
  
  greeting: {
    template: `Halo! Saya MALIKA, asisten virtual BPS Maluku Utara.

Ada yang bisa saya bantu terkait data statistik?`,
    requiredVars: [],
  },
};

function buildResponse(templateKey, variables) {
  const template = RESPONSE_TEMPLATES[templateKey];
  if (!template) {
    throw new Error(`Unknown template: ${templateKey}`);
  }
  
  // Validate required vars
  for (const v of template.requiredVars) {
    if (!variables[v]) {
      console.warn(`[ResponseTemplate] Missing required var: ${v}`);
    }
  }
  
  let response = template.template;
  
  for (const [key, value] of Object.entries(variables)) {
    response = response.replace(`{${key}}`, value || '');
  }
  
  // Clean up unused optional vars
  response = response.replace(/\{[a-z_]+\}/gi, '');
  
  return response.trim();
}

module.exports = { RESPONSE_TEMPLATES, buildResponse };
```

**Integration with LLM:**
```javascript
// Instead of free-form LLM response, use structured output

async function generateStructuredResponse(context) {
  // Ask LLM for structured interpretation only
  const interpretationPrompt = `
Berdasarkan tabel data berikut, berikan interpretasi singkat (2-3 kalimat):
${formatTableForLLM(context.dataPreview)}

Output format: {"interpretation": "...", "highlights": ["...", "..."]}
`;

  const structured = await callOpenAIJSON(interpretationPrompt);
  
  // Use template to build final response
  return buildResponse('data_found', {
    interpretation: structured.interpretation,
    indicator: context.sourceName,
    period: context.year,
    geo_suffix: context.geo ? ` untuk ${context.geo}` : '',
    follow_up: buildFollowUpSuggestion(context),
  });
}
```

---

#### 3.2.3 Query Result Caching

**Proposed: Cache frequent queries to reduce OpenAI calls**

```javascript
// backend/src/services/chat/queryCache.service.js

const crypto = require('crypto');

// In-memory cache with TTL (can upgrade to Redis)
const queryCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function hashQuery(query, sourceId, year) {
  const key = JSON.stringify({ q: query.toLowerCase().trim(), s: sourceId, y: year });
  return crypto.createHash('md5').update(key).digest('hex');
}

async function getCachedResponse(query, sourceId, year) {
  const hash = hashQuery(query, sourceId, year);
  const cached = queryCache.get(hash);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log('[QueryCache] HIT:', hash.slice(0, 8));
    return cached.response;
  }
  
  if (cached) {
    queryCache.delete(hash); // Expired
  }
  
  return null;
}

function setCachedResponse(query, sourceId, year, response) {
  const hash = hashQuery(query, sourceId, year);
  queryCache.set(hash, {
    response,
    timestamp: Date.now(),
  });
  
  // Evict old entries if cache too large
  if (queryCache.size > 1000) {
    const oldestKey = queryCache.keys().next().value;
    queryCache.delete(oldestKey);
  }
}

// Cleanup every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of queryCache) {
    if (now - value.timestamp > CACHE_TTL_MS) {
      queryCache.delete(key);
    }
  }
}, 10 * 60 * 1000);

module.exports = { getCachedResponse, setCachedResponse };
```

---

### Phase 3: Advanced Improvements (4-8 minggu)

#### 3.3.1 LLM-Assisted Intent Classification

**When heuristics fail, use LLM as fallback:**

```javascript
async function classifyWithLLM(query, options = {}) {
  const prompt = `
Klasifikasi query pengguna berikut:
Query: "${query}"

Pilih SATU kategori:
1. data_query - mencari data statistik
2. service_query - pertanyaan layanan/prosedur
3. greeting - sapaan
4. confirmation - konfirmasi (ya/tidak)
5. fragment - potongan kalimat (tahun/wilayah saja)

Output JSON: {"category": "...", "confidence": 0.0-1.0, "extracted": {"topic": "...", "year": null, "geo": null}}
`;

  const result = await callOpenAIJSON(prompt, { model: 'gpt-4.1-mini', maxTokens: 150 });
  return result;
}

// Use in hybrid approach
async function hybridClassify(query, historyContext) {
  // Try heuristics first (fast, free)
  const heuristicResult = classifyMessage(query, historyContext);
  
  // If confidence low, use LLM
  if (heuristicResult.confidence < 0.7) {
    const llmResult = await classifyWithLLM(query);
    return mergeClassifications(heuristicResult, llmResult);
  }
  
  return heuristicResult;
}
```

---

#### 3.3.2 Dynamic Bundle Discovery

**Replace hardcoded MERGE_BUNDLES with database-driven:**

```sql
-- New table: datasource_bundles
CREATE TABLE datasource_bundles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  bundle_key VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  triggers JSON NOT NULL,  -- ["profil kemiskinan", "kemiskinan lengkap"]
  sources JSON NOT NULL,   -- [{id: 452, label: "...", unit: "..."}]
  key_column VARCHAR(100) DEFAULT 'Wilayah',
  cluster VARCHAR(100),
  dimension VARCHAR(50) DEFAULT 'wilayah',  -- 'wilayah' | 'bulan'
  is_active BOOLEAN DEFAULT TRUE,
  created_at DATETIME,
  updated_at DATETIME
);
```

```javascript
// Load bundles from database
async function loadBundles() {
  const DataSourceBundle = require('../../models/DataSourceBundle.model');
  const bundles = await DataSourceBundle.findAll({ where: { is_active: true } });
  
  const bundleMap = {};
  for (const b of bundles) {
    bundleMap[b.bundle_key] = {
      id: b.bundle_key,
      name: b.name,
      triggers: JSON.parse(b.triggers),
      sources: JSON.parse(b.sources),
      keyColumn: b.key_column,
      cluster: b.cluster,
      dimension: b.dimension,
    };
  }
  return bundleMap;
}

// Cache bundles in memory with refresh
let bundleCache = null;
let bundleCacheTime = 0;
const BUNDLE_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function getBundles() {
  if (bundleCache && Date.now() - bundleCacheTime < BUNDLE_CACHE_TTL) {
    return bundleCache;
  }
  bundleCache = await loadBundles();
  bundleCacheTime = Date.now();
  return bundleCache;
}
```

---

#### 3.3.3 Hallucination Prevention Layer

```javascript
// backend/src/services/chat/hallucinationGuard.service.js

/**
 * Validate LLM response against available data
 * Flags or removes potential hallucinations
 */
function validateResponse(response, dataContext) {
  const issues = [];
  
  // Extract numbers from response
  const numbersInResponse = extractNumbers(response);
  
  if (!dataContext.hasDataPreview) {
    // No data available - ANY numbers are suspicious
    if (numbersInResponse.length > 0) {
      issues.push({
        type: 'number_without_data',
        numbers: numbersInResponse,
        severity: 'high',
      });
    }
  } else {
    // Data available - check if numbers match
    const validNumbers = extractNumbersFromTable(dataContext.data);
    
    for (const num of numbersInResponse) {
      if (!validNumbers.includes(num)) {
        issues.push({
          type: 'number_not_in_table',
          number: num,
          severity: 'medium',
        });
      }
    }
  }
  
  return {
    isValid: issues.filter(i => i.severity === 'high').length === 0,
    issues,
    sanitizedResponse: sanitizeResponse(response, issues),
  };
}

function sanitizeResponse(response, issues) {
  let result = response;
  
  for (const issue of issues) {
    if (issue.type === 'number_without_data' && issue.severity === 'high') {
      // Replace suspicious numbers with disclaimer
      for (const num of issue.numbers) {
        result = result.replace(
          new RegExp(`${num}\\s*(%|persen)?`, 'g'),
          '[data tidak tersedia]'
        );
      }
    }
  }
  
  return result;
}

function extractNumbers(text) {
  const matches = text.match(/\d+([.,]\d+)?/g) || [];
  return matches.map(m => parseFloat(m.replace(',', '.')));
}

function extractNumbersFromTable(data) {
  const numbers = new Set();
  for (const row of data) {
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === 'number') {
        numbers.add(value);
        // Also add common representations
        numbers.add(Math.round(value * 100) / 100);
      }
    }
  }
  return Array.from(numbers);
}

module.exports = { validateResponse, sanitizeResponse };
```

---

## 4. Implementation Checklist

### Phase 1 Checklist (Quick Wins)

- [ ] **CP-1.1**: Implement `classifyMessage()` unified classifier
  - [ ] Refactor 10+ isXxx functions into single entry point
  - [ ] Add confidence scoring
  - [ ] Add unit tests
  
- [ ] **CP-1.2**: Implement query normalization
  - [ ] Create `queryNormalization.service.js`
  - [ ] Build abbreviation map (50+ entries)
  - [ ] Integrate into streaming.service.js
  - [ ] Add logging for analytics
  
- [ ] **CP-1.3**: Optimize system prompt
  - [ ] Implement tiered prompt system
  - [ ] Measure token reduction
  - [ ] A/B test response quality

### Phase 2 Checklist (Structural)

- [ ] **CP-2.1**: Implement ConversationState
  - [ ] Create state machine class
  - [ ] Add database storage (chat_threads.conversation_state)
  - [ ] Migrate existing context logic
  - [ ] Add state transition logging
  
- [ ] **CP-2.2**: Implement response templates
  - [ ] Define 10+ core templates
  - [ ] Create template engine
  - [ ] Integrate with LLM for interpretation
  - [ ] Measure consistency improvement
  
- [ ] **CP-2.3**: Implement query caching
  - [ ] Create cache service (in-memory first)
  - [ ] Add cache hit/miss metrics
  - [ ] Measure cost reduction

### Phase 3 Checklist (Advanced)

- [ ] **CP-3.1**: LLM-assisted classification
  - [ ] Implement hybrid classifier
  - [ ] Set confidence thresholds
  - [ ] Measure accuracy improvement
  
- [ ] **CP-3.2**: Dynamic bundle discovery
  - [ ] Create datasource_bundles table
  - [ ] Migrate MERGE_BUNDLES to database
  - [ ] Add admin UI for bundle management
  
- [ ] **CP-3.3**: Hallucination prevention
  - [ ] Implement validation layer
  - [ ] Add response sanitization
  - [ ] Measure hallucination reduction

---

## 5. Metrics & Success Criteria

### 5.1 Query Processing Metrics

| Metric | Current | Target | How to Measure |
|--------|---------|--------|----------------|
| Classification accuracy | ~75% | 95% | Manual review of 100 queries |
| Context merge accuracy | ~70% | 90% | Track "wrong topic" complaints |
| Abbreviation expansion | 0% | 100% | Count unexpanded abbrevs |
| Query normalization time | N/A | <10ms | Timing logs |

### 5.2 Response Quality Metrics

| Metric | Current | Target | How to Measure |
|--------|---------|--------|----------------|
| Response consistency | Low | High | Template usage rate |
| Hallucination rate | ~15% | <2% | Validation layer flags |
| Token usage per response | ~800 | <500 | OpenAI usage logs |
| Response time (P95) | ~5s | <3s | Latency tracking |

### 5.3 Scalability Metrics

| Metric | Current | Target | How to Measure |
|--------|---------|--------|----------------|
| Cache hit rate | 0% | 40% | Cache service metrics |
| OpenAI calls/day | High | -30% | API usage tracking |
| Memory usage (embeddings) | All in RAM | Lazy load | Memory profiling |

---

## 6. Risk & Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| State machine complexity | Medium | High | Start simple, iterate |
| Template rigidity | Medium | Medium | Allow LLM fallback for edge cases |
| Cache staleness | Low | Medium | Short TTL, invalidation hooks |
| LLM classifier cost | Low | Low | Only use when heuristics fail |

---

## 7. Next Steps

1. **Immediate**: Review checkpoint dengan stakeholder
2. **Week 1-2**: Implement Phase 1 (Quick Wins)
3. **Week 2-4**: Implement Phase 2 (Structural)
4. **Week 4-8**: Implement Phase 3 (Advanced) as needed
5. **Ongoing**: Monitor metrics, iterate

---

**Author:** AI Analysis  
**Reviewed by:** -  
**Last Updated:** 20 Januari 2026
