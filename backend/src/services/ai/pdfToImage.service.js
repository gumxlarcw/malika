/**
 * PDF to Image Service
 * Convert PDF pages to images for OCR processing
 */

const { fromBuffer } = require('pdf2pic');
const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

// Temp directory for image conversion
const TEMP_DIR = path.join(os.tmpdir(), 'malika-pdf-images');

/**
 * Ensure temp directory exists
 */
async function ensureTempDir() {
  try {
    await fs.mkdir(TEMP_DIR, { recursive: true });
  } catch (err) {
    // Ignore if exists
  }
}

/**
 * Convert PDF buffer to array of image buffers
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @param {object} options - Conversion options
 * @returns {Promise<Buffer[]>} - Array of PNG image buffers
 */
async function pdfToImages(pdfBuffer, options = {}) {
  const {
    maxPages = 20,      // Limit pages to process (cost control)
    density = 200,       // DPI (higher = better quality but slower)
    width = 1600,        // Output width
    format = 'png'
  } = options;

  await ensureTempDir();

  // Generate unique prefix for this conversion
  const prefix = `pdf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  try {
    const converter = fromBuffer(pdfBuffer, {
      density,
      saveFilename: prefix,
      savePath: TEMP_DIR,
      format,
      width,
      height: -1, // Maintain aspect ratio
    });

    // Get total pages first
    const pageInfo = await converter.bulk(-1, { responseType: 'buffer' }).catch(() => null);
    
    if (!pageInfo || pageInfo.length === 0) {
      console.log('[PdfToImage] No pages found or conversion failed');
      return [];
    }

    // Limit pages
    const pagesToProcess = pageInfo.slice(0, maxPages);
    
    // Extract buffers
    const imageBuffers = [];
    for (const page of pagesToProcess) {
      if (page.buffer) {
        // Optimize with sharp
        const optimized = await sharp(page.buffer)
          .png({ quality: 90 })
          .toBuffer();
        imageBuffers.push(optimized);
      }
    }

    console.log(`[PdfToImage] Converted ${imageBuffers.length} pages`);
    return imageBuffers;

  } catch (error) {
    console.error('[PdfToImage] Conversion error:', error.message);
    
    // Fallback: try single page conversion
    try {
      const converter = fromBuffer(pdfBuffer, {
        density: 150,
        saveFilename: prefix,
        savePath: TEMP_DIR,
        format: 'png',
        width: 1200,
      });

      const result = await converter(1, { responseType: 'buffer' });
      if (result?.buffer) {
        return [result.buffer];
      }
    } catch (fallbackErr) {
      console.error('[PdfToImage] Fallback also failed:', fallbackErr.message);
    }
    
    return [];
  } finally {
    // Cleanup temp files
    try {
      const files = await fs.readdir(TEMP_DIR);
      for (const file of files) {
        if (file.startsWith(prefix)) {
          await fs.unlink(path.join(TEMP_DIR, file)).catch(() => {});
        }
      }
    } catch (cleanupErr) {
      // Ignore cleanup errors
    }
  }
}

/**
 * Check if a PDF likely needs OCR (has images but little text)
 * @param {string} extractedText - Text already extracted from PDF
 * @param {number} pageCount - Number of pages
 * @returns {boolean}
 */
function shouldUseOcr(extractedText, pageCount = 1) {
  const textLength = (extractedText || '').trim().length;
  const minTextPerPage = 100; // Expect at least 100 chars per page
  const expectedMinLength = pageCount * minTextPerPage;
  
  // If text is very short compared to page count, likely needs OCR
  return textLength < expectedMinLength;
}

module.exports = {
  pdfToImages,
  shouldUseOcr
};
