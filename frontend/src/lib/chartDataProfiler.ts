/**
 * Chart Data Profiler
 * 
 * Analyzes data structure and recommends optimal chart configuration.
 * Based on analysis of 309 datasources (157 dynamic, 150 interop, 2 exim).
 */

// ============================================================================
// TYPES
// ============================================================================

export type DataProfile =
  | 'time-series-monthly'       // Bulan + 1-3 metrics (Inflasi, NTP, IHK)
  | 'time-series-multi-metric'  // Bulan + multiple series (Hotel occupancy)
  | 'geo-single-metric'         // Wilayah + 1 Nilai (Gini, TPT per kab)
  | 'geo-multi-metric'          // Wilayah + multiple metrics (Nikah/Cerai, Kemiskinan indices)
  | 'category-comparison'       // Category + metrics (Lapangan Usaha, Aspek IDI)
  | 'matrix-geo-time'           // Bulan + Wilayah + metrics (PDRB Triwulanan per Kab)
  | 'single-row'                // 1 row only - not chartable, show as card
  | 'few-rows-category'         // 2-5 rows with category - pie/bar
  | 'exim-time-series'          // EXIM: Bulan + hs/pod/ctr + value/netweight (ungrouped)
  | 'exim-category-hs2'         // EXIM grouped by komoditas (HS2) - bar/pie chart
  | 'exim-category-ctr'         // EXIM grouped by negara (CTR) - bar/pie chart
  | 'exim-category-pod'         // EXIM grouped by pelabuhan (POD) - bar/pie chart
  | 'empty'                     // No data
  | 'unknown';                  // Needs manual handling

export type ChartType = 'line' | 'bar' | 'pie' | 'none';

export interface DimensionInfo {
  column: string;
  type: 'time' | 'geo' | 'category' | 'filter';
  values?: string[];
  count: number;
}

export interface MetricInfo {
  column: string;
  type: 'numeric' | 'percentage' | 'index' | 'currency' | 'count';
  range: [number, number];
  hasNulls: boolean;
}

export interface ChartRecommendation {
  chartType: ChartType;
  xAxis: string;
  yAxis: string[];
  alternatives: ChartType[];
  reason: string;
}

export interface DataProfileResult {
  profile: DataProfile;
  dimensions: {
    time?: DimensionInfo;
    geo?: DimensionInfo;
    category?: DimensionInfo;
    filters?: DimensionInfo[];
  };
  metrics: MetricInfo[];
  recommended: ChartRecommendation;
  isChartable: boolean;
  warnings: string[];
}

// ============================================================================
// COLUMN PATTERN DETECTION
// ============================================================================

const TIME_COLUMN_PATTERNS = [
  /^bulan$/i,
  /^month$/i,
  /^periode$/i,
  /^tanggal$/i,
  /^tahun$/i,
  /^year$/i,
  /^triwulan$/i,
  /^quarter$/i,
  /^semester$/i,
];

const GEO_COLUMN_PATTERNS = [
  /^wilayah$/i,
  /^kabupaten/i,
  /^kota$/i,
  /^kab\.?\/?kota/i,
  /^propinsi$/i,
  /^provinsi$/i,
  /^daerah$/i,
  /^kecamatan$/i,
  /^desa$/i,
  /^kelurahan$/i,
];

const METRIC_COLUMN_PATTERNS = [
  /^nilai$/i,
  /^value$/i,
  /^jumlah$/i,
  /^total$/i,
  /^persentase$/i,
  /^persen$/i,
  /^indeks$/i,
  /^index$/i,
  /^rasio$/i,
  /^ratio$/i,
  /^laju$/i,
  /^rate$/i,
  /netweight/i,
  /month-to-month/i,
  /year-on-year/i,
  /year-to-date/i,
  /y-on-y/i,
  /q-to-q/i,
  /c-to-c/i,
];

const EXIM_FILTER_PATTERNS = [
  /kodehs/i,
  /hs2/i,
  /pod/i,
  /ctr/i,
];

// EXIM category column patterns - for detecting grouped data
const EXIM_HS2_COLUMN_PATTERNS = [/^kodehs$/i, /^hs2$/i, /^hs2_name$/i, /komoditas/i];
const EXIM_CTR_COLUMN_PATTERNS = [/^ctr$/i, /^negara$/i, /^country$/i];
const EXIM_POD_COLUMN_PATTERNS = [/^pod$/i, /^pelabuhan$/i, /^port$/i];

function matchesPatterns(column: string, patterns: RegExp[]): boolean {
  return patterns.some(p => p.test(column));
}

function detectColumnType(column: string): 'time' | 'geo' | 'metric' | 'filter' | 'unknown' {
  if (matchesPatterns(column, TIME_COLUMN_PATTERNS)) return 'time';
  if (matchesPatterns(column, GEO_COLUMN_PATTERNS)) return 'geo';
  if (matchesPatterns(column, METRIC_COLUMN_PATTERNS)) return 'metric';
  if (matchesPatterns(column, EXIM_FILTER_PATTERNS)) return 'filter';
  return 'unknown';
}

// ============================================================================
// VALUE ANALYSIS
// ============================================================================

function analyzeColumnValues(
  column: string,
  rows: Array<Record<string, unknown>>
): { type: 'numeric' | 'string' | 'mixed'; range?: [number, number]; uniqueCount: number; hasNulls: boolean } {
  const values = rows.map(r => r[column]);
  const uniqueValues = new Set(values.filter(v => v !== null && v !== undefined));
  const hasNulls = values.some(v => v === null || v === undefined);
  
  const numericValues = values
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  
  if (numericValues.length === values.filter(v => v !== null && v !== undefined).length && numericValues.length > 0) {
    const min = Math.min(...numericValues);
    const max = Math.max(...numericValues);
    return { type: 'numeric', range: [min, max], uniqueCount: uniqueValues.size, hasNulls };
  }
  
  const stringValues = values.filter(v => typeof v === 'string');
  if (stringValues.length === values.filter(v => v !== null && v !== undefined).length) {
    return { type: 'string', uniqueCount: uniqueValues.size, hasNulls };
  }
  
  return { type: 'mixed', uniqueCount: uniqueValues.size, hasNulls };
}

function detectMetricType(column: string, range?: [number, number]): MetricInfo['type'] {
  const col = column.toLowerCase();
  if (/persentase|persen|%/.test(col)) return 'percentage';
  if (/indeks|index/.test(col)) return 'index';
  if (/rupiah|rp|usd|\$|currency/.test(col)) return 'currency';
  if (/jumlah|banyak|count|populasi/.test(col)) return 'count';
  
  // Infer from range
  if (range) {
    const [min, max] = range;
    if (min >= 0 && max <= 100) return 'percentage';
    if (min >= 0 && max <= 1) return 'index';
  }
  
  return 'numeric';
}

// ============================================================================
// MAIN PROFILER
// ============================================================================

export function profileChartData(
  columns: string[] | null | undefined,
  rows: Array<Record<string, unknown>> | null | undefined,
  sourceType?: 'dynamic' | 'interop' | 'exim'
): DataProfileResult {
  const warnings: string[] = [];
  
  // Handle empty/null data
  if (!columns || columns.length === 0 || !rows || rows.length === 0) {
    return {
      profile: 'empty',
      dimensions: {},
      metrics: [],
      recommended: {
        chartType: 'none',
        xAxis: '',
        yAxis: [],
        alternatives: [],
        reason: 'Data kosong atau tidak tersedia',
      },
      isChartable: false,
      warnings: ['Data tidak tersedia'],
    };
  }
  
  // Analyze each column
  const columnAnalysis = columns.map(col => {
    const detectedType = detectColumnType(col);
    const valueAnalysis = analyzeColumnValues(col, rows);
    return { column: col, detectedType, ...valueAnalysis };
  });
  
  // Extract dimensions
  const timeCol = columnAnalysis.find(c => c.detectedType === 'time' && c.type === 'string');
  const geoCol = columnAnalysis.find(c => c.detectedType === 'geo' && c.type === 'string');
  const filterCols = columnAnalysis.filter(c => c.detectedType === 'filter');
  
  // Extract metrics (numeric columns that aren't dimensions)
  const metricCols = columnAnalysis.filter(c => 
    c.type === 'numeric' && 
    c.detectedType !== 'time' && 
    c.detectedType !== 'geo' &&
    c.detectedType !== 'filter'
  );
  
  // Also consider unknown string columns as potential category dimensions
  const categoryCol = columnAnalysis.find(c => 
    c.detectedType === 'unknown' && 
    c.type === 'string' &&
    c.uniqueCount > 1 &&
    c.uniqueCount <= rows.length
  );
  
  // Build dimensions info
  const dimensions: DataProfileResult['dimensions'] = {};
  
  if (timeCol) {
    dimensions.time = {
      column: timeCol.column,
      type: 'time',
      count: timeCol.uniqueCount,
    };
  }
  
  if (geoCol) {
    dimensions.geo = {
      column: geoCol.column,
      type: 'geo',
      count: geoCol.uniqueCount,
    };
  }
  
  if (categoryCol && !timeCol && !geoCol) {
    dimensions.category = {
      column: categoryCol.column,
      type: 'category',
      count: categoryCol.uniqueCount,
    };
  }
  
  if (filterCols.length > 0) {
    dimensions.filters = filterCols.map(f => ({
      column: f.column,
      type: 'filter' as const,
      count: f.uniqueCount,
    }));
  }
  
  // Build metrics info
  const metrics: MetricInfo[] = metricCols.map(m => ({
    column: m.column,
    type: detectMetricType(m.column, m.range),
    range: m.range || [0, 0],
    hasNulls: m.hasNulls,
  }));
  
  // Determine profile
  const profile = determineProfile(dimensions, metrics, rows.length, sourceType, columns);
  
  // Generate recommendation
  const recommended = generateRecommendation(profile, dimensions, metrics, columns);
  
  // Add warnings
  if (metrics.some(m => m.hasNulls)) {
    warnings.push('Beberapa nilai metrik kosong (null)');
  }
  if (rows.length === 1) {
    warnings.push('Hanya 1 baris data - tidak ideal untuk grafik');
  }
  if (metrics.length === 0) {
    warnings.push('Tidak ditemukan kolom metrik numerik');
  }
  
  return {
    profile,
    dimensions,
    metrics,
    recommended,
    isChartable: profile !== 'empty' && profile !== 'unknown' && profile !== 'single-row' && metrics.length > 0,
    warnings,
  };
}

