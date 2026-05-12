/**
 * Streaming Chat Service for MALIKA
 * 
 * Implements Server-Sent Events (SSE) streaming for OpenAI responses.
 * Designed as customer service for BPS (Badan Pusat Statistik) data.
 */

const ChatThread = require('../../models/ChatThread.model');
const ChatMessage = require('../../models/ChatMessage.model');
const { resolveSearchIntent, buildDatasourceCandidates } = require('../search/intent.service');
const { getCache } = require('../cache/cache.service');
const ProcessedCache = require('../../models/ProcessedCache.model');
const DataPeriod = require('../../models/DataPeriod.model');
const { QueryTypes, Op } = require('sequelize');

// RAG: Vector search for knowledge documents
let vectorSearchService = null;
try {
  vectorSearchService = require('../ai/vectorSearch.service');
} catch (e) {
  console.warn('[StreamChat] Vector search service not available:', e.message);
}

// Knowledge patterns: dynamic procedural query detection
let knowledgePatternsService = null;
try {
  knowledgePatternsService = require('../ai/knowledgePatterns.service');
  // Preload patterns on startup (async, non-blocking)
  knowledgePatternsService.preloadPatterns().catch(e => {
    console.warn('[StreamChat] Knowledge patterns preload failed:', e.message);
  });
} catch (e) {
  console.warn('[StreamChat] Knowledge patterns service not available:', e.message);
}

// Error Learning: dynamic prompt fixes from identified patterns
let errorLearningService = null;
try {
  errorLearningService = require('./errorLearning.service');
} catch (e) {
  console.warn('[StreamChat] Error learning service not available:', e.message);
}

// AutoFlag: conservative heuristics for system-flagging bad chat responses
let autoFlagService = null;
try {
  autoFlagService = require('./autoFlag.service');
} catch (e) {
  console.warn('[StreamChat] autoFlag service not available:', e.message);
}

// Query Normalizer: abbreviation expansion, typo correction, geo normalization
let queryNormalizerService = null;
try {
  queryNormalizerService = require('./queryNormalizer.service');
} catch (e) {
  console.warn('[StreamChat] Query normalizer service not available:', e.message);
}

// Year Inference: resolve relative year references ("tahun lalu", "tahun ini", etc.)
let yearInferenceService = null;
try {
  yearInferenceService = require('./yearInference.service');
} catch (e) {
  console.warn('[StreamChat] Year inference service not available:', e.message);
}

// Geo Inference: detect and filter by kabupaten/kota references
let geoInferenceService = null;
try {
  geoInferenceService = require('./geoInference.service');
} catch (e) {
  console.warn('[StreamChat] Geo inference service not available:', e.message);
}

// Fast-Path: quick intent resolution for common queries
let queryFastPathService = null;
try {
  queryFastPathService = require('./queryFastPath.service');
} catch (e) {
  console.warn('[StreamChat] Query fast-path service not available:', e.message);
}

// Response Formatter: structured templates, length optimization, confidence scoring
let responseFormatterService = null;
try {
  responseFormatterService = require('./responseFormatter.service');
} catch (e) {
  console.warn('[StreamChat] Response formatter service not available:', e.message);
}

// ============================================================================
// PROXY-ROUTED LLM CLIENT
// All chat LLM calls go through the local malika-llm-proxy (:3031) via the
// shared openaiClient.chat() helper. Tier-based model selection via modelForTier.
// ============================================================================
const { chat: llmChat } = require('./streaming/openaiClient');
const { modelForTier, MODEL_TIERS } = require('./streaming/modelRouter.service');

/**
 * Read a chat-completions response from the proxy, tolerant of both SSE
 * streaming (`data: {...}` lines with `delta.content`) and plain JSON
 * (`{choices:[{message:{content}}]}`) shapes. The running malika-llm-proxy
 * returns plain JSON when the chosen tier is the claude-cli subprocess, so
 * we can't assume real streaming even when we asked for `stream: true`.
 *
 * `onChunk(text)` is called for every piece of assistant content found.
 * Returns the concatenated text.
 */
async function readLlmChatResponse(response, onChunk) {
  const bodyText = await response.text();
  let fullText = '';

  const looksLikeSse = /(^|\n)\s*data:\s/.test(bodyText);
  if (looksLikeSse) {
    for (const line of bodyText.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const jsonStr = trimmed.replace(/^data:\s*/, '');
      if (jsonStr === '[DONE]') break;
      try {
        const json = JSON.parse(jsonStr);
        const delta = json.choices?.[0]?.delta?.content
                   || json.choices?.[0]?.message?.content;
        if (delta) {
          fullText += delta;
          onChunk(delta);
        }
      } catch {
        // Ignore malformed chunks
      }
    }
  } else {
    try {
      const json = JSON.parse(bodyText);
      const content = json.choices?.[0]?.message?.content
                   || json.choices?.[0]?.delta?.content
                   || '';
      if (content) {
        fullText = content;
        onChunk(content);
      }
    } catch (e) {
      console.warn('[StreamChat] Could not parse LLM response:', e.message, 'body sample:', bodyText.slice(0, 200));
    }
  }

  return fullText;
}

// ============================================================================
// EXIM QUERY INTENT DETECTION
// Mirrors logic from frontend/src/lib/eximQueryIntent.ts for consistency
// ============================================================================

/**
 * Infer EXIM grouping intent from query (e.g., "ekspor menurut komoditas" -> "hs2")
 * @param {string} q - User query
 * @returns {'hs2' | 'pod' | 'ctr' | 'detail' | 'hs2ctr' | 'hs2pod' | ''}
 */
function inferEximGroupFromQuery(q) {
  const raw = String(q || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!raw) return '';

  const hasMenurut = /\b(menurut|berdasarkan|berdasar|per)\b/i.test(raw) || /\bby\b/i.test(raw);

  const mentionsPod = /\b(pelabuhan|port|pod)\b/i.test(raw);
  const mentionsCtr =
    /\b(negara|country|ctr)\b/i.test(raw) ||
    /\bnegara\s*(asal|tujuan)\b/i.test(raw) ||
    /\b(asal|tujuan)\b/i.test(raw);
  const mentionsHs = /\b(komoditas|barang|hs2|hs\s*code|kode\s*hs|kodehs|\bhs\b)\b/i.test(raw);

  const hasDan = /(\bdan\b|&)/i.test(raw);

  const wantsPodSolo =
    /\b(menurut|berdasarkan|berdasar|per)\s+(pelabuhan|port|pod)\b/i.test(raw) ||
    /\bby\s+(pelabuhan|port|pod)\b/i.test(raw);
  const wantsCtrSolo =
    /\b(menurut|berdasarkan|berdasar|per)\s+(negara|country|ctr)\b/i.test(raw) ||
    /\bby\s+(negara|country|ctr)\b/i.test(raw) ||
    /\b(menurut|berdasarkan|berdasar|per)\s+negara\s*(asal|tujuan)\b/i.test(raw);
  const wantsHsSolo =
    /\b(menurut|berdasarkan|berdasar|per)\s+(komoditas|barang|hs2|hs)\b/i.test(raw) ||
    /\bby\s+(komoditas|barang|hs2|hs)\b/i.test(raw);

  // Handle "<A> dan <B>" multi-dimension intent
  if ((hasMenurut || hasDan) && mentionsHs && mentionsCtr && !mentionsPod) return 'hs2ctr';
  if ((hasMenurut || hasDan) && mentionsHs && mentionsPod && !mentionsCtr) return 'hs2pod';
  if ((hasMenurut || hasDan) && mentionsCtr && mentionsPod && !mentionsHs) return 'detail';

  // Fallback: direct single-target phrases
  if (wantsPodSolo) return 'pod';
  if (wantsCtrSolo) return 'ctr';
  if (wantsHsSolo) return 'hs2';
  
  // Additional patterns for questions like "komoditas apa yang terbanyak"
  if (/\b(komoditas|barang|hs)\s*(apa|mana|terbesar|terbanyak|tertinggi|terendah)/i.test(raw)) return 'hs2';
  if (/\b(negara|country)\s*(apa|mana|terbesar|terbanyak|tertinggi|terendah)/i.test(raw)) return 'ctr';
  if (/\b(pelabuhan|port)\s*(apa|mana|terbesar|terbanyak|tertinggi|terendah)/i.test(raw)) return 'pod';
  
  // "ke negara mana", "dari negara mana", "negara tujuan/asal" patterns
  if (/\b(ke|dari)\s+negara\s*(mana|apa)/i.test(raw)) return 'ctr';
  if (/\bnegara\s+(tujuan|asal)\s*(mana|apa|terbesar|terbanyak)/i.test(raw)) return 'ctr';
  if (/\b(tujuan|asal)\s+(ekspor|impor)\s*(mana|apa|terbesar|terbanyak)/i.test(raw)) return 'ctr';
  // "ekspor ke mana", "impor dari mana" patterns
  if (/\b(ekspor)\s+(ke|kemana|tujuan)\s*(mana|apa)?/i.test(raw)) return 'ctr';
  if (/\b(impor)\s+(dari|darimana|asal)\s*(mana|apa)?/i.test(raw)) return 'ctr';
  
  // "terbanyak/terbesar untuk ekspor/impor" patterns
  if (/\bterbanyak\b.*\b(ekspor|impor)\b/i.test(raw) || /\b(ekspor|impor)\b.*\bterbanyak\b/i.test(raw)) {
    // Determine what dimension user wants - check ctr FIRST for country-related queries
    if (mentionsCtr) return 'ctr';
    if (mentionsHs) return 'hs2';
    if (mentionsPod) return 'pod';
    // Default to komoditas if asking about "terbanyak" without dimension
    return 'hs2';
  }
  
  // "negara terbanyak", "negara tertinggi" without apa/mana
  if (/\bnegara\b.*\b(terbanyak|terbesar|tertinggi|terendah)\b/i.test(raw)) return 'ctr';
  if (/\b(terbanyak|terbesar|tertinggi|terendah)\b.*\bnegara\b/i.test(raw)) return 'ctr';
  
  return '';
}

/**
 * Extract EXIM facets from query (country, port, HS code)
 * @param {string} q - User query
 * @returns {{ ctr?: string; pod?: string; code_hs?: string }}
 */
function extractEximQueryFacets(q) {
  const raw = String(q || '').toLowerCase();
  if (!raw) return {};

  const monthNames = new Set([
    'januari', 'jan', 'februari', 'feb', 'maret', 'mar', 'april', 'apr',
    'mei', 'juni', 'jun', 'juli', 'jul', 'agustus', 'agu', 'ags',
    'september', 'sep', 'oktober', 'okt', 'november', 'nov', 'desember', 'des',
  ]);
  const stop = new Set([
    'negara', 'pelabuhan', 'komoditas', 'hs', 'hs2', 'kode', 'kodehs',
    'nilai', 'volume', 'berat', 'kg', 'usd', 'us$', 'bulan', 'tahun',
    'dan', 'sampai', 'sd', 's/d', 'hingga', 'to', 'menurut', 'berdasarkan',
    'per', 'ekspor', 'impor', 'apa', 'mana', 'yang', 'terbanyak', 'terbesar',
  ]);

  const tokens = raw.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/g).filter(Boolean);

  const takeAfter = (key) => {
    const idx = tokens.indexOf(key);
    if (idx < 0) return '';
    const out = [];
    for (let i = idx + 1; i < tokens.length; i++) {
      const t = tokens[i];
      if (!t) break;
      if (stop.has(t)) break;
      if (monthNames.has(t)) break;
      if (/^(19\d{2}|20\d{2}|2100)$/.test(t)) break;
      out.push(t);
      if (out.length >= 3) break;
    }
    return out.join(' ').trim();
  };

  const ctr = takeAfter('negara');
  const pod = takeAfter('pelabuhan');

  let code_hs;
  const hsMatch = raw.match(/\bhs\s*([0-9]{2,6})\b/i);
  if (hsMatch && hsMatch[1]) {
    const d = hsMatch[1].replace(/\D/g, '');
    if (d.length >= 2) code_hs = d.slice(0, 2);
  }

  const res = {};
  if (ctr) res.ctr = ctr;
  if (pod) res.pod = pod;
  if (code_hs) res.code_hs = code_hs;
  return res;
}

/**
 * Detect if query is about ekspor or impor
 * @param {string} q - User query
 * @returns {'ekspor' | 'impor' | null}
 */
function detectEximModeFromQuery(q) {
  const raw = String(q || '').toLowerCase();
  if (!raw) return null;
  if (raw.includes('impor')) return 'impor';
  if (raw.includes('ekspor')) return 'ekspor';
  return null;
}

/**
 * Extract month from query for EXIM filtering
 * @param {string} q - User query
 * @returns {number | null}
 */
function extractEximMonth(q) {
  const raw = String(q || '').toLowerCase();
  const monthMap = {
    januari: 1, jan: 1, februari: 2, feb: 2, maret: 3, mar: 3,
    april: 4, apr: 4, mei: 5, juni: 6, jun: 6, juli: 7, jul: 7,
    agustus: 8, agu: 8, ags: 8, september: 9, sep: 9,
    oktober: 10, okt: 10, november: 11, nov: 11, desember: 12, des: 12,
  };
  
  for (const [name, num] of Object.entries(monthMap)) {
    if (raw.includes(name)) return num;
  }
  return null;
}

/**
 * Convert month number to Indonesian name
 * @param {number} monthNo - Month number (1-12)
 * @returns {string | null}
 */
function monthNameFromNo(monthNo) {
  const map = {
    1: 'Januari', 2: 'Februari', 3: 'Maret', 4: 'April',
    5: 'Mei', 6: 'Juni', 7: 'Juli', 8: 'Agustus',
    9: 'September', 10: 'Oktober', 11: 'November', 12: 'Desember',
  };
  return map[monthNo] || null;
}

// Helper functions from main chat.service
function now() {
  return new Date();
}

function getOpenAIKey() {
  return (
    process.env.OPENAI_API_KEY_CHAT ||
    process.env.OPENAI_API_KEY_INTERPRETATION ||
    process.env.OPENAI_API_KEY_QUERY_BUILDER ||
    ''
  );
}

function getOpenAIModel() {
  return process.env.OPENAI_MODEL_CHAT || 'gpt-4.1-mini';
}

/**
 * System prompt for MALIKA as BPS Customer Service
 * Context-aware version that adjusts based on available data
 */
function systemPrompt(context = {}) {
  const { hasDataPreview, hasCandidates, lowConfidence, periodFallback, multiSourceDisclaimer } = context;

  const base = `Kamu adalah MALIKA (Manajer Layanan Informasi dan Komunikasi Aktif), asisten virtual customer service untuk layanan data statistik BPS (Badan Pusat Statistik) Provinsi Maluku Utara.

IDENTITAS & PERAN:
- Nama: MALIKA
- Fungsi: Customer Service data BPS Maluku Utara
- Karakter: Ramah, profesional, informatif, membantu
- Bahasa: Indonesia yang sopan dan jelas

KONTEKS WAKTU:
- Hari ini: ${new Date().toISOString().slice(0, 10)} (timezone WIT/UTC+9)
- BPS umumnya merilis: data triwulanan ~2 bulan setelah triwulan berakhir; data tahunan ~Maret tahun berikutnya; data bulanan ~6 minggu setelah bulan berakhir
- Gunakan info ini untuk menilai apakah data SEHARUSNYA sudah tersedia di sistem sebelum menjawab "belum tersedia"

TUGAS UTAMA:
1. Membantu user menemukan data statistik yang tepat
2. Menjelaskan indikator statistik dengan bahasa sederhana
3. Memberikan interpretasi data yang tersedia
4. Mengarahkan ke sumber data yang relevan

BATASAN PENTING:
- HANYA gunakan data dari database/cache yang tersedia
- JANGAN mengarang angka statistik/persentase/jumlah
- Jika data tidak tersedia, katakan dengan jujur
- JANGAN menyebut URL mentah dalam jawaban
- Fokus pada data Maluku Utara

FORMAT RESPONS:
- DILARANG menggunakan simbol markdown seperti **, *, #, -, dll untuk formatting
- Gunakan plain text saja tanpa bold, italic, atau heading
- Untuk daftar/list, gunakan angka biasa (1. 2. 3.) tanpa simbol khusus
- Contoh SALAH: **Registrasi Akun**: Daftar akun...
- Contoh BENAR: Registrasi Akun: Daftar akun...

PENTING - DATA KOSONG/NON:
- Jika ada nilai 0, null, atau "-" di tabel, JANGAN langsung simpulkan "tidak menghasilkan" atau "tidak ada"
- Nilai kosong bisa berarti: (1) memang nol, (2) data belum dikumpulkan, atau (3) belum dilaporkan
- Gunakan frasa netral: "tercatat 0" atau "tidak ada data tercatat" 
- WAJIB sarankan: "Untuk konfirmasi lebih lanjut, silakan hubungi BPS Maluku Utara via WhatsApp di [+62 851-7676-4422](https://wa.me/6285176764422)"

CARA MENJAWAB:
- Singkat dan to the point (max 3-4 kalimat untuk respons umum)
- Jika ada tabel data, berikan interpretasi singkat
- Selalu tawarkan bantuan lanjutan
- Gunakan format yang mudah dibaca

OPTIMASI PANJANG RESPONS:
- Pertanyaan sederhana (greeting, ya/tidak): max 2-3 kalimat
- Pertanyaan data spesifik: max 5-6 kalimat dengan angka
- Pertanyaan penjelasan/FAQ: max 8-10 kalimat
- HINDARI pengulangan informasi yang sudah ada di tabel
- Jangan berlebihan menyarankan WhatsApp kecuali untuk layanan/permohonan

STRUKTUR RESPONS DATA:
1. Jawab langsung pertanyaan (sebutkan angka utama)
2. Berikan konteks singkat (perbandingan/trend jika ada)
3. Sumber data (nama indikator)
4. Tawarkan bantuan lanjutan (1 kalimat)`;

  // Context-specific additions
  const contextRules = [];
  if (hasDataPreview) {
    let previewRule = `KONTEKS: Tabel data SUDAH tersedia. 
WAJIB:
- Sebutkan ANGKA SPESIFIK dari data (contoh: "TPT Kepulauan Sula adalah 2.67%")
- Berikan interpretasi berdasarkan angka tersebut
- Bandingkan dengan rata-rata provinsi jika ada
- JANGAN bilang "relatif tinggi/rendah" tanpa menyebut angkanya`;
    
    if (periodFallback) {
      previewRule += `

PERIODE FALLBACK (data ada tapi bukan tahun yang diminta):
- User minta tahun ${periodFallback.requestedYear}; yang tersedia adalah tahun ${periodFallback.actualYear} (${periodFallback.direction})
- JANGAN buka jawaban dengan "belum tersedia". Buka dengan angkanya.
- Format yang diharapkan: "Berikut data tahun ${periodFallback.actualYear} (tahun ${periodFallback.requestedYear} belum dirilis): [angka spesifik]"
- Setelah menyebut angka, satu kalimat singkat tentang relevansi periode fallback boleh ditambahkan.`;
    }
    
    if (multiSourceDisclaimer) {
      previewRule += `

PENTING - DATA DARI SUMBER BERBEDA:
- Data provinsi/pembanding diambil dari sumber data yang BERBEDA dengan data kabupaten/kota
- Sumber pembanding: ${multiSourceDisclaimer.alternativeSourceName}
- WAJIB sampaikan disclaimer: "Catatan: Angka perbandingan provinsi diambil dari sumber berbeda (${multiSourceDisclaimer.alternativeSourceName}), sehingga mungkin terdapat perbedaan metodologi pengukuran."
- WAJIB sarankan: "Untuk memastikan validitas perbandingan, silakan hubungi BPS Maluku Utara via WhatsApp di [+62 851-7676-4422](https://wa.me/6285176764422)"`;
    }
    
    contextRules.push(previewRule);
  } else if (hasCandidates) {
    // Has candidates but no preview - data sources exist but not yet loaded/cached
    contextRules.push(`KONTEKS: Indikator/datasource DITEMUKAN tapi tabel data belum dimuat (butuh diklik untuk lihat detailnya).
WAJIB:
- Sebutkan nama indikator yang ditemukan dari daftar kandidat
- JANGAN bilang "data tidak tersedia" atau "belum tersedia" - karena ada datasource yang cocok
- Tawarkan user untuk melihat data dari indikator yang ditemukan
- JANGAN menyebut angka apapun karena data belum dimuat
- Contoh: "Saya menemukan indikator [nama] yang mungkin sesuai. Apakah Anda ingin melihat datanya?"`);
  } else {
    contextRules.push('KONTEKS: TIDAK ada indikator yang cocok ditemukan. Bantu user klarifikasi indikator apa, periode, dan wilayah yang dibutuhkan. DILARANG menyebut angka apapun.');
  }
  
  if (lowConfidence) {
    contextRules.push(`PERHATIAN - KECOCOKAN RENDAH:
- Tabel yang ditampilkan MUNGKIN TIDAK sesuai dengan pertanyaan user
- JANGAN langsung menggunakan data dari tabel jika tidak relevan
- Prioritaskan MENJAWAB pertanyaan user, bukan menjelaskan tabel yang muncul
- Jika tabel tidak relevan, katakan: "Saya belum menemukan data yang tepat untuk pertanyaan Anda. Bisa jelaskan lebih spesifik indikator yang dimaksud?"
- Sarankan user untuk memperjelas: nama indikator, tahun/periode, dan wilayah (kab/kota atau provinsi)`);
  }

  // Add dynamic fixes from error patterns (learned from flagged messages)
  if (context.promptFixes && Array.isArray(context.promptFixes) && context.promptFixes.length > 0) {
    contextRules.push(`KOREKSI PENTING (dari pembelajaran kesalahan sebelumnya):\n${context.promptFixes.join('\n')}`);
  }

  return contextRules.length > 0 
    ? `${base}\n\n${contextRules.join('\n')}`
    : base;
}

/**
 * Strip markdown formatting symbols from text
 * Removes **, *, _, #, etc. but keeps the content
 */
function stripMarkdownFormatting(text) {
  if (!text) return '';
  return String(text)
    // Remove bold/italic markers
    .replace(/\*\*([^*]+)\*\*/g, '$1')  // **bold**
    .replace(/\*([^*]+)\*/g, '$1')       // *italic*
    .replace(/__([^_]+)__/g, '$1')       // __bold__
    .replace(/_([^_]+)_/g, '$1')         // _italic_
    // Remove heading markers
    .replace(/^#{1,6}\s+/gm, '')         // # heading
    // Remove code markers
    .replace(/`([^`]+)`/g, '$1')         // `code`
    .replace(/```[\s\S]*?```/g, '')      // ```code block```
    // Remove link markers but keep text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // [text](url)
    // Remove list markers
    .replace(/^[\s]*[-*+]\s+/gm, '')     // - item, * item
    // Clean up extra whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Convert WhatsApp phone numbers to clickable wa.me links
 * Pattern: +62 851-7676-4422 or similar formats
 * @param {string} text - The text to process
 * @param {object} context - Optional context for pre-filled message
 * @param {number} context.threadId - Chat thread ID
 * @param {string} context.userMessage - Last user message
 * @param {string} context.aiResponse - AI response excerpt
 */
function linkifyWhatsAppNumber(text, context = null) {
  if (!text) return '';
  // Match patterns like: +62 851-7676-4422, +62851-7676-4422, +62 8517676442, etc.
  // Handles variations: "WhatsApp di", "WhatsApp di nomor", "via WhatsApp", etc.
  return String(text).replace(
    /(WhatsApp\s+di\s+(?:nomor\s+)?|via\s+WhatsApp\s+(?:di\s+)?(?:nomor\s+)?)(\+62[\s-]?\d{3}[\s-]?\d{4}[\s-]?\d{4})/gi,
    (match, prefix, phone) => {
      // Clean phone number for wa.me URL (remove spaces and dashes, keep +)
      const cleanPhone = phone.replace(/[\s-]/g, '').replace(/^\+/, '');
      
      // Build pre-filled message with context if available
      let waUrl = `https://wa.me/${cleanPhone}`;
      if (context && context.threadId) {
        const parts = [];
        parts.push(`[Lanjutan dari MALIKA Chat #${context.threadId}]`);
        if (context.userMessage) {
          const userExcerpt = String(context.userMessage).slice(0, 100).trim();
          parts.push(`\nPertanyaan saya: ${userExcerpt}${context.userMessage.length > 100 ? '...' : ''}`);
        }
        if (context.aiResponse) {
          const aiExcerpt = String(context.aiResponse).slice(0, 150).trim();
          parts.push(`\nJawaban MALIKA: ${aiExcerpt}${context.aiResponse.length > 150 ? '...' : ''}`);
        }
        parts.push('\n\nSaya ingin menanyakan lebih lanjut tentang hal ini.');
        const prefillText = encodeURIComponent(parts.join(''));
        waUrl = `https://wa.me/${cleanPhone}?text=${prefillText}`;
      }
      return `${prefix}[${phone}](${waUrl})`;
    }
  );
}

/**
 * Strip malika_ui block from message content
 */
function stripMalikaUiBlock(raw) {
  return String(raw || '').replace(/```\s*malika_ui[\s\S]*?```/gi, '').trim();
}

/**
 * Check if message is a greeting (not a data query)
 * e.g. "halo", "selamat pagi", "hi", "assalamualaikum"
 */
