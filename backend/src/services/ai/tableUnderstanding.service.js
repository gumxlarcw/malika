/**
 * LLM-Based Table Understanding Service
 * 
 * Uses GPT to intelligently identify which table sections are relevant
 * for a user's query. This is scalable for any document type.
 * 
 * @module services/ai/tableUnderstanding
 */

const logger = require('../../utils/logger').child({ service: 'TableUnderstanding' });
const requestContext = require('../chat/streaming/requestContext');
const { chatCompletion } = require('./client/openaiClient');

// Cache for table analysis results (TTL: 1 hour)
const analysisCache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Analyze tables in a document and identify which are relevant for a query
 * 
 * @param {string} content - Document content
 * @param {string} query - User's query
 * @param {Object} options - Options
 * @param {number} options.maxTables - Max tables to analyze (default: 10)
 * @returns {Promise<{relevantSections: number[], irrelevantSections: number[], reasoning: string}>}
 */
async function analyzeTablesForQuery(content, query, options = {}) {
  const { maxTables = 10 } = options;
  
  // Extract table-like sections from content
  const lines = content.split('\n');
  const tableSections = extractTableSections(lines);
  
  if (tableSections.length === 0) {
    logger.debug({ query }, 'No table sections found in document');
    return { relevantSections: [], irrelevantSections: [], reasoning: 'No tables found' };
  }
  
  // Generate cache key
  const cacheKey = `${hashContent(content.substring(0, 1000))}_${query.toLowerCase().trim()}`;
  const cached = analysisCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    logger.debug({ query, cacheHit: true }, 'Using cached table analysis');
    return cached.result;
  }
  
  // Limit tables to analyze
  const sectionsToAnalyze = tableSections.slice(0, maxTables);
  
  // Build context for LLM
  const tableDescriptions = sectionsToAnalyze.map((section, idx) => {
    const preview = section.lines.slice(0, 8).join('\n');
    return `[Tabel ${idx + 1}] Baris ${section.startLine}-${section.endLine}:\n${preview}${section.lines.length > 8 ? '\n...' : ''}`;
  }).join('\n\n');
  
  const prompt = `Anda adalah analis data BPS. Diberikan beberapa tabel dari dokumen statistik dan pertanyaan pengguna.

PERTANYAAN PENGGUNA: "${query}"

TABEL-TABEL DALAM DOKUMEN:
${tableDescriptions}

TUGAS: Identifikasi tabel mana yang PALING RELEVAN untuk menjawab pertanyaan pengguna.

ATURAN PENTING:
1. Untuk pertanyaan "pendatang" atau "migrasi masuk" → cari tabel dengan kolom "Migrasi Masuk" atau "In Migration"
2. HINDARI tabel yang menunjukkan "Total Penduduk" atau "Jumlah" jika yang diminta adalah "pendatang/migrasi masuk"
3. Untuk pertanyaan tentang "ekspor/impor" → cari tabel dengan nilai perdagangan, bukan volume
4. Perhatikan header dan struktur tabel untuk memahami apa yang ditampilkan

Berikan respons dalam format JSON:
{
  "relevant": [1, 3],  // nomor tabel yang relevan (1-indexed)
  "irrelevant": [2, 4, 5],  // nomor tabel yang TIDAK relevan
  "reasoning": "Tabel 1 dan 3 berisi data migrasi masuk yang sesuai. Tabel 2 berisi total penduduk (bukan pendatang). Tabel 4-5 adalah matriks tempat lahir."
}`;

  try {
    const startTime = Date.now();
    
    const tableModel = requestContext.getModelOverride() || process.env.OPENAI_MODEL_TABLE_UNDERSTANDING || 'claude-sonnet-4-6';
    const _startMs = Date.now();
    const response = await chatCompletion({
      apiKeyEnv: 'OPENAI_API_KEY_CHAT',
      payload: {
        model: tableModel,
        messages: [
          { role: 'system', content: 'Anda adalah analis data statistik BPS Indonesia. Jawab hanya dalam format JSON yang diminta.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 500,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'table_relevance',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                relevant: {
                  type: 'array',
                  items: { type: 'integer' },
                  description: '1-indexed table numbers that are relevant to the query',
                },
                irrelevant: {
                  type: 'array',
                  items: { type: 'integer' },
                  description: '1-indexed table numbers that are NOT relevant',
                },
                reasoning: {
                  type: 'string',
                  description: 'Brief explanation of why tables were classified this way',
                },
              },
              required: ['relevant', 'irrelevant', 'reasoning'],
              additionalProperties: false,
            },
          },
        },
      },
      timeoutMs: 30000,
      retries: 2,
    });
    
    const latency = Date.now() - startTime;

    // Track cost
    try {
      const { costTracker } = require('../../utils/costTracker');
      if (response.usage) {
        costTracker.record({
          model: tableModel,
          usage: response.usage,
          purpose: 'table_understanding',
          latencyMs: Date.now() - _startMs,
        });
      }
    } catch { /* non-critical */ }

    const responseText = response.choices[0]?.message?.content || '{}';
    
    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch (e) {
      logger.warn({ responseText }, 'Failed to parse LLM response as JSON');
      parsed = { relevant: [], irrelevant: [], reasoning: 'Parse error' };
    }
    
    // Convert 1-indexed table numbers to line ranges
    const relevantSections = (parsed.relevant || []).map(idx => {
      const section = sectionsToAnalyze[idx - 1];
      return section ? { startLine: section.startLine, endLine: section.endLine } : null;
    }).filter(Boolean);
    
    const irrelevantSections = (parsed.irrelevant || []).map(idx => {
      const section = sectionsToAnalyze[idx - 1];
      return section ? { startLine: section.startLine, endLine: section.endLine } : null;
    }).filter(Boolean);
    
    const result = {
      relevantSections,
      irrelevantSections,
      reasoning: parsed.reasoning || '',
      tablesAnalyzed: sectionsToAnalyze.length,
    };
    
    // Cache result
    analysisCache.set(cacheKey, { result, timestamp: Date.now() });
    
    // Cleanup old cache entries periodically
    if (analysisCache.size > 100) {
      const now = Date.now();
      for (const [key, value] of analysisCache) {
        if (now - value.timestamp > CACHE_TTL) {
          analysisCache.delete(key);
        }
      }
    }
    
    logger.info({ 
      query, 
      tablesFound: tableSections.length,
      tablesAnalyzed: sectionsToAnalyze.length,
      relevantCount: relevantSections.length,
      irrelevantCount: irrelevantSections.length,
      latencyMs: latency,
    }, 'Table analysis completed');
    
    return result;
    
  } catch (error) {
    logger.error({ error: error.message, query }, 'LLM table analysis failed');
    // Return empty - let caller handle fallback
    return { 
      relevantSections: [], 
      irrelevantSections: [], 
      reasoning: `Error: ${error.message}`,
      error: true 
    };
  }
}

