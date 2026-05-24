# Spec — Halaman Admin: Status WebAPI BPS

> Tanggal: 2026-05-24
> Author: Wisnu (via brainstorming dengan Claude)
> Status: APPROVED (siap masuk fase writing-plans)

## 1. Konteks & Motivasi

Backend MALIKA memanggil `https://webapi.bps.go.id/v1/api/*` dari ~10 service file (period, pressrelease, rag, publication, exim, bpsMetadata, datasource). Saat ini tidak ada single source of truth untuk admin memeriksa apakah WebAPI BPS sedang sehat:

- `fetch_logs` table mencampur calls ke WebAPI BPS, HTML scrapes `bps.go.id`, dan datasources lain — diskriminator-nya kabur (`source_id`).
- `CircuitBreaker` ada di `utils/circuitBreaker.js` dengan singleton `bpsAPICircuit`, tapi **tidak pernah di-`execute()`** oleh `services/datasource/fetch.service.js` — gap arsitektural; state-nya selalu CLOSED palsu.
- Tidak ada probe aktif terhadap WebAPI BPS. Outage hanya diketahui saat user complaint atau saat fetcher gagal silent.

Spec ini menjawab: tambahkan satu halaman admin yang menampilkan status akses WebAPI BPS, dengan probe terjadwal + log + dashboard ringkas.

## 2. Keputusan Desain (Q&A brainstorming)

| # | Pertanyaan | Pilihan | Konsekuensi |
|---|---|---|---|
| Q1 | Makna "status"? | **C — Hibrid** | Probe terjadwal + dashboard pasif + indikator CircuitBreaker + tombol manual probe |
| Q2 | Endpoint mana yang di-probe? | **B — Per-famili (4 endpoint)** | Probe representatif: `domain`, `var`, `th`, `pressrelease` |
| Q3 | Frekuensi probe? | **B — 15 menit** | ~400/hari panggilan; reaktif tapi hemat quota |
| Q4 | Alerting saat DOWN? | **A — Tidak ada (passive dashboard)** | Tidak push/email; error tetap masuk pino logger by default. Out-of-scope eksplisit. |

## 3. Arsitektur Tingkat Tinggi

```
┌───────────────────────────────────────────────────────────────────────┐
│  ADMIN PANEL (Next.js, port 5050)                                      │
│  /webapi-bps-status   ← halaman baru (sidebar group: Tools)            │
│   ├─ OverallStatusCard (UP/DEGRADED/DOWN, uptime 24h, p95 latency)     │
│   ├─ CircuitBreakerCard (CLOSED/OPEN/HALF_OPEN — read-only)            │
│   ├─ PerFamilyTable (per famili: status, last latency, last error)     │
│   ├─ HistoryChart (failed-count per 1h slot, 24h window, SVG inline)   │
│   ├─ ProbeLogTable (paginated, filterable per famili/status/kind)      │
│   └─ "Probe Sekarang" button → POST /webapi-bps/probe                  │
└───────────────────┬───────────────────────────────────────────────────┘
                    │ axios (lib/axios; CSRF auto-attach; basePath /backend)
                    ▼
┌───────────────────────────────────────────────────────────────────────┐
│  BACKEND (Express, port 5000)                                          │
│  routes/webapiBps.routes.js                                            │
│   ├─ GET  /webapi-bps/status        → snapshot + circuit state         │
│   ├─ GET  /webapi-bps/history       → time-series untuk chart          │
│   ├─ GET  /webapi-bps/logs          → paginated probe log              │
│   └─ POST /webapi-bps/probe         → manual probe (admin only)        │
│                                                                        │
│  services/webapiBpsHealth/                                             │
│   ├─ probeTargets.js         ← 4 sentinel endpoints (konstanta)        │
│   ├─ probe.service.js        ← runProbe(): paralel, klasifikasi, log   │
│   └─ scheduler.service.js    ← startWebapiBpsHealthScheduler()         │
│                                  setInterval 15 menit                  │
│                                                                        │
│  models/WebapiHealthLog.model.js  ← Sequelize model baru               │
│                                                                        │
│  utils/circuitBreaker.js (existing) — probe.service updates            │
│                                       bpsAPICircuit on fail/success    │
└───────────────────┬───────────────────────────────────────────────────┘
                    │ axios + resolveBpsApiKey()
                    ▼
              https://webapi.bps.go.id/v1/api/...
```

