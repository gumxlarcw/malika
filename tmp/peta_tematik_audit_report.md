# Audit Eligibility Indikator untuk Peta Tematik

> Tanggal scan: 2026-05-06
> Total tabel `indikator_*` di `data_bps`: **311**
> Detail TSV: `tmp/indikator_audit.tsv`

## Ringkasan

| Kategori | Jumlah |
|---|---|
| ✅ ELIGIBLE — punya breakdown 10 kab/kota Malut | **204** |
| ❌ NOT-eligible | 107 |

## Kriteria ELIGIBLE

Tabel `dim_value`-nya mengandung minimal salah satu dari 10 nama kab/kota Maluku Utara:
Halmahera Barat, Halmahera Tengah, Halmahera Utara, Halmahera Selatan, Halmahera Timur,
Kepulauan Sula, Pulau Morotai, Pulau Taliabu, Ternate, Tidore Kepulauan
(varian dengan/tanpa prefix "Kabupaten "/"Kota " juga dideteksi).

## Distribusi NOT-eligible (alasan)

| Pola dim_key | Jumlah | Penjelasan |
|---|---:|---|
| `Wilayah` (TAPI value bukan wilayah) | 35 | Misal kelompok umur (`0–4`, `15–19`), status pekerjaan, kategori — bukan geografis |
| `(kosong)` | 23 | Provinsi-level only (mis. inflasi, IHK, NTP) |
| `Propinsi` | 6 | Provinsi-level only (Penduduk Miskin, Gini Ratio, dll) |
| `Lapangan Usaha (Kategori)` | 5 | PDRB per sektor — non-geografis |
| `Komponen Pengeluaran (Triwulanan)` | 5 | PDRB pengeluaran |
| `Komponen Pengeluaran` | 5 | PDRB pengeluaran |
| `Triwulan` | 2 | Dimensi waktu, bukan wilayah |
| `TPAK dan TPT` | 2 | Indikator metrik, bukan wilayah |
| `Kelompok Umur Pendidikan` | 2 | Demografis non-geografis |
| `IDI Provinsi Maluku Utara` | 2 | Subindikator IDI |
| `hs2|pod|ctr|kodehs` (EXIM) | 2 | Multidimensi ekspor/impor — POD bisa Ternate/Obi tapi bukan struktur kab/kota standar |
| Lainnya | sisanya | |

## Karakteristik ELIGIBLE

**Sub-dimensi:** hanya **1 dari 204** yang multi-dim (`indikator_418` Pelanggan Listrik
punya `Kabupaten/Kota` + `Unit Layanan Pelanggan`). Sisanya tunggal — mudah di-render.

**Coverage tahun terbaru:**
| Latest year | Jumlah indikator |
|---:|---:|
| 2025 | 41 |
| 2024 | 78 |
| 2023 | 45 |
| 2022 | 18 |
| 2021 | 6 |
| 2020 | 5 |
| 2019 | 6 |
| ≤2017 | 4 |
| `0` (anomali) | 1 |

**Panjang time-series:**
| Jumlah tahun unik | Indikator |
|---:|---:|
| 7 thn | 35 |
| 10 thn | 30 |
| 5 thn | 24 |
| 8 thn | 22 |
| 9 thn | 20 |
| ≤4 thn | 49 (8+15+24+2) |

## Edge cases yang perlu keputusan design

1. **`dim_value='Maluku Utara'` muncul bersama 10 kab/kota.**
   Di kebanyakan tabel ELIGIBLE, baris "Maluku Utara" (provinsi total) ada di samping
   10 kab/kota. Di peta tematik, ini perlu di-exclude (atau ditampilkan sebagai
   nilai pembanding di legend, bukan polygon).

2. **`indikator_418` multi-dim.** Butuh sub-filter tambahan ("Unit Layanan Pelanggan")
   atau diagregasi sum/avg sebelum dipetakan. Bisa di-skip di MVP jika tidak prioritas.

3. **Anomali `year=0`.** Perlu filter `WHERE year > 0`.

4. **Format nama wilayah tidak seragam.** GeoJSON pakai `nama_kab="Kabupaten Halmahera Barat"`,
   sedangkan `dim_value` di indikator pakai `Halmahera Barat` (tanpa prefix). Perlu mapping
   layer (pakai `kdkab` sebagai jembatan, atau strip prefix "Kabupaten "/"Kota ").

5. **Bulan opsional.** Banyak indikator pakai `month_no=0` (snapshot tahunan).
   Yang punya `month_no` 1–12 bisa difilter per bulan, atau diagregasi (sum/avg).

6. **Multiple metric per row.** Beberapa indikator punya kolom `metric` dengan nilai berbeda
   per baris (mis. `month-to-month`, `year-on-year`). Untuk peta tematik, perlu ditentukan
   metric default, atau dropdown metric sebagai filter ketiga.
