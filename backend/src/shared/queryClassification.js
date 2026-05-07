/**
 * Query Classification — shared canonical patterns
 *
 * Single source of truth for all cross-cutting query classification patterns.
 * Import from HERE — do NOT redefine these in streaming.service.js, supervisor,
 * queryAnalysis.js, knowledgePatterns, etc.
 *
 * Categories:
 *   GREETING          — chitchat, greetings, thanks, confirmations
 *   DATA_SIGNALS      — statistical/data queries (table + chart)
 *   KNOWLEDGE_SIGNALS — FAQ/procedural/PPID/service queries
 *   OUT_OF_SCOPE      — politics, religion, personal opinion, harmful
 *   INDIVIDUAL_DATA   — Pasal 21 confidential data requests
 *   STATISTICAL_INDICATORS — known statistical term mentions
 *   BPS_INSTITUTIONAL — organizational/PPID questions
 *   EXIM_TRIGGER      — export/import queries
 *
 * @module shared/queryClassification
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// 1. GREETING PATTERNS
// ═══════════════════════════════════════════════════════════════════════════

const GREETING_PATTERNS = [
  /^(hai|halo|hallo|hello|hi|hey|hei|hy)$/i,
  /^(selamat\s+(pagi|siang|sore|malam|datang))$/i,
  /^(assalamualaikum|assalamu.?alaikum)(\s+w\.?r\.?w\.?b\.?)?$/i,
  /^(salam|salamat|permisi)$/i,
  /^(good\s+(morning|afternoon|evening|night))$/i,
  /^(apa\s+kabar|gimana\s+kabar)(\??)?$/i,
  // Note: thanks/farewell moved to CHITCHAT_PATTERNS for separate handling
];

/**
 * Known greeting words for fuzzy matching.
 * When a single-word input is within edit distance 1 of any of these,
 * it's treated as a greeting (handles typos like "hali", "hlao", "halp").
 */
const GREETING_WORDS = [
  'hai', 'halo', 'hallo', 'hello', 'hi', 'hey', 'hei', 'hy',
  'salam', 'salamat', 'permisi',
];

/**
 * Levenshtein edit distance (compact implementation for short strings).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function _levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Check if a single word is a fuzzy match for a known greeting.
 * Only allows edit distance 1 for words ≥3 chars, exact for shorter.
 * @param {string} word - lowercase single word
 * @returns {boolean}
 */
function _isFuzzyGreeting(word) {
  if (word.length < 2 || word.length > 15) return false;
  const maxDist = word.length >= 3 ? 1 : 0;
  return GREETING_WORDS.some(g => _levenshtein(word, g) <= maxDist);
}

/** Patterns for confirmations / closings (suppressed in supervisor) */
const CONFIRMATION_PATTERNS = [
  /^(ya|iya|y|ok|oke|sip|lanjut|gas|boleh)$/i,
  /^ya\s*,?\s*(tampilkan|lanjut|tolong|coba|boleh)$/i,
  /^(ya\s+)?boleh$/i,
  /\b(tampilkan\s+datanya|tampilkan\s+preview|tampilkan\s+data)\b/i,
];

/** Non-statistical meta/chitchat queries (from supervisor) */
const NON_STATISTICAL_QUERY_PATTERNS = [
  // Greetings
  /^(?:halo|hai|hi|hey|hei|yo)\s*[!?.]*$/i,
  /^selamat\s+(?:pagi|siang|sore|malam)\s*[!?.]*$/i,
  // Thanks
  /^(?:terima\s*kasih|makasih|thanks?|thank\s*you|tengkyu)\s*[!?.]*$/i,
  // Meta questions about MALIKA
  /^(?:siapa|apa)\s+(?:kamu|anda|nama\s*mu|malika)\s*[?!.]*$/i,
  /(?:apa\s+(?:itu|yang\s+bisa\s+kamu)\s+(?:malika|lakukan|bantu))/i,
  /(?:kamu\s+(?:bisa|buat)\s+apa)\s*[?]*$/i,
  /\bfitur\s+(?:yang\s+)?(?:bisa|kamu|anda|malika|tersedia)/i,
  /\bapa\s+saja\s+(?:fitur|kemampuan|fungsi|layanan)\b/i,
  /\b(?:kemampuan|keahlian|fungsi)\s+(?:kamu|anda|malika)\b/i,
  /\bjelaskan\s+(?:tentang\s+)?(?:dirimu|kamu|malika)\b/i,
  /\bkamu\s+(?:siapa|apa)\b/i,
  // General wellbeing
  /^(?:apa|gimana)\s+kabar/i,
  /^(?:bagaimana|gmn)\s+kabar/i,
  // Closings
  /^(?:ok|oke|baik|sip|mantap|bagus|nice|great)\s*[!?.]*$/i,
  /^(?:sampai\s+jumpa|bye|dadah|selamat\s+tinggal)\s*[!?.]*$/i,
  // Opinion/advice
  /^(?:menurut\s+kamu|pendapat\s*mu|saran\s*mu)\b/i,
];