**Component boundaries:**
- `probeTargets.js` (pure data) — daftar endpoint sentinel; tidak punya logika
- `probe.service.js` (orchestration) — `runProbe({ trigger })` → `{ overall, perFamily, runId }`; tulis ke DB; tidak tahu HTTP/Express
- `scheduler.service.js` (timing) — `setInterval` + call `runProbe({ trigger:'scheduled' })`; bisa di-stop untuk testing
- `webapiBps.routes.js` (HTTP) — tipis; delegate ke service; tidak tahu sequelize/axios langsung

## 4. Data Model

### 4.1 Tabel baru: `webapi_health_logs`

```sql
CREATE TABLE webapi_health_logs (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT,
  run_id          CHAR(26) NOT NULL,              -- ULID, groups rows dari 1 probe run
  probe_kind      ENUM('scheduled','manual','recovery') NOT NULL,
  endpoint_family VARCHAR(32) NOT NULL,           -- 'domain','var','th','pressrelease'
  url_template    VARCHAR(255) NOT NULL,          -- URL tanpa api key (di-redact)
  http_status     SMALLINT NULL,                  -- NULL kalau timeout/network err
  latency_ms      INT NULL,                       -- NULL kalau gagal sebelum response
  ok              TINYINT(1) NOT NULL,            -- 1 = sukses (2xx & JSON valid)
  error_code      VARCHAR(64) NULL,               -- 'TIMEOUT','HTML_RESPONSE','NETWORK',...
  error_message   VARCHAR(500) NULL,
  bytes_received  INT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_created (created_at),
  INDEX idx_family_created (endpoint_family, created_at),
  INDEX idx_run (run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 4.2 Keputusan kunci & alasan

| Keputusan | Alasan |
|---|---|
| Tabel terpisah, bukan reuse `fetch_logs` | `fetch_logs` memiliki `source_id` (FK semantik ke `data_sources`), tidak cocok untuk probe lintas-famili. Filter "WebAPI BPS only" jadi kabur. |
| `run_id` ULID, bukan int auto-inc | Probe = 4 row insert sekaligus; `run_id` mengelompokkan agar dashboard render "satu run = satu warna" dan debugging mudah. ULID karena lexicographic-sortable. |
| `probe_kind` enum | Dashboard bisa filter "exclude manual" agar uptime chart tidak ter-skew oleh probe manual yang banyak. `recovery` reserved untuk fase berikutnya (CircuitBreaker integration). |
| `url_template` (api key redacted) | Tidak menyimpan secret di DB; mengurangi blast radius. Contoh: `list/model/domain/{domain}/key/<REDACTED>`. |
| `error_code` enum-like string | Discriminator yang berguna untuk root-cause: `HTML_RESPONSE` (Cloudflare WAF) ≠ `HTTP_503` (BPS down). Mirror taxonomy yang sudah ada di `datasource/fetch.service.js:25`. |
| `latency_ms` NULL-able | Jangan paksa 0 saat timeout — itu skew chart. |
| `bytes_received` | Sanity-check ringan: status 200 + body 12 bytes = curiga (probably error JSON). |

### 4.3 Retention

Tambah row di `jobs/retention.job.js` POLICIES:
```js
{ table: 'webapi_health_logs', days: 90, column: 'created_at' }
```

Estimasi storage: 4 probe × 96 scheduled/hari × 90 hari ≈ 35k rows. ~5 MB. Negligible.

## 5. Probe Procedure (the "rangkaian")

### 5.1 Sentinel endpoints (default)

| # | Family | Template | Service yang akan untung kalau probe ini sehat |
|---|---|---|---|
| 1 | `domain` | `GET /v1/api/list/model/domain/lang/ind/key/<KEY>/` | Semua (membuktikan api key valid + reachable) |
| 2 | `var` | `GET /v1/api/list/model/var/lang/ind/domain/{DOMAIN_ID}/key/<KEY>/page/1` | `bpsMetadata/extractors/dynamic.extractor.js` |
| 3 | `th` | `GET /v1/api/list/model/th/lang/ind/domain/{DOMAIN_ID}/var/{VAR_ID}/key/<KEY>/` | `services/period/fetchAvailable.service.js` |
| 4 | `pressrelease` | `GET /v1/api/list/model/pressrelease/lang/ind/domain/{DOMAIN_ID}/key/<KEY>/page/1` | `services/rag/brsFetcher.service.js` |

Konstanta:
- `DEFAULT_DOMAIN_ID = '8200'` (BPS Maluku Utara, sesuai instansi `bpsmalut.com`)
- `STABLE_VAR_ID = '???'` — **TODO(Wisnu, saat implementasi):** pilih variabel yang Anda yakin stabil di domain 8200 (contoh kandidat: `13` Penduduk). Saya tidak isi karena salah pilih = false positive setiap 15 menit.

### 5.2 Algoritma `runProbe({ trigger })`

```
1. const runId = ULID()
2. apiKey = resolveBpsApiKey()
   if (!apiKey) return { overall:'UNKNOWN', error:'API_KEY_MISSING', perFamily:[] }