function isGreeting(raw) {
  const t = String(raw || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  
  // Direct greeting patterns
  const greetingPatterns = [
    /^(hai|halo|hello|hi|hey|hei|hy)$/i,
    /^(selamat\s+(pagi|siang|sore|malam|datang))$/i,
    /^(assalamualaikum|assalamu.?alaikum)(\s+w\.?r\.?w\.?b\.?)?$/i,
    /^(salam|salamat|permisi)$/i,
    /^(good\s+(morning|afternoon|evening|night))$/i,
    /^(apa\s+kabar|gimana\s+kabar)(\??)?$/i,
    /^(makasih|terima\s*kasih|thanks?|thank\s*you)$/i,
  ];
  
  for (const pattern of greetingPatterns) {
    if (pattern.test(t)) return true;
  }
  
  return false;
}

/**
 * Build contextual suggestion chips for greeting response
 * - For new chat: suggest popular data topics
 * - For existing conversation: suggest follow-up based on previous topic
 */
function buildGreetingSuggestions(historyArray, conversationTopic) {
  // Only emit contextual suggestions. When there's no conversationTopic the
  // chips stay empty so the UI shows its loading skeleton until the
  // /chat/threads/:id/suggestions endpoint returns real LLM-generated chips.
  if (conversationTopic) {
    return [
      `Lanjutkan tentang ${conversationTopic}`,
      `Data ${conversationTopic} terbaru`,
      `${conversationTopic} menurut kabupaten/kota`,
    ];
  }
  return [];
}

/**
 * Build contextual suggestion chips based on current data context
 * Predicts what user might want to ask next
 */
function buildContextualSuggestions({ 
  conversationTopic, 
  currentSourceName, 
  requestedYear, 
  requestedGeo,
  candidates,
  hasDataPreview,
  isKnowledgeMode = false,
}) {
  const suggestions = [];
  
  // KNOWLEDGE MODE: Suggest relevant follow-ups for service/knowledge queries
  if (isKnowledgeMode) {
    const topic = conversationTopic?.toLowerCase() || '';
    
    if (topic.includes('sensus')) {
      suggestions.push('Siapa yang menjadi responden?');
      suggestions.push('Bagaimana cara mengisi sensus?');
      suggestions.push('Apa manfaat sensus?');
    } else if (topic.includes('layanan') || topic.includes('pst')) {
      suggestions.push('Jam operasional PST?');
      suggestions.push('Cara mengakses layanan?');
      suggestions.push('Kontak BPS Malut');
    } else if (topic.includes('nol rupiah')) {
      suggestions.push('Persyaratan layanan?');
      suggestions.push('Cara mengajukan?');
      suggestions.push('Berapa lama prosesnya?');
    } else if (topic.includes('rekomendasi')) {
      suggestions.push('Syarat pengajuan?');
      suggestions.push('Format surat permohonan?');
      suggestions.push('Kontak BPS Malut');
    }
    // No topic match → return [] (UI keeps loading state until LLM endpoint
    // returns real suggestions)
    return suggestions.slice(0, 3);
  }
  
  // DATA MODE: suggest analysis/comparison
  if (hasDataPreview) {
    if (!requestedGeo) {
      suggestions.push('Data untuk kabupaten mana?');
    }
    if (currentSourceName) {
      suggestions.push('Bandingkan dengan kabupaten lain');
    }
    if (requestedYear) {
      const prevYear = parseInt(requestedYear) - 1;
      suggestions.push(`Bandingkan dengan tahun ${prevYear}`);
    }
    suggestions.push('Kabupaten mana tertinggi?');
    suggestions.push('Kabupaten mana terendah?');
  } else if (candidates && candidates.length > 0) {
    // No preview yet, suggest period/geo clarification
    suggestions.push('Tahun berapa?');
    suggestions.push('Data terbaru');
    if (conversationTopic) {
      suggestions.push(`${conversationTopic} menurut kabupaten/kota`);
    }
  }
  // No candidates and no preview → return [] (UI keeps loading state until
  // /chat/threads/:id/suggestions endpoint returns real LLM-generated chips)

  return suggestions.slice(0, 5);
}

/**
 * Stream greeting response without data search
 */
async function streamGreetingResponse({
  res,
  sendEvent,
  threadId,
  userMessage,
  model,
  apiKey,
  suggestions,
  historyArray,
  modelOverride,
  abortSignal,
}) {
  const ChatMessage = require('../../models/ChatMessage.model');
  const ChatThread = require('../../models/ChatThread.model');

  // Build simple greeting context for LLM
  const messages = [
    { role: 'system', content: `Kamu adalah MALIKA, asisten virtual customer service BPS Maluku Utara. Balas greeting user dengan ramah dan singkat. Tawarkan bantuan untuk mencari data statistik. JANGAN tampilkan tabel atau data apapun untuk greeting.` },
    { role: 'user', content: userMessage },
  ];

  // Stream response from proxy (tier: GREETING) with retry
  let fullText = '';
  try {
    const tier = MODEL_TIERS.GREETING;
    const effectiveModel = modelOverride || modelForTier(tier);
    const response = await llmChat({
      model: effectiveModel,
      messages,
      stream: true,
      max_tokens: 150,
      temperature: 0.7,
      signal: abortSignal,
      apiKey,
      retries: 2,
      timeoutMs: 15000,
      extraHeaders: threadId ? { 'X-Chat-Session-Id': String(threadId) } : undefined,
    }); // 2 retries, 15s timeout for greeting
    
    fullText = await readLlmChatResponse(response, (delta) => {
      sendEvent('chunk', { text: delta });
    });
  } catch (error) {
    console.error('[StreamGreeting] All retries failed:', error.message);
    fullText = 'Halo! Ada yang bisa saya bantu terkait data statistik BPS Maluku Utara?';
    sendEvent('chunk', { text: fullText });
  }
  
  // Build UI metadata WITHOUT table/candidates
  const uiMeta = {
    v: 1,
    query: userMessage,
    preview_mode: 'none',
    candidates: [],
    period_fallback: null,
    table: null,
    suggestions: suggestions,
  };
  
  // Emit malika_ui event for frontend
  sendEvent('malika_ui', uiMeta);
  
  // Then emit done event
  sendEvent('done', { fullText });
  
  const uiBlock = `\n\n\`\`\`malika_ui\n${JSON.stringify(uiMeta)}\n\`\`\``;
  // Strip any existing malika_ui blocks from LLM output before adding our own.
  // Cap the LLM interpretation; let uiBlock pass through intact so chat-history
  // replay can parse the fenced JSON. DB column is longtext.
  const cleanedText = stripMalikaUiBlock(fullText).trim().slice(0, 8000);
  const assistantContent = `${cleanedText}${uiBlock}`;

  // Save assistant message
  await ChatMessage.create({
    thread_id: threadId,
    role: 'assistant',
    content: assistantContent,
    model: model || null,
    created_at: now(),
  });
  
  // Update thread timestamp
  const thread = await ChatThread.findByPk(threadId);
  if (thread) {
    await thread.update({
      last_message_at: now(),
      updated_at: now(),
    });
  }
}

/**
 * Check if message is a confirmation (e.g. "ya", "ok", "tampilkan datanya")
 */
function isConfirmMessage(raw) {
  const t = String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return (
    /^(ya|iya|y|ok|oke|sip|lanjut|gas|boleh)$/i.test(t) ||
    /^ya\s*,?\s*(tampilkan|lanjut|tolong|coba|boleh)$/i.test(t) ||
    /^(ya\s+)?boleh$/i.test(t) ||
    /\b(tampilkan\s+datanya|tampilkan\s+preview|tampilkan\s+data)\b/i.test(t)
  );
}

/**
 * Check if previous conversation was a knowledge-type query (not data)
 * Returns true if the previous UI meta has no table/candidates (knowledge mode)
 */
function isPrevContextKnowledgeMode(prevUiMeta, historyArray) {
  if (!prevUiMeta) return false;
  
  // If previous response has no table and no candidates, it was likely knowledge mode
  const hasTable = prevUiMeta.table && prevUiMeta.table.rows && prevUiMeta.table.rows.length > 0;
  const hasCandidates = Array.isArray(prevUiMeta.candidates) && prevUiMeta.candidates.length > 0;
  
  // If preview_mode is 'none' and no table/candidates, this was knowledge/service query
  if (prevUiMeta.preview_mode === 'none' && !hasTable && !hasCandidates) {
    return true;
  }
  
  // Also check the previous query for knowledge patterns
  // Find the previous user message
  const prevUserMsg = historyArray?.filter(m => m.role === 'user').slice(-2, -1)[0];
  if (prevUserMsg) {
    const prevQuery = String(prevUserMsg.content || '').toLowerCase();
    const knowledgePatterns = [
      /\b(layanan|pelayanan|prosedur|tata\s*cara)\b/,
      /\b(sensus|survei|sakernas|susenas)\b/,
      /\b(cara\s+(mendapat|mengajukan|memperoleh))\b/,
      /\b(nol\s*rupiah|rekomendasi\s+statistik)\b/,
      /\b(pusdatin|pst|perpustakaan|konsultasi)\b/,
      /\b(apa\s+(itu|saja)|kapan|bagaimana)\b/,
    ];
    if (knowledgePatterns.some(p => p.test(prevQuery))) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if message is a time/period fragment (e.g. "tahun 2025", "2 tahun terakhir")
 * Also catches geo-only fragments and short follow-up queries
 */
function isLikelyTimeOrPeriodFragment(raw) {
  const t = String(raw || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return false;

  const tokens = t.split(' ').filter(Boolean);
  if (tokens.length > 10) return false;

  const allowed = new Set([
    'untuk', 'periode', 'rentang', 'dari', 'sampai', 'sd', 's/d', 'di', 'ada', 'yang', 'berapa',
    'tahun', 'thn', 'bulan', 'terakhir', 'ini', 'lalu', 'kemarin', 'tersedia', 'saja', 'aja',
    'ya', 'iya', 'oke', 'ok', 'tampilkan', 'tampil', 'lanjut', 'boleh', // Follow-up confirmations
    'januari', 'jan', 'februari', 'feb', 'maret', 'mar', 'april', 'apr',
    'mei', 'juni', 'jun', 'juli', 'jul', 'agustus', 'agu', 'ags',
    'september', 'sep', 'oktober', 'okt', 'november', 'nov', 'desember', 'des',
    'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh',
    'beberapa', 'sejumlah', 'spesifik', 'khusus', 'data',
    // Geo fragments
    'kabupaten', 'kab', 'kota', 'kepsul', 'kepulauan', 'sula', 'halsel', 'halmahera',
    'selatan', 'utara', 'barat', 'timur', 'tengah', 'ternate', 'tidore', 'morotai',
    'taliabu', 'pulau', 'provinsi', 'maluku',
  ]);

  let hasSignal = false;
  for (const tok of tokens) {
    if (/^(19\d{2}|20\d{2}|2100)$/.test(tok)) {
      hasSignal = true;
      continue;
    }
    if (/^(0?[1-9]|1[0-2])$/.test(tok)) continue;
    if (allowed.has(tok)) {
      if (['tahun', 'thn', 'bulan', 'terakhir', 'kabupaten', 'kab', 'kota', 'kepulauan', 'sula', 'kepsul', 
           'halmahera', 'ternate', 'tidore', 'morotai', 'taliabu', 'spesifik', 'khusus'].includes(tok)) {
        hasSignal = true;
      }
      continue;
    }
    return false;
  }

  return hasSignal;
}

/**
 * Check if message is a geo-only fragment (e.g. "kabupaten morotai", "ternate", "halmahera selatan")
 * Also handles variants like "pulau morotai ada?", "morotai gimana?", "di ternate"
 * This is more specific than isLikelyTimeOrPeriodFragment - it ONLY matches geographic references
 * without any substantive topic keywords
 */
function isLikelyGeoOnlyFragment(raw) {
  if (!raw) return false;
  let t = String(raw).toLowerCase().trim();
  if (!t || t.length < 3) return false;
  
  // Strip common filler words/patterns that don't change the geo intent
  // e.g. "pulau morotai ada?" → "pulau morotai"
  const fillerPatterns = [
    /\s*(ada|tidak|gimana|bagaimana|dong|deh|nih|sih|ya|yah|juga|saja|aja)\s*\?*$/i,
    /^\s*(di|untuk|pada|ke|dari)\s+/i,
    /\s*\?+$/,
  ];
  for (const pattern of fillerPatterns) {
    t = t.replace(pattern, '').trim();
  }
  
  if (!t || t.length < 3) return false;
  
  // Known Maluku Utara kab/kota names and aliases
  const knownGeo = new Set([
    'morotai', 'pulau morotai',
    'ternate', 'kota ternate',
    'tidore', 'tidore kepulauan', 'kota tidore', 'kota tidore kepulauan', 'tikep',
    'halmahera barat', 'halbar',
    'halmahera utara', 'halut',
    'halmahera timur', 'haltim',
    'halmahera selatan', 'halsel',
    'halmahera tengah', 'halteng',
    'kepulauan sula', 'kepsul', 'sula',
    'taliabu', 'pulau taliabu'
  ]);
  
  // Allow optional 'kabupaten', 'kab', 'kota' prefix
  const stripped = t.replace(/^(kabupaten|kab\.?|kota)\s+/i, '').trim();
  
  // Check exact match
  if (knownGeo.has(stripped)) return true;
  if (knownGeo.has(t)) return true;
  
  // "kabupaten X" pattern with known geo
  if (/^(kabupaten|kab\.?|kota)\s+/i.test(t) && stripped.length > 0) {
    return knownGeo.has(stripped);
  }
  
  return false;
}

/**
 * Filter out stopwords and filler words from query before merging
 * This prevents words like "tampilkan", "yang ada", "bagaimana" from affecting search scoring
 */
function filterQueryFillers(query) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return '';
  
  // Filler/stopword patterns to remove (order matters - longer patterns first)
  const fillerPatterns = [
    /\byang tersedia\b/gi,
    /\byang ada\b/gi,
    /\bada apa\b/gi,
    /\bapa saja\b/gi,
    /\bberapa saja\b/gi,
    /\bseperti apa\b/gi,
    /\bbagaimana dengan\b/gi,
    /\bapakah ada\b/gi,
    /\bapakah tersedia\b/gi,
    /\btolong tampilkan\b/gi,
    /\bcoba tampilkan\b/gi,
    /\bmohon tampilkan\b/gi,
    /\bsilakan tampilkan\b/gi,
    /\bkalo\s+dalam\b/gi,
    /\bkalau\s+dalam\b/gi,
  ];
  
  // Single filler words to remove
  const fillerWords = new Set([
    'tampilkan', 'tampil', 'tunjukkan', 'lihat', 'lihatkan', 'kasih', 'berikan',
    'tolong', 'coba', 'mohon', 'silakan', 'please',
    'bagaimana', 'gimana', 'apakah', 'apa', 'berapa',
    'ya', 'iya', 'yaa', 'iyaa', 'ok', 'oke', 'okay', 'sip',
    'dong', 'deh', 'nih', 'sih', 'kan', 'lah', 'kah',
    'yang', 'ada', 'tersedia', 'punya',
    'bisa', 'dapat', 'boleh', 'mau',
    'saya', 'aku', 'kita', 'kami',
    'itu', 'ini', 'nya',
  ]);
  
  let result = q;
  
  // Remove multi-word fillers first
  for (const pattern of fillerPatterns) {
    result = result.replace(pattern, ' ');
  }
  
  // Remove single filler words (but preserve meaningful words)
  const tokens = result.split(/\s+/).filter(Boolean);
  const filteredTokens = tokens.filter(token => {
    const t = token.toLowerCase().replace(/[?!.,;:]+$/, '');
    // Keep if not a filler word
    return !fillerWords.has(t);
  });
  
  result = filteredTokens.join(' ').replace(/\s+/g, ' ').trim();
  
  // If everything was filtered, return original (minus obvious fillers)
  if (!result || result.length < 2) {
    return q.replace(/\?+$/, '').trim();
  }
  
  return result;
}

/**
 * Check if message is a comparison/follow-up request that should keep context
 * e.g. "bandingkan dengan kabupaten lain", "bagaimana dengan wilayah lain"
 */
function isComparisonFollowUp(query) {
  const q = String(query || '').toLowerCase().trim();
  // Patterns for comparison requests that should keep conversation topic
  const patterns = [
    /^bandingkan\s+(dengan|sama)/i,
    /\bbandingkan\s+(dengan|sama)\s+(angka|data|kabupaten|kota|wilayah|daerah|provinsi)/i,
    /\bbagaimana\s+(dengan|di)\s+(kabupaten|kota|wilayah|daerah|provinsi)/i,
    /\b(kabupaten|kota|wilayah|daerah|provinsi)\s+(lain|lainnya)/i,
    /^(apa|berapa)\s+(saja\s+)?(angka|data)\s+(di\s+)?(kabupaten|kota|provinsi)/i,
    /^tampilkan\s+(semua|seluruh|per)\s+(kabupaten|kota|wilayah|provinsi)/i,
    /\bperbandingan\s+(dengan|antar)\s+(kabupaten|kota|wilayah|provinsi)/i,
    /\bbandingkan\s+dengan\s+provinsi/i,
  ];
  return patterns.some(p => p.test(q));
}

/**
 * Check if message is asking to break context and search from alternative sources
 * e.g. "ya dari survei lainnya", "coba sumber lain", "dari data lain"
 * This indicates user wants to search the SAME topic but from DIFFERENT datasources
 */
function isAlternativeSourceRequest(query) {
  const q = String(query || '').toLowerCase().trim();
  const patterns = [
    /^ya\s+(dari|coba)\s+(survei|sumber|data)\s*(lain|lainnya)/i,
    /\b(dari|coba)\s+(survei|sumber|data)\s*(lain|lainnya)/i,
    /\b(survei|sumber|data)\s*(yang\s+)?(lain|lainnya)/i,
    /^cari\s+(dari|di)\s+(survei|sumber)\s*(lain|lainnya)/i,
    /^(bukan\s+)?(sensus|survei)\s*(ekonomi|pertanian|penduduk)?\s*[,.]?\s*(dari|coba|pakai)\s+(yang\s+)?(lain|lainnya)/i,
  ];
  return patterns.some(p => p.test(q));
}

/**
 * Extract the data subject from a query (e.g. "angkatan kerja" from "kalau data angkatan kerja tahun terbaru?")
 * Used when user asks for alternative sources, to carry the subject forward without the restricting context
 */
function extractDataSubject(query) {
  const q = String(query || '').toLowerCase().trim();
  
  // Common data subject patterns
  const subjectPatterns = [
    /\b(angkatan\s*kerja)\b/i,
    /\b(tenaga\s*kerja)\b/i,
    /\b(pengangguran|tpt)\b/i,
    /\b(kemiskinan|penduduk\s*miskin)\b/i,
    /\b(inflasi)\b/i,
    /\b(penduduk|populasi|jumlah\s*penduduk)\b/i,
    /\b(pdrb|produk\s*domestik)\b/i,
    /\b(ekspor|impor)\b/i,
    /\b(ipm|indeks\s*pembangunan)\b/i,
    /\b(tpak|partisipasi\s*angkatan\s*kerja)\b/i,
    /\b(gini|ketimpangan)\b/i,
    /\b(harapan\s*hidup|ahh)\b/i,
    /\b(pertumbuhan\s*ekonomi)\b/i,
    /\b(hotel|pariwisata|wisatawan)\b/i,
    /\b(sekolah|siswa|murid|guru|pendidikan)\b/i,
    /\b(kesehatan|rumah\s*sakit|puskesmas)\b/i,
    // Commodities
    /\b(durian|mangga|pisang|jeruk|kelapa|sawit|padi|jagung|kopi|kakao|cengkeh)\b/i,
    /\b(produksi|luas\s*panen|luas\s*tanam)\b/i,
  ];
  
  for (const pattern of subjectPatterns) {
    const match = q.match(pattern);
    if (match) return match[1].trim();
  }
  
  return null;
}

/**
 * Check if message is a short follow-up that should inherit previous context
 * (e.g. "2024 ada?", "spesifik untuk kepulauan sula", "tahun berapa saja")
 */
function isShortFollowUp(raw) {
  const t = String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return false;
  
  // First check comparison follow-ups (can be longer)
  if (isComparisonFollowUp(t)) return true;
  
  // Short queries (less than 60 chars)
  if (t.length > 60) return false;
  
  const patterns = [
    /^\d{4}\s*(ada|tersedia|yang|saja)?\s*\??$/i, // "2024 ada?"
    /^(untuk|di|spesifik|khusus)\s+(untuk\s+)?(kepulauan|kepsul|halsel|halut|halmahera|ternate|tidore|morotai|taliabu)/i,
    /^tahun\s+(berapa|apa)\s*(saja|yang|ada|tersedia)?/i, // "tahun berapa saja"
    /^(ada|tersedia)\s+(data|tahun|periode)/i,
    /^(data\s+)?(tahun|periode)\s+(berapa|apa|mana)/i,
    /^ya\s+(tersedia|ada)\s+(untuk\s+)?(tahun|periode|data)/i, // "ya tersedia untuk tahun berapa"
    /^tampilkan\s*(data(nya)?)?$/i, // "tampilkan" or "tampilkan data"
  ];
  
  return patterns.some(p => p.test(t));
}

/**
 * Merge base query with a fragment (e.g. "pengangguran" + "tahun 2025 kabupaten kepsul")
 * Smart merge: 
 * - if fragment contains a year and base already has a year, replace it
 * - if fragment contains a geo and base already has a geo, replace it
 * - filter out filler words from fragment before merging
 */
function mergeQuery(base, fragment) {
  const b = String(base || '').trim();
  const f = String(fragment || '').trim();
  if (!b) return f;
  if (!f) return b;
  
  // Filter filler words from fragment before merging
  const fFiltered = filterQueryFillers(f);
  
  const bNorm = b.toLowerCase();
  const fNorm = fFiltered.toLowerCase();
  if (bNorm.includes(fNorm) && fNorm.length > 2) return b;
  
  // Geo patterns for replacement
  const geoPatterns = [
    /\b(kepsul|kepulauan\s*sula)\b/gi,
    /\b(halsel|halmahera\s*selatan)\b/gi,
    /\b(halut|halmahera\s*utara)\b/gi,
    /\b(halbar|halmahera\s*barat)\b/gi,
    /\b(haltim|halmahera\s*timur)\b/gi,
    /\b(halteng|halmahera\s*tengah)\b/gi,
    /\b(tikep|tidore\s*kepulauan|kota\s*tidore)\b/gi,
    /\b(ternate|kota\s*ternate)\b/gi,
    /\b(morotai|pulau\s*morotai)\b/gi,
    /\b(taliabu|pulau\s*taliabu)\b/gi,
  ];
  
  // Check if filtered fragment has a geo
  let fragGeo = null;
  for (const pattern of geoPatterns) {
    const match = fNorm.match(pattern);
    if (match) {
      fragGeo = match[0];
      break;
    }
  }
  
  // Check if base has a geo
  let baseGeo = null;
  for (const pattern of geoPatterns) {
    const match = bNorm.match(pattern);
    if (match) {
      baseGeo = match[0];
      break;
    }
  }
  
  let result = b;
  
  // Check if fragment is a year replacement (e.g. "2024 ada?", "tahun 2024")
  const fragYearMatch = f.match(/\b(19|20)\d{2}\b/);
  const baseYearMatch = b.match(/\b(19|20)\d{2}\b/);
  
  if (fragYearMatch && baseYearMatch) {
    // Replace year in base with new year from fragment
    result = result.replace(baseYearMatch[0], fragYearMatch[0]);
  } else if (fragYearMatch && !baseYearMatch) {
    // Add year from fragment
    result = `${result} ${fragYearMatch[0]}`;
  }
  
  // Handle geo replacement
  if (fragGeo && baseGeo) {
    // Replace geo in result with new geo from fragment
    for (const pattern of geoPatterns) {
      if (pattern.test(result)) {
        result = result.replace(pattern, '');
        break;
      }
    }
    result = `${result} ${fragGeo}`.replace(/\s+/g, ' ').trim();
  } else if (fragGeo && !baseGeo) {
    // Add geo from fragment
    result = `${result} ${fragGeo}`;
  }
  
  // Add any remaining content from filtered fragment (excluding already processed year/geo)
  let fragRemaining = fFiltered
    .replace(/\b(19|20)\d{2}\b/g, '')
    .replace(/\s*(tahun|thn|periode)\s*/gi, '');
  
  if (fragGeo) {
    for (const pattern of geoPatterns) {
      fragRemaining = fragRemaining.replace(pattern, '');
    }
  }
  
  // Check if user is explicitly asking for kab/kota level data
  // Pattern: "kabupaten atau kota", "kabupaten/kota", "per kabupaten", "menurut kabupaten"
  const asksKabKotaLevel = /\b(kabupaten|kab)(\s*(atau|dan|\/)\s*(kota)|\s*\/\s*kota|upaten\/kota)\b/i.test(fFiltered) ||
                           /\b(per|menurut|tiap|setiap)\s*(kabupaten|kab)\b/i.test(fFiltered);
  
  if (asksKabKotaLevel) {
    // Preserve "kabupaten/kota" indicator - add to result if not already there
    if (!result.toLowerCase().includes('kabupaten') && !result.toLowerCase().includes('kab/kota')) {
      result = `${result} kabupaten/kota`;
    }
    // Still remove individual occurrences from fragRemaining to avoid duplication
    fragRemaining = fragRemaining.replace(/\s*(kabupaten|kab|kota|di|untuk|atau|dan)\s*/gi, ' ').trim();
  } else {
    // Original behavior: remove these words as they're just noise
    fragRemaining = fragRemaining.replace(/\s*(kabupaten|kab|kota|di|untuk)\s*/gi, ' ').trim();
  }
  
  // Don't add if it's just question words or very short
  if (fragRemaining && fragRemaining.length > 2 && !/^(ada|tersedia|yang|saja)\??$/i.test(fragRemaining)) {
    if (!result.toLowerCase().includes(fragRemaining.toLowerCase())) {
      result = `${result} ${fragRemaining}`;
    }
  }
  
  return result.replace(/\s+/g, ' ').trim();
}

/**
 * Parse malika_ui metadata from assistant message content
 */
function parseUiMetaFromContent(rawContent) {
  const raw = String(rawContent || '');
  if (!raw) return null;
  const m = raw.match(/```\s*malika_ui\s*\n([\s\S]*?)\n```/i);
  if (!m || !m[1]) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/**
 * Extract topic keywords from a query (e.g. "pengangguran", "inflasi", "kemiskinan", "durian")
 * Also extracts service/procedural topics (e.g. "layanan nol rupiah", "rekomendasi statistik")
 * These are the core statistical indicators/commodities/services being discussed
 */
function extractTopicKeywords(query) {
  const q = String(query || '').toLowerCase();
  const topics = [];
  
  // Service/layanan patterns - with display names
  const servicePatterns = [
    { pattern: /\b(layanan\s*nol\s*rupiah)\b/, display: 'Layanan Nol Rupiah' },
    { pattern: /\b(rekomendasi\s*statistik)\b/, display: 'Rekomendasi Statistik' },
    { pattern: /\b(layanan\s*pst)\b/, display: 'Layanan PST' },
    { pattern: /\b(pst|pelayanan\s*statistik\s*terpadu)\b/, display: 'PST' },
    { pattern: /\b(pusdatin)\b/, display: 'Pusdatin' },
    { pattern: /\b(konsultasi\s*statistik)\b/, display: 'Konsultasi Statistik' },
    { pattern: /\b(data\s*mikro)\b/, display: 'Data Mikro' },
    { pattern: /\b(romanis)\b/, display: 'Romanis' },
    { pattern: /\b(allstats|allstatistik)\b/, display: 'Allstats' },
    { pattern: /\b(silastik)\b/, display: 'Silastik' },
    { pattern: /\b(transdata)\b/, display: 'Transdata' },
    { pattern: /\b(webapi)\b/, display: 'WebAPI BPS' },
    { pattern: /\b(sirusa)\b/, display: 'SIRUSA' },
    { pattern: /\b(pojok\s*statistik)\b/, display: 'Pojok Statistik' },
    { pattern: /\b(perpustakaan\s*bps)\b/, display: 'Perpustakaan BPS' },
    { pattern: /\b(publikasi\s*bps)\b/, display: 'Publikasi BPS' },
    { pattern: /\b(tanya\s*jawab|faq|pertanyaan\s*umum)\b/, display: 'FAQ' },
    { pattern: /\b(cara\s*mendapatkan\s*data|akses\s*data)\b/, display: 'Akses Data' },
    { pattern: /\b(jam\s*(buka|operasional|kerja)|jadwal\s*pelayanan)\b/, display: 'Jam Layanan' },
    { pattern: /\b(kontak\s*bps|hubungi\s*bps|alamat\s*bps)\b/, display: 'Kontak BPS' },
    // Sensus dan survei BPS
    { pattern: /\b(sensus\s*ekonomi)\b/, display: 'Sensus Ekonomi' },
    { pattern: /\b(sensus\s*penduduk)\b/, display: 'Sensus Penduduk' },
    { pattern: /\b(sensus\s*pertanian)\b/, display: 'Sensus Pertanian' },
    { pattern: /\b(sensus)\b/, display: 'Sensus' },
    { pattern: /\b(survei\s*bps)\b/, display: 'Survei BPS' },
    { pattern: /\b(sakernas)\b/, display: 'Sakernas' },
    { pattern: /\b(susenas)\b/, display: 'Susenas' },
    { pattern: /\b(supas)\b/, display: 'Supas' },
  ];
  
  for (const { pattern, display } of servicePatterns) {
    if (pattern.test(q)) {
      topics.push(display);
    }
  }
  
  // Statistical indicator patterns - expanded to include commodities and other data types
  const indicatorPatterns = [
    /\b(pengangguran|tpt|tingkat\s*pengangguran)\b/,
    /\b(kemiskinan|penduduk\s*miskin)\b/,
    /\b(inflasi)\b/,
    /\b(tpak|partisipasi\s*angkatan\s*kerja)\b/,
    /\b(ipm|indeks\s*pembangunan\s*manusia)\b/,
    /\b(pdrb|produk\s*domestik)\b/,
    /\b(penduduk|populasi|jumlah\s*penduduk)\b/,
    /\b(ekspor|impor|exim)\b/,
    /\b(pertumbuhan\s*ekonomi)\b/,
    /\b(gini|ketimpangan)\b/,
    /\b(harapan\s*hidup|ahh)\b/,
    /\b(kepadatan\s*penduduk)\b/,
    /\b(lama\s*sekolah|pendidikan)\b/,
    /\b(hotel|akomodasi|pariwisata)\b/,
    // Commodities / Agriculture
    /\b(durian|mangga|pisang|jeruk|rambutan|kelapa|sawit|padi|jagung|kopi|kakao|cengkeh)\b/,
    /\b(produksi\s*(tanaman|pertanian|buah|sayuran))\b/,
    /\b(luas\s*(panen|tanam|lahan))\b/,
    // Other data types
    /\b(curah\s*hujan|iklim|suhu)\b/,
    /\b(kendaraan|kendaraan\s*bermotor)\b/,
    /\b(sekolah|guru|murid|siswa)\b/,
    /\b(rumah\s*sakit|puskesmas|kesehatan)\b/,
  ];
  
  for (const pattern of indicatorPatterns) {
    const match = q.match(pattern);
    if (match) topics.push(match[1]);
  }
  
  return topics;
}

/**
 * Check if user query is asking about a NEW topic (different from conversation topic)
 */
function isNewTopicQuery(userQuery, conversationTopic) {
  if (!conversationTopic) return true;
  
  const queryTopics = extractTopicKeywords(userQuery);
  if (queryTopics.length === 0) return false; // No topic in query, might be follow-up
  
  // Check if any topic in query is DIFFERENT from conversation topic
  const convTopicNorm = conversationTopic.toLowerCase();
  for (const qt of queryTopics) {
    if (!convTopicNorm.includes(qt) && !qt.includes(convTopicNorm)) {
      return true; // Found a different topic
    }
  }
  return false;
}

/**
 * Check if query is a procedural/FAQ question (not a data request)
 * These should NOT be merged with conversation topic and should NOT show data tables
 * Examples: "siapa kepala BPS", "cara mengunduh data", "mekanisme transdata"
 * 
 * Uses dynamic patterns from knowledge base when available
 */
function isProceduralFaqQuery(query) {
  const q = String(query || '').toLowerCase();
  
  // Use knowledge patterns service if available (includes dynamic patterns from KB)
  if (knowledgePatternsService) {
    return knowledgePatternsService.isProceduralQuerySync(q);
  }
  
  // Fallback: Strong FAQ/procedural patterns - these are NOT data queries
  const faqPatterns = [
    // Who/what/where questions about BPS/people/organization
    /\b(siapa|who)\s+(kepala|pimpinan|direktur|wakil|sekretaris)/i,
    /\b(siapa)\s+.*(bps|badan\s*pusat\s*statistik)/i,
    /\b(apa\s+itu|apakah|pengertian|definisi)\s+\w+/i,
    /\b(dimana|where|lokasi|alamat)\s+(kantor|bps|pelayanan)/i,
    // How-to procedural questions
    /\b(cara|bagaimana|how\s+to)\s+(mengunduh|download|mendapatkan|mengakses|mengajukan|daftar|registrasi)/i,
    /\b(cara|bagaimana|how)\s+(menggunakan|memakai|akses)/i,
    /\b(mekanisme|prosedur|tata\s*cara|langkah|tahap|alur)\s+\w+/i,
    // Service-specific keywords (transdata, romanis, silastik, etc.)
    /\b(transdata|allstats|silastik|romanis|sirusa|webapi)\b/i,
    /\b(nol\s*rupiah|layanan\s*gratis|gratis)\b/i,
    // Contact/hours questions
    /\b(jam\s+(buka|kerja|operasional)|jadwal\s+pelayanan)\b/i,
    /\b(nomor\s+(telepon|hp|wa|whatsapp)|kontak|hubungi)\b/i,
    // Requirements/rules questions
    /\b(syarat|persyaratan|ketentuan|aturan)\s+(untuk|layanan|akses|data)/i,
    // General info about BPS
    /\b(tugas|fungsi|visi|misi)\s+(bps|badan)/i,
    /\b(sejarah|profil)\s+(bps|kantor)/i,
  ];
  
  return faqPatterns.some(p => p.test(q));
}

/**
 * Check if query contains substantive data-related keywords (not just fragments)
 * These indicate user wants to search for a new topic, not continue context
 */
function hasSubstantiveKeywords(query) {
  const q = String(query || '').toLowerCase();
  
  // Exception: if this is a comparison follow-up, don't treat as new topic
  if (isComparisonFollowUp(q)) return false;
  
  // Check for data-related nouns that indicate a new search intent
  const patterns = [
    /\bdata\s+(tentang|terkait|mengenai|produksi|pertanian)/,
    /\b(produksi|luas|jumlah|angka|statistik)\s+\w+/,
    /\b(tanaman|buah|sayuran|komoditas|pertanian)\b/,
    /\b(durian|mangga|pisang|jeruk|padi|jagung|kelapa|sawit|kopi|kakao|cengkeh)\b/,
    // Statistical topics that indicate new search
    /^(penduduk|populasi|inflasi|ekspor|impor|kemiskinan|pengangguran|pdrb|ipm|hotel|sekolah)$/i,
  ];
  return patterns.some(p => p.test(q));
}

/**
 * Check if user is asking for a DIFFERENT data type that should break out of locked source
 * e.g. user was looking at "Jumlah Penduduk" but now asks for "proyeksi" or "estimasi"
 * This allows switching to a different datasource even in follow-up context
 */
function isDifferentDataTypeRequest(query, lockedSourceName) {
  const q = String(query || '').toLowerCase();
  const lockedName = String(lockedSourceName || '').toLowerCase();
  
  // Check if user is asking for kab/kota breakdown when locked to province-level data
  const askingKabKota = /\b(kabupaten|kab\/kota|per\s*kab|menurut\s*kab|kota|kabupaten\/kota)\b/i.test(q);
  const lockedHasKabKota = /\b(kabupaten|kab\/kota|menurut\s*kab)\b/i.test(lockedName);
  if (askingKabKota && !lockedHasKabKota) {
    // User wants kab/kota breakdown but locked source is province-level
    return true;
  }
  
  // Check if user is asking for province-level when locked to kab/kota data
  const askingProvinsi = /\b(provinsi|maluku\s*utara|malut)\b/i.test(q) && !/\b(kabupaten|kab|kota)\b/i.test(q);
  if (askingProvinsi && lockedHasKabKota) {
    // User wants province-level but locked source is kab/kota-level
    return true;
  }
  
  // Data type keywords that indicate a different data type request
  const dataTypeKeywords = {
    proyeksi: ['proyeksi', 'estimasi', 'prediksi', 'forecast'],
    laju: ['laju', 'pertumbuhan', 'growth'],
    rasio: ['rasio', 'perbandingan'],
    persentase: ['persentase', 'persen', '%'],
    indeks: ['indeks', 'index'],
    distribusi: ['distribusi', 'sebaran'],
    kepadatan: ['kepadatan', 'density'],
    rata: ['rata-rata', 'rataan', 'average', 'mean'],
  };
  
  // Check if query contains any data type keyword
  for (const [dataType, keywords] of Object.entries(dataTypeKeywords)) {
    for (const keyword of keywords) {
      if (q.includes(keyword)) {
        // Check if locked source already contains this data type
        const lockedHasType = keywords.some(k => lockedName.includes(k));
        if (!lockedHasType) {
          // User is asking for a different data type than what's locked
          return true;
        }
      }
    }
  }
  
  return false;
}

/**
 * Find the conversation topic from history - the main indicator being discussed
 */
function findConversationTopic(historyMessages) {
  if (!Array.isArray(historyMessages) || historyMessages.length < 1) return null;
  
  // Look through recent messages for topic keywords
  // IMPORTANT: Prioritize DATA INDICATOR topics over service topics
  // This prevents "hubungi BPS" in assistant responses from being picked as topic
  
  let dataIndicatorTopic = null;
  let serviceTopic = null;
  
  for (let i = historyMessages.length - 1; i >= 0; i--) {
    const m = historyMessages[i];
    if (!m) continue;
    
    const content = m.role === 'assistant' 
      ? stripMalikaUiBlock(String(m.content || ''))
      : String(m.content || '');
    
    const topics = extractTopicKeywords(content);
    
    for (const t of topics) {
      // Check if this is a SERVICE topic (like "Kontak BPS", "Jam Layanan", etc)
      const isServiceTopic = /^(Kontak BPS|Jam Layanan|FAQ|Akses Data|PST|Layanan|Romanis|Allstats|Silastik|Pojok Statistik|Perpustakaan BPS|Publikasi BPS|Sensus|Sakernas|Susenas|Supas|Survei BPS|Data Mikro|Rekomendasi Statistik|Layanan Nol Rupiah|Pusdatin|Konsultasi Statistik)$/i.test(t);
      
      if (isServiceTopic) {
        // Only accept service topic from USER messages, not assistant
        if (m.role === 'user' && !serviceTopic) {
          serviceTopic = t;
        }
      } else {
        // Data indicator topic - prefer this
        if (!dataIndicatorTopic) {
          dataIndicatorTopic = t;
        }
      }
    }
    
    // If we found a data indicator topic, use it immediately
    if (dataIndicatorTopic) {
      return dataIndicatorTopic;
    }
  }
  
  // Fallback to service topic only if no data indicator found
  return serviceTopic || null;
}

/**
 * Normalize topic keyword for display (capitalize, clean up)
 */
function normalizeTopicForDisplay(topic) {
  const t = String(topic || '').trim().toLowerCase();
  if (!t) return '';
  
  // Map abbreviations/variants to clean display names
  const displayMap = {
    // === LAYANAN / SERVICES ===
    'layanan nol rupiah': 'Layanan Nol Rupiah',
    'rekomendasi statistik': 'Rekomendasi Statistik',
    'layanan pst': 'Layanan PST',
    'pst': 'PST',
    'pelayanan statistik terpadu': 'PST',
    'pusdatin': 'Pusdatin',
    'konsultasi statistik': 'Konsultasi Statistik',
    'data mikro': 'Data Mikro',
    'survei bps': 'Survei BPS',
    'romanis': 'Romanis',
    'allstats': 'Allstats',
    'allstatistik': 'Allstats',
    'silastik': 'Silastik',
    'pojok statistik': 'Pojok Statistik',
    'perpustakaan bps': 'Perpustakaan BPS',
    'publikasi bps': 'Publikasi BPS',
    'faq': 'FAQ',
    'tanya jawab': 'FAQ',
    'pertanyaan umum': 'FAQ',
    'akses data': 'Akses Data',
    'cara mendapatkan data': 'Akses Data',
    'jam layanan': 'Jam Layanan',
    'jam buka': 'Jam Layanan',
    'jam operasional': 'Jam Layanan',
    'jam kerja': 'Jam Layanan',
    'jadwal pelayanan': 'Jam Layanan',
    'kontak bps': 'Kontak BPS',
    'hubungi bps': 'Kontak BPS',
    'alamat bps': 'Kontak BPS',
    // === SENSUS & SURVEI ===
    'sensus': 'Sensus',
    'sensus ekonomi': 'Sensus Ekonomi',
    'sensus penduduk': 'Sensus Penduduk',
    'sensus pertanian': 'Sensus Pertanian',
    'sakernas': 'Sakernas',
    'susenas': 'Susenas',
    'supas': 'Supas',
    // === INDIKATOR STATISTIK ===
    'tpt': 'TPT',
    'tingkat pengangguran': 'Pengangguran',
    'pengangguran': 'Pengangguran',
    'kemiskinan': 'Kemiskinan',
    'penduduk miskin': 'Kemiskinan',
    'inflasi': 'Inflasi',
    'tpak': 'TPAK',
    'partisipasi angkatan kerja': 'TPAK',
    'ipm': 'IPM',
    'indeks pembangunan manusia': 'IPM',
    'pdrb': 'PDRB',
    'produk domestik': 'PDRB',
    'pertumbuhan ekonomi': 'Pertumbuhan Ekonomi',
    'penduduk': 'Penduduk',
    'populasi': 'Penduduk',
    'jumlah penduduk': 'Penduduk',
    'ekspor': 'Ekspor',
    'impor': 'Impor',
    'exim': 'Ekspor Impor',
    'gini': 'Gini',
    'ketimpangan': 'Ketimpangan',
    'harapan hidup': 'Harapan Hidup',
    'ahh': 'AHH',
    'kepadatan penduduk': 'Kepadatan Penduduk',
    'lama sekolah': 'Lama Sekolah',
    'pendidikan': 'Pendidikan',
    'hotel': 'Hotel',
    'akomodasi': 'Akomodasi',
    'pariwisata': 'Pariwisata',
    // Commodities
    'durian': 'Durian',
    'mangga': 'Mangga',
    'pisang': 'Pisang',
    'jeruk': 'Jeruk',
    'rambutan': 'Rambutan',
    'kelapa': 'Kelapa',
    'sawit': 'Sawit',
    'padi': 'Padi',
    'jagung': 'Jagung',
    'kopi': 'Kopi',
    'kakao': 'Kakao',
    'cengkeh': 'Cengkeh',
    'produksi tanaman': 'Produksi Tanaman',
    'produksi pertanian': 'Produksi Pertanian',
    'produksi buah': 'Produksi Buah',
    'produksi sayuran': 'Produksi Sayuran',
    'luas panen': 'Luas Panen',
    'luas tanam': 'Luas Tanam',
    'luas lahan': 'Luas Lahan',
    // Other
    'curah hujan': 'Curah Hujan',
    'iklim': 'Iklim',
    'suhu': 'Suhu',
    'kendaraan': 'Kendaraan',
    'kendaraan bermotor': 'Kendaraan Bermotor',
    'sekolah': 'Sekolah',
    'guru': 'Guru',
    'murid': 'Murid',
    'siswa': 'Siswa',
    'rumah sakit': 'Rumah Sakit',
    'puskesmas': 'Puskesmas',
    'kesehatan': 'Kesehatan',
  };
  
  // Try direct mapping
  if (displayMap[t]) return displayMap[t];
  
  // Fallback: capitalize first letter of each word
  return t.replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Generate chat title from topics array
 * Rules:
 * - 1 topic: "Pengangguran 2024"
 * - 2 topics: "Pengangguran & Kemiskinan"
 * - 3+ topics: "Pengangguran, Kemiskinan..." (truncate)
 * - Max length: 40 chars
 */
function generateTitleFromTopics(topics, firstUserMessage = '') {
  if (!Array.isArray(topics) || topics.length === 0) {
    // No topics detected - use first user message as fallback
    const msg = String(firstUserMessage || '').trim();
    if (!msg) return 'Chat baru';
    // Capitalize and truncate
    const capitalized = msg.charAt(0).toUpperCase() + msg.slice(1);
    if (capitalized.length <= 35) return capitalized;
    return capitalized.slice(0, 32) + '...';
  }
  
  // Normalize all topics for display
  const displayTopics = topics.map(normalizeTopicForDisplay).filter(Boolean);
  
  // Remove duplicates (case-insensitive)
  const uniqueTopics = [];
  const seen = new Set();
  for (const t of displayTopics) {
    const key = t.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      uniqueTopics.push(t);
    }
  }
  
  if (uniqueTopics.length === 0) return 'Chat baru';
  
  if (uniqueTopics.length === 1) {
    return uniqueTopics[0];
  }
  
  if (uniqueTopics.length === 2) {
    const title = `${uniqueTopics[0]}, ${uniqueTopics[1]}`;
    if (title.length <= 40) return title;
    // Truncate if too long
    return `${uniqueTopics[0]}, ${uniqueTopics[1].slice(0, 5)}...`;
  }
  
  // 3+ topics
  let title = uniqueTopics.slice(0, 2).join(', ');
  if (title.length > 35) {
    title = uniqueTopics[0];
  }
  return title.length <= 37 ? `${title}...` : `${title.slice(0, 34)}...`;
}

/**
 * Update chat thread title based on detected topics
 * Only updates if new topic is found
 * @returns {boolean} true if title was updated
 */
async function updateThreadTitleIfNeeded(thread, userMessage) {
  try {
    // Extract topics from current message
    const newTopics = extractTopicKeywords(userMessage);
    if (newTopics.length === 0) return false; // No topic in this message
    
    // Get existing topics from thread
    let existingTopics = [];
    try {
      existingTopics = Array.isArray(thread.topics) ? thread.topics : JSON.parse(thread.topics || '[]');
    } catch {
      existingTopics = [];
    }
    
    // Check if any new topics
    const existingSet = new Set(existingTopics.map(t => t.toLowerCase()));
    const actuallyNewTopics = newTopics.filter(t => !existingSet.has(t.toLowerCase()));
    
    if (actuallyNewTopics.length === 0) return false; // No new topics
    
    // Merge topics (keep existing + add new)
    const mergedTopics = [...existingTopics, ...actuallyNewTopics];
    
    // Generate new title
    const newTitle = generateTitleFromTopics(mergedTopics, userMessage);
    
    // Update thread
    await thread.update({
      topics: mergedTopics,
      title: newTitle,
      updated_at: new Date(),
    });
    
    return true;
  } catch (err) {
    console.error('[updateThreadTitleIfNeeded] Error:', err.message);
    return false;
  }
}

/**
 * Find a datasource that has provinsi-level data for the same topic
 * Returns { sourceId, sourceName } or null
 */
async function findProvinsiDatasource(currentSourceId, topic) {
  const DataSource = require('../../models/DataSource.model');
  const { Op } = require('sequelize');
  
  try {
    const currentDs = await DataSource.findByPk(currentSourceId);
    if (!currentDs) return null;
    
    // Extract key topic words from current datasource name
    const currentName = currentDs.name.toLowerCase();
    
    // Search for similar datasource that might have provinsi data
    // Look for datasources with similar name patterns but "Provinsi" or "Maluku Utara" without "Kabupaten"
    const topicKeywords = [];
    
    // Extract important keywords
    if (currentName.includes('pdrb') || currentName.includes('produk domestik')) {
      topicKeywords.push('%PDRB%', '%Produk Domestik%', '%Pertumbuhan%');
    }
    if (currentName.includes('kemiskinan') || currentName.includes('miskin')) {
      topicKeywords.push('%Kemiskinan%', '%Miskin%');
    }
    if (currentName.includes('pengangguran') || currentName.includes('tpt')) {
      topicKeywords.push('%Pengangguran%', '%TPT%');
    }
    if (currentName.includes('inflasi')) {
      topicKeywords.push('%Inflasi%');
    }
    if (currentName.includes('ipm') || currentName.includes('pembangunan manusia')) {
      topicKeywords.push('%IPM%', '%Pembangunan Manusia%');
    }
    
    if (topicKeywords.length === 0) return null;
    
    // Find datasource with provinsi-level data (not per kab/kota)
    const alternatives = await DataSource.findAll({
      where: {
        visible: true,
        id: { [Op.ne]: currentSourceId },
        [Op.or]: topicKeywords.map(kw => ({
          name: { [Op.like]: kw }
        })),
        [Op.and]: [
          // Prefer sources that don't have "Kabupaten" in name OR have "Provinsi"
          {
            [Op.or]: [
              { name: { [Op.notLike]: '%Kabupaten%' } },
              { name: { [Op.like]: '%Provinsi%' } },
            ]
          }
        ]
      },
      order: [['display_order', 'DESC']],
      limit: 5,
    });
    
    if (alternatives.length === 0) return null;
    
    // Return the best match
    return {
      sourceId: alternatives[0].id,
      sourceName: alternatives[0].name,
    };
  } catch (err) {
    console.error('[findProvinsiDatasource] Error:', err.message);
    return null;
  }
}

/**
 * Get provinsi-level data value from alternative datasource
 * Returns { value, sourceName, disclaimer } or null
 */
async function getProvinsiDataFromAlternative(alternativeSourceId, year, metric) {
  try {
    const { readGenericIndicatorFromBps } = require('../bpsRead/indicatorTableGenericRead.service');
    const DataSource = require('../../models/DataSource.model');
    
    const ds = await DataSource.findByPk(alternativeSourceId);
    if (!ds) return null;
    
    const bpsData = await readGenericIndicatorFromBps({
      sourceId: alternativeSourceId,
      period: year,
      sourceName: ds.name,
    });
    
    if (!bpsData || !Array.isArray(bpsData.data) || bpsData.data.length === 0) return null;
    
    // Look for provinsi row (Maluku Utara)
    const provinsiRow = bpsData.data.find(row => {
      const vals = Object.values(row).map(v => String(v || '').toLowerCase());
      return vals.some(v => v.includes('maluku utara') || v === 'maluku utara');
    });
    
    if (!provinsiRow) return null;
    
    // Extract numeric value
    const numericValues = Object.entries(provinsiRow)
      .filter(([k, v]) => typeof v === 'number' && !k.toLowerCase().includes('tahun'))
      .map(([k, v]) => ({ key: k, value: v }));
    
    if (numericValues.length === 0) return null;
    
    return {
      value: numericValues[0].value,
      metric: numericValues[0].key,
      sourceName: ds.name,
      disclaimer: true, // Mark that this comes from different source
    };
  } catch (err) {
    console.error('[getProvinsiDataFromAlternative] Error:', err.message);
    return null;
  }
}

/**
 * Find the last meaningful user query from history (not a confirmation or fragment)
 */
function findLastMeaningfulUserQuery(historyMessages) {
  if (!Array.isArray(historyMessages) || historyMessages.length < 2) return '';
  
  // Iterate from most recent to oldest (skip the current message)
  for (let i = historyMessages.length - 2; i >= 0; i--) {
    const m = historyMessages[i];
    if (!m || m.role !== 'user') continue;
    
    const txt = stripMalikaUiBlock(String(m.content || '')).trim();
    if (!txt) continue;
    if (isConfirmMessage(txt)) continue;
    if (isLikelyTimeOrPeriodFragment(txt)) continue;
    if (isLikelyGeoOnlyFragment(txt)) continue; // Skip geo-only fragments like "morotai"
    if (isShortFollowUp(txt)) continue;
    if (txt.replace(/\s+/g, ' ').trim().length < 5) continue;
    
    return txt.slice(0, 4000);
  }
  return '';
}

/**
 * Extract period range from query builder clauses
 * Returns { yearStart, yearEnd, years[] } or null if no range
 */
function extractPeriodRange(queryBuilder) {
  if (!queryBuilder?.clauses || !Array.isArray(queryBuilder.clauses)) return null;
  
  const timeClauses = queryBuilder.clauses.filter(c => c.kind === 'time' && c.year);
  if (timeClauses.length <= 1) return null; // Not a range
  
  const clauseYears = timeClauses.map(c => c.year).sort((a, b) => a - b);
  const yearStart = clauseYears[0];
  const yearEnd = clauseYears[clauseYears.length - 1];
  
  // Determine if this is specific years (non-contiguous) or continuous range
  let years = [];
  let isSpecificYears = false;
  
  if (clauseYears.length === 2) {
    // Two years: treat as continuous range (e.g., "2020-2024" → [2020, 2021, 2022, 2023, 2024])
    for (let y = yearStart; y <= yearEnd; y++) {
      years.push(y);
    }
  } else {
    // 3+ years: check if they're consecutive or specific
    const expectedContinuous = yearEnd - yearStart + 1;
    if (clauseYears.length === expectedContinuous) {
      // Consecutive (e.g., "2022, 2023, 2024")
      years = clauseYears;
    } else {
      // Non-consecutive / specific years (e.g., "2022, 2024, 2025" or "2020, 2022, 2024")
      isSpecificYears = true;
      years = clauseYears;
    }
  }
  
  // Sanity check: don't allow more than 10 years
  if (years.length > 10) {
    return { yearStart, yearEnd, years: years.slice(-10), isSpecificYears };
  }
  
  return {
    yearStart,
    yearEnd,
    years,
    isSpecificYears,
  };
}

// ============================================================================
// EXTENDED MERGE: BUNDLE DEFINITIONS
// ============================================================================

/**
 * Bundle definitions for extended multi-source merge.
 * Each bundle groups related datasources that can be merged into a single table.
 * 
 * Structure:
 * - id: unique identifier
 * - name: human-readable name
 * - triggers: keywords that activate this bundle
 * - sources: array of source definitions with id, label, unit, column (optional)
 * - keyColumn: column to join on (usually 'Wilayah')
 * - cluster: topic cluster for validation
 */
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
      console.log('[MonthlyMerge] Bundle detected: inflasi_ternate');
      return MONTHLY_BUNDLES.inflasi_ternate;
    case 'halteng':
      console.log('[MonthlyMerge] Bundle detected: inflasi_halteng');
      return MONTHLY_BUNDLES.inflasi_halteng;
    case 'provinsi':
    default:
      console.log('[MonthlyMerge] Bundle detected: inflasi_provinsi');
      return MONTHLY_BUNDLES.inflasi_provinsi;
  }
}

/**
 * Fetch and merge monthly data from a bundle
 * Same logic as getExtendedMergePreview but with Bulan key column
 * @param {Object} bundle - Monthly bundle definition
 * @param {number} year - Year to fetch
 * @returns {Object|null} Merged preview with all columns
 */
async function getMonthlyMergePreview({ bundle, year }) {
  if (!bundle || !bundle.sources || bundle.sources.length === 0) {
    return null;
  }
  
  console.log('[MonthlyMerge] Starting merge for bundle:', bundle.id, 'year:', year);
  
  // Dedupe source IDs
  const uniqueSourceIds = [...new Set(bundle.sources.map(s => s.id))];
  
  // Fetch all unique sources in parallel
  const fetchPromises = uniqueSourceIds.map(async (sourceId) => {
    try {
      const dynamicEndpoint = `http://localhost:5000/dynamic/${sourceId}?period=${year}`;
      const response = await fetch(dynamicEndpoint);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      
      if (json.data && json.data.data && json.data.data.length > 0) {
        return { sourceId, data: json.data, success: true };
      }
      return { sourceId, success: false, error: 'No data' };
    } catch (err) {
      console.warn(`[MonthlyMerge] Failed to fetch source ${sourceId}:`, err.message);
      return { sourceId, success: false, error: err.message };
    }
  });
  
  const fetchResults = await Promise.all(fetchPromises);
  const sourceDataMap = {};
  
  for (const result of fetchResults) {
    if (result.success) {
      sourceDataMap[result.sourceId] = result.data;
    }
  }
  
  // Check if we have enough sources
  const successCount = Object.keys(sourceDataMap).length;
  console.log('[MonthlyMerge] Fetch results:', successCount, '/', uniqueSourceIds.length, 'sources');
  
  if (successCount < 1) {
    console.log('[MonthlyMerge] No sources available, aborting merge');
    return null;
  }
  
  // Use first successful source as base
  const firstSourceId = Object.keys(sourceDataMap)[0];
  const baseData = sourceDataMap[firstSourceId];
  const keyColumn = bundle.keyColumn || 'Bulan';
  
  // Build merged columns
  const mergedColumns = [keyColumn];
  const columnDefs = [];
  
  for (const sourceDef of bundle.sources) {
    const srcData = sourceDataMap[sourceDef.id];
    if (!srcData) continue;
    
    // Check if this value column exists in the source
    const hasColumn = srcData.columns && srcData.columns.includes(sourceDef.valueColumn);
    if (!hasColumn && sourceDef.valueColumn !== 'Nilai') {
      console.log(`[MonthlyMerge] Column ${sourceDef.valueColumn} not found in source ${sourceDef.id}, skipping`);
      continue;
    }
    
    const colName = `${sourceDef.label}${sourceDef.unit ? ` (${sourceDef.unit})` : ''}`;
    columnDefs.push({
      name: colName,
      sourceId: sourceDef.id,
      valueColumn: sourceDef.valueColumn,
    });
    mergedColumns.push(colName);
  }
  
  // Build lookup maps
  const sourceLookups = {};
  for (const [srcId, srcData] of Object.entries(sourceDataMap)) {
    const lookup = {};
    for (const row of srcData.data) {
      const key = row[keyColumn];
      if (key) lookup[key] = row;
    }
    sourceLookups[srcId] = lookup;
  }
  
  // Get all month keys from base data (should be 12)
  const allKeys = baseData.data.map(row => row[keyColumn]).filter(Boolean);
  
  // Build merged rows
  const mergedRows = [];
  for (const key of allKeys) {
    const mergedRow = { [keyColumn]: key };
    
    for (const colDef of columnDefs) {
      const lookup = sourceLookups[colDef.sourceId];
      const srcRow = lookup ? lookup[key] : null;
      const value = srcRow ? srcRow[colDef.valueColumn] : null;
      mergedRow[colDef.name] = value;
    }
    
    mergedRows.push(mergedRow);
  }
  
  // Validate rows
  const validRows = mergedRows.filter(row => {
    const values = Object.values(row).slice(1);
    return values.some(v => v !== null && v !== undefined);
  });
  
  if (validRows.length === 0) {
    console.log('[MonthlyMerge] No valid merged rows');
    return null;
  }
  
  console.log('[MonthlyMerge] Merge success:', {
    bundle: bundle.id,
    columns: mergedColumns.length,
    rows: validRows.length,
  });
  
  return {
    columns: mergedColumns,
    data: validRows,
    merged: true,
    bundle: bundle.id,
    bundleName: bundle.name,
    from: uniqueSourceIds.map(id => `source_${id}`).join('+'),
    year,
    dimension: 'bulan',
  };
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
        console.log('[ExtendedMerge] Bundle detected:', id, 'trigger:', trigger);
        return bundle;
      }
    }
  }
  return null;
}

