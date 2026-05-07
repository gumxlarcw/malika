/**
 * Response Formatter Service
 * 
 * Standardizes MALIKA chat responses with consistent formatting.
 * Goals:
 * - Structured templates for different response types
 * - Optimized length (target: <500 chars simple, <1000 chars data)
 * - Reduce WhatsApp fallback overuse
 */

// ============================================================================
// RESPONSE TEMPLATES
// ============================================================================

/**
 * Format data response with structured layout
 * @param {object} options
 * @param {string} options.title - Data title
 * @param {string} options.period - Period (e.g., "2024", "Triwulan 2 2025")
 * @param {Array} options.data - Data rows [{label, value, unit}]
 * @param {string} options.source - Data source
 * @param {string} options.insight - Optional insight/summary
 * @param {number} options.maxRows - Max rows to display (default 10)
 * @returns {string}
 */
function formatDataResponse({ title, period, data, source, insight, maxRows = 10 }) {
  const lines = [];
  
  // Header
  lines.push(`📊 **${title}**`);
  if (period) {
    lines.push(`📅 Periode: ${period}`);
  }
  lines.push('');
  
  // Insight first (if provided)
  if (insight) {
    lines.push(insight);
    lines.push('');
  }
  
  // Data section
  if (Array.isArray(data) && data.length > 0) {
    const displayData = data.slice(0, maxRows);
    displayData.forEach(row => {
      const unit = row.unit ? ` ${row.unit}` : '';
      const value = formatNumber(row.value);
      lines.push(`• ${row.label}: **${value}**${unit}`);
    });
    
    if (data.length > maxRows) {
      lines.push(`\n_...dan ${data.length - maxRows} data lainnya_`);
    }
  }
  
  // Source
  lines.push('');
  lines.push(`📌 Sumber: ${source || 'BPS Provinsi Maluku Utara'}`);
  
  return lines.join('\n');
}

/**
 * Format comparison response (multiple items)
 * @param {object} options
 * @param {string} options.title - Comparison title
 * @param {Array} options.items - Items to compare [{name, value, unit, change}]
 * @param {string} options.period - Period
 * @param {string} options.insight - Optional insight
 * @returns {string}
 */
function formatComparisonResponse({ title, items, period, insight }) {
  const lines = [];
  
  lines.push(`📊 **${title}**`);
  if (period) {
    lines.push(`📅 Periode: ${period}`);
  }
  lines.push('');
  
  // Comparison table-like format
  if (Array.isArray(items) && items.length > 0) {
    items.forEach(item => {
      const value = formatNumber(item.value);
      const unit = item.unit ? ` ${item.unit}` : '';
      let changeText = '';
      
      if (item.change !== undefined && item.change !== null) {
        const changeNum = parseFloat(item.change);
        if (!isNaN(changeNum)) {
          const arrow = changeNum > 0 ? '↑' : changeNum < 0 ? '↓' : '→';
          changeText = ` (${arrow}${Math.abs(changeNum).toFixed(2)}%)`;
        }
      }
      
      lines.push(`• ${item.name}: **${value}**${unit}${changeText}`);
    });
  }
  
  // Insight
  if (insight) {
    lines.push('');
    lines.push(`💡 ${insight}`);
  }
  
  return lines.join('\n');
}

/**
 * Format FAQ/service response
 * @param {object} options
 * @param {string} options.answer - Direct answer
 * @param {Array} options.steps - Action steps (optional)
 * @param {string} options.contact - Contact info (optional)
 * @returns {string}
 */
function formatFaqResponse({ answer, steps, contact }) {
  const lines = [];
  
  // Direct answer first
  lines.push(answer);
  
  // Action steps
  if (Array.isArray(steps) && steps.length > 0) {
    lines.push('');
    lines.push('**Langkah-langkah:**');
    steps.forEach((step, i) => {
      lines.push(`${i + 1}. ${step}`);
    });
  }
  
  // Contact
  if (contact) {
    lines.push('');
    lines.push(`📞 ${contact}`);
  }
  
  return lines.join('\n');
}

