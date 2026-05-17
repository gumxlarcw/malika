# Peta Tematik MALIKA — Arsitektur & Bedah Fitur Lengkap

> **Status**: Living document — diperbarui tiap perubahan signifikan pada fitur peta tematik.
> **Audiens**: Engineer (backend/frontend/admin), data analyst, stakeholder teknis BPS Malut.
> **Companion docs**: [`INDIKATOR_DAFTAR.md`](./INDIKATOR_DAFTAR.md) (audit 308 indikator), [`docs/workspace/backend.md`](../workspace/backend.md), [`docs/workspace/frontend.md`](../workspace/frontend.md), [`docs/workspace/database.md`](../workspace/database.md).
> **Tanggal dokumen dasar**: 2026-05-17 — verifikasi ulang sebelum merujuk klaim spesifik.

---

## 1. Ringkasan Eksekutif

Peta Tematik adalah fitur visualisasi **choropleth** untuk indikator statistik BPS Maluku Utara di tingkat **kabupaten/kota** (10 wilayah). Pengguna dapat memilih indikator, tahun, bulan (opsional), dan metrik, lalu melihat sebaran spasial dalam 5-bin kuantil dengan 5 palet warna yang disiapkan editorial.

### Karakteristik utama

| Aspek | Detail |
|---|---|
| **Cakupan wilayah** | 10 kab/kota Maluku Utara (8 kabupaten + 2 kota) + provinsi (untuk summary saja) |
| **Sumber data** | `data_bps.indikator_NNN` (310+ tabel) + metadata `project_data_strategis.indicator_meta` & `indicator_metric_meta` |
| **Indikator eligible** | 204 dari 311 tabel (audit 2026-05-06) |
| **Rendering** | Leaflet 1.9.4 + react-leaflet 4.2.1, basemap OSM |
| **Binning** | Quantile 5-bin (fixed di UI; kode Jenks & Equal juga tersedia tapi tidak diekspos) |
| **Palet** | 5 preset editorial: Blue (default), Emerald, Amber, Rose, Purple |
| **Caching** | LRU 500 entries, TTL 1 jam; GeoJSON cache 24 jam di sisi PWA |
| **Akses** | Public (rate-limited) + Authenticated routes paralel |

### Filosofi desain

1. **Editorial-grade**: palette tidak boleh "neon dashboard" — hover outline pakai warna *komplementer*, bukan same-hue shade, agar visible di semua 5 bins.
2. **Opinionated defaults**: user tidak memilih metode binning (selalu quantile 5-bin). Pilihan palet adalah satu-satunya kustomisasi visual.
3. **Lazy + cached**: scan eligibility 310 tabel hanya sekali per jam; data per `(indikator,year,month,metric)` di-cache 1 jam.
4. **Single canonical mapping**: `regionMap.service.js` adalah *satu-satunya* sumber kebenaran untuk pasangan `dim_value ↔ kdkab` — ada insiden masa lalu di mana `03=Sula` dan `05=Halut` tertukar.

---

## 2. Arsitektur Tingkat Tinggi

```
┌────────────────────────────────────────────────────────────────────┐
│                       PETA TEMATIK FLOW                             │
└────────────────────────────────────────────────────────────────────┘

  DATABASE                BACKEND SERVICE           BACKEND API
  ────────                ───────────────           ───────────
  data_bps                petaTematik.service ──┐
   └─ indikator_NNN ──┐    regionMap.service    │
      (310 tabel)     │    categorization       ├──► /peta-tematik
                      ├──► eligibilityScanner   │      /indikator-list
  project_data_       │    metadataLookup       │      /years
  strategis           │    cache.service        │      /metrics
   ├─ indicator_meta ─┤                         │      /data
   └─ indicator_      │                         │      /summary
      metric_meta ────┘                         │      /indikator-meta/:id
                                                │      /indikator-search
  backend/public/                               │
   geojson/peta_kabko_malut.geojson ───────────►│  /geojson/:file
                                                │
                                                ▼
                                      FRONTEND API (Next.js)
                                      ─────────────────────
                                      /api/peta-tematik/*
                                       (proxy + cache control)
                                                │
                                                ▼
                                      FRONTEND RENDERING (PWA)
                                      ────────────────────────
                                      PetaTematikClient.tsx
                                       ├─ ChoroplethMap (Leaflet)
                                       ├─ LinkedBarChart (linked hover)
                                       ├─ KabkotaDetailDrawer (history+rank)
                                       ├─ TimeScrubber / ShareBar / ...
                                       └─ useUrlState (URL ↔ filter)

                                      ADMIN PANEL
                                      ───────────
                                      PetaTematikSection.tsx
                                       (lazy-mounted dashboard widget)
```

### Tiga PM2 app yang relevan

| App | Port | Role |
|---|---|---|
| `pds-backend` | 5000 | Express + service layer + GeoJSON serving + API endpoints |
| `pds-frontend` | 6060 | Next.js PWA — UI utama peta tematik di route `/(admin)/peta-tematik` |
| `pds-admin` | 5050 | Next.js admin panel — widget peta tematik di dashboard |

Catat: route PWA berada di group `(admin)` di file system, tapi itu hanya konvensi Next.js — **public access tetap diizinkan** lewat `peta-tematik.public.routes.js` di backend.

