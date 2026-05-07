# Project Data Strategis — Reference Doc

> Dibuat 2026-03-02. Untuk digunakan saat pindah workspace / onboarding ulang.

---

## Gambaran Umum

**MALIKA** = AI assistant statistik BPS Maluku Utara, berbasis data BPS lokal.

| Komponen | Port | Framework | Deskripsi |
|---|---|---|---|
| `pds-backend` | 5000 | Express 5 + Sequelize | API utama, RAG, chat, AI |
| `pds-admin` | 5050 | Next.js 16 | Admin panel (manajemen data) |
| `pds-frontend` | 6060 | Next.js 16 + React 19 | PWA chatbot Malika |
| `malika-llm-proxy` | 3031 | Node.js (standalone) | LLM proxy — **ISOLATED dari openclaw** |

**URL Produksi (Cloudflare Tunnel):**
```
malika.bpsmalut.com            → Frontend (6060)
api-malika.bpsmalut.com        → Backend API (5000)
api-malika.bpsmalut.com/backend → Admin (5050)
```

---

## Lokasi File Penting

```
/var/www/html/project-data-strategis/
├── backend/
│   ├── .env                    ← SEMUA konfigurasi model + DB + API key
│   ├── server.js               ← Entry point backend
│   ├── src/services/chat/
│   │   ├── streaming/          ← Pipeline chat (modelRouter, pipeline, orchestrator, dst)
│   │   └── malika-llm-proxy.js ← Proxy LLM (dibuat 2026-03-02)
│   └── src/services/ai/client/
│       └── geminiKeyRotation.js ← Rotasi Google API key (13 key)
├── frontend/src/               ← Next.js PWA
├── docs/                       ← Arsitektur, setup, audit docs
└── ecosystem.config.js         ← PM2 config untuk 3 proses PDS

/opt/openclaw/
├── ecosystem.config.js              ← PM2 openclaw-gateway
└── malika-llm-proxy.config.js       ← PM2 malika-llm-proxy (dibuat 2026-03-02)
```

---

## Konfigurasi LLM (per 2026-03-02)

### Arsitektur Proxy

```
Malika Backend (pds-backend port 5000)
       ↓  OPENAI_API_URL = http://127.0.0.1:3031/v1/chat/completions
[malika-llm-proxy] Port 3031  ← PM2 process, TERPISAH dari openclaw-gateway
       ↓
  ┌─────────────────────────────────────────┐
  │  claude-sonnet-4-6 (SEMUA TIER)        │
  │  → Anthropic API (oat01 OAuth token)   │
  └──────────────────┬──────────────────────┘
                     │ fallback jika Anthropic gagal:
                     ↓
  ┌─────────────────────────────────────────┐
  │  Google API (10-key rotation)           │
  │  wisnucandragumelar, ipdsmalut, dst.    │
  └─────────────────────────────────────────┘
```

**Kenapa isolated?** Restart `openclaw-gateway` tidak akan mematikan Malika.

### Model Tiers (modelRouter.service.js)

| Tier | Trigger | Model saat ini |
|---|---|---|
| GREETING | Sapaan | `claude-sonnet-4-6` |
| SIMPLE | Query data biasa | `claude-sonnet-4-6` |
| COMPLEX | Multi-sumber, tren, perbandingan | `claude-sonnet-4-6` |
| DEEP | Proyeksi, kausalitas, elastisitas, mengapa... | `claude-sonnet-4-6` |

Semua tier → Sonnet. Bisa dikembalikan ke Gemini dengan ganti `.env`.

### .env — Bagian Model

```env
# Proxy LLM (jangan ubah ini)
OPENAI_API_URL=http://127.0.0.1:3031/v1/chat/completions
OPENAI_API_BASE_URL=http://127.0.0.1:3031/v1
OPENAI_API_KEY_CHAT=malika-internal-proxy

# Model (semua Claude Sonnet per 2026-03-02)
OPENAI_MODEL_CHAT=claude-sonnet-4-6
OPENAI_MODEL_REASONING=claude-sonnet-4-6
OPENAI_MODEL_COMPACTION=claude-sonnet-4-6
# ... dan semua per-service override lainnya
```

---

## PM2 — Proses yang Relevan

```bash
pm2 list                          # lihat semua proses
pm2 logs pds-backend --lines 50   # log backend
pm2 logs malika-llm-proxy         # log proxy LLM
pm2 reload pds-backend --update-env  # reload + apply .env baru
pm2 reload malika-llm-proxy       # reload proxy
```

| PM2 Name | ID | Port | Config / Script |
|---|---|---|---|
| `pds-backend` | 24 | 5000 | `ecosystem.config.js` di root project |
| `pds-admin` | 3 | 5050 | `ecosystem.config.js` di root project |
| `pds-frontend` | 4 | 6060 | `ecosystem.config.js` di root project |
| `malika-llm-proxy` | 36 | 3031 | `/opt/openclaw/malika-llm-proxy.config.js` |

