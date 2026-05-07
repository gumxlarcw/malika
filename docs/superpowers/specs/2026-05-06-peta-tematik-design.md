# Peta Tematik di Dashboard Admin — Design Spec

> **Tanggal**: 2026-05-06
> **Author**: brainstorming session (Wisnu × Claude)
> **Status**: Draft, menunggu review user
> **Branch target**: `feat/peta-tematik` (akan dibuat saat plan mulai dieksekusi)

---

## 1. Tujuan

Menambahkan **section "Peta Tematik"** di bawah page `/dashboard` admin (Next.js, port 5050).
User admin pilih satu indikator dari daftar searchable + filter waktu, dan peta choropleth
Maluku Utara berwarna sesuai nilai per kabupaten/kota. Section dilengkapi panel info
(nilai provinsi, top/bottom 3, sparkline trend) dan tombol export PNG.

Solusi ini **menggantikan** page `/metabase` existing yang non-fungsional (server Metabase
upstream tidak ada). Tidak menambahkan dependency Docker / external server. Murni di stack
yang sudah ada: Express backend + Next.js admin + Leaflet + MySQL.

## 2. Konteks & Constraint

- **Stack existing**: backend Express :5000, admin Next.js :5050, MySQL `data_bps` (replica BPS, 311 tabel `indikator_*`) dan `project_data_strategis` (DB aplikasi).
- **GeoJSON sudah tersedia**: `backend/public/geojson/peta_kabko_malut.geojson` — 10 polygon kab/kota Malut, properti `kdkab` & `nama_kab`, CRS84.
- **Leaflet 1.9.4 sudah terinstall** di admin. Belum ada wrapper React.
- **Sistem chart project**: `CHART_CONFIG_SYSTEM.md` ada tapi untuk chat/visualisasi data lain — tidak digunakan di section ini (tidak relevan untuk choropleth).
- **Audience**: admin internal BPS Maluku Utara. Familiar dengan struktur indikator BPS.
- **Bukan public-facing**: section di belakang `<RequireAuth>`, sama dengan dashboard utama.

## 3. Audit Indikator (sumber data)

Hasil scan komprehensif 311 tabel `data_bps.indikator_*` (TSV: `tmp/indikator_audit.tsv`):

| Kategori | Jumlah |
|---|---:|
| ✅ ELIGIBLE — punya breakdown 10 kab/kota Malut | **204** |
| ❌ NOT-eligible (provinsi-only / multidim non-geografis) | 107 |

**Kriteria eligible**: tabel mengandung `dim_value` yang match ke salah satu dari 10 nama
kab/kota Malut (varian dengan/tanpa prefix "Kabupaten "/"Kota " dideteksi).

**Distribusi NOT-eligible**:
- 35 tabel `dim_key='Wilayah'` tapi value-nya **bukan wilayah** (kelompok umur, status pekerjaan, kategori usaha) — pelajaran: validasi value, bukan nama field.
- 23 tabel `dim_key=''` (kosong) → provinsi-level only.
- 6 `Propinsi` → provinsi-level.
- Sisanya non-geografis (Lapangan Usaha, Komponen Pengeluaran PDRB, EXIM multidim, IDI, dll).

**Karakteristik ELIGIBLE**:
- Hanya 1 dari 204 yang multi-dim: `indikator_418` (Pelanggan Listrik, sub-dim "Unit Layanan Pelanggan") → **excluded di MVP**, jadi 203 indikator yang dipakai.
- Time coverage: 41 indikator ke 2025, 78 ke 2024, 45 ke 2023.
- Time-series length: rata-rata 5–10 tahun per indikator.

