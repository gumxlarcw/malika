# Changelog — Peta Tematik MALIKA

Semua perubahan signifikan pada fitur **Peta Tematik** akan didokumentasikan di file ini.

Format mengikuti [Keep a Changelog](https://keepachangelog.com/id-ID/1.1.0/),
dengan versioning berbasis tanggal (`YYYY.MM.DD`) karena MALIKA tidak rilis publik.

> Cakupan changelog ini **khusus fitur peta tematik** (folder `backend/src/services/petaTematik/`, `frontend/src/app/(admin)/peta-tematik/`, `backend/admin/components/peta-tematik/`). Untuk perubahan project-wide, lihat `git log` di root repo.

---

## [Unreleased]

### Planned
- 🧹 Cleanup kode Metabase yang sudah tidak terpakai (4 file: `metabase.controller.js`, `metabase.routes.js`, `embed.service.js`, `admin/app/metabase/page.tsx`)
- 🔌 Integrasi chat AI → deep link ke peta (`geoInference.service.js` infer indikator dari natural language)
- 📈 Verify & finalize `AutoInsights.tsx` (status 🟡 Beta)
- 🔀 Verify & finalize `CompareMode.tsx` (period-vs-period comparison, status 🟡 Beta)
- 🗺 Eksplorasi level kecamatan/desa (post-MVP)
- ⚡ Real-time cache invalidation untuk edit metadata admin

---

## [2026.05.17] — Documentation Sprint

### Added
- 📚 [`README.md`](./README.md) — landing page folder peta-tematik dengan TOC, badge, dan quick start
- 📚 [`ARSITEKTUR_LENGKAP.md`](./ARSITEKTUR_LENGKAP.md) — bedah arsitektur lengkap 17 bagian (~37 KB, 794 baris)
- 📚 [`MIGRASI_METABASE_KE_LEAFLET.md`](./MIGRASI_METABASE_KE_LEAFLET.md) — diagram before/after migrasi (Mermaid + ASCII, ~24 KB, 511 baris)
- 📚 [`CHANGELOG.md`](./CHANGELOG.md) — file ini

### Changed
- Folder `docs/peta-tematik/` kini punya struktur dokumentasi lengkap (sebelumnya hanya `INDIKATOR_DAFTAR.md`)

---

## [2026.05.07] — Rich Metadata Drawer

### Added
- 🎨 Expand detail drawer dengan rich BPS metadata (commit `ff1ba33`)
  - Definisi indikator
  - Formula HTML (sanitized via DOMPurify)
  - Unit + decimal places + multiplier
  - Source citation HTML + BPS table ID
  - BPS last update timestamp

### Changed
- `KabkotaDetailDrawer.tsx` — restructure layout untuk menampung metadata baru
- `metadataLookup.service.js` — extend `resolveMeta()` untuk merge indicator-level + metric-level fields

---

## [2026.05] — Initial Production Release (Leaflet Native)

> **Major version**: migrasi dari Metabase iframe ke Leaflet native stack.

### Added — Backend Service Layer
- 🆕 `backend/src/services/petaTematik/eligibilityScanner.service.js`
  - Scan `information_schema` untuk 310+ tabel `indikator_*`
  - Functional eligibility check: row dengan `dim_value` match + `value IS NOT NULL`
  - 3 tabel di-blacklist: `indikator_418` (multi-dim PLN), `indikator_159`, `indikator_160` (EXIM multidim)
  - Hasil: 204 indikator eligible dari 311 total
- 🆕 `backend/src/services/petaTematik/regionMap.service.js`
  - Mapping kanonik `dim_value` (BPS) ↔ `kdkab` (GeoJSON property)
  - 10 entri: 01-08 (kabupaten) + 71-72 (kota)
  - Strip prefix `"Kabupaten"`/`"Kota"`, lowercase, lookup
  - `Object.freeze()` untuk mencegah mutation
- 🆕 `backend/src/services/petaTematik/petaTematik.service.js`
  - Orchestrator utama: `getIndikatorList`, `getYears`, `getMetrics`, `getData`, `getSummary`
  - Aggregation `AVG(value)` per `dim_value` (aman terhadap duplikasi)
- 🆕 `backend/src/services/petaTematik/categorization.service.js`
  - 8 kategori auto-classified via keyword matching pada `source_name`
  - Urutan rule matters: Ekonomi sebelum Kependudukan
- 🆕 `backend/src/services/petaTematik/metadataLookup.service.js`
  - Lookup ke `indicator_meta` + `indicator_metric_meta`
  - `resolveMeta()` merge indicator-level + metric-level (metric overrides)
  - `getIndikatorMetaBulk()` mencegah N+1 query
  - `semanticSearchIndikator()` — vector cosine 768-dim, in-memory scoring <50ms
- 🆕 `backend/src/services/petaTematik/cache.service.js`
  - Wrapper `lru-cache` v9, max 500 entries, TTL 1 jam
  - Pattern `getOrCompute(key, asyncFn)` async-safe

### Added — Backend API
- 🆕 `GET /peta-tematik/indikator-list` (auth) + `/peta-tematik/public/indikator-list`
- 🆕 `GET /peta-tematik/years?indikator=ID` + public variant
- 🆕 `GET /peta-tematik/metrics?indikator=ID` + public variant
- 🆕 `GET /peta-tematik/data?indikator=ID&year=YYYY[&month=M][&metric=KEY]` + public
- 🆕 `GET /peta-tematik/summary?indikator=ID&year=YYYY[...]` + public
- 🆕 `GET /peta-tematik/indikator-meta/:id` + public
- 🆕 `GET /peta-tematik/indikator-search?q=...&limit=10&min_score=0.5` + public
- 🆕 `parseInt32()` guard untuk validasi `indikator`/`year`/`month` (positif, ≤99999)
- 🆕 `withGuard()` wrapper untuk konsisten error mapping (400 invalid, 500 server)

### Added — GeoJSON Management
- 🆕 `POST /geojson/upload` (multipart, validasi GeoJSON + dedup SHA1)
- 🆕 `GET /geojson` (list semua file)
- 🆕 `GET /geojson/:filename` (public serve, Content-Type `application/geo+json`)
- 🆕 `GET /geojson/:filename/admin` (admin preview)
- 🆕 `PUT /geojson/:filename/properties` (bulk property update)
- 🆕 `DELETE /geojson/:filename` (path traversal guard)
- 🆕 `backend/public/geojson/peta_kabko_malut.geojson` (11 MB, 10 polygon)

### Added — Frontend PWA (`frontend/src/app/(admin)/peta-tematik/`)
- 🆕 `page.tsx` — server wrapper, `force-dynamic` (no SSG)
- 🆕 `PetaTematikClient.tsx` — main orchestrator (~280 baris)
- 🆕 `ChoroplethMap.tsx` — Leaflet 1.9.4 + react-leaflet 4.2.1
  - Center `[-0.78, 127.85]`, zoom 7
  - Basemap OpenStreetMap
  - `fitBounds()` dengan ResizeObserver
- 🆕 `colorScale.ts` — 5 palette editorial:
  - **Blue** (default) — `#ecf3ff → #262e89`, hover outline `red-600`
  - **Emerald** — `#ecfdf5 → #064e3b`, hover outline `red-600`
  - **Amber** — `#fffbeb → #78350f`, hover outline `blue-700`
  - **Rose** — `#fff1f2 → #881337`, hover outline `green-700`
  - **Purple** — `#faf5ff → #581c87`, hover outline `green-600`
  - 3 binning method: quantile (default, fixed di UI), jenks, equal
- 🆕 `KabkotaDetailDrawer.tsx` — slide-out detail
- 🆕 `LinkedBarChart.tsx` — 10 bar sortable, linked hover ↔ peta
- 🆕 `TimeScrubber.tsx` — year slider, month conditional
- 🆕 `ShareBar.tsx` + `EmbedModal.tsx` — share/embed
- 🆕 `CommandPalette.tsx` — cmdk-based semantic search
- 🆕 `EditorialHeader.tsx` + `MethodologyFooter.tsx` + `ActiveIndikatorBanner.tsx`
- 🆕 `useUrlState.ts` — URL ↔ filter state sync
- 🆕 `types.ts` — shared TypeScript interfaces

### Added — Frontend API Routes (Next.js proxy)
- 🆕 `/api/peta-tematik/indikator-list` (cache: no-store)
- 🆕 `/api/peta-tematik/data` (cache: no-store)
- 🆕 `/api/peta-tematik/geojson` (cache: 24h via `revalidate: 86400`)
- 🆕 `/api/peta-tematik/years`, `/metrics`, `/summary` (cache: no-store)
- 🆕 `/api/peta-tematik/indikator-search`
- 🆕 `/api/peta-tematik/indikator-meta/[id]`

### Added — Admin Panel (`backend/admin/components/peta-tematik/`)
- 🆕 `PetaTematikSection.tsx` — lazy-mounted via IntersectionObserver
- 🆕 `ChoroplethMap.tsx` — simpler version (no linked chart, no drawer)
- 🆕 `FilterBar.tsx`, `MapLegend.tsx`, `InfoPanel.tsx`
- 🆕 `ExportButton.tsx` — export ke PNG/PDF
- 🆕 `TopBottomList.tsx`, `ProvinsiTotalCard.tsx`, `TrendSparkline.tsx`
- 🆕 `IndikatorPicker.tsx` — dropdown bertingkat (kategori → indikator)
- 🆕 `api.ts` — React Query hooks dengan `QUERY_KEYS` konstanta

### Added — Database Migrations
- 🆕 `migrations/20260510_indikator_check_constraints.js` (Phase 4)
  - CHECK `year BETWEEN 2000 AND 2100` di 310 tabel `indikator_*`
  - CHECK `month_no IN (0..12, 31..37)` (annual, monthly, triwulan)
- 🆕 `migrations/20260510_indikator_index_backfill.js`

### Added — Documentation
- 🆕 `docs/peta-tematik/INDIKATOR_DAFTAR.md` — audit eligibility 308 indikator
- 🆕 `docs/superpowers/specs/2026-05-06-peta-tematik-design.md` — design spec
- 🆕 `docs/memory/peta_tematik_palettes.md` — palette design rationale
- 🆕 `docs/memory/peta_tematik_kdkab.md` — kdkab swap warning (03 ↔ 05)
- 🆕 Runbook `react-leaflet × React 19 smoke verification` (commit `7f1d629`)

### Removed
- ❌ **Cakupan terbatas 2 indikator** — sekarang otomatis 204 indikator via eligibility scanner
- ❌ **Ketergantungan server Metabase upstream** — tidak perlu Docker/external server
- ❌ **JWT signed embed URL untuk Metabase** — endpoint masih ada tapi tidak dipakai

### Deprecated
- 🟡 `backend/admin/app/metabase/page.tsx` — page Metabase masih live tapi non-fungsional
- 🟡 `backend/src/services/metabase/embed.service.js` — JWT signer idle
- 🟡 `backend/src/controllers/metabase.controller.js` — controller idle
- 🟡 `backend/src/routes/metabase.routes.js` — `/metabase/embed/dashboard/:id` masih terdaftar
- 🟡 Env vars `METABASE_SITE_URL`, `METABASE_SECRET_KEY` — tidak dipakai aktif
- > **Rekomendasi**: cleanup PR untuk hapus 4 file di atas setelah 1-2 bulan stabil

### Security
- 🔒 GeoJSON upload: path traversal prevention via `path.basename()` + reject `..`
- 🔒 GeoJSON upload: extension whitelist (`.geojson`, `.json`)
- 🔒 GeoJSON upload: dedup SHA1 hash 8-char untuk filename collision
- 🔒 Metadata HTML sanitization client-side via DOMPurify (defense in depth)
- 🔒 API validation: `parseInt32()` reject negative/non-integer/too-large
- 🔒 `regionMap` hard-coded whitelist 10 kab/kota (no user input bypass)

### Performance
- ⚡ LRU cache 1 jam mengurangi load DB ~95% post-warmup
- ⚡ GeoJSON cache 24 jam di Next.js fetch + browser
- ⚡ Bulk metadata lookup (no N+1)
- ⚡ Semantic search in-memory cosine (<50ms untuk 302 rows)
- ⚡ Admin dashboard widget lazy-mount via IntersectionObserver (100px rootMargin)
- ⚡ Parallel fetch data + metadata (different DBs, no lock)

### Fixed
- 🐛 kdkab swap insident: `03` (Kepulauan Sula) sempat tertukar dengan `05` (Halmahera Utara) — kini canonical di `regionMap.service.js`
- 🐛 7 false-positive eligibility: tabel provinsi-level/single-kab yang mention nama tapi tidak ada breakdown — solved via functional check (`dim_value` match + `value IS NOT NULL`)
- 🐛 Anomali `year=0` di beberapa indikator — filter `WHERE year > 0` di service layer
- 🐛 Hover outline tidak visible di polygon paling gelap — solved dengan rule: hover outline harus komplementer (cross-hue), bukan same-hue shade

### Testing
- ✅ `backend/src/__tests__/petaTematik.service.test.js`
- ✅ `backend/src/__tests__/petaTematik.cache.test.js`
- ✅ `backend/src/__tests__/petaTematik.regionMap.test.js` (regression untuk swap 03/05)
- ✅ `backend/src/__tests__/petaTematik.categorization.test.js`
- ✅ `backend/src/__tests__/petaTematik.eligibilityScanner.test.js`
- ✅ `frontend/e2e/peta-tematik.spec.ts` (Playwright happy-path)

---

## [Pre-Migration] — Metabase Era (≤ 2026-05-05)

> **Status**: legacy, non-fungsional di production. Server Metabase upstream tidak running.

### Existed
- `backend/admin/app/metabase/page.tsx` — page admin untuk input dashboard ID + render iframe
- `backend/src/services/metabase/embed.service.js` — JWT signing untuk Metabase embed URL
- `backend/src/controllers/metabase.controller.js` — handler `/metabase/embed/dashboard/:id`
- `backend/src/routes/metabase.routes.js` — registrasi route
- Env vars `METABASE_SITE_URL`, `METABASE_SECRET_KEY`
- 2 dashboard Metabase yang ter-cover:
  1. **Perdagangan Luar Negeri** (EXIM — indikator_159, indikator_160)
  2. **Pariwisata** (TPK Hotel, kunjungan wisatawan)

### Pain Points
- Server Metabase upstream tidak running → iframe blank
- Hanya 2 indikator → 200+ indikator BPS lain tidak terjangkau
- Tiap indikator baru harus manual create dashboard di Metabase UI
- Iframe sandbox → tidak bisa linked-hover dengan komponen lain
- Look & feel Metabase tidak konsisten dengan branding MALIKA
- Tidak ada cache control dari sisi MALIKA
- Tambahan secret + URL di env config

---

## Konvensi

### Tipe perubahan
- **Added** — fitur baru
- **Changed** — perubahan pada fitur existing
- **Deprecated** — fitur yang akan dihapus
- **Removed** — fitur yang sudah dihapus
- **Fixed** — perbaikan bug
- **Security** — perubahan terkait keamanan
- **Performance** — perubahan terkait performa
- **Testing** — penambahan/perubahan test

### Format tanggal
- `YYYY.MM.DD` untuk versi rilis
- `[Unreleased]` untuk work-in-progress
- `[Pre-Migration]` untuk era legacy sebelum migrasi besar

### Referensi commit
- Format: `(commit \`abc1234\`)` — short SHA 7-char
- Major releases referensikan plan/spec di `docs/superpowers/specs/` atau `docs/superpowers/plans/`

---

## Tautan

- [Repo MALIKA di GitHub](https://github.com/gumxlarcw/malika)
- [README peta tematik](./README.md)
- [Arsitektur lengkap](./ARSITEKTUR_LENGKAP.md)
- [Diagram migrasi](./MIGRASI_METABASE_KE_LEAFLET.md)
- [Audit indikator](./INDIKATOR_DAFTAR.md)
- [Design spec original](../superpowers/specs/2026-05-06-peta-tematik-design.md)
