#!/usr/bin/env node
/**
 * LLM-Enhanced Indicator Index Enrichment
 * 
 * Uses GPT-4.1 to dramatically improve indicator_index quality by:
 * 
 * 1. CROSS-CHECK: Compare TOC entries vs actual inline tables/figures in content
 *    to find tables that exist in the body but are MISSING from the formal TOC.
 * 
 * 2. CLEANUP: Strip English translations, fix truncated titles, validate numbering.
 * 
 * 3. PERIOD TAGS: Add structured period years to each entry (e.g., 2024 or 2020-2024).
 * 
 * 4. TOPIC KEYWORDS: Generate Indonesian search keywords, abbreviation expansions,
 *    and common query phrases for maximum search recall.
 * 
 * 5. FULL EXTRACTION: For docs with NO existing index (71 docs), extract from scratch.
 * 
 * Processing Tiers:
 *   Tier A: Docs WITH existing indicator_index → cleanup + cross-check + keywords
 *   Tier B: Docs WITHOUT indicator_index → full LLM extraction + keywords
 * 
 * Output Format (appended to existing entries):
 *   TBL|8.5|Jumlah Rumah Makan/Restoran Menurut Kabupaten/Kota, 2021–2024
 *   ...
 *   KEYWORDS|rumah makan|restoran|kuliner|tempat makan|per kabupaten kota
 *   TOPICS|pariwisata|akomodasi|perdagangan
 *   PERIOD|2020|2021|2022|2023|2024
 *   ABBREV|PDRB=Produk Domestik Regional Bruto|TPK=Tingkat Penghunian Kamar
 * 
 * Usage:
 *   node scripts/enrich-indicator-index.js                    # Process all
 *   node scripts/enrich-indicator-index.js --id=855           # Single doc
 *   node scripts/enrich-indicator-index.js --dry-run          # Preview only
 *   node scripts/enrich-indicator-index.js --tier=B           # Only empty docs
 *   node scripts/enrich-indicator-index.js --tier=A           # Only existing docs
 *   node scripts/enrich-indicator-index.js --skip-existing    # Skip docs with KEYWORDS already
 *   node scripts/enrich-indicator-index.js --force-refresh    # Ignore cache TTL, re-enrich all
 *   node scripts/enrich-indicator-index.js --concurrency=3    # Parallel requests
 * 
 * @since 2026-02-19
 */

'use strict';

const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// ── CLI Args ──────────────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes('--dry-run');
const SINGLE_ID = process.argv.find(a => a.startsWith('--id='))?.split('=')[1];
const TIER_ONLY = process.argv.find(a => a.startsWith('--tier='))?.split('=')[1]?.toUpperCase();
const SKIP_EXISTING = process.argv.includes('--skip-existing');
const FORCE_REFRESH = process.argv.includes('--force-refresh');
const CONCURRENCY = parseInt(process.argv.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '5');
const MODEL = process.argv.find(a => a.startsWith('--model='))?.split('=')[1] || 'gpt-4.1';
const CACHE_TTL_DAYS = 30; // Enrichment cache expires after 30 days

// ── Config ────────────────────────────────────────────────────────────────
const OPENAI_API_URL = process.env.OPENAI_API_BASE_URL || 'http://127.0.0.1:3030/v1';
const API_KEY_ENV = 'OPENAI_API_KEY_CHAT';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 3000;
const TIMEOUT_MS = 180_000; // 3min per request (large docs)
const CACHE_DIR = path.join(__dirname, '..', '.cache', 'indicator-enrichment');

// Threshold: docs with >LARGE_INDEX_THRESHOLD entries use "additions-only" mode
const LARGE_INDEX_THRESHOLD = 40;

// Content sampling limits (proxy limit ~128K tokens, stay well under)
const MAX_CONTENT_FOR_LLM = 100_000;  // Safe limit
const CONTENT_HEAD_CHARS = 8_000;     // First 8K (title page, intro, TOC)
const CONTENT_TAIL_CHARS = 15_000;    // Last 15K (appendices, extra tables)
const CONTENT_SAMPLE_CHUNKS = 4;      // Body samples
const CONTENT_SAMPLE_SIZE = 15_000;   // Each body sample (~60K body total)

// ── Helpers ───────────────────────────────────────────────────────────────

function getApiKey() {
  const key = process.env[API_KEY_ENV]
    || process.env.OPENAI_API_KEY_INTERPRETATION
    || process.env.OPENAI_API_KEY_QUERY_BUILDER;
  if (!key) throw new Error(`No OpenAI API key found (tried ${API_KEY_ENV}, INTERPRETATION, QUERY_BUILDER)`);
  return key.trim();
}

/** Sleep with jitter */
function sleep(ms) {
  const jitter = Math.floor(Math.random() * ms * 0.3);
  return new Promise(r => setTimeout(r, ms + jitter));
}

