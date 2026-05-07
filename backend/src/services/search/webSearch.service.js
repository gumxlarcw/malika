/**
 * Web Search Service - External Government Indicator Links
 * 
 * Provides curated links to external government data portals
 * based on the user's query. These are display-only links shown
 * in the chat UI for user exploration — NOT included in AI context.
 * 
 * Phase 9 - 2026-02-06
 */

'use strict';

const logger = require('../../utils/logger').child({ service: 'WebSearch' });

// ============================================================================
// EXTERNAL SOURCE REGISTRY
// ============================================================================

/**
 * Curated list of external government data sources relevant to
 * BPS Maluku Utara statistics domain.
 */
const EXTERNAL_SOURCES = [
  // Dukcapil Kemendagri (penduduk/kependudukan)
  {
    keywords: ['penduduk', 'populasi', 'demografi', 'sensus', 'kependudukan', 'jumlah penduduk', 'kepadatan', 'fertilitas', 'mortalitas', 'migrasi', 'pindah', 'pertumbuhan penduduk', 'ktp', 'akta', 'dukcapil', 'adminduk', 'catatan sipil'],
    title: 'Data Kependudukan — Dukcapil Kemendagri',
    url: 'https://dukcapil.kemendagri.go.id/',
    domain: 'dukcapil.kemendagri.go.id',
    snippet: 'Data administrasi kependudukan: jumlah penduduk, KTP, akta kelahiran, catatan sipil dari Ditjen Dukcapil.',
    trustBadge: 'Kementerian',
  },
  // Kementerian Pertanian
  {
    keywords: ['padi', 'beras', 'jagung', 'kedelai', 'pertanian', 'pangan', 'luas panen', 'produksi padi', 'tanaman', 'hortikultura', 'pupuk', 'lahan', 'sawah'],
    title: 'Data Statistik Pertanian — Kementerian Pertanian',
    url: 'https://satudata.pertanian.go.id/',
    domain: 'satudata.pertanian.go.id',
    snippet: 'Data produksi, luas panen, produktivitas tanaman pangan dan hortikultura dari Kementerian Pertanian.',
    trustBadge: 'Kementerian',
  },
  // Kementerian Kelautan dan Perikanan
  {
    keywords: ['ikan', 'perikanan', 'tangkap', 'budidaya', 'nelayan', 'kelautan', 'rumput laut', 'udang', 'tuna', 'cakalang', 'lobster'],
    title: 'Satu Data Kelautan dan Perikanan — KKP',
    url: 'https://statistik.kkp.go.id/',
    domain: 'statistik.kkp.go.id',
    snippet: 'Statistik perikanan tangkap, budidaya, dan kelautan dari Kementerian Kelautan dan Perikanan.',
    trustBadge: 'Kementerian',
  },
  // Kementerian Perindustrian
  {
    keywords: ['industri', 'manufaktur', 'ibs', 'perindustrian', 'pabrik', 'industri pengolahan'],
    title: 'Data Industri — Kementerian Perindustrian',
    url: 'https://kemenperin.go.id/statistik',
    domain: 'kemenperin.go.id',
    snippet: 'Data statistik sektor perindustrian dan manufaktur Indonesia.',
    trustBadge: 'Kementerian',
  },
  // Kementerian Perdagangan
  {
    keywords: ['ekspor', 'impor', 'perdagangan', 'neraca', 'komoditas', 'harga', 'pasar'],
    title: 'Data Perdagangan — Kementerian Perdagangan',
    url: 'https://statistik.kemendag.go.id/',
    domain: 'statistik.kemendag.go.id',
    snippet: 'Statistik perdagangan dalam negeri dan luar negeri, neraca perdagangan, dan harga komoditas.',
    trustBadge: 'Kementerian',
  },
  // Kementerian Kesehatan
  {
    keywords: ['kesehatan', 'stunting', 'gizi', 'puskesmas', 'rumah sakit', 'imunisasi', 'kematian bayi', 'harapan hidup', 'nakes'],
    title: 'Data Kesehatan — Kementerian Kesehatan',
    url: 'https://kemkes.go.id/id/profil-kesehatan',
    domain: 'kemkes.go.id',
    snippet: 'Profil kesehatan, data stunting, fasilitas kesehatan, dan indikator kesehatan masyarakat.',
    trustBadge: 'Kementerian',
  },
  // Kementerian Pendidikan
  {
    keywords: ['pendidikan', 'sekolah', 'guru', 'murid', 'siswa', 'mahasiswa', 'universitas', 'perguruan tinggi', 'apk', 'apm', 'melek huruf', 'buta huruf', 'putus sekolah'],
    title: 'Data Pendidikan — Kemendikbudristek',
    url: 'https://statistik.data.kemdikbud.go.id/',
    domain: 'statistik.data.kemdikbud.go.id',
    snippet: 'Statistik pendidikan: jumlah sekolah, siswa, guru, dan indikator pendidikan nasional.',
    trustBadge: 'Kementerian',
  },
  // Kementerian Ketenagakerjaan
  {
    keywords: ['tenaga kerja', 'ketenagakerjaan', 'upah', 'upah minimum', 'ump', 'umk', 'phk', 'pekerja', 'buruh', 'serikat pekerja', 'pengangguran', 'tpt', 'tpak', 'angkatan kerja', 'nganggur', 'lapangan kerja'],
    title: 'Data Ketenagakerjaan — Kemnaker',
    url: 'https://satudata.kemnaker.go.id/',
    domain: 'satudata.kemnaker.go.id',
    snippet: 'Data ketenagakerjaan: upah minimum, pengangguran, hubungan industrial, dan pelatihan kerja.',
    trustBadge: 'Kementerian',
  },
  // Kementerian PUPR
  {
    keywords: ['infrastruktur', 'jalan', 'jembatan', 'perumahan', 'air bersih', 'sanitasi', 'irigasi'],
    title: 'Data Infrastruktur — Kementerian PUPR',
    url: 'https://data.pu.go.id/',
    domain: 'data.pu.go.id',
    snippet: 'Data infrastruktur: jalan, jembatan, perumahan, air bersih, dan sanitasi.',
    trustBadge: 'Kementerian',
  },
  // Bappenas (pembangunan manusia, SDGs)
  {
    keywords: ['ipm', 'pembangunan manusia', 'sdgs', 'indeks pembangunan', 'rpjmn', 'pembangunan daerah'],
    title: 'Data Pembangunan — Bappenas',
    url: 'https://sdgs.bappenas.go.id/',
    domain: 'sdgs.bappenas.go.id',
    snippet: 'Data indikator pembangunan berkelanjutan (SDGs), IPM, dan target pembangunan nasional.',
    trustBadge: 'Lembaga',
  },
  // Kementerian Sosial
  {
    keywords: ['kemiskinan', 'miskin', 'bansos', 'bantuan sosial', 'dtks', 'pkh', 'bpnt', 'penyandang disabilitas', 'lansia', 'gini', 'ketimpangan'],
    title: 'Data Terpadu Kesejahteraan Sosial — Kemensos',
    url: 'https://dtks.kemensos.go.id/',
    domain: 'dtks.kemensos.go.id',
    snippet: 'Data Terpadu Kesejahteraan Sosial (DTKS): penerima bantuan sosial, kemiskinan, PKH, BPNT.',
    trustBadge: 'Kementerian',
  },
  // Bank Indonesia
  {
    keywords: ['inflasi', 'ihk', 'suku bunga', 'bi rate', 'nilai tukar', 'kurs', 'moneter', 'likuiditas', 'uang beredar'],
    title: 'Statistik Ekonomi dan Keuangan — Bank Indonesia',
    url: 'https://www.bi.go.id/id/statistik/informasi-kini/Default.aspx',
    domain: 'bi.go.id',
    snippet: 'Data moneter, inflasi, nilai tukar, dan statistik ekonomi keuangan dari Bank Indonesia.',
    trustBadge: 'Lembaga',
  },
  // DJPK Kemenkeu
  {
    keywords: ['apbd', 'anggaran', 'dana desa', 'dak', 'dau', 'pad', 'fiskal', 'pajak daerah', 'belanja', 'pendapatan daerah', 'transfer', 'pdrb', 'ekonomi', 'pertumbuhan ekonomi'],
    title: 'Data Keuangan Daerah — DJPK Kemenkeu',
    url: 'https://djpk.kemenkeu.go.id/',
    domain: 'djpk.kemenkeu.go.id',
    snippet: 'Data APBD, PDRB, transfer daerah, dan keuangan pemerintah daerah dari Dirjen Perimbangan Keuangan.',
    trustBadge: 'Kementerian',
  },
  // Kementerian ESDM
  {
    keywords: ['energi', 'listrik', 'tambang', 'pertambangan', 'nikel', 'batubara', 'minyak', 'gas', 'minerba'],
    title: 'Data Energi dan Sumber Daya Mineral — ESDM',
    url: 'https://www.esdm.go.id/id/publikasi/data-dan-statistik',
    domain: 'esdm.go.id',
    snippet: 'Statistik energi, pertambangan mineral dan batubara, ketenagalistrikan.',
    trustBadge: 'Kementerian',
  },
  // Kementerian Pariwisata
  {
    keywords: ['pariwisata', 'wisatawan', 'hotel', 'tph', 'akomodasi', 'tamu', 'penginapan', 'turis', 'wisata'],
    title: 'Data Pariwisata — Kemenparekraf',
    url: 'https://www.kemenparekraf.go.id/statistik-wisatawan',
    domain: 'kemenparekraf.go.id',
    snippet: 'Statistik kunjungan wisatawan, akomodasi, dan pariwisata Indonesia.',
    trustBadge: 'Kementerian',
  },
  // Kementerian Perhubungan
  {
    keywords: ['transportasi', 'perhubungan', 'pelabuhan', 'bandara', 'penumpang', 'kargo', 'angkutan', 'kapal', 'pesawat'],
    title: 'Data Perhubungan — Kemenhub',
    url: 'https://dephub.go.id/post/read/statistik',
    domain: 'dephub.go.id',
    snippet: 'Statistik transportasi: penumpang, kargo, pelabuhan, dan bandara.',
    trustBadge: 'Kementerian',
  },
  // Satu Data Indonesia
  {
    keywords: ['satu data', 'open data', 'data terbuka'],
    title: 'Satu Data Indonesia — Portal Data Nasional',
    url: 'https://data.go.id/',
    domain: 'data.go.id',
    snippet: 'Portal data terbuka Indonesia: berbagai dataset dari kementerian dan lembaga.',
    trustBadge: 'Lembaga',
  },
];

