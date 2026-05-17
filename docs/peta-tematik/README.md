# Peta Tematik MALIKA

> **Visualisasi choropleth interaktif untuk 204 indikator BPS Maluku Utara di tingkat kabupaten/kota.**
> Bagian dari [MALIKA](../../README.md) — sistem analitik & wawasan BPS Provinsi Maluku Utara.

[![Status](https://img.shields.io/badge/status-production-success)]()
[![Stack](https://img.shields.io/badge/stack-Leaflet%201.9.4-blue)]()
[![Indikator](https://img.shields.io/badge/indikator-204%20eligible-informational)]()
[![Cakupan](https://img.shields.io/badge/cakupan-10%20kab%2Fkota-orange)]()

---

## TL;DR

Fitur peta tematik MALIKA memungkinkan pengguna **memilih indikator BPS** (kepadatan penduduk, TPK hotel, kemiskinan, dst.), **memilih tahun/bulan/metrik**, dan **melihat sebaran spasial** di 10 kabupaten/kota Maluku Utara dalam bentuk choropleth 5-bin kuantil dengan 5 palet editorial.

Sebelumnya fitur ini berjalan di atas **Metabase iframe dengan hanya 2 indikator** (Perdagangan Luar Negeri & Pariwisata). Migrasi Mei 2026 menggantinya dengan **Leaflet native stack yang otomatis menjangkau 204 indikator**.

---

## 📚 Dokumen di folder ini

| File | Fungsi | Ukuran |
|---|---|---|
| **[`ARSITEKTUR_LENGKAP.md`](./ARSITEKTUR_LENGKAP.md)** | Bedah arsitektur lengkap (17 bagian) — backend services, API, frontend components, caching, troubleshooting | ~37 KB |
| **[`MIGRASI_METABASE_KE_LEAFLET.md`](./MIGRASI_METABASE_KE_LEAFLET.md)** | Flow diagram before/after migrasi — Mermaid + ASCII, sequence flow, mapping komponen | ~24 KB |
| **[`INDIKATOR_DAFTAR.md`](./INDIKATOR_DAFTAR.md)** | Audit eligibility 308 indikator (full/partial/empty coverage) | ~35 KB |
| **[`CHANGELOG.md`](./CHANGELOG.md)** | Log perubahan fitur per versi | — |
| **[`README.md`](./README.md)** | (file ini) entry point | — |

---

## 🗺 Cakupan

- **204 indikator BPS** otomatis ter-discover via eligibility scanner
- **10 kabupaten/kota** Maluku Utara (8 kabupaten + 2 kota)
- **8 kategori** auto-classified: Ekonomi, Kependudukan, Ketenagakerjaan, Pendidikan, Kesehatan, Pariwisata & Akomodasi, Pembangunan & Sosial, Lainnya
- **Time series** rata-rata 5-10 tahun per indikator (tergantung ketersediaan BPS)
- **Granularity**: tahunan + bulanan (kondisional pada `has_monthly`)

---

## 🧩 Stack Teknologi

### Backend (`backend/`)
- **Express** 4.x — REST API
- **Sequelize** 6.x — ORM ke MariaDB
- **lru-cache** 9.x — caching layer (TTL 1 jam, max 500 entries)
- **multer** — GeoJSON upload handling
- **MariaDB 11.8** — `data_bps` (replica) + `project_data_strategis` (metadata)

### Frontend PWA & Admin (`frontend/`, `backend/admin/`)
- **Next.js** 14+
- **React** 19.2.1
- **Leaflet** 1.9.4 + **react-leaflet** 4.2.1 — peta interaktif
- **DOMPurify** — sanitasi HTML metadata
- **cmdk** — command palette + semantic search
- **@tanstack/react-query** (admin only) — server state management

---

## 🚀 Arsitektur Tingkat Tinggi

```
┌────────────────────────────────────────────────────────────────┐
│  USER → Browser → PWA / Admin Panel                             │
│                       ↓                                          │
│              Next.js API routes (proxy + cache)                 │
│                       ↓                                          │
│              Express backend (controllers)                      │
│                       ↓                                          │
│         ┌─────────────┴─────────────┐                          │
│         ↓                            ↓                          │
│  petaTematik.service          GeoJSON file                     │
│  + 5 sub-services             (11 MB, 10 polygon)              │
│         ↓                                                       │
│  ┌──────┴──────┐                                               │
│  ↓             ↓                                               │
│  data_bps   project_data_strategis                             │
│  (BPS data)  (metadata + 768d embeddings)                      │
└────────────────────────────────────────────────────────────────┘
```

Detail lengkap di [`ARSITEKTUR_LENGKAP.md §2-§3`](./ARSITEKTUR_LENGKAP.md#2-arsitektur-tingkat-tinggi).

---

## 🛠 Quick Start (Developer)

### Prasyarat
- `pds-backend` PM2 process running di port 5000
- `pds-frontend` PM2 process running di port 6060
- `pds-admin` PM2 process running di port 5050
- MariaDB 11.8 dengan database `data_bps` + `project_data_strategis`
- GeoJSON Maluku Utara di `backend/public/geojson/peta_kabko_malut.geojson`

### Akses fitur

| URL | Akses |
|---|---|
| `https://malika.bpsmalut.com/peta-tematik` | Public PWA |
| `https://api-malika.bpsmalut.com/admin/peta-tematik` | Admin panel (auth required) |

### Endpoint API utama

```bash
# Daftar indikator eligible
curl https://api-malika.bpsmalut.com/peta-tematik/public/indikator-list

# Data per kab/kota untuk indikator + tahun
curl 'https://api-malika.bpsmalut.com/peta-tematik/public/data?indikator=182&year=2024'

# Summary (provinsi total, top3/bottom3, trend 5 tahun)
curl 'https://api-malika.bpsmalut.com/peta-tematik/public/summary?indikator=182&year=2024'

# Semantic search indikator
curl 'https://api-malika.bpsmalut.com/peta-tematik/public/indikator-search?q=hotel&limit=5'

# GeoJSON 10 polygon Malut
curl https://api-malika.bpsmalut.com/geojson/peta_kabko_malut.geojson
```

Reference lengkap di [`ARSITEKTUR_LENGKAP.md §4`](./ARSITEKTUR_LENGKAP.md#4-backend--api-endpoints).

---

## 🗂 Lokasi Kode Utama

```
backend/src/services/petaTematik/        ← Service layer (6 files)
├── eligibilityScanner.service.js        ← Audit kelayakan 310+ tabel BPS
├── regionMap.service.js                 ← Pemetaan kanonik dim_value ↔ kdkab
├── petaTematik.service.js               ← Orchestrator utama
├── categorization.service.js            ← Klasifikasi 8 kategori
├── metadataLookup.service.js            ← Metadata + semantic search 768d
└── cache.service.js                     ← LRU wrapper

backend/src/controllers/
├── peta-tematik.controller.js           ← API handler
└── geojson.controller.js                ← GeoJSON CRUD (admin)

backend/src/routes/
├── peta-tematik.routes.js               ← Authenticated
├── peta-tematik.public.routes.js        ← Public (rate-limited)
└── geojson.routes.js                    ← GeoJSON admin

frontend/src/app/(admin)/peta-tematik/   ← PWA
├── page.tsx
├── PetaTematikClient.tsx                ← Main orchestrator
├── ChoroplethMap.tsx                    ← Leaflet map
├── colorScale.ts                        ← 5 palette editorial + binning
└── components/...                       ← Drawer, bar chart, scrubber, dll

backend/admin/components/peta-tematik/   ← Admin widget (lazy-mount)

backend/public/geojson/
└── peta_kabko_malut.geojson             ← 11 MB, 10 polygon
```

---

## ✨ Fitur Utama

| Fitur | Status |
|---|---|
| Choropleth 5-bin kuantil | ✅ Production |
| 5 palet editorial (Blue default, Emerald, Amber, Rose, Purple) | ✅ Production |
| Linked bar chart (hover ↔ peta) | ✅ Production |
| Detail drawer (history 5 tahun + ranking + metadata) | ✅ Production |
| Time scrubber (year + month opsional) | ✅ Production |
| URL state persistence (shareable link) | ✅ Production |
| Semantic search 768-dim (cmdk palette) | ✅ Production |
| Admin dashboard widget + export PNG | ✅ Production |
| GeoJSON upload + property bulk edit | ✅ Production |
| Auto Insights (AI commentary) | 🟡 Beta |
| Compare Mode (period vs period) | 🟡 Beta |
| Kecamatan/desa level | ❌ Out of scope (MVP kab/kota) |

---

## 🤝 Berkontribusi

Untuk perubahan pada fitur peta tematik:

1. **Baca dulu** [`ARSITEKTUR_LENGKAP.md`](./ARSITEKTUR_LENGKAP.md) untuk paham arsitektur.
2. **Cek** [`docs/memory/peta_tematik_palettes.md`](../memory/peta_tematik_palettes.md) untuk aturan palette editorial.
3. **Cek** [`docs/memory/peta_tematik_kdkab.md`](../memory/peta_tematik_kdkab.md) untuk warning kdkab swap (03 ↔ 05).
4. **Build wajib sebelum deploy**:
   - Admin: `cd backend/admin && npm run build && pm2 reload pds-admin --update-env`
   - PWA: `cd frontend && npm run build && pm2 reload pds-frontend --update-env`
   - Backend (`.js` changes): `pm2 reload pds-backend --update-env` (no build needed)
5. **Update [`CHANGELOG.md`](./CHANGELOG.md)** untuk perubahan signifikan.
6. **No `Co-Authored-By` trailer** di commit (project preference).

---

## 🐛 Troubleshooting

Common issues di [`ARSITEKTUR_LENGKAP.md §16`](./ARSITEKTUR_LENGKAP.md#16-troubleshooting):

- Polygon tidak terwarna walaupun ada data
- Indikator baru tidak muncul di picker
- Map blank / tile tidak load
- Hover outline tidak terlihat di polygon paling gelap
- Setelah edit `.tsx`, perubahan tidak terlihat (build skipped)

---

## 📜 Lisensi

Internal use — milik BPS Provinsi Maluku Utara. Tidak untuk redistribusi publik.

---

## 🔗 Referensi Terkait

- [Design spec original (2026-05-06)](../superpowers/specs/2026-05-06-peta-tematik-design.md)
- [Palette design rationale](../memory/peta_tematik_palettes.md)
- [kdkab swap warning](../memory/peta_tematik_kdkab.md)
- [Workspace docs](../workspace/) — `backend.md`, `frontend.md`, `admin.md`, `database.md`
- [BPS API docs](../reference/BPS_API_DOCS.md)
- [Data BPS schema](../reference/DATA_BPS_SCHEMA.md)