3. Untuk setiap target di PROBE_TARGETS (PARALEL via Promise.allSettled):
   a. startedAt = Date.now()
   b. axios.get(url, {
        timeout: 8000,
        validateStatus: () => true,    // status code = data, bukan exception
        headers: { /* sama persis dengan datasource/fetch.service.js (UA realistis) */ }
      })
   c. Klasifikasi:
      - response.data dimulai '<'  → ok=0, error_code='HTML_RESPONSE'  (WAF block)
      - status === 401 || 403      → ok=0, error_code='AUTH_INVALID'
      - status === 429             → ok=0, error_code='RATE_LIMITED'
      - status >= 500              → ok=0, error_code='HTTP_5XX'
      - status >= 400              → ok=0, error_code='HTTP_4XX'
      - status 2xx + JSON valid    → ok=1
      - exception ECONNABORTED     → ok=0, error_code='TIMEOUT'
      - exception lain             → ok=0, error_code='NETWORK'
   d. INSERT row ke webapi_health_logs (run_id, family, url_template, http_status, latency_ms, ok, error_code, error_message, bytes_received)
4. Hitung overall:
   - okCount == total          → 'UP'
   - 1 <= okCount < total      → 'DEGRADED'
   - okCount == 0              → 'DOWN'
5. Return { runId, overall, perFamily:[{family, ok, latencyMs, httpStatus, errorCode}], durationMs }
```

### 5.3 Concurrency guard

```js
let probeMutex = false
async function runProbe({ trigger }) {
  if (probeMutex) return { skipped: true, reason: 'probe_already_running' }
  probeMutex = true
  try { /* actual probe */ } finally { probeMutex = false }
}
```

Asumsi 1 instance PM2 (sesuai `docs/workspace/infra.md`). Kalau project pindah ke cluster mode kelak, perlu DB-level lock — di luar scope MVP.

### 5.4 Mengapa paralel & bukan sequential

Total durasi ≤ 8 dtk (timeout terbesar) vs ≤ 32 dtk sequential. Sequential bisa overlap dengan probe-15-menit berikutnya, dan tidak ada alasan teknis: BPS WebAPI handle concurrent 4 request dari 1 client tanpa masalah.

### 5.5 Mengapa `validateStatus: () => true`

Default axios throw kalau status ≥ 400. Untuk probe kita ingin tahu status 401/429/503 — itu data berharga, bukan exception. Dengan flag ini, catch block hanya untuk error transport (DNS, TCP, TLS, timeout).

## 6. Backend API Endpoints

Semua di-mount di `routes/webapiBps.routes.js`, di-protect `authMiddleware + requireAdmin` (pola sama dengan `logs.routes.js`).

### 6.1 `GET /webapi-bps/status`

Snapshot live. Cache 30 dtk in-memory (dashboard polling-friendly).

```json
{
  "overall": "UP",
  "lastProbeAt": "2026-05-24T03:45:12.000Z",
  "lastProbeRunId": "01HXYZ...",
  "uptime24h": 0.9931,
  "p50LatencyMs24h": 287,
  "p95LatencyMs24h": 1240,
  "totalProbes24h": 96,
  "failedProbes24h": 4,
  "perFamily": [
    { "family":"domain",       "lastOk":true,  "lastLatencyMs":312, "lastErrorCode":null,      "lastCheckedAt":"..." },
    { "family":"var",          "lastOk":true,  "lastLatencyMs":198, "lastErrorCode":null,      "lastCheckedAt":"..." },
    { "family":"th",           "lastOk":false, "lastLatencyMs":null,"lastErrorCode":"TIMEOUT", "lastCheckedAt":"..." },
    { "family":"pressrelease", "lastOk":true,  "lastLatencyMs":423, "lastErrorCode":null,      "lastCheckedAt":"..." }
  ],
  "circuit": {
    "state": "CLOSED",
    "failureCount": 0,
    "lastFailureAt": null,
    "nextAttemptAt": null
  },
  "apiKeyPresent": true
}
```

24h stats di-derive lewat single SQL aggregate (filter `probe_kind='scheduled'` agar tidak ter-skew probe manual).

### 6.2 `GET /webapi-bps/history?hours=24&bucket=1h`

Time-series untuk chart. Cache 60 dtk.

Param: `hours` (default 24, max 168 = 7d), `bucket` (`5m`|`15m`|`1h`, default `1h`).

```json
{
  "bucket": "1h",
  "buckets": [
    { "t":"2026-05-23T04:00:00.000Z", "probes":4, "failed":0, "p95LatencyMs":290 },
    { "t":"2026-05-23T05:00:00.000Z", "probes":4, "failed":1, "p95LatencyMs":1820 }
  ]
}
```

Group-by server-side via `DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00')` (MariaDB 11.8 native).