> ID PM2 bisa berubah kalau pm2 di-reset. Gunakan nama (`pm2 reload pds-backend`).

---

## Database

```
Host:   localhost
DB:     project_data_strategis  (utama)
DB:     data_bps                (replica BPS, read-only)
User:   root
Pass:   17Agustus
```

Tabel utama: `users`, `data_sources`, `data_period_map`, `data_processed_cache`,
`data_merged_cache`, `chat_threads`, `chat_messages`, `knowledge_base`

---

## Google API Keys (10 working)

File rotasi: `/backend/src/services/ai/client/geminiKeyRotation.js`

| Akun | Key reference |
|---|---|
| wisnucandragumelar | `<secret-1>` |
| ipdsmalut | `<secret-2>` |
| gumelarwork | `<secret-3>` |
| perpustakaankaryapertiwi | `<secret-4>` |
| saparysimon161 | `<secret-5>` |
| igbpssula | `<secret-6>` |
| hasmanumakaapa40 | `<secret-7>` |
| irwandi.sula | `<secret-8>` |
| taibannaji | `<secret-9>` |
| bista.malut | `<secret-10>` |

> **Aktualnya disimpan di** (NOT in git):
> - `backend/.env` → `GOOGLE_API_KEYS=key1,key2,...` (comma-separated)
> - `/opt/openclaw/malika-llm-proxy.config.js` → key array di `GOOGLE_API_KEYS`
>
> **Untuk update**: edit file-file di atas + restart `pm2 reload pds-backend malika-llm-proxy`.

**Suspended** (jangan pakai): `<suspended-socmedbpssula>` — diketahui ditangguhkan oleh Google.

---

## Anthropic Token (oat01)

```
<redacted — see secure storage below>
```

Tersimpan di:
- `/opt/openclaw/malika-llm-proxy.config.js` → env `ANTHROPIC_TOKEN`
- `/root/.openclaw/agents/main/agent/auth-profiles.json` → `anthropic:manual`

---

## Operasi Umum

### Cek health proxy LLM
```bash
curl http://127.0.0.1:3031/health
# → {"status":"ok","google":{"total":10,"available":10},"anthropic":{"configured":true}}
```

### Ganti model ke Gemini (rollback)
```bash
# Edit .env
OPENAI_API_URL=https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
OPENAI_API_KEY_CHAT=<your-google-api-key>
OPENAI_MODEL_CHAT=gemini-3-flash-preview
OPENAI_MODEL_REASONING=gemini-3-pro-preview
# ... ganti semua model ke gemini-3-flash-preview
pm2 reload pds-backend --update-env
```

### Ganti model ke Claude (current setup)
```bash
OPENAI_API_URL=http://127.0.0.1:3031/v1/chat/completions
OPENAI_API_KEY_CHAT=malika-internal-proxy
# semua model = claude-sonnet-4-6
pm2 reload pds-backend --update-env
```

### Restart proxy LLM
```bash
pm2 restart malika-llm-proxy
# Pastikan masih jalan:
ss -tlnp | grep 3031
```

### Rebuild frontend/admin setelah code change
```bash
cd /var/www/html/project-data-strategis/frontend && npm run build
cd /var/www/html/project-data-strategis/backend/admin && npm run build
pm2 restart pds-frontend pds-admin
```

### Apply .env baru ke backend
```bash
pm2 reload pds-backend --update-env
```

---

## Struktur Service Chat (backend)

```
src/services/chat/streaming/
├── modelRouter.service.js    ← Pilih tier (GREETING/SIMPLE/COMPLEX/DEEP)
├── pipeline.service.js       ← Orchestrasi utama (RAG + LLM call)
├── orchestrator.service.js   ← Multi-source merge
├── gateAgent.service.js      ← Query intent classifier
├── supervisor.service.js     ← Quality check output
├── prompt.service.js         ← Prompt builder
├── config.js                 ← SMART_CONTEXT, token budget per tier
└── openaiClient.js           ← HTTP fetch ke OPENAI_API_URL
```

Context budget per tier (config.js):
```
greeting: 20K chars
simple:   120K chars (5 docs × 15K)
complex:  200K chars (7 docs × 25K)
deep:     400K chars (10 docs × 80K)
```

---

## Catatan Penting

1. **malika-llm-proxy harus jalan** sebelum pds-backend bisa menjawab (karena OPENAI_API_URL → port 3031)
2. **Jangan restart openclaw-gateway** pakai `openclaw gateway stop` — pakai `kill -9 <pid>` lalu tunggu PM2 restart
3. **socmedbpssula key SUSPENDED** — jangan masukkan ke manapun
4. **Backend reload** selalu pakai `--update-env` agar .env baru terbaca
5. **PM2 ecosystem untuk proxy**: `/opt/openclaw/malika-llm-proxy.config.js` (harus `.config.js`, bukan `.ecosystem.js`)
