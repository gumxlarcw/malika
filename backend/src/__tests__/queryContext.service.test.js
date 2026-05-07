/**
 * Unit tests for queryContext.service.js
 * 
 * M13: Tests fragment detection, follow-up detection, query merging,
 * subject extraction, keyword detection, and procedural FAQ detection.
 */

'use strict';

const {
  isLikelyTimeOrPeriodFragment,
  isLikelyGeoOnlyFragment,
  filterQueryFillers,
  isComparisonFollowUp,
  isAlternativeSourceRequest,
  isShortFollowUp,
  mergeQuery,
  extractDataSubject,
  hasSubstantiveKeywords,
  isDifferentDataTypeRequest,
  isProceduralFaqQuery,
} = require('../services/chat/streaming/queryContext.service');

// ============================================================================
// isLikelyTimeOrPeriodFragment
// ============================================================================
describe('isLikelyTimeOrPeriodFragment', () => {
  it('returns true for year-only queries', () => {
    expect(isLikelyTimeOrPeriodFragment('2025')).toBe(true);
    expect(isLikelyTimeOrPeriodFragment('tahun 2024')).toBe(true);
  });

  it('returns true for relative period queries', () => {
    expect(isLikelyTimeOrPeriodFragment('2 tahun terakhir')).toBe(true);
    expect(isLikelyTimeOrPeriodFragment('bulan terakhir')).toBe(true);
  });

  it('returns true for month fragments', () => {
    expect(isLikelyTimeOrPeriodFragment('januari 2025')).toBe(true);
    // "desember" alone lacks a signal token (month name is allowed, but needs a year/keyword)
    expect(isLikelyTimeOrPeriodFragment('bulan desember')).toBe(true);
  });

  it('returns true for geo-only within allowed tokens', () => {
    expect(isLikelyTimeOrPeriodFragment('kabupaten morotai')).toBe(true);
    expect(isLikelyTimeOrPeriodFragment('ternate')).toBe(true);
  });

  it('returns false for substantive queries', () => {
    expect(isLikelyTimeOrPeriodFragment('data kemiskinan maluku utara')).toBe(false);
    expect(isLikelyTimeOrPeriodFragment('berapa jumlah penduduk di ternate')).toBe(false);
  });

  it('returns false for empty/null input', () => {
    expect(isLikelyTimeOrPeriodFragment('')).toBe(false);
    expect(isLikelyTimeOrPeriodFragment(null)).toBe(false);
    expect(isLikelyTimeOrPeriodFragment(undefined)).toBe(false);
  });

  it('returns false for long queries (>10 tokens)', () => {
    expect(isLikelyTimeOrPeriodFragment('satu dua tiga empat lima enam tujuh delapan sembilan sepuluh sebelas')).toBe(false);
  });
});

// ============================================================================
// isLikelyGeoOnlyFragment
// ============================================================================
describe('isLikelyGeoOnlyFragment', () => {
  it('returns true for known geo names', () => {
    expect(isLikelyGeoOnlyFragment('ternate')).toBe(true);
    expect(isLikelyGeoOnlyFragment('halmahera selatan')).toBe(true);
    expect(isLikelyGeoOnlyFragment('morotai')).toBe(true);
  });

  it('returns true for "kabupaten X" patterns', () => {
    expect(isLikelyGeoOnlyFragment('kabupaten kepulauan sula')).toBe(true);
    expect(isLikelyGeoOnlyFragment('kota tidore kepulauan')).toBe(true);
  });

  it('returns true with filler words stripped', () => {
    expect(isLikelyGeoOnlyFragment('di ternate')).toBe(true);
    expect(isLikelyGeoOnlyFragment('untuk morotai ada?')).toBe(true);
  });

  it('returns false for non-geo queries', () => {
    expect(isLikelyGeoOnlyFragment('kemiskinan')).toBe(false);
    expect(isLikelyGeoOnlyFragment('data penduduk')).toBe(false);
  });

  it('returns false for empty/short input', () => {
    expect(isLikelyGeoOnlyFragment('')).toBe(false);
    expect(isLikelyGeoOnlyFragment('ab')).toBe(false);
    expect(isLikelyGeoOnlyFragment(null)).toBe(false);
  });
});