function determineProfile(
  dimensions: DataProfileResult['dimensions'],
  metrics: MetricInfo[],
  rowCount: number,
  sourceType?: string,
  columns?: string[]
): DataProfile {
  const hasTime = !!dimensions.time;
  const hasGeo = !!dimensions.geo;
  const hasCategory = !!dimensions.category;
  const hasFilters = !!dimensions.filters && dimensions.filters.length > 0;
  const metricCount = metrics.length;
  
  // Empty
  if (metricCount === 0) return 'unknown';
  
  // Single row
  if (rowCount === 1) return 'single-row';
  
  // Few rows with category
  if (rowCount <= 5 && (hasCategory || hasGeo)) return 'few-rows-category';
  
  // EXIM special case: detect category grouping (hs2/ctr/pod)
  if (sourceType === 'exim' || hasFilters) {
    const filterDims = dimensions.filters || [];
    const hasMultiHs2 = filterDims.some(
      (f) => f.count > 1 && matchesPatterns(f.column, EXIM_HS2_COLUMN_PATTERNS)
    );
    const hasMultiCtr = filterDims.some(
      (f) => f.count > 1 && matchesPatterns(f.column, EXIM_CTR_COLUMN_PATTERNS)
    );
    const hasMultiPod = filterDims.some(
      (f) => f.count > 1 && matchesPatterns(f.column, EXIM_POD_COLUMN_PATTERNS)
    );

    if (hasMultiHs2) return 'exim-category-hs2';
    if (hasMultiCtr) return 'exim-category-ctr';
    if (hasMultiPod) return 'exim-category-pod';

    return 'exim-time-series';
  }
  
  // Matrix (both time and geo)
  if (hasTime && hasGeo) return 'matrix-geo-time';
  
  // Time series
  if (hasTime && !hasGeo) {
    if (metricCount === 1) return 'time-series-monthly';
    return 'time-series-multi-metric';
  }
  
  // Geo distribution
  if (hasGeo && !hasTime) {
    if (metricCount === 1) return 'geo-single-metric';
    return 'geo-multi-metric';
  }
  
  // Category comparison
  if (hasCategory) return 'category-comparison';
  
  return 'unknown';
}

function generateRecommendation(
  profile: DataProfile,
  dimensions: DataProfileResult['dimensions'],
  metrics: MetricInfo[],
  columns?: string[]
): ChartRecommendation {
  const defaultMetric = metrics[0]?.column || '';
  const allMetrics = metrics.map(m => m.column);
  
  switch (profile) {
    case 'time-series-monthly':
      return {
        chartType: 'line',
        xAxis: dimensions.time?.column || 'Bulan',
        yAxis: allMetrics.slice(0, 3), // Max 3 metrics for readability
        alternatives: ['bar'],
        reason: 'Data time-series bulanan cocok untuk line chart',
      };
    
    case 'time-series-multi-metric':
      return {
        chartType: 'line',
        xAxis: dimensions.time?.column || 'Bulan',
        yAxis: allMetrics,
        alternatives: ['bar'],
        reason: 'Multiple metrics over time - line chart dengan multiple series',
      };
    
    case 'geo-single-metric':
      return {
        chartType: 'bar',
        xAxis: dimensions.geo?.column || 'Wilayah',
        yAxis: [defaultMetric],
        alternatives: ['pie'],
        reason: 'Distribusi geografis 1 metrik - horizontal bar chart',
      };
    
    case 'geo-multi-metric':
      return {
        chartType: 'bar',
        xAxis: dimensions.geo?.column || 'Wilayah',
        yAxis: allMetrics,
        alternatives: [],
        reason: 'Perbandingan multi-metrik per wilayah - grouped bar chart',
      };
    
    case 'category-comparison':
      return {
        chartType: 'bar',
        xAxis: dimensions.category?.column || '',
        yAxis: allMetrics,
        alternatives: ['pie'],
        reason: 'Perbandingan kategori - bar chart atau pie (jika ≤8 kategori)',
      };
    
    case 'matrix-geo-time':
      return {
        chartType: 'line',
        xAxis: dimensions.time?.column || 'Bulan',
        yAxis: allMetrics,
        alternatives: ['bar'],
        reason: 'Data matrix (waktu + wilayah) - line chart dengan filter wilayah',
      };
    
    case 'few-rows-category':
      const count = dimensions.geo?.count || dimensions.category?.count || 0;
      return {
        chartType: count <= 8 ? 'pie' : 'bar',
        xAxis: dimensions.geo?.column || dimensions.category?.column || '',
        yAxis: [defaultMetric],
        alternatives: count <= 8 ? ['bar'] : [],
        reason: `${count} kategori - ${count <= 8 ? 'pie chart cocok' : 'bar chart lebih baik'}`,
      };
    
    case 'exim-time-series':
      return {
        chartType: 'line',
        xAxis: dimensions.time?.column || 'Bulan',
        yAxis: ['value', 'netweight'].filter(m => allMetrics.includes(m)),
        alternatives: ['bar'],
        reason: 'Data EXIM - line chart dengan filter HS/POD/CTR',
      };
    
    case 'exim-category-hs2':
      return {
        chartType: 'bar',
        xAxis: columns?.find(c => matchesPatterns(c, EXIM_HS2_COLUMN_PATTERNS)) || 'kodehs',
        yAxis: ['value', 'netweight'].filter(m => allMetrics.includes(m)).slice(0, 1) || [defaultMetric],
        alternatives: ['pie'],
        reason: 'Data EXIM per Komoditas (HS2) - bar/pie chart untuk perbandingan kategori',
      };
    
    case 'exim-category-ctr':
      return {
        chartType: 'bar',
        xAxis: columns?.find(c => matchesPatterns(c, EXIM_CTR_COLUMN_PATTERNS)) || 'ctr',
        yAxis: ['value', 'netweight'].filter(m => allMetrics.includes(m)).slice(0, 1) || [defaultMetric],
        alternatives: ['pie'],
        reason: 'Data EXIM per Negara (CTR) - bar/pie chart untuk perbandingan kategori',
      };
    
    case 'exim-category-pod':
      return {
        chartType: 'bar',
        xAxis: columns?.find(c => matchesPatterns(c, EXIM_POD_COLUMN_PATTERNS)) || 'pod',
        yAxis: ['value', 'netweight'].filter(m => allMetrics.includes(m)).slice(0, 1) || [defaultMetric],
        alternatives: ['pie'],
        reason: 'Data EXIM per Pelabuhan (POD) - bar/pie chart untuk perbandingan kategori',
      };
    
    case 'single-row':
      return {
        chartType: 'none',
        xAxis: '',
        yAxis: allMetrics,
        alternatives: [],
        reason: 'Hanya 1 baris - tampilkan sebagai card/highlight, bukan chart',
      };
    
    case 'empty':
      return {
        chartType: 'none',
        xAxis: '',
        yAxis: [],
        alternatives: [],
        reason: 'Data kosong',
      };
    
    default:
      return {
        chartType: 'bar',
        xAxis: dimensions.geo?.column || dimensions.category?.column || dimensions.time?.column || '',
        yAxis: allMetrics.slice(0, 1),
        alternatives: ['line'],
        reason: 'Profile tidak dikenali - fallback ke bar chart',
      };
  }
}

// ============================================================================
// INDICATOR CHART MAPPING (Pre-computed for 309 datasources)
// ============================================================================

/**
 * Pre-computed chart configuration for known datasources.
 * Format: { [source_id]: { profile, xAxis, yAxis, chartType } }
 */
