/**
 * PDF Text Extraction Service
 * Extracts text from PDF files using pdf-parse v2 (no Vision OCR)
 */

const axios = require('axios');

// Lazy load pdf-parse to avoid issues
let PDFParse = null;
function getPDFParse() {
  if (!PDFParse) {
    const pdfParse = require('pdf-parse');
    PDFParse = pdfParse.PDFParse;
    console.log('[PDFExtract] PDFParse loaded, type:', typeof PDFParse);
  }
  return PDFParse;
}

/**
 * Extract text from PDF buffer
 * @param {Buffer} buffer - PDF file buffer
 * @returns {Promise<{text: string, pages: number, info: object}>}
 */
async function extractTextFromBuffer(buffer) {
  try {
    const Parser = getPDFParse();
    if (!Parser) {
      throw new Error('PDFParse not available');
    }
    
    // pdf-parse v2 uses class-based API
    const parser = new Parser({ data: buffer });
    const result = await parser.getText();
    
    let info = {};
    try {
      info = await parser.getInfo();
    } catch {
      // Ignore info extraction errors
    }
    
    await parser.destroy();
    
    return {
      text: result.text || '',
      pages: result.total || 0,
      info: {
        title: info.info?.Title || '',
        author: info.info?.Author || '',
        creator: info.info?.Creator || '',
        producer: info.info?.Producer || '',
      },
      textLength: (result.text || '').length,
    };
  } catch (error) {
    console.error('[PDFExtract] Error parsing PDF:', error.message);
    throw new Error(`PDF parsing failed: ${error.message}`);
  }
}

/**
 * Extract text from PDF URL
 * @param {string} pdfUrl - URL to PDF file
 * @param {object} options
 * @param {number} options.timeout - Request timeout (default 30s)
 * @returns {Promise<{text: string, pages: number, info: object}>}
 */
async function extractTextFromUrl(pdfUrl, options = {}) {
  const { timeout = 30000 } = options;
  
  try {
    // Fetch PDF as buffer using axios
    const buffer = await downloadPdf(pdfUrl, { timeout });
    
    if (buffer.length === 0) {
      throw new Error('Downloaded PDF is empty');
    }
    
    // Extract text
    const result = await extractTextFromBuffer(buffer);
    
    return {
      ...result,
      downloadSize: buffer.length,
      source: pdfUrl,
    };
  } catch (error) {
    console.error('[PDFExtract] Error extracting from URL:', error.message);
    throw error;
  }
}

/**
 * Download PDF from URL as buffer
 * @param {string} pdfUrl - URL to PDF file
 * @param {object} options
 * @param {number} options.timeout - Request timeout (default 30s)
 * @returns {Promise<Buffer>}
 */
async function downloadPdf(pdfUrl, options = {}) {
  const { timeout = 30000 } = options;
  
  const response = await axios.get(pdfUrl, {
    responseType: 'arraybuffer',
    timeout: timeout,
    maxRedirects: 5,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    }
  });
  
  return Buffer.from(response.data);
}

/**
 * Analyze extracted text for quality
 * @param {string} text - Extracted text
 * @returns {object} Analysis result
 */
function analyzeTextQuality(text) {
  if (!text) {
    return {
      quality: 'empty',
      score: 0,
      hasNarrativeContent: false,
      hasTabularData: false,
      wordCount: 0,
      lineCount: 0,
      avgWordsPerLine: 0,
      recommendations: ['PDF has no extractable text - may need Vision OCR'],
    };
  }
  
  const lines = text.split('\n').filter(l => l.trim());
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const avgWordsPerLine = lines.length > 0 ? words.length / lines.length : 0;
  
  // Detect tabular data (many short lines with numbers)
  const linesWithNumbers = lines.filter(l => (l.match(/\d+/g) || []).length >= 3);
  const hasTabularData = linesWithNumbers.length > lines.length * 0.3;
  
  // Detect narrative content (longer lines with sentences)
  const narrativeLines = lines.filter(l => l.length > 80 && l.includes(' '));
  const hasNarrativeContent = narrativeLines.length > 5;
  
  // Calculate quality score
  let score = 0;
  const recommendations = [];
  
  if (words.length > 100) score += 20;
  if (words.length > 500) score += 20;
  if (hasNarrativeContent) score += 30;
  if (avgWordsPerLine > 5) score += 15;
  if (!hasTabularData || hasNarrativeContent) score += 15;
  
  // Generate recommendations
  if (hasTabularData && !hasNarrativeContent) {
    recommendations.push('PDF contains mostly tabular data - text extraction may be jumbled');
    recommendations.push('Consider Vision OCR for better table structure');
  }
  
  if (words.length < 100) {
    recommendations.push('Very little text extracted - may be image-based PDF');
    recommendations.push('Vision OCR recommended');
  }
  
  if (avgWordsPerLine < 3) {
    recommendations.push('Very short lines detected - possibly column-based layout');
    recommendations.push('Text order may not be correct');
  }
  
  if (score >= 80) {
    recommendations.push('Good text extraction quality - suitable for embedding');
  } else if (score >= 50) {
    recommendations.push('Moderate quality - usable but may have issues');
  } else {
    recommendations.push('Poor extraction quality - review content carefully');
  }
  
  let quality = 'poor';
  if (score >= 80) quality = 'good';
  else if (score >= 50) quality = 'moderate';
  
  return {
    quality,
    score,
    hasNarrativeContent,
    hasTabularData,
    wordCount: words.length,
    lineCount: lines.length,
    avgWordsPerLine: Math.round(avgWordsPerLine * 10) / 10,
    tabularLinesRatio: Math.round((linesWithNumbers.length / Math.max(lines.length, 1)) * 100),
    recommendations,
  };
}

/**
 * Extract and chunk text for embedding
 * @param {string} text - Full text
 * @param {object} options
 * @param {number} options.chunkSize - Max chars per chunk (default 2000)
 * @param {number} options.overlap - Overlap between chunks (default 200)
 * @returns {Array<{chunk: string, index: number, start: number, end: number}>}
 */
function chunkText(text, options = {}) {
  const { chunkSize = 2000, overlap = 200 } = options;
  
  if (!text || text.length <= chunkSize) {
    return [{
      chunk: text || '',
      index: 0,
      start: 0,
      end: text?.length || 0,
    }];
  }
  
  const chunks = [];
  let start = 0;
  let index = 0;
  
  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);
    
    // Try to break at sentence or paragraph
    if (end < text.length) {
      const searchStart = Math.max(end - 200, start);
      const searchText = text.slice(searchStart, end);
      
      // Look for paragraph break
      const paraBreak = searchText.lastIndexOf('\n\n');
      if (paraBreak > 50) {
        end = searchStart + paraBreak + 2;
      } else {
        // Look for sentence break
        const sentenceBreak = searchText.lastIndexOf('. ');
        if (sentenceBreak > 50) {
          end = searchStart + sentenceBreak + 2;
        }
      }
    }
    
    chunks.push({
      chunk: text.slice(start, end).trim(),
      index,
      start,
      end,
    });
    
    start = end - overlap;
    if (start >= text.length - overlap) break;
    index++;
  }
  
  return chunks;
}

module.exports = {
  extractTextFromBuffer,
  extractTextFromUrl,
  downloadPdf,
  analyzeTextQuality,
  chunkText,
};
