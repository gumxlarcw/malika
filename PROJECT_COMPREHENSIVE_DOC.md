# Project Data Strategis (MALIKA) — Comprehensive Documentation

> Dibuat: 2026-03-02 | Diperbarui otomatis dari audit codebase menyeluruh.
> Untuk onboarding, referensi workspace, dan pemeliharaan sistem.

---

## Daftar Isi

1. [Gambaran Umum](#1-gambaran-umum)
2. [Arsitektur Sistem](#2-arsitektur-sistem)
3. [Backend API (Express 5)](#3-backend-api-express-5)
4. [Admin Panel (Next.js 16)](#4-admin-panel-nextjs-16)
5. [Frontend PWA (Next.js 16)](#5-frontend-pwa-nextjs-16)
6. [Database](#6-database)
7. [Chat Pipeline (Streaming)](#7-chat-pipeline-streaming)
8. [AI & LLM Integration](#8-ai--llm-integration)
9. [CI/CD Pipeline](#9-cicd-pipeline)
10. [PM2 & Deployment](#10-pm2--deployment)
11. [Environment Variables](#11-environment-variables)
12. [Testing](#12-testing)
13. [Struktur Direktori Lengkap](#13-struktur-direktori-lengkap)
14. [Operasi Umum (Runbook)](#14-operasi-umum-runbook)
15. [Catatan Penting](#15-catatan-penting)

---

## 1. Gambaran Umum

**MALIKA** = AI assistant statistik BPS Maluku Utara, berbasis data BPS lokal + RAG knowledge base.

| Komponen | Port | Framework | Deskripsi |
|---|---|---|---|
| `pds-backend` | 5000 | Express 5 + Sequelize 6 | API utama, RAG, chat, AI, automation |
| `pds-admin` | 5050 | Next.js 16 (standalone) | Admin panel (manajemen data, monitoring) |
| `pds-frontend` | 6060 | Next.js 16 + React 19 | PWA chatbot Malika (public-facing) |
| `malika-llm-proxy` | 3031 | Node.js (standalone) | LLM proxy — terpisah dari openclaw |

**URL Produksi (Cloudflare Tunnel):**
```
malika.bpsmalut.com            → Frontend PWA (6060)
api-malika.bpsmalut.com        → Backend API (5000)
api-malika.bpsmalut.com/backend → Admin Panel (5050)
```

**Runtime:**
- Node.js v25.5.0
- PM2 process manager
- MySQL 8.x (2 database)
- Ubuntu Linux

---

## 2. Arsitektur Sistem

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Cloudflare Tunnel                                 │
│  api-malika.bpsmalut.com → /backend/* → :5050 (Admin Next.js)              │
│  api-malika.bpsmalut.com → /*        → :5000 (Backend Express)             │
│  malika.bpsmalut.com     →           → :6060 (Public PWA)                  │
└─────────────────────────────────────────────────────────────────────────────┘
        │                        │                        │
        ▼                        ▼                        ▼
┌───────────────┐      ┌─────────────────┐      ┌────────────────┐
│  Admin Panel  │      │   Backend API    │      │   Public PWA   │
│  Next.js 16   │      │   Express 5      │      │   Next.js 16   │
│  Port: 5050   │      │   Port: 5000     │      │  Port: 6060    │
│  /backend/*   │      │   /* (REST)      │      │  (user-facing) │
└───────────────┘      └─────────────────┘      └────────────────┘
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
            ┌──────────────┐        ┌──────────────┐
            │ MySQL        │        │ MySQL        │
            │ project_data │        │ data_bps     │
            │ _strategis   │        │ (replication)│
            └──────────────┘        └──────────────┘
                    │
                    ▼
         ┌─────────────────────┐
         │ malika-llm-proxy    │
         │ Port: 3031          │
         │ → Anthropic API     │
         │ → Google Gemini     │
         └─────────────────────┘
```

### Data Flow Chat

```
User Input (PWA)
    ↓ POST /chat/stream (SSE)
    ↓
[gateAgent] → Intent classification (GREETING/SIMPLE/COMPLEX/DEEP)
    ↓
[modelRouter] → Select model & context budget
    ↓
[pipeline] → Parallel: datasource search + vector search + knowledge search
    ↓
[orchestrator] → Merge results, build context
    ↓
[knowledgeAnalyst] → Evaluate RAG documents
    ↓
[chartAgent] → Generate chart config (if applicable)
    ↓
[LLM Call] → via malika-llm-proxy → Claude/Gemini
    ↓
[supervisor] → Quality check, error recovery
    ↓
SSE Events → text, malika_ui, done
```

---

## 3. Backend API (Express 5)

### Entry Points
- `backend/app.js` — Express middleware + route mounting
- `backend/server.js` — DB connection, model loading, server start, preloads

### Dependencies Utama
```
express@5.2.1      - Web framework
sequelize@6.37.7   - ORM (MySQL)
openai@6.16.0      - OpenAI SDK (used for proxy)
ai@6.0.77          - Vercel AI SDK
@ai-sdk/google@3   - Google AI SDK
helmet@8            - Security headers
cors@2              - CORS handling
compression@1      - Response compression
jsonwebtoken@9      - JWT auth
multer@2            - File upload
sharp@0.34          - Image processing
pdf-parse@2         - PDF extraction
web-push@3          - Push notifications
prom-client@15      - Prometheus metrics
swagger-ui-express  - API docs UI
```

### Routes (34 files)

#### Public Routes (tanpa auth)
| Route | Rate Limit | Deskripsi |
|---|---|---|
| `/dynamic` | - | Dynamic data endpoints |
| `/pressrelease` | - | Press releases BPS |
| `/interop` | - | Interoperability data |
| `/static` | - | Static reference data |
| `/exim` | - | Export/Import trade data |
| `/metabase` | - | Metabase embed |
| `/notifications` | - | User notifications |
| `/push` | - | Push notification subscription |
| `/search` | 60/min | Full-text search |
| `/categories` | - | Data categories |
| `/analytics` | - | Analytics tracking |
| `/period/public` | 120/min | Period discovery (PWA) |
| `/ai` | 30/min | AI helpers (server-side) |
| `/chat` | 30/min | Chat streaming (SSE) |
| `/chat-feedback` | 30/min | Chat rating/feedback |
| `/geojson` | - | GeoJSON files |
| `/error-learning` | 30/min | Error flagging |

#### Auth Routes
| Route | Deskripsi |
|---|---|
| `/auth` | Login, logout, register, me |
| `/csrf-token` | CSRF token endpoint |

#### Admin Routes (auth + CSRF + audit)
| Route | Deskripsi |
|---|---|
| `/datasource` | Datasource CRUD |
| `/period` | Period mapping |
| `/summary` | Data summarization |
| `/cache` | Cache management |
| `/automation` | Scheduler config (admin-only) |
| `/search/admin` | Search debug (admin-only) |
| `/chat/admin` | Chat thread viewer (admin-only) |
| `/knowledge` | Knowledge base CRUD |
| `/rag-trial` | RAG experiments |
| `/logs` | Fetch log viewer (admin-only) |
| `/notifications/admin` | Notification admin |

### Controllers (33 files)
Setiap route memiliki controller terkait di `src/controllers/`.

### Models (26 Sequelize models)

| Model | Tabel | Deskripsi |
|---|---|---|
| `User` | `users` | Akun pengguna + role |
| `DataSource` | `data_sources` | Definisi sumber data (310+) |
| `DataPeriod` | `data_period_map` | Mapping periode data |
| `ProcessedCache` | `data_processed_cache` | Cache data terproses |
| `MergedCache` | `data_merged_cache` | Cache data gabungan |
| `FetchLog` | `fetch_logs` | Log fetch data dari API |
| `ChatThread` | `chat_threads` | Thread percakapan |
| `ChatMessage` | `chat_messages` | Pesan individual |
| `ChatFeedback` | `chat_feedbacks` | Rating/umpan balik chat |
| `ChatMessageFlag` | `chat_message_flags` | Pesan bermasalah |
| `ChatErrorPattern` | `chat_error_patterns` | Pola error untuk learning |
| `KnowledgeBase` | `knowledge_base` | Dokumen RAG (27K+ chunks) |
| `DataSourceSearchTerm` | `data_source_search_terms` | Index pencarian |
| `SearchStat` | `search_stats` | Statistik pencarian |
| `Notification` | `notifications` | Notifikasi |
| `PushSubscription` | `push_subscriptions` | Web push subscriber |
| `PushSendLog` | `push_send_logs` | Log pengiriman push |
| `AutomationConfig` | `automation_configs` | Konfigurasi scheduler |
| `AutomationRunLog` | `automation_run_logs` | Log eksekusi scheduler |
| `AdminAuditLog` | `admin_audit_logs` | Audit trail admin |
| `EximPodFilter` | `exim_pod_filters` | Filter EXIM |
| `IndexedBrsPublikasi` | `indexed_brs_publikasi` | Index BRS/Publikasi |
| `UserMemory` | `user_memories` | Memory user persistent |
| `AppSetting` | `app_settings` | Pengaturan aplikasi |
| `DnaCache` | `dna_caches` | Cache DNA Nucleus API |

### Middleware (6 files)
- `auth.middleware.js` — JWT validation, `authMiddleware`, `requireAdmin`
- `csrf.middleware.js` — CSRF token protection (state-changing requests)
- `rateLimit.middleware.js` — `createRateLimiter()` factory
- `auditLog.middleware.js` — `createAuditLogMiddleware()` untuk admin
- `observability.middleware.js` — Request logging, metrics, request ID
- `validate.middleware.js` — Input validation

### Services (122+ files, 26 subdirectories)

#### AI Services (`services/ai/`)
- `openaiChat.service.js` — Core LLM interaction
- `embedding.service.js` — Text embedding generation
- `vectorSearch.service.js` — Vector similarity search (27K+ embeddings in memory)
- `multiStrategySearch.service.js` — Multi-strategy search orchestration
- `hybridSearch.service.js` — Hybrid vector + FULLTEXT search
- `reranker.service.js` — Result reranking
- `queryBuilder.service.js` — SQL query builder via LLM
- `knowledgeDoc.service.js` — Knowledge document processing
- `contentFilter.service.js` — Content filtering
- `documentJudge.service.js` — Document relevance scoring
- `abbrevExpansion.service.js` — Abbreviation expansion
- `synonymExpansion.service.js` — Synonym expansion
- `keywordExtractor.service.js` — Keyword extraction
- `tableUnderstanding.service.js` — Table structure understanding
- `visionOcr.service.js` — Vision/OCR processing
- `pdfToImage.service.js` — PDF to image conversion
- `client/openaiClient.js` — HTTP client for LLM API
- `client/geminiKeyRotation.js` — Google API key rotation (10 keys)

#### Chat Services (`services/chat/`)
- `chat.service.js` — Core chat logic
- `streaming.service.js` — Main streaming pipeline (~2100 lines)
- `queryFastPath.service.js` — Fast path for simple queries
- `queryNormalizer.service.js` — Query normalization
- `geoInference.service.js` — Geographic inference
- `yearInference.service.js` — Year/period inference
- `knowledgeSearch.service.js` — RAG knowledge search
- `sourceMatching.service.js` — Source matching
- `errorLearning.service.js` — Error pattern learning
- `threadMemory.service.js` — Per-thread memory
- `persistentMemory.service.js` — Cross-thread user memory
- `sessionCompaction.service.js` — Token compaction
- `datasourceKeywordIndex.service.js` — Keyword index for signal detection
- `qualityScoring.service.js` — Response quality scoring
- `proactiveSuggestions.service.js` — Follow-up suggestions
- `malika-llm-proxy.js` — LLM proxy service

#### Chat Streaming (`services/chat/streaming/` — 32 files)
- `pipeline.service.js` — Main orchestration pipeline
- `orchestrator.service.js` — Multi-source merge
- `modelRouter.service.js` — Model selection (GREETING/SIMPLE/COMPLEX/DEEP)
- `gateAgent.service.js` — Intent classification agent
- `knowledgeAnalyst.service.js` — RAG document evaluation
- `chartAgent.service.js` — Chart generation agent
- `supervisor.service.js` — Quality check & error recovery
- `prompt.service.js` — Prompt template builder
- `config.js` — SMART_CONTEXT, token budgets
- `sse.service.js` — SSE handler (`createSSEHandler()`)
- `toolUse.service.js` — Agentic tool calling
- `queryContext.service.js` — Query context builder
- `knowledgeContext.service.js` — Knowledge context builder
- `dataPreview.service.js` — Data preview builder
- `brsPreview.service.js` — BRS preview builder
- `concurrencyLimiter.js` — Request concurrency control
- `uiMetadata.service.js` — UI metadata builder
- `llmSuggestions.service.js` — LLM-powered suggestions
- `greeting.service.js` — Greeting handler
- `provinsi.service.js` — Province data
- `openaiClient.js` — HTTP fetch to LLM API

#### Search Services (`services/search/`)
- `datasourceSearch.service.js` — Core datasource search (boost/penalty)
- `intent.service.js` — Search intent detection
- `intentCache.service.js` — Intent caching
- `intentStats.service.js` — Intent statistics
- `metadataIndex.service.js` — Metadata indexing
- `metadataReindex.service.js` — Reindexing
- `webSearch.service.js` — External web search (Brave)

#### Other Service Groups
- `automation/` — Scheduler, job runner (5 files)
- `bpsRead/` — BPS indicator reading (3 files)
- `cache/` — Cache & memory cache (2 files)
- `datasource/` — Fetch & URL parsing (2 files)
- `dna/` — DNA Nucleus API (1 file)
- `exim/` — Export/Import trade data (5 files)
- `formula/` — Calculation formulas: ratio, growth, yoy, mom, score (5 files)
- `merge/` — Merged dataset builder (1 file)
- `notification/` — Push notifications (3 files)
- `period/` — Period management (3 files)
- `pressrelease/` — BRS press releases (5 files)
- `processor/` — Data processing: dynamic, static, interop, exim, pressrelease (5 files)
- `publication/` — Publication management (4 files)
- `push/` — Web push service (1 file)
- `rag/` — RAG document sync, PDF extraction (4 files)
- `replication/` — DB replication (2 files)
- `summary/` — Data summarization (1 file)

### Utilities (`src/utils/` — 18 files)
- `logger.js` — Structured logging (Pino)
- `prometheus.js` — Prometheus metrics + endpoint
- `dateHelper.js` — Date/time helpers
- `period.js` — Period calculation
- `geoAnalysis.js` — Geographic analysis (provinsi, kab/kota)
- `tokenizer.js` — Token counting
- `costTracker.js` — LLM API cost tracking
- `circuitBreaker.js` — Failure handling
- `cacheCompression.js` — Cache data compression
- `math.js`, `parser.js`, `formatter.js`, `validator.js`, `safeJson.js`

### Shared (`src/shared/`)
- `bpsAbbreviations.js` — BPS term abbreviations
- `bpsDomainSynonyms.js` — Domain-specific synonyms
- `queryClassification.js` — Query type classification

---

## 4. Admin Panel (Next.js 16)

### Lokasi
`backend/admin/` — Next.js 16 App Router, standalone output

### Konfigurasi
- `basePath: "/backend"` — Panel di `api-malika.bpsmalut.com/backend`
- `output: "standalone"` — Self-contained build
- TypeScript strict mode
- Tailwind CSS v4

### Dependencies
```
next@16.1.3            - Framework
react@19.2.1           - UI
typescript@5           - Types
@tanstack/react-query@5 - Server state
@tanstack/react-table@8 - Data tables
react-hook-form@7      - Form handling
zod@3                  - Schema validation
zustand@5              - Client state
axios@1.13             - HTTP client
lucide-react@0.559     - Icons
leaflet@1.9            - Maps (GeoJSON)
xlsx@0.18              - Excel handling
class-variance-authority - CSS utilities
tailwind-merge         - Class merging
```

### Halaman (35+ pages)

#### Data Management
- `/dashboard` — Statistik utama
- `/datasources` — CRUD datasource (310+ sumber)
- `/datasources/[id]` — Detail datasource
- `/cache` — Preview cache management
- `/period` — Period mapping
- `/period-availability` — Cek ketersediaan periode
- `/merge` — Merge & save operations

#### Automation & Scheduling
- `/automation` — Metabase sync scheduler
- `/knowledge-sync` — RAG document sync scheduler
- `/automation-notifications` — Notification automation
- `/notifications-control` — Notification settings
- `/push-subscribers` — Web push subscribers

#### AI & Analytics
- `/chats` — Chat thread viewer
- `/feedback` — Chat feedback review
- `/knowledge` — Knowledge base CRUD (27K+ chunks)
- `/rag-trial` — RAG testing interface
- `/malika-analysis` — LLM error analysis

#### Tools
- `/search-test` — Search testing
- `/intent-stats` — Query intent statistics
- `/fetch-logs` — Data fetch logs
- `/audit-logs` — Admin action audit trail
- `/geojson` — GeoJSON editor (Leaflet)
- `/exim-hs` — EXIM HS code lookup
- `/metabase` — Embedded Metabase dashboard

#### Settings
- `/users` — User management

### Komponen Utama
- `AppShell.tsx` — Layout wrapper (keyboard shortcuts: Cmd+K search, G chord menu)
- `Sidebar.tsx` — Navigation sidebar (6 groups, mobile responsive)
- `AuthProvider.tsx` — JWT auth context + auto-redirect
- `ThemeProvider.tsx` — Dark/light mode (localStorage)
- `QueryProvider.tsx` — React Query (staleTime: 30s)
- `GlobalSearchDialog.tsx` — Cmd+K global search
- `DataTable.tsx` — Reusable data table (sorting, density)
- `Toast.tsx` — Toast notification system
- `ErrorBoundary.tsx` — Error boundary

### State Management
- **Zustand** (`useUiStore`) — Sidebar, table density, filters, localStorage persistence
- **React Query** — Server state (datasources, chats, knowledge, users)
- **Custom hooks** — `useAsyncState`, `usePagination`, `useChatThreads`, `useDataSources`, `useKnowledgeBase`, `useUsers`

### API Integration
- `lib/axios.js` — Axios with interceptors (CSRF injection, 401 redirect, toast errors)
- `lib/api/client.ts` — API client wrapper
- `lib/api/endpoints.ts` — Endpoint definitions
- `lib/sanitize.ts` — XSS prevention
- `lib/formatters.ts` — Data formatting

---

## 5. Frontend PWA (Next.js 16)

### Lokasi
`frontend/` — Git submodule, Next.js 16 App Router

### Dependencies
```
next@16.0.10           - Framework
react@19.2.0           - UI
typescript@5.9.3       - Types
tailwindcss@4.1.17     - CSS
apexcharts@4.7         - Charts
react-dnd@16           - Drag & drop
react-dropzone@14      - File upload
swiper@11              - Carousel
fullcalendar@6         - Calendar
flatpickr@4            - Date picker
```

### Pages & Routes

#### Admin Layout (`/(admin)/`)
- `/` — Dashboard
- `/chat` — **Chat MALIKA** (main feature, ~3600 lines)
- `/data` — Data explorer
- `/brs` — BRS publications
- `/feedback` — User feedback
- `/kategori`, `/kategori/[slug]` — Categories
- `/notifications` — Notification center
- `/publikasi` — Publications
- `/search` — Advanced search
- `/settings` — User settings

#### Auth Layout (`/(full-width-pages)/`)
- `/signin`, `/signup` — Authentication
- `/error-404` — Error page

### Chat Architecture (Core Feature)

**File utama:** `src/app/(admin)/chat/ChatPageClient.tsx` (~3600 lines)

**Fitur:**
- SSE streaming real-time (bukan WebSocket)
- Thread-based conversations
- Rich content: tables, charts, knowledge snippets
- Voice input support
- Process visibility (UnifiedActivityFeed)
- Offline queueing

**Chat Components (20+ files):**
- `ChatComponents.tsx` — Core chat bubbles
- `DataSummaryBubble.tsx` — Data table/chart display
- `UnifiedActivityFeed.tsx` — Processing step visibility
- `ProcessIndicator.tsx` — Thinking animation
- `KnowledgeModal.tsx` — Knowledge document viewer
- `SourcesSection.tsx` — Citation sources
- `ToolCallCard.tsx` — Tool execution display
- `CandidateSelector.tsx` — Data source selection
- `MessageFeedback.tsx` — Rating/feedback

**Transport:** `lib/chatTransport.ts` — SSE handler with reconnection logic

### SSE Event Types
```
user_saved       → User message saved to DB
thread_updated   → Thread metadata updated
intent           → Query intent classification
context          → Context/sources being searched
status           → Processing status update
text             → Assistant response text chunks
malika_ui        → UI metadata (tables, charts, suggestions)
done             → Stream completion
error            → Error messages
heartbeat        → Keep-alive ping
```

### PWA Features
- `sw.js` — Service Worker (offline support, cache strategies)
- `manifest.webmanifest` — PWA manifest
- `offline.html` — Offline fallback
- Components: PwaServiceWorkerRegister, PwaInstallNudge, PwaPushOnboardingModal, PwaOfflineIndicator
- `AppSplashScreen.tsx` — Native app splash screen

### Key Libraries
- `chartDataProfiler.ts` — Chart data analysis (67KB)
- `tableRowOrdering.ts` — Smart table sorting (22KB)
- `categoryStyles.ts` — Dynamic category theming
- `geoIntent.ts` — Geographic query analysis
- `eximQueryIntent.ts` — Trade query classification
- `bpsKeyword.ts` — BPS domain keywords

### Context Providers
- `ChatProcessContext` — Chat streaming state, tool calls, processing steps
- `SidebarContext` — Sidebar state
- `ThemeContext` — Dark/light theme

### Custom Hooks
- `useChatRating()` — Chat feedback/rating
- `useVoiceInput()` — Speech-to-text
- `useLocalMessages()` — localStorage message cache
- `useAnalytics()` — Event tracking
- `useGoBack()` — Navigation history
- `useModal()` — Modal state

---

## 6. Database

### Primary Database: `project_data_strategis`
```
Host:   localhost
User:   root
Pass:   17Agustus
```

**Tabel utama:** `users`, `data_sources`, `data_period_map`, `data_processed_cache`, `data_merged_cache`, `chat_threads`, `chat_messages`, `knowledge_base`, `fetch_logs`, `automation_configs`, `admin_audit_logs`, dll.

### Replica Database: `data_bps`
316+ tabel, sumber data untuk Metabase dan replication.

#### Indikator Tables: `indikator_<source_id>` (310 tabel)
| Type | Jumlah | Contoh |
|------|--------|--------|
| Dynamic (yearly/quarterly/semester/monthly) | 157 | `indikator_8`, `indikator_12` |
| Interop (static tables) | 150 | `indikator_5`, `indikator_6` |
| Static | 1 | `indikator_7` (ibukota kab) |
| EXIM (trade) | 2 | `indikator_451`, `indikator_452` |

**Common Columns:**
- `id` (PK), `source_id`, `source_name`, `signature`
- `th_id` (varchar 32), `year` (smallint), `month_no` (tinyint), `month_name`
- Dimensions: `hs2`, `pod`, `ctr`, `dim_key`, `dim_value`, `dim_hash`
- `metric` (varchar), `value` (decimal 30,6)
- UNIQUE KEY: `(th_id, month_no, dim_hash, metric)`

**Kode Bulan (month_no):**
| Code | Arti |
|------|------|
| 0 | Tahunan / tanpa sub-period |
| 1-12 | Bulan (Jan-Des) |
| 31-34 | Triwulan I-IV |
| 35 | Agregat tahunan |
| 36 | Semester 1 (Maret) |
| 37 | Semester 2 (September) |

#### Lookup: `kodehs_indd`
- `hs2digit` (PK), `bab_eng`, `bab_ind`, `bab_ind_singkat`

#### Cache: `data_merged_cache`
- `id`, `source_id` (indexed), `merged_json` (longtext)

#### Press Release: `pressrelease_kw_*` (4 tabel)
- `brs_id`, `keyword`, `title`, `abstract`, `rl_date`, PDF/slide content

### Database Pool
```
DB_POOL_MAX=20       DB_POOL_MIN=5
DB_POOL_ACQUIRE=30s  DB_POOL_IDLE=10s
DB_SLOW_QUERY_MS=100ms
```

### Auto-Migration (server.js)
- `ensureDataSourceTypeEnumSupportsAllKnownTypes()` — Enum migration
- `ensureDataSourceHasAliasesColumn()` — Column migration
- `ensureAppSettingsTableExists()` — Table creation
- `sequelize.sync()` — Model sync

---

## 7. Chat Pipeline (Streaming)

### Arsitektur Pipeline

```
POST /chat/stream
    ↓
[streaming.service.js] — Main entry (~2100 lines)
    ↓
[gateAgent.service.js] — Classify intent: GREETING/DATA/KNOWLEDGE/MIXED
    ↓
[modelRouter.service.js] — Select tier: GREETING/SIMPLE/COMPLEX/DEEP
    ↓
[pipeline.service.js] — Orchestrate: search + RAG + LLM
    ↓
    ├── [datasourceSearch] — Boost/penalty keyword search
    ├── [vectorSearch] — Cosine similarity (27K+ embeddings)
    ├── [knowledgeSearch] — RAG document retrieval
    └── [hybridSearch] — FULLTEXT + vector hybrid
    ↓
[orchestrator.service.js] — Merge multi-source results
    ↓
[knowledgeAnalyst.service.js] — Evaluate & rank RAG docs
    ↓
[prompt.service.js] — Build system + user prompt
    ↓
[openaiClient.js] → [malika-llm-proxy:3031] → Claude/Gemini
    ↓
[chartAgent.service.js] — Generate chart config (if applicable)
    ↓
[supervisor.service.js] — Quality check, error recovery
    ↓
[sse.service.js] → SSE events to client
```

### Context Budget per Tier (config.js)
```
GREETING:  20K chars
SIMPLE:    120K chars (5 docs × 15K)
COMPLEX:   200K chars (7 docs × 25K)
DEEP:      400K chars (10 docs × 80K)
```

### SSE Handler
```javascript
const { sendEvent, end, isClientConnected } = createSSEHandler(res);
sendEvent('text', { content: 'Hello...' });
sendEvent('malika_ui', { tables: [...], charts: [...] });
sendEvent('done', {});
```

---

## 8. AI & LLM Integration

### Arsitektur Proxy

```
Backend (pds-backend:5000)
    ↓  OPENAI_API_URL = http://127.0.0.1:3031/v1/chat/completions
[malika-llm-proxy:3031]  ← PM2 process, TERPISAH dari openclaw
    ↓
  ┌─────────────────────────────────┐
  │ claude-sonnet-4-6 (SEMUA TIER) │
  │ → Anthropic API (oat01 token)  │
  └────────────────┬────────────────┘
                   │ fallback:
                   ↓
  ┌─────────────────────────────────┐
  │ Google Gemini (10-key rotation) │
  └─────────────────────────────────┘
```

### Model Tiers
| Tier | Trigger | Model |
|---|---|---|
| GREETING | Sapaan | `claude-sonnet-4-6` |
| SIMPLE | Query data biasa | `claude-sonnet-4-6` |
| COMPLEX | Multi-sumber, tren | `claude-sonnet-4-6` |
| DEEP | Proyeksi, kausalitas | `claude-sonnet-4-6` |

### Google API Keys (10 working)
Rotasi di `geminiKeyRotation.js`:
- wisnucandragumelar, ipdsmalut, gumelarwork, perpustakaankaryapertiwi
- saparysimon161, igbpssula, hasmanumakaapa40, irwandi.sula
- taibannaji, bista.malut
- **Suspended:** socmedbpssula (jangan pakai)

### Fitur AI
- **Embedding:** Vector search dengan 27K+ dokumen di memory
- **Reranking:** Contextual relevance scoring
- **RAG:** Knowledge base dengan chunking & embedding
- **Tool Use:** Agentic tool calling (CHAT_TOOL_USE env)
- **Vision/OCR:** Image & PDF analysis
- **Web Search:** Brave Search integration (optional)
- **Cost Tracking:** Per-request token & cost tracking

---

## 9. CI/CD Pipeline

### GitHub Actions CI (`.github/workflows/ci.yml`)
**Trigger:** Push to main/master, all PRs

| Job | Deskripsi |
|---|---|
| Lint (3x) | Backend, Admin, Frontend ESLint |
| Backend Tests | Jest (100+ tests, `--passWithNoTests`) |
| Admin Build | Next.js production build |
| Frontend Tests | Type check + unit tests |
| Frontend E2E | Playwright browser tests |
| Security Audit (3x) | `npm audit --audit-level=high` |
| Quality Gates | Final confirmation |

### GitHub Actions CD (`.github/workflows/cd.yml`)
**Trigger:** Push to main (staging), tags v* (production), manual dispatch

| Job | Trigger | Script |
|---|---|---|
| Deploy Staging | Push main/master | `scripts/deploy-public-pwa.sh` |
| Deploy Production | Push tag v*.*.* | `scripts/deploy-public-pwa.sh` |
| Rollback | Manual only | Placeholder |

**Secrets:** `STAGING_DEPLOY_ENABLED`, `PROD_DEPLOY_ENABLED`, `ROLLBACK_ENABLED`, `SLACK_WEBHOOK_URL`

### Dependabot (`.github/dependabot.yml`)
- Weekly updates, max 5 PRs per directory
- Monitored: `/backend`, `/backend/admin`, `/frontend`, GitHub Actions

---

## 10. PM2 & Deployment

### PM2 Processes

| PM2 Name | Port | Script | Config |
|---|---|---|---|
| `pds-backend` | 5000 | `backend/server.js` | `ecosystem.config.js` |
| `pds-admin` | 5050 | `backend/admin/.next/standalone/server.js` | `ecosystem.config.js` |
| `pds-frontend` | 6060 | `next start -p 6060` | `ecosystem.config.js` |
| `malika-llm-proxy` | 3031 | standalone | `/opt/openclaw/malika-llm-proxy.config.js` |

### Backend PM2 Config
```javascript
{
  node_args: "--max-old-space-size=2560 --max-semi-space-size=16 --expose-gc --optimize-for-size",
  max_memory_restart: "5G",
  exp_backoff_restart_delay: 100,  // Exponential backoff
  wait_ready: true,                 // Waits for process.send('ready')
  listen_timeout: 60000,            // 60s max for ready signal
  kill_timeout: 10000,              // 10s graceful shutdown
}
```

### Server Startup Sequence
1. Connect to MySQL
2. Auto-migrate schema (enum, columns, tables)
3. Sync Sequelize models
4. Start HTTP server on port 5000
5. Preload processed caches
6. Preload datasource embeddings (~200ms)
7. Preload knowledge embeddings (~20-45s, 27K docs)
8. Init datasource keyword index
9. Start schedulers (automation, publication, pressrelease, knowledge sync)
10. Init hybrid search FULLTEXT index
11. Start DNA cache warmup (background)
12. GC compaction (reclaim preload overhead)
13. Send `ready` signal to PM2

### Build Scripts
```bash
# Full build
./scripts/build-all.sh

# Frontend only
cd frontend && npm run build
pm2 restart pds-frontend

# Admin only
cd backend/admin && npm run build
pm2 restart pds-admin

# Backend reload (no build needed)
pm2 reload pds-backend --update-env
```

---

## 11. Environment Variables

### Total: 57+ env vars di `backend/.env`

#### Database & Auth
```
PORT=5000
DB_HOST, DB_USER, DB_PASS, DB_NAME
JWT_SECRET
```

#### LLM / AI
```
OPENAI_API_URL=http://127.0.0.1:3031/v1/chat/completions
OPENAI_API_BASE_URL=http://127.0.0.1:3031/v1
OPENAI_API_KEY_CHAT=malika-internal-proxy
OPENAI_MODEL_CHAT=claude-sonnet-4-6
OPENAI_MODEL_REASONING=claude-sonnet-4-6
OPENAI_MODEL_COMPACTION=claude-sonnet-4-6
OPENAI_MODEL_KEYWORD_EXTRACTOR, OPENAI_MODEL_TABLE_UNDERSTANDING, OPENAI_MODEL_VISION
OPENAI_CHAT_TIMEOUT_MS
OPENAI_QUERY_BUILDER_MODEL=gemini-3-flash-preview
GATE_LLM_MODEL, SUPERVISOR_LLM_MODEL
GOOGLE_API_KEY
CHAT_TOOL_USE
```

#### External APIs
```
BPS_API_KEY
DNA_NUCLEUS_API_KEY_BPS
BRAVE_SEARCH_API_KEY, WEB_SEARCH_ENABLED, WEB_SEARCH_MAX_RESULTS
METABASE_SITE_URL, METABASE_SECRET_KEY, METABASE_EMBED_EXP_SECONDS
```

#### Automation
```
AUTOMATION_ENABLED, AUTOMATION_RUN_HOUR, AUTOMATION_RUN_MINUTE, AUTOMATION_INTERVAL_MINUTES
PUBLICATION_NOTIFICATIONS_ENABLED, PUBLICATION_INTERVAL_MINUTES
PRESSRELEASE_NOTIFICATIONS_ENABLED
MERGED_CACHE_NOTIFICATIONS_ENABLED, MERGED_CACHE_NOTIFICATIONS_INTERVAL_MINUTES
```

#### Push Notifications
```
VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
```

#### Performance
```
DB_POOL_MAX=20, DB_POOL_MIN=5, DB_POOL_ACQUIRE, DB_POOL_IDLE
DB_SLOW_QUERY_MS=100
MEMORY_CACHE_PRELOAD=true, MEMORY_CACHE_PRELOAD_LIMIT=20
```

---

## 12. Testing

### Backend Unit Tests
- **Framework:** Jest
- **Lokasi:** `backend/src/__tests__/` (43 files)
- **Command:** `cd backend && npx jest --passWithNoTests --no-coverage`
- **Status:** 100 non-integration tests PASS

**Test Categories:**
- AI services: abbrevExpansion, vectorSearch, reranker, queryBuilder, openaiClient
- Chat: chat.service.flow, chat.service.main, sse.service
- Data: dynamic.processor, fetch.service, datasourceSearch
- Utils: dateHelper, period.utils, tokenizer, geoAnalysis
- Routes: auth, protected endpoints
- Snapshots: analytics, processor, responseFormatter
- Integration: auth, chat, database, datasource, search, externalApis

**Known issue:** `integration/chat.test.js` fails (missing `chatController.searchMemory` handler)

### Chat Evaluation Framework
- **Lokasi:** `backend/evals/`
- **Master runner:** `master-test-runner.sh`
- **Test cases:** 81 scenarios (15 categories)
- **Fixtures:** `fixtures/master-test-cases.json`
- **Parsers:** `evaluate-chat-result.py`, `parse-sse-result.py`
- **Reports:** 55+ JSON files di `evals/reports/`

### Frontend Tests
- **Type check:** `npm run test:build`
- **Unit tests:** `npm run test:nonexim`
- **E2E:** Playwright (`npm run test:e2e`)

---

## 13. Struktur Direktori Lengkap

```
/var/www/html/project-data-strategis/
├── .github/
│   ├── copilot-instructions.md         # AI agent guidance (49KB)
│   ├── dependabot.yml                  # Weekly dependency updates
│   └── workflows/
│       ├── ci.yml                      # CI pipeline (lint, test, build, audit)
│       └── cd.yml                      # CD pipeline (staging, production, rollback)
│
├── backend/
│   ├── .env                            # Secrets (gitignored, 57+ vars)
│   ├── .gitignore
│   ├── app.js                          # Express middleware + route mounting
│   ├── server.js                       # DB init, model loading, server start
│   ├── package.json                    # Dependencies (express, sequelize, openai, etc.)
│   │
│   ├── admin/                          # === ADMIN PANEL (Next.js 16) ===
│   │   ├── app/                        # 35+ pages (App Router)
│   │   │   ├── layout.tsx              # Root layout
│   │   │   ├── globals.css             # Tailwind CSS theme
│   │   │   ├── dashboard/              # Statistik
│   │   │   ├── datasources/            # CRUD datasource + components/
│   │   │   ├── chats/                  # Chat viewer
│   │   │   ├── knowledge/              # Knowledge base
│   │   │   ├── knowledge-sync/         # RAG sync
│   │   │   ├── automation/             # Scheduler + components/
│   │   │   ├── cache/                  # Cache management
│   │   │   ├── period/                 # Period mapping
│   │   │   ├── merge/                  # Merge operations
│   │   │   ├── users/                  # User management
│   │   │   ├── feedback/               # Chat feedback
│   │   │   ├── rag-trial/              # RAG testing
│   │   │   ├── search-test/            # Search testing
│   │   │   ├── intent-stats/           # Query stats
│   │   │   ├── fetch-logs/             # Fetch logs
│   │   │   ├── audit-logs/             # Admin audit trail
│   │   │   ├── push-subscribers/       # Push subscribers
│   │   │   ├── geojson/                # GeoJSON editor
│   │   │   ├── malika-analysis/        # LLM error analysis
│   │   │   ├── exim-hs/                # EXIM HS codes
│   │   │   ├── metabase/               # Embedded Metabase
│   │   │   └── login/                  # Auth
│   │   ├── components/                 # Shared components
│   │   │   ├── AppShell.tsx            # Layout (Cmd+K, G-chord)
│   │   │   ├── Sidebar.tsx             # Navigation (6 groups)
│   │   │   ├── AuthProvider.tsx        # JWT context
│   │   │   ├── ThemeProvider.tsx        # Dark/light mode
│   │   │   ├── QueryProvider.tsx        # React Query
│   │   │   ├── Toast.tsx               # Toast notifications
│   │   │   ├── GlobalSearchDialog.tsx  # Cmd+K search
│   │   │   ├── ErrorBoundary.tsx       # Error boundary
│   │   │   ├── ui/DataTable.tsx        # Reusable table
│   │   │   └── forms/                  # Form components
│   │   ├── hooks/                      # Custom hooks (6 files)
│   │   ├── lib/                        # Utils (axios, api/, store/, sanitize, formatters)
│   │   ├── next.config.ts              # basePath: "/backend", standalone
│   │   └── package.json                # Dependencies
│   │
│   ├── src/
│   │   ├── config/                     # Configuration (8 files)
│   │   │   ├── env.js                  # Environment variable loading
│   │   │   ├── db.js                   # Primary DB (Sequelize)
│   │   │   ├── db_bps.js              # Replica DB (Sequelize)
│   │   │   ├── limits.js              # Resource limits
│   │   │   ├── search.config.js       # Search parameters
│   │   │   └── contacts.js            # Contact info
│   │   │
│   │   ├── controllers/               # Request handlers (33 files)
│   │   ├── routes/                     # Express routes (34 files)
│   │   ├── models/                     # Sequelize models (26 files)
│   │   ├── middleware/                 # Middleware (6 files)
│   │   │   ├── auth.middleware.js
│   │   │   ├── csrf.middleware.js
│   │   │   ├── rateLimit.middleware.js
│   │   │   ├── auditLog.middleware.js
│   │   │   ├── observability.middleware.js
│   │   │   └── validate.middleware.js
│   │   │
│   │   ├── services/                   # Business logic (122+ files)
│   │   │   ├── ai/                     # AI/LLM (18 files + client/)
│   │   │   ├── chat/                   # Chat core (20 files)
│   │   │   │   └── streaming/          # Pipeline (32 files)
│   │   │   ├── search/                 # Search (10 files)
│   │   │   ├── automation/             # Scheduler (5 files)
│   │   │   ├── bpsRead/                # BPS reading (3 files)
│   │   │   ├── cache/                  # Caching (2 files)
│   │   │   ├── datasource/             # Fetch (2 files)
│   │   │   ├── dna/                    # DNA API (1 file)
│   │   │   ├── exim/                   # Trade data (5 files)
│   │   │   ├── formula/                # Calculations (5 files)
│   │   │   ├── merge/                  # Merge (1 file)
│   │   │   ├── notification/           # Notifications (3 files)
│   │   │   ├── period/                 # Periods (3 files)
│   │   │   ├── pressrelease/           # BRS (5 files)
│   │   │   ├── processor/              # Data processing (5 files)
│   │   │   ├── publication/            # Publications (4 files)
│   │   │   ├── push/                   # Web push (1 file)
│   │   │   ├── rag/                    # RAG sync (4 files)
│   │   │   ├── replication/            # DB replication (2 files)
│   │   │   └── summary/                # Summarization (1 file)
│   │   │
│   │   ├── utils/                      # Helpers (18 files)
│   │   ├── shared/                     # Domain data (3 files)
│   │   ├── docs/                       # Swagger/OpenAPI
│   │   ├── errors/                     # Custom errors
│   │   ├── database/                   # Migrations
│   │   └── __tests__/                  # Jest tests (43 files)
│   │       ├── helpers/                # Test utilities
│   │       ├── __snapshots__/          # Snapshot files
│   │       └── integration/            # Integration tests
│   │
│   ├── evals/                          # Chat evaluation framework
│   │   ├── master-test-runner.sh       # 81 test cases, 15 categories
│   │   ├── fixtures/                   # Test data
│   │   └── reports/                    # 55+ JSON reports
│   │
│   ├── scripts/                        # Utility scripts
│   └── public/                         # Static files
│
├── frontend/                           # === PUBLIC PWA (Next.js 16) ===
│   ├── src/
│   │   ├── app/
│   │   │   ├── (admin)/               # Admin layout group
│   │   │   │   ├── chat/              # Chat MALIKA (~3600 lines)
│   │   │   │   ├── data/              # Data explorer
│   │   │   │   ├── brs/               # BRS publications
│   │   │   │   ├── search/            # Advanced search
│   │   │   │   ├── notifications/     # Notification center
│   │   │   │   └── settings/          # User settings
│   │   │   ├── (full-width-pages)/    # Auth pages
│   │   │   └── api/                   # Next.js API routes
│   │   ├── components/
│   │   │   ├── chat/                  # Chat components (20+ files)
│   │   │   ├── search/               # Search components
│   │   │   ├── brs/                   # BRS components
│   │   │   ├── charts/               # Chart components
│   │   │   └── ui/                    # Base UI elements
│   │   ├── layout/                    # Layout components
│   │   ├── context/                   # React contexts
│   │   ├── hooks/                     # Custom hooks
│   │   ├── lib/                       # Utilities
│   │   └── types/                     # TypeScript types
│   ├── public/                        # Static assets + PWA files
│   └── package.json
│
├── docs/                               # Architecture docs
│   ├── ARCHITECTURE.md
│   ├── SETUP.md
│   └── postman/                        # API collection
│
├── scripts/                            # Deployment scripts
│   ├── build-all.sh
│   ├── deploy-public-pwa.sh
│   ├── backup-db.sh
│   └── restore-db.sh
│
├── ecosystem.config.js                 # PM2 config (3 processes)
├── .gitmodules                         # Frontend submodule
├── REFERENCE.md                        # Quick reference doc
├── DATA_BPS_SCHEMA.md                  # Database schema doc
└── *.md                                # 63+ documentation files
```

---

## 14. Operasi Umum (Runbook)

### Health Check
```bash
# Backend API
curl http://127.0.0.1:5000/health

# LLM Proxy
curl http://127.0.0.1:3031/health
# → {"status":"ok","google":{"total":10,"available":10},"anthropic":{"configured":true}}
```

### Restart Services
```bash
# Backend (apply new .env)
pm2 reload pds-backend --update-env

# Admin panel
cd backend/admin && npm run build
pm2 restart pds-admin

# Frontend PWA
cd frontend && npm run build
pm2 restart pds-frontend

# LLM Proxy
pm2 restart malika-llm-proxy
```

### Switch Model ke Gemini (Rollback)
```bash
# Edit backend/.env
OPENAI_API_URL=https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
OPENAI_API_KEY_CHAT=<your-google-api-key>
OPENAI_MODEL_CHAT=gemini-3-flash-preview
OPENAI_MODEL_REASONING=gemini-3-pro-preview
pm2 reload pds-backend --update-env
```

### Switch Model ke Claude (Current)
```bash
OPENAI_API_URL=http://127.0.0.1:3031/v1/chat/completions
OPENAI_API_KEY_CHAT=malika-internal-proxy
# semua model = claude-sonnet-4-6
pm2 reload pds-backend --update-env
```

### Database Backup
```bash
./scripts/backup-db.sh
```

### Run Tests
```bash
# Backend unit tests
cd backend && npx jest --passWithNoTests --no-coverage

# Chat evaluation
cd backend/evals && bash master-test-runner.sh

# Frontend E2E
cd frontend && npm run test:e2e
```

### View Logs
```bash
pm2 logs pds-backend --lines 50
pm2 logs malika-llm-proxy --lines 50
pm2 logs pds-admin --lines 20
pm2 logs pds-frontend --lines 20
```

### API Documentation
```
https://api-malika.bpsmalut.com/api-docs
# atau
http://localhost:5000/api-docs
```

### Cost Tracking
```bash
curl -H "Cookie: token=<jwt>" http://localhost:5000/admin/cost-stats
# Reset:
curl -H "Cookie: token=<jwt>" "http://localhost:5000/admin/cost-stats?reset=1"
```

### Prometheus Metrics
```
http://localhost:5000/metrics
```

---

## 15. Catatan Penting

1. **malika-llm-proxy harus jalan** sebelum pds-backend bisa menjawab chat (OPENAI_API_URL → port 3031)
2. **Jangan restart openclaw-gateway** pakai `openclaw gateway stop` — pakai `kill -9 <pid>` lalu PM2 auto-restart
3. **socmedbpssula key SUSPENDED** — jangan masukkan ke manapun
4. **Backend reload** selalu pakai `--update-env` agar .env baru terbaca
5. **PM2 ecosystem proxy**: `/opt/openclaw/malika-llm-proxy.config.js` (harus `.config.js`)
6. **Frontend adalah git submodule** — push terpisah dari backend
7. **Admin panel basePath: "/backend"** — semua route di-prefix `/backend`
8. **Server startup 20-45 detik** karena embedding preload (27K docs) — PM2 wait_ready menangani ini
9. **Pre-existing test failure:** `integration/chat.test.js` (missing searchMemory handler)
10. **Database pool max 20** — jangan increase tanpa monitoring memory
11. **CSRF protection** aktif untuk semua admin state-changing operations
12. **Rate limiting** aktif: chat 30/min, search 60/min, admin API 100/min
13. **Backup convention**: Per CLAUDE.md, selalu `cp {file} {file}.backup` sebelum edit