// ═══════════════════════════════════════════════════════════════════════════
// 2. DATA SIGNAL PATTERNS (statistical queries)
// ═══════════════════════════════════════════════════════════════════════════

const DATA_SIGNALS = [
  // Explicit data keywords
  /\b(data\s+(penduduk|kemiskinan|inflasi|pengangguran|ekspor|impor|pdrb|ipm|tpt))\b/i,
  /\b(angka|banyaknya|persentase|persen|%)\b/i,
  /\b(tabel|grafik|chart|diagram)\b/i,
  // Time periods for data (years, quarters, months)
  /\b(tahun\s+\d{4}|\b20\d{2}\b)\b/i,
  /\b(triwulan|semester|kuartal|q[1-4])\b/i,
  // Geographic data queries with comparison intent
  /\b(kabupaten|kota|kecamatan|desa|kelurahan|provinsi|wilayah)\s+(mana|apa|tertinggi|terendah)/i,
  // Comparative/ranking queries (data-focused)
  /\b(tertinggi|terendah|terbesar|terkecil|naik|turun|pertumbuhan|growth)\b/i,
  /\b(bandingkan|perbandingan|dibanding|versus|vs)\b/i,
  /\b(berapa|how\s+much|how\s+many)\s+(jumlah|angka|nilai|total)/i,
  // Common statistical indicators (with following geo/year context)
  /\b(inflasi|kemiskinan|pengangguran|tpt|ipm|pdrb|ekspor|impor|penduduk)\s+(maluku|2\d{3}|kabupaten|kota)/i,
  // Standalone statistical indicator acronyms — always data queries
  /\b(pdrb|ipm|tpt|tpak|ihk|gini|apbd|ekspor|impor)\b/i,
  // Statistical indicators followed by specific region names
  /\b(inflasi|kemiskinan|pengangguran|penduduk|pdrb|ipm)\s+(halmahera|ternate|tidore|morotai|taliabu|sula)\b/i,
];

// ═══════════════════════════════════════════════════════════════════════════
// 3. KNOWLEDGE / SERVICE / FAQ SIGNAL PATTERNS
// ═══════════════════════════════════════════════════════════════════════════

const KNOWLEDGE_SIGNALS = [
  /\b(siapa|who)\b/i,
  /\b(apa\s+itu|apakah|pengertian|definisi)\b/i,
  /\b(bagaimana|how\s+to|cara)\b/i,
  /\b(layanan|pelayanan)\b/i,
  /\b(prosedur|tata\s*cara|tahap|tahapan|langkah)\b/i,
  /\b(nol\s*rupiah|rekomendasi\s+statistik)\b/i,
  /\b(sensus|survei|sakernas|susenas|supas)\b/i,
  /\b(jam\s+(buka|kerja|operasional)|alamat|kontak)\b/i,
];

/** Detailed service/layanan patterns — strong positive for knowledge mode */
const SERVICE_PATTERNS = [
  /\b(layanan|pelayanan)\s+(nol\s*rupiah|pst|rekomendasi|konsultasi)/i,
  /\b(prosedur|tata\s*cara|tahap|tahapan|langkah)\s+.*(layanan|nol\s*rupiah|rekomendasi)/i,
  /\b(cara\s+(mendapat|mengajukan|memperoleh|daftar|registrasi|akses))\b/i,
  /\b(nol\s*rupiah)\b/i,
  /\b(rekomendasi\s+statistik)\b/i,
  /\b(pusdatin|pst|perpustakaan|konsultasi)\b/i,
  /\b(jam\s+(buka|kerja|operasional)|alamat|kontak|nomor\s+(hp|wa|whatsapp|telepon))\b/i,
  /\b(persyaratan|syarat)\s+(layanan|nol\s*rupiah|rekomendasi)/i,
  // Sensus, survei, dan kegiatan BPS (knowledge, bukan data)
  /\b(informasi|info)\s+(terkait|tentang|mengenai)\s+(sensus|survei|survai|kegiatan)/i,
  /\b(apa\s+itu|apakah|pengertian)\s+(sensus|survei|survai)/i,
  /\b(sensus)\s+(ekonomi|penduduk|pertanian)\b/i,
  /\b(survei|survai)\s+(sosial|ekonomi|pertanian|industri|tenaga\s*kerja)\b/i,
  /\b(sakernas|susenas|supas|se\d{4}|sp\d{4}|st\d{4})/i,
];

