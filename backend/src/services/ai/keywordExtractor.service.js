/**
 * LLM Keyword Extractor Service
 *
 * Uses gpt-4.1 to extract statistical keywords from document
 * titles, abstracts, AND deep content (TOC/section headers).
 *
 * Two extraction modes:
 *   1. Title-only: 5-10 keywords from title + abstract (fast, cheap)
 *   2. Deep extraction: 15-25 keywords from content body (TOC, headers, tables)
 *
 * Designed to run automatically when:
 *   - Knowledge sync indexes new BRS/Publikasi
 *   - Admin manually creates KB docs (text or PDF)
 *   - Datasources are created/updated (triggers keyword index refresh)
 *
 * Cost: ~$0.00002 (title) to ~$0.00005 (deep) per document
 *
 * Exports:
 *   - extractKeywords(title, abstract)           — title-only keywords
 *   - extractDeepKeywords(title, content)        — deep content keywords
 *   - extractAllKeywords(title, abstract, content) — combined title + deep
 *   - extractKeywordsBatch(docs)                 — batch extraction
 */

'use strict';

const LLM_MODEL = process.env.OPENAI_MODEL_KEYWORD_EXTRACTOR || 'gemini-3-flash-preview';
const requestContext = require('../chat/streaming/requestContext');
const { getNextKey } = require('./client/geminiKeyRotation');
const LLM_TIMEOUT_MS = 20000; // Increased for gpt-5-mini
const BATCH_DELAY_MS = 300; // Delay between LLM calls in batch mode

// ── Statistical stopwords to exclude ───────────────────────────────────────
const STOPWORDS = new Set([
  'data', 'dan', 'di', 'ke', 'dari', 'yang', 'untuk', 'dengan', 'pada',
  'atau', 'dalam', 'ini', 'itu', 'adalah', 'serta', 'oleh', 'sebagai',
  'secara', 'menurut', 'per', 'tahun', 'bulan', 'provinsi', 'kabupaten',
  'kota', 'maluku', 'utara', 'indonesia', 'bps', 'statistik', 'badan',
  'pusat', 'berita', 'resmi', 'publikasi', 'halaman', 'tabel', 'gambar',
  'lampiran', 'katalog', 'issn', 'nomor', 'edisi', 'seri', 'angka',
  'jumlah', 'jenis', 'hasil', 'berdasarkan', 'tentang', 'the', 'and',
  'januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli',
  'agustus', 'september', 'oktober', 'november', 'desember',
  'triwulan', 'semester', 'kuartal', 'quarter',
  '2020', '2021', '2022', '2023', '2024', '2025', '2026',
]);

// ── Known acronym patterns in BPS statistical documents ────────────────────
const ACRONYM_RE = /\b([A-Z][A-Z0-9]{1,8})\b/g;

// ── Post-extraction noise filter ───────────────────────────────────────────
// Cleans up LLM keyword output to remove person names, institutional
// leakage, and overly generic terms.

/** Terms that the LLM sometimes generates but are NOT useful keywords */
const POST_FILTER_PATTERNS = [
  /^\d{4}$/,                               // Bare years: 2024, 2025
  /^\d+$/,                                 // Any bare number
  /^(bps|badan pusat statistik)$/,          // Publisher name
  /^(maluku utara|malut|indonesia)$/,       // Region names that leak through
  /^(provinsi|kabupaten|kota)$/,            // Bare geo prefixes
  /^(seri|edisi|volume|cetakan|hal|jilid)$/,// Publishing metadata
  /^(buku|naskah|katalog|issn|isbn)$/,      // Publishing metadata
  /^(dr|ir|prof|drs|s\.?e|m\.?si)\.?$/i,  // Academic titles
  /^data$/,                                 // Too generic
  /^statistik$/,                            // Too generic
  /^analisis$/,                             // Too generic
  /^(information|general|overview|result|analysis|report)$/i, // English noise
];

/**
 * Detect person names in keyword output.
 * Pattern: 2-5 capitalized words (e.g. "Amalia Adininggar Widyasanti")
 * or names with birth year patterns.
 */
const PERSON_NAME_RE = /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4}$/;

/**
 * Clean up LLM-extracted keywords: remove noise, person names, etc.
 * @param {string} raw - Comma-separated keywords from LLM
 * @returns {string} - Cleaned comma-separated keywords
 */