---

## 3. Backend — Bedah Service Layer

Lokasi: `backend/src/services/petaTematik/`

### 3.1 `petaTematik.service.js` — Orkestrator utama

Tanggung jawab: jadi *facade* untuk semua query peta tematik. Tidak menyentuh GeoJSON; tidak tahu tentang Leaflet. Pure data layer.

**Fungsi publik:**

| Fungsi | Input | Output | Cache key |
|---|---|---|---|
| `getIndikatorList()` | — | `{ totalEligible, kategori: { "Ekonomi": [...], "Kependudukan": [...] } }` | `pt:list` |
| `getYears(indikatorId)` | indikator ID | `{ years: [2020,2021,...], has_monthly: bool }` | `pt:years:${id}` |
| `getMetrics(indikatorId)` | indikator ID | `{ metrics: ["value","yoy",...] }` | `pt:metrics:${id}` |
| `getData({ indikator, year, month?, metric? })` | filter | `{ data: [{kdkab,nama_kab,value}×10] }` | `pt:data:${i}:${y}:${m}:${k}` |
| `getSummary({ ... })` | filter | `{ provinsi_total, top3, bottom3, trend[5y] }` | `pt:sum:${i}:${y}:${m}:${k}` |

**Strategi aggregation**: `AVG(value)` per `dim_value`, di-`GROUP BY dim_value`. AVG dipilih (bukan SUM/MAX) karena beberapa indikator punya multiple row per (year, dim_value) yang seharusnya identik — AVG aman terhadap duplikasi.

**Mapping dim_value → kdkab**: dilakukan di service, bukan SQL. Alasannya: SQL JOIN ke whitelist butuh subquery/CTE, sedangkan JS map lookup O(1) sehari setelah cache hit. Lookup pakai `regionMap.dimValueToKdkab()` (lihat 3.2).

### 3.2 `regionMap.service.js` — Canonical kdkab mapping

**Kenapa file ini penting**: BPS menyimpan nama wilayah sebagai string (`"Kabupaten Halmahera Barat"`, `"Kota Ternate"`, `"Maluku Utara"`). GeoJSON pakai kode BPS standar (`kdkab: "01"`, `"71"`, dll). Tanpa mapping eksplisit, polygon tidak akan terwarna.

**Yang harus diingat**:

| kdkab | Nama | Catatan historis |
|---|---|---|
| 01 | Halmahera Barat | |
| 02 | Halmahera Tengah | |
| 03 | **Kepulauan Sula** | Sempat tertukar dengan 05 di awal |
| 04 | Halmahera Selatan | |
| 05 | **Halmahera Utara** | Sempat tertukar dengan 03 |
| 06 | Halmahera Timur | |
| 07 | Pulau Morotai | |
| 08 | Pulau Taliabu | |
| 71 | Kota Ternate | |
| 72 | Kota Tidore Kepulauan | |

`dimValueToKdkab(dimValue)` melakukan:
1. Strip prefix `"Kabupaten "` / `"Kota "`.
2. Lowercase + trim whitespace.
3. Lookup ke `NAME_TO_KDKAB` map.
4. Return `kdkab` atau `null` (untuk `"Maluku Utara"` provinsi — *intentionally null*, supaya peta tidak mencoba mewarnai polygon yang tidak ada).

### 3.3 `categorization.service.js` — Klasifikasi 8 kategori

Rule-based keyword matching pada `source_name` BPS. Tidak ada ML/embedding di sini — alasannya: kategori adalah *editorial decision*, bukan diskoveri.

**Urutan matters**: Ekonomi dicek sebelum Kependudukan supaya `"penduduk miskin"` masuk Ekonomi (bukan Kependudukan). Rule pertama yang match menang.

**8 kategori**:
1. Ekonomi (incl. kemiskinan, harga, PDRB)
2. Kependudukan
3. Ketenagakerjaan
4. Pendidikan
5. Kesehatan
6. Pariwisata & Akomodasi
7. Pembangunan & Sosial
8. Lainnya (catch-all)

### 3.4 `eligibilityScanner.service.js` — Filter indikator

Bukan setiap dari 310+ tabel `indikator_*` layak ditampilkan sebagai peta tematik. Kriteria eligibility:

1. Tabel punya breakdown ≥1 dari 10 nama kab/kota di `dim_value`.
2. Ada minimal 1 row dengan `value IS NOT NULL` untuk kab/kota tersebut.
3. Bukan tabel yang di-blacklist (lihat exclusion).

**Excluded tables** (3 total):
- `indikator_418` — multi-dimensional (Unit Layanan Pelanggan PLN, butuh sub-filter MVP belum punya).
- `indikator_159`, `indikator_160` — EXIM multidim.

**Hasil audit (2026-05-06)**: 204 eligible dari 311 tabel. Detail di [`INDIKATOR_DAFTAR.md`](./INDIKATOR_DAFTAR.md).

### 3.5 `metadataLookup.service.js` — Indicator metadata + semantic search

Dua tabel sumber (keduanya di DB `project_data_strategis`):

| Tabel | Isi |
|---|---|
| `indicator_meta` | Indicator-level: title, subject, source citation, BPS table id, unit default, decimal places, embedding 768-dim |
| `indicator_metric_meta` | Metric-level overrides: jika satu indikator punya beberapa metric (e.g., value, MoM, YoY), tiap metric bisa override unit/decimal/formula |