**Edge case yang sudah diputuskan**:
- `dim_value='Maluku Utara'` (provinsi total) → **exclude** dari pewarnaan polygon, tampilkan sebagai pembanding di InfoPanel.
- `year=0` anomali → filter `WHERE year > 0`.
- Format wilayah `dim_value` ≠ `nama_kab` GeoJSON → normalize: strip "Kabupaten "/"Kota ", lowercase, lookup ke `kdkab`.
- Multi-metric: kalau >1 metric unik, frontend tampilkan dropdown. Kalau 1, hidden + auto.
- `indikator_418` skip di MVP. Indikator EXIM (159, 160) skip di MVP.

## 4. Keputusan Arsitektur

| Keputusan | Alasan |
|---|---|
| **Opsi B**: peta + InfoPanel + export PNG (bukan A polos / C komprehensif) | A telanjang tanpa konteks pembanding. C banyak fitur belum tentu dibutuhkan (drill-down, embed iframe = pattern Metabase yang baru ditinggalkan). B punya value/effort terbaik untuk fitur "section di bawah dashboard". |
| **Opsi C kategorisasi**: 203 indikator semua + grouping otomatis dari `source_name` keyword match (7 kategori + "Lainnya") | Allowlist manual = perangkap maintenance (indikator baru BPS tidak muncul). Auto-include + soft grouping = self-healing. |
| **Filter waktu adaptive** | Kalau indikator hanya tahunan (`month_no=0`), tampilkan filter Tahun saja. Kalau bulanan (`month_no=1–12`), tampilkan Tahun + Bulan. |
| **Pure function untuk kategorisasi & region map**, bukan tabel DB | Revisi via PR (history di git), mudah di-test, no migration. Trade-off: tiap perubahan butuh deploy backend — acceptable karena change frequency rendah. |
| **In-memory LRU cache** dengan TTL 1 jam, bukan reuse `data_merged_cache` | `data_merged_cache` semantically beda (untuk cache merge antar source). Dataset peta tematik kecil (~1MB total semua kombinasi). |
| **Quantile classification** (5 bin), bukan Jenks | 10 kab/kota → quantile garansi 2/bin → distribusi visual seimbang, outlier kebagian bin sendiri. Jenks bisa hasilkan bin kosong di Malut. |
| **react-leaflet v4**, bukan Leaflet imperative | Project pakai React 19.2.1 + Leaflet 1.9.4 → match. Lifecycle React-friendly, event handler via props. |
| **Inline SVG sparkline**, bukan recharts/chart.js | Recharts ~93KB untuk satu sparkline = tidak proporsional. Konsistensi dengan section lain di `/dashboard` yang belum pakai chart lib. |
| **html2canvas client-side** untuk export PNG | Tidak butuh server-side rendering / Puppeteer. Cukup untuk MVP. |
| **Boot-time eligibility scanner** + 1-jam refresh, bukan on-demand | Tabel `data_bps` bisa berubah (sync dari BPS). Self-healing terhadap perubahan upstream. Boot async setelah `process.send('ready')` supaya tidak delay PM2 startup (yang sudah 20–45s). |
| **Lazy-render section via IntersectionObserver** | Dashboard atas tetap snappy. Peta + Leaflet bundle hanya load saat scrolled into view. |

## 5. Backend Design

### 5.1 Struktur file (NEW)

```
backend/src/routes/peta-tematik.routes.js
backend/src/services/petaTematik.service.js          ← orchestrator + DB query
backend/src/services/petaTematik.categorization.js   ← pure fn: source_name → kategori
backend/src/services/petaTematik.regionMap.js        ← pure fn: dim_value → kdkab
backend/src/services/petaTematik.cache.js            ← lru-cache wrapper, TTL 1 jam
backend/src/services/petaTematik.eligibilityScanner.js  ← boot-time scan 311 tabel
```

### 5.2 Endpoint

