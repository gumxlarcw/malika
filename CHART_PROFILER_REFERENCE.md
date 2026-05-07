# Chart Data Profiler Reference

## Overview

The Chart Data Profiler (`frontend/src/lib/chartDataProfiler.ts`) automatically analyzes datasource structures and recommends optimal chart configurations. Currently includes **315 pre-computed mappings** for all visible datasources (157 dynamic, 150 interop, 2 exim, 4 pressrelease, 2 static).

## Profile Types

| Profile | Description | Chart Type | Example |
|---------|-------------|------------|---------|
| `time-series-monthly` | Bulan + 1-3 metrics | Line | Inflasi, NTP, IHK |
| `time-series-multi-metric` | Bulan + multiple series | Line | TPK Hotel, Tamu Hotel |
| `geo-single-metric` | Wilayah + 1 Nilai | Bar | Gini, TPT per Kab |
| `geo-multi-metric` | Wilayah + multiple metrics | Bar | PDAM, Nikah/Cerai |
| `category-comparison` | Category + metrics | Bar | PDRB per Lapangan Usaha |
| `matrix-geo-time` | Bulan + Wilayah + metrics | Line | PDRB Triwulanan per Kab |
| `single-row` | 1 row only | None (Card) | % Miskin Provinsi |
| `few-rows-category` | 2-5 rows | Pie/Bar | IDI per Aspek |
| `exim-time-series` | EXIM data | Line | Ekspor/Impor |
| `empty` | No data | None | - |

## Pre-computed Indicator Mapping

### Dynamic Sources - Time Series

| ID | Name | X Axis | Y Axis | Chart |
|----|------|--------|--------|-------|
| 1 | Inflasi Provinsi | Bulan | month-to-month, year-on-year, year-to-date | Line |
| 2 | IHK Halteng | Bulan | Nilai | Line |
| 17 | NTP | Bulan | Nilai | Line |
| 161 | IHK Provinsi | Bulan | Nilai | Line |
| 162 | NTP | Bulan | Nilai | Line |
| 163 | Inflasi Halteng | Bulan | month-to-month, year-on-year | Line |
| 164 | Inflasi Ternate | Bulan | month-to-month, year-on-year | Line |
| 165 | IHK Ternate | Bulan | Nilai | Line |
| 329 | Impor | Bulan | Nilai CIF (US$), Volume (Kg) | Line |
| 330 | Ekspor | Bulan | Nilai FOB (US$), Volume (Kg) | Line |

### Dynamic Sources - Time Series Multi-Metric

| ID | Name | X Axis | Y Axis | Chart |
|----|------|--------|--------|-------|
| 18 | TPK Hotel | Bulan | Bintang, Non Bintang, Bintang dan Non Bintang | Line |
| 170 | TPK Hotel | Bulan | Bintang, Non Bintang, Bintang dan Non Bintang | Line |
| 173 | Tamu Hotel | Bulan | Asing/Mancanegara, Nusantara | Line |

### Dynamic Sources - Geo Single Metric

| ID | Name | X Axis | Y Axis | Chart |
|----|------|--------|--------|-------|
| 8 | Gini Rasio per Kab/Kota | Wilayah | Nilai | Bar |
| 10 | IPM (LFSP2020) | Wilayah | Nilai | Bar |
| 11 | UHH (LFSP2020) | Wilayah | Nilai | Bar |
| 13 | HLS per Kab/Kota | Wilayah | Nilai | Bar |
| 16 | RLS per Kab/Kota | Wilayah | Nilai | Bar |
| 180 | Proyeksi RT per Kab/Kota | Wilayah | Nilai | Bar |
| 181 | Rasio JK per Kab/Kota | Wilayah | Nilai | Bar |
| 182 | Kepadatan Penduduk | Wilayah | Nilai | Bar |
| 184 | Proyeksi Penduduk per Kab/Kota | Wilayah | Nilai | Bar |
| 201 | TPT per Kab/Kota | Wilayah | Nilai | Bar |
| 202 | TPAK per Kab/Kota | Wilayah | Nilai | Bar |
| 237 | AHH per Kab/Kota | Wilayah | Nilai | Bar |
| 251 | Pengeluaran Perkapita | Wilayah | Nilai | Bar |
| 428 | IPM per Kab/Kota | Wilayah | Nilai | Bar |
| 450 | % Penduduk Miskin per Kab | Wilayah | Nilai | Bar |

### Dynamic Sources - Geo Multi-Metric