**`resolveMeta(sourceId, metricKey)`** — strategi merge: ambil indikator-level dulu, lalu metric-level *override* field yang non-null. Hasilnya: satu objek metadata final yang sudah konsisten untuk satu kombinasi.

**`getIndikatorMetaBulk(sourceIds)`** — penting untuk performa. Tanpa ini, list 200+ indikator akan trigger N+1 query.

**`semanticSearchIndikator({ query, limit, minScore, type })`**:
- Embedding query pakai service yang sama dengan retrieval (`Xenova/multilingual-e5-base` @ 768d).
- Skoring **in-memory** (cosine similarity terhadap kolom `title_embedding`). Tidak pakai HNSW VECTOR index — alasannya: tabel hanya ~302 rows, full-scan in-memory < 50ms; HNSW overhead tidak terbayar.
- Default `minScore: 0.5`.

### 3.6 `cache.service.js` — LRU wrapper

Thin wrapper di atas `lru-cache`:
- `max: 500` entries
- `ttl: 60 * 60 * 1000` (1 jam)
- `getOrCompute(key, asyncFn)` — pattern `cache-aside` yang await-safe.

**Penting**: TTL 1 jam dipilih sebagai *trade-off*. Data BPS biasanya tidak update sub-jam, tapi metadata kadang di-edit admin. Restart `pds-backend` mengosongkan cache (cache in-process, bukan Redis).

---

## 4. Backend — API Endpoints

### 4.1 Dua route file, satu controller

Lokasi:
- `backend/src/routes/peta-tematik.routes.js` — authenticated routes (mounted di `/peta-tematik`)
- `backend/src/routes/peta-tematik.public.routes.js` — public routes (mounted di `/peta-tematik/public`, rate-limited di `app.js`)
- `backend/src/controllers/peta-tematik.controller.js` — handler bersama untuk keduanya

### 4.2 Endpoint reference

| Method | Path | Query params | Response shape |
|---|---|---|---|
| GET | `/indikator-list` | — | `{ ok, totalEligible, kategori }` |
| GET | `/years` | `indikator` | `{ ok, years, has_monthly }` |
| GET | `/metrics` | `indikator` | `{ ok, metrics }` |
| GET | `/data` | `indikator`, `year`, `month?`, `metric?` | `{ ok, data: [{kdkab, nama_kab, value}], meta }` |
| GET | `/summary` | sama dengan `/data` | `{ ok, provinsi_total, top3, bottom3, trend }` |
| GET | `/indikator-meta/:id` | — | `{ ok, meta }` |
| GET | `/indikator-search` | `q`, `limit?=10`, `type?`, `min_score?=0.5` | `{ ok, query, count, results }` |

Semua endpoint di atas tersedia di **kedua** path (`/peta-tematik/X` dan `/peta-tematik/public/X`). PWA selalu pakai versi `/public/` via Next.js API route proxy.

### 4.3 Validasi & guard

Controller pakai `withGuard()` wrapper untuk konsisten error mapping:
- `400 Bad Request` untuk `InvalidArgument` (e.g., `indikator` bukan integer positif).
- `500 Internal Server Error` untuk semua exception lain.

`parseInt32(value)` enforce: integer, `> 0`, `<= 99999`. Reject `NaN`, negatif, dan ID terlalu besar (defensive — semua indikator BPS aktual `< 1000`).

**Paralel fetch**: `getData()` dan `getMeta()` ke DB yang berbeda (`data_bps` vs `project_data_strategis`), jadi controller `Promise.all`-kan keduanya — tidak ada lock, tidak ada dependency.

---

## 5. Backend — GeoJSON Management

Lokasi: `backend/src/controllers/geojson.controller.js`, `backend/src/routes/geojson.routes.js`.

### 5.1 File aktif

`backend/public/geojson/peta_kabko_malut.geojson` — **11 MB**, 10 features (MultiPolygon per kab/kota). Properties tiap feature wajib punya `kdkab` (kode 01-08, 71-72) dan `nama_kab`.

Path lookup punya **fallback**: kalau file tidak ada di `backend/public/geojson/`, sistem coba di `public/geojson/` (repo root) — legacy dari struktur lama.

### 5.2 Endpoint admin

| Method | Path | Tujuan |
|---|---|---|
| `POST` | `/geojson/upload` | multipart upload, validasi JSON + GeoJSON structure |
| `GET` | `/geojson` | list semua file |
| `GET` | `/geojson/:filename` | public serve (Content-Type: `application/geo+json`) |
| `GET` | `/geojson/:filename/admin` | admin preview (raw JSON) |
| `PUT` | `/geojson/:filename/properties` | bulk update `properties.X` per feature |
| `DELETE` | `/geojson/:filename` | hapus (dengan path traversal guard) |

### 5.3 Security notes

- **Path traversal prevention**: `path.basename()` + reject jika ada `..`.
- **Extension whitelist**: hanya `.geojson` dan `.json` diterima.
- **Dedup**: kalau filename sudah ada saat upload, append SHA1 hash (8 char) sebelum extension — kecuali `overwrite=true` di-set eksplisit.
- **Output minified**: hindari pretty-print di disk untuk hemat 30%+ size.