/**
 * Format greeting response
 * @param {object} options
 * @param {string} options.greeting - Greeting message
 * @param {Array} options.suggestions - Topic suggestions
 * @returns {string}
 */
function formatGreetingResponse({ greeting, suggestions }) {
  const lines = [];
  
  lines.push(greeting);
  
  if (Array.isArray(suggestions) && suggestions.length > 0) {
    lines.push('');
    lines.push('Beberapa topik yang bisa saya bantu:');
    suggestions.slice(0, 5).forEach(s => {
      lines.push(`• ${s}`);
    });
  }
  
  return lines.join('\n');
}

/**
 * Format error/not found response
 * @param {object} options
 * @param {string} options.message - Error message
 * @param {Array} options.alternatives - Alternative suggestions
 * @param {boolean} options.showWhatsApp - Show WA contact (default false)
 * @returns {string}
 */
function formatNotFoundResponse({ message, alternatives, showWhatsApp = false }) {
  const lines = [];
  
  lines.push(message || 'Mohon maaf, data yang Anda cari belum tersedia di sistem kami.');
  
  if (Array.isArray(alternatives) && alternatives.length > 0) {
    lines.push('');
    lines.push('Mungkin Anda mencari:');
    alternatives.slice(0, 3).forEach(alt => {
      lines.push(`• ${alt}`);
    });
  }
  
  if (showWhatsApp) {
    lines.push('');
    lines.push('📱 Untuk informasi lebih lanjut, silakan hubungi kami via WhatsApp.');
  }
  
  return lines.join('\n');
}

// ============================================================================
// RESPONSE LENGTH OPTIMIZATION
// ============================================================================

/**
 * Truncate response to target length while preserving structure
 * @param {string} response - Full response
 * @param {number} maxLength - Max characters (default 1000)
 * @returns {string}
 */
function truncateResponse(response, maxLength = 1000) {
  if (!response || response.length <= maxLength) {
    return response;
  }
  
  // Split into lines
  const lines = response.split('\n');
  let result = [];
  let currentLength = 0;
  
  for (const line of lines) {
    if (currentLength + line.length + 1 > maxLength - 50) { // Leave room for truncation message
      result.push('...');
      break;
    }
    result.push(line);
    currentLength += line.length + 1;
  }
  
  return result.join('\n');
}

/**
 * Check if response is too long
 * @param {string} response
 * @param {string} type - 'simple' | 'data' | 'detailed'
 * @returns {boolean}
 */
function isResponseTooLong(response, type = 'data') {
  const limits = {
    simple: 500,
    data: 1000,
    detailed: 1500,
  };
  
  const limit = limits[type] || 1000;
  return response.length > limit;
}

// ============================================================================
// CONFIDENCE SCORING
// ============================================================================

/**
 * Confidence levels
 */
const CONFIDENCE = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
};

/**
 * Add confidence indicator to response
 * @param {string} response - Original response
 * @param {string} confidence - 'high' | 'medium' | 'low'
 * @returns {string}
 */
function addConfidenceIndicator(response, confidence) {
  switch (confidence) {
    case CONFIDENCE.LOW:
      return `⚠️ _Saya tidak sepenuhnya yakin dengan jawaban ini._\n\n${response}\n\n💡 Untuk konfirmasi, silakan hubungi kami langsung.`;
    
    case CONFIDENCE.MEDIUM:
      return `${response}\n\n_Catatan: Data mungkin belum ter-update. Silakan konfirmasi jika diperlukan._`;
    
    case CONFIDENCE.HIGH:
    default:
      return response;
  }
}

/**
 * Determine confidence level based on context
 * @param {object} context
 * @param {number} context.candidateScore - Search score (0-100)
 * @param {boolean} context.hasData - Whether data was found
 * @param {boolean} context.isExactMatch - Whether query exactly matched
 * @returns {string}
 */