// Maluku Utara region names — derived from canonical shared/geo-regions.json
const { WEB_SEARCH_REGIONS: MALUT_REGIONS } = require('../../utils/geoAnalysis');

// ============================================================================
// SEARCH LOGIC
// ============================================================================

/**
 * Search external government indicators based on the user query.
 * Returns curated external links matching the query keywords.
 * 
 * @param {string} query - User query text
 * @param {string|null} region - Optional detected region (e.g., "Kota Ternate")
 * @returns {Promise<Array>} Array of external link objects
 */
async function searchExternalIndicators(query, region = null) {
  if (!query || typeof query !== 'string') return [];

  const normalizedQuery = query.toLowerCase().trim();
  const matches = [];

  for (const source of EXTERNAL_SOURCES) {
    // Check if any keyword matches
    const matchedKeyword = source.keywords.find(kw => normalizedQuery.includes(kw));
    if (!matchedKeyword) continue;

    // Detect geo match for Maluku Utara regions
    let matchedGeo = null;
    if (region) {
      matchedGeo = region;
    } else {
      for (const r of MALUT_REGIONS) {
        if (normalizedQuery.includes(r)) {
          matchedGeo = r.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
          break;
        }
      }
    }

    matches.push({
      title: source.title,
      url: source.url,
      domain: source.domain,
      snippet: source.snippet,
      trustBadge: source.trustBadge,
      matchedGeo: matchedGeo,
      matchedKeyword,
    });
  }

  if (matches.length > 0) {
    logger.debug({
      query: normalizedQuery.slice(0, 50),
      matchCount: matches.length,
      domains: matches.map(m => m.domain).join(', '),
    }, 'External indicators matched');
  }

  return matches.slice(0, 3);
}

/**
 * Check if the web search service is available (always true for curated links).
 * @returns {boolean}
 */
function isAvailable() {
  return true;
}

module.exports = {
  searchExternalIndicators,
  isAvailable,
};