// ═══════════════════════════════════════════════════════════════════════════
// 3b. CREATIVE WRITING PATTERNS (must decline even with statistical keywords)
// ═══════════════════════════════════════════════════════════════════════════

const CREATIVE_WRITING_PATTERNS = [
  /\b(?:buatkan|buat|tulis(?:kan)?|ciptakan|karang(?:kan)?|rangkai(?:kan)?)\s+(?:pantun|puisi|syair|sajak|cerpen|cerita|narasi|essay?|esai|lirik|lagu|joke|lelucon|humor|komedi|naskah|skrip)/i,
  /\b(?:pantun|puisi|syair|sajak|cerpen|cerita\s+pendek|lirik\s+lagu)\s+(?:tentang|mengenai|soal|bertema)/i,
  /\b(?:ceritakan|dongeng(?:kan)?|karang)\s+(?:\w+\s+)*(?:tentang|mengenai|soal)/i,
  /\b(?:bikin|buat|ceritakan)\s+(?:cerita|dongeng|joke|lelucon|humor|komedi|pantun|puisi)/i,
];

// ═══════════════════════════════════════════════════════════════════════════
// 3c. PROMPT INJECTION / JAILBREAK PATTERNS
// ═══════════════════════════════════════════════════════════════════════════

const PROMPT_INJECTION_PATTERNS = [
  // English jailbreak phrases
  /\bignore\s+(?:(?:all|every)\s+)?(?:(?:previous|above|prior|your)\s+)?(?:instructions?|rules?|prompts?)/i,
  /\b(?:show|display|reveal|print|output|translate|repeat)\s+(?:\w+\s+)*(?:system\s+prompt|instructions?|rules?|prompt)/i,
  /\byou\s+are\s+now\s+(?:DAN|jailbroken|dev(?:eloper)?\s+mode|unrestricted)/i,
  /\b(?:enable|activate|enter|switch\s+to)\s+(?:dev(?:eloper)?\s+mode|DAN\s+mode|jailbreak|sudo\s+mode|god\s+mode)/i,
  /\bdo\s+anything\s+now\b/i,
  /\b(?:forget|disregard|override)\s+(?:your|all|the)?\s*(?:rules?|instructions?|guidelines?|restrictions?)/i,
  /\bact\s+as\s+(?:if\s+you\s+(?:have|had)\s+no\s+(?:rules|restrictions)|a\s+different\s+(?:AI|assistant|bot))/i,
  // Indonesian jailbreak phrases
  /\b(?:abaikan|lupakan|hapus)\s+(?:semua\s+)?(?:instruksi|aturan|perintah|pembatasan)(?:\s+(?:sebelumnya|yang\s+ada))?/i,
  /\bberpura[- ]?pura(?:lah)?\s+(?:kamu|anda|jadi|menjadi)/i,
  /\b(?:tampilkan|tunjukkan|perlihatkan)\s+(?:system\s+)?\s*prompt/i,
  // Token/API key probing
  /\b(?:apa|tampilkan|berikan)\s+(?:api\s*key|token|secret|password|credential)/i,
  // Decode tricks
  /\bdecode\s+(?:this|the)?\s*(?:base64|encoded|string|text)/i,
];

// ═══════════════════════════════════════════════════════════════════════════
// 4. OUT-OF-SCOPE PATTERNS
// ═══════════════════════════════════════════════════════════════════════════

