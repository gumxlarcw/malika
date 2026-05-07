/**
 * BPS Domain Synonym Dictionary — Static Query Expansion
 *
 * Comprehensive synonym/variant map for BPS (Badan Pusat Statistik) statistical terms.
 * Used by vectorSearch.expandQuery() to expand user queries BEFORE embedding generation,
 * providing keyword/BM25 matching even when the LLM synonym expansion times out.
 *
 * Design:
 *  - Each key is a trigger word (lowercase) that appears in user queries
 *  - Values are arrays of related terms to add to the expanded query
 *  - Bidirectional: if "miskin" maps to "kemiskinan", "kemiskinan" also maps to "miskin"
 *  - Includes Indonesian colloquial, formal, and English equivalents
 *
 * Coverage: 100+ BPS statistical domain terms covering:
 *  - Poverty & welfare, employment & labor, prices & inflation
 *  - Economic growth (PDRB), human development (IPM), education
 *  - Population & demographics, health, gender, trade, agriculture
 *  - Tourism, housing, industry, governance
 *
 * @module shared/bpsDomainSynonyms
 * @created 2026-02-23
 */

'use strict';

/**
 * Static domain synonym dictionary.
 * Key = trigger word (lowercase), Value = array of related terms.
 * The trigger word itself is NOT included in the array (added automatically by consumer).
 */