// ============================================================================
// filterQueryFillers
// ============================================================================
describe('filterQueryFillers', () => {
  it('removes common filler words', () => {
    const result = filterQueryFillers('tolong tampilkan data kemiskinan');
    // "data" is not a filler word — it's substantive
    expect(result).toBe('data kemiskinan');
  });

  it('removes multi-word filler patterns', () => {
    const result = filterQueryFillers('apakah ada data inflasi');
    expect(result).toContain('inflasi');
    expect(result).not.toContain('apakah ada');
  });

  it('preserves substantive words', () => {
    const result = filterQueryFillers('pengangguran ternate 2025');
    expect(result).toContain('pengangguran');
    expect(result).toContain('ternate');
    expect(result).toContain('2025');
  });

  it('returns original query if all words are fillers', () => {
    const result = filterQueryFillers('apa saja?');
    // Should fallback to original (minus ? punctuation)
    expect(result.length).toBeGreaterThan(0);
  });

  it('handles empty input', () => {
    expect(filterQueryFillers('')).toBe('');
    expect(filterQueryFillers(null)).toBe('');
  });
});

// ============================================================================
// isComparisonFollowUp
// ============================================================================
describe('isComparisonFollowUp', () => {
  it('detects comparison requests', () => {
    expect(isComparisonFollowUp('bandingkan dengan kabupaten lainnya')).toBe(true);
    expect(isComparisonFollowUp('bagaimana di kota ternate')).toBe(true);
    expect(isComparisonFollowUp('tampilkan per kabupaten')).toBe(true);
  });

  it('does not match non-comparison queries', () => {
    expect(isComparisonFollowUp('data kemiskinan 2025')).toBe(false);
    expect(isComparisonFollowUp('berapa inflasi')).toBe(false);
  });
});

// ============================================================================
// isAlternativeSourceRequest
// ============================================================================
describe('isAlternativeSourceRequest', () => {
  it('detects requests for alternative sources', () => {
    expect(isAlternativeSourceRequest('ya dari survei lain')).toBe(true);
    expect(isAlternativeSourceRequest('coba dari sumber lainnya')).toBe(true);
    expect(isAlternativeSourceRequest('data lain')).toBe(true);
  });

  it('does not match normal queries', () => {
    expect(isAlternativeSourceRequest('data kemiskinan')).toBe(false);
    expect(isAlternativeSourceRequest('tahun 2025')).toBe(false);
  });
});

// ============================================================================
// isShortFollowUp
// ============================================================================
describe('isShortFollowUp', () => {
  it('detects year-only follow-ups', () => {
    expect(isShortFollowUp('2024')).toBe(true);
    expect(isShortFollowUp('2025 ada?')).toBe(true);
  });

  it('detects "data tersedia" type follow-ups', () => {
    expect(isShortFollowUp('ada data tahun berapa saja')).toBe(true);
    expect(isShortFollowUp('tahun berapa saja yang tersedia')).toBe(true);
  });

  it('detects comparison follow-ups', () => {
    expect(isShortFollowUp('bandingkan dengan kabupaten lainnya')).toBe(true);
  });

  it('rejects long queries', () => {
    expect(isShortFollowUp('berapa jumlah penduduk di kota ternate pada tahun 2025 menurut data sensus terbaru')).toBe(false);
  });

  it('rejects empty', () => {
    expect(isShortFollowUp('')).toBe(false);
    expect(isShortFollowUp(null)).toBe(false);
  });
});

// ============================================================================
// mergeQuery
// ============================================================================
describe('mergeQuery', () => {
  it('merges base with year fragment', () => {
    const result = mergeQuery('data kemiskinan', '2025');
    expect(result).toContain('kemiskinan');
    expect(result).toContain('2025');
  });

  it('replaces year in base when fragment has different year', () => {
    const result = mergeQuery('data kemiskinan 2024', 'tahun 2025');
    expect(result).toContain('2025');
    expect(result).not.toContain('2024');
  });

  it('merges base with geo fragment', () => {
    const result = mergeQuery('data kemiskinan', 'kabupaten morotai');
    const lower = result.toLowerCase();
    expect(lower).toContain('kemiskinan');
    expect(lower).toContain('morotai');
  });

  it('replaces geo in base when fragment has different geo', () => {
    const result = mergeQuery('data kemiskinan ternate', 'morotai');
    const lower = result.toLowerCase();
    expect(lower).toContain('kemiskinan');
    expect(lower).toContain('morotai');
  });

  it('handles empty base', () => {
    expect(mergeQuery('', 'tahun 2025')).toContain('2025');
  });

  it('handles empty fragment', () => {
    expect(mergeQuery('data kemiskinan', '')).toBe('data kemiskinan');
  });

  it('does not duplicate when fragment already in base', () => {
    const result = mergeQuery('data kemiskinan 2025', '2025');
    const matches = result.match(/2025/g);
    expect(matches?.length).toBe(1);
  });
});