const OUT_OF_SCOPE_PATTERNS = [
  // Politics
  /\b(politik|partai|pemilu|pilkada|caleg|capres|cawapres|pilpres)\b/i,
  /\bsiapa\s+(?:presiden|menteri|gubernur|bupati|walikota|wakil\s+presiden|wapres)\b/i,
  /\b(?:presiden|menteri)\s+(?:terpilih|baru|lama|sekarang|saat\s+ini)\b/i,
  // Religion (sensitive)
  /\b(agama|syariah|haram|halal|kafir|murtad)\b/i,
  // SARA
  /\b(sara|rasis|rasisme|suku|etnis)\b/i,
  // Violence / harm
  /\b(bunuh|membunuh|bom|terorisme|senjata|narkoba)\b/i,
  // Personal advice / opinion
  /\b(ramalan|zodiak|horoskop|jodoh|cinta|asmara|pacar)\b/i,
  // Programming / unrelated (explicit non-BPS)
  /\b(coding|programming|javascript|python|react|html|css)\b/i,
];

// ═══════════════════════════════════════════════════════════════════════════
// 5. BPS COMPLIANCE — Individual Data Patterns (Pasal 21)
// ═══════════════════════════════════════════════════════════════════════════

const INDIVIDUAL_DATA_REQUEST_PATTERNS = [
  /\b(?:data|informasi)\s+(?:individu|perorangan|pribadi|personal)\b/i,
  /\bdata\s+mikro\b/i,
  /\b(?:identitas|nama|alamat)\s+(?:responden|sensus|survei)\b/i,
  /\bdata\s+responden\b/i,
  /\b(?:data|info)\s+(?:rumah\s+tangga|perusahaan|usaha)\s+(?:tertentu|spesifik|khusus)\b/i,
  /\b(?:siapa|nama)\s+(?:yang\s+)?(?:miskin|kaya|menganggur)\b/i,
  /\bdata\s+(?:per\s+)?(?:orang|nama|ktp|nik)\b/i,
  /\b(?:daftar|list)\s+(?:nama|penduduk|warga)(?:\s+\w+){0,3}\s+(?:yang\s+)?(?:miskin|kaya|menganggur)\b/i,
  /\b(?:daftar|list)\s+nama\s+(?:orang|individu|warga|penduduk)\b/i,
  /\bunit\s+(?:data|record|rekaman)\b/i,
  /\b(?:raw|mentah)\s+data\s+(?:sensus|survei|survay)\b/i,
  /\bnama.{0,20}(?:penduduk|warga|orang).{0,20}(?:miskin|kaya|nganggur)\b/i,
];

const RESPONSE_DISCLOSURE_PATTERNS = [
  /\bnama\s+responden\s*:/i,
  /\bberikut\s+(?:daftar|nama)\s+(?:individu|orang|responden)/i,
  /\bdata\s+(?:per\s+)?individu\s*:/i,
  /\bidentitas\s+(?:responden|penduduk)\s*:/i,
];

const RESPONSE_REFUSAL_PATTERNS = [
  // Original 6 patterns (compliance + general refusal)
  /mohon\s+maaf.{0,80}(?:tidak\s+(?:dapat|bisa|mungkin|tersedia)|di\s+luar|bukan\s+(?:wewenang|kewenangan))/is,
  /(?:tidak\s+(?:dapat|bisa|mungkin)\s+(?:memberikan|menyediakan|menyajikan|menampilkan)).{0,60}(?:data|informasi)\s+(?:individu|perorangan|pribadi|personal|tersebut)/is,
  /data\s+(?:individu|perorangan|pribadi)\s+(?:bersifat\s+)?rahasia/i,
  /(?:tidak\s+(?:ditemukan|menemukan|tersedia))\s+(?:data|informasi)\s+(?:tentang|mengenai|terkait|untuk)\b/i,
  /\bbukan\s+(?:data|informasi)\s+(?:statistik|yang\s+dikelola)/i,
  /\btidak\s+mengelola\s+data\s+(?:individu|perorangan|pribadi|personal)\b/i,
  // Synced from Layer 1 post-response validator (9 additional patterns)
  /data\s+(belum|tidak)\s+(tersedia|ada|ditemukan|dapat)/i,
  /belum\s+dapat\s+(ditampilkan|dikonfirmasi|disajikan)/i,
  /tidak\s+memiliki\s+data/i,
  /belum\s+dapat\s+dikonfirmasi\s+dari\s+sumber/i,
  /tidak\s+dapat\s+dikonfirmasi/i,
  /tidak\s+dapat\s+disajikan/i,
  /(?:belum|tidak)\s+(?:dapat|bisa)\s+(?:di)?konfirmasi/i,
  /data\s+.*masih\s+(?:perlu|harus)\s+dikonfirmasi/i,
  /tidak\s+(?:bisa|dapat)\s+memastikan/i,
];