export const INDICATOR_CHART_MAP: Record<number, {
  profile: DataProfile;
  xAxis: string;
  yAxis: string[];
  chartType: ChartType;
  notes?: string;
}> = {
  // ==================== DYNAMIC - TIME SERIES (Bulan) ====================
  1: { profile: 'time-series-monthly', xAxis: 'Bulan', yAxis: ['month-to-month', 'year-on-year', 'year-to-date'], chartType: 'line', notes: 'Inflasi Provinsi' },
  2: { profile: 'time-series-monthly', xAxis: 'Bulan', yAxis: ['month-to-month', 'year-on-year'], chartType: 'line', notes: 'IHK Halteng' },
  17: { profile: 'time-series-monthly', xAxis: 'Bulan', yAxis: ['Nilai'], chartType: 'line', notes: 'NTP' },
  161: { profile: 'time-series-monthly', xAxis: 'Bulan', yAxis: ['Nilai'], chartType: 'line', notes: 'IHK Provinsi' },
  162: { profile: 'time-series-monthly', xAxis: 'Bulan', yAxis: ['Nilai'], chartType: 'line', notes: 'NTP' },
  163: { profile: 'time-series-monthly', xAxis: 'Bulan', yAxis: ['month-to-month', 'year-on-year'], chartType: 'line', notes: 'Inflasi Halteng' },
  164: { profile: 'time-series-monthly', xAxis: 'Bulan', yAxis: ['month-to-month', 'year-on-year'], chartType: 'line', notes: 'Inflasi Ternate' },
  165: { profile: 'time-series-monthly', xAxis: 'Bulan', yAxis: ['Nilai'], chartType: 'line', notes: 'IHK Ternate' },
  329: { profile: 'time-series-multi-metric', xAxis: 'Bulan', yAxis: ['Nilai CIF (US$)', 'Volume (Kg)'], chartType: 'line', notes: 'Impor' },
  330: { profile: 'time-series-multi-metric', xAxis: 'Bulan', yAxis: ['Nilai FOB (US$)', 'Volume (Kg)'], chartType: 'line', notes: 'Ekspor' },
  331: { profile: 'time-series-monthly', xAxis: 'Bulan', yAxis: ['month-to-month', 'year-on-year'], chartType: 'line', notes: 'Inflasi Ternate (2018)' },
  332: { profile: 'time-series-monthly', xAxis: 'Bulan', yAxis: ['Nilai'], chartType: 'line', notes: 'IHK Ternate (2018)' },
  333: { profile: 'time-series-monthly', xAxis: 'Bulan', yAxis: ['Nilai'], chartType: 'line', notes: 'IHK Ternate (2012)' },
  334: { profile: 'time-series-monthly', xAxis: 'Bulan', yAxis: ['month-to-month', 'year-on-year'], chartType: 'line', notes: 'Inflasi Ternate (2012)' },
  335: { profile: 'time-series-monthly', xAxis: 'Bulan', yAxis: ['Nilai'], chartType: 'line', notes: 'NTP (2012)' },

  // ==================== DYNAMIC - TIME SERIES MULTI-METRIC ====================
  18: { profile: 'time-series-multi-metric', xAxis: 'Bulan', yAxis: ['Bintang', 'Non Bintang', 'Bintang dan Non Bintang'], chartType: 'line', notes: 'TPK Hotel' },
  170: { profile: 'time-series-multi-metric', xAxis: 'Bulan', yAxis: ['Bintang', 'Non Bintang', 'Bintang dan Non Bintang'], chartType: 'line', notes: 'TPK Hotel' },
  173: { profile: 'time-series-multi-metric', xAxis: 'Bulan', yAxis: ['Asing/Mancanegara', 'Nusantara'], chartType: 'line', notes: 'Tamu Hotel' },
  
  // ==================== DYNAMIC - GEO SINGLE METRIC ====================
  8: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Nilai'], chartType: 'bar', notes: 'Gini Rasio per Kab/Kota' },
  10: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Nilai'], chartType: 'bar', notes: 'IPM (LFSP2020)' },
  11: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Nilai'], chartType: 'bar', notes: 'UHH (LFSP2020)' },
  13: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Nilai'], chartType: 'bar', notes: 'HLS per Kab/Kota' },
  16: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Nilai'], chartType: 'bar', notes: 'RLS per Kab/Kota' },
  180: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Nilai'], chartType: 'bar', notes: 'Proyeksi RT per Kab/Kota' },
  181: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Nilai'], chartType: 'bar', notes: 'Rasio JK per Kab/Kota' },
  182: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Nilai'], chartType: 'bar', notes: 'Kepadatan Penduduk' },
  184: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Nilai'], chartType: 'bar', notes: 'Proyeksi Penduduk per Kab/Kota' },
  201: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Nilai'], chartType: 'bar', notes: 'TPT per Kab/Kota' },
  202: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Nilai'], chartType: 'bar', notes: 'TPAK per Kab/Kota' },
  237: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Nilai'], chartType: 'bar', notes: 'AHH per Kab/Kota' },
  251: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Nilai'], chartType: 'bar', notes: 'Pengeluaran Perkapita' },
  252: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Laki-laki', 'Perempuan'], chartType: 'bar', notes: 'Pengeluaran Perkapita per JK' },
  271: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Nilai'], chartType: 'bar', notes: 'Jemaah Haji' },
  346: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Nilai'], chartType: 'bar', notes: 'Tinggi Wilayah' },
  347: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Nilai'], chartType: 'bar', notes: 'Luas Daerah' },
  348: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Nilai'], chartType: 'bar', notes: 'Jarak ke Ibukota' },
  419: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Nilai'], chartType: 'bar', notes: 'Indeks Kemahalan Konstruksi' },
  428: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Nilai'], chartType: 'bar', notes: 'IPM per Kab/Kota' },
  448: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Nilai'], chartType: 'bar', notes: 'Panjang Jalan per Kab' },
  450: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Nilai'], chartType: 'bar', notes: '% Penduduk Miskin per Kab' },
  452: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Nilai'], chartType: 'bar', notes: 'Jumlah Penduduk Miskin per Kab' },
  453: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Nilai'], chartType: 'bar', notes: 'Garis Kemiskinan per Kab' },
  
  // ==================== DYNAMIC - GEO MULTI-METRIC ====================
  3: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Pelanggan', 'Air Disalurkan (M3)', 'Nilai (Rp)'], chartType: 'bar', notes: 'PDAM' },
  4: { profile: 'category-comparison', xAxis: 'Kelompok Umur', yAxis: ['Laki-laki', 'Perempuan', 'Jumlah'], chartType: 'bar', notes: 'Proyeksi Penduduk per Umur JK' },
  9: { profile: 'category-comparison', xAxis: 'Kelompok Umur', yAxis: ['Laki-laki', 'Perempuan', 'Jumlah'], chartType: 'bar', notes: 'Proyeksi LFSP2020 per Umur JK' },
  171: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Nilai'], chartType: 'bar', notes: 'Wisnus Tujuan' },
  172: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Nilai'], chartType: 'bar', notes: 'Wisnus Asal' },
  206: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Laki-laki', 'Perempuan'], chartType: 'bar', notes: 'HLS per Kab/Kota JK' },
  207: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Laki-laki', 'Perempuan'], chartType: 'bar', notes: 'RLS per Kab/Kota JK' },
  232: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Laki-laki', 'Perempuan'], chartType: 'bar', notes: 'UHH per Kab/Kota JK' },
  233: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Laki-laki', 'Perempuan'], chartType: 'bar', notes: 'AHH per Kab/Kota JK' },
  246: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['KB', 'Posyandu'], chartType: 'bar', notes: 'Klinik KB' },
  247: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Dokter', 'Perawat', 'Bidan'], chartType: 'bar', notes: 'Tenaga Kesehatan' },
  248: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['RS', 'Puskesmas', 'Klinik'], chartType: 'bar', notes: 'Faskes' },
  249: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['HIV', 'DBD', 'TB', 'Malaria'], chartType: 'bar', notes: 'Kasus Penyakit' },
  269: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Islam', 'Kristen', 'Katolik', 'Hindu', 'Buddha'], chartType: 'bar', notes: 'Penduduk per Agama' },
  270: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Ekonomi', 'Perselisihan', 'Meninggalkan'], chartType: 'bar', notes: 'Perceraian per Faktor' },
  272: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Masjid', 'Gereja', 'Pura', 'Vihara'], chartType: 'bar', notes: 'Tempat Ibadah' },
  349: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Pantai', 'Bukan Pantai'], chartType: 'bar', notes: 'Desa per Geografi' },
  367: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Luas Panen', 'Produktivitas', 'Produksi'], chartType: 'bar', notes: 'Padi' },
  395: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Sapi', 'Kerbau', 'Kambing', 'Babi'], chartType: 'bar', notes: 'Populasi Ternak' },
  416: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Sawah', 'Bukan Sawah'], chartType: 'bar', notes: 'Luas Lahan' },
  445: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Aspal', 'Kerikil', 'Tanah'], chartType: 'bar', notes: 'Jalan per Permukaan' },
  446: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Baik', 'Sedang', 'Rusak'], chartType: 'bar', notes: 'Jalan per Kondisi' },
  451: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Indeks Kedalaman Kemiskinan (Indeks) - P1', 'Indeks Keparahan Kemiskinan (Indeks) - P2'], chartType: 'bar', notes: 'Indeks Kemiskinan' },
  
  // ==================== DYNAMIC - CATEGORY COMPARISON ====================
  19: { profile: 'category-comparison', xAxis: 'TPAK dan TPT', yAxis: ['Jumlah', 'Laki-laki', 'Perempuan'], chartType: 'bar', notes: 'TPAK/TPT per JK' },
  20: { profile: 'category-comparison', xAxis: 'Lapangan Usaha (Kategori)', yAxis: ['c-to-c', 'q-to-q', 'y-on-y'], chartType: 'bar', notes: 'Pertumbuhan PDRB per LU' },
  198: { profile: 'category-comparison', xAxis: 'Jenis Kelamin', yAxis: ['Nilai'], chartType: 'bar', notes: 'TPAK IKG' },
  199: { profile: 'category-comparison', xAxis: 'Kegiatan', yAxis: ['Nilai'], chartType: 'bar', notes: 'Penduduk 15+ per Kegiatan' },
  200: { profile: 'category-comparison', xAxis: 'Klasifikasi', yAxis: ['TPAK', 'TPT'], chartType: 'bar', notes: 'TPAK/TPT Kota/Desa' },
  205: { profile: 'category-comparison', xAxis: 'Jenis Kelamin', yAxis: ['Nilai'], chartType: 'bar', notes: 'IKG Pendidikan SMA per JK' },
  222: { profile: 'category-comparison', xAxis: 'Jenjang Pendidikan', yAxis: ['APM', 'APK'], chartType: 'bar', notes: 'APM APK per Jenjang' },
  223: { profile: 'category-comparison', xAxis: 'Kelompok Umur', yAxis: ['Nilai'], chartType: 'bar', notes: 'APS per Kelompok Umur' },
  224: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['7-12', '13-15', '16-18', '19-24'], chartType: 'bar', notes: 'Sekolah per Umur Kab' },
  225: { profile: 'category-comparison', xAxis: 'Partisipasi', yAxis: ['Nilai'], chartType: 'bar', notes: 'Partisipasi Sekolah' },
  230: { profile: 'single-row', xAxis: 'IKG', yAxis: ['Nilai'], chartType: 'none', notes: 'MTF IKG' },
  231: { profile: 'single-row', xAxis: 'IKG', yAxis: ['Nilai'], chartType: 'none', notes: 'MHPK20 IKG' },
  250: { profile: 'category-comparison', xAxis: 'Unit Kerja', yAxis: ['Dokter', 'Perawat', 'Bidan'], chartType: 'bar', notes: 'Nakes per Unit Kerja' },
  275: { profile: 'few-rows-category', xAxis: 'Aspek Indeks Demokrasi Indonesia (IDI) Metode Baru', yAxis: ['Nilai'], chartType: 'pie', notes: 'IDI per Aspek (3 kategori)' },
  290: { profile: 'category-comparison', xAxis: 'Lapangan Usaha', yAxis: ['Distribusi'], chartType: 'bar', notes: 'Distribusi PDRB per LU' },
  293: { profile: 'category-comparison', xAxis: 'Lapangan Usaha', yAxis: ['ADHB', 'ADHK'], chartType: 'bar', notes: 'PDRB per LU' },
  
  // ==================== DYNAMIC - SINGLE ROW ====================
  12: { profile: 'single-row', xAxis: 'Propinsi', yAxis: ['Nilai'], chartType: 'none', notes: '% Miskin Provinsi - 1 row' },
  14: { profile: 'single-row', xAxis: 'Propinsi', yAxis: ['Nilai'], chartType: 'none', notes: 'Gini Provinsi - 1 row' },
  15: { profile: 'single-row', xAxis: 'Propinsi', yAxis: ['Nilai'], chartType: 'none', notes: 'Garis Kemiskinan Prov - 1 row' },
  183: { profile: 'single-row', xAxis: 'Propinsi', yAxis: ['Nilai'], chartType: 'none', notes: 'Laju Pertumbuhan Penduduk - 1 row' },
  274: { profile: 'single-row', xAxis: 'IDI', yAxis: ['Nilai'], chartType: 'none', notes: 'IDI Provinsi - 1 row' },
  278: { profile: 'single-row', xAxis: 'IDI', yAxis: ['Nilai'], chartType: 'none', notes: 'IDI Provinsi Lama - 1 row' },
  305: { profile: 'single-row', xAxis: 'Propinsi', yAxis: ['Nilai'], chartType: 'none', notes: 'PDRB Perkapita - 1 row' },
  431: { profile: 'single-row', xAxis: 'Propinsi', yAxis: ['Nilai'], chartType: 'none', notes: 'IKG - 1 row' },
  449: { profile: 'single-row', xAxis: 'Hotel', yAxis: ['TPK'], chartType: 'none', notes: 'TPK Bintang - 1 row' },
  
  // ==================== DYNAMIC - MATRIX (TIME + GEO) ====================
  203: { profile: 'matrix-geo-time', xAxis: 'Bulan', yAxis: ['Atas Dasar Harga Berlaku', 'Atas Dasar Harga Konstan 2010'], chartType: 'line', notes: 'PDRB Triwulanan per Kab' },
  
  // ==================== INTEROP - GEO MULTI-METRIC ====================
  5: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Nikah', 'Cerai Talak', 'Cerai Gugat', 'Jumlah Cerai'], chartType: 'bar', notes: 'Nikah Cerai' },
  6: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Pendapatan', 'Belanja'], chartType: 'bar', notes: 'Keuangan Desa' },
  174: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Akomodasi', 'Kamar', 'Tempat Tidur'], chartType: 'bar', notes: 'Hotel Non-Bintang' },
  175: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Akomodasi', 'Kamar', 'Tempat Tidur'], chartType: 'bar', notes: 'Hotel Bintang' },
  179: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Rumah Tangga', 'Rata-rata ART'], chartType: 'bar', notes: 'RT dan ART' },
  185: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Ekonomi', 'Perselisihan', 'Meninggalkan'], chartType: 'bar', notes: 'Faktor Cerai' },
  187: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Penduduk', 'LPP', 'Kepadatan', 'Sex Ratio'], chartType: 'bar', notes: 'Demografi per Kab' },
  190: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['TPT', 'TPAK'], chartType: 'bar', notes: 'TPT TPAK per Kab' },
  234: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['RS', 'Puskesmas', 'Klinik', 'Posyandu'], chartType: 'bar', notes: 'Faskes per Kab' },
  425: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Jumlah Miskin', 'Persentase'], chartType: 'bar', notes: 'Kemiskinan per Kab' },
  427: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['IPM'], chartType: 'bar', notes: 'IPM per Kab/Kota' },
  429: { profile: 'geo-multi-metric', xAxis: 'Daerah', yAxis: ['Garis Kemiskinan', 'Jumlah Miskin', 'Persentase'], chartType: 'bar', notes: 'Kemiskinan Prov' },
  430: { profile: 'geo-multi-metric', xAxis: 'Daerah', yAxis: ['P1', 'P2'], chartType: 'bar', notes: 'Indeks Kemiskinan per Daerah' },

  // ==================== INTEROP - CATEGORY ====================
  186: { profile: 'category-comparison', xAxis: 'Kelompok Umur', yAxis: ['Laki-laki', 'Perempuan', 'Jumlah'], chartType: 'bar', notes: 'Penduduk per Umur JK' },
  191: { profile: 'category-comparison', xAxis: 'Kelompok Umur', yAxis: ['Bekerja', 'Pengangguran', 'Bukan AK'], chartType: 'bar', notes: 'Kegiatan per Umur' },
  194: { profile: 'category-comparison', xAxis: 'Pendidikan', yAxis: ['Bekerja', 'Pengangguran', 'Bukan AK'], chartType: 'bar', notes: 'Kegiatan per Pendidikan' },
  215: { profile: 'category-comparison', xAxis: 'Jenjang', yAxis: ['APM', 'APK'], chartType: 'bar', notes: 'APM APK per Jenjang' },
  301: { profile: 'category-comparison', xAxis: 'Lapangan Usaha', yAxis: ['Distribusi'], chartType: 'bar', notes: 'Distribusi PDRB per LU' },
  302: { profile: 'category-comparison', xAxis: 'Lapangan Usaha', yAxis: ['Laju'], chartType: 'bar', notes: 'Laju PDRB per LU' },
  
  // ==================== EXIM ====================
  159: { profile: 'exim-time-series', xAxis: 'Bulan', yAxis: ['value', 'netweight'], chartType: 'line', notes: 'Ekspor' },
  160: { profile: 'exim-time-series', xAxis: 'Bulan', yAxis: ['value', 'netweight'], chartType: 'line', notes: 'Impor' },

  // ==================== ADDITIONAL INTEROP - KETENAGAKERJAAN ====================
  188: { profile: 'category-comparison', xAxis: 'Kelompok Umur', yAxis: ['<15 Jam', '15-34 Jam', '35-44 Jam', '>=45 Jam'], chartType: 'bar', notes: 'Jam Kerja per Umur' },
  189: { profile: 'category-comparison', xAxis: 'Status Pekerjaan', yAxis: ['SD', 'SMP', 'SMA', 'Diploma', 'Universitas'], chartType: 'bar', notes: 'Pekerjaan per Pendidikan' },
  192: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Bekerja', 'Pengangguran', 'Bukan AK'], chartType: 'bar', notes: 'Kegiatan per Kab' },
  193: { profile: 'category-comparison', xAxis: 'Kegiatan', yAxis: ['Laki-laki', 'Perempuan', 'Jumlah'], chartType: 'bar', notes: 'Kegiatan per JK' },
  195: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Pertanian', 'Industri', 'Jasa'], chartType: 'bar', notes: 'Pendapatan Informal per Lapangan' },
  196: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['SD', 'SMP', 'SMA', 'Diploma'], chartType: 'bar', notes: 'Pendapatan Informal per Pendidikan' },
  197: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Pencari Kerja', 'Lowongan', 'Penempatan'], chartType: 'bar', notes: 'Pencari Kerja per Kab' },

  // ==================== ADDITIONAL INTEROP - PENDIDIKAN ====================
  204: { profile: 'category-comparison', xAxis: 'Kelompok Umur', yAxis: ['Laki-laki', 'Perempuan'], chartType: 'bar', notes: 'Partisipasi Sekolah per Umur JK' },
  208: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Terakreditasi A', 'Terakreditasi B', 'Terakreditasi C'], chartType: 'bar', notes: 'Perpustakaan Akreditasi' },
  209: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Sekolah', 'Guru', 'Murid'], chartType: 'bar', notes: 'MI per Kab' },
  210: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Dimensi 1', 'Dimensi 2', 'Dimensi 3', 'Total'], chartType: 'bar', notes: 'Kegemaran Membaca' },
  211: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Pustakawan', 'Asisten'], chartType: 'bar', notes: 'Pejabat Perpustakaan' },
  212: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Dimensi 1', 'Dimensi 2', 'Dimensi 3', 'Total'], chartType: 'bar', notes: 'Indeks Literasi' },
  213: { profile: 'category-comparison', xAxis: 'Kelompok Umur', yAxis: ['Perkotaan', 'Perdesaan'], chartType: 'bar', notes: 'Melek Huruf per Umur' },
  214: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['PT', 'Dosen', 'Mahasiswa'], chartType: 'bar', notes: 'Perguruan Tinggi' },
  216: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['SD', 'SMP', 'SMA'], chartType: 'bar', notes: 'Desa dengan Sekolah' },
  217: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Sekolah', 'Guru', 'Murid'], chartType: 'bar', notes: 'SMK per Kab' },
  218: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Sekolah', 'Guru', 'Murid'], chartType: 'bar', notes: 'SMA per Kab' },
  219: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Sekolah', 'Guru', 'Murid'], chartType: 'bar', notes: 'SMP per Kab' },
  220: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Sekolah', 'Guru', 'Murid'], chartType: 'bar', notes: 'SD per Kab' },
  221: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Sekolah', 'Guru', 'Murid'], chartType: 'bar', notes: 'TK per Kab' },
  226: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['PT', 'Dosen', 'Mahasiswa'], chartType: 'bar', notes: 'PT Kemenag' },
  227: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Sekolah', 'Guru', 'Murid'], chartType: 'bar', notes: 'RA per Kab' },
  228: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Sekolah', 'Guru', 'Murid'], chartType: 'bar', notes: 'MA per Kab' },
  229: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Sekolah', 'Guru', 'Murid'], chartType: 'bar', notes: 'MTs per Kab' },

  // ==================== ADDITIONAL INTEROP - KESEHATAN ====================
  235: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['HIV', 'DBD', 'TB', 'Malaria'], chartType: 'bar', notes: 'Kasus Penyakit Interop' },
  236: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['RS', 'Puskesmas', 'Posyandu'], chartType: 'bar', notes: 'Desa dengan Sarkes' },
  238: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['BPJS', 'Jamkesda', 'Lainnya'], chartType: 'bar', notes: 'Jaminan Kesehatan' },
  239: { profile: 'category-comparison', xAxis: 'Kelompok Umur', yAxis: ['Perkotaan', 'Perdesaan'], chartType: 'bar', notes: 'Merokok per Umur' },
  240: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Biaya', 'Jarak', 'Waktu'], chartType: 'bar', notes: 'Alasan Tidak Berobat' },
  241: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Persentase'], chartType: 'bar', notes: 'Keluhan Kesehatan Berobat' },
  242: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Persentase'], chartType: 'bar', notes: 'Keluhan Kesehatan' },
  243: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Persentase'], chartType: 'bar', notes: 'Penggunaan KB' },
  244: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Dokter', 'Perawat', 'Bidan'], chartType: 'bar', notes: 'Nakes Interop' },
  245: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Dokter', 'Bidan', 'Dukun'], chartType: 'bar', notes: 'Penolong Persalinan' },

  // ==================== ADDITIONAL INTEROP - KONSUMSI & PERUMAHAN ====================
  253: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Makanan Kota', 'Makanan Desa', 'Non-Makanan Kota', 'Non-Makanan Desa'], chartType: 'bar', notes: 'Pengeluaran Kota/Desa' },
  254: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Makanan Kota', 'Makanan Desa', 'Non-Makanan Kota', 'Non-Makanan Desa'], chartType: 'bar', notes: 'Pengeluaran Rata2 Kota/Desa' },
  255: { profile: 'category-comparison', xAxis: 'Komoditas', yAxis: ['Perkotaan', 'Perdesaan'], chartType: 'bar', notes: 'Pengeluaran per Komoditas' },
  256: { profile: 'category-comparison', xAxis: 'Komoditas', yAxis: ['Perkotaan', 'Perdesaan'], chartType: 'bar', notes: 'Pengeluaran Rupiah per Komoditas' },
  257: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['KPM', 'Anggaran'], chartType: 'bar', notes: 'Bansos Pangan' },
  258: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Persentase'], chartType: 'bar', notes: 'Akses Air Minum' },
  259: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Persentase'], chartType: 'bar', notes: 'Akses Sanitasi' },
  260: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Keramik', 'Ubin', 'Semen', 'Kayu'], chartType: 'bar', notes: 'Jenis Lantai' },
  261: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Milik Sendiri', 'Kontrak', 'Sewa', 'Lainnya'], chartType: 'bar', notes: 'Status Bangunan' },
  262: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['LPG', 'Minyak Tanah', 'Kayu Bakar', 'Lainnya'], chartType: 'bar', notes: 'Bahan Bakar Memasak' },
  263: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Sendiri', 'Bersama', 'Umum', 'Tidak Ada'], chartType: 'bar', notes: 'Fasilitas BAB' },
  264: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['PLN', 'Non-PLN', 'Tidak Ada'], chartType: 'bar', notes: 'Sumber Penerangan' },
  265: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Ledeng', 'Sumur', 'Mata Air', 'Lainnya'], chartType: 'bar', notes: 'Sumber Air Minum' },
  266: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['<20m2', '20-49m2', '50-99m2', '>=100m2'], chartType: 'bar', notes: 'Luas Lantai' },
  267: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Jumlah'], chartType: 'bar', notes: 'Jemaah Haji per Kab' },
  268: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Kejahatan', 'Risiko', 'Penyelesaian'], chartType: 'bar', notes: 'Kriminalitas' },

  // ==================== ADDITIONAL DYNAMIC - IDI & GENDER ====================
  273: { profile: 'category-comparison', xAxis: 'Tujuan Olahraga', yAxis: ['Perkotaan', 'Perdesaan'], chartType: 'bar', notes: 'Olahraga per Tujuan' },
  276: { profile: 'category-comparison', xAxis: 'Indikator', yAxis: ['Nilai'], chartType: 'bar', notes: 'IDI per Indikator Baru' },
  277: { profile: 'category-comparison', xAxis: 'Jenis Kelamin', yAxis: ['Nilai'], chartType: 'bar', notes: 'IKG Legislatif' },
  279: { profile: 'category-comparison', xAxis: 'Indikator', yAxis: ['Nilai'], chartType: 'bar', notes: 'IDI per Indikator' },
  280: { profile: 'category-comparison', xAxis: 'Variabel', yAxis: ['Nilai'], chartType: 'bar', notes: 'IDI per Variabel' },
  281: { profile: 'few-rows-category', xAxis: 'Aspek', yAxis: ['Nilai'], chartType: 'pie', notes: 'IDI per Aspek' },

  // ==================== ADDITIONAL DYNAMIC - PDRB ====================
  282: { profile: 'category-comparison', xAxis: 'Pengeluaran', yAxis: ['Laju'], chartType: 'bar', notes: 'Laju IHI PDRB per Pengeluaran' },
  283: { profile: 'category-comparison', xAxis: 'Pengeluaran', yAxis: ['Indeks'], chartType: 'bar', notes: 'IHI PDRB per Pengeluaran' },
  284: { profile: 'category-comparison', xAxis: 'Pengeluaran', yAxis: ['Laju'], chartType: 'bar', notes: 'Laju PDRB per Pengeluaran' },
  285: { profile: 'category-comparison', xAxis: 'Pengeluaran', yAxis: ['Distribusi'], chartType: 'bar', notes: 'Distribusi PDRB per Pengeluaran' },
  286: { profile: 'category-comparison', xAxis: 'Pengeluaran', yAxis: ['ADHB', 'ADHK'], chartType: 'bar', notes: 'PDRB per Pengeluaran' },
  287: { profile: 'category-comparison', xAxis: 'Pengeluaran', yAxis: ['ADHB', 'ADHK'], chartType: 'bar', notes: 'PDRB per Pengeluaran Detail' },
  288: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Laju'], chartType: 'bar', notes: 'Laju PDRB Triwulanan per Kab' },
  289: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Distribusi'], chartType: 'bar', notes: 'Distribusi PDRB per Kab' },
  291: { profile: 'category-comparison', xAxis: 'Lapangan Usaha', yAxis: ['Laju'], chartType: 'bar', notes: 'Laju IHI per LU' },
  292: { profile: 'category-comparison', xAxis: 'Lapangan Usaha', yAxis: ['Indeks'], chartType: 'bar', notes: 'IHI per LU' },
  294: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Laju'], chartType: 'bar', notes: 'Laju PDRB Perkapita per Kab' },
  295: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Nilai'], chartType: 'bar', notes: 'PDRB Perkapita ADHK per Kab' },
  296: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Nilai'], chartType: 'bar', notes: 'PDRB Perkapita ADHB per Kab' },
  297: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Laju'], chartType: 'bar', notes: 'Laju PDRB ADHK per Kab' },
  298: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Distribusi'], chartType: 'bar', notes: 'Distribusi PDRB ADHB per Kab' },
  299: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Nilai'], chartType: 'bar', notes: 'PDRB ADHK per Kab' },
  300: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Nilai'], chartType: 'bar', notes: 'PDRB ADHB per Kab' },
  303: { profile: 'category-comparison', xAxis: 'Lapangan Usaha', yAxis: ['Nilai'], chartType: 'bar', notes: 'PDRB ADHB per LU Interop' },
  304: { profile: 'category-comparison', xAxis: 'Lapangan Usaha', yAxis: ['Nilai'], chartType: 'bar', notes: 'PDRB ADHK per LU Interop' },
  306: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['ADHB', 'ADHK'], chartType: 'bar', notes: 'PDRB Tahunan per Kab' },
  307: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Laju'], chartType: 'bar', notes: 'Laju PDRB Tahunan per Kab' },
  308: { profile: 'category-comparison', xAxis: 'Pengeluaran', yAxis: ['ADHB', 'ADHK'], chartType: 'bar', notes: 'PDRB Tahunan per Pengeluaran' },
  309: { profile: 'category-comparison', xAxis: 'Pengeluaran', yAxis: ['Indeks'], chartType: 'bar', notes: 'IHI PDRB per Pengeluaran 2' },
  310: { profile: 'category-comparison', xAxis: 'Lapangan Usaha', yAxis: ['ADHB', 'ADHK'], chartType: 'bar', notes: 'PDRB Tahunan per LU' },
  311: { profile: 'category-comparison', xAxis: 'Pengeluaran', yAxis: ['Laju'], chartType: 'bar', notes: 'Laju IHI per Pengeluaran' },
  312: { profile: 'category-comparison', xAxis: 'Pengeluaran', yAxis: ['Distribusi'], chartType: 'bar', notes: 'Distribusi PDRB per Pengeluaran 2' },
  314: { profile: 'category-comparison', xAxis: 'Pengeluaran', yAxis: ['Laju'], chartType: 'bar', notes: 'Laju PDRB ADHK per Pengeluaran' },

  // ==================== ADDITIONAL DYNAMIC - INDUSTRI ====================
  315: { profile: 'category-comparison', xAxis: 'Jenis Industri', yAxis: ['Pertumbuhan'], chartType: 'bar', notes: 'Pertumbuhan IMK per Jenis' },
  316: { profile: 'time-series-monthly', xAxis: 'Triwulan', yAxis: ['Pertumbuhan'], chartType: 'line', notes: 'Pertumbuhan IMK Triwulanan' },
  325: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Pendapatan', 'Belanja'], chartType: 'bar', notes: 'Keuangan Pemda Kab/Kota' },
  326: { profile: 'category-comparison', xAxis: 'Jenis Belanja', yAxis: ['Nilai'], chartType: 'bar', notes: 'Belanja Pemprov' },
  327: { profile: 'category-comparison', xAxis: 'Jenis Pendapatan', yAxis: ['Nilai'], chartType: 'bar', notes: 'Pendapatan Pemprov' },
  328: { profile: 'category-comparison', xAxis: 'Kepangkatan', yAxis: ['Laki-laki', 'Perempuan'], chartType: 'bar', notes: 'PNS per Pangkat' },

  // ==================== ADDITIONAL INTEROP - PEMERINTAHAN ====================
  317: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Penerimaan', 'Pengeluaran'], chartType: 'bar', notes: 'Keuangan Pemda Kab Interop' },
  318: { profile: 'category-comparison', xAxis: 'Kepangkatan', yAxis: ['Laki-laki', 'Perempuan'], chartType: 'bar', notes: 'PPPK per Pangkat' },
  319: { profile: 'category-comparison', xAxis: 'Kepangkatan', yAxis: ['Laki-laki', 'Perempuan'], chartType: 'bar', notes: 'PNS per Pangkat Interop' },
  320: { profile: 'category-comparison', xAxis: 'Jabatan', yAxis: ['PNS L', 'PNS P', 'PPPK L', 'PPPK P'], chartType: 'bar', notes: 'ASN per Jabatan' },
  321: { profile: 'category-comparison', xAxis: 'Pendidikan', yAxis: ['PNS L', 'PNS P', 'PPPK L', 'PPPK P'], chartType: 'bar', notes: 'ASN per Pendidikan' },
  322: { profile: 'category-comparison', xAxis: 'Kepangkatan', yAxis: ['Laki-laki', 'Perempuan'], chartType: 'bar', notes: 'PNS per Pangkat 2' },
  323: { profile: 'category-comparison', xAxis: 'Pendidikan', yAxis: ['Laki-laki', 'Perempuan'], chartType: 'bar', notes: 'PNS per Pendidikan' },
  324: { profile: 'category-comparison', xAxis: 'Jabatan', yAxis: ['Laki-laki', 'Perempuan'], chartType: 'bar', notes: 'PNS per Jabatan' },

  // ==================== ADDITIONAL INTEROP - BENCANA & GEOGRAFI ====================
  336: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Banjir', 'Longsor', 'Gempa', 'Kebakaran'], chartType: 'bar', notes: 'Bencana per Kab' },
  337: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Rusak Ringan', 'Rusak Sedang', 'Rusak Berat'], chartType: 'bar', notes: 'Kerusakan Rumah Bencana' },
  338: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Meninggal', 'Luka', 'Mengungsi'], chartType: 'bar', notes: 'Korban Bencana' },
  339: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Pantai', 'Bukan Pantai'], chartType: 'bar', notes: 'Desa per Geografi Interop' },
  340: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Dataran', 'Lereng', 'Lembah'], chartType: 'bar', notes: 'Desa per Topografi' },
  341: { profile: 'time-series-monthly', xAxis: 'Bulan', yAxis: ['Curah Hujan', 'Hari Hujan'], chartType: 'line', notes: 'Hujan' },
  342: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Jumlah'], chartType: 'bar', notes: 'Desa per Kab' },
  343: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Luas', 'Pulau'], chartType: 'bar', notes: 'Luas dan Pulau' },
  344: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Jumlah'], chartType: 'bar', notes: 'Kecamatan per Kab' },
  345: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Jumlah'], chartType: 'bar', notes: 'Desa Terkena Bencana' },
  350: { profile: 'category-comparison', xAxis: 'Status Listrik', yAxis: ['Jumlah'], chartType: 'bar', notes: 'Desa per Listrik' },
  351: { profile: 'category-comparison', xAxis: 'Jenis Bencana', yAxis: ['Jumlah'], chartType: 'bar', notes: 'Desa per Bencana' },
  352: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Status'], chartType: 'bar', notes: 'Status Wilayah' },

  // ==================== ADDITIONAL INTEROP - PERTANIAN ====================
  353: { profile: 'category-comparison', xAxis: 'Jenis Tanaman', yAxis: ['Produksi'], chartType: 'bar', notes: 'Produksi Buah Tahunan' },
  354: { profile: 'category-comparison', xAxis: 'Jenis Tanaman', yAxis: ['Produksi'], chartType: 'bar', notes: 'Produksi Tanaman Hias' },
  355: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Mangga', 'Pisang', 'Jeruk'], chartType: 'bar', notes: 'Produksi Buah per Kab' },
  356: { profile: 'category-comparison', xAxis: 'Jenis Tanaman', yAxis: ['Luas Panen'], chartType: 'bar', notes: 'Luas Panen Hias' },
  357: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Anggrek', 'Mawar', 'Melati'], chartType: 'bar', notes: 'Produksi Hias per Kab' },
  358: { profile: 'category-comparison', xAxis: 'Jenis Tanaman', yAxis: ['Produksi'], chartType: 'bar', notes: 'Produksi Biofarmaka' },
  359: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Anggrek', 'Mawar', 'Melati'], chartType: 'bar', notes: 'Luas Panen Hias per Kab' },
  360: { profile: 'category-comparison', xAxis: 'Jenis Tanaman', yAxis: ['Luas Panen'], chartType: 'bar', notes: 'Luas Panen Biofarmaka' },
  361: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Jahe', 'Kunyit', 'Lengkuas'], chartType: 'bar', notes: 'Produksi Biofarmaka per Kab' },
  362: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Jahe', 'Kunyit', 'Lengkuas'], chartType: 'bar', notes: 'Luas Panen Biofarmaka per Kab' },
  363: { profile: 'category-comparison', xAxis: 'Jenis Tanaman', yAxis: ['Produksi'], chartType: 'bar', notes: 'Produksi Sayuran Semusim' },
  364: { profile: 'category-comparison', xAxis: 'Jenis Tanaman', yAxis: ['Luas Panen'], chartType: 'bar', notes: 'Luas Panen Sayuran Semusim' },
  365: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Cabai', 'Tomat', 'Bawang'], chartType: 'bar', notes: 'Produksi Sayuran per Kab' },
  366: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Cabai', 'Tomat', 'Bawang'], chartType: 'bar', notes: 'Luas Panen Sayuran per Kab' },
  368: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Mangga', 'Pisang', 'Jeruk'], chartType: 'bar', notes: 'Produksi BST per Kab' },
  369: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Produksi'], chartType: 'bar', notes: 'Produksi Jagung' },
  370: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Luas Panen'], chartType: 'bar', notes: 'Luas Panen Jagung' },
  371: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Cabai', 'Tomat', 'Bawang'], chartType: 'bar', notes: 'Produksi SBS per Kab' },
  372: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Padi', 'Beras'], chartType: 'bar', notes: 'Produksi Padi Beras' },

  // ==================== ADDITIONAL INTEROP - PETERNAKAN ====================
  373: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Telur', 'Susu'], chartType: 'bar', notes: 'Produksi Telur Susu' },
  374: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Ayam Ras', 'Ayam Buras', 'Itik'], chartType: 'bar', notes: 'Daging Unggas' },
  375: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Pemotongan', 'Kematian'], chartType: 'bar', notes: 'Daging Babi' },
  376: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Pemotongan', 'Kematian'], chartType: 'bar', notes: 'Daging Domba' },
  377: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Pemotongan', 'Kematian'], chartType: 'bar', notes: 'Daging Kambing' },
  378: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Pemotongan', 'Kematian'], chartType: 'bar', notes: 'Daging Kerbau' },
  379: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Pemotongan', 'Kematian'], chartType: 'bar', notes: 'Daging Kuda' },
  380: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Pemotongan', 'Kematian'], chartType: 'bar', notes: 'Daging Sapi' },
  381: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Ayam Ras', 'Ayam Buras', 'Itik', 'Entok'], chartType: 'bar', notes: 'Populasi Unggas' },
  382: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Sapi', 'Kerbau', 'Kambing', 'Babi'], chartType: 'bar', notes: 'Populasi Ternak Interop' },
  383: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Padi', 'Beras'], chartType: 'bar', notes: 'Produksi Padi Beras Interop' },
  384: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Luas Panen', 'Produktivitas', 'Produksi'], chartType: 'bar', notes: 'Padi Interop' },

  // ==================== ADDITIONAL INTEROP - PERIKANAN ====================
  385: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Volume', 'Nilai'], chartType: 'bar', notes: 'Perikanan Tangkap Darat' },
  386: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Kolam', 'Tambak', 'Karamba'], chartType: 'bar', notes: 'Perikanan Budidaya per Kegiatan' },
  387: { profile: 'category-comparison', xAxis: 'Jenis Produksi', yAxis: ['Volume'], chartType: 'bar', notes: 'Kayu Bulat Olahan' },
  388: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Volume', 'Nilai'], chartType: 'bar', notes: 'Perikanan Budidaya Komoditas' },
  389: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Volume', 'Nilai'], chartType: 'bar', notes: 'Perikanan Budidaya Jenis' },
  390: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Volume', 'Nilai'], chartType: 'bar', notes: 'Perikanan Tangkap Laut Komoditas' },
  391: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Volume', 'Nilai'], chartType: 'bar', notes: 'Perikanan Tangkap Darat Lokasi' },
  392: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Volume', 'Nilai'], chartType: 'bar', notes: 'Perikanan Tangkap per Jenis' },
  393: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Hutan', 'Konservasi'], chartType: 'bar', notes: 'Luas Kawasan Hutan' },
  394: { profile: 'category-comparison', xAxis: 'Jenis Tanaman', yAxis: ['Produksi'], chartType: 'bar', notes: 'Perkebunan Rakyat' },
  396: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Telur', 'Susu'], chartType: 'bar', notes: 'Telur Susu Dynamic' },
  397: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Ayam Ras', 'Ayam Buras', 'Itik'], chartType: 'bar', notes: 'Daging Unggas Dynamic' },
  398: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Kelapa', 'Cengkeh', 'Pala'], chartType: 'bar', notes: 'Luas Perkebunan' },
  399: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Kelapa', 'Cengkeh', 'Pala'], chartType: 'bar', notes: 'Produksi Perkebunan' },
  400: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Volume', 'Nilai'], chartType: 'bar', notes: 'Perikanan Tangkap Laut' },
  401: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Tuna', 'Cakalang', 'Tongkol'], chartType: 'bar', notes: 'Produksi Ikan Laut' },
  402: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Tuna', 'Cakalang', 'Tongkol'], chartType: 'bar', notes: 'Nilai Ikan Laut' },
  403: { profile: 'category-comparison', xAxis: 'Jenis Produksi', yAxis: ['Volume'], chartType: 'bar', notes: 'Kayu Bulat Dynamic' },

  // ==================== ADDITIONAL INTEROP - PERIKANAN LANJUTAN ====================
  404: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Volume', 'Nilai'], chartType: 'bar', notes: 'Budidaya per Jenis Interop' },
  405: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Volume', 'Nilai'], chartType: 'bar', notes: 'Budidaya Komoditas Interop' },
  406: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Kolam', 'Tambak', 'Karamba'], chartType: 'bar', notes: 'Budidaya Kegiatan Interop' },
  407: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Sapi', 'Kambing', 'Babi'], chartType: 'bar', notes: 'Daging Ternak Interop' },
  408: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Volume', 'Nilai'], chartType: 'bar', notes: 'Tangkap Darat Lokasi Interop' },
  409: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Volume', 'Nilai'], chartType: 'bar', notes: 'Tangkap Darat Komoditas Interop' },
  410: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Volume', 'Nilai'], chartType: 'bar', notes: 'Tangkap Laut Komoditas Interop' },
  411: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Volume', 'Nilai'], chartType: 'bar', notes: 'Tangkap Jenis Interop' },
  412: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Cabai', 'Tomat', 'Bawang'], chartType: 'bar', notes: 'Luas Panen Sayuran Dynamic' },
  413: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Kelapa', 'Cengkeh', 'Pala'], chartType: 'bar', notes: 'Luas Perkebunan Interop' },
  414: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Kelapa', 'Cengkeh', 'Pala'], chartType: 'bar', notes: 'Produksi Perkebunan Interop' },
  415: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Jagung', 'Kedelai'], chartType: 'bar', notes: 'Produksi Jagung Kedelai' },

  // ==================== ADDITIONAL DYNAMIC - INFRASTRUKTUR ====================
  417: { profile: 'category-comparison', xAxis: 'Unit Layanan', yAxis: ['Daya', 'Produksi', 'Distribusi'], chartType: 'bar', notes: 'Listrik PLN' },
  418: { profile: 'category-comparison', xAxis: 'Unit Layanan', yAxis: ['Pelanggan'], chartType: 'bar', notes: 'Pelanggan Listrik' },
  420: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Usaha', 'Pekerja', 'Pendapatan', 'Pengeluaran'], chartType: 'bar', notes: 'IMK per Kab' },
  421: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['1-4', '5-19', '20+'], chartType: 'bar', notes: 'IMK per Kelompok Pekerja' },
  422: { profile: 'category-comparison', xAxis: 'Indikator', yAxis: ['Nilai'], chartType: 'bar', notes: 'Statistik Konstruksi' },
  423: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Laki-laki', 'Perempuan'], chartType: 'bar', notes: 'IPM per Kab JK LFSP' },
  424: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Laki-laki', 'Perempuan'], chartType: 'bar', notes: 'IPM per Kab JK' },
  426: { profile: 'category-comparison', xAxis: 'Karakteristik', yAxis: ['Miskin', 'Tidak Miskin'], chartType: 'bar', notes: 'Karakteristik RT Miskin' },

  // ==================== ADDITIONAL DYNAMIC - GENDER ====================
  432: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['IDG'], chartType: 'bar', notes: 'IDG per Kab' },
  433: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Laki-laki', 'Perempuan'], chartType: 'bar', notes: 'Tenaga Profesional per JK' },
  434: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Laki-laki', 'Perempuan'], chartType: 'bar', notes: 'Sumbangan Pendapatan per JK' },
  435: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Laki-laki', 'Perempuan'], chartType: 'bar', notes: 'Keterlibatan Parlemen per JK' },
  436: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['IPG'], chartType: 'bar', notes: 'IPG per Kab LFSP' },
  437: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['IPG'], chartType: 'bar', notes: 'IPG per Kab' },

  // ==================== ADDITIONAL INTEROP - KOMUNIKASI & TRANSPORTASI ====================
  438: { profile: 'geo-single-metric', xAxis: 'Wilayah', yAxis: ['Jumlah'], chartType: 'bar', notes: 'Desa dengan Kantor Pos' },
  439: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Kuat', 'Lemah', 'Tidak Ada'], chartType: 'bar', notes: 'Sinyal Internet per Kab' },
  440: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Mobil', 'Motor', 'Bus'], chartType: 'bar', notes: 'Kendaraan Bermotor' },
  441: { profile: 'category-comparison', xAxis: 'Indikator', yAxis: ['Nilai'], chartType: 'bar', notes: 'Statistik Konstruksi Interop' },
  442: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Perusahaan', 'Tenaga Kerja', 'Investasi', 'Produksi'], chartType: 'bar', notes: 'IBS per Kab' },
  443: { profile: 'time-series-monthly', xAxis: 'Triwulan', yAxis: ['Pertumbuhan'], chartType: 'line', notes: 'Pertumbuhan IBS' },
  444: { profile: 'geo-multi-metric', xAxis: 'Wilayah', yAxis: ['Nasional', 'Provinsi', 'Kab/Kota'], chartType: 'bar', notes: 'Jalan per Kewenangan' },
  447: { profile: 'time-series-monthly', xAxis: 'Bulan', yAxis: ['Penumpang Datang', 'Penumpang Berangkat'], chartType: 'line', notes: 'Penumpang Bandara' },

  // ==================== ADDITIONAL DYNAMIC - KEMISKINAN ====================
  454: { profile: 'category-comparison', xAxis: 'Daerah', yAxis: ['Jumlah'], chartType: 'bar', notes: 'Penduduk Miskin Kota/Desa' },
  455: { profile: 'category-comparison', xAxis: 'Daerah', yAxis: ['Persentase'], chartType: 'bar', notes: 'Persentase Miskin Kota/Desa' },
  456: { profile: 'few-rows-category', xAxis: 'Provinsi', yAxis: ['Jumlah', 'Persentase'], chartType: 'bar', notes: 'Jumlah dan Persentase Miskin' },

  // ==================== STATIC DATA (Non-Chartable) ====================
  7: { profile: 'single-row', xAxis: 'Wilayah', yAxis: ['Ibukota Kabupaten/Kota'], chartType: 'none', notes: 'Ibukota Kab/Kota - static, not chartable' },
  313: { profile: 'empty', xAxis: '', yAxis: [], chartType: 'none', notes: 'Static placeholder - no data' },

  // ==================== PRESSRELEASE (Document Lists - Non-Chartable) ====================
  166: { profile: 'unknown', xAxis: 'rl_date', yAxis: [], chartType: 'none', notes: 'BRS Inflasi - document list' },
  167: { profile: 'unknown', xAxis: 'rl_date', yAxis: [], chartType: 'none', notes: 'BRS NTP - document list' },
  168: { profile: 'unknown', xAxis: 'rl_date', yAxis: [], chartType: 'none', notes: 'BRS TPK - document list' },
  169: { profile: 'unknown', xAxis: 'rl_date', yAxis: [], chartType: 'none', notes: 'BRS Ekspor Impor - document list' },
};