function determineConfidence({ candidateScore, hasData, isExactMatch }) {
  // Exact match with data = high confidence
  if (isExactMatch && hasData) {
    return CONFIDENCE.HIGH;
  }
  
  // Good score with data = medium-high
  if (candidateScore >= 80 && hasData) {
    return CONFIDENCE.HIGH;
  }
  
  // Medium score with data = medium
  if (candidateScore >= 50 && hasData) {
    return CONFIDENCE.MEDIUM;
  }
  
  // Low score or no data = low
  return CONFIDENCE.LOW;
}

// ============================================================================
// WHATSAPP FALLBACK CONTROL
// ============================================================================

/**
 * Patterns that should NOT trigger WhatsApp fallback
 * (queries we can answer confidently)
 */
const NO_WA_PATTERNS = [
  /\b(data|angka|statistik|jumlah|berapa)\b.*\b(20\d{2})\b/i, // Data with year
  /\b(pertumbuhan|pdrb|inflasi|pengangguran|kemiskinan)\b/i, // Common indicators
  /\b(selamat|halo|hai|hi|pagi|siang|sore|malam)\b/i, // Greetings
];

/**
 * Patterns that SHOULD trigger WhatsApp fallback
 */
const YES_WA_PATTERNS = [
  /\b(surat|rekomendasi|penelitian|izin|permohonan)\b/i, // Service requests
  /\b(bagaimana cara|prosedur|syarat)\b/i, // How-to questions
  /\b(siapa|nama|pejabat|kepala|struktur)\b/i, // Personnel questions
  /\b(lokasi|alamat|kantor|jam buka)\b/i, // Location questions
];

/**
 * Check if response should include WhatsApp fallback
 * @param {string} query - User query
 * @param {boolean} hasData - Whether data was found
 * @returns {boolean}
 */
function shouldShowWhatsApp(query, hasData) {
  // If we found data, generally no need for WA
  if (hasData) {
    return false;
  }
  
  // Check if query matches NO_WA patterns (we should answer without WA)
  for (const pattern of NO_WA_PATTERNS) {
    if (pattern.test(query)) {
      return false;
    }
  }
  
  // Check if query matches YES_WA patterns (service requests)
  for (const pattern of YES_WA_PATTERNS) {
    if (pattern.test(query)) {
      return true;
    }
  }
  
  // Default: show WA only if no data
  return !hasData;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Format number with Indonesian locale
 * @param {number|string} value
 * @returns {string}
 */
function formatNumber(value) {
  if (value === null || value === undefined || value === '') {
    return '-';
  }
  
  const num = parseFloat(value);
  if (isNaN(num)) {
    return String(value);
  }
  
  // Format with Indonesian locale
  return num.toLocaleString('id-ID', {
    maximumFractionDigits: 2,
  });
}

/**
 * Get response type based on query characteristics
 * @param {string} query
 * @param {object} context
 * @returns {'data' | 'comparison' | 'faq' | 'greeting' | 'not_found'}
 */
function detectResponseType(query, context = {}) {
  // Greeting
  if (/^(selamat|halo|hai|hi|pagi|siang|sore|malam)/i.test(query.trim())) {
    return 'greeting';
  }
  
  // Comparison
  if (/\b(bandingkan|perbandingan|vs|versus|dibanding)\b/i.test(query)) {
    return 'comparison';
  }
  
  // FAQ/Service
  if (/\b(bagaimana|cara|prosedur|syarat|apa itu|apakah)\b/i.test(query)) {
    return 'faq';
  }
  
  // No data found
  if (context.hasData === false) {
    return 'not_found';
  }
  
  // Default: data response
  return 'data';
}

module.exports = {
  // Templates
  formatDataResponse,
  formatComparisonResponse,
  formatFaqResponse,
  formatGreetingResponse,
  formatNotFoundResponse,
  
  // Length optimization
  truncateResponse,
  isResponseTooLong,
  
  // Confidence
  CONFIDENCE,
  addConfidenceIndicator,
  determineConfidence,
  
  // WhatsApp control
  shouldShowWhatsApp,
  
  // Helpers
  formatNumber,
  detectResponseType,
};