### 6.3 `GET /webapi-bps/logs?limit=100&offset=0&family=...&status=...&kind=...&runId=...`

Paginated. No cache. Filter `family` / `status` (ok|error) / `kind` (scheduled|manual|recovery) / `runId`.

Response shape mirror `logs.routes.js` pattern.

### 6.4 `POST /webapi-bps/probe`

Manual probe trigger.

**Success:**
```json
{
  "runId": "01HXYZ...",
  "overall": "UP",
  "durationMs": 1430,
  "perFamily": [...]
}
```

**Skipped (mutex):** HTTP 409 + `{ "skipped":true, "reason":"probe_already_running" }`.

**Rate-limited:** HTTP 429 + `Retry-After` header. Max 6 manual probe/menit per admin (in-memory map).

**Audit:** tulis ke `admin_audit_logs` dengan `action='webapi_bps_probe_manual'` + user id. Sejalan dengan `audit-logs` page existing.

## 7. Frontend Page

### 7.1 Struktur file

```
backend/admin/app/webapi-bps-status/
├── page.tsx                     # entry: RequireAuth, orchestrate sections
├── _components/
│   ├── OverallStatusCard.tsx
│   ├── CircuitBreakerCard.tsx
│   ├── PerFamilyTable.tsx
│   ├── HistoryChart.tsx         # SVG inline, no extra dep
│   ├── ProbeLogTable.tsx        # uses <DataTable> + <OffsetPagination>
│   └── ProbeNowButton.tsx       # handles 409/429
└── types.ts                     # StatusResponse, HistoryBucket, ProbeLog
```

`_components/` underscore = private folder di Next.js App Router (tidak di-route). Konsisten dengan `app/(admin)/data/_components/` di frontend.

### 7.2 Layout

```
┌────────────────────────────────────────────────────────────┐
│ Activity icon + h1 "Status WebAPI BPS"                     │
│                          [Refresh] [Probe Sekarang]        │
├──────────────────────────┬─────────────────────────────────┤
│ OverallStatusCard        │ CircuitBreakerCard              │
├──────────────────────────┴─────────────────────────────────┤
│ HistoryChart (24h x 1h, failed-count bars)                 │
├────────────────────────────────────────────────────────────┤
│ PerFamilyTable (4 row: domain, var, th, pressrelease)      │
├────────────────────────────────────────────────────────────┤
│ ProbeLogTable (filter bar + paginated table)               │
└────────────────────────────────────────────────────────────┘
```

### 7.3 Data fetching (React Query)