---

## 6. Database — Schema yang Relevan

Dua database MariaDB 11.8:

### 6.1 `data_bps` — sumber data BPS

**Tabel pola**: `indikator_NNN` (NNN = source_id), 310+ tabel.

Skema umum:
```sql
CREATE TABLE indikator_182 (
  id BIGINT PRIMARY KEY,
  source_id INT,
  source_name VARCHAR(255),
  year INT,                      -- CHECK 2000-2100 (Phase 4)
  month_no INT,                  -- CHECK IN (0..12, 31..37) (Phase 4)
  metric VARCHAR(100),
  dim_key VARCHAR(100),
  dim_value VARCHAR(255),        -- "Halmahera Barat", "Kota Ternate", "Maluku Utara"
  value DECIMAL(18,6),
  value_code VARCHAR(8),
  ...
);
```

**Konvensi `month_no`**:
- `0` = annual / unknown
- `1..12` = bulan
- `31..36` = triwulan (kode BPS internal)
- `37` = sentinel lain (jarang)

UI peta tematik hanya tampilkan month scrubber jika `has_monthly === true` (artinya: ada row dengan `month_no` di 1..12).

### 6.2 `project_data_strategis` — metadata + cache

- `indicator_meta` (~302 rows) — indikator-level metadata.
- `indicator_metric_meta` (N rows) — metric-level overrides.

`indicator_meta.title_embedding VECTOR(768)` — kolom embedding untuk semantic search. Diisi oleh script ETL yang panggil embedding service.

### 6.3 Migration penting

- `migrations/20260510_indikator_check_constraints.js` (Phase 4) — menambahkan CHECK constraint `year BETWEEN 2000 AND 2100` dan `month_no IN (...)` ke semua tabel `indikator_*`. Mencegah dirty data dari ETL gagal lolos.

---

## 7. Frontend PWA — Bedah Komponen

Lokasi: `frontend/src/app/(admin)/peta-tematik/`

### 7.1 Hierarki file

```
peta-tematik/
├── page.tsx                       # Server wrapper, force-dynamic
├── PetaTematikClient.tsx          # Main orchestrator (~280 lines)
├── ChoroplethMap.tsx              # Leaflet map component
├── colorScale.ts                  # Palette + binning logic
├── types.ts                       # Shared TypeScript types
├── useUrlState.ts                 # URL ↔ filter state sync
└── components/
    ├── KabkotaDetailDrawer.tsx    # Slide-out detail (history + rank)
    ├── LinkedBarChart.tsx         # Linked hover ↔ map
    ├── AutoInsights.tsx           # AI-generated commentary
    ├── CompareMode.tsx            # Period comparison
    ├── CommandPalette.tsx         # cmdk-based search
    ├── EditorialHeader.tsx        # Title, methodology link
    ├── TimeScrubber.tsx           # Year slider
    ├── ShareBar.tsx               # Share/export
    ├── EmbedModal.tsx             # Embed code generator
    ├── BinningSelector.tsx        # Hidden — fixed quantile
    ├── ActiveIndikatorBanner.tsx
    ├── MethodologyFooter.tsx
    └── ThemeToggle.tsx
```

### 7.2 State management di `PetaTematikClient`

```typescript
const [filters, setFilters] = useUrlState({
  indikator: number,
  year: number,
  month?: number,    // hanya kalau has_monthly
  metric?: string,
});
const [list, setList] = useState<IndikatorList>();      // dari /indikator-list
const [data, setData] = useState<DataResponse>();       // dari /data
const [summary, setSummary] = useState<SummaryResponse>(); // dari /summary
const [paletteId, setPaletteId] = useUrlState('blue');  // ?palette=X
const [hoveredKdkab, setHoveredKdkab] = useState<string | null>();
```

**Pola fetching**: tiap perubahan `filters` trigger `useEffect` yang panggil PWA API routes paralel (`/data` + `/summary`). Tidak ada React Query di PWA peta tematik — admin panel pakai React Query, PWA tidak.

### 7.3 `ChoroplethMap.tsx` — render peta

Library stack:
- `leaflet` 1.9.4 — core library
- `react-leaflet` 4.2.1 — React binding
- `@types/leaflet` 1.9.21

Konfigurasi map:
```typescript
center: [-0.78, 127.85]   // approx pusat Maluku Utara
zoom: 7
basemap: OpenStreetMap tiles
```

Flow render:
1. **Load GeoJSON** async dari `/api/peta-tematik/geojson` (cached 24 jam).
2. **Compute bins** via `quantileBins(values, 5)` — return 4 breakpoints (20/40/60/80 percentile).
3. **Style polygon** dengan `colorForValue(value, breaks, palette)`:
   - Bin 0 (< break[0]): color paling terang
   - Bin 4 (>= break[3]): color paling gelap
   - `value === null`: gray no-data
4. **fitBounds** dengan 24px padding pada load + re-fit pada container resize (ResizeObserver).
5. **Event handlers**:
   - `onEachFeature(feature, layer)`: bind click → `onPolygonClick(kdkab, namaKab)`, mouseover → `onPolygonHover(kdkab)`.
   - Hover: change outline ke `palette.hoverOutline` (komplementer).