| Method | Path | Cache TTL | Tujuan |
|---|---|---|---|
| GET | `/peta-tematik/indikator-list` | 1 jam | List 203 indikator dikelompokkan per 7 kategori (+ "Lainnya"). Hasil dari boot-time scanner. |
| GET | `/peta-tematik/years?indikator=X` | 1 jam | `{ years: [2018..2024], has_monthly: bool }` untuk filter UI adaptive. |
| GET | `/peta-tematik/metrics?indikator=X` | 1 jam | List metric unik (kalau >1, frontend tampilkan dropdown ke-3). |
| GET | `/peta-tematik/data?indikator=X&year=Y&month=Z?&metric=M?` | 1 jam | `[{ kdkab, nama_kab, value }]` untuk 10 polygon. Kab/kota tanpa data → `value: null`. |
| GET | `/peta-tematik/summary?indikator=X&year=Y&month=Z?&metric=M?` | 1 jam | `{ provinsi_total, top3, bottom3, trend: [{ year, provinsi_total }] }` untuk InfoPanel. |

**Pemisahan `data` vs `summary`**: fast-path / slow-path. Peta render duluan dari `data`,
panel info menyusul dari `summary`. Kalau `summary` error, peta tetap kelihatan.

### 5.3 Boot-time eligibility scanner

```
process.send('ready')   // PM2 mark online
↓ (async, non-blocking)
1. SELECT TABLE_NAME FROM information_schema.TABLES
   WHERE TABLE_SCHEMA='data_bps' AND TABLE_NAME LIKE 'indikator_%'
2. Untuk tiap tabel, query agregat:
   SELECT MAX(source_id), MAX(source_name),
          SUM(CASE WHEN dim_value IN (10 nama) THEN 1 ELSE 0 END) AS region_rows
3. Filter region_rows > 0 → ELIGIBLE
4. Apply categorization → group per kategori
5. Cache hasil dengan key `ind:list`, TTL 1 jam (refresh otomatis)
```

Estimasi: ~500ms first run untuk 311 tabel sequential. Tidak perlu paralel karena boot
sudah selesai sebelum scanner mulai.

### 5.4 Kategorisasi (pure function)

7 kategori + fallback "Lainnya". Rule = array of `{ kategori, keywords[] }`. Keyword
match via `source_name.toLowerCase().includes(kw)` — first-match wins. Detail kategori
& keyword di Section 1.4 conversation log; akan di-encode di
`petaTematik.categorization.js`.

### 5.5 Region normalization (pure function)

```
dim_value: "Halmahera Barat"           → kdkab: "01"
dim_value: "Kota Ternate"              → kdkab: "71"
dim_value: "Kabupaten Halmahera Barat" → kdkab: "01"
dim_value: "Maluku Utara"              → null (skip dari pewarnaan)
dim_value: "garbage"                   → null
```

10-entry static map. Hardcoded berdasarkan kode kab/kota BPS Malut (01-08, 71, 72).

### 5.6 Query template untuk `data`

```sql
SELECT dim_value AS dim_value,
       AVG(value) AS value
FROM data_bps.`indikator_${ID}`
WHERE year = ?
  AND year > 0
  AND (? IS NULL OR month_no = ?)
  AND (? IS NULL OR metric = ?)
  AND dim_value IN (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
GROUP BY dim_value;
```

**Security**: `${ID}` adalah indikator number — divalidasi sebagai `Number.isInteger(id) && id > 0`
+ whitelist check terhadap list ELIGIBLE yang di-cache. Reject 400 kalau tidak match.

**`AVG`**: default agregasi multi-row (mis. data bulanan tapi user pilih year saja).
Bisa di-override per indikator di config kalau `SUM` lebih pas (mis. jumlah perceraian).
**MVP**: `AVG` saja. Override = future enhancement.

### 5.7 Caching

`lru-cache` ^10.x. Keys:
```
ind:list                                    → indikator-list
ind:{indikator}:years                       → years metadata
ind:{indikator}:metrics                     → metrics metadata
data:{indikator}:{y}:{m||0}:{metric||*}     → data per filter
summary:{indikator}:{y}:{m||0}:{metric||*}  → summary per filter
```

TTL 1 jam. Invalidation otomatis via TTL — entry expire & re-fetch on next request.
Tidak ada hook ke automation system di MVP (deferred). Max size 500 entry → ~5MB total
upper bound (acceptable di backend yang 2GB heap).