| ID | Name | X Axis | Y Axis | Chart |
|----|------|--------|--------|-------|
| 3 | PDAM | Wilayah | Pelanggan, Air Disalurkan (M3), Nilai (Rp) | Bar |
| 246 | Klinik KB | Wilayah | KB, Posyandu | Bar |
| 247 | Tenaga Kesehatan | Wilayah | Dokter, Perawat, Bidan | Bar |
| 248 | Faskes | Wilayah | RS, Puskesmas, Klinik | Bar |
| 249 | Kasus Penyakit | Wilayah | HIV, DBD, TB, Malaria | Bar |
| 367 | Padi | Wilayah | Luas Panen, Produktivitas, Produksi | Bar |
| 395 | Populasi Ternak | Wilayah | Sapi, Kerbau, Kambing, Babi | Bar |
| 451 | Indeks Kemiskinan | Wilayah | P1, P2 | Bar |

### Dynamic Sources - Category Comparison

| ID | Name | X Axis | Y Axis | Chart |
|----|------|--------|--------|-------|
| 19 | TPAK/TPT per JK | TPAK dan TPT | Jumlah, Laki-laki, Perempuan | Bar |
| 20 | Pertumbuhan PDRB per LU | Lapangan Usaha (Kategori) | c-to-c, q-to-q, y-on-y | Bar |
| 198 | TPAK IKG | Jenis Kelamin | Nilai | Bar |
| 199 | Penduduk 15+ per Kegiatan | Kegiatan | Nilai | Bar |
| 200 | TPAK/TPT Kota/Desa | Klasifikasi | TPAK, TPT | Bar |
| 290 | Distribusi PDRB per LU | Lapangan Usaha | Distribusi | Bar |
| 293 | PDRB per LU | Lapangan Usaha | ADHB, ADHK | Bar |

### Dynamic Sources - Single Row (Not Chartable)

| ID | Name | Display As |
|----|------|------------|
| 12 | % Miskin Provinsi | Card/Highlight |
| 14 | Gini Provinsi | Card/Highlight |
| 15 | Garis Kemiskinan Prov | Card/Highlight |
| 183 | Laju Pertumbuhan Penduduk | Card/Highlight |
| 274 | IDI Provinsi | Card/Highlight |
| 278 | IDI Provinsi Lama | Card/Highlight |
| 305 | PDRB Perkapita | Card/Highlight |
| 431 | IKG | Card/Highlight |

### Dynamic Sources - Matrix (Time + Geo)

| ID | Name | X Axis | Y Axis | Filter | Chart |
|----|------|--------|--------|--------|-------|
| 203 | PDRB Triwulanan per Kab | Bulan | ADHB, ADHK | Wilayah | Line |

### Interop Sources

| ID | Name | X Axis | Y Axis | Chart |
|----|------|--------|--------|-------|
| 5 | Nikah Cerai | Wilayah | Nikah, Cerai Talak, Cerai Gugat, Jumlah Cerai | Bar |
| 6 | Keuangan Desa | Wilayah | Pendapatan, Belanja | Bar |
| 174 | Hotel Non-Bintang | Wilayah | Akomodasi, Kamar, Tempat Tidur | Bar |
| 175 | Hotel Bintang | Wilayah | Akomodasi, Kamar, Tempat Tidur | Bar |
| 179 | RT dan ART | Wilayah | Rumah Tangga, Rata-rata ART | Bar |
| 185 | Faktor Cerai | Wilayah | Ekonomi, Perselisihan, Meninggalkan | Bar |
| 186 | Penduduk per Umur JK | Kelompok Umur | Laki-laki, Perempuan, Jumlah | Bar |
| 187 | Demografi per Kab | Wilayah | Penduduk, LPP, Kepadatan, Sex Ratio | Bar |
| 190 | TPT TPAK per Kab | Wilayah | TPT, TPAK | Bar |
| 191 | Kegiatan per Umur | Kelompok Umur | Bekerja, Pengangguran, Bukan AK | Bar |
| 194 | Kegiatan per Pendidikan | Pendidikan | Bekerja, Pengangguran, Bukan AK | Bar |
| 215 | APM APK per Jenjang | Jenjang | APM, APK | Bar |
| 234 | Faskes per Kab | Wilayah | RS, Puskesmas, Klinik, Posyandu | Bar |
| 301 | Distribusi PDRB per LU | Lapangan Usaha | Distribusi | Bar |
| 302 | Laju PDRB per LU | Lapangan Usaha | Laju | Bar |
| 425 | Kemiskinan per Kab | Wilayah | Jumlah Miskin, Persentase | Bar |
| 427 | IPM per Kab/Kota | Wilayah | IPM | Bar |
| 429 | Kemiskinan Prov | Daerah | Garis Kemiskinan, Jumlah Miskin, Persentase | Bar |
| 430 | Indeks Kemiskinan per Daerah | Daerah | P1, P2 | Bar |