/**
 * Get chart configuration for a specific indicator.
 * Falls back to dynamic profiling if not in pre-computed map.
 */
export function getIndicatorChartConfig(
  sourceId: number,
  columns?: string[] | null,
  rows?: Array<Record<string, unknown>> | null,
  sourceType?: 'dynamic' | 'interop' | 'exim'
): DataProfileResult {
  // For EXIM sources (159, 160), ALWAYS use dynamic profiling when data is available
  // This allows detecting category-based views (by komoditas/negara/pelabuhan)
  const isEximSource = sourceId === 159 || sourceId === 160 || sourceType === 'exim';
  
  if (isEximSource && columns && rows && rows.length > 0) {
    // Dynamic profiling to detect if it's category view or time-series
    return profileChartData(columns, rows, 'exim');
  }
  
  // Check pre-computed map first
  const precomputed = INDICATOR_CHART_MAP[sourceId];
  if (precomputed && (!columns || !rows)) {
    return {
      profile: precomputed.profile,
      dimensions: {
        ...(precomputed.xAxis.toLowerCase().includes('bulan') && { time: { column: precomputed.xAxis, type: 'time', count: 12 } }),
        ...(precomputed.xAxis.toLowerCase().includes('wilayah') && { geo: { column: precomputed.xAxis, type: 'geo', count: 11 } }),
      },
      metrics: precomputed.yAxis.map(y => ({ column: y, type: 'numeric', range: [0, 0], hasNulls: false })),
      recommended: {
        chartType: precomputed.chartType,
        xAxis: precomputed.xAxis,
        yAxis: precomputed.yAxis,
        alternatives: precomputed.chartType === 'line' ? ['bar'] : precomputed.chartType === 'bar' ? ['pie'] : [],
        reason: precomputed.notes || '',
      },
      isChartable: precomputed.chartType !== 'none',
      warnings: [],
    };
  }
  
  // Dynamic profiling
  if (columns && rows) {
    return profileChartData(columns, rows, sourceType);
  }
  
  // Fallback
  return {
    profile: 'unknown',
    dimensions: {},
    metrics: [],
    recommended: {
      chartType: 'bar',
      xAxis: '',
      yAxis: [],
      alternatives: [],
      reason: 'Konfigurasi tidak ditemukan, menggunakan default',
    },
    isChartable: false,
    warnings: ['Konfigurasi chart tidak tersedia'],
  };
}