/** Ensure cache directory exists */
function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/** Get cached LLM result for a doc (respects TTL and --force-refresh) */
function getCached(docId) {
  if (FORCE_REFRESH) return null;
  const file = path.join(CACHE_DIR, `doc-${docId}.json`);
  if (fs.existsSync(file)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      // Check TTL: skip expired cache entries
      if (data.cached_at || data.timestamp) {
        const cachedDate = new Date(data.cached_at || data.timestamp);
        const ageMs = Date.now() - cachedDate.getTime();
        if (ageMs > CACHE_TTL_DAYS * 24 * 60 * 60 * 1000) {
          return null; // Expired
        }
      }
      return data;
    } catch { /* corrupt cache */ }
  }
  return null;
}

/** Save LLM result to cache (with cached_at for TTL) */
function saveCache(docId, data) {
  ensureCacheDir();
  const file = path.join(CACHE_DIR, `doc-${docId}.json`);
  data.cached_at = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

/**
 * Sample content intelligently for large documents.
 * Returns: head + evenly-spaced body samples + tail
 */
function sampleContent(content, maxChars = MAX_CONTENT_FOR_LLM) {
  if (!content) return '';
  
  // Sanitize: strip control chars except \n \r \t
  content = content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  // Collapse excessive whitespace (common in PDF extraction)
  content = content.replace(/[ \t]{10,}/g, '  ');
  content = content.replace(/\n{4,}/g, '\n\n\n');
  
  if (content.length <= maxChars) return content;
  
  const head = content.slice(0, CONTENT_HEAD_CHARS);
  const tail = content.slice(-CONTENT_TAIL_CHARS);
  
  // Evenly sample from the body (skip head and tail regions)
  const bodyStart = CONTENT_HEAD_CHARS;
  const bodyEnd = content.length - CONTENT_TAIL_CHARS;
  const bodyLen = bodyEnd - bodyStart;
  
  if (bodyLen <= 0) return head + '\n\n...[CONTENT MIDDLE OMITTED]...\n\n' + tail;
  
  const samples = [];
  const step = Math.floor(bodyLen / (CONTENT_SAMPLE_CHUNKS + 1));
  
  for (let i = 0; i < CONTENT_SAMPLE_CHUNKS; i++) {
    const pos = bodyStart + step * (i + 1);
    const sampleStart = Math.max(bodyStart, pos - Math.floor(CONTENT_SAMPLE_SIZE / 2));
    const sampleEnd = Math.min(bodyEnd, sampleStart + CONTENT_SAMPLE_SIZE);
    samples.push(content.slice(sampleStart, sampleEnd));
  }
  
  const pctCovered = ((CONTENT_HEAD_CHARS + CONTENT_TAIL_CHARS + CONTENT_SAMPLE_CHUNKS * CONTENT_SAMPLE_SIZE) / content.length * 100).toFixed(0);
  
  return [
    `[DOKUMEN: ${content.length.toLocaleString()} karakter total, sampling ${pctCovered}% konten]`,
    '',
    '=== BAGIAN AWAL (TOC, halaman judul, intro) ===',
    head,
    '',
    ...samples.flatMap((s, i) => [
      `\n=== SAMPEL HALAMAN ${i + 1}/${CONTENT_SAMPLE_CHUNKS} (posisi ~${Math.round((bodyStart + step * (i + 1)) / content.length * 100)}%) ===`,
      s
    ]),
    '',
    '=== BAGIAN AKHIR (lampiran, tabel terakhir) ===',
    tail,
  ].join('\n');
}

/** Extract inline "Tabel N.N" and "Table N.N" references for cross-check */
function findInlineTableReferences(content) {
  const refs = new Set();
  const re = /(?:Tabel|Table)\s+(\d+(?:\.\d+){0,3})/gi;
  let match;
  while ((match = re.exec(content)) !== null) {
    refs.add(match[1]);
  }
  return [...refs].sort((a, b) => {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      if ((partsA[i] || 0) !== (partsB[i] || 0)) return (partsA[i] || 0) - (partsB[i] || 0);
    }
    return 0;
  });
}

/** Extract existing TBL numbers from indicator_index */
function getExistingTableNumbers(indicatorIndex) {
  if (!indicatorIndex) return new Set();
  const nums = new Set();
  for (const line of indicatorIndex.split('\n')) {
    const match = line.match(/^TBL\|([^|]+)\|/);
    if (match) nums.add(match[1]);
  }
  return nums;
}

// ── LLM Call ──────────────────────────────────────────────────────────────