const RESPONSE_HAS_REAL_DATA_PATTERNS = [
  /\b\d{1,3}(?:[.,]\d{1,3})*(?:[.,]\d{1,2})?\s*(?:%|persen|ribu|juta|miliar|triliun)\b/i,
  /(?:pada\s+(?:tahun|bulan|periode)\s+\d{4})/i,
  /(?:sebesar|mencapai|sejumlah)\s+\d/i,
];

// ═══════════════════════════════════════════════════════════════════════════
// 6. STATISTICAL CONTEXT INDICATORS
// ═══════════════════════════════════════════════════════════════════════════

const STATISTICAL_CONTEXT_INDICATORS = [
  /(?:data|statistik|angka|indikator|tabel)\s+/i,
  /(?:berapa|jumlah|persentase|persen|rata-rata|total)\b/i,
  /\b(?:kemiskinan|miskin|pengangguran|inflasi|ihk|pdrb|ipm|gini)\b/i,
  /\b(?:ekspor|impor|perdagangan|neraca)\b/i,
  /\b(?:penduduk|populasi|demografi|sensus|pertumbuhan|komposisi|distribusi|menurut|berdasarkan)\b/i,
  /\b(?:upah|gaji|tenaga\s+kerja|tpak|tpt)\b/i,
  /\b(?:produksi|produktivitas|industri|pertanian)\b/i,
  /\b(?:brs|publikasi|berita\s+resmi)\b/i,
  /\b(?:tahun|periode|bulan|triwulan|semester)\s+\d{4}/i,
  /\b(?:kab(?:upaten)?|kota)\s+/i,
  /\b(?:provinsi|maluku\s+utara)\b/i,
];

// ═══════════════════════════════════════════════════════════════════════════
// 7. BPS INSTITUTIONAL / PPID PATTERNS
// ═══════════════════════════════════════════════════════════════════════════

const BPS_INSTITUTIONAL_INDICATORS = [
  /\b(?:visi|misi)\s+(?:bps|badan\s+pusat)/i,
  /\b(?:sejarah|profil|logo|lambang)\s+(?:bps|badan\s+pusat)/i,
  /\b(?:tugas|fungsi|kewenangan|struktur)\s+(?:bps|badan\s+pusat)/i,
  /\b(?:kepala|pejabat|pimpinan)\s+(?:bps|badan\s+pusat)/i,
  /\b(?:layanan|pelayanan)\s+(?:bps|statistik|terpadu)/i,
  /\b(?:kontak|alamat|telepon|telp|whatsapp)\s+(?:bps|badan\s+pusat)/i,
  /\b(?:pengaduan|aduan|keluhan)\s+(?:bps|badan\s+pusat)/i,
  /\b(?:sensus|survei|survay|sakernas|susenas|supas)\b/i,
  /\b(?:allstats|transdata|ppid)\b/i,
  /\b(?:cara|panduan|tutorial)\s+(?:unduh|download|akses|mengunduh)/i,
  /\b(?:rekomendasi\s+kegiatan\s+statistik)\b/i,
  /\b(?:sistem\s+statistik\s+nasional|ssn)\b/i,
  /\b(?:tarif|biaya)\s+(?:layanan|pelayanan)/i,
  /\bbps\b.*\b(?:apa|bagaimana|gimana|dimana|kapan|siapa)\b/i,
  /\b(?:apa|bagaimana|gimana|dimana|kapan|siapa)\b.*\bbps\b/i,
];

const PPID_CATEGORIES = new Set(['PPID', 'FAQ', 'Guide', 'Custom']);

// ═══════════════════════════════════════════════════════════════════════════
// 8. EXIM (Export/Import) TRIGGER PATTERNS
// ═══════════════════════════════════════════════════════════════════════════

const EXIM_TRIGGER_PATTERNS = [
  /\b(ekspor|impor|eksport|import|export|perdagangan\s+luar\s+negeri)\b/i,
  /\b(neraca\s+perdagangan)\b/i,
  /\b(komoditas\s+unggulan)\s+(ekspor|impor)/i,
];

// ═══════════════════════════════════════════════════════════════════════════
// 9. HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize raw text for pattern matching.
 * Strips punctuation to Unicode-safe letters/digits/spaces, collapses whitespace.
 */