// ============================================================================
// CHART VALIDATION
// ============================================================================

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  sanitizedData?: {
    categories: string[];
    series: Array<{ name: string; data: number[] }>;
  };
}

export function validateChartData(
  profile: DataProfileResult,
  rows: Array<Record<string, unknown>>
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  if (!profile.isChartable) {
    errors.push('Data tidak cocok untuk visualisasi chart');
    return { isValid: false, errors, warnings };
  }
  
  const { recommended, dimensions, metrics } = profile;
  
  // Validate X axis
  if (!recommended.xAxis) {
    errors.push('Kolom X axis tidak terdeteksi');
  }
  
  // Validate Y axis
  if (recommended.yAxis.length === 0) {
    errors.push('Tidak ada kolom metrik untuk Y axis');
  }
  
  // Validate minimum data points
  if (rows.length < 2 && recommended.chartType !== 'none') {
    warnings.push('Kurang dari 2 data point - chart mungkin tidak informatif');
  }
  
  // Validate for line chart
  if (recommended.chartType === 'line' && rows.length < 3) {
    warnings.push('Line chart membutuhkan minimal 3 data point');
  }
  
  // Validate for pie chart
  if (recommended.chartType === 'pie') {
    const uniqueCategories = new Set(rows.map(r => r[recommended.xAxis])).size;
    if (uniqueCategories > 10) {
      warnings.push('Pie chart tidak ideal untuk >10 kategori');
    }
  }
  
  // Sanitize data
  if (errors.length === 0) {
    const categories = rows.map(r => String(r[recommended.xAxis] || ''));
    const series = recommended.yAxis.map(yCol => ({
      name: yCol,
      data: rows.map(r => {
        const val = r[yCol];
        return typeof val === 'number' && Number.isFinite(val) ? val : 0;
      }),
    }));
    
    // Check for all zeros
    const allZeros = series.every(s => s.data.every(v => v === 0));
    if (allZeros) {
      warnings.push('Semua nilai metrik adalah 0 atau null');
    }
    
    return {
      isValid: true,
      errors,
      warnings,
      sanitizedData: { categories, series },
    };
  }
  
  return { isValid: false, errors, warnings };
}