## 6. Frontend Design

### 6.1 Struktur file (NEW)

```
backend/admin/components/peta-tematik/
├── PetaTematikSection.tsx      ← top-level wrapper, owns filter state
├── FilterBar.tsx               ← container untuk picker + selects
├── IndikatorPicker.tsx         ← cmdk-based searchable grouped dropdown
├── ChoroplethMap.tsx           ← react-leaflet container + GeoJSON layer
├── MapLegend.tsx               ← 5-bin scale di pojok peta
├── InfoPanel.tsx               ← wrapper untuk komponen panel
├── TopBottomList.tsx           ← list top 3 / bottom 3
├── TrendSparkline.tsx          ← inline SVG mini chart
├── ExportButton.tsx            ← html2canvas → PNG
├── api.ts                      ← fetch wrappers (axios + react-query keys)
├── colorScale.ts               ← quantile binning + color lookup
└── types.ts                    ← TypeScript interfaces
```

### 6.2 Component tree

```
<PetaTematikSection />                     state: { indikator, year, month, metric }
├── <SectionHeader />                      title + <ExportButton />
├── <FilterBar />
│   ├── <IndikatorPicker />                searchable, grouped 7 kategori
│   ├── <YearSelect />                     dari /years
│   ├── <MonthSelect />                    hanya kalau has_monthly
│   └── <MetricSelect />                   hanya kalau metrics.length > 1
├── <MapAndPanel />                        grid (peta 2/3 + panel 1/3)
│   ├── <ChoroplethMap />
│   │   ├── GeoJSON layer (10 polygon)
│   │   ├── <MapLegend />
│   │   └── Tooltip on hover (Leaflet built-in)
│   └── <InfoPanel />
│       ├── <ProvinsiTotalCard />
│       ├── <TopBottomList />
│       └── <TrendSparkline />
└── <LoadingOverlay />                     conditional, saat fetch
```

### 6.3 Library additions

| Lib | Versi | Alasan |
|---|---|---|
| `react-leaflet` | `^4.2.1` | Wrapper React untuk Leaflet (sudah ada). |
| `html2canvas` | `^1.4.1` | Export PNG client-side. |
| `cmdk` | `^1.0.0` | Searchable dropdown grouped. |
| `lru-cache` (backend) | `^10.x` | Cache layer (cek dulu kalau sudah ada di backend). |

### 6.4 State management

React Query (sudah ada, `staleTime: 30s`):

```typescript
useQuery(['peta', 'indikator-list'])                                    // once on mount
useQuery(['peta', 'years', indikator],   { enabled: !!indikator })
useQuery(['peta', 'metrics', indikator], { enabled: !!indikator })
useQuery(['peta', 'data', indikator, year, month, metric],
                                          { enabled: !!indikator && !!year })
useQuery(['peta', 'summary', indikator, year, month, metric],
                                          { enabled: !!indikator && !!year })
```

Filter state lokal di `<PetaTematikSection />` (`useState`), bukan global Zustand.

### 6.5 Filter behavior (adaptive)

```
1. user pilih indikator
2. fetch /years + /metrics paralel (react-query)
3. /years → { years: [...], has_monthly: bool }
   - tampilkan/sembunyikan MonthSelect
   - default month = max month tahun terbaru (kalau monthly)
4. /metrics → list
   - kalau >1: tampilkan MetricSelect, default = first
   - kalau ==1: hide, auto-set
5. fetch /data + /summary paralel
6. peta render dengan data
```

Default initial:
- `indikator`: indikator pertama di kategori "Kependudukan" (familiar). Fallback: kategori pertama yang non-empty kalau "Kependudukan" kosong.
- `year`: tahun terbaru tersedia (`max(years)`).
- `month`: bulan terbaru di tahun terbaru (`max(month_no WHERE year = max_year)`) kalau monthly.
- `metric`: pilih `value` kalau ada di list, kalau tidak ambil metric pertama secara alfabet.

