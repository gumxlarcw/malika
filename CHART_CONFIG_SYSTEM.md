# Chart Configuration System

## Ringkasan

Implementasi sistem konfigurasi chart berbasis database untuk menghindari deteksi dinamis yang kompleks dan rentan error.

## Arsitektur

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   data_bps      │────▶│analyzeIndicators│────▶│indicator_analysis│
│ indikator_*     │     │     .js         │     │     .json        │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                         │
                                                         ▼
                        ┌─────────────────┐     ┌─────────────────┐
                        │data_sources     │◀────│generateChartConfigs│
                        │.chart_config    │     │     .js          │
                        └─────────────────┘     └─────────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │ SearchInsightsChart │
                        │   (PWA Component)   │
                        └─────────────────┘
```

## File & Lokasi

### Scripts (backend/scripts/)
- `analyzeIndicators.js` - Menganalisis semua tabel indikator di `data_bps`
- `generateChartConfigs.js` - Generate dan simpan chart_config ke database

### Database
- **Table**: `data_sources`
- **Column**: `chart_config` (JSON)
- **Fields**:
  - `chart_type`: 'line' | 'bar'
  - `period_type`: 'monthly' | 'quarterly' | 'yearly' | 'unknown'
  - `data_type`: 'simple' | 'geo' | 'geo-categorical' | 'categorical'
  - `facet_column`: string (kolom untuk category selector)
  - `available_metrics`: string[] (list metrik tersedia)
  - `default_metric`: string (metrik default)
  - `has_geo_dimension`: boolean
  - `has_facet_dimension`: boolean
  - `year_range`: { min, max }

### Frontend
- `SearchInsightsChart.tsx` - Menerima prop `chartConfig` dari parent
- `SearchPageClient.tsx` - Meneruskan `chart_config` dari API ke komponen

### API Response
```json
{
  "exact": {
    "datasources": [{
      "id": 284,
      "title": "[Seri 2010] Laju Pertumbuhan PDRB...",
      "chart_config": {
        "chart_type": "line",
        "period_type": "quarterly",
        "data_type": "categorical",
        "default_metric": "y-on-y"
      }
    }]
  }
}
```

## Cara Penggunaan

### 1. Analisis Ulang Indikator (jika ada perubahan data)
```bash
cd backend
node scripts/analyzeIndicators.js
```
Output: `/tmp/indicator_analysis.json`

### 2. Generate Chart Configs
```bash
# Preview (dry-run)
node scripts/generateChartConfigs.js --dry-run

# Apply ke database
node scripts/generateChartConfigs.js
```

### 3. Statistik Hasil
```
By Period Type:
  monthly: 25
  quarterly: 18
  yearly: 265
  unknown: 3

By Data Type:
  simple: 33
  geo: 206
  geo-categorical: 40
  categorical: 32

By Recommended Chart:
  line: 43
  bar: 268
```

## Prioritas Config

SearchInsightsChart menggunakan urutan prioritas:
1. **Database config** (`chart_config` dari API) - tertinggi
2. **Profiler result** (analisis dinamis dari data)
3. **Heuristic fallback** (deteksi otomatis berdasarkan label/nilai)

## Manual Override per Indikator

Jika perlu override config untuk indikator tertentu:

```sql
UPDATE data_sources 
SET chart_config = JSON_SET(
  chart_config, 
  '$.chart_type', 'line',
  '$.period_type', 'quarterly'
)
WHERE id = 284;
```

## Testing

```bash
# Frontend tests
cd frontend && npm run test:nonexim

# Verify API
curl -s "http://localhost:6060/api/search?q=pdrb" | jq '.exact.datasources[0].chart_config'
```

## File yang Dimodifikasi

1. `backend/src/models/DataSource.model.js` - Tambah field chart_config
2. `backend/src/services/search/datasourceSearch.service.js` - Include chart_config dalam response
3. `frontend/src/app/api/search/route.ts` - Forward chart_config ke frontend
4. `frontend/src/components/search/SearchInsightsChart.tsx` - Gunakan chart_config untuk chart type
5. `frontend/src/app/(admin)/search/SearchPageClient.tsx` - Pass chart_config ke komponen

## Date: 2026-01-18