function cleanKeywordOutput(raw) {
  if (!raw) return '';
  
  const parts = raw.split(',').map(k => k.trim()).filter(Boolean);
  const cleaned = [];
  
  for (const kw of parts) {
    const lc = kw.toLowerCase();
    
    // Skip if matches any noise pattern
    if (POST_FILTER_PATTERNS.some(p => p.test(lc))) continue;
    
    // Skip person names (detect originally-cased form)
    if (PERSON_NAME_RE.test(kw) && !STOPWORDS.has(lc)) {
      // If it looks like a person name but is actually a place or term, check
      // if it contains any statistical word
      const hasStatWord = /\b(penduduk|pertanian|perikanan|pertambangan|industri|inflasi|kemiskinan|pengangguran|ekonomi|sosial|kesehatan|pendidikan|transportasi|pariwisata|perdagangan|pemerintah|keuangan|energi|konstruksi|manufaktur|ekspor|impor)\b/i.test(kw);
      if (!hasStatWord) continue;
    }
    
    // Skip very short or very long keywords
    if (lc.length < 2 || lc.length > 80) continue;
    
    cleaned.push(lc);
  }
  
  return cleaned.join(', ');
}

/**
 * Fallback: extract keywords from title using regex patterns.
 * Used when LLM call fails.
 */
function extractKeywordsFallback(title) {
  if (!title) return '';
  const keywords = new Set();

  // 1. Extract known-style acronyms: IPM, TPT, IHK, PDRB, NTP, etc.
  const acronymRe = /\b([A-Z][A-Z0-9/]{1,10})\b/g;
  let m;
  while ((m = acronymRe.exec(title)) !== null) {
    const acr = m[1].toLowerCase();
    if (acr.length >= 2 && !STOPWORDS.has(acr)) {
      keywords.add(acr);
    }
  }

  // 2. Extract parenthesized acronyms: (IPM), (PMTB)
  const parenRe = /\(([A-Z][A-Za-z0-9/]{1,10})\)/g;
  while ((m = parenRe.exec(title)) !== null) {
    keywords.add(m[1].toLowerCase());
  }

  // 3. Extract significant words (4+ chars, not stopwords)
  const words = title
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .split(/[\s,;/|•–—:]+/)
    .map(w => w.replace(/[^a-z0-9]/g, ''))
    .filter(w => w.length >= 4 && !STOPWORDS.has(w));

  for (const w of words) {
    keywords.add(w);
  }

  return [...keywords].slice(0, 10).join(', ');
}

/**
 * Extract statistical keywords from a document using gpt-4.1.
 *
 * @param {string} title - Document title
 * @param {string} [abstract] - Document abstract/description (optional)
 * @returns {Promise<string>} Comma-separated keywords (5-10 items)
 */