/**
 * Fetch and merge data from a bundle of datasources
 * @param {Object} bundle - Bundle definition from MERGE_BUNDLES
 * @param {number} year - Year to fetch
 * @param {string|null} geo - Geographic filter
 * @returns {Object|null} Merged preview with all columns
 */
async function getExtendedMergePreview({ bundle, year, geo }) {
  if (!bundle || !bundle.sources || bundle.sources.length === 0) {
    return null;
  }
  
  console.log('[ExtendedMerge] Starting merge for bundle:', bundle.id, 'year:', year);
  
  // Dedupe source IDs (some sources contribute multiple columns like 451)
  const uniqueSourceIds = [...new Set(bundle.sources.map(s => s.id))];
  
  // Fetch all unique sources in parallel
  const fetchPromises = uniqueSourceIds.map(async (sourceId) => {
    try {
      const dynamicEndpoint = `http://localhost:5000/dynamic/${sourceId}?period=${year}`;
      const response = await fetch(dynamicEndpoint);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      
      if (json.data && json.data.data && json.data.data.length > 0) {
        return { sourceId, data: json.data, success: true };
      }
      return { sourceId, success: false, error: 'No data' };
    } catch (err) {
      console.warn(`[ExtendedMerge] Failed to fetch source ${sourceId}:`, err.message);
      return { sourceId, success: false, error: err.message };
    }
  });
  
  const fetchResults = await Promise.all(fetchPromises);
  const sourceDataMap = {};
  
  for (const result of fetchResults) {
    if (result.success) {
      sourceDataMap[result.sourceId] = result.data;
    }
  }
  
  // Check if we have at least 2 successful sources
  const successCount = Object.keys(sourceDataMap).length;
  console.log('[ExtendedMerge] Fetch results:', successCount, '/', uniqueSourceIds.length, 'sources');
  
  if (successCount < 2) {
    console.log('[ExtendedMerge] Not enough sources, aborting merge');
    return null;
  }
  
  // Use first successful source as base for merging
  const firstSourceId = Object.keys(sourceDataMap)[0];
  const baseData = sourceDataMap[firstSourceId];
  const keyColumn = bundle.keyColumn || 'Wilayah';
  
  // Build merged data structure
  const mergedRows = [];
  const mergedColumns = [keyColumn];
  
  // Build lookup maps for each source
  const sourceLookups = {};
  for (const [srcId, srcData] of Object.entries(sourceDataMap)) {
    const lookup = {};
    for (const row of srcData.data) {
      const key = row[keyColumn];
      if (key) lookup[key] = row;
    }
    sourceLookups[srcId] = lookup;
  }
  
  // Determine column order based on bundle.sources
  const columnDefs = [];
  for (const sourceDef of bundle.sources) {
    const srcData = sourceDataMap[sourceDef.id];
    if (!srcData) continue;
    
    const colName = `${sourceDef.label}${sourceDef.unit ? ` (${sourceDef.unit})` : ''}`;
    columnDefs.push({
      name: colName,
      sourceId: sourceDef.id,
      valueColumn: sourceDef.valueColumn || 'Nilai',
    });
    mergedColumns.push(colName);
  }
  
  // Get all unique keys from base data
  const allKeys = baseData.data.map(row => row[keyColumn]).filter(Boolean);
  
  // Build merged rows
  for (const key of allKeys) {
    // Apply geo filter if specified
    if (geo) {
      const keyLower = String(key).toLowerCase();
      const geoLower = String(geo).toLowerCase();
      if (!keyLower.includes(geoLower) && !geoLower.includes(keyLower)) {
        continue;
      }
    }
    
    const mergedRow = { [keyColumn]: key };
    
    for (const colDef of columnDefs) {
      const lookup = sourceLookups[colDef.sourceId];
      const srcRow = lookup ? lookup[key] : null;
      const value = srcRow ? srcRow[colDef.valueColumn] : null;
      mergedRow[colDef.name] = value;
    }
    
    mergedRows.push(mergedRow);
  }
  
  // Validate: check if all rows have at least some non-null values
  const validRows = mergedRows.filter(row => {
    const values = Object.values(row).slice(1); // exclude key column
    return values.some(v => v !== null && v !== undefined);
  });
  
  if (validRows.length === 0) {
    console.log('[ExtendedMerge] No valid merged rows');
    return null;
  }
  
  console.log('[ExtendedMerge] Merge success:', {
    bundle: bundle.id,
    columns: mergedColumns.length,
    rows: validRows.length,
  });
  
  return {
    columns: mergedColumns,
    data: validRows,
    merged: true,
    bundle: bundle.id,
    bundleName: bundle.name,
    from: uniqueSourceIds.map(id => `source_${id}`).join('+'),
    year,
  };
}