async function callLLM(messages, { maxTokens = 8000, retries = MAX_RETRIES } = {}) {
  const apiKey = getApiKey();
  const url = `${OPENAI_API_URL}/chat/completions`;
  
  const requestBody = {
    model: MODEL,
    messages,
    temperature: 0.1,
    max_tokens: maxTokens,
  };
  const bodyStr = JSON.stringify(requestBody);
  console.log(`    [LLM] Request body: ${bodyStr.length.toLocaleString()} chars, max_tokens=${maxTokens}`);
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: bodyStr,
        signal: controller.signal,
      });
      
      clearTimeout(timeout);
      
      if (!response.ok) {
        const errBody = await response.text();
        if (response.status === 429 && attempt < retries) {
          const retryAfter = parseInt(response.headers.get('retry-after') || '10');
          console.warn(`  Rate limited, waiting ${retryAfter}s...`);
          await sleep(retryAfter * 1000);
          continue;
        }
        throw new Error(`OpenAI ${response.status}: ${errBody.slice(0, 200)}`);
      }
      
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      const usage = data.usage;
      
      return { content, usage };
    } catch (err) {
      if (err.name === 'AbortError') {
        console.warn(`  Timeout (attempt ${attempt + 1}/${retries + 1})`);
      } else if (attempt < retries) {
        console.warn(`  Error (attempt ${attempt + 1}): ${err.message?.slice(0, 100)}`);
      } else {
        throw err;
      }
      await sleep(RETRY_DELAY_MS * (attempt + 1));
    }
  }
  throw new Error('All retries exhausted');
}

// ── Prompts ───────────────────────────────────────────────────────────────

/**
 * Tier A-Large: Docs with MANY existing entries (yearbooks, etc.)
 * Strategy: Keep existing entries, ask for ADDITIONS + METADATA only.
 * The LLM reviews the content and finds what's MISSING from the existing index.
 */
function buildTierALargePrompt(doc, missingTableNums) {
  const missingRefs = missingTableNums.length > 0
    ? `\n\nTABEL YANG DITEMUKAN DI KONTEN TAPI TIDAK ADA DI INDEKS:\n${missingTableNums.map(n => `- Tabel ${n}`).join('\n')}\nCari judul lengkap tabel-tabel ini di konten dokumen.`
    : '';

  return [
    {
      role: 'system',
      content: `Kamu adalah pakar metadata BPS Indonesia. Dokumen ini sudah memiliki ${doc.existingEntryCount} entri indeks yang sudah baik.

TUGASMU (HANYA 2 HAL):

1. TEMUKAN ENTRI YANG HILANG: Bandingkan indeks yang sudah ada dengan konten dokumen. Identifikasi tabel/gambar/lampiran yang ADA di konten tapi BELUM tercatat. Keluarkan HANYA entri BARU (yang belum ada di indeks).

2. GENERATE METADATA: Buat KEYWORDS, TOPICS, PERIOD, dan ABBREV berdasarkan SELURUH dokumen (bukan hanya entri baru).

FORMAT OUTPUT:
- Jika ada entri baru: tulis satu per baris, format TYPE|NOMOR|JUDUL (hanya bahasa Indonesia)
- WAJIB di akhir:
KEYWORDS|kata1|kata2|...(minimal 20, maksimal 60 kata kunci pencarian bahasa Indonesia)
TOPICS|topik1|topik2|...(3-10 topik utama statistik)
PERIOD|tahun1|tahun2|...(semua tahun yang tercakup)
ABBREV|SINGKAT1=Kepanjangan1|SINGKAT2=Kepanjangan2|...

KEYWORDS harus mencakup:
- Sinonim dan istilah informal (nganggur=pengangguran, miskin=kemiskinan, dll)
- Ekspansi singkatan (PDRB, TPK, IPM, IHK, TPAK, dll)
- Frasa pencarian umum yang mungkin diketik user
- Nama-nama indikator utama yang dibahas di dokumen
- Istilah wilayah yang relevan (maluku utara, malut, dll)

ATURAN:
- JANGAN ulangi entri yang sudah ada di indeks
- JANGAN sertakan teks bahasa Inggris
- JANGAN tulis halaman/page number
- Jika TIDAK ada entri baru, langsung tulis KEYWORDS|... di baris pertama
- KEYWORDS, TOPICS, PERIOD, ABBREV WAJIB ada`
    },
    {
      role: 'user',
      content: `DOKUMEN: "${doc.title}" (${doc.category}, ${(doc.contentLength || 0).toLocaleString()} karakter)

INDEKS YANG SUDAH ADA (${doc.existingEntryCount} entri, JANGAN diulangi):
${doc.indicatorIndex}
${missingRefs}

KONTEN DOKUMEN (untuk cross-check):
${doc.sampledContent}

Tugas: Tulis HANYA entri baru yang belum ada + KEYWORDS/TOPICS/PERIOD/ABBREV.`
    }
  ];
}

/**
 * Tier A-Small: Docs with FEW existing entries
 * Strategy: Full cleanup + rewrite + cross-check + add metadata.
 */
