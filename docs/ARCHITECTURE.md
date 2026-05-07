# Architecture Guide

## System Overview
The system consists of three services:
- Backend API (Express) on port 5000
- Admin Panel (Next.js) on port 5050 (basePath /backend)
- Public PWA (Next.js) on port 3000

Cloudflared routes:
- api-malika.bpsmalut.com/backend/* → Admin Panel
- api-malika.bpsmalut.com/* → Backend API
- malika.bpsmalut.com/* → Public PWA

## Diagrams

### System Architecture
```mermaid
flowchart LR
   subgraph Cloudflared
      A[api-malika.bpsmalut.com] -->|/backend/*| Admin(Next.js Admin :5050)
      A -->|/*| API(Express API :5000)
      B[malika.bpsmalut.com] -->|/*| PWA(Next.js PWA :3000)
   end

   API --> DB[(MySQL project_data_strategis)]
   API --> Replica[(MySQL data_bps)]
   Admin --> API
   PWA --> API
```

### Database ERD
```mermaid
erDiagram
   USERS {
      int id
      string name
      string email
      string role
   }
   DATA_SOURCES {
      int id
      string name
      string type
      string api_url
   }
   DATA_PERIOD_MAP {
      int id
      int source_id
      string period_value
   }
   DATA_PROCESSED_CACHE {
      int id
      int source_id
      string period_value
   }
   DATA_MERGED_CACHE {
      int id
      int source_id
      string signature
   }
   CHAT_THREADS {
      int id
      string owner_id
   }
   CHAT_MESSAGES {
      int id
      int thread_id
      string role
   }
   KNOWLEDGE_BASE {
      int id
      string source_type
   }

   DATA_SOURCES ||--o{ DATA_PERIOD_MAP : has
   DATA_SOURCES ||--o{ DATA_PROCESSED_CACHE : caches
   DATA_SOURCES ||--o{ DATA_MERGED_CACHE : merges
   CHAT_THREADS ||--o{ CHAT_MESSAGES : contains
```

## Data Stores
- Primary MySQL: project_data_strategis
- Replica MySQL: data_bps (best-effort sync)

## Core Flows
### Search Flow
1. PWA calls /api/search
2. Backend /search/intent ranks datasources
3. PWA merges with BPS publications

```mermaid
sequenceDiagram
   participant User
   participant PWA
   participant API
   participant BPS
   participant DB

   User->>PWA: Search query
   PWA->>API: GET /search/intent?q=...
   API->>DB: Load datasources + metadata
   API-->>PWA: Intent results
   PWA->>BPS: Fetch publications
   PWA-->>User: Unified results
```

### Data Fetch Flow
1. PWA calls /api/data-preview
2. Backend dynamic controller resolves priority:
   - data_bps table
   - ProcessedCache
   - Upstream API

### Chat Flow
1. PWA sends /chat/threads/:id/messages
2. Backend streams via SSE /chat/threads/:id/stream
3. Responses include UI metadata for rendering

```mermaid
sequenceDiagram
   participant User
   participant PWA
   participant API
   participant AI
   participant DB

   User->>PWA: Send message
   PWA->>API: POST /chat/threads/:id/messages
   API->>DB: Save message
   API->>AI: Stream completion
   AI-->>API: Tokens
   API-->>PWA: SSE stream
   API->>DB: Save assistant message
   PWA-->>User: Render response
```

## Services and Ownership
- Backend services: backend/src/services
- Controllers: backend/src/controllers
- Routes: backend/src/routes
- Shared utils: backend/src/utils

## Security Model
- JWT stored in httpOnly cookie (token)
- CSRF token required for admin writes
- Rate limiting per endpoint
- Admin-only routes require role=admin

```mermaid
sequenceDiagram
   participant Admin
   participant AdminUI
   participant API
   participant DB

   Admin->>AdminUI: Login form
   AdminUI->>API: POST /auth/login
   API->>DB: Verify user
   API-->>AdminUI: Set httpOnly token
   AdminUI->>API: Authenticated requests
```

## Observability
- Structured logging with request IDs
- Metrics at /metrics (Prometheus)
- Health check at /health

## Deployment Notes
- PM2 manages processes via ecosystem.config.js
- Production uses cluster mode for backend, admin-prod, pwa-prod

```mermaid
flowchart TB
   Client[Users] --> Cloudflared
   Cloudflared -->|/backend/*| Admin[Next.js Admin :5050]
   Cloudflared -->|/*| API[Express API :5000]
   Cloudflared -->|malika.bpsmalut.com| PWA[Next.js PWA :3000]
   API --> DB[(MySQL project_data_strategis)]
   API --> Replica[(MySQL data_bps)]
```