/**
 * Extract indicator/topic name from datasource name for column labeling
 * @param {string} sourceName - Full datasource name
 * @param {string|null} topicHint - Optional topic hint from conversation
 * @returns {string|null} Extracted indicator name or null
 */
function extractIndicatorFromSourceName(sourceName, topicHint = null) {
  const name = String(sourceName || '').toLowerCase();
  
  // Common indicator patterns to extract
  const indicatorPatterns = [
    // Kemiskinan
    { pattern: /penduduk\s+miskin/i, label: 'Penduduk Miskin' },
    { pattern: /kemiskinan/i, label: 'Penduduk Miskin' },
    // Pengangguran
    { pattern: /pengangguran\s+terbuka/i, label: 'Pengangguran Terbuka' },
    { pattern: /pengangguran/i, label: 'Pengangguran' },
    { pattern: /tpt/i, label: 'Pengangguran Terbuka' },
    // Ketenagakerjaan  
    { pattern: /angkatan\s+kerja/i, label: 'Angkatan Kerja' },
    { pattern: /bekerja/i, label: 'Penduduk Bekerja' },
    { pattern: /tpak/i, label: 'Angkatan Kerja' },
    // Pendidikan
    { pattern: /rata.*lama.*sekolah/i, label: 'Rata-rata Lama Sekolah' },
    { pattern: /harapan.*lama.*sekolah/i, label: 'Harapan Lama Sekolah' },
    { pattern: /melek\s+huruf/i, label: 'Melek Huruf' },
    { pattern: /apm|apk/i, label: 'Partisipasi Sekolah' },
    // Ekonomi
    { pattern: /pdrb/i, label: 'PDRB' },
    { pattern: /pertumbuhan\s+ekonomi/i, label: 'Pertumbuhan Ekonomi' },
    { pattern: /inflasi/i, label: 'Inflasi' },
    { pattern: /gini/i, label: 'Gini Ratio' },
    // Kesehatan
    { pattern: /harapan\s+hidup/i, label: 'Harapan Hidup' },
    { pattern: /stunting/i, label: 'Stunting' },
    { pattern: /gizi/i, label: 'Gizi' },
    // IPM
    { pattern: /ipm|indeks\s+pembangunan\s+manusia/i, label: 'IPM' },
    // Penduduk
    { pattern: /jumlah\s+penduduk(?!\s+miskin)/i, label: 'Penduduk' },
    { pattern: /kepadatan\s+penduduk/i, label: 'Kepadatan Penduduk' },
    { pattern: /laju\s+pertumbuhan/i, label: 'Pertumbuhan Penduduk' },
  ];
  
  // Try to match patterns
  for (const { pattern, label } of indicatorPatterns) {
    if (pattern.test(name)) {
      return label;
    }
  }
  
  // Fallback: use topic hint if provided
  if (topicHint) {
    const topicLower = topicHint.toLowerCase();
    if (topicLower.includes('miskin') || topicLower.includes('kemiskinan')) {
      return 'Penduduk Miskin';
    }
    if (topicLower.includes('pengangguran')) {
      return 'Pengangguran';
    }
    if (topicLower.includes('ipm')) {
      return 'IPM';
    }
  }
  
  return null;
}

/**
 * Fetch and merge data from multiple datasources by dimension (e.g., Wilayah)
 * Used when user asks for "jumlah dan persentase" but data is in separate tables
 * @param {Array<{sourceId: number, sourceName: string}>} sources - Array of datasources to fetch
 * @param {number} year - Year to fetch
 * @param {string|null} geo - Geographic filter
 * @param {string|null} topic - Topic/indicator name for column labeling (e.g., 'kemiskinan', 'pengangguran')
 * @returns {Object|null} Merged preview with combined columns
 */
async function getMergedMultiSourcePreview({ sources, year, geo, topic = null }) {
  if (!Array.isArray(sources) || sources.length === 0) return null;
  
  try {
    const { readGenericIndicatorFromBps } = require('../bpsRead/indicatorTableGenericRead.service');
    
    // Fetch data from all sources in parallel
    const fetchPromises = sources.map(async (src) => {
      try {
        const bpsData = await readGenericIndicatorFromBps({
          sourceId: src.sourceId,
          period: year,
          sourceName: src.sourceName,
        });
        
        if (bpsData && !bpsData.__disabled && Array.isArray(bpsData.data) && bpsData.data.length > 0) {
          return {
            sourceId: src.sourceId,
            sourceName: src.sourceName,
            columns: bpsData.columns || [],
            data: bpsData.data,
            year: year,
            last_update: bpsData.last_update,
          };
        }
        return null;
      } catch (err) {
        console.warn(`[getMergedMultiSourcePreview] Failed to fetch source ${src.sourceId}:`, err.message);
        return null;
      }
    });
    
    const results = await Promise.all(fetchPromises);
    const validResults = results.filter(r => r !== null);
    
    console.log('[getMergedMultiSourcePreview] validResults count:', validResults.length, 'for year:', year);
    
    if (validResults.length === 0) return null;
    if (validResults.length === 1) {
      // Only one source has data - return as-is
      const r = validResults[0];
      let filteredData = r.data;
      if (geo) {
        const geoNorm = String(geo).toLowerCase().replace(/[^a-z]/g, '');
        const geoExpanded = expandGeoShorthand(geoNorm);
        filteredData = r.data.filter(row => {
          const rowValues = Object.values(row).map(v => String(v || '').toLowerCase());
          return rowValues.some(v => v.includes(geoNorm) || (geoExpanded && v.includes(geoExpanded)));
        });
        if (filteredData.length === 0) filteredData = r.data;
      }
      return {
        source: r.sourceName,
        columns: r.columns,
        data: filteredData,
        last_update: r.last_update,
        from: 'data_bps',
        merged: false,
      };
    }
    
    // Multiple sources have data - try to merge by dimension
    // Find common dimension column (usually "Wilayah", "Kabupaten/Kota", etc.)
    const dimensionPatterns = ['wilayah', 'kabupaten', 'kota', 'propinsi', 'provinsi', 'daerah'];
    
    let dimensionCol = null;
    for (const result of validResults) {
      for (const col of result.columns) {
        const colLower = String(col).toLowerCase();
        if (dimensionPatterns.some(p => colLower.includes(p))) {
          dimensionCol = col;
          break;
        }
      }
      if (dimensionCol) break;
    }
    
    if (!dimensionCol) {
      // Can't merge without dimension - return first result
      const r = validResults[0];
      return {
        source: r.sourceName,
        columns: r.columns,
        data: r.data,
        last_update: r.last_update,
        from: 'data_bps',
        merged: false,
      };
    }
    
    // Build merged data by dimension key
    const mergedMap = new Map(); // key: dimension value, value: merged row
    const allColumns = new Set([dimensionCol]);
    
    // Create column rename mapping for generic "Nilai" columns
    // based on the source name to make columns more descriptive
    const columnRenameMap = new Map();
    
    for (const result of validResults) {
      const sourceLower = String(result.sourceName || '').toLowerCase();
      
      // Add non-dimension columns from this source
      for (const col of result.columns) {
        if (col !== dimensionCol) {
          let finalColName = col;
          
          // Rename generic "Nilai" column based on source name - SCALABLE approach
          // Extract indicator/topic from source name dynamically
          if (String(col).toLowerCase() === 'nilai') {
            // Try to extract indicator name from source (e.g., "Penduduk Miskin", "Pengangguran", "IPM")
            let indicatorName = extractIndicatorFromSourceName(result.sourceName, topic);
            
            if (sourceLower.includes('jumlah') && !sourceLower.includes('persentase')) {
              finalColName = indicatorName ? `Jumlah ${indicatorName}` : 'Jumlah';
            } else if (sourceLower.includes('persentase') && !sourceLower.includes('jumlah')) {
              finalColName = indicatorName ? `Persentase ${indicatorName}` : 'Persentase';
            } else if (sourceLower.includes('indeks') || sourceLower.includes('ipm')) {
              finalColName = indicatorName || 'Indeks';
            } else {
              // Use source name as column prefix for generic cases
              finalColName = indicatorName || col;
            }
          }
          
          // Store mapping for this source's columns
          const mapKey = `${result.sourceId}:${col}`;
          columnRenameMap.set(mapKey, finalColName);
          allColumns.add(finalColName);
        }
      }
      
      // Merge rows by dimension
      for (const row of result.data) {
        const dimValue = String(row[dimensionCol] || '').trim();
        if (!dimValue) continue;
        
        if (!mergedMap.has(dimValue)) {
          mergedMap.set(dimValue, { [dimensionCol]: dimValue });
        }
        
        const mergedRow = mergedMap.get(dimValue);
        for (const col of result.columns) {
          if (col !== dimensionCol && row[col] !== undefined && row[col] !== null) {
            // Use renamed column name
            const mapKey = `${result.sourceId}:${col}`;
            const finalColName = columnRenameMap.get(mapKey) || col;
            mergedRow[finalColName] = row[col];
          }
        }
      }
    }
    
    // Convert to array
    const mergedData = Array.from(mergedMap.values());
    const mergedColumns = Array.from(allColumns);
    
    // Apply geo filter
    let filteredData = mergedData;
    if (geo) {
      const geoNorm = String(geo).toLowerCase().replace(/[^a-z]/g, '');
      const geoExpanded = expandGeoShorthand(geoNorm);
      filteredData = mergedData.filter(row => {
        const rowValues = Object.values(row).map(v => String(v || '').toLowerCase());
        return rowValues.some(v => v.includes(geoNorm) || (geoExpanded && v.includes(geoExpanded)));
      });
      if (filteredData.length === 0) filteredData = mergedData;
    }
    
    // Build combined source name
    const sourceNames = validResults.map(r => r.sourceName);
    const combinedSourceName = sourceNames.length > 1 
      ? `${sourceNames[0]} + ${sourceNames.length - 1} tabel lain`
      : sourceNames[0];
    
    // Get latest update date
    const latestUpdate = validResults
      .map(r => r.last_update)
      .filter(Boolean)
      .sort()
      .pop() || null;
    
    return {
      source: combinedSourceName,
      columns: mergedColumns,
      data: filteredData,
      last_update: latestUpdate,
      from: 'data_bps_merged',
      merged: true,
      sourceCount: validResults.length,
    };
    
  } catch (err) {
    console.error('[getMergedMultiSourcePreview] Error:', err.message);
    return null;
  }
}

/**
 * Get processed data preview for multiple years (range)
 * Returns merged data from all years
 */