function buildTierASmallPrompt(doc, missingTableNums) {
  const missingInfo = missingTableNums.length > 0
    ? `\n\nTABEL YANG ADA DI KONTEN TAPI TIDAK ADA DI INDEKS SAAT INI:\n${missingTableNums.map(n => `- Tabel ${n}`).join('\n')}\nCari judul lengkap tabel-tabel ini di konten dokumen dan tambahkan ke daftar.`
    : '';

  return [
    {
      role: 'system',
      content: `Kamu adalah pakar metadata BPS (Badan Pusat Statistik) Indonesia. Tugasmu:

1. CROSS-CHECK & LENGKAPI: Bandingkan daftar tabel/gambar yang sudah ada dengan konten dokumen. Temukan tabel/gambar yang ADA di konten tapi BELUM tercatat di indeks.

2. BERSIHKAN: Untuk setiap entri yang sudah ada:
   - Hapus teks bahasa Inggris (terjemahan bilingual)
   - Perbaiki judul yang terpotong
   - Pastikan format TYPE|NOMOR|JUDUL konsisten (TYPE = TBL/FIG/APP/BAB/TOC)

3. GENERATE METADATA: Buat KEYWORDS, TOPICS, PERIOD, ABBREV berdasarkan seluruh dokumen.

FORMAT OUTPUT (WAJIB):
Baris 1-N: SEMUA entri (existing yang sudah dibersihkan + baru), format: TYPE|NOMOR|JUDUL_BERSIH
Lalu WAJIB:
KEYWORDS|kata1|kata2|...(minimal 20, maksimal 60 kata kunci)
TOPICS|topik1|topik2|...(3-10 topik utama)
PERIOD|tahun1|tahun2|...(semua tahun)
ABBREV|SINGKAT1=Kepanjangan1|SINGKAT2=Kepanjangan2|...

KEYWORDS harus mencakup: sinonim informal, ekspansi singkatan, frasa pencarian umum, nama indikator, istilah wilayah.

ATURAN:
- JANGAN sertakan teks bahasa Inggris dalam judul
- JANGAN sertakan halaman/page number
- Setiap entri HARUS memiliki TYPE, NOMOR, dan JUDUL yang jelas
- JANGAN buat entri fiktif — hanya yang benar-benar ada di dokumen`
    },
    {
      role: 'user',
      content: `DOKUMEN: "${doc.title}" (${doc.category}, ${(doc.contentLength || 0).toLocaleString()} karakter)

INDEKS SAAT INI (${doc.existingEntryCount} entri):
${doc.indicatorIndex || '(kosong)'}
${missingInfo}

KONTEN DOKUMEN (untuk cross-check):
${doc.sampledContent}

Tugas: Perbaiki dan lengkapi indeks di atas. Keluarkan SEMUA entri (yang sudah ada + baru ditemukan), sudah dibersihkan, plus KEYWORDS/TOPICS/PERIOD/ABBREV.`
    }
  ];
}

/**
 * Tier B: Docs WITHOUT indicator_index
 * Full extraction from scratch
 */
function buildTierBPrompt(doc) {
  return [
    {
      role: 'system',
      content: `Kamu adalah pakar metadata BPS (Badan Pusat Statistik) Indonesia. Tugasmu mengekstrak SEMUA tabel, gambar, bab, dan lampiran dari dokumen BPS.

SCAN konten dokumen dan temukan SEMUA:
1. Tabel (biasanya "Tabel N.N" atau "Table N.N")
2. Gambar/Grafik (biasanya "Gambar N.N" atau "Figure N.N")
3. Bab/Chapter (biasanya "BAB I" atau chapter headers)
4. Lampiran/Appendix

Untuk dokumen yang berisi infografis, data-data angka, atau konten tidak terstruktur:
- Identifikasi topik-topik utama yang dibahas
- Catat angka-angka kunci dan indikator yang disebutkan
- Buat entri deskriptif jika tidak ada tabel formal

FORMAT OUTPUT (WAJIB DIIKUTI PERSIS):
Baris 1-N: entri indikator, format: TYPE|NOMOR|JUDUL_BERSIH
TYPE bisa: TBL, FIG, APP, BAB, TOC, INFO (untuk infografis/data tanpa tabel formal)

Setelah entri, WAJIB tambahkan:
KEYWORDS|kata1|kata2|...(minimal 20, maksimal 60 kata kunci bahasa Indonesia)
TOPICS|topik1|topik2|...(3-10 topik utama)
PERIOD|tahun1|tahun2|...(semua tahun)
ABBREV|SINGKAT1=Kepanjangan1|SINGKAT2=Kepanjangan2|...

KEYWORDS harus mencakup: sinonim informal, ekspansi singkatan, frasa pencarian umum, nama indikator, istilah wilayah.

ATURAN:
- HANYA bahasa Indonesia dalam judul (hapus terjemahan Inggris)
- JANGAN sertakan halaman/page number
- Untuk infografis: gunakan TYPE=INFO dan deskripsikan konten data
- JANGAN buat entri fiktif — hanya yang benar-benar ada di dokumen`
    },
    {
      role: 'user',
      content: `DOKUMEN: "${doc.title}" (${doc.category}, ${(doc.contentLength || 0).toLocaleString()} karakter)

KONTEN DOKUMEN:
${doc.sampledContent}

Tugas: Ekstrak SEMUA tabel, gambar, bab, dan informasi kunci dari dokumen ini. Buat indeks lengkap plus KEYWORDS/TOPICS/PERIOD/ABBREV.`
    }
  ];
}

