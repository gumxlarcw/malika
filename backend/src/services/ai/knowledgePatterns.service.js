/**
 * Knowledge Patterns Service
 * Automatically extract FAQ/procedural topics from knowledge base documents
 * and keep the procedural query patterns up-to-date
 * 
 * This service scans knowledge base documents and extracts key topics/phrases
 * that should be treated as procedural/FAQ queries (not data queries)
 */

const KnowledgeBase = require('../../models/KnowledgeBase.model');
const { Op } = require('sequelize');

// Cache for extracted patterns
let cachedPatterns = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Base patterns that are always included (hardcoded essential patterns)
const BASE_PROCEDURAL_PATTERNS = [
  // Who/what/where questions about BPS/people/organization
  /\b(siapa|who)\s+(kepala|pimpinan|direktur|wakil|sekretaris)/i,
  /\b(siapa)\s+.*(bps|badan\s*pusat\s*statistik)/i,
  /\b(apa\s+itu|apakah|pengertian|definisi)\s+\w+/i,
  /\b(dimana|where|lokasi|alamat)\s+(kantor|bps|pelayanan)/i,
  // How-to procedural questions
  /\b(cara|bagaimana|how\s+to)\s+(mengunduh|download|mendapatkan|mengakses|mengajukan|daftar|registrasi)/i,
  /\b(cara|bagaimana|how)\s+(menggunakan|memakai|akses)/i,
  /\b(mekanisme|prosedur|tata\s*cara|langkah|tahap|alur)\s+\w+/i,
  // Contact/hours questions
  /\b(jam\s+(buka|kerja|operasional)|jadwal\s+pelayanan)\b/i,
  /\b(nomor\s+(telepon|hp|wa|whatsapp)|kontak|hubungi)\b/i,
  // Requirements/rules questions
  /\b(syarat|persyaratan|ketentuan|aturan)\s+(untuk|layanan|akses|data)/i,
  // General info about BPS
  /\b(tugas|fungsi|visi|misi)\s+(bps|badan)/i,
  /\b(sejarah|profil)\s+(bps|kantor)/i,
  // Layanan/service keywords with variants
  /\b(layanan|pelayanan)\s+(nol|0|gratis)\s*(rupiah)?\b/i,
  /\b(nol|0)\s*rupiah\b/i,
  /\b(tarif|biaya)\s+(layanan|data|publikasi)\b/i,
  // BPS service questions (catch-all for "layanan BPS", "layanan lainnya", etc.)
  /\b(layanan|pelayanan)\s+(bps|statistik|lain(nya)?|apa\s+saja)\b/i,
  /^layanan\s+bps\b/i,
  /^layanan\s+(lain|lainnya)\b/i,
  /\b(apa\s+saja|daftar)\s+(layanan|pelayanan)\b/i,
  /\b(jenis|macam)\s+(layanan|pelayanan)\b/i,
];

// Dynamic patterns extracted from knowledge base (title-based)
const DYNAMIC_TOPIC_EXTRACTORS = [
  // Extract service names from titles
  { pattern: /layanan\s+(\w+)/gi, type: 'service' },
  { pattern: /^(transdata|allstats|silastik|romanis|sirusa|webapi)\b/gi, type: 'service' },
  { pattern: /sensus\s+(\w+)/gi, type: 'event' },
  { pattern: /survei\s+(\w+)/gi, type: 'event' },
  { pattern: /cara\s+(\w+)/gi, type: 'howto' },
  { pattern: /profil\s+(\w+)/gi, type: 'info' },
  { pattern: /alamat|kontak|hubungi/gi, type: 'contact' },
  { pattern: /tarif|biaya|harga|nol\s*rupiah/gi, type: 'fee' },
  { pattern: /pengaduan|komplain|aduan/gi, type: 'complaint' },
  { pattern: /faq|pertanyaan\s+umum|tanya\s+jawab/gi, type: 'faq' },
];

/**
 * Extract topics from a knowledge base document title
 * Returns array of topic strings
 */