async function getProcessedPreviewForRange({ sourceId, years, geo }) {
  if (!Number.isFinite(sourceId) || sourceId <= 0) return null;
  if (!Array.isArray(years) || years.length === 0) return null;
  
  try {
    const { readGenericIndicatorFromBps } = require('../bpsRead/indicatorTableGenericRead.service');
    const DataSource = require('../../models/DataSource.model');
    
    const ds = await DataSource.findByPk(sourceId);
    const sourceName = ds?.name || 'Data Statistik';
    
    // Fetch data for each year
    const allRows = [];
    let lastUpdate = null;
    let availableYears = [];
    
    for (const year of years) {
      try {
        const bpsData = await readGenericIndicatorFromBps({
          sourceId,
          period: year,
          sourceName,
        });
        
        if (bpsData && !bpsData.__disabled && Array.isArray(bpsData.data) && bpsData.data.length > 0) {
          // Add year column to each row
          const rowsWithYear = bpsData.data.map(row => ({
            ...row,
            _year: year,
          }));
          allRows.push(...rowsWithYear);
          availableYears.push(year);
          
          if (bpsData.last_update) {
            const lu = new Date(bpsData.last_update);
            if (!lastUpdate || lu > lastUpdate) lastUpdate = lu;
          }
        }
      } catch (err) {
        console.warn(`[getProcessedPreviewForRange] Year ${year} not available:`, err.message);
      }
    }
    
    if (allRows.length === 0) return null;
    
    // Apply geo filter if provided
    let filteredRows = allRows;
    if (geo) {
      const geoNorm = String(geo).toLowerCase().replace(/[^a-z]/g, '');
      const geoExpanded = expandGeoShorthand(geoNorm);
      
      filteredRows = allRows.filter(row => {
        const rowValues = Object.values(row).map(v => String(v || '').toLowerCase());
        return rowValues.some(v => 
          v.includes(geoNorm) || 
          (geoExpanded && v.includes(geoExpanded))
        );
      });
      
      // If no match, return all data
      if (filteredRows.length === 0) filteredRows = allRows;
    }
    
    // Extract columns (excluding internal _year)
    const sampleRow = filteredRows[0] || {};
    const columns = Object.keys(sampleRow).filter(k => k !== '_year');
    
    // Add Tahun column at the beginning if multiple years
    if (availableYears.length > 1) {
      columns.unshift('Tahun');
      filteredRows = filteredRows.map(row => {
        const { _year, ...rest } = row;
        return { Tahun: _year, ...rest };
      });
    } else if (availableYears.length === 1) {
      // Single year - remove _year from rows
      filteredRows = filteredRows.map(row => {
        const { _year, ...rest } = row;
        return rest;
      });
    }
    
    return {
      source: sourceName,
      columns,
      data: filteredRows,
      last_update: lastUpdate,
      from: 'data_bps_merged',
      availableYears,
      requestedYears: years,
    };
  } catch (err) {
    console.error('[getProcessedPreviewForRange] Error:', err.message);
    return null;
  }
}

/**
 * Find the last assistant's UI meta with candidates
 */
function findLastAssistantUiMeta(historyMessages) {
  if (!Array.isArray(historyMessages) || historyMessages.length < 1) return null;
  
  for (let i = historyMessages.length - 1; i >= 0; i--) {
    const m = historyMessages[i];
    if (!m || m.role !== 'assistant') continue;
    
    const ui = parseUiMetaFromContent(m.content);
    if (ui && Array.isArray(ui.candidates) && ui.candidates.length > 0) {
      return ui;
    }
  }
  return null;
}

/**
 * Get EXIM data preview from backend API (for chat)
 * Handles group-by komoditas/negara/pelabuhan for categorical analysis
 */
async function getEximPreviewFromApi({ sourceId, year, month, group, codeHs, pod, ctr, metric }) {
  if (!sourceId || !year) return null;
  
  try {
    const DataSource = require('../../models/DataSource.model');
    const ds = await DataSource.findByPk(sourceId);
    if (!ds || ds.type !== 'exim') return null;
    
    const { readEximFromBps } = require('../bpsRead/indicatorTableRead.service');
    
    const bpsData = await readEximFromBps({
      sourceId,
      year,
      monthNo: month || null,
      hs2: codeHs || null,
      pod: pod || null,
      ctr: ctr || null,
      metricWanted: metric || null,
      groupBy: group || null,
    });
    
    if (!bpsData || !Array.isArray(bpsData.data) || bpsData.data.length === 0) {
      return null;
    }
    
    return {
      source: bpsData.source || ds.name || 'Data EXIM',
      columns: Array.isArray(bpsData.columns) ? bpsData.columns : [],
      data: bpsData.data,
      last_update: bpsData.last_update || null,
      from: 'data_bps_exim',
      eximGroup: group || null,
    };
  } catch (err) {
    console.warn('[getEximPreviewFromApi] error:', err?.message);
    return null;
  }
}

/**
 * Get processed data preview - try data_bps first, then ProcessedCache as fallback
 */
async function getProcessedPreviewFromCache({ sourceId, year, month, geo }) {
  if (!Number.isFinite(sourceId) || sourceId <= 0) return null;
  
  try {
    // First try data_bps (main source)
    const { readGenericIndicatorFromBps } = require('../bpsRead/indicatorTableGenericRead.service');
    const DataSource = require('../../models/DataSource.model');
    
    const ds = await DataSource.findByPk(sourceId);
    const sourceName = ds?.name || 'Data Statistik';
    
    const bpsData = await readGenericIndicatorFromBps({
      sourceId,
      period: year,
      sourceName,
    });
    
    if (bpsData && !bpsData.__disabled && Array.isArray(bpsData.data) && bpsData.data.length > 0) {
      let filteredData = bpsData.data;
      
      // Apply geo filter if provided
      if (geo) {
        const geoNorm = String(geo).toLowerCase().replace(/[^a-z]/g, '');
        const geoExpanded = expandGeoShorthand(geoNorm);
        
        filteredData = bpsData.data.filter(row => {
          const rowValues = Object.values(row).map(v => String(v || '').toLowerCase());
          return rowValues.some(v => 
            v.includes(geoNorm) || 
            (geoExpanded && v.includes(geoExpanded))
          );
        });
        
        // If no match, return all data
        if (filteredData.length === 0) filteredData = bpsData.data;
      }
      
      return {
        source: bpsData.source || sourceName,
        columns: Array.isArray(bpsData.columns) ? bpsData.columns : [],
        data: filteredData,
        last_update: bpsData.last_update || null,
        from: 'data_bps',
      };
    }
    
    // Fallback to ProcessedCache
    let periodValue = String(year);
    if (Number.isInteger(month) && month >= 1 && month <= 12) {
      periodValue = `${year}${String(month).padStart(2, '0')}`;
    }

    const cache = await ProcessedCache.findOne({
      where: {
        source_id: sourceId,
        period_value: periodValue,
      },
      order: [['last_update', 'DESC']],
    });

    if (cache && cache.processed_json) {
      let parsed = cache.processed_json;
      if (typeof parsed === 'string') {
        parsed = JSON.parse(parsed);
      }

      return {
        source: parsed.source || 'Data',
        columns: Array.isArray(parsed.columns) ? parsed.columns : [],
        data: Array.isArray(parsed.data) ? parsed.data : [],
        last_update: parsed.last_update || null,
        from: 'processed_cache',
      };
    }
    
    // Fallback 3: Try live fetch from BPS API (for datasources without cache)
    try {
      const ds = await DataSource.findByPk(sourceId, { attributes: ['type', 'api_url', 'period_key', 'name'] });
      
      if (ds && ds.type === 'dynamic' && ds.api_url && ds.period_key === 'th' && year) {
        // BPS th_id convention: th = year - 1900 (e.g., 2025 -> 125, 2024 -> 124)
        const thId = year - 1900;
        const fetchUrl = ds.api_url.replace('{period}', thId);
        
        const axios = require('axios');
        const resp = await axios.get(fetchUrl, { timeout: 10000 });
        
        // BPS response uses 'datacontent' not 'data'
        const hasData = resp?.data?.datacontent && 
          (Array.isArray(resp.data.datacontent) ? resp.data.datacontent.length > 0 : Object.keys(resp.data.datacontent).length > 0);
        
        if (hasData) {
          // Process the raw BPS response
          const processDynamic = require('../processor/dynamic.processor');
          const processed = processDynamic(resp.data);
          
          if (processed && Array.isArray(processed.data) && processed.data.length > 0) {
            let filteredData = processed.data;
            
            // Apply geo filter if provided
            if (geo) {
              const geoNorm = String(geo).toLowerCase().replace(/[^a-z]/g, '');
              const geoExpanded = expandGeoShorthand(geoNorm);
              
              filteredData = processed.data.filter(row => {
                const rowValues = Object.values(row).map(v => String(v || '').toLowerCase());
                return rowValues.some(v => 
                  v.includes(geoNorm) || 
                  (geoExpanded && v.includes(geoExpanded))
                );
              });
              
              // If no match, return all data
              if (filteredData.length === 0) filteredData = processed.data;
            }
            
            return {
              source: processed.source || ds.name || 'Data Statistik',
              columns: Array.isArray(processed.columns) ? processed.columns : [],
              data: filteredData,
              last_update: processed.last_update || null,
              from: 'live_api',
            };
          }
        }
      }
    } catch (liveFetchErr) {
      console.warn('[getProcessedPreviewFromCache] live fetch error:', liveFetchErr?.message);
    }

    return null;
  } catch (err) {
    console.warn('[getProcessedPreviewFromCache] error:', err?.message);
    return null;
  }
}

/**
 * Expand geo shorthand to full name
 */
function expandGeoShorthand(geo) {
  const map = {
    // Shortcuts
    'kepsul': 'kepulauan sula',
    'kepsula': 'kepulauan sula',
    'halsel': 'halmahera selatan',
    'halut': 'halmahera utara',
    'halbar': 'halmahera barat',
    'haltim': 'halmahera timur',
    'halteng': 'halmahera tengah',
    'tikep': 'tidore kepulauan',
    // Full variants
    'morotai': 'pulau morotai',
    'taliabu': 'pulau taliabu',
    'sula': 'kepulauan sula',
    // City variants
    'ternate': 'kota ternate',
    'tidore': 'tidore kepulauan',
  };
  return map[geo] || null;
}

/**
 * Find nearest available period for a datasource when requested period not available
 * Returns { period, direction: 'nearest'|'latest' } or null
 */
async function findNearestAvailablePeriod(sourceId, requestedYear) {
  if (!sourceId) return null;
  
  try {
    // Try from data_bps first (check indikator_X table)
    const getSequelizeBps = require('../../config/db_bps');
    const sequelizeBps = getSequelizeBps();
    
    if (sequelizeBps) {
      const tableName = `indikator_${sourceId}`;
      // QueryTypes.SELECT returns array directly, not [rows, metadata]
      const rows = await sequelizeBps.query(
        `SELECT DISTINCT year FROM \`${tableName}\` ORDER BY year DESC LIMIT 20`,
        { type: QueryTypes.SELECT }
      ).catch(() => []);
      
      if (Array.isArray(rows) && rows.length > 0) {
        const years = rows.map(r => Number(r.year)).filter(y => !isNaN(y));
        if (years.length > 0) {
          // If requestedYear is provided, find nearest
          if (requestedYear) {
            const nearest = years.reduce((prev, curr) => 
              Math.abs(curr - requestedYear) < Math.abs(prev - requestedYear) ? curr : prev
            );
            if (nearest !== requestedYear) {
              return { period: nearest, direction: nearest < requestedYear ? 'terbaru' : 'terdekat' };
            }
          }
          // Return latest available
          return { period: Math.max(...years), direction: 'terbaru' };
        }
      }
    }
    
    // Fallback to DataPeriod table
    const DataPeriod = require('../../models/DataPeriod.model');
    const periods = await DataPeriod.findAll({
      where: { source_id: sourceId },
      order: [['period_value', 'DESC']],
      limit: 20,
    });
    
    if (periods.length > 0) {
      const years = periods
        .map(p => Number(String(p.period_value).slice(0, 4)))
        .filter(y => !isNaN(y) && y >= 2000 && y <= 2100);
      
      if (years.length > 0) {
        const uniqueYears = [...new Set(years)].sort((a, b) => b - a);
        
        if (requestedYear) {
          const nearest = uniqueYears.reduce((prev, curr) => 
            Math.abs(curr - requestedYear) < Math.abs(prev - requestedYear) ? curr : prev
          );
          if (nearest !== requestedYear) {
            return { period: nearest, direction: nearest < requestedYear ? 'terbaru' : 'terdekat' };
          }
        }
        return { period: uniqueYears[0], direction: 'terbaru' };
      }
    }
    
    // Fallback 2: Check ProcessedCache directly (for datasources without period_map)
    try {
      const ProcessedCache = require('../../models/ProcessedCache.model');
      const cachedPeriods = await ProcessedCache.findAll({
        where: { source_id: sourceId },
        order: [['period_value', 'DESC']],
        limit: 20,
        attributes: ['period_value'],
      });
      
      if (cachedPeriods.length > 0) {
        const years = cachedPeriods
          .map(p => Number(String(p.period_value).slice(0, 4)))
          .filter(y => !isNaN(y) && y >= 2000 && y <= 2100);
        
        if (years.length > 0) {
          const uniqueYears = [...new Set(years)].sort((a, b) => b - a);
          
          if (requestedYear) {
            const nearest = uniqueYears.reduce((prev, curr) => 
              Math.abs(curr - requestedYear) < Math.abs(prev - requestedYear) ? curr : prev
            );
            if (nearest !== requestedYear) {
              return { period: nearest, direction: nearest < requestedYear ? 'terbaru' : 'terdekat' };
            }
          }
          return { period: uniqueYears[0], direction: 'terbaru' };
        }
      }
    } catch {
      // best-effort
    }
    
    // Fallback 3: For dynamic type datasources, try live period discovery from BPS API
    try {
      const DataSource = require('../../models/DataSource.model');
      const ds = await DataSource.findByPk(sourceId, { attributes: ['type', 'api_url', 'period_key'] });
      
      if (ds && ds.type === 'dynamic' && ds.api_url && ds.period_key) {
        // Try recent years (current year down to 5 years ago)
        const currentYear = new Date().getFullYear();
        const candidateYears = [];
        for (let y = currentYear; y >= currentYear - 5; y--) {
          candidateYears.push(y);
        }
        
        // BPS th_id convention: th = year - 1900 (e.g., 2025 -> 125, 2024 -> 124)
        for (const year of candidateYears) {
          const thId = year - 1900;
          const testUrl = ds.api_url.replace('{period}', thId);
          
          try {
            const axios = require('axios');
            const resp = await axios.get(testUrl, { timeout: 5000 });
            // BPS response uses 'datacontent' not 'data'
            const hasData = resp?.data?.datacontent && 
              (Array.isArray(resp.data.datacontent) ? resp.data.datacontent.length > 0 : Object.keys(resp.data.datacontent).length > 0);
            if (hasData) {
              // Found data for this year
              return { period: year, direction: 'terbaru' };
            }
          } catch {
            // This year has no data, try next
          }
        }
      }
    } catch {
      // best-effort
    }
    
    return null;
  } catch (err) {
    console.warn('[findNearestAvailablePeriod] error:', err?.message);
    return null;
  }
}

/**
 * Get all available years for a datasource (for displaying in context when data not found)
 * Returns array of years sorted descending, e.g. [2025, 2024, 2023]
 */
async function getAvailableYearsForSource(sourceId) {
  if (!sourceId) return [];
  
  try {
    // First try DataPeriod table
    const DataPeriod = require('../../models/DataPeriod.model');
    const periods = await DataPeriod.findAll({
      where: { source_id: sourceId },
      order: [['period_value', 'DESC']],
      limit: 20,
    });
    
    if (periods.length > 0) {
      const years = periods
        .map(p => {
          const val = String(p.period_value || '');
          // Handle both 3-digit (BPS th_id like 125) and 4-digit (year like 2025)
          if (/^\d{3}$/.test(val)) {
            return 1900 + Number(val);
          } else if (/^\d{4}$/.test(val)) {
            return Number(val);
          }
          return Number(val.slice(0, 4));
        })
        .filter(y => !isNaN(y) && y >= 2000 && y <= 2100);
      
      const uniqueYears = [...new Set(years)].sort((a, b) => b - a);
      if (uniqueYears.length > 0) return uniqueYears.slice(0, 10);
    }
    
    // Fallback: ProcessedCache
    try {
      const ProcessedCache = require('../../models/ProcessedCache.model');
      const cachedPeriods = await ProcessedCache.findAll({
        where: { source_id: sourceId },
        order: [['period_value', 'DESC']],
        limit: 20,
        attributes: ['period_value'],
      });
      
      if (cachedPeriods.length > 0) {
        const years = cachedPeriods
          .map(p => {
            const val = String(p.period_value || '');
            if (/^\d{3}$/.test(val)) {
              return 1900 + Number(val);
            } else if (/^\d{4}$/.test(val)) {
              return Number(val);
            }
            return Number(val.slice(0, 4));
          })
          .filter(y => !isNaN(y) && y >= 2000 && y <= 2100);
        
        const uniqueYears = [...new Set(years)].sort((a, b) => b - a);
        if (uniqueYears.length > 0) return uniqueYears.slice(0, 10);
      }
    } catch {
      // best-effort
    }
    
    return [];
  } catch (err) {
    console.warn('[getAvailableYearsForSource] error:', err?.message);
    return [];
  }
}

/**
 * Extract period and geo from previous UI meta candidates
 */
function extractContextFromPrevUiMeta(prevUiMeta) {
  if (!prevUiMeta || !Array.isArray(prevUiMeta.candidates)) return { year: null, geo: null };
  
  // Look at the first candidate's href
  const firstCandidate = prevUiMeta.candidates[0];
  if (!firstCandidate?.href) return { year: null, geo: null };
  
  try {
    const url = new URL(firstCandidate.href, 'http://localhost');
    const period = url.searchParams.get('period');
    const geo = url.searchParams.get('geo');
    
    let year = null;
    if (period) {
      const match = period.match(/^(19\d{2}|20\d{2}|2100)/);
      if (match) year = Number(match[1]);
    }
    
    return { year, geo };
  } catch {
    return { year: null, geo: null };
  }
}

/**
 * Search knowledge base for relevant documents
 * @param {string} query - User query
 * @param {number} topN - Number of results
 * @returns {Promise<Array>} - Knowledge documents with similarity > threshold
 */
async function searchKnowledgeBase(query, topN = 3) {
  if (!vectorSearchService?.searchKnowledge) return [];
  
  try {
    const result = await vectorSearchService.searchKnowledge(query, topN);
    // Filter by similarity threshold (e.g., 40%)
    return (result.results || []).filter(r => r.similarity >= 0.40);
  } catch (e) {
    console.warn('[StreamChat] Knowledge search failed:', e.message);
    return [];
  }
}

/**
 * Check if query is a knowledge/non-data question (scalable approach)
 * 
 * SCALABILITY: This function uses a combination of:
 * 1. Semantic similarity from knowledge base (auto-scales with new documents)
 * 2. Negative detection (data signals) - still needed to prevent false positives
 * 
 * When you upload new documents, the similarity score will automatically
 * increase for relevant queries, making them more likely to be treated as
 * knowledge queries (especially with high similarity >= 50%).
 */
function isKnowledgeTypeQuery(query, knowledgeSimilarity = 0) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return false;
  
  // FIRST: Check if this is a procedural/FAQ query (should skip data regardless of similarity)
  // This handles cases where knowledge base may not have relevant documents
  if (isProceduralFaqQuery(q)) {
    return true; // Skip data preview for FAQ queries
  }
  
  // Minimum threshold for considering this a knowledge query
  if (knowledgeSimilarity < 0.40) return false;
  
  // NEGATIVE signals: data/statistics queries - MUST show tables
  // Check these FIRST - they take absolute priority
  const dataSignals = [
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
    // Common statistical indicators
    /\b(inflasi|kemiskinan|pengangguran|tpt|ipm|pdrb|ekspor|impor|penduduk)\s+(maluku|2\d{3}|kabupaten|kota)/i,
  ];
  
  const hasDataSignal = dataSignals.some(p => p.test(q));
  
  // POSITIVE signals: procedural/informational queries - should use knowledge base
  // These must be STRONG service-related patterns to override data signals
  const serviceLayananPatterns = [
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
  
  const isServiceQuery = serviceLayananPatterns.some(p => p.test(q));
  
  // If has data signal AND NOT a service query -> always show data
  if (hasDataSignal && !isServiceQuery) {
    return false; // Show data table
  }
  
  // If it's a service/procedural query, prioritize knowledge base
  if (isServiceQuery) {
    return true;
  }
  
  // For queries without clear data signals, use similarity and question patterns
  // Very high similarity (>= 55%) without data signals - trust knowledge base
  if (knowledgeSimilarity >= 0.55 && !hasDataSignal) {
    return true;
  }
  
  // Medium similarity (40-55%) - use positive signals as tiebreaker
  // These are common question patterns that suggest non-data queries
  const knowledgeSignals = [
    /\b(siapa|who)\b/i,
    /\b(apa\s+itu|apakah|pengertian|definisi)\b/i,
    /\b(bagaimana|how\s+to|cara)\b/i,
    /\b(mengapa|why|kenapa|alasan)\b/i,
    /\b(kapan|when|dimana|where)\b/i,
  ];
  
  const hasKnowledgeSignal = knowledgeSignals.some(p => p.test(q));
  
  if (hasKnowledgeSignal) {
    return true;
  }
  
  return false;
}

/**
 * Build context messages for OpenAI based on intent and data
 */
function buildContextMessages({ intentResult, candidates, dataPreview, historyMessages, periodFallback, knowledgeContext, isServiceQueryWithoutKnowledge, availableYearsInfo }) {
  const contextMessages = [];

  // If this is a service/procedural query but NO knowledge context is available,
  // add explicit instruction to NOT make up answers
  if (isServiceQueryWithoutKnowledge) {
    contextMessages.push({
      role: 'system',
      content: `PERHATIAN - INFORMASI TIDAK TERSEDIA:
Pertanyaan user adalah tentang prosedur/layanan/tata cara, tetapi informasi spesifik TIDAK ditemukan di knowledge base.

WAJIB:
- Katakan dengan jujur bahwa informasi spesifik tentang layanan tersebut belum tersedia di sistem
- JANGAN mengarang atau mengira-ngira tahapan/prosedur
- Arahkan user untuk menghubungi BPS Maluku Utara via WhatsApp di [+62 851-7676-4422](https://wa.me/6285176764422) untuk informasi lebih lengkap
- Boleh menyebutkan bahwa BPS menyediakan berbagai layanan tapi JANGAN merinci tahapan yang tidak ada di knowledge base

Contoh respons yang BENAR:
"Mohon maaf, informasi detail tentang layanan rekomendasi statistik belum tersedia di sistem saya. Untuk tahapan dan persyaratan lengkap, silakan hubungi BPS Maluku Utara via WhatsApp di [+62 851-7676-4422](https://wa.me/6285176764422)."`,

    });
  }

  // Add knowledge base context if available (RAG)
  if (knowledgeContext && knowledgeContext.length > 0) {
    const topSimilarity = knowledgeContext[0]?.similarity || 0;
    const knowledgeText = knowledgeContext.map((doc, i) => {
      // Strip markdown formatting from knowledge content
      const cleanContent = stripMarkdownFormatting(doc.content);
      return `[Dokumen ${i + 1}] (relevansi: ${Math.round((doc.similarity || 0) * 100)}%)\n${cleanContent}`;
    }).join('\n\n');
    
    // Add stronger instruction based on similarity
    const confidenceNote = topSimilarity >= 0.55 
      ? 'Dokumen di atas SANGAT RELEVAN dengan pertanyaan user.'
      : 'Dokumen di atas MUNGKIN terkait, tapi BELUM TENTU menjawab pertanyaan spesifik user.';
    
    contextMessages.push({
      role: 'system',
      content: `KNOWLEDGE BASE (informasi internal BPS):\n\n${knowledgeText}\n\n${confidenceNote}

INSTRUKSI PENTING:
1. HANYA gunakan informasi dari dokumen di atas jika BENAR-BENAR menjawab pertanyaan user
2. Jika user bertanya tentang "layanan X" tapi dokumen berisi "layanan Y", JANGAN jawab dengan informasi layanan Y
3. Jika dokumen tidak menjawab pertanyaan SPESIFIK user, katakan: "Mohon maaf, informasi tentang [topik spesifik] belum tersedia di sistem saya. Silakan hubungi BPS Maluku Utara via WhatsApp di [+62 851-7676-4422](https://wa.me/6285176764422)."
4. JANGAN mengarang tahapan/prosedur yang tidak ada di dokumen
5. DILARANG menggunakan markdown formatting (**, *, #, dll) dalam respons`,
    });
  }

  // Add data context if available
  if (dataPreview && dataPreview.rows && dataPreview.rows.length > 0) {
    // Format data more clearly for interpretation
    const rowsFormatted = dataPreview.rows.slice(0, 15).map((row, idx) => {
      const values = dataPreview.columns.map(col => `${col}: ${row[col] ?? '-'}`);
      return `  ${idx + 1}. ${values.join(', ')}`;
    }).join('\n');

    let contextContent = `DATA STATISTIK DARI DATABASE BPS (sumber: ${dataPreview.from || 'database'}):

Judul: ${dataPreview.title}
Kolom: ${dataPreview.columns.join(' | ')}
Total baris: ${dataPreview.total_rows}
${dataPreview.geo ? `Filter wilayah: ${dataPreview.geo}` : ''}`;

    // Add period fallback notice — positive frame: lead with data, mention period in passing
    if (periodFallback) {
      contextContent += `

CATATAN PERIODE — POSITIF FRAME:
Tahun yang user minta: ${periodFallback.requestedYear}; tahun yang ditampilkan: ${periodFallback.actualYear} (${periodFallback.direction}).
Buka jawaban DENGAN ANGKA dari rows di atas. Sebut periode fallback satu kalimat saja, contoh:
"Berikut data tahun ${periodFallback.actualYear} (tahun ${periodFallback.requestedYear} belum dirilis): [angka]. ..."
JANGAN mulai dengan "belum tersedia" atau "tidak tersedia" — rows-nya ADA.`;
    }

    contextContent += `

DATA (${Math.min(15, dataPreview.rows.length)} baris):
${rowsFormatted}

INSTRUKSI INTERPRETASI:
- WAJIB sebutkan ANGKA SPESIFIK dari data di atas
- Contoh baik: "TPT Kepulauan Sula tahun 2023 adalah 2.67%, lebih rendah dari rata-rata provinsi 4.31%"
- Contoh buruk: "TPT relatif rendah" (TIDAK BOLEH tanpa angka)
- Berikan insight singkat (max 3-4 kalimat)`;

    contextMessages.push({
      role: 'system',
      content: contextContent,
    });
  } else if (candidates?.length > 0) {
    // Has candidates but no preview - list the found datasources with available years info
    const topCandidates = candidates.slice(0, 3).map(c => `- "${c.name}"`).join('\n');
    
    // Build available years context
    let yearsContext = '';
    if (availableYearsInfo && availableYearsInfo.years && availableYearsInfo.years.length > 0) {
      const yearsStr = availableYearsInfo.years.slice(0, 5).join(', ');
      const latestYear = availableYearsInfo.years[0];
      yearsContext = `

INFORMASI PERIODE:
- Data terbaru yang tersedia: tahun ${latestYear}
- Tahun yang tersedia: ${yearsStr}
${availableYearsInfo.requestedYear && !availableYearsInfo.years.includes(availableYearsInfo.requestedYear) 
  ? `- Data tahun ${availableYearsInfo.requestedYear} BELUM tersedia di sistem
- WAJIB sampaikan: "Data tahun ${availableYearsInfo.requestedYear} belum tersedia. Data terbaru yang tersedia adalah tahun ${latestYear}."` 
  : ''}`;
    }
    
    contextMessages.push({
      role: 'system',
      content: `INDIKATOR/DATASOURCE YANG DITEMUKAN:
${topCandidates}
${yearsContext}

INSTRUKSI PENTING:
1. Sebutkan nama indikator yang relevan dari daftar di atas
2. JANGAN bilang "data tidak tersedia" atau "belum tersedia di sistem" - karena indikator sudah DITEMUKAN
3. Jelaskan tahun/periode yang tersedia (jika ada info di atas)
4. Tawarkan user untuk melihat data dari indikator tersebut
5. JANGAN menyebut angka statistik apapun (karena tabel belum dimuat)
6. Jika user menanyakan periode/tahun yang belum ada, sarankan hubungi BPS via WhatsApp di [+62 851-7676-4422](https://wa.me/6285176764422) untuk konfirmasi jadwal rilis data`,
    });
  } else {
    contextMessages.push({
      role: 'system',
      content: `Tidak ada indikator yang cocok ditemukan untuk query user. Bantu user menentukan: indikator apa, periode (tahun/bulan), dan wilayah yang dibutuhkan. JANGAN menyebut angka apapun.`,
    });
  }

  // Add conversation history
  if (historyMessages && historyMessages.length > 0) {
    const recent = historyMessages.slice(-10);
    for (const msg of recent) {
      contextMessages.push({
        role: msg.role,
        content: String(msg.content || '').slice(0, 2000),
      });
    }
  }

  return contextMessages;
}