async function extractKeywords(title, abstract) {
  if (!title) return '';

  const apiKey = getNextKey();

  if (!apiKey) {
    console.warn('[KeywordExtractor] No OpenAI API key, using fallback');
    return extractKeywordsFallback(title);
  }

  // Build input text (title + first 500 chars of abstract)
  const inputText = abstract
    ? `${title}\n\n${String(abstract).slice(0, 500)}`
    : title;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const response = await fetch(process.env.OPENAI_API_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: requestContext.getModelOverride() || LLM_MODEL,
        temperature: 0,
        max_tokens: 150,
        messages: [
          {
            role: 'system',
            content: `Anda adalah analis metadata statistik BPS Indonesia.
Dari judul dan abstrak dokumen BPS, ekstrak 5-10 kata kunci statistik penting.

ATURAN:
- Tulis kata kunci dalam bentuk lowercase, dipisahkan koma
- Sertakan singkatan resmi (IPM, IHK, TPT, PDRB, NTP, dll) DAN bentuk panjangnya
- Sertakan topik/tema utama (inflasi, kemiskinan, pengangguran, ekspor, dll)
- Sertakan indikator spesifik jika ada (gini ratio, laju pertumbuhan, dll)
- JANGAN sertakan nama wilayah, bulan, tahun
- JANGAN sertakan kata umum (data, statistik, badan, pusat, berita, resmi)
- Maksimal 10 kata kunci

CONTOH:
Input: "Indeks Harga Konsumen dan Inflasi Bulan Desember 2025"
Output: ihk, inflasi, indeks harga konsumen, harga konsumen

Input: "Perkembangan Nilai Tukar Petani (NTP) Provinsi Maluku Utara"
Output: ntp, nilai tukar petani, petani, indeks harga

Input: "Keadaan Ketenagakerjaan Provinsi Maluku Utara Agustus 2025"
Output: ketenagakerjaan, naker, pengangguran, tpt, tingkat pengangguran terbuka, angkatan kerja, tpak

Input: "Statistik Migrasi Provinsi Maluku Utara"
Output: migrasi, pendatang, perpindahan penduduk, mobilitas penduduk`
          },
          {
            role: 'user',
            content: inputText,
          },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`[KeywordExtractor] LLM returned ${response.status}, using fallback`);
      return extractKeywordsFallback(title);
    }

    const data = await response.json();
    const result = data?.choices?.[0]?.message?.content?.trim();

    if (!result) {
      return extractKeywordsFallback(title);
    }

    // Clean up: remove quotes, normalize whitespace, limit length
    const cleaned = result
      .replace(/^["']|["']$/g, '')    // Remove wrapping quotes
      .replace(/\n/g, ', ')           // Newlines to commas
      .replace(/,\s*,/g, ',')         // Double commas
      .replace(/\s+/g, ' ')           // Normalize whitespace
      .trim();

    // Validate: reject if LLM returned a sentence/explanation instead of keywords
    // Heuristic: if no commas and >30 chars, it's likely a sentence
    if (!cleaned.includes(',') && cleaned.length > 30) {
      return extractKeywordsFallback(title);
    }
    // If starts with "tidak ada" or similar refusal, fall back
    if (/^(tidak ada|no |none|n\/a)/i.test(cleaned)) {
      return extractKeywordsFallback(title);
    }

    // Validate: must be comma-separated words, not a sentence
    if (cleaned.length > 400) {
      // LLM returned too much, trim
      return cleanKeywordOutput(cleaned.slice(0, 400));
    }

    return cleanKeywordOutput(cleaned);
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      console.warn('[KeywordExtractor] LLM timeout, using fallback');
    } else {
      console.warn(`[KeywordExtractor] LLM error: ${err.message}, using fallback`);
    }
    return extractKeywordsFallback(title);
  }
}

/**
 * Extract keywords for a batch of documents.
 * Processes sequentially with delays to avoid rate limiting.
 *
 * @param {Array<{id: number, title: string, abstract?: string}>} docs
 * @returns {Promise<Array<{id: number, keywords: string}>>}
 */
async function extractKeywordsBatch(docs) {
  const results = [];

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    try {
      const keywords = await extractKeywords(doc.title, doc.abstract);
      results.push({ id: doc.id, keywords });

      if (i < docs.length - 1) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
    } catch (err) {
      console.warn(`[KeywordExtractor] Batch item ${doc.id} failed: ${err.message}`);
      results.push({ id: doc.id, keywords: extractKeywordsFallback(doc.title) });
    }

    // Progress log every 50 items
    if ((i + 1) % 50 === 0) {
      console.log(`[KeywordExtractor] Batch progress: ${i + 1}/${docs.length}`);
    }
  }

  return results;
}

// ══════════════════════════════════════════════════════════════════════════════
// DEEP CONTENT KEYWORD EXTRACTION
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Extract structured section headers and TOC entries from document content.
 * Condenses a 68KB+ document into ~2-3KB of structured metadata.
 *
 * @param {string} content - Full document content
 * @returns {string} - Condensed section headers (max 3000 chars)
 */