/**
 * Extract table-like sections from document lines
 * Tables are identified by:
 * - Headers containing "Tabel", "Table", column headers
 * - Multiple rows with numbers (actual data, not page numbers)
 * - Consistent structure
 * 
 * IMPORTANT: Skip intro/TOC sections, focus on DATA tables
 * 
 * @param {string[]} lines - Document lines
 * @returns {Array<{startLine: number, endLine: number, lines: string[], hasData: boolean}>}
 */
function extractTableSections(lines) {
  const sections = [];
  let currentSection = null;
  
  // Skip common intro patterns
  const isIntroLine = (line) => {
    const lower = line.toLowerCase();
    return (
      lower.includes('kata pengantar') ||
      lower.includes('daftar isi') ||
      lower.includes('daftar tabel') ||
      lower.includes('daftar gambar') ||
      lower.includes('badan pusat statistik') ||
      lower.includes('bps-statistics') ||
      /^(i|ii|iii|iv|v|vi|vii|viii|ix|x)$/i.test(line.trim()) || // Roman numerals
      /^[ivx]+\s*$/i.test(line.trim())
    );
  };
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineLower = line.toLowerCase();
    
    // Skip intro/TOC sections (first ~500 lines often)
    if (isIntroLine(line)) {
      if (currentSection) {
        if (currentSection.dataRows > 0) {
          sections.push(currentSection);
        }
        currentSection = null;
      }
      continue;
    }
    
    // Detect REAL data table header (not TOC entries)
    // Must have specific statistical keywords
    const isDataTableHeader = (
      (lineLower.includes('kabupaten/kota') || lineLower.includes('regency/municipality')) ||
      (lineLower.includes('laki-laki') && lineLower.includes('perempuan')) ||
      (lineLower.includes('migrasi masuk') || lineLower.includes('in migration')) ||
      (lineLower.includes('migrasi keluar') || lineLower.includes('out migration')) ||
      (lineLower.includes('ekspor') && lineLower.includes('impor')) ||
      lineLower.includes('jumlah/total')
    );
    
    // Detect data row - must have multiple numbers and region names
    const hasMultipleNumbers = (line.match(/\d[\d\s.,]+\d/g) || []).length >= 3;
    const hasRegionName = /halmahera|ternate|tidore|morotai|sula|taliabu/i.test(line);
    const isDataRow = hasMultipleNumbers && (hasRegionName || line.length > 40);
    
    // Detect section break
    const isSectionBreak = (
      (line.trim() === '' && currentSection && currentSection.lines.length > 5) ||
      /^--\s*\d+\s*of\s*\d+\s*--$/i.test(line.trim())
    );
    
    if (isDataTableHeader && !currentSection) {
      // Start new section at a real data table
      currentSection = {
        startLine: i,
        endLine: i,
        lines: [line],
        headerLine: line,
        dataRows: 0,
      };
    } else if (currentSection) {
      if (isSectionBreak && currentSection.dataRows > 2) {
        // End section if it has actual data
        sections.push(currentSection);
        currentSection = null;
      } else if (isDataRow) {
        // Count data rows
        currentSection.lines.push(line);
        currentSection.endLine = i;
        currentSection.dataRows++;
      } else if (isDataTableHeader || line.trim().length > 0) {
        // Continue section with header/label lines
        currentSection.lines.push(line);
        currentSection.endLine = i;
      }
      
      // Safety: don't let sections grow too large
      if (currentSection && currentSection.lines.length > 50) {
        if (currentSection.dataRows > 2) {
          sections.push(currentSection);
        }
        currentSection = null;
      }
    }
  }
  
  // Add last section if exists and has data
  if (currentSection && currentSection.dataRows > 0) {
    sections.push(currentSection);
  }
  
  // Filter to only sections with actual data rows
  // Sort by data rows (most data first) to prioritize real data tables
  return sections
    .filter(s => s.dataRows > 2)
    .sort((a, b) => b.dataRows - a.dataRows);
}

/**
 * Check if a line index is in an irrelevant section
 * 
 * @param {number} lineIdx - Line index
 * @param {Array} irrelevantSections - Array of {startLine, endLine}
 * @returns {boolean}
 */
function isInIrrelevantSection(lineIdx, irrelevantSections) {
  return irrelevantSections.some(section => 
    lineIdx >= section.startLine && lineIdx <= section.endLine
  );
}

/**
 * Check if a line index is in a relevant section
 * 
 * @param {number} lineIdx - Line index
 * @param {Array} relevantSections - Array of {startLine, endLine}
 * @returns {boolean}
 */
function isInRelevantSection(lineIdx, relevantSections) {
  return relevantSections.some(section => 
    lineIdx >= section.startLine && lineIdx <= section.endLine
  );
}

/**
 * Simple hash for cache key
 */
function hashContent(content) {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

/**
 * Clear the analysis cache
 */
function clearCache() {
  analysisCache.clear();
  logger.info('Table analysis cache cleared');
}

module.exports = {
  analyzeTablesForQuery,
  extractTableSections,
  isInIrrelevantSection,
  isInRelevantSection,
  clearCache,
};
