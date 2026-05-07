/**
 * Merge Bundles Configuration
 * 
 * Bundle definitions for extended multi-source merge.
 * Each bundle groups related datasources that can be merged into a single table.
 * 
 * Structure:
 * - id: unique identifier
 * - name: human-readable name
 * - triggers: keywords that activate this bundle
 * - sources: array of source definitions with id, label, unit, valueColumn
 * - keyColumn: column to join on (usually 'Wilayah' or 'Bulan')
 * - cluster: topic cluster for validation
 */

const logger = require('../../../utils/logger').child({ service: 'MergeBundles' });

// ============================================================================
// WILAYAH-BASED MERGE BUNDLES
// ============================================================================

const MERGE_BUNDLES = {
  // Kemiskinan Full Profile
  kemiskinan_full: {
    id: 'kemiskinan_full',
    name: 'Profil Kemiskinan Lengkap',
    triggers: ['profil kemiskinan', 'data lengkap kemiskinan', 'kemiskinan komprehensif', 
               'kemiskinan full', 'semua indikator kemiskinan', 'indikator kemiskinan lengkap'],
    sources: [
      { id: 452, label: 'Jumlah Penduduk Miskin', unit: 'ribu', valueColumn: 'Nilai' },
      { id: 450, label: 'Persentase Penduduk Miskin', unit: '%', valueColumn: 'Nilai' },
      { id: 453, label: 'Garis Kemiskinan', unit: 'Rp/kapita/bln', valueColumn: 'Nilai' },
      { id: 451, label: 'Indeks Kedalaman (P1)', unit: 'indeks', valueColumn: 'Indeks Kedalaman Kemiskinan (Indeks) - P1' },
      { id: 451, label: 'Indeks Keparahan (P2)', unit: 'indeks', valueColumn: 'Indeks Keparahan Kemiskinan (Indeks) - P2' },
    ],
    keyColumn: 'Wilayah',
    cluster: 'kemiskinan',
  },
  
  // IPM + Components
  ipm_komponen: {
    id: 'ipm_komponen',
    name: 'IPM dan Komponennya',
    triggers: ['ipm dan komponen', 'komponen ipm', 'breakdown ipm', 'ipm lengkap',
               'ipm beserta komponen', 'ipm full', 'unsur ipm'],
    sources: [
      { id: 428, label: 'IPM', unit: 'indeks', valueColumn: 'Nilai' },
      { id: 237, label: 'Angka Harapan Hidup (AHH)', unit: 'tahun', valueColumn: 'Nilai' },
      { id: 13, label: 'Harapan Lama Sekolah (HLS)', unit: 'tahun', valueColumn: 'Nilai' },
      { id: 16, label: 'Rata-rata Lama Sekolah (RLS)', unit: 'tahun', valueColumn: 'Nilai' },
    ],
    keyColumn: 'Wilayah',
    cluster: 'ipm',
  },
  
  // Ketenagakerjaan (TPT + TPAK)
  ketenagakerjaan: {
    id: 'ketenagakerjaan',
    name: 'Indikator Ketenagakerjaan',
    triggers: ['tpt dan tpak', 'tpak dan tpt', 'ketenagakerjaan lengkap', 
               'pengangguran dan partisipasi', 'indikator tenaga kerja'],
    sources: [
      { id: 201, label: 'TPT (Tingkat Pengangguran Terbuka)', unit: '%', valueColumn: 'Nilai' },
      { id: 202, label: 'TPAK (Tingkat Partisipasi Angkatan Kerja)', unit: '%', valueColumn: 'Nilai' },
    ],
    keyColumn: 'Wilayah',
    cluster: 'ketenagakerjaan',
  },
};

// ============================================================================
// MONTHLY DIMENSION BUNDLES (Inflasi/IHK by Bulan)
// ============================================================================

/**
 * Monthly bundles for Inflasi + IHK data.
 * These bundles merge data with Bulan (month) as key column instead of Wilayah.
 * Each region has its own bundle since data is per-region (not aggregated).
 */
