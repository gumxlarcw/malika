# OpenAI Query Builder (v1)

Tujuan: menerjemahkan teks user → JSON terstruktur yang bisa divalidasi, lalu aplikasi membangun deep-link/endpoint deterministik (tetap **data_bps-only**).

## Output contract (JSON strict)
Schema validasi ada di `OPENAI_QUERY_BUILDER_SCHEMA.json`.

Output minimal yang diharapkan:
- `version`: 1
- `intent`: `data|search|pressrelease|unknown`
- `type`: `dynamic|exim|pressrelease|interop|static|unknown`
- `params`: objek parameter (lihat schema)
- `confidence`: 0..1

Contoh (EXIM impor, breakdown HS2, Januari 2024):
```json
{
  "version": 1,
  "intent": "data",
  "type": "exim",
  "params": {
    "q": "impor maluku utara menurut komoditas hs2 januari 2024",
    "source_id": 160,
    "direction": "impor",
    "period": "2024",
    "year": 2024,
    "month": 1,
    "group": "hs2",
    "code_hs": null,
    "pod": null,
    "ctr": null,
    "metric": null
  },
  "confidence": 0.86,
  "notes": null
}
```

## Mapping JSON → deep-link `/data`
Aplikasi (bukan LLM) yang menentukan link final.

### Parameter yang dipakai PWA
- Non-EXIM: `/data?source_id=<id>&period=<year>`
- EXIM: `/data?source_id=<id>&type=exim&period=<year>&month=<1-12>&group=hs2&code_hs=<hs2>&pod=<pod>&ctr=<ctr>&metric=value|netweight`

Mapping rekomendasi:
- Jika `intent=data` dan `params.source_id` valid dan `params.period` terisi → buat `/data?...`
- Jika `intent=data` tapi tidak ada tahun/periode → fallback ke `/search?q=...` (guardrail: hindari deep-link tanpa tahun)
- Jika `type=exim`:
  - `group=hs2` bila query berisi “menurut komoditas”/“komoditas” dan tidak ada HS2 spesifik
  - `code_hs` diisi bila user menyebut HS2 spesifik (2 digit), dan `group` sebaiknya `null`
  - `metric` untuk EXIM hanya boleh `value` atau `netweight` (kalau tidak disebut, biarkan `null`)

## Hubungan dengan struktur `data_bps`
Referensi struktur ada di `DATA_BPS_SCHEMA.md`.

Ringkasnya:
- Semua indikator direplikasi ke tabel `data_bps.indikator_<source_id>`.
- EXIM memakai dimensi `hs2/pod/ctr` dan metrik `value/netweight`.
- Non-EXIM (dynamic/interop/static) umumnya memakai `metric` untuk nama kolom (mis. `year-on-year`) dan disajikan sebagai tabel pivot.
- Nama bab HS2 Indonesia harus dilookup dari `data_bps.kodehs_indd` (`bab_ind_singkat`).

## Guardrails wajib
- OpenAI call **server-side saja**.
- Output query builder harus **JSON strict** dan divalidasi schema.
- Field whitelist:
  - `type` hanya yang dikenal
  - `group` hanya `hs2` (atau null)
  - `month` 1..12
  - `code_hs` harus 2 digit
- Setelah valid, sistem memutuskan final routing, dan semua data tetap diambil dari `data_bps` (tanpa fallback upstream).