### 6.6 Choropleth styling

**5-bin sequential blue** (Tailwind palette):

| Bin | Hex | Tailwind |
|---|---|---|
| 0 (terendah) | `#DBEAFE` | `bg-blue-100` |
| 1 | `#93C5FD` | `bg-blue-300` |
| 2 | `#3B82F6` | `bg-blue-500` |
| 3 | `#1D4ED8` | `bg-blue-700` |
| 4 (tertinggi) | `#1E3A8A` | `bg-blue-900` |
| no data | `#D1D5DB` | `bg-gray-300` (opacity 0.5) |

**Quantile classification**: 5 bin × 2 kab/kota tiap bin (untuk 10 polygon).

**Polygon style**:
- default: `fillColor` dari bin, `weight: 1`, `color: white` (border), `fillOpacity: 0.7`
- hover: `weight: 2.5`, `color: '#1e40af'`, `fillOpacity: 0.9`

### 6.7 Tooltip

```
┌──────────────────────────┐
│ Halmahera Barat          │
│ ─────────────────        │
│ Nilai:    80.71          │
│ vs 2023:  ▲ +1.71 (2.2%) │
└──────────────────────────┘
```

- Header: `nama_kab`
- `value` formatted via `Intl.NumberFormat('id-ID')`
- Δ vs prev year (▲ hijau / ▼ merah) — kalau available
- Kalau no data: "Data tidak tersedia"

### 6.8 InfoPanel (kanan peta)

Tiga sub-komponen:
1. **ProvinsiTotalCard**: nilai Maluku Utara untuk year terpilih (dari row `dim_value='Maluku Utara'` jika ada, atau `AVG(10 kab/kota)`).
2. **TopBottomList**: 3 tertinggi + 3 terendah, dengan nama + nilai.
3. **TrendSparkline**: nilai provinsi 5 tahun terakhir (inline SVG, ~30 baris).

### 6.9 Empty / error states

| State | Tampilan |
|---|---|
| Loading awal | Skeleton (pattern existing `<Skeleton />` di /dashboard) |
| Loading saat ganti filter | Overlay spinner di atas peta lama (peta tidak hilang) |
| No data | Placeholder: "Tidak ada data untuk indikator + tahun ini." + tombol reset |
| Sebagian kab/kota null | Polygon abu-abu, tooltip "Data tidak tersedia". Tetap render. |
| Backend error | `<Alert variant="error">` + tombol "Coba lagi" |
| GeoJSON gagal load | Fallback ke list view (table 10 baris kab/kota dengan nilai) |

### 6.10 Lazy-render section

`<PetaTematikSection />` di-mount tapi:
- Render skeleton dulu (placeholder)
- `IntersectionObserver` watch wrapper div
- Saat `isIntersecting`: trigger react-query fetch + dynamic import Leaflet bundle

Hasil: dashboard atas (Live Analytics, Data Management, Sync Status) tetap snappy.

### 6.11 Export PNG

Wrap area: peta + filter context (indikator + tahun) + panel.
```typescript
const node = document.getElementById('peta-tematik-export-area');
const canvas = await html2canvas(node, { backgroundColor: '#fff', scale: 2 });
canvas.toBlob(blob => download(blob, `peta-tematik-${indikator}-${year}.png`));
```

### 6.12 Inject ke `/dashboard`

File: `backend/admin/app/dashboard/page.tsx`. Posisi: setelah section `🔄 Sync Status`.

```tsx
{/* ==================== PETA TEMATIK ==================== */}
<div className="space-y-3 pt-4 border-t border-gray-200">
  <PetaTematikSection />
</div>
```

## 7. Operations

### 7.1 Testing

**Backend (Jest):**