/**
 * Stream chat response using SSE
 */
async function streamChatResponse({
  res,
  threadId,
  userMessage,
  ownerId,
  modelOverride,
}) {
  const apiKey = getOpenAIKey();
  const model = getOpenAIModel();

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // AbortController tied to the SSE response. If the client disconnects
  // before we finished writing, abort any in-flight LLM fetches.
  const abortController = new AbortController();
  const abortSignal = abortController.signal;
  res.on('close', () => {
    if (!res.writableEnded) abortController.abort();
  });

  // Helper to send SSE event
  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Validate thread ownership
    const thread = await ChatThread.findOne({
      where: { id: threadId, owner_id: ownerId },
    });

    if (!thread) {
      sendEvent('error', { message: 'Thread not found' });
      res.end();
      return;
    }

    // Save user message
    const createdUser = await ChatMessage.create({
      thread_id: threadId,
      role: 'user',
      content: userMessage.slice(0, 8000),
      created_at: now(),
    });

    sendEvent('user_saved', { id: createdUser.id });

    // Update thread title based on detected topics (async, non-blocking)
    const titleUpdated = await updateThreadTitleIfNeeded(thread, userMessage);
    if (titleUpdated) {
      sendEvent('thread_updated', { title: thread.title, topics: thread.topics });
    }

    // Get conversation history FIRST (needed for context merging)
    const historyMessages = await ChatMessage.findAll({
      where: { thread_id: threadId },
      order: [['id', 'ASC']],
      limit: 20,
    });
    const historyArray = historyMessages.map(m => m.toJSON());

    // Context-aware query merging:
    // If user says "ya" or "tahun 2025 kabupaten kepsul", merge with previous topic query
    const clippedUserText = userMessage.slice(0, 4000);
    const isUserGreeting = isGreeting(clippedUserText);
    const isConfirm = isConfirmMessage(clippedUserText);
    const isPeriodFragment = isLikelyTimeOrPeriodFragment(clippedUserText);
    const isGeoOnlyFragment = isLikelyGeoOnlyFragment(clippedUserText);
    const isFollowUp = isShortFollowUp(clippedUserText);
    const lastMeaningful = findLastMeaningfulUserQuery(historyArray);
    const prevUiMeta = findLastAssistantUiMeta(historyArray);
    const conversationTopic = findConversationTopic(historyArray);
    
    // NEW: Check if previous context was knowledge mode (not data)
    const wasKnowledgeMode = isPrevContextKnowledgeMode(prevUiMeta, historyArray);
    
    // GREETING HANDLING: Skip search/preview for greetings
    if (isUserGreeting) {
      // Build greeting response without data search
      const greetingSuggestions = buildGreetingSuggestions(historyArray, conversationTopic);
      
      await streamGreetingResponse({
        res,
        sendEvent,
        threadId,
        userMessage: clippedUserText,
        model,
        apiKey,
        suggestions: greetingSuggestions,
        historyArray,
        modelOverride,
        abortSignal,
      });
      return;
    }
    
    // Check if user is asking for a DIFFERENT data type (e.g. "proyeksi" when locked to "jumlah")
    const lockedName = prevUiMeta?.candidates?.[0]?.name || prevUiMeta?.table?.title || '';
    const askingDifferentType = isDifferentDataTypeRequest(clippedUserText, lockedName);
    
    // DEBUG: Log the context switch detection
    console.log('[StreamChat] Context check - query:', clippedUserText.slice(0, 50), 'lockedName:', lockedName?.slice(0, 40), 'askingDifferentType:', askingDifferentType, 'conversationTopic:', conversationTopic);
    
    // NEW: Check if user is asking to search from alternative sources
    // e.g. "ya dari survei lainnya" when discussing "angkatan kerja" from "Sensus Ekonomi"
    const isAltSourceRequest = isAlternativeSourceRequest(clippedUserText);

    let effectiveUserQuery = clippedUserText;
    let shouldPreferPrevCandidates = false;
    
    // FIRST: Check if this is a procedural/FAQ query - these should NEVER be merged with topic
    // This check must be at the top to prevent any topic merging for procedural queries
    if (isProceduralFaqQuery(clippedUserText)) {
      // Procedural FAQ query - use as-is, don't merge with any topic
      effectiveUserQuery = clippedUserText;
      shouldPreferPrevCandidates = false;
      console.log('[StreamChat] Procedural FAQ detected, no merge:', effectiveUserQuery);
    } else if (isAltSourceRequest && lastMeaningful) {
      // User is asking for alternative sources - extract the data subject from previous query
      // e.g. "ya dari survei lainnya" after "kalau data angkatan kerja tahun terbaru?"
      // → search for "angkatan kerja" without the "Sensus Ekonomi" context
      const subject = extractDataSubject(lastMeaningful);
      if (subject) {
        effectiveUserQuery = subject;
        console.log('[StreamChat] Alt source request, extracted subject:', subject, 'from:', lastMeaningful);
      } else {
        // Fallback: use lastMeaningful but strip service context (Sensus/Survey)
        effectiveUserQuery = lastMeaningful
          .replace(/\b(sensus\s*(ekonomi|penduduk|pertanian)?)\b/gi, '')
          .replace(/\b(survei\s*\w*)\b/gi, '')
          .replace(/\s+/g, ' ')
          .trim();
        console.log('[StreamChat] Alt source request, stripped context:', effectiveUserQuery);
      }
      shouldPreferPrevCandidates = false; // Force fresh search from all sources
    } else if (askingDifferentType && conversationTopic) {
      // User is asking for a DIFFERENT data type (e.g. "proyeksi ada?" while locked to "Jumlah Penduduk")
      // Merge with topic keyword only (e.g. "penduduk") but NOT with previous full query
      // This avoids "jumlah penduduk proyeksi" which would favor datasource 186
      effectiveUserQuery = mergeQuery(conversationTopic, clippedUserText);
      console.log('[StreamChat] Different type request - topic:', conversationTopic, 'merged:', effectiveUserQuery);
      shouldPreferPrevCandidates = false; // Force fresh search
    } else if (isGeoOnlyFragment && conversationTopic) {
      // GEO-ONLY FRAGMENT: "kepulauan sula", "ternate", "halmahera selatan"
      // Merge with CONVERSATION TOPIC (e.g. "inflasi") not lastMeaningful
      // "kepulauan sula" + topic "inflasi" → "inflasi kepulauan sula"
      effectiveUserQuery = mergeQuery(conversationTopic, clippedUserText);
      shouldPreferPrevCandidates = false; // Force fresh search for geo filtering!
    } else if (isConfirm && lastMeaningful) {
      // "ya" → reuse "pengangguran" 
      effectiveUserQuery = lastMeaningful;
      shouldPreferPrevCandidates = true;
    } else if (!isConfirm && (isPeriodFragment || isFollowUp) && lastMeaningful) {
      // "tahun 2025 kabupaten kepsul" + "pengangguran" → "pengangguran tahun 2025 kabupaten kepsul"
      // "2024 ada?" + "pengangguran" → "pengangguran 2024"
      // "spesifik untuk kepulauan sula" + "pengangguran" → "pengangguran kepulauan sula"
      effectiveUserQuery = mergeQuery(lastMeaningful, clippedUserText);
      shouldPreferPrevCandidates = true;
    } else if (!isConfirm && conversationTopic && !extractTopicKeywords(clippedUserText).length && !hasSubstantiveKeywords(clippedUserText)) {
      // User asks follow-up without explicit topic - inject the conversation topic
      // e.g. "2024 ada?" when discussing pengangguran → "pengangguran 2024"
      // Note: procedural FAQ queries are already handled at the top of this chain
      effectiveUserQuery = mergeQuery(conversationTopic, clippedUserText);
      shouldPreferPrevCandidates = true;
    } else if (isNewTopicQuery(clippedUserText, conversationTopic)) {
      // User switched to a NEW topic - don't merge with old topic
      // e.g. "data durian" when discussing pengangguran → just use "data durian"
      // Note: procedural FAQ queries are already handled at the top of this chain
      effectiveUserQuery = clippedUserText;
      shouldPreferPrevCandidates = false;
    }

    // ── Pipeline progress status: stage 1 of 5 ──
    sendEvent('status', { message: 'Mengenali topik & wilayah…', stage: 'normalize' });

    // Apply query normalization (abbreviation expansion, typo fix, geo normalization)
    // This helps with search accuracy without changing user's original intent
    let normalizedQuery = effectiveUserQuery;
    if (queryNormalizerService) {
      // Use light normalize for search (no abbreviation expansion to avoid search mismatch)
      normalizedQuery = queryNormalizerService.lightNormalize(effectiveUserQuery);
      if (normalizedQuery !== effectiveUserQuery) {
        console.log('[StreamChat] Query normalized:', effectiveUserQuery.slice(0, 50), '→', normalizedQuery.slice(0, 50));
      }
    }

    // Year inference: normalize relative year references ("tahun lalu" → actual year)
    let inferredYear = null;
    let yearInferenceResult = null;
    if (yearInferenceService) {
      yearInferenceResult = yearInferenceService.inferYear(normalizedQuery, { preferLatest: true });
      if (yearInferenceResult?.year && yearInferenceResult?.isInferred) {
        inferredYear = yearInferenceResult.year;
        // Normalize "tahun lalu" → "tahun 2024" in query for better search
        normalizedQuery = yearInferenceService.normalizeYearInQuery(normalizedQuery);
        console.log('[StreamChat] Year inferred:', inferredYear, 'source:', yearInferenceResult.source);
      }
    }

    // Geo inference: detect geographic references for filtering
    let geoInferenceResult = null;
    if (geoInferenceService) {
      geoInferenceResult = geoInferenceService.inferGeoFilter(normalizedQuery);
      if (geoInferenceResult?.hasGeo) {
        // Normalize shorthand geo references ("halbar" → "Halmahera Barat")
        normalizedQuery = geoInferenceService.normalizeGeoInQuery(normalizedQuery);
        console.log('[StreamChat] Geo detected:', geoInferenceResult.geoReferences.map(g => g.canonical).join(', '));
      }
    }

    // Fast-path check: skip expensive RAG/intent resolution for common queries
    let fastPathIntent = null;
    let usedFastPath = false;
    if (queryFastPathService && queryFastPathService.shouldSkipRag(normalizedQuery)) {
      fastPathIntent = queryFastPathService.getFastPathIntent(normalizedQuery);
      if (fastPathIntent) {
        usedFastPath = true;
        console.log('[StreamChat] Fast-path match:', fastPathIntent.type, 'source_ids:', fastPathIntent.source_ids?.slice(0, 3));
      }
    }

    // ── Pipeline progress status: stage 2 of 5 ──
    sendEvent('status', { message: 'Mencari sumber data…', stage: 'search' });

    // Resolve intent and get candidates using the NORMALIZED query
    let intentResult = null;
    let candidates = [];

    // If fast-path matched, use pre-defined datasources
    if (usedFastPath && fastPathIntent?.source_ids?.length > 0) {
      try {
        // Build candidates from fast-path source_ids
        const DataSource = require('../../models/DataSource.model');
        const fastPathSources = await DataSource.findAll({
          where: { id: fastPathIntent.source_ids },
          attributes: ['id', 'name', 'description', 'type', 'visible'],
        });
        candidates = fastPathSources.map(ds => ({
          id: ds.id,
          name: ds.name,
          description: ds.description,
          type: ds.type,
          score: 100, // High confidence for fast-path
        }));
        console.log('[StreamChat] Fast-path candidates:', candidates.length);
      } catch (e) {
        console.warn('[StreamChat] Fast-path datasource fetch failed:', e.message);
        usedFastPath = false; // Fallback to normal resolution
      }
    }
    
    // Normal resolution if fast-path didn't work
    if (!usedFastPath || candidates.length === 0) {
      try {
        intentResult = await resolveSearchIntent({ q: normalizedQuery, context: {} });
      } catch {
        // Intent resolution failed, continue without it
      }

      try {
        candidates = await buildDatasourceCandidates({
          q: normalizedQuery,
          qb: intentResult?.query_builder || null,
          limit: 12,
        });
        if (!Array.isArray(candidates)) candidates = [];
      } catch {
        candidates = [];
      }
    }

    // RE-RANK CANDIDATES based on geographic level AND topic relevance
    // If user asks for kab/kota data, prioritize kab/kota datasources that also match the conversation topic
    if (askingDifferentType && candidates.length > 0 && conversationTopic) {
      const userAsksKabKota = /\b(kabupaten|kab\/kota|kab\.?\s*kota|kabupaten\/kota|per\s*kab|menurut\s*kab|data\s+kab|tiap\s+kab)\b/i.test(clippedUserText) ||
                              /\b(kabupaten|kota)\s+(atau|dan|\/)\s+(kota|kabupaten)\b/i.test(clippedUserText);
      
      if (userAsksKabKota) {
        const topicNorm = String(conversationTopic).toLowerCase();
        
        // Build REQUIRED keywords that MUST appear in datasource name
        // This is more strict than just "any of these keywords"
        const requiredKeywords = [];
        const optionalKeywords = [];
        
        // For kemiskinan/miskin topics, the word "miskin" MUST appear
        // This prevents "Penduduk" datasource from matching when user asks for "penduduk miskin"
        if (/miskin|kemiskinan/i.test(topicNorm)) {
          requiredKeywords.push('miskin'); // MUST have "miskin"
          optionalKeywords.push('kemiskinan');
        } else if (/pengangguran|tpt/i.test(topicNorm)) {
          requiredKeywords.push('pengangguran');
          optionalKeywords.push('tpt');
        } else if (/inflasi/i.test(topicNorm)) {
          requiredKeywords.push('inflasi');
        } else if (/penduduk|populasi/i.test(topicNorm)) {
          // Pure "penduduk" topic - any penduduk datasource is OK
          requiredKeywords.push('penduduk');
        } else {
          // Fallback: use topic as-is
          requiredKeywords.push(topicNorm);
        }
        
        // Check if conversation context asked for BOTH jumlah AND persentase
        // Look at: 1) previous table title, 2) recent user messages
        const lockedTitle = prevUiMeta?.table?.title || prevUiMeta?.candidates?.[0]?.name || '';
        
        // Also check recent user messages in history for "jumlah dan persentase" pattern
        let userAskedBoth = false;
        for (const m of historyArray) {
          if (m.role === 'user') {
            const content = String(m.content || '').toLowerCase();
            if (/jumlah.*persentase|persentase.*jumlah|jumlah\s+(dan|&)\s+persentase/i.test(content)) {
              userAskedBoth = true;
              break;
            }
          }
        }
        
        const prevAskedBoth = userAskedBoth ||
                              /jumlah.*persentase|persentase.*jumlah/i.test(lockedTitle) ||
                              /jumlah\s+dan\s+persentase/i.test(lockedTitle);
        
        // Re-rank with BOTH kab/kota AND topic relevance
        candidates = candidates.map(c => {
          const name = String(c.name || '').toLowerCase();
          const hasKabKota = /\b(kabupaten|kab\/kota|menurut\s*kab|kabupaten\/kota)\b/i.test(name);
          
          // Check if datasource matches the REQUIRED topic keywords
          const matchesRequired = requiredKeywords.length > 0 && 
                                  requiredKeywords.some(kw => name.includes(kw));
          
          // Check if datasource is comprehensive (has BOTH jumlah AND persentase)
          const hasJumlah = /jumlah/i.test(name);
          const hasPersentase = /persentase/i.test(name);
          const isComprehensive = hasJumlah && hasPersentase;
          
          let boost = 0;
          if (hasKabKota && matchesRequired) {
            boost = 100; // Highest priority: kab/kota + matches required topic
            
            // Extra boost for comprehensive datasources when context asked for both
            if (isComprehensive && prevAskedBoth) {
              boost += 20; // 425 should beat 452 when user asked for both
            }
          } else if (hasKabKota && !matchesRequired) {
            boost = 0; // NO boost for kab/kota without topic match
          } else if (matchesRequired) {
            boost = 30; // Matches topic but no kab/kota
          }
          
          return { ...c, score: (c.score || 0) + boost };
        });
        
        // Re-sort by score descending
        candidates.sort((a, b) => (b.score || 0) - (a.score || 0));
        console.log('[StreamChat] Re-ranked candidates for kab/kota + topic:', conversationTopic, 
          'required:', requiredKeywords, 'prevAskedBoth:', prevAskedBoth,
          candidates.slice(0, 5).map(c => `${c.id}:${c.score}:${c.name?.slice(0, 40)}`));
      }
    }

    // CONTEXTUAL DATASOURCE LOCKING:
    // If user is in follow-up mode and previous UI had a selected datasource,
    // lock to that datasource unless user explicitly switches topic OR asks for different data type
    let lockedSourceId = null;
    let lockedSourceName = null;
    if (shouldPreferPrevCandidates && prevUiMeta?.table) {
      // Extract source_id from previous table href or first candidate
      const prevHref = prevUiMeta.candidates?.[0]?.href || '';
      const prevSourceMatch = prevHref.match(/source_id=(\d+)/);
      if (prevSourceMatch) {
        lockedSourceId = parseInt(prevSourceMatch[1], 10);
      } else if (prevUiMeta.candidates?.[0]?.id) {
        lockedSourceId = prevUiMeta.candidates[0].id;
      }
      lockedSourceName = prevUiMeta.candidates?.[0]?.name || prevUiMeta.table?.title || '';
      
      // CHECK: Is user asking for a DIFFERENT data type? (e.g. "proyeksi" vs "jumlah")
      // If yes, break out of lock and use new candidates instead
      if (isDifferentDataTypeRequest(clippedUserText, lockedSourceName)) {
        lockedSourceId = null;
        lockedSourceName = null;
        shouldPreferPrevCandidates = false; // Force use new candidates
      }
    }

    // If we should prefer previous candidates (follow-up queries), use them if:
    // 1. Current candidates are empty/weak, OR
    // 2. Current candidates don't match the conversation topic
    if (shouldPreferPrevCandidates && prevUiMeta?.candidates?.length > 0) {
      const prevCandidates = prevUiMeta.candidates;
      
      // Check if current candidates are relevant to conversation topic
      const topicRelevant = conversationTopic && candidates.some(c => 
        c.name?.toLowerCase().includes(conversationTopic)
      );
      
      if (candidates.length === 0 || !topicRelevant) {
        // Use previous candidates
        candidates = prevCandidates.map(c => ({
          id: c.id,
          name: c.name,
          type: c.type,
          score: c.score || 80,
        }));
      }
    } else if (candidates.length === 0 && prevUiMeta?.candidates?.length > 0) {
      // Fallback: if no candidates at all, use previous ones
      candidates = prevUiMeta.candidates.map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        score: c.score || 80,
      }));
    }

    // ── Pipeline progress status: stage 3 of 5 ──
    sendEvent('status', { message: 'Memuat data tabel terbaru…', stage: 'preview' });

    // Try to get data preview
    let dataPreview = null;
    let periodFallback = null; // Track if we fell back to a different period
    
    // Select source: prefer locked source (contextual locking), then previous candidates, then intent
    let selectedSourceId;
    if (lockedSourceId && shouldPreferPrevCandidates) {
      // CONTEXTUAL LOCKING: Use locked source from previous turn during follow-up
      selectedSourceId = lockedSourceId;
      // Ensure locked source is in candidates for consistency
      if (candidates.length > 0 && !candidates.some(c => c.id === lockedSourceId)) {
        const prevCandidate = prevUiMeta?.candidates?.find(c => c.id === lockedSourceId);
        if (prevCandidate) {
          candidates.unshift({
            id: prevCandidate.id,
            name: prevCandidate.name,
            type: prevCandidate.type,
            score: prevCandidate.score || 90,
          });
        }
      }
    } else if (shouldPreferPrevCandidates && candidates.length > 0) {
      // Use the first candidate from preserved/previous candidates
      selectedSourceId = candidates[0]?.id;
    } else {
      // CANDIDATE-FIRST SOURCE SELECTION:
      // Always prefer candidates[0] over intentResult.datasource.source_id because:
      // 1. buildDatasourceCandidates applies granularity boost (quarterly > yearly) when no year specified
      // 2. buildDatasourceCandidates considers text relevance, period availability, and other signals
      // 3. mapDatasourceFromQuery (used by resolveSearchIntent) doesn't apply these boosts
      // 
      // The candidates array is already sorted by score, so candidates[0] is the best match.
      // Fall back to intentResult only when no candidates available.
      if (candidates.length > 0) {
        selectedSourceId = candidates[0]?.id;
      } else {
        selectedSourceId = intentResult?.datasource?.source_id || null;
      }
    }
    
    let requestedYear = intentResult?.query_builder?.params?.year;
    let requestedGeo = intentResult?.query_builder?.params?.geo || null;

    // If user confirms ("ya", "ya interpretasikan") and we have prev context, use that year/geo
    if (isConfirm && prevUiMeta) {
      const prevContext = extractContextFromPrevUiMeta(prevUiMeta);
      if (!requestedYear && prevContext.year) requestedYear = prevContext.year;
      if (!requestedGeo && prevContext.geo) requestedGeo = prevContext.geo;
    }
    
    // Inherit year from previous context if not specified (PERIOD INHERITANCE)
    if (!requestedYear && shouldPreferPrevCandidates && prevUiMeta) {
      const prevContext = extractContextFromPrevUiMeta(prevUiMeta);
      if (prevContext.year) requestedYear = prevContext.year;
    }

    // Also check effective query for geo patterns
    if (!requestedGeo) {
      const geoMatch = effectiveUserQuery.toLowerCase().match(/\b(kepsul|halsel|halut|halbar|haltim|halteng|tikep|kepulauan\s*sula|halmahera\s*(selatan|utara|barat|timur|tengah)|tidore\s*kepulauan|ternate|morotai|taliabu)\b/);
      if (geoMatch) requestedGeo = geoMatch[1].replace(/\s+/g, ' ');
    }

    // Check if user wants comparison with all regions (provinsi/kabupaten lain)
    // If so, clear geo filter to show all data AND prefer datasource with provinsi total
    const wantsProvinsiComparison = /\bbandingkan\s+(dengan\s+)?provinsi/i.test(clippedUserText);
    const wantsAllRegions = wantsProvinsiComparison ||
                           /\bbandingkan\s+(dengan\s+)?(kabupaten|kota|wilayah)\s*(lain)?/i.test(clippedUserText) ||
                           /\b(semua|seluruh)\s+(kabupaten|kota|wilayah)/i.test(clippedUserText) ||
                           /\bper\s+(kabupaten|kota)/i.test(clippedUserText);
    if (wantsAllRegions && requestedGeo) {
      requestedGeo = null; // Clear geo filter to show all regions
    }

    // If user wants provinsi comparison, try to find a datasource variant that has provinsi total
    // Map of interop sources to their dynamic equivalents with provinsi total
    const provinsiSourceMap = {
      297: 307, // PDRB Kab/Kota interop -> PDRB Kab/Kota dynamic (has Maluku Utara total)
      294: 307, // PDRB per Kapita -> same
    };
    if (wantsProvinsiComparison && selectedSourceId && provinsiSourceMap[selectedSourceId]) {
      selectedSourceId = provinsiSourceMap[selectedSourceId];
      // Also update candidates[0] if needed for consistency
      if (candidates.length > 0 && candidates[0].id !== selectedSourceId) {
        const altCandidate = candidates.find(c => c.id === selectedSourceId);
        if (altCandidate) {
          candidates.unshift(altCandidate);
        }
      }
    }

    // =========================================================================
    // EXIM-SPECIFIC HANDLING
    // Detect EXIM queries and apply group-by (komoditas/negara/pelabuhan) logic
    // =========================================================================
    const selectedSourceType = candidates[0]?.type || intentResult?.datasource?.type || 'dynamic';
    const isEximQuery = selectedSourceType === 'exim' || 
                        /\b(ekspor|impor|exim)\b/i.test(effectiveUserQuery);
    
    let eximGroup = null;
    let eximFacets = {};
    let eximMonth = null;
    let eximMode = null; // 'ekspor' or 'impor'
    
    if (isEximQuery) {
      // Detect ekspor/impor mode
      eximMode = detectEximModeFromQuery(effectiveUserQuery);
      
      // Detect grouping intent (komoditas/negara/pelabuhan)
      eximGroup = inferEximGroupFromQuery(effectiveUserQuery);
      
      // Extract facets (specific country/port/hs code filters)
      eximFacets = extractEximQueryFacets(effectiveUserQuery);
      
      // Extract month if specified
      eximMonth = extractEximMonth(effectiveUserQuery) || 
                  intentResult?.query_builder?.params?.month || null;
      
      // If asking about "terbanyak/tertinggi" without explicit grouping, default to hs2
      if (!eximGroup && /\b(terbanyak|tertinggi|terbesar|terendah)\b/i.test(effectiveUserQuery)) {
        eximGroup = 'hs2';
      }
      
      // EXIM SOURCE PREFERENCE: When user wants komoditas/negara/pelabuhan breakdown,
      // prefer the actual EXIM source (159/160) over generic dynamic sources like "Nilai dan Volume Ekspor" (330)
      // because only EXIM sources have the detailed HS2/CTR/POD data
      if (eximGroup && candidates.length > 0) {
        const eximSourceId = eximMode === 'impor' ? 160 : 159;
        const eximCandidate = candidates.find(c => c.id === eximSourceId);
        
        if (eximCandidate && selectedSourceId !== eximSourceId) {
          // Swap to use EXIM source for grouped queries
          selectedSourceId = eximSourceId;
          
          // Move EXIM candidate to front of list
          const eximIdx = candidates.findIndex(c => c.id === eximSourceId);
          if (eximIdx > 0) {
            const [moved] = candidates.splice(eximIdx, 1);
            candidates.unshift(moved);
          }
        }
      }
    }

    // CONFIDENCE-BASED TABLE DISPLAY:
    // Only show preview if top candidate has good relevance score
    // This prevents showing unrelated tables for vague queries
    const topCandidateScore = candidates[0]?.score || 0;
    const topCandidateName = (candidates[0]?.name || '').toLowerCase();
    const isHighConfidence = topCandidateScore >= 80;  // High confidence - show table normally
    const isMediumConfidence = topCandidateScore >= 70 && topCandidateScore < 80; // Medium - show with caution
    const isLowConfidence = topCandidateScore < 70;    // Low - don't show table, only candidates
    
    // TOPIC RELEVANCE CHECK: If there's a conversation topic (e.g. "inflasi"),
    // only show table if top candidate is related to that topic
    // This prevents "kepulauan sula" → "Tempat Peribadatan" when discussing inflasi
    let isTopicRelevant = true;
    if (conversationTopic && candidates.length > 0) {
      const topicLower = conversationTopic.toLowerCase();
      // Check if top candidate contains the topic keyword
      isTopicRelevant = topCandidateName.includes(topicLower);
      // Also accept if candidate name is a known synonym/related term
      const topicSynonyms = {
        'inflasi': ['inflasi', 'ihk', 'indeks harga', 'harga konsumen'],
        'kemiskinan': ['kemiskinan', 'miskin', 'penduduk miskin', 'garis kemiskinan'],
        'penduduk': ['penduduk', 'populasi', 'kependudukan', 'jumlah penduduk'],
        'pengangguran': ['pengangguran', 'tpt', 'angkatan kerja', 'tenaga kerja'],
        'pdrb': ['pdrb', 'produk domestik', 'pertumbuhan ekonomi'],
      };
      const synonyms = topicSynonyms[topicLower] || [topicLower];
      isTopicRelevant = synonyms.some(syn => topCandidateName.includes(syn));
    }
    
    const shouldShowPreview = topCandidateScore >= 70 && isTopicRelevant; // Must be relevant AND confident

    // Check for period range (e.g., "2020-2024", "2023 sampai 2025")
    const periodRange = extractPeriodRange(intentResult?.query_builder);
    let isRangeQuery = periodRange !== null && periodRange.years && periodRange.years.length > 1;
    
    // PERIOD RANGE HANDLING: Fetch and merge data from multiple years
    if (selectedSourceId && isRangeQuery && shouldShowPreview) {
      const rangeProcessed = await getProcessedPreviewForRange({
        sourceId: selectedSourceId,
        years: periodRange.years,
        geo: requestedGeo,
      });

      if (rangeProcessed && rangeProcessed.data.length > 0) {
        // Generate year label based on whether it's specific years or continuous range
        let yearLabel;
        if (periodRange.isSpecificYears && rangeProcessed.availableYears.length > 0) {
          // Specific years: show comma-separated (e.g., "2020, 2022, 2024")
          yearLabel = rangeProcessed.availableYears.join(', ');
        } else if (rangeProcessed.availableYears.length > 0) {
          // Continuous range: show range format (e.g., "2020-2024")
          yearLabel = rangeProcessed.availableYears.length === 1
            ? String(rangeProcessed.availableYears[0])
            : `${rangeProcessed.availableYears[0]}-${rangeProcessed.availableYears[rangeProcessed.availableYears.length - 1]}`;
        } else {
          yearLabel = periodRange.isSpecificYears
            ? periodRange.years.join(', ')
            : `${periodRange.yearStart}-${periodRange.yearEnd}`;
        }
        
        dataPreview = {
          title: `${rangeProcessed.source} • ${yearLabel}${requestedGeo ? ` • ${requestedGeo}` : ''}`,
          columns: rangeProcessed.columns.slice(0, 12),
          rows: rangeProcessed.data.slice(0, 30), // Allow more rows for range queries
          total_rows: rangeProcessed.data.length,
          geo: requestedGeo,
          from: rangeProcessed.from,
          periodRange: {
            requested: { start: periodRange.yearStart, end: periodRange.yearEnd, isSpecificYears: periodRange.isSpecificYears },
            available: rangeProcessed.availableYears,
          },
        };
        
        // Update requestedYear for href (use the end year for deep links)
        requestedYear = periodRange.yearEnd;
      } else {
        // Range not available - fallback to single year (latest requested)
        isRangeQuery = false;
        requestedYear = periodRange.yearEnd;
      }
    }
    
    // SINGLE YEAR HANDLING (if not range query or range failed)
    if (selectedSourceId && requestedYear && shouldShowPreview && !dataPreview) {
      // EXIM DATA: Use EXIM-specific API with group-by support
      if (isEximQuery) {
        const eximProcessed = await getEximPreviewFromApi({
          sourceId: selectedSourceId,
          year: requestedYear,
          month: eximMonth,
          group: eximGroup,
          codeHs: eximFacets.code_hs || null,
          pod: eximFacets.pod || null,
          ctr: eximFacets.ctr || null,
          metric: null, // Show both value and netweight
        });
        
        if (eximProcessed && eximProcessed.data.length > 0) {
          // Build title with EXIM-specific labels
          const modeLabel = eximMode === 'ekspor' ? 'Ekspor' : 
                           eximMode === 'impor' ? 'Impor' : 'EXIM';
          const groupLabel = eximGroup === 'hs2' ? ' (per Komoditas)' :
                            eximGroup === 'ctr' ? ' (per Negara)' :
                            eximGroup === 'pod' ? ' (per Pelabuhan)' :
                            eximGroup === 'hs2ctr' ? ' (per Komoditas & Negara)' : '';
          const monthLabel = eximMonth ? ` • ${monthNameFromNo(eximMonth)}` : '';
          
          dataPreview = {
            title: `${eximProcessed.source}${groupLabel} • ${requestedYear}${monthLabel}`,
            columns: eximProcessed.columns.slice(0, 12),
            rows: eximProcessed.data.slice(0, 20),
            total_rows: eximProcessed.data.length,
            from: eximProcessed.from,
            eximGroup: eximGroup,
            eximMode: eximMode,
          };
        }
      }
      
      // NON-EXIM DATA: Use regular preview
      if (!dataPreview) {
        const processed = await getProcessedPreviewFromCache({
          sourceId: selectedSourceId,
          year: requestedYear,
          month: intentResult?.query_builder?.params?.month || null,
          geo: requestedGeo,
        });

        if (processed && processed.data.length > 0) {
          dataPreview = {
            title: `${processed.source} • ${requestedYear}${requestedGeo ? ` • ${requestedGeo}` : ''}`,
            columns: processed.columns.slice(0, 12),
            rows: processed.data.slice(0, 20),
            total_rows: processed.data.length,
            geo: requestedGeo,
            from: processed.from,
          };
        }
      }
      
      // Fallback: Data not available for requested year - find nearest available period
      if (!dataPreview) {
        const nearest = await findNearestAvailablePeriod(selectedSourceId, requestedYear);
        if (nearest && nearest.period && nearest.period !== requestedYear) {
          const fallbackProcessed = await getProcessedPreviewFromCache({
            sourceId: selectedSourceId,
            year: nearest.period,
            month: null,
            geo: requestedGeo,
          });
          
          if (fallbackProcessed && fallbackProcessed.data.length > 0) {
            periodFallback = {
              requestedYear,
              actualYear: nearest.period,
              direction: nearest.direction,
            };
            dataPreview = {
              title: `${fallbackProcessed.source} • ${nearest.period}${requestedGeo ? ` • ${requestedGeo}` : ''}`,
              columns: fallbackProcessed.columns.slice(0, 12),
              rows: fallbackProcessed.data.slice(0, 20),
              total_rows: fallbackProcessed.data.length,
              geo: requestedGeo,
              from: fallbackProcessed.from,
              periodFallback,
            };
            // Update requestedYear for href generation
            requestedYear = nearest.period;
          }
        }
      }
    } else if (selectedSourceId && !requestedYear) {
      // No year specified - try to get latest available
      const latest = await findNearestAvailablePeriod(selectedSourceId, null);
      if (latest && latest.period) {
        const latestProcessed = await getProcessedPreviewFromCache({
          sourceId: selectedSourceId,
          year: latest.period,
          month: null,
          geo: requestedGeo,
        });
        
        if (latestProcessed && latestProcessed.data.length > 0) {
          requestedYear = latest.period;
          dataPreview = {
            title: `${latestProcessed.source} • ${latest.period}${requestedGeo ? ` • ${requestedGeo}` : ''}`,
            columns: latestProcessed.columns.slice(0, 12),
            rows: latestProcessed.data.slice(0, 20),
            total_rows: latestProcessed.data.length,
            geo: requestedGeo,
            from: latestProcessed.from,
          };
        }
      }
    }

    // MULTI-SOURCE MERGE HANDLING:
    // If user asked for "jumlah dan persentase" + kab/kota, check if we can get NEWER data
    // by merging from multiple sources (e.g., 452 + 450 for 2025 instead of 425 for 2024)
    // Trigger conditions:
    // 1. askingDifferentType (user switching from province to kab/kota), OR
    // 2. User explicitly asked for kab/kota data with both metrics in this turn
    const currentMessageLower = String(userMessage || '').toLowerCase();
    const userExplicitlyAskedKabKotaBothMetrics = (() => {
      const lq = currentMessageLower;
      const hasKabKota = /kabupaten|kab\/?kota/i.test(lq);
      const hasBothMetrics = /jumlah.*persentase|persentase.*jumlah|jumlah\s+(dan|&)\s+persentase/i.test(lq);
      return hasKabKota && hasBothMetrics;
    })();
    
    const shouldTriggerMergeLogic = askingDifferentType || userExplicitlyAskedKabKotaBothMetrics;
    
    console.log('[StreamChat] Multi-source merge check:', {
      hasDataPreview: !!dataPreview,
      candidatesCount: candidates.length,
      askingDifferentType,
      userExplicitlyAskedKabKotaBothMetrics,
      shouldTriggerMergeLogic,
      currentMessageLower: currentMessageLower.slice(0, 60),
    });
    
    // ========================================================================
    // MONTHLY BUNDLE MERGE: Check for Inflasi/IHK bundles (Bulan dimension)
    // This runs FIRST before other merges as it has specific region detection
    // ========================================================================
    const detectedMonthlyBundle = detectMonthlyBundle(currentMessageLower, conversationTopic);
    
    if (detectedMonthlyBundle) {
      console.log('[StreamChat] Monthly bundle detected:', detectedMonthlyBundle.id);
      
      const currentYear = new Date().getFullYear();
      const yearsToTry = [requestedYear, currentYear, currentYear - 1, currentYear - 2].filter(Boolean);
      const uniqueYears = [...new Set(yearsToTry)];
      
      let monthlyMergeResult = null;
      let monthlyMergeYear = null;
      
      for (const tryYear of uniqueYears) {
        console.log('[StreamChat] Attempting monthly merge for year:', tryYear);
        
        monthlyMergeResult = await getMonthlyMergePreview({
          bundle: detectedMonthlyBundle,
          year: tryYear,
        });
        
        if (monthlyMergeResult && monthlyMergeResult.data.length > 0) {
          monthlyMergeYear = tryYear;
          console.log('[StreamChat] Monthly merge SUCCESS for year:', tryYear);
          break;
        }
      }
      
      if (monthlyMergeResult && monthlyMergeResult.data.length > 0) {
        console.log('[StreamChat] Using monthly bundle merge:', detectedMonthlyBundle.id, 'year:', monthlyMergeYear);
        
        dataPreview = {
          title: `${detectedMonthlyBundle.name} • ${monthlyMergeYear}`,
          columns: monthlyMergeResult.columns.slice(0, 12),
          rows: monthlyMergeResult.data.slice(0, 20),
          total_rows: monthlyMergeResult.data.length,
          from: monthlyMergeResult.from,
          merged: true,
          bundle: detectedMonthlyBundle.id,
          dimension: 'bulan',
        };
        
        requestedYear = monthlyMergeYear;
        
        // Skip other merge logic since we have monthly bundle result
      }
    }
    
    // ========================================================================
    // EXTENDED BUNDLE MERGE: Check for predefined bundles (IPM+komponen, etc)
    // This runs BEFORE the jumlah+persentase merge logic
    // Only if monthly bundle didn't trigger
    // ========================================================================
    const detectedBundle = !detectedMonthlyBundle ? detectMergeBundle(currentMessageLower, conversationTopic) : null;
    
    if (detectedBundle) {
      console.log('[StreamChat] Extended bundle detected:', detectedBundle.id);
      
      // Try to get data for current year first, then fallback
      const currentYear = new Date().getFullYear();
      const yearsToTry = [requestedYear, currentYear, currentYear - 1, currentYear - 2].filter(Boolean);
      const uniqueYears = [...new Set(yearsToTry)];
      
      let bundleMergeResult = null;
      let bundleMergeYear = null;
      
      for (const tryYear of uniqueYears) {
        console.log('[StreamChat] Attempting bundle merge for year:', tryYear);
        
        bundleMergeResult = await getExtendedMergePreview({
          bundle: detectedBundle,
          year: tryYear,
          geo: requestedGeo,
        });
        
        if (bundleMergeResult && bundleMergeResult.data.length > 0) {
          bundleMergeYear = tryYear;
          console.log('[StreamChat] Bundle merge SUCCESS for year:', tryYear);
          break;
        }
      }
      
      if (bundleMergeResult && bundleMergeResult.data.length > 0) {
        console.log('[StreamChat] Using extended bundle merge:', detectedBundle.id, 'year:', bundleMergeYear);
        
        dataPreview = {
          title: `${detectedBundle.name} • ${bundleMergeYear}${requestedGeo ? ` • ${requestedGeo}` : ''}`,
          columns: bundleMergeResult.columns.slice(0, 12),
          rows: bundleMergeResult.data.slice(0, 20),
          total_rows: bundleMergeResult.data.length,
          geo: requestedGeo,
          from: bundleMergeResult.from,
          merged: true,
          bundle: detectedBundle.id,
        };
        
        // Update requestedYear for UI
        requestedYear = bundleMergeYear;
        
        // Skip the regular jumlah+persentase merge since we already have a bundle
        // (Set a flag to indicate we used bundle merge)
      }
    }
    
    // ========================================================================
    // JUMLAH+PERSENTASE MERGE (original logic - only if no bundle triggered)
    // ========================================================================
    if (dataPreview && candidates.length >= 2 && shouldTriggerMergeLogic && !detectedBundle && !detectedMonthlyBundle) {
      const userAskedBothMetrics = historyArray.some(m => {
        if (m.role !== 'user') return false;
        const content = String(m.content || '').toLowerCase();
        return /jumlah.*persentase|persentase.*jumlah|jumlah\s+(dan|&)\s+persentase/i.test(content);
      }) || userExplicitlyAskedKabKotaBothMetrics;
      
      console.log('[StreamChat] Multi-source merge step 1:', { userAskedBothMetrics });
      
      if (userAskedBothMetrics) {
        // Check if current preview has both jumlah AND persentase columns
        const currentColumns = (dataPreview.columns || []).map(c => String(c).toLowerCase());
        const hasJumlahCol = currentColumns.some(c => c.includes('jumlah'));
        const hasPersentaseCol = currentColumns.some(c => c.includes('persentase') || c.includes('persen'));
        
        // Extract year from current preview title (e.g., "...• 2024")
        const currentPreviewYear = parseInt(String(dataPreview.title || '').match(/\d{4}/)?.[0] || '0', 10);
        const currentYear = new Date().getFullYear();
        const hasOlderData = currentPreviewYear > 0 && currentPreviewYear < currentYear;
        
        // Try to merge if: (1) missing columns, OR (2) current data is from older year
        const shouldTryMerge = (!hasJumlahCol || !hasPersentaseCol) || hasOlderData;
        
        console.log('[StreamChat] Multi-source merge step 2:', {
          hasJumlahCol, hasPersentaseCol, currentPreviewYear, currentYear, hasOlderData, shouldTryMerge,
          previewTitle: String(dataPreview.title || '').slice(0, 60),
          columns: currentColumns.slice(0, 5),
        });
        
        if (shouldTryMerge) {
          // SCALABLE: Extract topic keywords from conversation for candidate matching
          const topicLower = String(conversationTopic || '').toLowerCase();
          const topicKeywords = [];
          let topicLabel = ''; // Human-readable label for title
          
          // Build topic keywords dynamically from conversation topic
          if (topicLower.includes('miskin') || topicLower.includes('kemiskinan')) {
            topicKeywords.push('miskin');
            topicLabel = 'Kemiskinan';
          } else if (topicLower.includes('pengangguran') || topicLower.includes('tpt')) {
            topicKeywords.push('pengangguran', 'tpt');
            topicLabel = 'Pengangguran';
          } else if (topicLower.includes('ipm')) {
            topicKeywords.push('ipm', 'pembangunan manusia');
            topicLabel = 'IPM';
          } else if (topicLower.includes('pdrb')) {
            topicKeywords.push('pdrb');
            topicLabel = 'PDRB';
          } else if (topicLower.includes('penduduk')) {
            topicKeywords.push('penduduk');
            topicLabel = 'Kependudukan';
          } else if (topicLower.includes('inflasi')) {
            topicKeywords.push('inflasi');
            topicLabel = 'Inflasi';
          } else if (topicLower.includes('tenaga kerja') || topicLower.includes('ketenagakerjaan')) {
            topicKeywords.push('tenaga kerja', 'ketenagakerjaan');
            topicLabel = 'Ketenagakerjaan';
          } else if (topicLower.includes('kesehatan')) {
            topicKeywords.push('kesehatan');
            topicLabel = 'Kesehatan';
          } else if (topicLower.includes('pendidikan')) {
            topicKeywords.push('pendidikan');
            topicLabel = 'Pendidikan';
          } else {
            // Fallback: extract keywords from topic
            const words = topicLower.split(/\s+/).filter(w => w.length > 3);
            topicKeywords.push(...words);
            // Capitalize first word for label
            topicLabel = words[0] ? words[0].charAt(0).toUpperCase() + words[0].slice(1) : 'Data';
          }
          
          console.log('[StreamChat] Multi-source merge - topic keywords:', topicKeywords, 'from:', conversationTopic);
          
          // Find candidates that have kab/kota data for jumlah and persentase
          // SCALABLE: Match using topic keywords instead of hardcoded 'miskin'
          const matchesTopic = (name) => {
            if (topicKeywords.length === 0) return true;
            const nameLower = name.toLowerCase();
            return topicKeywords.some(kw => nameLower.includes(kw));
          };
          
          const jumlahCandidate = candidates.find(c => {
            const name = String(c.name || '').toLowerCase();
            const hasJumlah = name.includes('jumlah') && matchesTopic(name) && name.includes('kabupaten');
            const hasPersentase = name.includes('persentase');
            // Prefer sources with ONLY jumlah (not both)
            return hasJumlah && !hasPersentase;
          }) || candidates.find(c => {
            // Fallback: any candidate with jumlah + topic + kabupaten
            const name = String(c.name || '').toLowerCase();
            return name.includes('jumlah') && matchesTopic(name) && name.includes('kabupaten');
          });
          
          const persentaseCandidate = candidates.find(c => {
            const name = String(c.name || '').toLowerCase();
            const hasPersentase = name.includes('persentase') && matchesTopic(name) && name.includes('kabupaten');
            const hasJumlah = name.includes('jumlah');
            // Prefer sources with ONLY persentase (not both)
            return hasPersentase && !hasJumlah;
          }) || candidates.find(c => {
            // Fallback: any candidate with persentase + topic + kabupaten
            const name = String(c.name || '').toLowerCase();
            return name.includes('persentase') && matchesTopic(name) && name.includes('kabupaten');
          });
          
          console.log('[StreamChat] Multi-source merge step 3:', {
            jumlahCandidate: jumlahCandidate?.id,
            jumlahName: String(jumlahCandidate?.name || '').slice(0, 40),
            persentaseCandidate: persentaseCandidate?.id,
            persentaseName: String(persentaseCandidate?.name || '').slice(0, 40),
          });
          
          // Build sources list for merge (prefer dynamic sources which often have newer data)
          const sourcesToMerge = [];
          if (jumlahCandidate) {
            sourcesToMerge.push({ sourceId: jumlahCandidate.id, sourceName: jumlahCandidate.name });
          }
          if (persentaseCandidate && persentaseCandidate.id !== jumlahCandidate?.id) {
            sourcesToMerge.push({ sourceId: persentaseCandidate.id, sourceName: persentaseCandidate.name });
          }
          
          if (sourcesToMerge.length >= 2) {
            // Try to get data for current year first, then fallback to previous years
            const yearsToTry = [currentYear, currentYear - 1, currentYear - 2];
            let mergedPreview = null;
            let successYear = null;
            
            for (const targetYear of yearsToTry) {
              console.log('[StreamChat] Attempting multi-source merge for year:', targetYear, 'sources:', sourcesToMerge.map(s => s.sourceId));
              
              mergedPreview = await getMergedMultiSourcePreview({
                sources: sourcesToMerge,
                year: targetYear,
                geo: requestedGeo,
                topic: topicLabel,  // Pass topic for dynamic column naming
              });
              
              if (mergedPreview && mergedPreview.data.length > 0 && mergedPreview.merged) {
                successYear = targetYear;
                console.log('[StreamChat] Multi-source merge SUCCESS for year:', targetYear);
                break;
              } else {
                console.log('[StreamChat] Multi-source merge FAILED for year:', targetYear, 'merged:', !!mergedPreview?.merged, 'data:', mergedPreview?.data?.length || 0);
              }
            }
            
            if (mergedPreview && mergedPreview.data.length > 0 && mergedPreview.merged && successYear) {
              // Check if merged data is actually newer or more complete
              const mergedHasJumlah = mergedPreview.columns.some(c => String(c).toLowerCase().includes('jumlah'));
              const mergedHasPersentase = mergedPreview.columns.some(c => String(c).toLowerCase().includes('persentase') || String(c).toLowerCase().includes('persen'));
              
              console.log('[StreamChat] Merged preview check:', {
                hasJumlah: mergedHasJumlah,
                hasPersentase: mergedHasPersentase,
                columns: mergedPreview.columns,
                dataLen: mergedPreview.data.length,
              });
              
              if (mergedHasJumlah && mergedHasPersentase) {
                console.log('[StreamChat] Using merged multi-source preview with NEWER data:', successYear, sourcesToMerge.map(s => s.sourceId));
                dataPreview = {
                  title: `Data ${topicLabel} Kabupaten/Kota • ${successYear}${requestedGeo ? ` • ${requestedGeo}` : ''}`,
                  columns: mergedPreview.columns.slice(0, 12),
                  rows: mergedPreview.data.slice(0, 20),
                  total_rows: mergedPreview.data.length,
                  geo: requestedGeo,
                  from: mergedPreview.from,
                  merged: true,
                };
                // Update requestedYear so UI href is correct
                requestedYear = successYear;
              }
            }
          }
        }
      }
    }

    // If user wants provinsi comparison, check if provinsi data exists in current preview
    // If not, try to find from alternative datasource
    let multiSourceDisclaimer = null;
    if (wantsProvinsiComparison && dataPreview && dataPreview.rows) {
      const hasProvinsiRow = dataPreview.rows.some(row => {
        const vals = Object.values(row).map(v => String(v || '').toLowerCase());
        return vals.some(v => v.includes('maluku utara') || v === 'maluku utara');
      });
      
      if (!hasProvinsiRow) {
        // Try to find provinsi data from alternative source
        const altSource = await findProvinsiDatasource(selectedSourceId, conversationTopic);
        if (altSource) {
          const altData = await getProvinsiDataFromAlternative(altSource.sourceId, requestedYear, null);
          if (altData && altData.value !== null && altData.value !== undefined) {
            // Add provinsi row to preview data with disclaimer
            const provinsiRow = { ...dataPreview.rows[0] }; // Copy structure
            Object.keys(provinsiRow).forEach(k => { provinsiRow[k] = null; }); // Clear values
            
            // Set wilayah/region column
            const regionCol = dataPreview.columns.find(c => 
              c.toLowerCase().includes('wilayah') || 
              c.toLowerCase().includes('kabupaten') || 
              c.toLowerCase().includes('kota')
            );
            if (regionCol) {
              provinsiRow[regionCol] = 'Maluku Utara (sumber berbeda)';
            }
            
            // Set value column
            const valueCol = dataPreview.columns.find(c => 
              !c.toLowerCase().includes('wilayah') && 
              !c.toLowerCase().includes('kabupaten') &&
              !c.toLowerCase().includes('tahun')
            );
            if (valueCol) {
              provinsiRow[valueCol] = altData.value;
            }
            
            // Add to preview
            dataPreview.rows.push(provinsiRow);
            dataPreview.total_rows = dataPreview.rows.length;
            
            // Set disclaimer for LLM
            multiSourceDisclaimer = {
              alternativeSourceId: altSource.sourceId,
              alternativeSourceName: altSource.sourceName,
              metric: altData.metric,
              value: altData.value,
            };
          }
        }
      }
    }

    // Send intent/candidates info (use effectiveUserQuery for UI display)
    sendEvent('intent', {
      datasource: intentResult?.datasource || null,
      candidates: candidates.slice(0, 5).map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
      })),
      hasPreview: Boolean(dataPreview),
      effectiveQuery: effectiveUserQuery !== clippedUserText ? effectiveUserQuery : null,
      periodFallback: periodFallback || null,
    });

    // Check if API key available
    if (!apiKey) {
      const fallbackText = 'Saat ini fitur AI belum aktif. Saya tetap bisa bantu mengarahkan ke data yang sesuai berdasarkan database.';
      
      sendEvent('text', { content: fallbackText });
      sendEvent('done', { full_text: fallbackText });

      await saveAssistantMessage(threadId, fallbackText, null, intentResult, candidates, dataPreview, periodFallback, null, null, false, null, userMessage);
      res.end();
      return;
    }

    // ── Pipeline progress status: stage 4 of 5 ──
    sendEvent('status', { message: 'Memuat referensi BRS & publikasi…', stage: 'knowledge' });

    // RAG: Search knowledge base for relevant documents
    let knowledgeContext = [];
    try {
      knowledgeContext = await searchKnowledgeBase(effectiveUserQuery, 3);
    } catch (e) {
      console.warn('[StreamChat] Knowledge search failed:', e.message);
    }

    // If this is a knowledge-type query (non-data) and we have relevant knowledge,
    // skip the data table/preview to avoid showing irrelevant data
    let shouldSkipDataPreview = false;
    const topKnowledgeSimilarity = knowledgeContext[0]?.similarity || 0;
    
    // Check if this looks like a service/procedural query
    const servicePatterns = [
      /\b(layanan|pelayanan)\b/i,
      /\b(prosedur|tata\s*cara|tahap|tahapan|langkah)\b/i,
      /\b(cara\s+(mendapat|mengajukan|memperoleh|daftar|registrasi|akses))\b/i,
      /\b(nol\s*rupiah|rekomendasi\s+statistik)\b/i,
      /\b(pusdatin|pst|perpustakaan|konsultasi)\b/i,
      /\b(persyaratan|syarat)\b/i,
      /\b(sensus|survei|sakernas|susenas|supas)\b/i,
    ];
    const isServiceQuery = servicePatterns.some(p => p.test(effectiveUserQuery));
    
    // Check if this is a procedural FAQ query (broader detection)
    const isProceduralQuery = isProceduralFaqQuery(effectiveUserQuery);
    
    // NEW: If previous context was knowledge mode AND current is short follow-up,
    // stay in knowledge mode (don't show data table)
    const isKnowledgeFollowUp = wasKnowledgeMode && (isConfirm || isFollowUp);
    
    // Determine if this is a service/procedural query WITHOUT good knowledge context
    // Threshold: need at least 45% similarity to trust knowledge
    const KNOWLEDGE_CONFIDENCE_THRESHOLD = 0.45;
    const isServiceQueryWithoutKnowledge = (isServiceQuery || isProceduralQuery) && 
      (knowledgeContext.length === 0 || topKnowledgeSimilarity < KNOWLEDGE_CONFIDENCE_THRESHOLD);
    
    if (isServiceQueryWithoutKnowledge) {
      console.log(`[StreamChat] Service/procedural query without knowledge: "${effectiveUserQuery}" (top similarity: ${topKnowledgeSimilarity.toFixed(2)})`);
    }
    
    // Skip data preview if:
    // 1. Knowledge query with relevant knowledge, OR
    // 2. Follow-up in knowledge mode context, OR
    // 3. Procedural FAQ query (should not show data tables)
    if (knowledgeContext.length > 0 && isKnowledgeTypeQuery(effectiveUserQuery, topKnowledgeSimilarity)) {
      shouldSkipDataPreview = true;
      dataPreview = null;
      candidates = [];
    } else if (isKnowledgeFollowUp) {
      // Stay in knowledge mode for follow-ups like "ya", "apa saja", etc.
      shouldSkipDataPreview = true;
      dataPreview = null;
      candidates = [];
      console.log(`[StreamChat] Knowledge follow-up detected, staying in knowledge mode`);
    } else if (isProceduralQuery) {
      // Procedural FAQ query - skip data preview even without good knowledge match
      shouldSkipDataPreview = true;
      dataPreview = null;
      candidates = [];
      console.log(`[StreamChat] Procedural FAQ query detected, skipping data preview: "${effectiveUserQuery}"`);
    }

    // Get available years info for context (when there are candidates but no preview)
    let availableYearsInfo = null;
    if (!dataPreview && candidates.length > 0) {
      const topCandidate = candidates[0];
      if (topCandidate?.id) {
        try {
          const years = await getAvailableYearsForSource(topCandidate.id);
          if (years.length > 0) {
            // Extract requested year from intent
            const reqYear = intentResult?.query_builder?.params?.year || requestedYear || null;
            availableYearsInfo = {
              years,
              requestedYear: reqYear ? Number(reqYear) : null,
              sourceName: topCandidate.name,
            };
          }
        } catch (e) {
          console.warn('[StreamChat] Failed to get available years:', e.message);
        }
      }
    }

    // Build OpenAI messages with context-aware system prompt
    // Get dynamic prompt fixes from error learning patterns (matched to user query)
    let promptFixes = [];
    let specialHandling = null;
    try {
      if (errorLearningService?.getPromptFixes) {
        promptFixes = await errorLearningService.getPromptFixes(effectiveUserQuery);
      }
      if (errorLearningService?.checkQueryPattern) {
        specialHandling = await errorLearningService.checkQueryPattern(effectiveUserQuery);
        if (specialHandling?.fixContent) {
          // Special-handling patterns get appended to promptFixes with a clear prefix
          promptFixes.push(`[SPECIAL HANDLING — ${specialHandling.patternName}]\n${specialHandling.fixContent}`);
          console.log(`[StreamChat] Special handling pattern matched: ${specialHandling.patternName}`);
        }
      }
    } catch (e) {
      console.warn('[StreamChat] Failed to get prompt fixes:', e.message);
    }

    const openAiMessages = [
      { role: 'system', content: systemPrompt({ 
        hasDataPreview: Boolean(dataPreview),
        hasCandidates: candidates.length > 0,
        lowConfidence: isMediumConfidence || isLowConfidence, // Pass confidence level
        periodFallback: periodFallback || null,
        multiSourceDisclaimer: multiSourceDisclaimer || null,
        promptFixes: promptFixes,
      }) },
      ...buildContextMessages({
        intentResult,
        candidates,
        dataPreview,
        historyMessages: historyArray,
        periodFallback,
        knowledgeContext,
        isServiceQueryWithoutKnowledge,
        availableYearsInfo,
      }),
      { role: 'user', content: effectiveUserQuery },
    ];

    // ── Pipeline progress status: stage 5 of 6 ──
    sendEvent('status', { message: 'Berpikir…', stage: 'thinking' });

    // Stream from proxy (tier: COMPLEX — main reasoning path). Routing via
    // llmChat: handles retry, circuit breaker, abort signal propagation.
    const tier = MODEL_TIERS.COMPLEX;
    const effectiveModel = modelOverride || modelForTier(tier);
    const response = await llmChat({
      model: effectiveModel,
      messages: openAiMessages,
      stream: true,
      max_tokens: 1000,
      temperature: 0.7,
      signal: abortSignal,
      apiKey,
      retries: 2,
      timeoutMs: 30000,
      extraHeaders: threadId ? { 'X-Chat-Session-Id': String(threadId) } : undefined,
    });

    // ── Pipeline progress status: stage 6 of 6 — fired on first response chunk
    let _generatingStatusEmitted = false;
    const fullText = await readLlmChatResponse(response, (content) => {
      if (!_generatingStatusEmitted) {
        _generatingStatusEmitted = true;
        sendEvent('status', { message: 'Menyusun jawaban…', stage: 'generating' });
      }
      sendEvent('text', { content });
    });

    // Build EXIM params object if this is an EXIM query
    const eximParamsForMeta = isEximQuery ? {
      group: eximGroup,
      month: eximMonth,
      facets: eximFacets,
    } : null;

    // Build UI metadata for frontend (pass knowledge mode and topic)
    const uiMeta = buildUIMetadata(intentResult, candidates, dataPreview, periodFallback, null, eximParamsForMeta, shouldSkipDataPreview, conversationTopic);
    
    // Emit malika_ui event for frontend (before done)
    sendEvent('malika_ui', uiMeta);

    // Send completion
    sendEvent('done', { full_text: fullText });

    // Save assistant message with UI metadata (pass userMessage for WhatsApp context)
    await saveAssistantMessage(threadId, fullText, model, intentResult, candidates, dataPreview, periodFallback, null, eximParamsForMeta, shouldSkipDataPreview, conversationTopic, userMessage);

    // Update thread timestamp
    await thread.update({
      last_message_at: now(),
      updated_at: now(),
    });

  } catch (error) {
    console.error('[StreamChat] Error:', error);
    sendEvent('error', { message: error.message || 'Unknown error' });
  } finally {
    res.end();
  }
}