// ============================================================================
// extractDataSubject
// ============================================================================
describe('extractDataSubject', () => {
  it('extracts known statistical subjects', () => {
    expect(extractDataSubject('data kemiskinan di ternate')).toBe('kemiskinan');
    expect(extractDataSubject('berapa tingkat pengangguran')).toBe('pengangguran');
    expect(extractDataSubject('inflasi bulan desember')).toBe('inflasi');
    expect(extractDataSubject('jumlah penduduk maluku utara')).toBe('jumlah penduduk');
    expect(extractDataSubject('pdrb per kapita')).toBe('pdrb');
  });

  it('extracts commodity subjects', () => {
    expect(extractDataSubject('produksi durian tahun 2025')).toBe('durian');
    expect(extractDataSubject('luas panen kelapa sawit')).toMatch(/kelapa|sawit|luas panen/);
  });

  it('returns null for unrecognized subjects', () => {
    expect(extractDataSubject('halo apa kabar')).toBeNull();
    expect(extractDataSubject('')).toBeNull();
    expect(extractDataSubject(null)).toBeNull();
  });
});

// ============================================================================
// hasSubstantiveKeywords
// ============================================================================
describe('hasSubstantiveKeywords', () => {
  it('returns true for data-related queries', () => {
    expect(hasSubstantiveKeywords('data tentang pertanian')).toBe(true);
    expect(hasSubstantiveKeywords('produksi durian')).toBe(true);
    expect(hasSubstantiveKeywords('statistik penduduk')).toBe(true);
  });

  it('returns false for comparison follow-ups (excluded)', () => {
    expect(hasSubstantiveKeywords('bandingkan dengan kabupaten lainnya')).toBe(false);
  });

  it('returns false for simple queries', () => {
    expect(hasSubstantiveKeywords('halo')).toBe(false);
    expect(hasSubstantiveKeywords('terima kasih')).toBe(false);
  });
});

// ============================================================================
// isDifferentDataTypeRequest
// ============================================================================
describe('isDifferentDataTypeRequest', () => {
  it('detects kab/kota vs province mismatch', () => {
    expect(isDifferentDataTypeRequest('data per kabupaten', 'Kemiskinan Provinsi')).toBe(true);
    expect(isDifferentDataTypeRequest('di provinsi maluku utara', 'Kemiskinan Menurut Kab/Kota')).toBe(true);
  });

  it('detects data type keyword mismatch', () => {
    expect(isDifferentDataTypeRequest('laju pertumbuhan', 'Jumlah Penduduk')).toBe(true);
    expect(isDifferentDataTypeRequest('proyeksi penduduk', 'Realisasi Penduduk')).toBe(true);
  });

  it('returns false when type matches', () => {
    expect(isDifferentDataTypeRequest('data kemiskinan', 'Kemiskinan Penduduk')).toBe(false);
  });
});

// ============================================================================
// isProceduralFaqQuery
// ============================================================================
describe('isProceduralFaqQuery', () => {
  it('detects FAQ/procedural questions', () => {
    expect(isProceduralFaqQuery('siapa kepala BPS Maluku Utara')).toBe(true);
    expect(isProceduralFaqQuery('apa itu PDRB')).toBe(true);
    expect(isProceduralFaqQuery('cara mengunduh data')).toBe(true);
    expect(isProceduralFaqQuery('dimana kantor BPS')).toBe(true);
    expect(isProceduralFaqQuery('jam buka pelayanan')).toBe(true);
  });

  it('returns false for data queries', () => {
    expect(isProceduralFaqQuery('data kemiskinan 2025')).toBe(false);
    expect(isProceduralFaqQuery('berapa inflasi desember')).toBe(false);
  });
});
