# Dokumentasi Komprehensif Chat MALIKA

**Versi:** 1.0  
**Tanggal:** 20 Januari 2026  
**Status:** Production-Ready dengan Saran Improvement

---

## Daftar Isi

1. [Ringkasan Eksekutif](#1-ringkasan-eksekutif)
2. [Arsitektur Sistem](#2-arsitektur-sistem)
3. [Frontend Architecture](#3-frontend-architecture)
4. [Backend Architecture](#4-backend-architecture)
5. [Database Schema](#5-database-schema)
6. [Knowledge Base & RAG](#6-knowledge-base--rag)
7. [Alur Data & Request Flow](#7-alur-data--request-flow)
8. [Konteks & Memory Management](#8-konteks--memory-management)
9. [Security & Authentication](#9-security--authentication)
10. [Checkpoints & Production Readiness](#10-checkpoints--production-readiness)
11. [Saran Improvement Query & Response](#11-saran-improvement-query--response)
12. [Scalability Recommendations](#12-scalability-recommendations)
13. [Monitoring & Observability](#13-monitoring--observability)
14. [Troubleshooting Guide](#14-troubleshooting-guide)

---

## 1. Ringkasan Eksekutif

### Apa itu MALIKA?
**MALIKA** (Manajer Layanan Informasi dan Komunikasi Aktif) adalah chatbot customer service AI untuk layanan data statistik **BPS Provinsi Maluku Utara**. Chatbot ini membantu pengguna:
- Mencari dan menemukan data statistik yang tepat
- Mendapatkan interpretasi data yang tersedia
- Navigasi ke sumber data yang relevan
- Menjawab pertanyaan tentang layanan BPS

### Teknologi Stack
| Layer | Teknologi |
|-------|-----------|
| Frontend | Next.js 14+ (App Router), TypeScript, @chatui/core |
| Backend API | Node.js + Express.js |
| Database | MySQL 8.x + Sequelize ORM |
| AI/LLM | OpenAI GPT-4.1-mini (chat), text-embedding-3-small (RAG) |
| Streaming | Server-Sent Events (SSE) |
| Deployment | PM2, Cloudflared |

### Key Features
- ✅ **Persistensi Penuh**: Semua chat tersimpan di database, bertahan setelah server restart
- ✅ **Multi-Session**: User dapat melanjutkan chat kapan saja
- ✅ **Streaming Response**: Real-time typing effect via SSE
- ✅ **RAG (Retrieval-Augmented Generation)**: Knowledge base dengan vector search
- ✅ **Smart Context Merging**: Follow-up otomatis terhubung dengan konteks sebelumnya
- ✅ **Data Preview Integration**: Tabel statistik embedded dalam chat

---

## 2. Arsitektur Sistem

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER BROWSER                                   │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  Next.js Frontend (PWA) - Port 3000                                  │  │
│  │  └── /chat page (ChatPageClient.tsx)                                 │  │
│  │      └── @chatui/core UI                                             │  │
│  │      └── SSE Streaming Consumer                                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ x-malika-uid header
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         NEXT.JS API ROUTES                                  │
│  /api/chat/threads              → Proxy to backend                          │
│  /api/chat/threads/[id]/messages → Proxy to backend                         │
│  /api/chat/threads/[id]/stream   → SSE Proxy to backend                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      EXPRESS BACKEND - Port 5000                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  Routes: /chat/*                                                      │  │
│  │  └── chat.controller.js                                               │  │
│  │      └── chat.service.js (non-streaming)                              │  │
│  │      └── streaming.service.js (SSE streaming)                         │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  Services:                                                            │  │
│  │  └── search/intent.service.js (query understanding)                   │  │
│  │  └── ai/vectorSearch.service.js (RAG)                                 │  │
│  │  └── ai/embedding.service.js (OpenAI embeddings)                      │  │
│  │  └── cache/cache.service.js (data preview)                            │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MYSQL DATABASE                                    │
│  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐       │
│  │   chat_threads    │  │   chat_messages   │  │  knowledge_base   │       │
│  └───────────────────┘  └───────────────────┘  └───────────────────┘       │
│  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐       │
│  │   chat_feedback   │  │   data_sources    │  │ data_merged_cache │       │
│  └───────────────────┘  └───────────────────┘  └───────────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           OPENAI API                                        │
│  └── Chat Completions (gpt-4.1-mini)                                        │
│  └── Embeddings (text-embedding-3-small)                                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Frontend Architecture

### 3.1 File Structure

```
frontend/src/
├── app/
│   ├── (admin)/
│   │   └── chat/
│   │       ├── page.tsx              # Page entry point
│   │       ├── ChatPageClient.tsx    # Main chat component (2800+ lines)
│   │       ├── ChatPageClientV2.tsx  # Alternative streaming UI
│   │       ├── layout.tsx            # Chat layout
│   │       └── loading.tsx           # Loading skeleton
│   └── api/
│       └── chat/
│           ├── threads/
│           │   ├── route.ts          # GET/POST /threads
│           │   └── [id]/
│           │       ├── messages/
│           │       │   └── route.ts  # GET/POST messages
│           │       └── stream/
│           │           └── route.ts  # POST SSE stream
│           └── ...
└── components/
    └── chat/
        ├── ChatComponents.tsx        # Shared components
        └── ChatUiModal.tsx           # Modal for data display
```

### 3.2 Key Components

#### ChatPageClient.tsx
Komponen utama chat dengan ~2800 baris kode. Responsibilities:
- Thread management (create, list, switch)
- Message rendering dengan @chatui/core
- SSE streaming consumer
- Voice input support (Web Speech API)
- Quick reply chips
- Data preview modal

#### User Identification
```typescript
function getOrCreateMalikaUid() {
  const key = "malika_uid";
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const next = safeRandomId();  // UUID v4
    localStorage.setItem(key, next);
    return next;
  } catch {
    return safeRandomId();
  }
}
```

**Penting:** User ID disimpan di `localStorage` dengan key `malika_uid`. Ini memungkinkan:
- Persistensi session tanpa login
- Multi-device NOT supported (setiap device = user berbeda)

### 3.3 API Routes (Next.js)

| Route | Method | Description |
|-------|--------|-------------|
| `/api/chat/threads` | GET | List all threads for user |
| `/api/chat/threads` | POST | Create new thread |
| `/api/chat/threads/[id]/messages` | GET | List messages in thread |
| `/api/chat/threads/[id]/stream` | POST | Send message with SSE response |

Semua route adalah **proxy** ke backend Express dengan header `x-malika-uid`.

### 3.4 SSE Streaming Implementation

```typescript
// Frontend: Consume SSE stream
const res = await fetch(`${apiBase}/threads/${threadId}/stream`, {
  method: "POST",
  headers,
  body: JSON.stringify({ text: trimmed }),
});

const reader = res.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  
  buffer += decoder.decode(value, { stream: true });
  // Parse SSE events: event:xxx\ndata:yyy\n\n
  const parts = buffer.split(/\n\n/);
  // Process each event...
}
```

#### SSE Event Types
| Event | Description |
|-------|-------------|
| `text` | Streaming text chunk |
| `done` | Stream complete with full_text |
| `error` | Error occurred |
| `user_saved` | User message persisted |
| `thread_updated` | Thread title/topics updated |
| `intent` | Search intent detected |

---

## 4. Backend Architecture

### 4.1 File Structure

```
backend/src/
├── controllers/
│   └── chat.controller.js       # Route handlers
├── routes/
│   └── chat.routes.js           # Route definitions
├── services/
│   ├── chat/
│   │   ├── chat.service.js      # Non-streaming logic (3200 lines)
│   │   └── streaming.service.js # SSE streaming (5080 lines)
│   ├── ai/
│   │   ├── embedding.service.js # OpenAI embeddings
│   │   ├── vectorSearch.service.js # RAG search
│   │   └── knowledgePatterns.service.js # Service query detection
│   ├── search/
│   │   └── intent.service.js    # Query understanding
│   └── cache/
│       └── cache.service.js     # Data preview cache
└── models/
    ├── ChatThread.model.js
    ├── ChatMessage.model.js
    ├── ChatFeedback.model.js
    └── KnowledgeBase.model.js
```

### 4.2 Route Definitions

```javascript
// backend/src/routes/chat.routes.js
router.get('/threads', chatController.listThreads);
router.post('/threads', chatController.createThread);
router.get('/threads/:id/messages', chatController.listMessages);
router.post('/threads/:id/messages', chatController.sendMessage);  // Non-streaming
router.get('/threads/:id/stream', chatController.streamMessage);   // SSE
router.post('/threads/:id/stream', chatController.streamMessage);  // SSE
```

### 4.3 Streaming Service Core Logic

```javascript
// streaming.service.js - Simplified flow
async function streamChatResponse({ res, threadId, userMessage, ownerId }) {
  // 1. Validate & setup SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  
  // 2. Save user message to DB
  const userMsg = await ChatMessage.create({
    thread_id: threadId,
    role: 'user',
    content: userMessage,
  });
  
  // 3. Load conversation history (last 20 messages)
  const history = await ChatMessage.findAll({
    where: { thread_id: threadId },
    order: [['id', 'ASC']],
    limit: 20,
  });
  
  // 4. Smart context merging (follow-up detection)
  const effectiveQuery = mergeQueryIfNeeded(userMessage, history);
  
  // 5. Intent resolution & datasource candidates
  const intent = await resolveSearchIntent({ q: effectiveQuery });
  const candidates = await buildDatasourceCandidates({ q: effectiveQuery });
  
  // 6. RAG: Search knowledge base
  const knowledgeContext = await searchKnowledgeBase(userMessage, 3);
  
  // 7. Load data preview if applicable
  const dataPreview = await getProcessedPreviewFromCache({ sourceId, year });
  
  // 8. Build OpenAI messages with system prompt
  const openAiMessages = [
    { role: 'system', content: systemPrompt(context) },
    ...historyMessages,
    { role: 'user', content: userMessage },
  ];
  
  // 9. Stream OpenAI response
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      messages: openAiMessages,
      stream: true,
    }),
  });
  
  // 10. Parse & forward SSE chunks
  for await (const chunk of response.body) {
    const text = parseChunk(chunk);
    sendEvent('text', { content: text });
  }
  
  // 11. Post-process & build UI metadata
  const uiMeta = buildUiMeta({ candidates, dataPreview, ... });
  
  // 12. Save assistant message with UI metadata
  await ChatMessage.create({
    thread_id: threadId,
    role: 'assistant',
    content: `${assistantText}\n\n\`\`\`malika_ui\n${JSON.stringify(uiMeta)}\n\`\`\``,
  });
  
  sendEvent('done', { full_text: assistantText });
  res.end();
}
```

### 4.4 System Prompt

System prompt dibuat dinamis berdasarkan konteks:

```javascript
function systemPrompt(context = {}) {
  const { hasDataPreview, hasCandidates, lowConfidence, periodFallback } = context;
  
  const base = `Kamu adalah MALIKA (Manajer Layanan Informasi dan Komunikasi Aktif), 
  asisten virtual customer service untuk layanan data statistik BPS Provinsi Maluku Utara.
  
  IDENTITAS & PERAN:
  - Nama: MALIKA
  - Fungsi: Customer Service data BPS Maluku Utara
  - Karakter: Ramah, profesional, informatif, membantu
  
  BATASAN PENTING:
  - HANYA gunakan data dari database/cache yang tersedia
  - JANGAN mengarang angka statistik/persentase/jumlah
  - Jika data tidak tersedia, katakan dengan jujur
  - JANGAN menyebut URL mentah dalam jawaban
  
  FORMAT RESPONS:
  - DILARANG menggunakan simbol markdown seperti **, *, #, -, dll
  - Gunakan plain text saja
  ...`;
  
  // Context-aware additions
  if (hasDataPreview) {
    return base + '\n\nKONTEKS: Tabel data SUDAH tersedia. Berikan interpretasi dari angka di tabel.';
  } else if (hasCandidates) {
    return base + '\n\nKONTEKS: Indikator ditemukan tapi tabel belum dimuat.';
  } else {
    return base + '\n\nKONTEKS: TIDAK ada data. Bantu klarifikasi kebutuhan user.';
  }
}
```

---

## 5. Database Schema

### 5.1 chat_threads

```sql
CREATE TABLE chat_threads (
  id INT AUTO_INCREMENT PRIMARY KEY,
  owner_id VARCHAR(100) NOT NULL,           -- User identifier
  title VARCHAR(255) NOT NULL,              -- Auto-generated from first message
  topics JSON DEFAULT NULL,                 -- Extracted topics for navigation
  summary LONGTEXT,                         -- Conversation summary
  last_message_at DATETIME,                 -- Last activity
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  
  INDEX idx_owner_id (owner_id),
  INDEX idx_last_message_at (last_message_at)
);
```

### 5.2 chat_messages

```sql
CREATE TABLE chat_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  thread_id INT NOT NULL,                   -- FK to chat_threads
  role ENUM('system', 'user', 'assistant') NOT NULL,
  content LONGTEXT NOT NULL,                -- Message content (includes UI metadata)
  model VARCHAR(80),                        -- OpenAI model used
  tokens_in INT,                            -- Input token count
  tokens_out INT,                           -- Output token count
  latency_ms INT,                           -- Response latency
  created_at DATETIME NOT NULL,
  
  INDEX idx_thread_id (thread_id),
  INDEX idx_created_at (created_at)
);
```

### 5.3 chat_feedback

```sql
CREATE TABLE chat_feedback (
  id INT AUTO_INCREMENT PRIMARY KEY,
  owner_id VARCHAR(100) NOT NULL,
  thread_id INT,
  message_id INT,
  rating ENUM('up', 'down'),                -- Thumbs up/down
  stars INT,                                -- 1-5 stars
  review TEXT,                              -- Optional text review
  created_at DATETIME NOT NULL,
  
  INDEX idx_owner_id (owner_id),
  INDEX idx_thread_id (thread_id)
);
```

### 5.4 knowledge_base

```sql
CREATE TABLE knowledge_base (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,              -- Document title
  description TEXT,                         -- Optional description
  category VARCHAR(100),                    -- Category (metodologi, FAQ, etc)
  source_type ENUM('text', 'pdf', 'url') DEFAULT 'text',
  source_filename VARCHAR(255),             -- Original filename
  source_url TEXT,                          -- Source URL
  content LONGTEXT NOT NULL,                -- Extracted text content
  content_length INT,                       -- Character count
  chunk_index INT DEFAULT 0,                -- For split documents
  parent_id INT,                            -- Parent for chunks
  embedding LONGTEXT,                       -- JSON array of 1536 floats
  embedding_updated_at DATETIME,
  status ENUM('pending', 'processing', 'ready', 'error') DEFAULT 'pending',
  error_message TEXT,
  created_by INT,
  created_at DATETIME,
  updated_at DATETIME,
  
  INDEX idx_status (status),
  INDEX idx_category (category)
);
```

---

## 6. Knowledge Base & RAG

### 6.1 RAG Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      USER QUERY                                 │
│                  "cara mendapatkan data mikro"                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│               EMBEDDING SERVICE                                 │
│  └── generateEmbedding(query) → OpenAI text-embedding-3-small  │
│  └── Returns: [0.012, -0.034, ..., 0.089] (1536 dimensions)    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              VECTOR SEARCH SERVICE                              │
│  └── Load embeddings from DB to memory cache (TTL: 5 min)      │
│  └── Cosine similarity against all documents                   │
│  └── Return top N results with similarity scores               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                RESULTS                                          │
│  1. "Layanan Data Mikro BPS" (similarity: 0.87)                │
│  2. "Prosedur Permintaan Data" (similarity: 0.72)              │
│  3. "FAQ Layanan Statistik" (similarity: 0.65)                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 Vector Search Implementation

```javascript
// vectorSearch.service.js
function cosineSimilarity(a, b) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function searchKnowledge(query, topN = 5) {
  const queryEmbedding = await generateEmbedding(query);
  const knowledgeCache = await loadKnowledgeEmbeddings();
  
  const scored = [];
  for (const [id, doc] of knowledgeCache) {
    const similarity = cosineSimilarity(queryEmbedding, doc.embedding);
    scored.push({ ...doc, similarity });
  }
  
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, topN);
}
```

### 6.3 Integration in Chat

Knowledge context diinjeksi ke system prompt:

```javascript
// In streaming.service.js
const knowledgeContext = await searchKnowledgeBase(userMessage, 3);

if (knowledgeContext.length > 0) {
  const knowledgePrompt = `
KNOWLEDGE BASE (gunakan untuk menjawab pertanyaan layanan):
${knowledgeContext.map(k => `- ${k.title}: ${k.content.slice(0, 500)}`).join('\n')}
`;
  openAiMessages.push({ role: 'system', content: knowledgePrompt });
}
```

---

## 7. Alur Data & Request Flow

### 7.1 Send Message Flow (Complete)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 1: USER TYPES MESSAGE                                                  │
│ Frontend: ChatPageClient.tsx → sendToBackend()                              │
│ - Add user message to local state (optimistic UI)                           │
│ - Show typing indicator                                                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 2: FRONTEND API CALL                                                   │
│ POST /api/chat/threads/{id}/stream                                          │
│ Headers: { x-malika-uid: "uuid-xxx" }                                       │
│ Body: { text: "berapa inflasi maluku utara 2024" }                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 3: NEXT.JS API ROUTE PROXY                                             │
│ /api/chat/threads/[id]/stream/route.ts                                      │
│ - Validate x-malika-uid header                                              │
│ - Forward request to backend with SSE streaming                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 4: BACKEND VALIDATION                                                  │
│ streaming.service.js → streamChatResponse()                                 │
│ - Verify thread ownership (owner_id == x-malika-uid)                        │
│ - Setup SSE response headers                                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 5: SAVE USER MESSAGE                                                   │
│ ChatMessage.create({ thread_id, role: 'user', content })                    │
│ → SSE event: user_saved { id: 123 }                                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 6: LOAD CONVERSATION HISTORY                                           │
│ ChatMessage.findAll({ thread_id, limit: 20 })                               │
│ - Get last 20 messages for context                                          │
│ - Parse previous malika_ui blocks for context merging                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 7: SMART CONTEXT MERGING                                               │
│ Detect message type:                                                        │
│ - isConfirmMessage("ya") → use previous query                               │
│ - isPeriodFragment("tahun 2024") → merge with topic                         │
│ - isGeoOnlyFragment("morotai") → merge with topic                           │
│ - isShortFollowUp("2024 ada?") → merge with topic                           │
│                                                                              │
│ Example: "pengangguran" + "tahun 2024 kepsul"                               │
│        → "pengangguran tahun 2024 kepulauan sula"                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 8: INTENT RESOLUTION                                                   │
│ resolveSearchIntent({ q: effectiveQuery })                                  │
│ → Returns: { query_builder, plan, datasource }                              │
│                                                                              │
│ buildDatasourceCandidates({ q: effectiveQuery, limit: 12 })                │
│ → Returns: [{ id, name, type, score }, ...]                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 9: RAG KNOWLEDGE SEARCH                                                │
│ searchKnowledgeBase(userMessage, 3)                                         │
│ → Returns: [{ title, content, similarity }, ...]                           │
│                                                                              │
│ Also: knowledgePatternsService.detectServiceQuery(userMessage)              │
│ → Returns: { isService: true, topic: "layanan nol rupiah" }                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 10: DATA PREVIEW LOADING                                               │
│ getProcessedPreviewFromCache({ sourceId, year, month, geo })                │
│ - Try ProcessedCache table first                                            │
│ - Fallback to data_bps.indikator_X table                                   │
│ - Fallback to MergedCache table                                             │
│ → Returns: { columns, data, source, last_update }                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 11: BUILD OPENAI REQUEST                                               │
│ Messages array:                                                              │
│ 1. { role: 'system', content: systemPrompt(context) }                       │
│ 2. { role: 'system', content: knowledgeContext } // if RAG results         │
│ 3. { role: 'system', content: dataTableContext } // if preview exists      │
│ 4. ...history messages (last 16)                                            │
│ 5. { role: 'user', content: userMessage }                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 12: OPENAI STREAMING CALL                                              │
│ POST https://api.openai.com/v1/chat/completions                             │
│ { model: "gpt-4.1-mini", messages, stream: true }                           │
│                                                                              │
│ For each chunk:                                                              │
│ → SSE event: text { content: "chunk..." }                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 13: POST-PROCESSING                                                    │
│ - stripMarkdownFormatting(text)                                             │
│ - stripRawUrlsFromText(text)                                                │
│ - clampChatRhythm(text) // max lines, max chars                             │
│ - cleanAssistantTextAgainstDb(text) // remove hallucinated numbers          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 14: BUILD UI METADATA                                                  │
│ buildUiMeta({ q, intentResult, candidates, dataPreview })                   │
│ → Returns MalikaUiMetaV1:                                                   │
│   {                                                                          │
│     v: 1,                                                                    │
│     preview_mode: "auto" | "confirm" | "none",                              │
│     candidates: [{ id, name, type, score, href }],                          │
│     table: { columns, rows, title },                                        │
│     suggestions: ["...", "..."],                                            │
│     links: [{ label, href }],                                               │
│   }                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 15: SAVE ASSISTANT MESSAGE                                             │
│ ChatMessage.create({                                                        │
│   thread_id,                                                                 │
│   role: 'assistant',                                                         │
│   content: `${text}\n\n\`\`\`malika_ui\n${JSON.stringify(uiMeta)}\n\`\`\``, │
│   model: "gpt-4.1-mini",                                                    │
│   latency_ms,                                                                │
│ })                                                                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 16: FINALIZE SSE                                                       │
│ → SSE event: done { full_text: "..." }                                      │
│ → res.end()                                                                  │
│                                                                              │
│ Frontend: refreshMessagesSilently() to get full UI metadata                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Konteks & Memory Management

### 8.1 Persistensi Data

| Aspek | Persistensi | Detail |
|-------|-------------|--------|
| **User Messages** | ✅ Database | Tersimpan di `chat_messages` |
| **Assistant Messages** | ✅ Database | Termasuk `malika_ui` metadata |
| **Thread Info** | ✅ Database | Title, topics, last_message_at |
| **UI Metadata** | ✅ Embedded | JSON dalam content assistant |
| **Server Restart** | ✅ Aman | Semua di MySQL |
| **User Session** | ✅ localStorage | `malika_uid` UUID |

### 8.2 Konteks untuk OpenAI

**Per request, dikirim ke OpenAI:**

```
┌─────────────────────────────────────────────────────────────────┐
│ SYSTEM PROMPT                                                   │
│ - Role definition (MALIKA)                                      │
│ - Constraints & rules                                           │
│ - Context-aware additions                                       │
├─────────────────────────────────────────────────────────────────┤
│ KNOWLEDGE CONTEXT (if RAG results exist)                        │
│ - Top 3 relevant knowledge documents                            │
├─────────────────────────────────────────────────────────────────┤
│ DATA CONTEXT (if preview exists)                                │
│ - Table columns                                                 │
│ - Sample rows (max 10)                                          │
│ - Period & source info                                          │
├─────────────────────────────────────────────────────────────────┤
│ CONVERSATION HISTORY                                            │
│ - Last 16-20 messages                                           │
│ - Both user and assistant                                       │
│ - Stripped of malika_ui blocks                                  │
├─────────────────────────────────────────────────────────────────┤
│ CURRENT USER MESSAGE                                            │
│ - Original or merged query                                      │
└─────────────────────────────────────────────────────────────────┘
```

### 8.3 Smart Context Merging

**Tujuan:** Memungkinkan user mengirim pesan singkat yang tetap terhubung dengan konteks sebelumnya.

```javascript
// Detection functions
isConfirmMessage("ya")          → true  // Konfirmasi
isPeriodFragment("tahun 2024")  → true  // Fragment periode
isGeoOnlyFragment("morotai")    → true  // Fragment geo
isShortFollowUp("2024 ada?")    → true  // Follow-up singkat

// Merge logic
if (isConfirm && lastMeaningful) {
  effectiveQuery = lastMeaningful;  // "pengangguran maluku utara"
}

if (isPeriodFragment && lastMeaningful) {
  effectiveQuery = mergeQuery(lastMeaningful, currentMessage);
  // "pengangguran maluku utara" + "tahun 2024 kepsul"
  // → "pengangguran maluku utara tahun 2024 kepulauan sula"
}
```

### 8.4 UI Metadata (malika_ui)

Setiap respons assistant menyimpan structured metadata:

```json
{
  "v": 1,
  "query": "inflasi maluku utara 2024",
  "preview_mode": "auto",
  "preview_queries": [
    { "label": "Pakai indikator teratas", "q": "Inflasi Maluku Utara 2024" }
  ],
  "requested": {
    "year": 2024,
    "month": null,
    "geo": null
  },
  "table": {
    "kind": "data",
    "title": "Inflasi Maluku Utara • 2024",
    "columns": ["Bulan", "Inflasi (%)"],
    "rows": [{"Bulan": "Januari", "Inflasi (%)": 0.45}, ...],
    "total_rows": 12
  },
  "candidates": [
    { "id": 42, "name": "Inflasi Maluku Utara", "type": "dynamic", "score": 95 }
  ],
  "links": [
    { "label": "Buka data yang paling sesuai", "href": "/data?source_id=42&period=2024" }
  ],
  "suggestions": ["Lihat per kabupaten/kota", "Bandingkan dengan tahun lalu"]
}
```

---

## 9. Security & Authentication

### 9.1 User Authentication Model

**Catatan:** Chat MALIKA menggunakan **anonymous authentication** berbasis UUID.

```
┌─────────────────────────────────────────────────────────────────┐
│                    AUTHENTICATION FLOW                          │
│                                                                 │
│  1. User buka /chat pertama kali                                │
│     ↓                                                           │
│  2. Frontend generate UUID v4 → localStorage["malika_uid"]      │
│     ↓                                                           │
│  3. Setiap request API → header x-malika-uid: <uuid>            │
│     ↓                                                           │
│  4. Backend validate header presence                            │
│     ↓                                                           │
│  5. Query filter by owner_id = <uuid>                           │
└─────────────────────────────────────────────────────────────────┘
```

### 9.2 Security Measures

| Layer | Protection |
|-------|------------|
| **Header Validation** | `x-malika-uid` required, max 100 chars |
| **Thread Ownership** | Every query filtered by owner_id |
| **Content Sanitization** | URLs stripped from responses |
| **CSRF Exemption** | `/chat` routes exempted (anonymous auth) |
| **Rate Limiting** | Implicit via OpenAI rate limits |
| **Input Validation** | Max message length 4000-8000 chars |

### 9.3 Security Considerations

**Current Limitations:**
1. **No real authentication** - Anyone can create threads
2. **UUID can be stolen** - localStorage accessible via XSS
3. **No rate limiting** - Potential abuse vector
4. **No IP logging** - Hard to trace abuse

**Recommendations for Production:**
1. Implement proper user authentication (OAuth/JWT)
2. Add rate limiting per user/IP
3. Log request IPs for abuse detection
4. Consider CAPTCHA for new threads

---

## 10. Checkpoints & Production Readiness

### 10.1 Current Production Status

| Component | Status | Notes |
|-----------|--------|-------|
| **Core Chat** | ✅ Production | Stable |
| **SSE Streaming** | ✅ Production | With retry logic |
| **Database Persistence** | ✅ Production | MySQL + Sequelize |
| **RAG/Knowledge Base** | ✅ Production | Vector search working |
| **Data Preview** | ✅ Production | Multiple fallback sources |
| **Context Merging** | ✅ Production | Smart follow-up detection |
| **Error Handling** | ⚠️ Partial | Needs more granular errors |
| **Rate Limiting** | ❌ Missing | Recommended to add |
| **Monitoring** | ⚠️ Basic | Logs only, no metrics |
| **Tests** | ⚠️ Partial | Some unit tests exist |

### 10.2 Production Checklist

#### ✅ DONE
- [x] Database schema defined and migrated
- [x] SSE streaming with proper headers (X-Accel-Buffering: no)
- [x] Error recovery in streaming (abort controller)
- [x] Message persistence before/after OpenAI call
- [x] UI metadata embedding in messages
- [x] Knowledge base with embeddings
- [x] Smart context merging
- [x] Response post-processing (markdown strip, URL strip)
- [x] PM2 deployment config

#### ⚠️ NEEDS IMPROVEMENT
- [ ] Add rate limiting (per user/IP)
- [ ] Add request/response logging for debugging
- [ ] Add metrics collection (latency, errors, usage)
- [ ] Add health check endpoint
- [ ] Add circuit breaker for OpenAI calls
- [ ] Add fallback responses when OpenAI is down
- [ ] Add integration tests for chat flow
- [ ] Add load testing results

#### ❌ NOT IMPLEMENTED
- [ ] Real user authentication
- [ ] Admin moderation interface
- [ ] Chat export/import functionality
- [ ] Multi-language support
- [ ] Typing indicators for multi-user (if needed)

### 10.3 Environment Variables Required

```bash
# OpenAI API Keys (3 separate keys recommended)
OPENAI_API_KEY_CHAT=sk-...              # For chat responses
OPENAI_API_KEY_QUERY_BUILDER=sk-...     # For intent parsing
OPENAI_API_KEY_EMBEDDINGS=sk-...        # For RAG embeddings

# OpenAI Model Configuration
OPENAI_MODEL_CHAT=gpt-4.1-mini          # Chat model
OPENAI_CHAT_TIMEOUT_MS=30000            # Timeout for chat calls

# Database
DB_HOST=localhost
DB_USER=root
DB_PASS=xxx
DB_NAME=project_data_strategis

# Optional: Chat behavior tuning
MALIKA_MAX_LINES=10                     # Max response lines
MALIKA_MAX_CHARS=1000                   # Max response chars
MALIKA_MAX_QUESTIONS=2                  # Max questions in response
MALIKA_MIN_CONFIDENCE=0.6               # Min score for auto-preview
MALIKA_SYSTEM_PROMPT=                   # Override system prompt
```

---

## 11. Saran Improvement Query & Response

### 11.1 Query Processing Improvements

#### A. Intent Classification Enhancement

**Current State:**
```javascript
// Relies on keyword matching + embeddings
const intent = await resolveSearchIntent({ q: query });
```

**Improvement:**
```javascript
// Add multi-stage classification
async function enhancedIntentResolution(query) {
  // Stage 1: Fast keyword classification
  const fastIntent = classifyByKeywords(query);
  
  // Stage 2: If ambiguous, use LLM for classification
  if (fastIntent.confidence < 0.7) {
    const llmIntent = await classifyWithLLM(query, {
      categories: ['data_search', 'service_inquiry', 'greeting', 'clarification']
    });
    return mergeIntents(fastIntent, llmIntent);
  }
  
  return fastIntent;
}
```

#### B. Query Normalization

**Current State:** Minimal normalization

**Improvement:**
```javascript
function normalizeQuery(raw) {
  let q = raw.toLowerCase().trim();
  
  // 1. Expand abbreviations
  const abbrevMap = {
    'tpt': 'tingkat pengangguran terbuka',
    'ipm': 'indeks pembangunan manusia',
    'pdrb': 'produk domestik regional bruto',
    'ihk': 'indeks harga konsumen',
    'ntb': 'nilai tambah bruto',
    // ... more abbreviations
  };
  
  // 2. Normalize geo names
  const geoNormMap = {
    'kepsul': 'kepulauan sula',
    'halut': 'halmahera utara',
    'tikep': 'tidore kepulauan',
    // ... more geo aliases
  };
  
  // 3. Normalize time expressions
  q = q.replace(/thn\s*(\d{4})/gi, 'tahun $1');
  q = q.replace(/bln\s+(\w+)/gi, 'bulan $1');
  
  // Apply mappings
  for (const [abbrev, full] of Object.entries(abbrevMap)) {
    q = q.replace(new RegExp(`\\b${abbrev}\\b`, 'gi'), full);
  }
  
  return q;
}
```

#### C. Multi-Turn Context Tracking

**Improvement:** Add explicit topic tracking

```javascript
class ConversationTracker {
  constructor(threadId) {
    this.threadId = threadId;
    this.currentTopic = null;
    this.mentionedYears = new Set();
    this.mentionedGeos = new Set();
    this.lastDataSource = null;
  }
  
  update(message, role) {
    if (role === 'user') {
      // Extract and track entities
      const years = extractYears(message);
      const geos = extractGeos(message);
      const topic = extractTopic(message);
      
      years.forEach(y => this.mentionedYears.add(y));
      geos.forEach(g => this.mentionedGeos.add(g));
      if (topic) this.currentTopic = topic;
    }
    
    if (role === 'assistant') {
      // Track which datasource was shown
      const uiMeta = parseUiMeta(message);
      if (uiMeta?.candidates?.[0]) {
        this.lastDataSource = uiMeta.candidates[0];
      }
    }
  }
  
  getContext() {
    return {
      topic: this.currentTopic,
      years: Array.from(this.mentionedYears),
      geos: Array.from(this.mentionedGeos),
      lastDataSource: this.lastDataSource,
    };
  }
}
```

### 11.2 Response Quality Improvements

#### A. Response Templating

**Current State:** Free-form LLM responses

**Improvement:** Add structured response templates

```javascript
const RESPONSE_TEMPLATES = {
  data_found: {
    template: `{interpretation}

Data yang ditampilkan adalah {indicator_name} periode {period}{geo_suffix}.

{follow_up_suggestion}`,
    variables: ['interpretation', 'indicator_name', 'period', 'geo_suffix', 'follow_up_suggestion']
  },
  
  data_not_found: {
    template: `Mohon maaf, saya belum menemukan data yang sesuai dengan "{query}".

Beberapa kemungkinan:
1. Indikator belum tersedia di database kami
2. Periode yang diminta belum ada datanya
3. Perlu klarifikasi lebih lanjut

Bisa tolong jelaskan lebih spesifik indikator dan periode yang dibutuhkan?`,
    variables: ['query']
  },
  
  period_unavailable: {
    template: `Data tahun {requested_year} belum tersedia untuk indikator ini.

Tahun yang tersedia: {available_years}.

Saya tampilkan data tahun {fallback_year} sebagai referensi.

{interpretation}`,
    variables: ['requested_year', 'available_years', 'fallback_year', 'interpretation']
  }
};

function buildResponse(template, variables) {
  let response = RESPONSE_TEMPLATES[template].template;
  for (const [key, value] of Object.entries(variables)) {
    response = response.replace(`{${key}}`, value || '');
  }
  return response;
}
```

#### B. Hallucination Prevention

**Improvement:** Stricter validation before sending to LLM

```javascript
async function buildOpenAIRequest(context) {
  const { userMessage, dataPreview, candidates } = context;
  
  // Strict rules injection
  const antiHallucinationRules = `
PENTING - ANTI HALUSINASI:
1. Jika TIDAK ADA tabel data di bawah ini, DILARANG menyebut angka apapun
2. Jika ada tabel, HANYA sebutkan angka yang ada di tabel
3. DILARANG membuat perbandingan/proyeksi dengan angka dari luar tabel
4. Jika ditanya angka yang tidak ada di tabel, katakan "data tidak tersedia di tabel ini"

STATUS DATA: ${dataPreview ? 'TABEL TERSEDIA' : 'TIDAK ADA TABEL'}
${dataPreview ? `ANGKA YANG BOLEH DISEBUT:\n${formatTableForValidation(dataPreview)}` : ''}
`;

  return {
    messages: [
      { role: 'system', content: baseSystemPrompt },
      { role: 'system', content: antiHallucinationRules },
      // ... rest of messages
    ]
  };
}

// Post-response validation
function validateResponse(response, dataPreview) {
  if (!dataPreview) {
    // No data preview - check for suspicious numbers
    const numbers = response.match(/\d+[.,]?\d*\s*(%|persen|rupiah|juta|miliar)/gi);
    if (numbers && numbers.length > 0) {
      console.warn('[Hallucination Detected]', numbers);
      return response.replace(
        /\d+[.,]?\d*\s*(%|persen|rupiah|juta|miliar)/gi, 
        '[angka tidak tersedia]'
      );
    }
  }
  return response;
}
```

#### C. Follow-up Suggestions Improvement

**Current State:** Static/generic suggestions

**Improvement:** Context-aware dynamic suggestions

```javascript
function generateSmartSuggestions(context) {
  const { topic, currentYear, currentGeo, dataPreview, candidates } = context;
  const suggestions = [];
  
  // 1. Period-based suggestions
  if (currentYear) {
    const prevYear = currentYear - 1;
    suggestions.push(`Bandingkan dengan tahun ${prevYear}`);
    
    if (!context.hasMonthData) {
      suggestions.push(`Rincian per bulan ${currentYear}`);
    }
  } else {
    suggestions.push('Data tahun terbaru');
    suggestions.push('Data 5 tahun terakhir');
  }
  
  // 2. Geo-based suggestions
  if (currentGeo) {
    suggestions.push('Bandingkan dengan provinsi');
    suggestions.push('Lihat semua kabupaten/kota');
  } else if (dataPreview?.hasGeoColumn) {
    suggestions.push('Per kabupaten/kota');
  }
  
  // 3. Topic-based suggestions
  if (topic) {
    const relatedTopics = getRelatedTopics(topic);
    suggestions.push(...relatedTopics.slice(0, 2).map(t => `Data ${t}`));
  }
  
  // 4. Action-based suggestions
  if (dataPreview) {
    suggestions.push('Export ke Excel');
    suggestions.push('Lihat grafik tren');
  }
  
  return suggestions.slice(0, 5);
}
```

### 11.3 Performance Improvements

#### A. Caching Layers

```javascript
// Add Redis/memory cache for frequent queries
const queryCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getCachedIntent(query) {
  const cacheKey = hashQuery(query);
  const cached = queryCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.value;
  }
  
  const intent = await resolveSearchIntent({ q: query });
  queryCache.set(cacheKey, { value: intent, timestamp: Date.now() });
  
  return intent;
}
```

#### B. Parallel Processing

```javascript
async function processUserMessage(message, context) {
  // Run independent operations in parallel
  const [
    intentResult,
    knowledgeResults,
    candidatesResult
  ] = await Promise.all([
    resolveSearchIntent({ q: message }),
    searchKnowledgeBase(message, 3),
    buildDatasourceCandidates({ q: message, limit: 12 })
  ]);
  
  // Sequential: data preview depends on candidates
  const dataPreview = candidatesResult[0]?.id 
    ? await getProcessedPreviewFromCache({ sourceId: candidatesResult[0].id, ...context })
    : null;
  
  return { intentResult, knowledgeResults, candidatesResult, dataPreview };
}
```

---

## 12. Scalability Recommendations

### 12.1 Current Architecture Limitations

| Aspect | Current | Limitation |
|--------|---------|------------|
| **Database** | Single MySQL | No read replicas |
| **Vector Search** | In-memory | Memory bound |
| **Session** | localStorage | Single device |
| **OpenAI Calls** | Per-request | No batching |
| **Streaming** | Per-connection | No connection pooling |

### 12.2 Horizontal Scaling Strategy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           LOAD BALANCER                                     │
│                        (nginx/HAProxy/ALB)                                  │
│                     ┌──────────────────────┐                               │
│                     │ Sticky Sessions by   │                               │
│                     │ x-malika-uid header  │                               │
│                     └──────────────────────┘                               │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
           ┌──────────────────┼──────────────────┐
           ▼                  ▼                  ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ Backend Node 1  │  │ Backend Node 2  │  │ Backend Node N  │
│ Port 5001       │  │ Port 5002       │  │ Port 500N       │
└─────────────────┘  └─────────────────┘  └─────────────────┘
           │                  │                  │
           └──────────────────┼──────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        MYSQL CLUSTER                                        │
│  ┌────────────────────┐    ┌────────────────────────────────┐              │
│  │    Primary (RW)    │───▶│     Read Replica 1 (RO)        │              │
│  │    Port 3306       │    │     Port 3307                  │              │
│  └────────────────────┘    └────────────────────────────────┘              │
│                            ┌────────────────────────────────┐              │
│                       ────▶│     Read Replica 2 (RO)        │              │
│                            │     Port 3308                  │              │
│                            └────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          REDIS CLUSTER                                      │
│  ┌────────────────────┐    ┌────────────────────┐                          │
│  │   Cache Layer      │    │   Session Store    │                          │
│  │   - Query cache    │    │   - User sessions  │                          │
│  │   - Embedding cache│    │   - Rate limits    │                          │
│  └────────────────────┘    └────────────────────┘                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 12.3 Database Scaling

```javascript
// Read replica configuration
const readSequelize = new Sequelize({
  dialect: 'mysql',
  replication: {
    read: [
      { host: 'replica1.db.local', username: 'reader', password: 'xxx' },
      { host: 'replica2.db.local', username: 'reader', password: 'xxx' },
    ],
    write: { host: 'primary.db.local', username: 'writer', password: 'xxx' }
  }
});

// Read operations use replicas
async function listMessages(threadId) {
  return ChatMessage.findAll({
    where: { thread_id: threadId },
    useMaster: false // Use read replica
  });
}

// Write operations use primary
async function saveMessage(data) {
  return ChatMessage.create(data, { useMaster: true });
}
```

### 12.4 Vector Search Scaling

**Option 1: External Vector Database**
```javascript
// Replace in-memory with Pinecone/Weaviate/Qdrant
const { PineconeClient } = require('@pinecone-database/pinecone');

const pinecone = new PineconeClient();
await pinecone.init({ environment: 'us-west1-gcp', apiKey: process.env.PINECONE_KEY });

async function searchKnowledge(query, topK = 5) {
  const embedding = await generateEmbedding(query);
  const index = pinecone.Index('knowledge-base');
  
  const results = await index.query({
    vector: embedding,
    topK,
    includeMetadata: true
  });
  
  return results.matches;
}
```

**Option 2: Distributed In-Memory**
```javascript
// Use Redis for embedding cache + search
const Redis = require('ioredis');
const redis = new Redis.Cluster([
  { host: 'redis1.local', port: 6379 },
  { host: 'redis2.local', port: 6379 },
]);

async function cacheEmbedding(id, embedding) {
  await redis.set(`emb:${id}`, JSON.stringify(embedding), 'EX', 3600);
}
```

### 12.5 Rate Limiting Implementation

```javascript
const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');

const chatLimiter = rateLimit({
  store: new RedisStore({
    client: redis,
    prefix: 'rl:chat:',
  }),
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 messages per minute
  keyGenerator: (req) => req.get('x-malika-uid') || req.ip,
  handler: (req, res) => {
    res.status(429).json({
      ok: false,
      error: 'rate_limit_exceeded',
      message: 'Terlalu banyak permintaan. Coba lagi dalam 1 menit.'
    });
  }
});

router.post('/threads/:id/stream', chatLimiter, chatController.streamMessage);
```

---

## 13. Monitoring & Observability

### 13.1 Metrics to Track

| Metric | Type | Description |
|--------|------|-------------|
| `chat_messages_total` | Counter | Total messages sent |
| `chat_response_latency_ms` | Histogram | Response time distribution |
| `chat_openai_errors_total` | Counter | OpenAI API failures |
| `chat_active_threads` | Gauge | Currently active threads |
| `chat_rag_hits` | Counter | Knowledge base matches |
| `chat_data_preview_hits` | Counter | Successful data previews |

### 13.2 Logging Strategy

```javascript
// Structured logging
const logger = require('pino')({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
});

// Request logging middleware
function chatLogger(req, res, next) {
  const start = Date.now();
  const logData = {
    method: req.method,
    path: req.path,
    userId: req.get('x-malika-uid')?.slice(0, 8),
    threadId: req.params.id,
  };
  
  res.on('finish', () => {
    logger.info({
      ...logData,
      status: res.statusCode,
      duration: Date.now() - start,
    }, 'chat_request');
  });
  
  next();
}

// OpenAI call logging
async function callOpenAI(messages, options) {
  const start = Date.now();
  try {
    const response = await openai.chat.completions.create(options);
    logger.info({
      model: options.model,
      promptTokens: response.usage?.prompt_tokens,
      completionTokens: response.usage?.completion_tokens,
      duration: Date.now() - start,
    }, 'openai_call');
    return response;
  } catch (error) {
    logger.error({
      model: options.model,
      error: error.message,
      duration: Date.now() - start,
    }, 'openai_error');
    throw error;
  }
}
```

### 13.3 Health Check Endpoint

```javascript
router.get('/health', async (req, res) => {
  const checks = {
    database: false,
    openai: false,
    embeddings: false,
  };
  
  try {
    await sequelize.authenticate();
    checks.database = true;
  } catch {}
  
  try {
    // Simple OpenAI ping
    await openai.models.list();
    checks.openai = true;
  } catch {}
  
  try {
    await generateEmbedding('test');
    checks.embeddings = true;
  } catch {}
  
  const allHealthy = Object.values(checks).every(Boolean);
  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'degraded',
    checks,
    timestamp: new Date().toISOString(),
  });
});
```

---

## 14. Troubleshooting Guide

### 14.1 Common Issues

#### Issue: "SSE stream not working"

**Symptoms:** Response comes all at once, not streaming

**Causes & Solutions:**
1. **Nginx buffering** - Add `X-Accel-Buffering: no` header
2. **Cloudflare buffering** - Use Enterprise plan or disable buffering
3. **Missing duplex option** - Add `duplex: 'half'` to fetch options

```javascript
// Backend fix
res.setHeader('X-Accel-Buffering', 'no');
res.setHeader('Cache-Control', 'no-cache, no-transform');
```

#### Issue: "Context not persisting across messages"

**Symptoms:** Bot doesn't remember previous conversation

**Causes & Solutions:**
1. **Different x-malika-uid** - Check localStorage consistency
2. **Thread not found** - Verify thread_id in request
3. **History limit** - Increase limit in ChatMessage.findAll

#### Issue: "Data preview empty"

**Symptoms:** Table shows but no rows

**Causes & Solutions:**
1. **Cache not populated** - Run cache refresh job
2. **Period mismatch** - Check period_value format (YYYY vs TTTMM)
3. **Source ID wrong** - Verify datasource exists and is active

#### Issue: "OpenAI timeout"

**Symptoms:** Response takes too long or fails

**Causes & Solutions:**
1. **Network issues** - Add retry logic with exponential backoff
2. **Token limit** - Reduce history length
3. **Model overload** - Switch to different model temporarily

```javascript
// Retry logic
async function callOpenAIWithRetry(options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await openai.chat.completions.create(options);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await sleep(Math.pow(2, i) * 1000);
    }
  }
}
```

### 14.2 Debug Commands

```bash
# Check chat tables
mysql -u root -p project_data_strategis -e "SELECT COUNT(*) FROM chat_threads; SELECT COUNT(*) FROM chat_messages;"

# View recent messages
mysql -u root -p project_data_strategis -e "SELECT id, thread_id, role, LEFT(content, 100) FROM chat_messages ORDER BY id DESC LIMIT 10;"

# Check knowledge base status
mysql -u root -p project_data_strategis -e "SELECT status, COUNT(*) FROM knowledge_base GROUP BY status;"

# Test backend health
curl -X GET http://localhost:5000/chat/health

# Test thread list
curl -X GET http://localhost:5000/chat/threads -H "x-malika-uid: test-user-123"

# Test SSE stream
curl -X POST http://localhost:5000/chat/threads/1/stream \
  -H "Content-Type: application/json" \
  -H "x-malika-uid: test-user-123" \
  -d '{"text": "halo"}' \
  --no-buffer
```

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-20 | Initial comprehensive documentation |

---

**Author:** AI Documentation Generator  
**Reviewed by:** -  
**Last Updated:** 20 Januari 2026
