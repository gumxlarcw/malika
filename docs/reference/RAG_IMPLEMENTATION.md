# RAG Implementation (Self-Hosted + OpenAI)

## Overview

Implementasi Retrieval-Augmented Generation (RAG) untuk meningkatkan akurasi routing Query Builder dengan menyediakan konteks datasource yang relevan.

```
┌─────────────────────────────────────────────────────────────┐
│                    RAG ARCHITECTURE                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  User Query ──► Embed (OpenAI) ──► Vector Search (MySQL)   │
│                                         │                   │
│                                         ▼                   │
│                              Top 5 Datasources              │
│                                         │                   │
│                                         ▼                   │
│                        Inject to Query Builder Prompt       │
│                                         │                   │
│                                         ▼                   │
│                    OpenAI Query Builder (Routing)           │
│                                         │                   │
│                                         ▼                   │
│                         Structured JSON Output              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Database: MariaDB 11.8.3

Karena MariaDB tidak memiliki native vector support (seperti pgvector), kita menggunakan pendekatan:
- **Storage**: JSON column di MySQL untuk menyimpan embedding vectors
- **Search**: Cosine similarity dihitung di Node.js (in-memory)
- **Scale**: ~317 datasources = sangat cepat (<10ms)

---

## Implementation Progress

### Phase 1: Database Schema ✅
- [x] Tambah kolom `embedding` (LONGTEXT/JSON) ke `data_sources`
- [x] Tambah kolom `embedding_updated_at` untuk tracking

```sql
ALTER TABLE data_sources 
ADD COLUMN embedding LONGTEXT NULL,
ADD COLUMN embedding_updated_at TIMESTAMP NULL;
```

### Phase 2: Embedding Service ✅
- [x] Buat `backend/src/services/ai/embedding.service.js`
  - [x] Function: `generateEmbedding(text)` - call OpenAI API
  - [x] Function: `embedDatasource(sourceId)` - embed single datasource
  - [x] Function: `embedAllDatasources()` - batch embed all
  - [x] Function: `getEmbeddingStats()` - get stats for admin

### Phase 3: Vector Search Service ✅
- [x] Buat `backend/src/services/ai/vectorSearch.service.js`
  - [x] Function: `loadEmbeddings()` - load all embeddings ke memory
  - [x] Function: `cosineSimilarity(a, b)` - hitung similarity
  - [x] Function: `searchDatasources(query, topN)` - search dengan embedding
  - [x] In-memory cache dengan TTL

### Phase 4: Knowledge Base Model ⬜
- [ ] Buat `backend/src/models/KnowledgeBase.model.js` (opsional untuk custom knowledge)
  - Untuk menyimpan knowledge tambahan selain datasources (metodologi, FAQ, dll)

### Phase 5: API Endpoints ✅
- [x] `GET /knowledge/stats` - embedding statistics
- [x] `POST /knowledge/embed/:id` - embed single datasource
- [x] `POST /knowledge/embed-all` - embed all datasources
- [x] `POST /knowledge/search` - test vector search
- [x] `DELETE /knowledge/embed/:id` - clear embedding

### Phase 6: Admin UI ✅
- [x] Halaman "Knowledge Base" di admin
  - [x] Tampilkan stats (total embedded, last update)
  - [x] Button "Embed All Datasources"
  - [x] List datasources dengan status embedding
  - [x] Test search interface
  - [ ] Upload custom knowledge (PDF/Text) - future

### Phase 7: Integration ✅
- [x] Integrasikan vector search ke Query Builder
- [x] Inject top candidates ke prompt
- [ ] A/B testing untuk measure improvement

---

## Technical Details

### Embedding Model
- **Model**: `text-embedding-3-small` (OpenAI)
- **Dimensions**: 1536
- **Cost**: ~$0.00002 per query

### Text to Embed (per datasource)
```javascript
const textToEmbed = [
  source.name,
  source.description || '',
  source.aliases || '',
  source.category || '',
].filter(Boolean).join('. ');
```

### Cosine Similarity Formula
```javascript
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
```

### Memory Usage Estimate
- 317 datasources × 1536 dimensions × 4 bytes = ~1.9 MB
- Very lightweight, dapat di-cache di memory

---

## Environment Variables

```env
# OpenAI Embeddings (reuse existing key or separate)
OPENAI_API_KEY_EMBEDDINGS=sk-...

# Optional: use same key as query builder
# Falls back to OPENAI_API_KEY_QUERY_BUILDER if not set
```

---

## File Structure

```
backend/src/
├── services/
│   └── ai/
│       ├── openaiChat.service.js      # existing
│       ├── queryBuilder.service.js    # existing
│       ├── embedding.service.js       # NEW - generate embeddings
│       └── vectorSearch.service.js    # NEW - search with embeddings
├── controllers/
│   └── knowledge.controller.js        # NEW - API endpoints
├── routes/
│   └── knowledge.routes.js            # NEW - route definitions
└── models/
    └── KnowledgeBase.model.js         # NEW (optional)

backend/admin/app/
└── knowledge/
    └── page.tsx                       # NEW - admin UI
```

---

## API Usage Example

### Embed All Datasources
```bash
POST /api/knowledge/embed-all
Authorization: Bearer <token>

Response:
{
  "ok": true,
  "total": 317,
  "embedded": 317,
  "skipped": 0,
  "errors": 0,
  "duration_ms": 12500
}
```

### Search Datasources
```bash
POST /api/knowledge/search
Content-Type: application/json

{
  "query": "inflasi kota ternate tahun 2024",
  "topN": 5
}

Response:
{
  "ok": true,
  "results": [
    { "id": 5, "name": "IHK Kota Ternate", "similarity": 0.89 },
    { "id": 12, "name": "Inflasi Bulanan Malut", "similarity": 0.82 },
    ...
  ],
  "duration_ms": 45
}
```

---

## Cost Estimation

| Operation | Cost |
|-----------|------|
| Embed 317 datasources (one-time) | ~$0.001 |
| Embed per search query | ~$0.00002 |
| 1000 searches/day | ~$0.02/day |
| 30000 searches/month | ~$0.60/month |

---

## Future Enhancements

1. **Custom Knowledge Upload**: Upload PDF/text untuk metodologi, FAQ
2. **Hybrid Search**: Combine vector search dengan keyword search
3. **Re-ranking**: Use cross-encoder untuk re-rank results
4. **Caching**: Cache popular query embeddings
5. **Analytics**: Track search accuracy dan user feedback

---

## References

- [OpenAI Embeddings Guide](https://platform.openai.com/docs/guides/embeddings)
- [text-embedding-3-small](https://platform.openai.com/docs/models/embeddings)
- Copilot Instructions: `.github/copilot-instructions.md`