// ============================================================================
// BRIDGE: Rule-based profiler → ChartAgentOutput
// ============================================================================

/**
 * Convert a rule-based `DataProfileResult` into a `ChartAgentOutput`-compatible
 * object so the same `ChatChart` component can render it.
 *
 * Used as a fallback when the LLM Chart Agent fails, times out, or is disabled.
 * The output matches the `ChartAgentOutput` type from `@/types/chat.ts`.
 */
export function profileToChartConfig(
  result: DataProfileResult,
  tableTitle?: string,
): {
  should_render: boolean;
  render_reason: string;
  chart_type: 'line' | 'bar' | 'pie' | 'area' | 'stacked-bar' | 'grouped-bar';
  x_axis: { column: string; label: string; type: 'category' | 'datetime' | 'numeric' };
  series: Array<{ column: string; label: string; type: 'primary' | 'secondary' }>;
  y_axis: { label: string; format: 'number' | 'percentage' | 'currency' | 'index' };
  options: {
    stacked: boolean;
    show_legend: boolean;
    show_data_labels: boolean;
    orientation: 'horizontal' | 'vertical';
    color_scheme: 'default' | 'categorical' | 'sequential' | 'diverging';
  };
  chart_title: string;
  chart_subtitle: string | null;
  alternative: { chart_type: 'line' | 'bar' | 'pie' | 'area'; reason: string } | null;
} | null {
  if (!result.isChartable || result.recommended.chartType === 'none') return null;

  const rec = result.recommended;
  const metrics = result.metrics;
  const yAxisCols = rec.yAxis.filter(Boolean);
  if (!rec.xAxis || yAxisCols.length === 0) return null;

  // Map profiler chart type to ChartAgentOutput chart_type
  let chartType: 'line' | 'bar' | 'pie' | 'area' | 'stacked-bar' | 'grouped-bar' = rec.chartType === 'none' ? 'bar' : rec.chartType as any;

  // Geo profiles should use horizontal bar / grouped-bar
  const isGeo = result.profile === 'geo-single-metric' || result.profile === 'geo-multi-metric';
  if (isGeo && yAxisCols.length > 1) chartType = 'grouped-bar';

  // Exim category profiles → horizontal bar
  const isEximCat = result.profile.startsWith('exim-category');

  // Determine orientation
  const isHorizontal = isGeo || isEximCat;

  // Determine Y-axis format from first metric
  const firstMetric = metrics[0];
  let yFormat: 'number' | 'percentage' | 'currency' | 'index' = 'number';
  if (firstMetric) {
    if (firstMetric.type === 'percentage') yFormat = 'percentage';
    else if (firstMetric.type === 'index') yFormat = 'index';
    else if (firstMetric.type === 'currency') yFormat = 'currency';
  }

  // Build series
  const series = yAxisCols.map((col, i) => ({
    column: col,
    label: col,
    type: (i === 0 ? 'primary' : 'secondary') as 'primary' | 'secondary',
  }));

  // Alternative suggestion
  const altType = rec.alternatives[0];
  const alternative = altType
    ? { chart_type: altType as 'line' | 'bar' | 'pie' | 'area', reason: 'Alternatif dari profiler' }
    : null;

  return {
    should_render: true,
    render_reason: `[Fallback] ${rec.reason}`,
    chart_type: chartType,
    x_axis: {
      column: rec.xAxis,
      label: rec.xAxis,
      type: result.dimensions.time ? 'category' : 'category',
    },
    series,
    y_axis: {
      label: yAxisCols.length === 1 ? yAxisCols[0] : 'Nilai',
      format: yFormat,
    },
    options: {
      stacked: false,
      show_legend: series.length > 1,
      show_data_labels: chartType === 'pie',
      orientation: isHorizontal ? 'horizontal' : 'vertical',
      color_scheme: isGeo ? 'categorical' : 'default',
    },
    chart_title: tableTitle || 'Data Statistik',
    chart_subtitle: null,
    alternative,
  };
}