function extractSectionHeaders(content) {
  if (!content || content.length < 200) return '';

  const lines = String(content).split('\n');
  const headers = new Set();
  const extracted = [];

  // Boilerplate patterns to skip entirely
  const SKIP_PATTERNS = /^(https?:\/\/|--|Katalog|ISSN|ISBN|halaman|page|Hal\.|vol\.|volume|cover|tim penyus|penyusun|penanggung|penulis|pengolah|penata|pembuat|sumber|dilarang|naskah|layouter|compiler|writer|processor|person|design|illustrat|nomor publikasi|ukuran buku|jumlah hala|bps-statist|badan pusat|acting head|plt\.|kepala|ternate,|february|februari|daftar pustaka|daftar gambar|daftar lampiran|daftar tabel|daftar singkat|list of|kata pengantar|ucapan|p\s*r\s*e\s*f\s*a\s*c\s*e|preface|references|contents|copyright)/i;

  // Person name pattern (2-4 capitalized words, no statistical content)
  const PERSON_NAME_RE = /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4}$/;
  // Bullet items from contributor lists
  const CONTRIBUTOR_RE = /^(?:\d+\.\s+)?(?:Kementerian|Dinas|Badan|Biro|Kanwil|Kepolisian|PT\.)/i;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.length < 5) continue;

    // Skip boilerplate
    if (SKIP_PATTERNS.test(line)) continue;
    if (/^-{3,}$/.test(line)) continue;
    if (PERSON_NAME_RE.test(line)) continue;
    if (CONTRIBUTOR_RE.test(line)) continue;
    // Skip page markers like "-- 5 of 750 --"
    if (/^--\s*\d+\s+of\s+\d+\s*--$/.test(line)) continue;
    // Skip year-only lines like "2024 and 2025"
    if (/^\d{4}\s+(and|dan)\s+\d{4}$/.test(line)) continue;

    // Pattern 1: Numbered TOC entries — "1. Geografi dan Iklim ........ 3" or "1 Title ... 3"
    const tocEntry = line.match(/^(\d+(?:\.\d+)*)\.?\s+([^\.]{4,120})(?:\.{2,}|\s{3,})\s*\d+$/);
    if (tocEntry) {
      const title = tocEntry[2].trim();
      // Skip if title is just boilerplate
      if (title.length >= 5 && !SKIP_PATTERNS.test(title) && !headers.has(title.toLowerCase())) {
        headers.add(title.toLowerCase());
        extracted.push(`${tocEntry[1]} ${title}`);
      }
      continue;
    }

    // Pattern 2: BAB/Chapter headings — "BAB I PENDAHULUAN"
    const babMatch = line.match(/^BAB\s+([IVX\d]+)\s+(.{4,80})/i);
    if (babMatch) {
      const title = babMatch[2].trim();
      if (!headers.has(title.toLowerCase())) {
        headers.add(title.toLowerCase());
        extracted.push(`BAB ${babMatch[1]} ${title}`);
      }
      continue;
    }

    // Pattern 3: ALL-CAPS section headers — only statistical/topical ones
    // Must be 8-80 chars, all caps, and contain meaningful statistical words
    if (line.length >= 8 && line.length <= 80 && /^[A-Z\s,&\-/()]+$/.test(line)) {
      const lc = line.toLowerCase();
      // Must contain at least one statistical/topical word
      const hasStatWord = /\b(penduduk|pertanian|perikanan|pertambangan|industri|pariwisata|transportasi|perdagangan|keuangan|pemerintah|sosial|kesejahteraan|ketenagakerja|geografi|iklim|energi|manufaktur|komunikasi|pengeluaran|neraca|perbankan|koperasi|harga|administratif|education|health|agriculture|fishery|mining|tourism|trade|employment|population|welfare|government|finance|climate|geography)\b/.test(lc);
      if (hasStatWord && !headers.has(lc)) {
        headers.add(lc);
        extracted.push(line);
      }
      continue;
    }

    // Pattern 4: "Tabel X.Y.Z Title" patterns (table titles) — limit to 100
    const tableMatch = line.match(/^Tabel\s+(\d+(?:\.\d+)*)\s+(.{10,120})/i);
    if (tableMatch && extracted.length < 100) {
      const title = tableMatch[2].trim().replace(/\.{2,}\s*\d+$/, '').trim();
      if (title.length >= 10 && !headers.has(title.toLowerCase())) {
        headers.add(title.toLowerCase());
        extracted.push(`Table: ${title}`);
      }
      continue;
    }

    // Pattern 5: "Gambar/Figure X.Y Title" — figure captions
    const figMatch = line.match(/^(?:Gambar|Figure)\s+(\d+(?:\.\d+)*)\s+(.{10,120})/i);
    if (figMatch && extracted.length < 150) {
      const title = figMatch[2].trim();
      if (!headers.has(title.toLowerCase())) {
        headers.add(title.toLowerCase());
        extracted.push(`Fig: ${title}`);
      }
      continue;
    }
  }

  // Limit to 3000 chars to fit in LLM context
  let result = extracted.join('\n');
  if (result.length > 3000) {
    result = result.slice(0, 3000);
    // Don't cut mid-line
    const lastNL = result.lastIndexOf('\n');
    if (lastNL > 2500) result = result.slice(0, lastNL);
  }

  return result;
}

/**
 * Extract deep keywords from document content using TOC/section analysis.
 * Uses section headers to discover statistical topics buried in long documents.
 *
 * @param {string} title - Document title
 * @param {string} content - Full document content
 * @returns {Promise<string>} - Comma-separated keywords (15-25 items)
 */