| Test | File | Coverage |
|---|---|---|
| Unit | `petaTematik.categorization.test.js` | 50+ source_name → kategori benar |
| Unit | `petaTematik.regionMap.test.js` | 10+ dim_value → kdkab benar |
| Unit | `petaTematik.cache.test.js` | LRU TTL behavior |
| Integration | `petaTematik.routes.test.js` | 5 endpoint, supertest, mock DB |
| Integration | `petaTematik.eligibility.test.js` | Boot scanner pakai DB fixture |

**Frontend (Playwright E2E):**
- `frontend/e2e/peta-tematik.spec.ts` — 1 happy-path test: load /dashboard → scroll ke section → pilih indikator → ganti tahun → assert peta update.

**Tidak**: visual regression, performance benchmark.

### 7.2 Performance budget

| Operasi | Target |
|---|---|
| `/peta-tematik/indikator-list` cold | < 500ms (boot pre-build) |
| `/peta-tematik/indikator-list` cached | < 5ms |
| `/peta-tematik/data` cold | < 300ms |
| `/peta-tematik/data` cached | < 5ms |
| `/peta-tematik/summary` cold | < 800ms |
| GeoJSON download | < 1s |
| Map initial render | < 2s di Chrome desktop |

### 7.3 Security

- Section behind `<RequireAuth>` (admin only).
- Backend route protected dengan middleware auth existing.
- **SQL injection guard**: `indikator` param divalidasi integer + whitelist check terhadap list ELIGIBLE yang di-cache. Reject 400 kalau tidak match.
- Rate limiting: pakai middleware existing (60/min default admin).
- GET-only → no CSRF concern.
- No PII (semua agregat publik).

### 7.4 Risks & mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Format `dim_value` baru di indikator yg di-sync BPS | Med | Low | `dimValueToKdkab` return null → polygon abu-abu, tidak crash. Log warning. |
| Topik baru BPS belum di-mapping kategori | Med | Low | Masuk "Lainnya". Itu signal untuk add kategori (PR follow-up). |
| Tabel `indikator_X` di-drop / rename | Low | Med | Boot scan exclude dari list. Runtime query → reject 400. |
| GeoJSON corrupt / hilang | Very Low | High | Frontend fallback ke list view (table). |
| Dashboard jadi lambat | Med | Med | Lazy-render via IntersectionObserver. |
| Multi-metric handling salah | Med | Med | Label metric di legend ("metric: month-to-month"). Default ke metric paling umum. |
| Year=0 / month=0 anomali bocor ke UI | Low | Low | `WHERE year > 0` di setiap query. Test coverage. |

### 7.5 File-level changes

**Files to CREATE** (~25 file, ~1.7K LoC):

```
Backend:
  backend/src/routes/peta-tematik.routes.js                 ~100
  backend/src/services/petaTematik.service.js               ~250
  backend/src/services/petaTematik.categorization.js         ~80
  backend/src/services/petaTematik.regionMap.js              ~30
  backend/src/services/petaTematik.cache.js                  ~40
  backend/src/services/petaTematik.eligibilityScanner.js    ~100
  backend/__tests__/petaTematik.categorization.test.js       ~60
  backend/__tests__/petaTematik.regionMap.test.js            ~40
  backend/__tests__/petaTematik.cache.test.js                ~30
  backend/__tests__/petaTematik.routes.test.js              ~150
  backend/__tests__/petaTematik.eligibility.test.js          ~60

Frontend (admin):
  backend/admin/components/peta-tematik/PetaTematikSection.tsx  ~120
  backend/admin/components/peta-tematik/IndikatorPicker.tsx      ~80
  backend/admin/components/peta-tematik/FilterBar.tsx            ~60
  backend/admin/components/peta-tematik/ChoroplethMap.tsx       ~150
  backend/admin/components/peta-tematik/MapLegend.tsx            ~40
  backend/admin/components/peta-tematik/InfoPanel.tsx            ~80
  backend/admin/components/peta-tematik/TopBottomList.tsx        ~40
  backend/admin/components/peta-tematik/TrendSparkline.tsx       ~50
  backend/admin/components/peta-tematik/ExportButton.tsx         ~30
  backend/admin/components/peta-tematik/types.ts                 ~40
  backend/admin/components/peta-tematik/colorScale.ts            ~30
  backend/admin/components/peta-tematik/api.ts                   ~50

E2E:
  frontend/e2e/peta-tematik.spec.ts                              ~80
```