function extractTopicsFromTitle(title) {
  const topics = [];
  const normalizedTitle = String(title || '').toLowerCase();
  
  // Clean up title (remove chunk markers like "(1/5)")
  const cleanTitle = normalizedTitle.replace(/\s*\(\d+\/\d+\)\s*/g, '').trim();
  
  // Direct keyword matches from title
  const directKeywords = [
    'transdata', 'allstats', 'silastik', 'romanis', 'sirusa', 'webapi',
    'sensus', 'survei', 'pst', 'pusdatin',
    'nol rupiah', 'gratis', 'tarif',
    'alamat', 'kontak', 'telepon',
    'pejabat', 'kepala', 'profil',
    'pengaduan', 'aduan',
    'visi', 'misi', 'tugas', 'fungsi', 'sejarah', 'logo',
    'rekomendasi', 'statistik nasional',
    'pengolahan data', 'unduh', 'download',
  ];
  
  for (const keyword of directKeywords) {
    if (cleanTitle.includes(keyword)) {
      topics.push(keyword);
    }
  }
  
  // Extract composite phrases
  const compositePatterns = [
    /layanan\s+(\w+\s*\w*)/gi,
    /sensus\s+(\w+)/gi,
    /survei\s+(\w+)/gi,
    /cara\s+(\w+\s*\w*\s*\w*)/gi,
    /tata\s+cara\s+(\w+)/gi,
    /pelayanan\s+(\w+\s*\w*)/gi,
  ];
  
  for (const pattern of compositePatterns) {
    const matches = cleanTitle.matchAll(pattern);
    for (const match of matches) {
      if (match[1]) {
        topics.push(match[0].trim());
      }
    }
  }
  
  return [...new Set(topics)]; // Remove duplicates
}

/**
 * Extract key phrases from document content
 * Focus on first paragraph and section headers
 */
function extractTopicsFromContent(content, maxPhrases = 5) {
  const topics = [];
  const text = String(content || '').toLowerCase();
  
  // Extract first meaningful sentence (often contains topic)
  const firstLines = text.split('\n').slice(0, 5).join(' ').slice(0, 500);
  
  // Look for service/system names in content
  const servicePatterns = [
    /\b(transdata|allstats|silastik|sirusa|romanis|webapi|pusdatin|pst)\b/gi,
    /\b(sensus\s+ekonomi|sensus\s+penduduk|sensus\s+pertanian)\b/gi,
    /\b(layanan\s+\w+\s*\w*)\b/gi,
    /\b(nol\s*rupiah|gratis|tarif)\b/gi,
  ];
  
  for (const pattern of servicePatterns) {
    const matches = firstLines.matchAll(pattern);
    for (const match of matches) {
      topics.push(match[0].trim());
    }
  }
  
  // Extract important nouns related to BPS services
  const importantNouns = [
    'registrasi', 'login', 'akun', 'permintaan', 'pengajuan',
    'publikasi', 'produk statistik', 'data mikro',
    'perpustakaan', 'kunjungan', 'konsultasi',
    'rekomendasi', 'surat keterangan',
  ];
  
  for (const noun of importantNouns) {
    if (firstLines.includes(noun)) {
      topics.push(noun);
    }
  }
  
  return [...new Set(topics)].slice(0, maxPhrases);
}

/**
 * Build dynamic regex patterns from extracted topics
 * These patterns will match procedural/FAQ queries
 */
function buildDynamicPatterns(topics) {
  const patterns = [];
  
  for (const topic of topics) {
    // Skip very short topics
    if (topic.length < 3) continue;
    
    // Escape special regex characters
    const escaped = topic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Create patterns for common question forms
    // "apa itu transdata" / "transdata itu apa"
    patterns.push(new RegExp(`\\b(apa\\s+itu|apakah|pengertian)\\s+${escaped}\\b`, 'i'));
    patterns.push(new RegExp(`\\b${escaped}\\s+(itu\\s+apa|adalah)\\b`, 'i'));
    
    // "bagaimana transdata" / "cara transdata"
    patterns.push(new RegExp(`\\b(bagaimana|cara|mekanisme|prosedur)\\s+(${escaped}|.{0,20}${escaped})\\b`, 'i'));
    
    // "transdata bps" / "layanan transdata"
    patterns.push(new RegExp(`\\b${escaped}\\s+(bps|statistik|layanan)?\\b`, 'i'));
    
    // Direct mention of the topic keyword
    if (topic.length >= 5) {
      patterns.push(new RegExp(`\\b${escaped}\\b`, 'i'));
    }
  }
  
  return patterns;
}

