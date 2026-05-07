# data_bps schema (ringkas)

Dokumen ini merangkum struktur database `data_bps` yang dipakai aplikasi sebagai **source of truth** untuk penyajian data (metabase-safe).

## Ringkasan tabel
Saat ini terdeteksi **39 tabel** di `data_bps`:
- `indikator_<source_id>`: 33 tabel (mis. `indikator_1`, `indikator_159`, `indikator_160`, dst)
- `data_merged_cache`: 1 tabel
- `kodehs_indd`: 1 tabel
- `pressrelease_kw_*`: 4 tabel (hasil replikasi press release per keyword)

Daftar tabel lengkap tersimpan di `tmp/data_bps_tables.txt`.
Daftar kolom lengkap tersimpan di `tmp/data_bps_columns.tsv`.

## 1) Pola tabel indikator: `indikator_<source_id>`
Semua tabel indikator yang terdeteksi memakai pola kolom yang sama (metabase-oriented):

Kolom utama:
- `id` (PK, auto increment)
- `source_id` (int)
- `source_name` (varchar)
- `signature` (varchar)
- `th_id` (varchar(32))
- `year` (smallint)
- `month_no` (tinyint 1–12, atau 0 untuk static)
- `month_name` (varchar)

Dimensi (opsional tergantung tipe indikator):
- `hs2` (varchar)
- `hs2_name` (varchar)
- `pod` (varchar)
- `ctr` (varchar)
- `kodehs` (varchar)
- `dim_key` (varchar)
- `dim_value` (varchar)
- `dim_hash` (varchar)

Metrik:
- `metric` (varchar) — contoh yang ditemukan:
  - EXIM: `value`, `netweight`
  - Non-EXIM: bisa `month-to-month`, `year-on-year`, dll
- `value` (decimal(30,6), nullable)

Audit:
- `last_update` (datetime)
- `created_at`, `updated_at` (datetime)

Catatan:
- Untuk EXIM, aplikasi mem-pivot baris `metric=value/netweight` menjadi kolom `value` & `netweight`.
- Nama bab HS2 bahasa Indonesia sebaiknya diambil dari `kodehs_indd` (lihat tabel di bawah), bukan mengandalkan `hs2_name` di indikator.

## 2) Lookup HS2: `kodehs_indd`
Dipakai untuk memperkaya label HS2 (bab):
- `hs2digit` (varchar(2), PK)
- `bab_eng` (text)
- `bab_ind` (text)
- `bab_ind_singkat` (text)

## 3) Cache merge: `data_merged_cache`
- `id` (PK)
- `source_id` (indexed)
- `signature` (varchar)
- `merged_json` (longtext)
- `last_update` (datetime)
- `created_at`, `updated_at`

## 4) Press release per keyword: `pressrelease_kw_*`
Contoh struktur (semua `pressrelease_kw_*` serupa):
- `brs_id` (PK)
- `keyword` (indexed)
- `source_id` (int)
- `title` (text)
- `abstract` (longtext)
- `rl_date` (date, indexed)
- `updt_date` (date)
- `subj_id`, `subj` (opsional)
- `subcsa_id`, `subcsa` (opsional)
- `pdf_url`, `slide_url`, `thumbnail_url`
- `hit`, `size`
- `last_update`, `created_at`, `updated_at`
- `infographics`, `pdf`, `slide`, `thumbnail` (longtext)