// ── Post-Processing ───────────────────────────────────────────────────────

/**
 * Programmatically clean existing indicator_index entries.
 * This runs BEFORE LLM enrichment to reduce noise.
 */
function programmaticCleanup(indicatorIndex) {
  if (!indicatorIndex) return '';
  
  const lines = indicatorIndex.split('\n');
  const cleaned = [];
  
  // Common English phrases that appear after Indonesian titles in bilingual BPS docs
  const englishTailPatterns = [
    // "Sex in Maluku", "in Maluku Utara Province"
    /\s+(?:Sex|Gender|Age|Group)\s+(?:in|of|and)\s+(?:Maluku|North|Province)\b.*/i,
    // "Employment Status and Main Industry in Maluku"
    /\s+(?:Employment|Working|Educational|Population|Number|Percentage|Distribution|Growth|Rate|Total|Average)\s+(?:Status|Hours?|Attainment|of|by|and|in)\b.*$/i,
    // "Province of North Maluku" or "in North Maluku"
    /\s+(?:in|of)\s+(?:North\s+)?Maluku\s*(?:Utara|Province)?\s*$/i,
    // Generic trailing English after a year: "2024 Number of..." 
    /(\d{4})\s+[A-Z][a-z]+(?:\s+[A-Za-z]+){2,}$/,
    // "Table N.N" or "Figure N.N" (English version duplicated)
    /\s+(?:Table|Figure|Chart|Graph|Appendix)\s+\d+[\.\d]*\b.*$/i,
    // Full English title after slash: " / Number of Villages..."
    /\s*\/\s*[A-Z][a-z]+(?:\s+[A-Za-z]+){2,}$/,
  ];
  
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    
    // Skip pure English lines
    if (/^[A-Z][A-Za-z\s,.\-:()0-9]+$/.test(line) && !/\|/.test(line)) continue;
    
    // Parse TYPE|NUM|TITLE format
    const parts = line.split('|');
    if (parts.length >= 3) {
      const type = parts[0];
      const num = parts[1];
      let title = parts.slice(2).join('|');
      
      // Apply English tail removal patterns
      for (const pattern of englishTailPatterns) {
        const match = title.match(pattern);
        if (match) {
          // For year patterns, keep the year
          if (match[1]) {
            title = title.slice(0, match.index + match[1].length);
          } else {
            title = title.slice(0, match.index);
          }
        }
      }
      
      // Remove trailing page numbers
      title = title.replace(/\s+\d+\s*$/, '').trim();
      // Remove trailing comma/whitespace
      title = title.replace(/[,\s]+$/, '').trim();
      
      if (title.length >= 3) {
        cleaned.push(`${type}|${num}|${title}`);
      }
    } else {
      // Keep non-standard lines as-is (might be metadata from previous runs)
      cleaned.push(line);
    }
  }
  
  return cleaned.join('\n');
}

/**
 * Validate and clean LLM output
 */