const MONTHLY_BUNDLES = {
  // Inflasi + IHK Provinsi Maluku Utara
  inflasi_provinsi: {
    id: 'inflasi_provinsi',
    name: 'Inflasi & IHK Provinsi Maluku Utara',
    triggers: ['inflasi dan ihk', 'inflasi ihk', 'profil inflasi', 'inflasi lengkap'],
    regionTriggers: ['maluku utara', 'malut', 'provinsi'],
    sources: [
      { id: 1, label: 'Inflasi MtM', valueColumn: 'month-to-month', unit: '%' },
      { id: 1, label: 'Inflasi YoY', valueColumn: 'year-on-year', unit: '%' },
      { id: 1, label: 'Inflasi YtD', valueColumn: 'year-to-date', unit: '%' },
      { id: 161, label: 'IHK', valueColumn: 'Nilai', unit: 'indeks' },
    ],
    keyColumn: 'Bulan',
    cluster: 'inflasi',
    dimension: 'bulan',
    isDefault: true, // Default when no region specified
  },
  
  // Inflasi + IHK Kota Ternate
  inflasi_ternate: {
    id: 'inflasi_ternate',
    name: 'Inflasi & IHK Kota Ternate',
    triggers: ['inflasi dan ihk', 'inflasi ihk', 'profil inflasi', 'inflasi lengkap'],
    regionTriggers: ['ternate', 'kota ternate'],
    sources: [
      { id: 164, label: 'Inflasi MtM', valueColumn: 'month-to-month', unit: '%' },
      { id: 164, label: 'Inflasi YoY', valueColumn: 'year-on-year', unit: '%' },
      // Note: Ternate doesn't have year-to-date column
      { id: 165, label: 'IHK', valueColumn: 'Nilai', unit: 'indeks' },
    ],
    keyColumn: 'Bulan',
    cluster: 'inflasi',
    dimension: 'bulan',
  },
  
  // Inflasi + IHK Kabupaten Halmahera Tengah
  inflasi_halteng: {
    id: 'inflasi_halteng',
    name: 'Inflasi & IHK Kabupaten Halmahera Tengah',
    triggers: ['inflasi dan ihk', 'inflasi ihk', 'profil inflasi', 'inflasi lengkap'],
    regionTriggers: ['halteng', 'halmahera tengah', 'halmaheratengah'],
    sources: [
      { id: 163, label: 'Inflasi MtM', valueColumn: 'month-to-month', unit: '%' },
      { id: 163, label: 'Inflasi YoY', valueColumn: 'year-on-year', unit: '%' },
      { id: 163, label: 'Inflasi YtD', valueColumn: 'year-to-date', unit: '%' },
      { id: 2, label: 'IHK', valueColumn: 'Nilai', unit: 'indeks' },
    ],
    keyColumn: 'Bulan',
    cluster: 'inflasi',
    dimension: 'bulan',
  },
};

// ============================================================================
// BUNDLE DETECTION FUNCTIONS
// ============================================================================

/**
 * Detect region from query for monthly bundles
 * @param {string} query - User query
 * @returns {string} Region key: 'ternate', 'halteng', or 'provinsi'
 */
function detectInflasiRegion(query) {
  const q = String(query || '').toLowerCase();
  
  // Check for specific regions first
  if (q.includes('ternate')) return 'ternate';
  if (q.includes('halteng') || q.includes('halmahera tengah')) return 'halteng';
  
  // Default to provinsi if no specific region or explicitly mentioned
  if (q.includes('maluku utara') || q.includes('malut') || q.includes('provinsi')) return 'provinsi';
  
  // Default fallback
  return 'provinsi';
}

/**
 * Detect if a query matches any monthly bundle
 * @param {string} query - User query
 * @param {string} topic - Conversation topic
 * @returns {Object|null} Bundle definition or null
 */
function detectMonthlyBundle(query, topic) {
  const queryLower = String(query || '').toLowerCase();
  const topicLower = String(topic || '').toLowerCase();
  const combined = `${queryLower} ${topicLower}`;
  
  // Check if query is about inflasi/ihk
  const isInflasiQuery = combined.includes('inflasi') || combined.includes('ihk') || 
                          combined.includes('harga konsumen');
  
  if (!isInflasiQuery) return null;
  
  // Check for multi-metric trigger (inflasi + ihk together)
  const hasMultiTrigger = (combined.includes('inflasi') && combined.includes('ihk')) ||
                          combined.includes('inflasi dan ihk') ||
                          combined.includes('inflasi ihk') ||
                          combined.includes('profil inflasi') ||
                          combined.includes('inflasi lengkap');
  
  if (!hasMultiTrigger) return null;
  
  // Detect region
  const region = detectInflasiRegion(combined);
  
  switch (region) {
    case 'ternate':
      logger.debug({ bundle: 'inflasi_ternate' }, 'Monthly bundle detected');
      return MONTHLY_BUNDLES.inflasi_ternate;
    case 'halteng':
      logger.debug({ bundle: 'inflasi_halteng' }, 'Monthly bundle detected');
      return MONTHLY_BUNDLES.inflasi_halteng;
    case 'provinsi':
    default:
      logger.debug({ bundle: 'inflasi_provinsi' }, 'Monthly bundle detected');
      return MONTHLY_BUNDLES.inflasi_provinsi;
  }
}

/**
 * Detect if a query matches any merge bundle
 * @param {string} query - User query
 * @param {string} topic - Conversation topic
 * @returns {Object|null} Bundle definition or null
 */
function detectMergeBundle(query, topic) {
  const queryLower = String(query || '').toLowerCase();
  const topicLower = String(topic || '').toLowerCase();
  const combined = `${queryLower} ${topicLower}`;
  
  for (const [id, bundle] of Object.entries(MERGE_BUNDLES)) {
    for (const trigger of bundle.triggers) {
      if (combined.includes(trigger)) {
        logger.debug({ bundle: id, trigger }, 'Extended bundle detected');
        return bundle;
      }
    }
  }
  return null;
}

module.exports = {
  MERGE_BUNDLES,
  MONTHLY_BUNDLES,
  detectInflasiRegion,
  detectMonthlyBundle,
  detectMergeBundle,
};