/**
 * Save assistant message with UI metadata
 */
/**
 * Build UI metadata object for frontend rendering
 * @param {Object} intentResult - Intent result from query builder
 * @param {Array} candidates - Data source candidates
 * @param {Object|null} dataPreview - Data preview object
 * @param {Object|null} periodFallback - Period fallback info
 * @param {Array|null} contextualSuggestions - Suggestion chips
 * @param {Object|null} eximParams - EXIM-specific parameters {group, month, facets: {code_hs, pod, ctr}}
 * @param {boolean} isKnowledgeMode - Whether this is a knowledge/service query (not data)
 * @param {string|null} conversationTopic - Current conversation topic for contextual suggestions
 */
function buildUIMetadata(intentResult, candidates, dataPreview, periodFallback = null, contextualSuggestions = null, eximParams = null, isKnowledgeMode = false, conversationTopic = null) {
  // Extract period parameters from intent
  const qb = intentResult?.query_builder;
  // Use fallback period if available (for correct href generation)
  const year = periodFallback?.actualYear || qb?.params?.year || null;
  const month = eximParams?.month || qb?.params?.month || null;
  const geo = qb?.params?.geo || null;
  
  // Build contextual suggestions if not provided
  const suggestions = contextualSuggestions || buildContextualSuggestions({
    conversationTopic: conversationTopic,
    currentSourceName: candidates?.[0]?.name || null,
    requestedYear: year,
    requestedGeo: geo,
    candidates,
    hasDataPreview: Boolean(dataPreview),
    isKnowledgeMode: isKnowledgeMode,
  });

  return {
    v: 1,
    query: qb?.params?.q || intentResult?.query || null,
    preview_mode: dataPreview ? 'auto' : (candidates.length > 0 ? 'confirm' : 'none'),
    candidates: candidates.slice(0, 5).map(c => {
      // Build proper href with all available parameters
      const params = new URLSearchParams();
      params.set('source_id', String(c.id));
      if (c.type) params.set('type', c.type);
      if (year) params.set('period', String(year));
      if (month) params.set('month', String(month));
      if (geo) params.set('geo', geo);
      
      // Include EXIM-specific params for EXIM sources
      const isEximSource = c.type === 'exim' || c.id === 159 || c.id === 160;
      if (isEximSource && eximParams) {
        if (eximParams.group) params.set('group', eximParams.group);
        if (eximParams.facets?.code_hs) params.set('code_hs', eximParams.facets.code_hs);
        if (eximParams.facets?.pod) params.set('pod', eximParams.facets.pod);
        if (eximParams.facets?.ctr) params.set('ctr', eximParams.facets.ctr);
      }
      
      return {
        id: c.id,
        name: c.name,
        type: c.type,
        score: c.score,
        href: `/data?${params.toString()}`,
      };
    }),
    // Include period fallback info in UI meta
    period_fallback: periodFallback || null,
    // Include EXIM info in table for frontend rendering
    table: dataPreview ? {
      kind: 'data',
      title: dataPreview.title,
      columns: dataPreview.columns,
      rows: dataPreview.rows,
      total_rows: dataPreview.total_rows,
      periodRange: dataPreview.periodRange || null,
      eximGroup: dataPreview.eximGroup || null,
      eximMode: dataPreview.eximMode || null,
    } : null,
    // Contextual suggestion chips
    suggestions: suggestions.slice(0, 5),
  };
}