function postProcessLLMOutput(rawOutput) {
  if (!rawOutput) return null;
  
  const lines = rawOutput.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);
  
  const validEntries = [];
  const validPrefixes = ['TBL|', 'FIG|', 'APP|', 'BAB|', 'TOC|', 'INFO|', 'KEYWORDS|', 'TOPICS|', 'PERIOD|', 'ABBREV|'];
  
  for (const line of lines) {
    // Skip markdown fences and other noise
    if (line.startsWith('```') || line.startsWith('---') || line.startsWith('#')) continue;
    
    // Check if line starts with a valid prefix
    const hasValidPrefix = validPrefixes.some(p => line.startsWith(p));
    if (!hasValidPrefix) continue;
    
    // Validate entry structure: TYPE|SOMETHING|SOMETHING
    const parts = line.split('|');
    if (parts.length < 2) continue;
    
    // For structural entries (TBL, FIG, etc.), need at least TYPE|NUM|TITLE
    const type = parts[0];
    if (['TBL', 'FIG', 'APP', 'BAB', 'TOC', 'INFO'].includes(type)) {
      if (parts.length < 3 || !parts[1].trim() || !parts[2].trim()) continue;
      // Clean the title
      let title = parts.slice(2).join('|').trim();
      // Remove trailing English fragments
      title = title.replace(/\s+(?:Province|Regency|Municipality|Percent|Number|Distribution|Growth|Table|Figure)\b.*$/i, '');
      // Remove page numbers
      title = title.replace(/\s*\d+\s*$/, '').trim();
      if (title.length < 3) continue;
      validEntries.push(`${type}|${parts[1].trim()}|${title}`);
    } else {
      // KEYWORDS, TOPICS, PERIOD, ABBREV — just validate non-empty
      if (parts.length >= 2 && parts[1].trim()) {
        validEntries.push(line);
      }
    }
  }
  
  if (validEntries.length === 0) return null;
  
  // Deduplicate by lowercase
  const seen = new Set();
  const deduped = validEntries.filter(entry => {
    const key = entry.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  
  return deduped.join('\n');
}

/**
 * Merge existing (cleaned) entries with LLM additions.
 * Used for Tier A-Large where we keep existing entries and add new ones + metadata.
 */
function mergeEntriesWithAdditions(cleanedExisting, llmAdditions) {
  if (!llmAdditions) return cleanedExisting;
  
  // Parse existing entries (structural only)
  const existingLines = cleanedExisting.split('\n').filter(l => l.trim());
  const existingKeys = new Set(existingLines.map(l => l.toLowerCase()));
  
  // Parse LLM additions
  const additionLines = llmAdditions.split('\n').filter(l => l.trim());
  
  const newStructural = [];
  const metadataLines = [];
  
  for (const line of additionLines) {
    if (/^(KEYWORDS|TOPICS|PERIOD|ABBREV)\|/.test(line)) {
      metadataLines.push(line);
    } else if (/^(TBL|FIG|APP|BAB|TOC|INFO)\|/.test(line)) {
      // Only add if not already in existing
      if (!existingKeys.has(line.toLowerCase())) {
        newStructural.push(line);
      }
    }
  }
  
  // Combine: existing + new structural + metadata
  const parts = [...existingLines];
  if (newStructural.length > 0) {
    parts.push(...newStructural);
  }
  if (metadataLines.length > 0) {
    parts.push(...metadataLines);
  }
  
  return parts.join('\n');
}

// ── Concurrency Control ───────────────────────────────────────────────────

async function processWithConcurrency(items, concurrency, processor) {
  const results = [];
  let idx = 0;
  
  async function worker() {
    while (idx < items.length) {
      const currentIdx = idx++;
      const item = items[currentIdx];
      try {
        const result = await processor(item, currentIdx, items.length);
        results.push(result);
      } catch (err) {
        results.push({ id: item.id, error: err.message });
      }
    }
  }
  
  const workers = Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(() => worker());
  
  await Promise.all(workers);
  return results;
}

// ── Main Processing ───────────────────────────────────────────────────────

async function processDoc(conn, doc, idx, total) {
  const hasExisting = !!doc.indicator_index;
  const entryCount = hasExisting
    ? doc.indicator_index.split('\n').filter(l => l.trim()).length
    : 0;
  const isLargeIndex = entryCount > LARGE_INDEX_THRESHOLD;
  const mode = !hasExisting ? 'B' : (isLargeIndex ? 'A-Large' : 'A-Small');
  
  // Skip if already enriched and --skip-existing
  if (SKIP_EXISTING && hasExisting && doc.indicator_index.includes('KEYWORDS|')) {
    return { id: doc.id, mode, status: 'skipped', reason: 'already enriched' };
  }
  
  // Check cache first
  const cached = getCached(doc.id);
  if (cached && !SINGLE_ID) {
    console.log(`  [${idx + 1}/${total}] #${doc.id} "${doc.title?.slice(0, 50)}" → cached (${mode})`);
    if (!DRY_RUN) {
      await conn.query('UPDATE knowledge_base SET indicator_index = ? WHERE id = ?', [cached.enrichedIndex, doc.id]);
    }
    return { id: doc.id, mode, status: 'cached', entries: cached.enrichedIndex?.split('\n').length || 0 };
  }
  
  console.log(`  [${idx + 1}/${total}] #${doc.id} "${doc.title?.slice(0, 55)}" (${mode}, ${(doc.content?.length || 0).toLocaleString()}ch, ${entryCount} entries)`);
  
  // Step 1: Programmatic cleanup of existing entries
  let cleanedExisting = '';
  if (hasExisting) {
    cleanedExisting = programmaticCleanup(doc.indicator_index);
    const removedCount = entryCount - cleanedExisting.split('\n').filter(l => l.trim()).length;
    if (removedCount > 0) {
      console.log(`    Programmatic cleanup: removed ${removedCount} noise/English entries`);
    }
  }
  
  // Step 2: Sample content for LLM
  const sampledContent = sampleContent(doc.content || '');
  
  // Step 3: Cross-check — find inline table refs missing from index
  let missingTableNums = [];
  if (hasExisting) {
    const inlineRefs = findInlineTableReferences(doc.content || '');
    const existingNums = getExistingTableNumbers(cleanedExisting);
    missingTableNums = inlineRefs.filter(n => !existingNums.has(n));
    if (missingTableNums.length > 0) {
      console.log(`    Cross-check: ${missingTableNums.length} tables in content not in index: ${missingTableNums.slice(0, 10).join(', ')}${missingTableNums.length > 10 ? '...' : ''}`);
    }
  }
  
  // Step 4: Build prompt based on mode
  const docInput = {
    title: doc.title,
    category: doc.category,
    contentLength: (doc.content || '').length,
    indicatorIndex: cleanedExisting || doc.indicator_index,
    existingEntryCount: cleanedExisting ? cleanedExisting.split('\n').filter(l => l.trim()).length : entryCount,
    sampledContent,
  };
  
  let messages;
  let maxTokens;
  if (mode === 'A-Large') {
    messages = buildTierALargePrompt(docInput, missingTableNums);
    maxTokens = 4000; // Only additions + metadata, should be compact
  } else if (mode === 'A-Small') {
    messages = buildTierASmallPrompt(docInput, missingTableNums);
    maxTokens = Math.max(4000, Math.min(16000, entryCount * 60)); // ~60 tokens per entry
  } else {
    messages = buildTierBPrompt(docInput);
    maxTokens = 16000; // Full extraction
  }
  
  // Step 5: Call LLM
  const startTime = Date.now();
  const { content: rawOutput, usage } = await callLLM(messages, { maxTokens });
  const latencyMs = Date.now() - startTime;
  
  // Step 6: Post-process LLM output
  const processedLLMOutput = postProcessLLMOutput(rawOutput);
  
  if (!processedLLMOutput) {
    console.log(`    ⚠️  LLM returned no valid entries (${latencyMs}ms)`);
    // For A-Large, still apply programmatic cleanup even if LLM fails
    if (mode === 'A-Large' && cleanedExisting) {
      if (!DRY_RUN) {
        await conn.query('UPDATE knowledge_base SET indicator_index = ? WHERE id = ?', [cleanedExisting, doc.id]);
      }
      return { id: doc.id, mode, status: 'cleanup_only', latencyMs };
    }
    return { id: doc.id, mode, status: 'empty_output', latencyMs };
  }
  
  // Step 7: Merge (for A-Large) or use directly (for A-Small and B)
  let finalIndex;
  if (mode === 'A-Large') {
    finalIndex = mergeEntriesWithAdditions(cleanedExisting, processedLLMOutput);
  } else {
    finalIndex = processedLLMOutput;
  }
  
  const finalLines = finalIndex.split('\n').filter(l => l.trim());
  const structuralEntries = finalLines.filter(l => /^(TBL|FIG|APP|BAB|TOC|INFO)\|/.test(l)).length;
  const hasKeywords = finalIndex.includes('KEYWORDS|');
  const hasPeriod = finalIndex.includes('PERIOD|');
  const hasTopics = finalIndex.includes('TOPICS|');
  
  const llmStructural = processedLLMOutput.split('\n').filter(l => /^(TBL|FIG|APP|BAB|TOC|INFO)\|/.test(l)).length;
  
  console.log(`    ✅ ${structuralEntries} entries (LLM added ${llmStructural} new), KW=${hasKeywords ? 'Y' : 'N'}, PER=${hasPeriod ? 'Y' : 'N'}, TOP=${hasTopics ? 'Y' : 'N'} (${latencyMs}ms, ${usage?.total_tokens || '?'}tok)`);
  
  // Save to cache
  saveCache(doc.id, {
    docId: doc.id,
    title: doc.title,
    mode,
    originalEntries: entryCount,
    finalEntries: finalLines.length,
    structuralEntries,
    llmNewEntries: llmStructural,
    hasKeywords,
    hasPeriod,
    hasTopics,
    latencyMs,
    tokens: usage?.total_tokens || 0,
    enrichedIndex: finalIndex,
    timestamp: new Date().toISOString(),
  });
  
  // Write to DB
  if (!DRY_RUN) {
    await conn.query('UPDATE knowledge_base SET indicator_index = ? WHERE id = ?', [finalIndex, doc.id]);
  } else if (SINGLE_ID) {
    console.log(`\n    --- ENRICHED INDEX (preview, first 40 lines) ---`);
    finalIndex.split('\n').slice(0, 40).forEach(l => console.log(`    ${l}`));
    const totalLines = finalLines.length;
    if (totalLines > 40) console.log(`    ... (${totalLines - 40} more lines)`);
    console.log(`    --- END ---\n`);
  }
  
  return {
    id: doc.id,
    mode,
    status: 'enriched',
    originalEntries: entryCount,
    finalEntries: finalLines.length,
    structuralEntries,
    llmNewEntries: llmStructural,
    missingTablesFound: missingTableNums.length,
    hasKeywords,
    hasPeriod,
    latencyMs,
    tokens: usage?.total_tokens || 0,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  LLM-Enhanced Indicator Index Enrichment                ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  Model:       ${MODEL}`);
  console.log(`  Mode:        ${DRY_RUN ? 'DRY RUN' : 'LIVE (will write to DB)'}`);
  console.log(`  Concurrency: ${CONCURRENCY}`);
  console.log(`  Tier:        ${TIER_ONLY || 'ALL (A+B)'}`);
  if (SINGLE_ID) console.log(`  Single doc:  ${SINGLE_ID}`);
  if (SKIP_EXISTING) console.log(`  Skip:        docs with KEYWORDS already`);
  console.log();
  
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'project_data_strategis',
  });
  
  // Fetch docs
  let query = `SELECT id, title, category, content, indicator_index 
               FROM knowledge_base 
               WHERE parent_id IS NULL`;
  const params = [];
  
  if (SINGLE_ID) {
    query += ' AND id = ?';
    params.push(parseInt(SINGLE_ID));
  }
  
  if (TIER_ONLY === 'A') {
    query += ' AND indicator_index IS NOT NULL';
  } else if (TIER_ONLY === 'B') {
    query += ' AND indicator_index IS NULL';
  }
  
  query += ' ORDER BY CHAR_LENGTH(COALESCE(content, "")) DESC'; // Process largest first (most value)
  
  console.log('Fetching documents...');
  const [docs] = await conn.query(query, params);
  
  const tierACnt = docs.filter(d => d.indicator_index).length;
  const tierBCnt = docs.filter(d => !d.indicator_index).length;
  console.log(`Found ${docs.length} documents (Tier A: ${tierACnt} with index, Tier B: ${tierBCnt} without)\n`);
  
  if (docs.length === 0) {
    console.log('No documents to process.');
    await conn.end();
    return;
  }
  
  // Process with concurrency
  const startTime = Date.now();
  const results = [];
  
  // Process sequentially for single doc, with concurrency for batch
  if (SINGLE_ID || CONCURRENCY <= 1) {
    for (let i = 0; i < docs.length; i++) {
      const result = await processDoc(conn, docs[i], i, docs.length);
      results.push(result);
    }
  } else {
    // Process in batches with concurrency
    const batchResults = await processWithConcurrency(
      docs,
      CONCURRENCY,
      (doc, idx, total) => processDoc(conn, doc, idx, total)
    );
    results.push(...batchResults);
  }
  
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  
  // Propagate to chunks
  if (!DRY_RUN && !SINGLE_ID) {
    console.log('\nPropagating enriched indicator_index to chunks...');
    const [propResult] = await conn.query(`
      UPDATE knowledge_base c
      INNER JOIN knowledge_base p ON c.parent_id = p.id
      SET c.indicator_index = p.indicator_index
      WHERE c.parent_id IS NOT NULL
        AND p.indicator_index IS NOT NULL
    `);
    console.log(`Updated ${propResult.affectedRows} chunks`);
  }
  
  // Stats
  const enriched = results.filter(r => r.status === 'enriched');
  const cached = results.filter(r => r.status === 'cached');
  const skipped = results.filter(r => r.status === 'skipped');
  const errors = results.filter(r => r.error);
  const emptyOutput = results.filter(r => r.status === 'empty_output');
  
  const modeCounts = {};
  for (const r of enriched) {
    modeCounts[r.mode] = (modeCounts[r.mode] || 0) + 1;
  }
  
  const totalTokens = enriched.reduce((s, r) => s + (r.tokens || 0), 0);
  const totalOrigEntries = enriched.reduce((s, r) => s + (r.originalEntries || 0), 0);
  const totalFinalEntries = enriched.reduce((s, r) => s + (r.finalEntries || r.structuralEntries || 0), 0);
  const totalLlmNew = enriched.reduce((s, r) => s + (r.llmNewEntries || 0), 0);
  const totalMissingFound = enriched.reduce((s, r) => s + (r.missingTablesFound || 0), 0);
  const withKeywords = enriched.filter(r => r.hasKeywords).length;
  const withPeriod = enriched.filter(r => r.hasPeriod).length;
  
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  RESULTS                                                ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  Total docs:         ${docs.length}`);
  console.log(`  Enriched:           ${enriched.length}`);
  if (Object.keys(modeCounts).length > 0) {
    for (const [mode, count] of Object.entries(modeCounts)) {
      console.log(`    ${mode}: ${count}`);
    }
  }
  console.log(`  From cache:         ${cached.length}`);
  console.log(`  Skipped:            ${skipped.length}`);
  console.log(`  Empty output:       ${emptyOutput.length}`);
  console.log(`  Errors:             ${errors.length}`);
  console.log();
  console.log(`  Original entries:   ${totalOrigEntries.toLocaleString()}`);
  console.log(`  Final entries:      ${totalFinalEntries.toLocaleString()}`);
  console.log(`  LLM new entries:    ${totalLlmNew.toLocaleString()}`);
  console.log(`  Missing tables found: ${totalMissingFound}`);
  console.log(`  With KEYWORDS:      ${withKeywords}/${enriched.length}`);
  console.log(`  With PERIOD:        ${withPeriod}/${enriched.length}`);
  console.log();
  console.log(`  Total tokens:       ${totalTokens.toLocaleString()}`);
  console.log(`  Est. cost (GPT-4.1): $${(totalTokens * 0.000008).toFixed(2)}`);
  console.log(`  Wall time:          ${totalTime}s`);
  
  if (errors.length > 0) {
    console.log('\n  ERRORS:');
    errors.slice(0, 10).forEach(r => console.log(`    #${r.id}: ${r.error}`));
  }
  
  await conn.end();
  console.log('\nDone!');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