const BPS_DOMAIN_SYNONYMS = {
  // ═══════════════════════════════════════════════════════════════════
  // POVERTY & WELFARE (Kemiskinan & Kesejahteraan)
  // ═══════════════════════════════════════════════════════════════════
  'kemiskinan': ['miskin', 'penduduk miskin', 'garis kemiskinan', 'poverty', 'tingkat kemiskinan', 'persentase penduduk miskin', 'p0 p1 p2', 'indeks kedalaman'],
  'miskin': ['kemiskinan', 'penduduk miskin', 'garis kemiskinan', 'poverty', 'tingkat kemiskinan'],
  'poverty': ['kemiskinan', 'miskin', 'penduduk miskin', 'garis kemiskinan'],
  'gini': ['ketimpangan', 'rasio gini', 'gini ratio', 'inequality', 'distribusi pendapatan', 'koefisien gini'],
  'ketimpangan': ['gini', 'rasio gini', 'inequality', 'distribusi pendapatan', 'kesenjangan'],
  'kesejahteraan': ['welfare', 'kesejahteraan rakyat', 'taraf hidup', 'konsumsi', 'pengeluaran'],

  // ═══════════════════════════════════════════════════════════════════
  // EMPLOYMENT & LABOR (Ketenagakerjaan)
  // ═══════════════════════════════════════════════════════════════════
  'pengangguran': ['penganggur', 'nganggur', 'tidak bekerja', 'unemployment', 'pencari kerja', 'tpt', 'tingkat pengangguran terbuka'],
  'nganggur': ['pengangguran', 'tidak bekerja', 'pencari kerja', 'penganggur'],
  'ketenagakerjaan': ['tenaga kerja', 'pekerja', 'angkatan kerja', 'employment', 'labor', 'lapangan kerja', 'tpak', 'tpt'],
  'pekerja': ['tenaga kerja', 'ketenagakerjaan', 'buruh', 'karyawan', 'employment', 'angkatan kerja'],
  'upah': ['gaji', 'upah minimum', 'ump', 'umk', 'upah rata-rata', 'wage', 'pendapatan pekerja', 'balas jasa'],
  'gaji': ['upah', 'upah minimum', 'ump', 'umk', 'pendapatan', 'wage'],
  'buruh': ['pekerja', 'tenaga kerja', 'karyawan', 'upah', 'labor'],

  // ═══════════════════════════════════════════════════════════════════
  // PRICES & INFLATION (Harga & Inflasi)
  // ═══════════════════════════════════════════════════════════════════
  'inflasi': ['kenaikan harga', 'ihk', 'indeks harga konsumen', 'inflation', 'deflasi', 'harga konsumen'],
  'deflasi': ['inflasi', 'penurunan harga', 'ihk', 'indeks harga konsumen'],
  'harga': ['ihk', 'indeks harga', 'inflasi', 'harga konsumen', 'price'],

  // ═══════════════════════════════════════════════════════════════════
  // ECONOMIC GROWTH (Pertumbuhan Ekonomi / PDRB)
  // ═══════════════════════════════════════════════════════════════════
  'pdrb': ['produk domestik regional bruto', 'gross regional domestic product', 'pertumbuhan ekonomi', 'ekonomi', 'grdp'],
  'ekonomi': ['pdrb', 'pertumbuhan ekonomi', 'produk domestik', 'perekonomian', 'economic', 'lapangan usaha'],
  'pertumbuhan': ['growth', 'laju pertumbuhan', 'perkembangan', 'trend', 'tren'],
  'tren': ['trend', 'perkembangan', 'kecenderungan', 'pertumbuhan', 'laju', 'perubahan'],
  'perekonomian': ['ekonomi', 'pdrb', 'produk domestik', 'pertumbuhan ekonomi'],
  'lapangan usaha': ['sektor ekonomi', 'pdrb', 'industri', 'pertanian', 'perdagangan', 'jasa'],
  'pengeluaran': ['konsumsi', 'belanja', 'expenditure', 'pdrb pengeluaran', 'pengeluaran perkapita'],
  'konsumsi': ['pengeluaran', 'belanja', 'konsumsi rumah tangga', 'pengeluaran perkapita'],
  'perkapita': ['per kapita', 'per orang', 'per penduduk', 'rata-rata'],
  'rerata': ['rata-rata', 'average', 'mean', 'rataan', 'per kapita'],

  // ═══════════════════════════════════════════════════════════════════
  // HUMAN DEVELOPMENT (IPM & Indeks Pembangunan)
  // ═══════════════════════════════════════════════════════════════════
  'ipm': ['indeks pembangunan manusia', 'human development index', 'hdi', 'pembangunan manusia'],
  'pembangunan': ['development', 'ipm', 'indeks pembangunan', 'pembangunan manusia'],

  // ═══════════════════════════════════════════════════════════════════
  // POPULATION & DEMOGRAPHICS (Kependudukan)
  // ═══════════════════════════════════════════════════════════════════
  'penduduk': ['populasi', 'warga', 'demografi', 'kependudukan', 'jumlah penduduk', 'population'],
  'demografi': ['penduduk', 'populasi', 'kependudukan', 'demographics'],
  'kependudukan': ['penduduk', 'populasi', 'demografi', 'jumlah penduduk', 'proyeksi penduduk'],
  'populasi': ['penduduk', 'jumlah penduduk', 'kependudukan', 'population'],
  'proyeksi': ['perkiraan', 'estimasi', 'prediksi', 'proyeksi penduduk', 'projection'],
  'kepadatan': ['density', 'kepadatan penduduk', 'per km2', 'penduduk per luas'],
  'fertilitas': ['kelahiran', 'tfr', 'total fertility rate', 'angka kelahiran', 'birth rate'],
  'kelahiran': ['fertilitas', 'tfr', 'birth rate', 'natalitas', 'bayi lahir'],
  'mortalitas': ['kematian', 'angka kematian', 'mortality', 'death rate'],
  'rumah tangga': ['household', 'keluarga', 'rt', 'jumlah rumah tangga'],

  // ═══════════════════════════════════════════════════════════════════
  // MIGRATION (Migrasi)
  // ═══════════════════════════════════════════════════════════════════
  'migrasi': ['perpindahan', 'pindahan', 'pendatang', 'mobilitas penduduk', 'migration'],
  'pindahan': ['migrasi', 'perpindahan', 'pendatang', 'migration'],
  'pendatang': ['migrasi', 'pindahan', 'migrasi masuk', 'migration inflow', 'perpindahan'],
  'emigrasi': ['migrasi keluar', 'pindah keluar', 'outmigration'],
  'imigrasi': ['migrasi masuk', 'pindah masuk', 'pendatang', 'inmigration'],
  'mobilitas': ['perpindahan', 'migrasi', 'pergerakan penduduk'],

  // ═══════════════════════════════════════════════════════════════════
  // EDUCATION (Pendidikan)
  // ═══════════════════════════════════════════════════════════════════
  'pendidikan': ['sekolah', 'education', 'belajar', 'siswa', 'murid', 'partisipasi sekolah', 'angka partisipasi'],
  'sekolah': ['pendidikan', 'education', 'siswa', 'murid', 'pelajar', 'angka partisipasi'],
  'partisipasi': ['apk', 'apm', 'angka partisipasi', 'partisipasi sekolah', 'angka partisipasi kasar', 'angka partisipasi murni'],
  'literasi': ['melek huruf', 'baca tulis', 'literacy', 'angka melek huruf'],
  'harapan lama sekolah': ['hls', 'expected years of schooling', 'lama sekolah'],
  'lama sekolah': ['rls', 'rata-rata lama sekolah', 'mean years of schooling', 'harapan lama sekolah', 'hls'],
  'putus sekolah': ['dropout', 'tidak sekolah', 'putus pendidikan'],

  // ═══════════════════════════════════════════════════════════════════
  // HEALTH (Kesehatan)
  // ═══════════════════════════════════════════════════════════════════
  'kesehatan': ['health', 'fasilitas kesehatan', 'rumah sakit', 'puskesmas', 'tenaga kesehatan'],
  'harapan hidup': ['ahh', 'angka harapan hidup', 'umur harapan hidup', 'life expectancy', 'uhh'],
  'kematian bayi': ['akb', 'angka kematian bayi', 'infant mortality', 'imr'],
  'kematian ibu': ['aki', 'angka kematian ibu', 'maternal mortality'],
  'stunting': ['gizi', 'gizi buruk', 'malnutrisi', 'balita pendek'],
  'gizi': ['stunting', 'nutrisi', 'gizi buruk', 'malnutrisi', 'kesehatan anak'],

  // ═══════════════════════════════════════════════════════════════════
  // TRADE (Perdagangan)
  // ═══════════════════════════════════════════════════════════════════
  'ekspor': ['export', 'perdagangan luar negeri', 'komoditi ekspor', 'nilai ekspor', 'volume ekspor'],
  'impor': ['import', 'perdagangan luar negeri', 'komoditi impor', 'nilai impor', 'volume impor'],
  'perdagangan': ['trade', 'ekspor', 'impor', 'neraca perdagangan', 'perdagangan internasional'],
  'neraca': ['balance', 'neraca perdagangan', 'surplus', 'defisit', 'trade balance'],
  'exim': ['ekspor impor', 'ekspor', 'impor', 'perdagangan internasional', 'trade'],

  // ═══════════════════════════════════════════════════════════════════
  // AGRICULTURE (Pertanian)
  // ═══════════════════════════════════════════════════════════════════
  'pertanian': ['agriculture', 'petani', 'tanaman', 'panen', 'sawah', 'lahan pertanian', 'produksi pertanian'],
  'petani': ['pertanian', 'ntp', 'nilai tukar petani', 'farmer', 'agriculturist'],
  'ntp': ['nilai tukar petani', 'farmer terms of trade', 'pertanian', 'petani'],
  'panen': ['produksi', 'harvest', 'hasil panen', 'produktivitas', 'pertanian'],
  'nelayan': ['perikanan', 'ntn', 'nilai tukar nelayan', 'fisherman', 'ikan', 'tangkapan'],
  'perikanan': ['nelayan', 'ikan', 'budidaya', 'tangkapan ikan', 'fishery', 'aquaculture'],
  'perkebunan': ['kebun', 'kelapa', 'cengkeh', 'plantation', 'tanaman perkebunan'],

  // ═══════════════════════════════════════════════════════════════════
  // TOURISM (Pariwisata)
  // ═══════════════════════════════════════════════════════════════════
  'pariwisata': ['tourism', 'wisatawan', 'hotel', 'tpk', 'kunjungan wisata', 'wisata'],
  'wisatawan': ['tourist', 'wisata', 'pariwisata', 'pengunjung', 'kunjungan'],
  'hotel': ['penginapan', 'akomodasi', 'tpk', 'tingkat penghunian kamar', 'bintang', 'okupansi'],
  'tpk': ['tingkat penghunian kamar', 'hotel', 'okupansi', 'kamar hotel'],

  // ═══════════════════════════════════════════════════════════════════
  // GENDER (Gender & Kesetaraan)
  // ═══════════════════════════════════════════════════════════════════
  'gender': ['jenis kelamin', 'laki-laki', 'perempuan', 'kesetaraan gender', 'ipg', 'idg', 'ikg'],
  'ipg': ['indeks pembangunan gender', 'gender development index', 'kesetaraan', 'pembangunan gender'],
  'idg': ['indeks pemberdayaan gender', 'gender empowerment', 'pemberdayaan gender'],
  'ikg': ['indeks ketimpangan gender', 'gender inequality index', 'ketimpangan gender'],

  // ═══════════════════════════════════════════════════════════════════
  // INDUSTRY & MANUFACTURING (Industri)
  // ═══════════════════════════════════════════════════════════════════
  'industri': ['manufaktur', 'pabrik', 'industry', 'pengolahan', 'manufacturing', 'produksi industri'],
  'manufaktur': ['industri', 'industri pengolahan', 'pabrik', 'manufacturing', 'produksi industri'],
  'konstruksi': ['bangunan', 'pembangunan', 'construction', 'infrastruktur'],

  // ═══════════════════════════════════════════════════════════════════
  // GOVERNANCE & DEMOCRACY (Pemerintahan)
  // ═══════════════════════════════════════════════════════════════════
  'demokrasi': ['idi', 'indeks demokrasi', 'democracy index', 'tata kelola'],

  // ═══════════════════════════════════════════════════════════════════
  // PUBLICATIONS & SOURCES (BRS & Publikasi)
  // ═══════════════════════════════════════════════════════════════════
  'brs': ['berita resmi statistik', 'press release', 'rilis', 'berita statistik'],
  'publikasi': ['publication', 'buku', 'terbitan', 'laporan', 'dokumen statistik'],
  'sensus': ['cacah', 'pencacahan', 'census', 'pendataan', 'sensus penduduk'],
  'survei': ['survey', 'penelitian', 'pengumpulan data', 'susenas', 'sakernas'],

  // ═══════════════════════════════════════════════════════════════════
  // HOUSING & INFRASTRUCTURE (Perumahan)
  // ═══════════════════════════════════════════════════════════════════
  'perumahan': ['rumah', 'tempat tinggal', 'housing', 'hunian', 'pemukiman'],
  'infrastruktur': ['sarana', 'prasarana', 'jalan', 'listrik', 'internet', 'infrastructure'],
  'listrik': ['electricity', 'penerangan', 'energi', 'power'],
  'internet': ['ict', 'telekomunikasi', 'sinyal', 'informasi komunikasi', 'teknologi'],

  // ═══════════════════════════════════════════════════════════════════
  // ENVIRONMENT & DISASTER (Lingkungan)
  // ═══════════════════════════════════════════════════════════════════
  'bencana': ['disaster', 'bencana alam', 'gempa', 'banjir', 'longsor'],
  'lingkungan': ['environment', 'polusi', 'pencemaran', 'limbah', 'sampah'],

  // ═══════════════════════════════════════════════════════════════════
  // TRANSPORT (Transportasi)
  // ═══════════════════════════════════════════════════════════════════
  'transportasi': ['transport', 'angkutan', 'kendaraan', 'penerbangan', 'pelabuhan', 'kapal'],

  // ═══════════════════════════════════════════════════════════════════
  // SOCIAL (Sosial)
  // ═══════════════════════════════════════════════════════════════════
  'sosial': ['social', 'masyarakat', 'permasalahan sosial', 'kesejahteraan sosial'],
  'kriminalitas': ['kejahatan', 'crime', 'tindak pidana', 'keamanan'],
};

/**
 * Get all domain synonyms for a given word.
 * Returns empty array if no synonyms found.
 *
 * @param {string} word - Word to look up (case-insensitive)
 * @returns {string[]} - Array of synonym/variant terms
 */
function getDomainSynonyms(word) {
  return BPS_DOMAIN_SYNONYMS[word?.toLowerCase()] || [];
}

/**
 * Check if a word has domain synonyms.
 * @param {string} word
 * @returns {boolean}
 */
function hasDomainSynonyms(word) {
  return word?.toLowerCase() in BPS_DOMAIN_SYNONYMS;
}

/**
 * Get all trigger words (keys) in the synonym dictionary.
 * @returns {string[]}
 */
function getAllTriggerWords() {
  return Object.keys(BPS_DOMAIN_SYNONYMS);
}

module.exports = {
  BPS_DOMAIN_SYNONYMS,
  getDomainSynonyms,
  hasDomainSynonyms,
  getAllTriggerWords,
};