```ts
const status  = useQuery({ queryKey:['webapi-bps','status'],
                           queryFn: () => api.get('/webapi-bps/status').then(r=>r.data),
                           refetchInterval: 30_000, staleTime: 25_000 });

const history = useQuery({ queryKey:['webapi-bps','history',24,'1h'],
                           queryFn: () => api.get('/webapi-bps/history?hours=24&bucket=1h').then(r=>r.data),
                           refetchInterval: 60_000 });

const logs    = useQuery({ queryKey:['webapi-bps','logs', filters, offset],
                           queryFn: () => api.get(`/webapi-bps/logs?${qs}`).then(r=>r.data),
                           staleTime: 0, keepPreviousData: true });

const probeMutation = useMutation({
  mutationFn: () => api.post('/webapi-bps/probe'),
  onSuccess: () => { invalidate(['webapi-bps','status']);
                     invalidate(['webapi-bps','history']);
                     invalidate(['webapi-bps','logs']); },
  onError: (e) => {
    if (isHttpError(e, 409)) toast('Probe sedang berjalan, tunggu sebentar');
    else if (isHttpError(e, 429)) toast('Terlalu banyak probe manual, coba 1 menit lagi');
    else toast(getErrorMessage(e, 'Probe gagal'));
  }
});
```

3 query terpisah karena refetch cadence beda; filter logs tidak invalidate status.

### 7.4 Reuse (admin shared utilities)

| Existing | Untuk |
|---|---|
| `RequireAuth` | Auth gate |
| `StatCard` | Sub-stat di OverallStatusCard |
| `DataTable<T>` + `Column<T>` | ProbeLogTable |
| `OffsetPagination` + `useOffsetPagination` | Paginate logs |
| `AsyncStateMessages` | Banner error/success |
| `lib/formatters` | `formatDateTime`, `formatPercent` (uptime), `formatNumber`, `truncate` |
| `lib/errors` | `getErrorMessage`, `isHttpError` (409/429 branching) |
| `lib/axios` | api client (CSRF + 401 redirect) |
| `lucide-react` | `Activity`, `CheckCircle`, `XCircle`, `Zap`, `Filter`, `RefreshCw` |

### 7.5 `HistoryChart` — SVG inline (no extra dep)

24 bar dalam container fixed-height 80px. Tinggi = `failed/probes`. Warna: hijau (0), kuning (≤25%), merah (>25%). Hover tooltip dengan timestamp + count. ~60 baris React, zero deps tambahan. (Jika `recharts` ternyata sudah ada di `package.json`, pakai itu.)

### 7.6 Sidebar entry

Tambah link di `components/Sidebar.tsx` group **Tools** (sejajar dengan `/fetch-logs`, `/audit-logs`, `/intent-stats`).

## 8. Error Handling

### 8.1 Per-layer

| Layer | Failure | Behavior |
|---|---|---|
| probe.service | axios throw (DNS/TCP/timeout) | catch + klasifikasi → `error_code`. Tidak re-throw — `runProbe()` selalu return result. |
| probe.service | INSERT log fail (DB down) | `logger.error()`; return result tanpa persistence. Dashboard show stale, bukan 500. |
| probe.service | `resolveBpsApiKey()` null | skip probes; return `{ overall:'UNKNOWN', error:'API_KEY_MISSING' }`. Dashboard render banner config. |
| scheduler.service | runProbe throw (defense) | log + next interval tetap jalan. Scheduler tidak boleh mati. |
| scheduler.service | server restart | **defer first probe by interval**; tidak run on startup. Mencegah probe storm saat PM2 restart-loop. |
| route POST /probe | mutex busy | HTTP 409 + `{ skipped:true, reason }`. Bukan 500. |
| route POST /probe | rate-limited | HTTP 429 + Retry-After. |
| route GET /status | DB fail | HTTP 500. Frontend banner. **Tidak** fall back ke "fake UP". |
| frontend | /status fail | React Query auto-retry 3x; banner + skeleton + "Data tidak tersedia". |
| frontend | /probe 409 | Toast "Probe sedang berjalan"; button stays enabled. |
| frontend | /probe 429 | Toast + disable button 30 dtk. |

Prinsip: probe service di-isolasi dari error apapun — reliability-critical loop. Failure mode = "tetap nyala, log, biar admin tahu via dashboard".

## 9. Testing

### 9.1 Backend (vitest existing)

| Test | Cover |
|---|---|
| `__tests__/webapiBpsHealth.probe.test.js` | klasifikasi 6 case (2xx ok, 5xx, 401, HTML, timeout, network) — mock axios |
| `__tests__/webapiBpsHealth.probe.mutex.test.js` | concurrent `runProbe()` → 2nd `skipped:true` (vi.useFakeTimers + slow mock) |
| `__tests__/webapiBpsHealth.probe.apikey.test.js` | api key null → `UNKNOWN` tanpa hit axios |
| `__tests__/webapiBps.routes.test.js` | 4 route happy path + auth (401 tanpa token); mock probe.service |