**Files to MODIFY**:
```
backend/src/server.js                       (+3 lines: register route + boot scanner)
backend/admin/app/dashboard/page.tsx        (+5 lines: import + render)
backend/admin/package.json                  (+3 deps: react-leaflet, html2canvas, cmdk)
backend/package.json                        (+1 dep: lru-cache, kalau belum ada)
docs/workspace/admin.md                     (update Pages list, Change Log)
docs/workspace/backend.md                   (update routes/services, Change Log)
docs/workspace/database.md                  (catat audit indikator + region mapping)
```

### 7.6 Rollout plan (7–10 hari)

| Day | Task |
|---|---|
| 1–2 | Backend: service + routes + cache + endpoint `indikator-list`, `years`. Unit tests. |
| 3–4 | Backend: endpoint `data`, `summary`, `metrics`. Integration tests. |
| 5–6 | Frontend: skeleton, FilterBar, ChoroplethMap basic (peta jadi tapi belum styling). Wire react-query. |
| 7–8 | Frontend: styling — color scale, legend, tooltip, InfoPanel, TopBottomList, sparkline. |
| 9 | Export PNG, polish, error states, accessibility. |
| 10 | E2E test, dokumentasi (workspace docs), final review, deploy. |

**Deploy**:
- Backend: `pm2 reload pds-backend --update-env`
- Admin: `pm2 reload pds-admin`
- No DB migration, no infra change, no CSP change (Leaflet local).

### 7.7 Out of scope (deferred)

Eksplisit untuk hindari scope creep:

- ❌ Drill-down: klik polygon → page detail dengan time-series penuh
- ❌ Linked highlight peta ↔ chart bar
- ❌ Export CSV / PDF
- ❌ Embed iframe untuk public PWA dengan signed token
- ❌ Compare mode: dua peta side-by-side beda tahun
- ❌ Animation: time slider yang play through years
- ❌ `indikator_418` Pelanggan Listrik (multi-dim)
- ❌ Indikator EXIM (159, 160) multidim
- ❌ Admin curation override untuk kategori
- ❌ Jenks Natural Breaks classification

Semua bisa ditambahkan post-MVP tanpa breaking change.

## 8. Asumsi & Open Questions

### Asumsi
- Tabel `data_bps.indikator_*` formatnya stabil (kolom `source_id`, `source_name`, `year`, `month_no`, `dim_key`, `dim_value`, `metric`, `value`).
- Sync BPS tidak akan ubah skema kolom — hanya tambah row / tambah tabel.
- 10 kab/kota Malut tetap (tidak ada pemekaran wilayah selama MVP berjalan).
- Audience admin familiar dengan terminologi BPS — search box cukup tanpa AI assistant.

### Open Questions (post-MVP)
- Apakah fitur compare dua tahun side-by-side dibutuhkan? (defer sampai ada feedback nyata)
- Apakah fitur klik polygon untuk drill-down dibutuhkan? (Opsi C upgrade path)
- Apakah perlu admin curation untuk override kategori indikator? (defer sampai ada keluhan klasifikasi salah)

## 9. Referensi

- Audit hasil: `tmp/peta_tematik_audit_report.md`, `tmp/indikator_audit.tsv`
- GeoJSON: `backend/public/geojson/peta_kabko_malut.geojson`
- Schema doc: `DATA_BPS_SCHEMA.md`
- Workspace docs: `docs/workspace/admin.md`, `docs/workspace/backend.md`, `docs/workspace/database.md`
- Pattern existing: `/dashboard` page (`backend/admin/app/dashboard/page.tsx`)