### 7.4 `colorScale.ts` — desain palette

**5 palette preset**, semua sequential single-hue dari terang ke gelap:

| Palette | Range terang → gelap | Hover outline | Aksen |
|---|---|---|---|
| **Blue** (default) | `#ecf3ff → #262e89` | `red-600` (#dc2626) | `#3b82f6` |
| Emerald | `#ecfdf5 → #064e3b` | `red-600` | `#10b981` |
| Amber | `#fffbeb → #78350f` | `blue-700` (#1d4ed8) | `#f59e0b` |
| Rose | `#fff1f2 → #881337` | `green-700` (#15803d) | `#e11d48` |
| Purple | `#faf5ff → #581c87` | `green-600` (#16a34a) | `#a855f7` |

**Aturan editorial yang penting**: `hoverOutline` **tidak boleh same-hue** dengan polygon fill. Kalau blue polygon di-outline blue yang lebih tua, outline tidak akan visible di bin paling gelap. Komplementer (red untuk blue, blue untuk amber) selalu visible di semua 5 bins. Lihat [`docs/memory/peta_tematik_palettes.md`](../memory/peta_tematik_palettes.md) untuk rationale design.

**Binning method**:
- `quantileBins(values, n=5)` — equal-population, ~2 kab/bin
- `jenksBins(values, n=5)` — natural breaks (kode ada, tidak diekspos)
- `equalBins(values, n=5)` — equal-interval (kode ada, tidak diekspos)

Default di UI: **quantile 5-bin fixed**. `BinningSelector.tsx` ada di codebase tapi tidak di-mount. Rasionalnya: UX simplification — user tidak perlu paham "Jenks vs Equal Interval".

### 7.5 `LinkedBarChart.tsx` — chart linked ke peta

10 horizontal bar (satu per kab/kota). Tiga mode sort:
- `value-desc` (default) — nilai tertinggi di atas
- `value-asc`
- `name` — alfabetis

**Linked interaction**: hover bar → dispatch `onHover(kdkab)` ke parent → parent set `hoveredKdkab` → `ChoroplethMap` re-render outline polygon yang match. Bidirectional: hover polygon juga highlight bar yang match.

Bar fill color pakai binning + palette yang sama dengan peta → visual consistency.

### 7.6 `KabkotaDetailDrawer.tsx` — drill-down

Slide-out drawer (Headless UI atau Radix), terbuka saat klik polygon/bar. Isi:
1. **Header**: nama kab/kota + nilai current.
2. **Metadata**: title indikator, definisi, formula HTML, unit, sumber sitasi.
3. **History 5 tahun**: line chart nilai per tahun.
4. **Ranking**: posisi kab di 1-10 untuk tiap tahun.
5. **Source link**: BPS table id + last update.

**Sanitization**: `formula_html` dan `definition` dari BPS bisa mengandung HTML. Dibersihkan via DOMPurify (client-side, bahkan kalau server-side juga sudah sanitize) — defense in depth.

### 7.7 `useUrlState.ts` — URL persistence

Custom hook yang sync state dengan URL search params. Akibatnya: link `https://malika.bpsmalut.com/peta-tematik?indikator=182&year=2024&month=3&palette=emerald` 100% reproducible — buka link, dapat view yang sama.

Berguna untuk **Share/Embed** feature: tinggal copy URL.

### 7.8 Next.js API routes — proxy ke backend

Lokasi: `frontend/src/app/api/peta-tematik/`. Semua route adalah thin proxy ke backend `/peta-tematik/public/X`. Yang berbeda hanya cache control:

| Frontend route | Cache strategy |
|---|---|
| `/api/peta-tematik/geojson` | `force-cache, revalidate: 86400` (1 hari) |
| Semua endpoint lain | `no-store` (selalu fresh dari backend, backend yg cache) |

Alasannya: backend LRU sudah cache 1 jam, jadi frontend tidak perlu cache lagi (kecuali GeoJSON yang static).

---

## 8. Admin Panel — Widget Peta Tematik

Lokasi: `backend/admin/components/peta-tematik/`

### 8.1 Perbedaan dengan PWA

| Aspek | PWA | Admin |
|---|---|---|
| Audiens | Publik umum | Admin BPS |
| Layout | Full-page editorial | Dashboard widget |
| Linked chart | ✅ | ❌ |
| Detail drawer | ✅ | ❌ (info panel saja) |
| Share/Embed | ✅ | ❌ |
| Export PNG/PDF | ❌ | ✅ |
| Lazy mount | ❌ | ✅ (IntersectionObserver, 100px rootMargin) |

### 8.2 Komponen

- `PetaTematikSection.tsx` — orchestrator widget
- `ChoroplethMap.tsx` — Leaflet (simpler config dibanding PWA)
- `FilterBar.tsx` — selector indikator/year/month/metric
- `MapLegend.tsx` — legend 5-bin
- `InfoPanel.tsx` — sidebar metadata
- `ExportButton.tsx` — export ke PNG/PDF
- `TopBottomList.tsx` — top 3 / bottom 3
- `ProvinsiTotalCard.tsx` — kartu provinsi total
- `IndikatorPicker.tsx` — dropdown bertingkat (kategori → indikator)
- `TrendSparkline.tsx` — mini chart 5-tahun
- `api.ts` — **pakai React Query** (`@tanstack/react-query`) dengan `QUERY_KEYS` konstanta

### 8.3 Build & deploy admin

⚠ **CRITICAL** (sesuai CLAUDE.md):
```bash
cd backend/admin && npm run build && pm2 reload pds-admin --update-env
```
Skip `npm run build` = perubahan `.tsx` tidak ter-deploy. PM2 hanya re-exec `.next` bundle yang sudah ada.

---

## 9. Skenario User-Flow Lengkap

### Skenario A: User baru buka `/peta-tematik`

```
1. Browser GET /peta-tematik
   └─ Next.js SSR (page.tsx) → render layout + lazy load PetaTematikClient
2. Client mount → useEffect trigger
   ├─ fetch /api/peta-tematik/indikator-list → backend /peta-tematik/public/indikator-list
   │  (backend: cache hit → 204 eligible dengan kategori, < 5ms)
   └─ fetch /api/peta-tematik/geojson → backend /geojson/peta_kabko_malut.geojson
      (cache 24h di sisi PWA → biasanya cache hit setelah first load)
3. User pilih indikator (e.g., "Kepadatan Penduduk") via picker
   ├─ filters.indikator = 182, URL update ?indikator=182
   ├─ fetch /years?indikator=182 → [2020,2021,2022,2023,2024], has_monthly: false
   └─ filters.year = 2024 (default: latest), URL update ?year=2024
4. Trigger data + summary fetch (parallel)
   ├─ fetch /data?indikator=182&year=2024 → 10 kab/kota dengan value
   └─ fetch /summary?indikator=182&year=2024 → provinsi_total, top3, bottom3, trend 5y
5. Render:
   ├─ ChoroplethMap: compute quantile bins → color 10 polygon
   ├─ LinkedBarChart: 10 bar sorted desc
   ├─ EditorialHeader: title indikator + methodology
   └─ Summary widgets: provinsi total, top/bottom, sparkline trend
6. User hover polygon "Halmahera Barat"
   ├─ onPolygonHover('01') → setHoveredKdkab('01')
   └─ LinkedBarChart re-render → bar Halbar highlight
7. User klik polygon
   ├─ onPolygonClick('01', 'Halmahera Barat')
   ├─ Drawer open, fetch indikator-meta + history 5y untuk kdkab='01'
   └─ Drawer render: metadata + line chart + ranking table
8. User ganti palette ke "Emerald"
   ├─ setPaletteId('emerald'), URL update ?palette=emerald
   └─ ChoroplethMap + LinkedBarChart re-color (no refetch)
9. User klik "Share"
   └─ Copy URL: https://malika.bpsmalut.com/peta-tematik?indikator=182&year=2024&palette=emerald
```

### Skenario B: Admin upload GeoJSON baru

```
1. Admin login → buka GeoJSON manager
2. POST /geojson/upload (multipart, file = new-malut.geojson)
   ├─ controller: validate JSON parse OK
   ├─ controller: validate FeatureCollection structure
   ├─ controller: cek filename collision → if exist, append SHA1[:8]
   ├─ controller: write to backend/public/geojson/ (minified)
   └─ return { ok, filename, url, size_bytes }
3. (Opsional) PUT /geojson/:filename/properties
   └─ bulk-edit properties tiap feature (e.g., normalize kdkab format)
4. Admin uji-coba: GET /geojson/:filename → render preview
```

### Skenario C: Indikator baru ditambahkan ke `data_bps`

```
1. ETL pipeline ingest tabel indikator_999 baru ke data_bps
2. Periode cache expire (TTL 1 jam) atau restart pds-backend
3. eligibilityScanner ulang scan:
   ├─ SELECT FROM information_schema.TABLES WHERE TABLE_NAME LIKE 'indikator_%'
   ├─ Untuk indikator_999: cek SUM(CASE WHEN dim_value IN (10 nama) AND value IS NOT NULL THEN 1 ELSE 0 END) > 0
   └─ Jika eligible: add ke list
4. categorizeBySource(source_name) → kategori (e.g., "Pendidikan")
5. enrichListWithMetadata: bulk SELECT indicator_meta untuk semua source_id baru
6. Cache populate ulang → user lihat indikator baru di picker
```

---

## 10. Caching Strategy — Detail

Tiga lapisan cache, dari paling dalam ke paling luar:

| Layer | Lokasi | TTL | Invalidasi |
|---|---|---|---|
| **L1 — Backend in-process** | `cache.service.js` LRU 500/1h | 1 jam | Restart `pds-backend` atau LRU eviction |
| **L2 — DB query plan cache** | MariaDB internal | session | Mati saat connection close |
| **L3 — Frontend HTTP cache** | Next.js fetch cache + browser | 24h untuk GeoJSON; `no-store` untuk data | Hard reload atau revalidate header |

**Tidak ada Redis**. Cache backend in-process berarti tiap PM2 worker punya cache sendiri (kalau ada cluster mode). Pertimbangan: `pds-backend` default fork mode (1 instance), jadi cache shared.

**Cache key pattern**: `pt:<endpoint>:<param1>:<param2>:...`. Mudah di-debug via memory inspector kalau perlu.

### Kapan cache stale matters

- **Metadata edit di admin**: cache 1 jam berarti perubahan baru terlihat user setelah 1 jam, kecuali backend di-restart. Untuk MVP acceptable; jika butuh real-time, harus implement cache invalidation via event.
- **ETL data update**: BPS jarang update sub-jam, tapi kalau scheduled refresh tiap jam, ada risiko user lihat data lama 0-60 menit.

---

## 11. Integrasi Lain

### 11.1 Chat AI ↔ Peta Tematik

**Status saat ini**: tidak ada integrasi langsung di komponen peta tematik.

**Yang ada**: `geoInference.service.js` di `backend/src/services/chat/` — infer regional intent dari natural language. Bisa digunakan untuk: "Tampilkan kepadatan penduduk di Maluku Utara per kab" → infer indikator_id, year, mungkin generate URL `/peta-tematik?indikator=X&year=Y`.

**Belum ada**: deep-link generation otomatis dari chat ke peta. Ini gap untuk fitur masa depan.

### 11.2 Semantic search

Endpoint `/peta-tematik/indikator-search` bisa dipanggil dari **command palette** di PWA (cmdk-based). User ketik bebas → dapat ranked suggestion indikator berdasarkan cosine similarity 768-dim. Praktis untuk user yang tidak tahu nama persis indikator BPS.

### 11.3 Export

- **PNG/PDF export** (admin panel): pakai library `dom-to-image` atau `html2canvas` (cek `ExportButton.tsx` untuk detail).
- **Embed iframe** (PWA): `EmbedModal` generate snippet HTML yang user bisa paste ke website lain.
- **Share URL**: native URL share — URL berisi semua state filter + palette.

---

## 12. Status Implementasi (Per 2026-05-17)

| Fitur | Status | Catatan |
|---|---|---|
| Core choropleth rendering | ✅ Production | Leaflet stack, stable |
| 5 palette editorial | ✅ Production | Hover outline rule established |
| Quantile 5-bin fixed | ✅ Production | Jenks/Equal kode ada tapi hidden |
| Linked bar chart | ✅ Production | Sortable, bidirectional hover |
| Detail drawer (history + rank) | ✅ Production | DOMPurify sanitize |
| Time scrubber (year) | ✅ Production | Month conditional pada `has_monthly` |
| URL state persistence | ✅ Production | Shareable link |
| Semantic search (cmdk) | ✅ Production | <50ms in-memory cosine |
| Indikator eligibility scan | ✅ Production | 204/311 eligible, 3 excluded |
| Indicator metadata enrichment | ✅ Production | Bulk lookup, no N+1 |
| Admin GeoJSON upload | ✅ Production | Path safety + dedup hash |
| Admin dashboard widget | ✅ Production | Lazy-mount, React Query |
| Auto Insights (AI commentary) | 🟡 Beta | Komponen ada, logic perlu di-verify |
| Compare Mode (period vs period) | 🟡 Beta | Komponen ada, logic perlu di-verify |
| Binning selector UI | ⏳ Hidden | Decision: UX simplification |
| Kecamatan/desa level | ❌ Out of scope | MVP fokus kab/kota |
| Chat AI → peta deep link | ❌ Future | `geoInference` ada, integrasi belum |
| Real-time cache invalidation | ❌ Future | 1h TTL diterima untuk MVP |

---

## 13. Known Limitations & Edge Cases

1. **Maluku Utara provinsi total** muncul di `dim_value` bersama 10 kab/kota. Peta tidak mewarnai (`regionMap` return `null`), tapi summary endpoint *pakai* untuk `provinsi_total` field.
2. **`indikator_418` multi-dim** — sengaja excluded karena butuh sub-filter (Unit Layanan Pelanggan PLN). MVP tidak punya UI untuk multi-dim breakdown.
3. **Anomali `year=0`** — query filter `WHERE year > 0` di service layer.
4. **Format nama wilayah inkonsisten** — BPS dim_value `"Halmahera Barat"` vs GeoJSON `"Kabupaten Halmahera Barat"`. Solved oleh `regionMap.dimValueToKdkab()` (strip prefix).
5. **Multi-metric per indikator** — beberapa indikator punya metric: `value`, `month-to-month`, `year-on-year`. UI default ambil metric pertama; user pilih dropdown.
6. **`month_no` non-standar** — 0 (annual), 1-12 (bulan), 31-37 (triwulan/sentinel). UI hanya expose month scrubber jika `has_monthly === true`.
7. **Cache backend in-process** — restart backend = cold cache. Indikator-list scan ulang ~3-5 detik untuk first request post-restart.
8. **GeoJSON 11 MB** — bisa lambat di mobile dengan jaringan lambat. PWA cache 24 jam membantu visit berikut.
9. **No Redis** — kalau scale ke multi-instance, cache TIDAK shared antar instance.

---

## 14. Testing

### Backend unit tests
- `backend/src/__tests__/petaTematik.service.test.js` — getYears/getMetrics/getData + caching behavior
- `backend/src/__tests__/petaTematik.cache.test.js` — cache hit/miss/eviction
- `backend/src/__tests__/petaTematik.regionMap.test.js` — kdkab mapping (regression test untuk swap 03/05)
- `backend/src/__tests__/petaTematik.categorization.test.js` — keyword ordering rules
- `backend/src/__tests__/petaTematik.eligibilityScanner.test.js` — eligibility kriteria

### Frontend E2E
- `frontend/e2e/peta-tematik.spec.ts` — Playwright happy-path: load, pilih indikator, ganti year, klik polygon, drawer terbuka.

### Manual verification checklist
Lihat juga [`docs/peta-tematik/INDIKATOR_DAFTAR.md`](./INDIKATOR_DAFTAR.md) untuk audit dataset.

---

## 15. Dependencies

### Backend
```json
{
  "express": "^4.x",
  "sequelize": "^6.x",
  "lru-cache": "^9.x",
  "multer": "^1.x"
}
```

### Frontend PWA & Admin
```json
{
  "leaflet": "^1.9.4",
  "react-leaflet": "^4.2.1",
  "@types/leaflet": "^1.9.21",
  "dompurify": "^3.x",
  "cmdk": "^1.x",
  "@tanstack/react-query": "^5.x"  // admin only
}
```

---

## 16. Troubleshooting

### "Polygon tidak terwarna walaupun ada data"
1. Cek `regionMap.service.js` — `dim_value` dari BPS match `NAME_TO_KDKAB`?
2. Cek GeoJSON properties — `kdkab` ada di tiap feature?
3. Cek browser console — error fetch `/api/peta-tematik/data`?
4. Cek backend log — service throw error?

### "Indikator baru tidak muncul di picker"
1. Cek `eligibilityScanner` — apakah tabel punya breakdown 10 kab/kota dengan value non-null?
2. Cek apakah masuk excluded list (418/159/160).
3. Cek cache — restart `pds-backend` atau tunggu 1 jam.

### "Map blank / tile tidak load"
1. Cek koneksi ke OSM tiles (tile.openstreetmap.org).
2. Cek apakah GeoJSON ter-load (Network tab).
3. Cek apakah `center` dan `zoom` masuk akal (Maluku Utara: ~-0.78, 127.85).

### "Setelah edit `.tsx`, perubahan tidak terlihat"
- PWA: `cd frontend && npm run build && pm2 reload pds-frontend --update-env`
- Admin: `cd backend/admin && npm run build && pm2 reload pds-admin --update-env`
- PM2 reload **tidak** rebuild. Skip build = silent no-deploy.

### "Hover outline tidak terlihat di polygon paling gelap"
- Pastikan palette pakai `hoverOutline` *komplementer*, bukan same-hue. Lihat [`docs/memory/peta_tematik_palettes.md`](../memory/peta_tematik_palettes.md).

---

## 17. Lampiran — Referensi Cepat Path File

### Backend
```
backend/src/services/petaTematik/
├── petaTematik.service.js          # Main orchestrator
├── regionMap.service.js            # kdkab canonical mapping
├── categorization.service.js       # 8-category keyword rules
├── eligibilityScanner.service.js   # Scan 310+ tabel
├── metadataLookup.service.js       # Indicator + metric meta, semantic search
└── cache.service.js                # LRU wrapper

backend/src/routes/
├── peta-tematik.routes.js          # Authenticated
├── peta-tematik.public.routes.js   # Public, rate-limited
└── geojson.routes.js               # GeoJSON management

backend/src/controllers/
├── peta-tematik.controller.js      # API handler
└── geojson.controller.js           # GeoJSON CRUD

backend/public/geojson/
└── peta_kabko_malut.geojson        # 11MB, 10 features
```

### Frontend PWA
```
frontend/src/app/(admin)/peta-tematik/
├── page.tsx
├── PetaTematikClient.tsx
├── ChoroplethMap.tsx
├── colorScale.ts
├── types.ts
├── useUrlState.ts
└── components/...

frontend/src/app/api/peta-tematik/
├── indikator-list/route.ts
├── data/route.ts
├── geojson/route.ts                # Cache 24h
├── years/route.ts
├── metrics/route.ts
├── summary/route.ts
├── indikator-search/route.ts
└── indikator-meta/[id]/route.ts
```

### Admin
```
backend/admin/components/peta-tematik/
├── PetaTematikSection.tsx          # Lazy-mounted widget
├── ChoroplethMap.tsx
├── FilterBar.tsx
├── MapLegend.tsx
├── InfoPanel.tsx
├── ExportButton.tsx
├── TopBottomList.tsx
├── ProvinsiTotalCard.tsx
├── IndikatorPicker.tsx
├── TrendSparkline.tsx
├── colorScale.ts
├── types.ts
└── api.ts                          # React Query
```

### Dokumentasi terkait
```
docs/peta-tematik/
├── ARSITEKTUR_LENGKAP.md           # ← Dokumen ini
└── INDIKATOR_DAFTAR.md             # Audit eligibility 308 indikator

docs/memory/
├── peta_tematik_palettes.md        # Palette design rationale
└── peta_tematik_kdkab.md           # kdkab swap warning

docs/workspace/
├── backend.md                      # Backend area docs
├── frontend.md                     # Frontend area docs
└── database.md                     # DB schema docs
```

---

## Change Log

| Tanggal | Penulis | Perubahan |
|---|---|---|
| 2026-05-17 | Claude (Opus 4.7) | Dokumen awal — bedah lengkap fitur peta tematik berdasarkan eksplorasi codebase per 2026-05-17 |