### EXIM Sources

| ID | Name | X Axis | Y Axis | Filters | Chart |
|----|------|--------|--------|---------|-------|
| 159 | Ekspor | Bulan | value, netweight | kodehs, pod, ctr | Line |
| 160 | Impor | Bulan | value, netweight | kodehs, pod, ctr | Line |

## Column Pattern Detection

### Time Columns
- `Bulan`, `Month`, `Periode`, `Tanggal`, `Tahun`, `Year`, `Triwulan`, `Quarter`, `Semester`

### Geo Columns
- `Wilayah`, `Kabupaten`, `Kota`, `Kab/Kota`, `Propinsi`, `Provinsi`, `Daerah`, `Kecamatan`, `Desa`, `Kelurahan`

### Metric Columns
- `Nilai`, `Value`, `Jumlah`, `Total`, `Persentase`, `Persen`, `Indeks`, `Index`, `Rasio`, `Ratio`, `Laju`, `Rate`
- Growth indicators: `month-to-month`, `year-on-year`, `year-to-date`, `y-on-y`, `q-to-q`, `c-to-c`
- EXIM: `netweight`, `value`

### EXIM Filter Columns
- `kodehs`, `hs2`, `pod`, `ctr`

## Usage

```typescript
import { profileChartData, getIndicatorChartConfig, INDICATOR_CHART_MAP } from '@/lib/chartDataProfiler';

// Method 1: Use pre-computed config (fastest)
const sourceId = 1;
if (INDICATOR_CHART_MAP[sourceId]) {
  const config = INDICATOR_CHART_MAP[sourceId];
  // config.chartType, config.xAxis, config.yAxis
}

// Method 2: Get full profile with data
const profile = getIndicatorChartConfig(sourceId, columns, rows, 'dynamic');
if (profile.isChartable) {
  const { chartType, xAxis, yAxis, reason } = profile.recommended;
}

// Method 3: Profile any data dynamically
const profile = profileChartData(columns, rows, 'interop');
```

## Integration with SearchInsightsChart

The `SearchInsightsChart` component now accepts:
- `sourceId?: number` - Datasource ID for pre-computed lookup
- `sourceType?: "dynamic" | "interop" | "exim"` - Type hint for profiling

```tsx
<SearchInsightsChart
  rows={rows}
  columns={columns}
  sourceId={159}
  sourceType="exim"
/>
```

## Fallback Behavior

1. If `sourceId` matches a pre-computed entry → use that config
2. Else if columns/rows are provided → run dynamic profiler
3. Else if only data heuristics can determine → use existing heuristics
4. Else → show "unknown" profile, default to bar chart

## Testing

Unit tests are located at `frontend/tests/chartDataProfiler.test.ts`.

```bash
cd frontend
npm run test:build
node --test .tests-dist/tests/chartDataProfiler.test.js
```

**Test Coverage:**
- `INDICATOR_CHART_MAP` - Verify pre-computed mappings exist for common datasources
- `profileChartData` - Dynamic profiling for time-series, geo, category, EXIM data
- `getIndicatorChartConfig` - Pre-computed lookup + dynamic fallback
- `validateChartData` - Data validation and sanitization

**Test Results (14 tests):**
- ✅ Pre-computed mappings for source 1, 8, 159
- ✅ >300 mappings in INDICATOR_CHART_MAP (now 315)
- ✅ time-series-multi-metric detection (inflasi with month-to-month, year-on-year)
- ✅ time-series-monthly detection (single metric)
- ✅ geo-single-metric detection (>5 rows with Wilayah)
- ✅ few-rows-category detection (≤5 rows)
- ✅ exim-time-series detection
- ✅ single-row detection
- ✅ empty/null data handling
- ✅ Pre-computed config lookup
- ✅ Dynamic profiling fallback
- ✅ Unknown source handling
- ✅ Data validation
- ✅ All-zero value warnings

## Complete Coverage (as of January 2026)

All 315 visible datasources in `data_sources` table now have pre-computed chart profiles:

- **Dynamic sources**: 157 mappings (time-series, geo, category profiles)
- **Interop sources**: 150 mappings (mostly geo-multi-metric)
- **EXIM sources**: 2 mappings (159 Ekspor, 160 Impor)
- **PressRelease sources**: 4 mappings (non-chartable document lists)
- **Static sources**: 2 mappings (non-chartable reference data)