async function saveAssistantMessage(threadId, text, model, intentResult, candidates, dataPreview, periodFallback = null, contextualSuggestions = null, eximParams = null, isKnowledgeMode = false, conversationTopic = null, userMessage = null) {
  // Build UI metadata using helper
  const uiMeta = buildUIMetadata(intentResult, candidates, dataPreview, periodFallback, contextualSuggestions, eximParams, isKnowledgeMode, conversationTopic);

  const uiBlock = `\n\n\`\`\`malika_ui\n${JSON.stringify(uiMeta)}\n\`\`\`\n`;
  
  // Post-process text: convert WhatsApp numbers to clickable links
  // IMPORTANT: Strip any existing malika_ui blocks from LLM output before adding our own
  const cleanedText = stripMalikaUiBlock(String(text || ''));

  // Build context for WhatsApp link pre-fill
  const waContext = {
    threadId,
    userMessage: userMessage || null,
    aiResponse: cleanedText.slice(0, 200), // AI response excerpt
  };
  const processedText = linkifyWhatsAppNumber(cleanedText.trim(), waContext).slice(0, 8000);

  // Cap the LLM interpretation; let uiBlock pass through intact so chat-history
  // replay can parse the fenced JSON. DB column is longtext.
  const assistantContent = `${processedText}${uiBlock}`.trim();

  const savedMessage = await ChatMessage.create({
    thread_id: threadId,
    role: 'assistant',
    content: assistantContent,
    model: model || null,
    created_at: now(),
  });

  // Fire-and-forget auto-flag heuristics — must NOT block the response path
  if (autoFlagService?.detectAutoFlag) {
    setImmediate(async () => {
      try {
        const ChatMessageFlag = require('../../models/ChatMessageFlag.model');
        const recent = await ChatMessage.findAll({
          where: { thread_id: threadId, role: 'assistant', id: { [Op.lt]: savedMessage.id } },
          order: [['id', 'DESC']],
          limit: 2,
          attributes: ['content'],
        });
        const recentContents = recent.map((m) => stripMalikaUiBlock(String(m.content || '')).trim());

        const flagPayload = autoFlagService.detectAutoFlag({
          userQuery: userMessage,
          assistantResponse: processedText,
          intent: intentResult?.intent || 'UNKNOWN',
          candidates: candidates || [],
          dataPreviewRowCount: dataPreview?.rows?.length || 0,
          recentAssistantResponses: recentContents,
        });

        if (flagPayload) {
          await ChatMessageFlag.create({
            ...flagPayload,
            message_id: savedMessage.id,
            thread_id: threadId,
            resolution_status: 'pending',
          });
          console.log(`[StreamChat] auto-flagged msg=${savedMessage.id} type=${flagPayload.flag_type} severity=${flagPayload.severity}`);
        }
      } catch (e) {
        console.warn('[StreamChat] autoFlag hook failed:', e.message);
      }
    });
  }
}

/**
 * Non-streaming fallback (for compatibility)
 */
async function sendMessageNonStreaming({ threadId, userMessage, ownerId }) {
  const apiKey = getOpenAIKey();
  const model = getOpenAIModel();

  const thread = await ChatThread.findOne({
    where: { id: threadId, owner_id: ownerId },
  });

  if (!thread) {
    throw Object.assign(new Error('Thread not found'), { status: 404 });
  }

  // Save user message
  const createdUser = await ChatMessage.create({
    thread_id: threadId,
    role: 'user',
    content: userMessage.slice(0, 8000),
    created_at: now(),
  });

  // Get conversation history for context merging
  const historyMessages = await ChatMessage.findAll({
    where: { thread_id: threadId },
    order: [['id', 'ASC']],
    limit: 20,
  });
  const historyArray = historyMessages.map(m => m.toJSON());

  // Context-aware query merging
  const clippedUserText = userMessage.slice(0, 4000);
  const isConfirm = isConfirmMessage(clippedUserText);
  const isPeriodFragment = isLikelyTimeOrPeriodFragment(clippedUserText);
  const isGeoOnlyFragment = isLikelyGeoOnlyFragment(clippedUserText);
  const lastMeaningful = findLastMeaningfulUserQuery(historyArray);
  const prevUiMeta = findLastAssistantUiMeta(historyArray);

  let effectiveUserQuery = clippedUserText;
  let shouldPreferPrevCandidates = false;
  
  if (isGeoOnlyFragment && lastMeaningful) {
    // GEO-ONLY: merge with topic but force fresh search for geo filter
    effectiveUserQuery = mergeQuery(lastMeaningful, clippedUserText);
    shouldPreferPrevCandidates = false;
  } else if (isConfirm && lastMeaningful) {
    effectiveUserQuery = lastMeaningful;
    shouldPreferPrevCandidates = true;
  } else if (!isConfirm && isPeriodFragment && lastMeaningful) {
    effectiveUserQuery = mergeQuery(lastMeaningful, clippedUserText);
    shouldPreferPrevCandidates = true;
  }

  // Resolve intent using effective query
  let intentResult = null;
  let candidates = [];
  
  try {
    intentResult = await resolveSearchIntent({ q: effectiveUserQuery, context: {} });
  } catch {
    // Continue without intent
  }

  try {
    candidates = await buildDatasourceCandidates({
      q: effectiveUserQuery,
      qb: intentResult?.query_builder || null,
      limit: 12,
    });
    if (!Array.isArray(candidates)) candidates = [];
  } catch {
    candidates = [];
  }

  // Fall back to previous candidates ONLY if we should prefer them (not for geo-only fragments)
  if (shouldPreferPrevCandidates && candidates.length === 0 && prevUiMeta?.candidates?.length > 0) {
    candidates = prevUiMeta.candidates.map(c => ({
      id: c.id,
      name: c.name,
      type: c.type,
      score: c.score || 80,
    }));
  }

  // Get data preview
  let dataPreview = null;
  
  // CANDIDATE-FIRST SOURCE SELECTION (same logic as streaming endpoint):
  // Always prefer candidates[0] over intentResult.datasource.source_id because
  // buildDatasourceCandidates applies better scoring (granularity, relevance, etc.)
  const selectedSourceId = candidates.length > 0 
    ? candidates[0]?.id 
    : intentResult?.datasource?.source_id || null;
  const requestedYear = intentResult?.query_builder?.params?.year;

  if (selectedSourceId && requestedYear) {
    const processed = await getProcessedPreviewFromCache({
      sourceId: selectedSourceId,
      year: requestedYear,
    });

    if (processed && processed.data.length > 0) {
      dataPreview = {
        title: `${processed.source} • ${requestedYear}`,
        columns: processed.columns.slice(0, 12),
        rows: processed.data.slice(0, 20),
        total_rows: processed.data.length,
      };
    }
  }

  // Generate response
  let assistantText = '';

  if (!apiKey) {
    assistantText = 'Saat ini fitur AI belum aktif. Saya tetap bisa bantu mengarahkan ke data yang sesuai.';
  } else {
    const historyMessages = await ChatMessage.findAll({
      where: { thread_id: threadId },
      order: [['id', 'DESC']],
      limit: 16,
    });

    // RAG: Search knowledge base
    let knowledgeContext = [];
    try {
      knowledgeContext = await searchKnowledgeBase(userMessage, 3);
    } catch (e) {
      console.warn('[Chat] Knowledge search failed:', e.message);
    }

    // Check if this is a service query without knowledge
    const topKnowledgeSimilarity = knowledgeContext[0]?.similarity || 0;
    const servicePatterns = [
      /\b(layanan|pelayanan)\b/i,
      /\b(prosedur|tata\s*cara|tahap|tahapan|langkah)\b/i,
      /\b(cara\s+(mendapat|mengajukan|memperoleh|daftar|registrasi|akses))\b/i,
      /\b(nol\s*rupiah|rekomendasi\s+statistik)\b/i,
      /\b(pusdatin|pst|perpustakaan|konsultasi)\b/i,
      /\b(persyaratan|syarat)\b/i,
    ];
    const isServiceQuery = servicePatterns.some(p => p.test(userMessage));
    const isServiceQueryWithoutKnowledge = isServiceQuery && 
      (knowledgeContext.length === 0 || topKnowledgeSimilarity < 0.45);

    // Get available years info for context (when there are candidates but no preview)
    let availableYearsInfo = null;
    if (!dataPreview && candidates.length > 0) {
      const topCandidate = candidates[0];
      if (topCandidate?.id) {
        try {
          const years = await getAvailableYearsForSource(topCandidate.id);
          if (years.length > 0) {
            const reqYear = intentResult?.query_builder?.params?.year || null;
            availableYearsInfo = {
              years,
              requestedYear: reqYear ? Number(reqYear) : null,
              sourceName: topCandidate.name,
            };
          }
        } catch (e) {
          console.warn('[Chat] Failed to get available years:', e.message);
        }
      }
    }

    const openAiMessages = [
      { role: 'system', content: systemPrompt({ hasDataPreview: Boolean(dataPreview), hasCandidates: candidates.length > 0, lowConfidence: false }) },
      ...buildContextMessages({
        intentResult,
        candidates,
        dataPreview,
        historyMessages: historyMessages.reverse().map(m => m.toJSON()),
        knowledgeContext,
        isServiceQueryWithoutKnowledge,
        availableYearsInfo,
      }),
      { role: 'user', content: userMessage },
    ];

    try {
      // Non-streaming follow-up (tier: SIMPLE — cheap model is fine).
      // No response stream here, so no abort signal is plumbed in.
      const tier = MODEL_TIERS.SIMPLE;
      const effectiveModel = modelForTier(tier);
      const response = await llmChat({
        model: effectiveModel,
        messages: openAiMessages,
        stream: false,
        max_tokens: 1000,
        temperature: 0.7,
        apiKey,
        retries: 2,
        timeoutMs: 30000,
        extraHeaders: threadId ? { 'X-Chat-Session-Id': String(threadId) } : undefined,
      });

      const data = await response.json();
      assistantText = data.choices?.[0]?.message?.content || '';
    } catch (error) {
      console.error('[NonStreaming] All retries failed:', error.message);
      assistantText = 'Maaf, terjadi gangguan saat menyusun jawaban. Coba lagi sebentar.';
    }
  }

  // Save assistant message (pass userMessage for WhatsApp context)
  await saveAssistantMessage(threadId, assistantText, model, intentResult, candidates, dataPreview, null, null, null, false, null, userMessage);

  // Update thread
  await thread.update({
    last_message_at: now(),
    updated_at: now(),
  });

  return {
    user: createdUser.toJSON(),
    assistantText,
    intentResult,
    candidates,
    dataPreview,
  };
}

module.exports = {
  streamChatResponse,
  sendMessageNonStreaming,
  systemPrompt,
  isKnowledgeTypeQuery,
  stripMarkdownFormatting,
};