/**
 * Get all procedural patterns (base + dynamic from knowledge base)
 * Caches result for performance
 */
async function getProceduralPatterns() {
  const now = Date.now();
  
  // Return cached if fresh
  if (cachedPatterns && (now - cacheTime) < CACHE_TTL) {
    return cachedPatterns;
  }
  
  try {
    // Fetch all knowledge base documents (root documents only)
    const docs = await KnowledgeBase.findAll({
      where: { parent_id: null, status: 'ready' },
      attributes: ['id', 'title', 'content', 'category'],
      raw: true,
    });
    
    // Extract topics from all documents
    const allTopics = new Set();
    
    for (const doc of docs) {
      // Extract from title
      const titleTopics = extractTopicsFromTitle(doc.title);
      titleTopics.forEach(t => allTopics.add(t));
      
      // Extract from content (limited)
      const contentTopics = extractTopicsFromContent(doc.content, 3);
      contentTopics.forEach(t => allTopics.add(t));
    }
    
    console.log(`[KnowledgePatterns] Extracted ${allTopics.size} unique topics from ${docs.length} documents`);
    
    // Build dynamic patterns
    const dynamicPatterns = buildDynamicPatterns([...allTopics]);
    
    // Combine base + dynamic patterns
    cachedPatterns = {
      base: BASE_PROCEDURAL_PATTERNS,
      dynamic: dynamicPatterns,
      topics: [...allTopics],
      all: [...BASE_PROCEDURAL_PATTERNS, ...dynamicPatterns],
      updatedAt: now,
    };
    cacheTime = now;
    
    return cachedPatterns;
  } catch (e) {
    console.error('[KnowledgePatterns] Error loading patterns:', e.message);
    // Return base patterns if error
    return {
      base: BASE_PROCEDURAL_PATTERNS,
      dynamic: [],
      topics: [],
      all: BASE_PROCEDURAL_PATTERNS,
      updatedAt: now,
    };
  }
}

/**
 * Check if a query matches any procedural/FAQ pattern
 * Uses both base and dynamic patterns from knowledge base
 */
async function isProceduralQuery(query) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return false;
  
  const patterns = await getProceduralPatterns();
  
  // Check all patterns
  for (const pattern of patterns.all) {
    if (pattern.test(q)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if query matches procedural pattern (synchronous version using cached patterns)
 * Use this in streaming.service.js for performance
 */
function isProceduralQuerySync(query) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return false;
  
  // Always check base patterns (no async needed)
  for (const pattern of BASE_PROCEDURAL_PATTERNS) {
    if (pattern.test(q)) {
      return true;
    }
  }
  
  // Check cached dynamic patterns if available
  if (cachedPatterns && cachedPatterns.dynamic) {
    for (const pattern of cachedPatterns.dynamic) {
      if (pattern.test(q)) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Invalidate the patterns cache
 * Call this when knowledge base documents are added/updated/deleted
 */
function invalidateCache() {
  cachedPatterns = null;
  cacheTime = 0;
  console.log('[KnowledgePatterns] Cache invalidated');
}

/**
 * Preload patterns cache (call on startup or after document changes)
 */
async function preloadPatterns() {
  const patterns = await getProceduralPatterns();
  console.log(`[KnowledgePatterns] Preloaded ${patterns.all.length} patterns (${patterns.base.length} base, ${patterns.dynamic.length} dynamic)`);
  return patterns;
}

/**
 * Get topics that were extracted from knowledge base
 * Useful for debugging/admin UI
 */
async function getExtractedTopics() {
  const patterns = await getProceduralPatterns();
  return patterns.topics;
}

module.exports = {
  getProceduralPatterns,
  isProceduralQuery,
  isProceduralQuerySync,
  invalidateCache,
  preloadPatterns,
  getExtractedTopics,
  extractTopicsFromTitle,
  extractTopicsFromContent,
  BASE_PROCEDURAL_PATTERNS,
};