### 9.2 Frontend (vitest + RTL existing)

| Test | Cover |
|---|---|
| `OverallStatusCard.test.tsx` | render UP/DEGRADED/DOWN/UNKNOWN visual states |
| `HistoryChart.test.tsx` | render 24 bar, color thresholds, hover tooltip |
| `ProbeNowButton.test.tsx` | 409→toast, 429→toast+disable, success→invalidate |
| `webapi-bps-status.page.test.tsx` | integration: mock React Query, 3 query URL benar |

### 9.3 Yang TIDAK di-test (intentional)

- E2E ke real `webapi.bps.go.id` — flaky, butuh real key, sayang quota.
- `setInterval` scheduler — trivial wrapper, tidak ada logic.

## 10. Out-of-Scope (Eksplisit)

| Item | Alasan | Revisit kapan |
|---|---|---|
| Push notification on DOWN | Q4=A (passive only); decision admin policy | Kalau admin sering miss outage |
| Integrasi `bpsAPICircuit` ke ~10 fetcher service | PR besar, resiko regresi. Dashboard menampilkan circuit state read-only. | Phase 2 — spec terpisah |
| Multi-domain probe | YAGNI; instansi ini 1 domain (8200) | Kalau project ekspansi |
| Slack/email alert | Tidak ada infra | Saat user request |
| Historical comparison (week-over-week) | YAGNI di MVP | Setelah data ≥1 bulan |
| Export CSV log | Tidak ada use case kongkret | Saat user request |
| Auto-rotate `STABLE_VAR_ID` | Edge case sangat jarang; admin update manual | Tidak pernah, kemungkinan besar |

## 11. Implementation Order

(Detail step-by-step → masuk ke writing-plans next.)

1. DB DDL → `docs/runbook/2026-05-24-webapi-health-logs-ddl.sql`
2. Sequelize model `WebapiHealthLog.model.js`
3. `services/webapiBpsHealth/probeTargets.js` (← Wisnu isi `STABLE_VAR_ID`)
4. `services/webapiBpsHealth/probe.service.js` + tests
5. `services/webapiBpsHealth/scheduler.service.js` + register di `server.js:155-165`
6. `routes/webapiBps.routes.js` + mount + tests
7. Tambah row `webapi_health_logs` ke `jobs/retention.job.js` POLICIES
8. Frontend types
9. Frontend `_components/` (kecil → besar)
10. Frontend `page.tsx` + integration test
11. Sidebar entry (`components/Sidebar.tsx`)
12. Docs update: `docs/workspace/admin.md` (page count 27→28) + `docs/workspace/backend.md`

Setiap step independen dan testable terpisah → subagent-friendly nanti.

## 12. Done Criteria

- Tabel `webapi_health_logs` ada, retention 90 hari aktif.
- Scheduler hidup di `server.js` startup; probe terjadwal tiap 15 menit.
- Manual probe via tombol bekerja; 409/429 di-handle benar di UI.
- Halaman `/webapi-bps-status` render dengan 5 section (overall, circuit, history, family, logs).
- 4 endpoint REST hidup; semua auth-gated.
- Unit + integration tests pass.
- `STABLE_VAR_ID` di-isi nilai nyata oleh Wisnu (bukan `???`) — probe famili `th` sukses pada smoke test.
- Sidebar punya entry baru; `admin.md` page count diperbarui.

## 13. Risk Register

| Risk | Likelihood | Mitigation |
|---|---|---|
| `STABLE_VAR_ID` salah pilih → probe `th` selalu gagal | Medium | Wisnu yang isi (domain knowledge); smoke test sebelum merge |
| BPS WebAPI rate-limit kita kalau probe terlalu sering | Low (15min interval ringan) | Bisa tune interval via env var kalau perlu |
| `webapi_health_logs` membengkak | Low (~35k rows/90d) | Retention sudah di-policy |
| PM2 restart loop → probe storm | Low | Defer first probe by interval; tidak run on startup |
| `bpsAPICircuit` state tidak konsisten karena fetcher lain belum pakai `.execute()` | High (memang gap existing) | Spec ini eksplisit out-of-scope; dashboard tampilkan state apa adanya |
