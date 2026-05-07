/**
 * Chat Helpers
 * 
 * Utility functions for chat message processing, formatting,
 * greeting detection, and contextual suggestions.
 */

const { now: nowDate } = require('../../../utils/dateHelper');

// ============================================================================
// TEXT FORMATTING
// ============================================================================

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

// ============================================================================
// GREETING DETECTION
// ============================================================================

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

// ============================================================================
// SUGGESTION BUILDERS
// ============================================================================

/**
 * Build contextual suggestion chips for greeting response
 * - For new chat: suggest popular data topics
 * - For existing conversation: suggest follow-up based on previous topic
 */
function buildGreetingSuggestions(historyArray, conversationTopic) {
  // Default suggestions for new chat (popular data topics)
  const newChatSuggestions = [
    'Data penduduk',
    'Data kemiskinan',
    'Data inflasi',
    'Data pengangguran',
    'Data PDRB',
  ];
  
  // If there's a previous topic, suggest follow-ups
  if (conversationTopic) {
    const topicSuggestions = [
      `Lanjutkan tentang ${conversationTopic}`,
      `Data ${conversationTopic} terbaru`,
      `${conversationTopic} menurut kabupaten/kota`,
    ];
    return [...topicSuggestions.slice(0, 2), ...newChatSuggestions.slice(0, 3)];
  }
  
  return newChatSuggestions;
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
    } else {
      // Generic knowledge suggestions
      suggestions.push('Layanan BPS lainnya');
      suggestions.push('Kontak BPS Malut');
      suggestions.push('Data penduduk');
    }
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
  } else {
    // No candidates, suggest popular topics
    suggestions.push('Data penduduk');
    suggestions.push('Data kemiskinan');
    suggestions.push('Data inflasi');
  }
  
  return suggestions.slice(0, 5);
}

// ============================================================================
// CONTEXT DETECTION
// ============================================================================

/**
 * Check if message is a confirmation (e.g. "ya", "ok", "tampilkan datanya")
 */
function isConfirmMessage(raw) {
  const t = String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return false;
  
  const confirmPatterns = [
    /^(ya|iya|yup|yep|yes|ok|oke|okay)(\s|$)/,
    /^lanjut(kan)?(\s|$)/,
    /^boleh(\s|$)/,
    /^silakan(\s|$)/,
    /^silahkan(\s|$)/,
    /^tampilkan(\s|$)/,
    /^lihat(kan)?(\s|$)/,
    /^show(\s|$)/,
  ];
  
  for (const pattern of confirmPatterns) {
    if (pattern.test(t)) return true;
  }
  
  return false;
}

/**
 * Check if previous context was in knowledge mode
 */
function isPrevContextKnowledgeMode(prevUiMeta, historyArray) {
  // Check prevUiMeta for knowledge indicators
  if (prevUiMeta) {
    if (prevUiMeta.preview_mode === 'knowledge') return true;
    if (prevUiMeta.knowledge_docs && prevUiMeta.knowledge_docs.length > 0) return true;
    if (prevUiMeta.was_knowledge_mode) return true;
  }
  
  // Also check last assistant message for knowledge-related content
  if (Array.isArray(historyArray) && historyArray.length > 0) {
    const lastAssistant = historyArray.filter(m => m.role === 'assistant').pop();
    if (lastAssistant?.content) {
      const content = String(lastAssistant.content).toLowerCase();
      // Check for knowledge mode indicators in content
      if (content.includes('pelayanan statistik terpadu') ||
          content.includes('layanan bps') ||
          content.includes('cara mengakses') ||
          content.includes('prosedur') ||
          content.includes('persyaratan')) {
        return true;
      }
    }
  }
  
  return false;
}

// ============================================================================
// HELPER UTILITIES
// ============================================================================

/**
 * Get current timestamp
 */
function now() {
  return nowDate();
}

/**
 * Parse UI metadata from raw assistant content
 */
function parseUiMetaFromContent(rawContent) {
  if (!rawContent) return null;
  
  const match = String(rawContent).match(/```\s*malika_ui\s*([\s\S]*?)\s*```/i);
  if (!match || !match[1]) return null;
  
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

module.exports = {
  // Text formatting
  stripMarkdownFormatting,
  linkifyWhatsAppNumber,
  stripMalikaUiBlock,
  
  // Greeting detection
  isGreeting,
  
  // Suggestion builders
  buildGreetingSuggestions,
  buildContextualSuggestions,
  
  // Context detection
  isConfirmMessage,
  isPrevContextKnowledgeMode,
  
  // Utilities
  now,
  parseUiMetaFromContent,
};