function normalizeForMatching(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Test if query matches a greeting pattern.
 * @param {string} raw - Raw user message
 * @returns {boolean}
 */
function isGreeting(raw) {
  const t = normalizeForMatching(raw);
  if (!t) return false;
  // Exact pattern match first (fast path)
  if (GREETING_PATTERNS.some(p => p.test(t))) return true;
  // Fuzzy match for single-word typos (e.g. "hali", "hlao", "helo")
  if (!t.includes(' ') && _isFuzzyGreeting(t)) return true;
  return false;
}

/**
 * Test if query matches a confirmation pattern.
 * @param {string} raw
 * @returns {boolean}
 */
function isConfirmation(raw) {
  const t = String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return CONFIRMATION_PATTERNS.some(p => p.test(t));
}

/**
 * Test if query is out of scope for BPS assistant.
 * @param {string} raw
 * @returns {boolean}
 */
function isOutOfScope(raw) {
  const q = String(raw || '').toLowerCase().trim();
  if (!q) return false;

  // Exclude if it also has statistical context
  if (STATISTICAL_CONTEXT_INDICATORS.some(p => p.test(q))) return false;

  return OUT_OF_SCOPE_PATTERNS.some(p => p.test(q));
}

/**
 * Test if query is a creative writing request (pantun, puisi, cerita, etc.).
 * These should be declined even if they contain statistical keywords.
 * @param {string} raw
 * @returns {boolean}
 */
function isCreativeWriting(raw) {
  const q = String(raw || '').toLowerCase().trim();
  return CREATIVE_WRITING_PATTERNS.some(p => p.test(q));
}

/**
 * Test if query looks like a prompt injection or jailbreak attempt.
 * @param {string} raw
 * @returns {boolean}
 */
function isPromptInjection(raw) {
  const q = String(raw || '').trim(); // keep original case for English patterns
  return PROMPT_INJECTION_PATTERNS.some(p => p.test(q));
}

/**
 * Test if query is requesting confidential individual data (Pasal 21).
 * @param {string} raw
 * @returns {boolean}
 */
function isIndividualDataRequest(raw) {
  const q = String(raw || '').toLowerCase().trim();
  return INDIVIDUAL_DATA_REQUEST_PATTERNS.some(p => p.test(q));
}

/**
 * Test if query has data/statistical signal patterns.
 * @param {string} query
 * @returns {boolean}
 */
function hasDataSignal(query) {
  const q = String(query || '').toLowerCase().trim();
  return DATA_SIGNALS.some(p => p.test(q));
}

/**
 * Test if query has knowledge/service signal patterns.
 * @param {string} query
 * @returns {boolean}
 */
function hasKnowledgeSignal(query) {
  const q = String(query || '').toLowerCase().trim();
  return KNOWLEDGE_SIGNALS.some(p => p.test(q));
}

/**
 * Test if query matches strong service/layanan patterns.
 * @param {string} query
 * @returns {boolean}
 */
function isServiceQuery(query) {
  const q = String(query || '').toLowerCase().trim();
  return SERVICE_PATTERNS.some(p => p.test(q));
}

/**
 * Test if query matches BPS institutional patterns.
 * @param {string} query
 * @returns {boolean}
 */
function isBPSInstitutional(query) {
  const q = String(query || '').toLowerCase().trim();
  return BPS_INSTITUTIONAL_INDICATORS.some(p => p.test(q));
}

/**
 * Test if query matches EXIM trigger patterns.
 * @param {string} query
 * @returns {boolean}
 */
function isEximTrigger(query) {
  const q = String(query || '').toLowerCase().trim();
  return EXIM_TRIGGER_PATTERNS.some(p => p.test(q));
}

/**
 * Test if query is non-statistical (supervisory check).
 * @param {string} query
 * @returns {boolean}
 */
function isNonStatistical(query) {
  const q = String(query || '').trim();
  return NON_STATISTICAL_QUERY_PATTERNS.some(p => p.test(q));
}

// ── Chitchat patterns (simple queries that need no pipeline) ───────────
const CHITCHAT_PATTERNS = [
  // Thanks
  /^(?:terima\s*kasih|makasih|thanks?|thank\s*you|tengkyu|thx|tq)\s*[!?.🙏😊]*$/i,
  /^(?:terima\s*kasih|makasih)\s+(?:ya|banyak|kak|malika)\s*[!?.🙏😊]*$/i,
  // Farewell
  /^(?:sampai\s+jumpa|bye|dadah|selamat\s+tinggal|dah|daah)\s*[!?.👋]*$/i,
  // Acknowledgment (short standalone)
  /^(?:ok|oke|okey|baik|sip|mantap|bagus|nice|great|siap|noted)\s*[!?.👍]*$/i,
  /^(?:iya|ya)\s*[,.]?\s*(?:makasih|terima\s*kasih|thanks?|ok|sip)?\s*[!?.]*$/i,
];

/**
 * Test if query is simple chitchat (thanks, farewell, acknowledgment)
 * that should be handled instantly without running the pipeline.
 * @param {string} raw
 * @returns {boolean}
 */
function isChitchat(raw) {
  const t = String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return CHITCHAT_PATTERNS.some(p => p.test(t));
}

// ── Meta questions about MALIKA (identity, capabilities, features) ─────
const META_ABOUT_MALIKA_PATTERNS = [
  /^(?:siapa|apa)\s+(?:kamu|anda|nama\s*mu|malika)\s*[?!.]*$/i,
  /(?:apa\s+(?:itu|yang\s+bisa\s+kamu)\s+(?:malika|lakukan|bantu))/i,
  /(?:kamu\s+(?:bisa|buat)\s+apa)\s*[?]*$/i,
  /\bfitur\s+(?:yang\s+)?(?:bisa|kamu|anda|malika|tersedia)/i,
  /\bapa\s+saja\s+(?:fitur|kemampuan|fungsi|layanan)\b/i,
  /\b(?:kemampuan|keahlian|fungsi)\s+(?:kamu|anda|malika)\b/i,
  /\bjelaskan\s+(?:tentang\s+)?(?:dirimu|kamu|malika)\b/i,
  /\bkamu\s+(?:siapa|apa)\b/i,
];

/**
 * Test if query is a meta question about MALIKA's identity or capabilities.
 * @param {string} raw
 * @returns {boolean}
 */
function isMetaAboutMalika(raw) {
  const t = String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return META_ABOUT_MALIKA_PATTERNS.some(p => p.test(t));
}

// ── Opinion/advice requests ───────────────────────────────────────────
const OPINION_PATTERNS = [
  /^(?:menurut\s+kamu|pendapat\s*mu|saran\s*mu)\b/i,
  /^(?:menurutmu|menurut\s+anda)\b/i,
  /^(?:apa\s+(?:saran|rekomendasi|pendapat)\s*(?:mu|kamu|anda))\b/i,
];

/**
 * Test if query is an opinion/advice request (non-data).
 * @param {string} raw
 * @returns {boolean}
 */
function isOpinionRequest(raw) {
  const t = String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return OPINION_PATTERNS.some(p => p.test(t));
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  // Pattern arrays (for consumers that need to iterate directly)
  GREETING_PATTERNS,
  CONFIRMATION_PATTERNS,
  CHITCHAT_PATTERNS,
  META_ABOUT_MALIKA_PATTERNS,
  OPINION_PATTERNS,
  NON_STATISTICAL_QUERY_PATTERNS,
  DATA_SIGNALS,
  KNOWLEDGE_SIGNALS,
  SERVICE_PATTERNS,
  OUT_OF_SCOPE_PATTERNS,
  CREATIVE_WRITING_PATTERNS,
  PROMPT_INJECTION_PATTERNS,
  INDIVIDUAL_DATA_REQUEST_PATTERNS,
  RESPONSE_DISCLOSURE_PATTERNS,
  RESPONSE_REFUSAL_PATTERNS,
  RESPONSE_HAS_REAL_DATA_PATTERNS,
  STATISTICAL_CONTEXT_INDICATORS,
  BPS_INSTITUTIONAL_INDICATORS,
  PPID_CATEGORIES,
  EXIM_TRIGGER_PATTERNS,

  // Helper functions
  normalizeForMatching,
  isGreeting,
  isConfirmation,
  isOutOfScope,
  isCreativeWriting,
  isPromptInjection,
  isIndividualDataRequest,
  hasDataSignal,
  hasKnowledgeSignal,
  isServiceQuery,
  isBPSInstitutional,
  isEximTrigger,
  isNonStatistical,
  isChitchat,
  isMetaAboutMalika,
  isOpinionRequest,
};