async function extractDeepKeywords(title, content) {
  if (!content || content.length < 2000) return '';

  const sectionHeaders = extractSectionHeaders(content);
  if (!sectionHeaders || sectionHeaders.length < 50) return '';

  const apiKey = process.env.OPENAI_API_KEY_CHAT
    || process.env.OPENAI_API_KEY_INTERPRETATION
    || process.env.OPENAI_API_KEY_QUERY_BUILDER
    || '';

  if (!apiKey) return '';

  const inputText = `Judul: ${title}\n\nDaftar Bab/Tabel:\n${sectionHeaders}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const response = await fetch(process.env.OPENAI_API_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: requestContext.getModelOverride() || LLM_MODEL,
        temperature: 0,
        max_tokens: 250,
        messages: [
          {
            role: 'system',
            content: `Anda adalah analis metadata statistik BPS Indonesia.
Dari daftar bab dan judul tabel sebuah publikasi BPS, ekstrak SEMUA topik statistik yang dibahas.

ATURAN:
- Tulis kata kunci lowercase, dipisahkan koma
- Sertakan SEMUA topik berbeda yang ditemukan (15-25 kata kunci)
- Sertakan singkatan resmi DAN bentuk panjangnya
- Sertakan topik spesifik: komoditas, sektor, indikator
- JANGAN sertakan nama wilayah, bulan, tahun
- JANGAN sertakan kata umum (data, statistik, tabel, gambar, badan, pusat)

CONTOH:
Input bab: "3. Penduduk dan Ketenagakerjaan, 5. Pertanian, 6. Pertambangan, 8. Pariwisata, 10. Perbankan"
Output: penduduk, ketenagakerjaan, naker, pengangguran, tpt, angkatan kerja, tpak, pertanian, padi, tanaman pangan, pertambangan, nikel, energi, pariwisata, wisatawan, hotel, okupansi, perbankan, kredit, tabungan, koperasi`
          },
          { role: 'user', content: inputText },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`[KeywordExtractor] Deep LLM returned ${response.status}`);
      return '';
    }

    const data = await response.json();
    const result = data?.choices?.[0]?.message?.content?.trim();

    if (!result) return '';

    // Clean up
    const cleaned = result
      .replace(/^["']|["']$/g, '')
      .replace(/\n/g, ', ')
      .replace(/,\s*,/g, ',')
      .replace(/\s+/g, ' ')
      .trim();

    // Validate
    if (!cleaned.includes(',') && cleaned.length > 30) return '';
    if (/^(tidak ada|no |none|n\/a)/i.test(cleaned)) return '';
    if (cleaned.length > 500) return cleanKeywordOutput(cleaned.slice(0, 500));

    return cleanKeywordOutput(cleaned);
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      console.warn('[KeywordExtractor] Deep LLM timeout');
    } else {
      console.warn(`[KeywordExtractor] Deep LLM error: ${err.message}`);
    }
    return '';
  }
}

/**
 * Extract comprehensive keywords from a document: combines title-based + deep content.
 * This is the recommended entry point for all new document indexing.
 *
 * @param {string} title - Document title
 * @param {string} [abstract] - Document abstract/description
 * @param {string} [content] - Full document content (for deep extraction)
 * @returns {Promise<string>} - Comma-separated keywords (merged + deduped)
 */
async function extractAllKeywords(title, abstract, content) {
  // 1. Title-based keywords (always)
  const titleKw = await extractKeywords(title, abstract);

  // 2. Deep content keywords (only for long docs)
  let deepKw = '';
  if (content && content.length >= 4000) {
    try {
      deepKw = await extractDeepKeywords(title, content);
    } catch (err) {
      console.warn(`[KeywordExtractor] Deep extraction failed (non-fatal): ${err.message}`);
    }
  }

  // 3. Merge and deduplicate
  if (!deepKw) return titleKw;
  if (!titleKw) return deepKw;

  const all = new Set();
  for (const kw of titleKw.split(',').map(k => k.trim().toLowerCase()).filter(Boolean)) {
    all.add(kw);
  }
  for (const kw of deepKw.split(',').map(k => k.trim().toLowerCase()).filter(Boolean)) {
    all.add(kw);
  }

  return [...all].join(', ');
}

module.exports = {
  extractKeywords,
  extractDeepKeywords,
  extractAllKeywords,
  extractKeywordsBatch,
  extractKeywordsFallback,
  extractSectionHeaders,
  cleanKeywordOutput,
};
