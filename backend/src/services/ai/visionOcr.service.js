/**
 * Vision OCR Service
 * Use OpenAI Vision (GPT-4o) to extract text from images
 */

const OpenAI = require('openai');

// Use dedicated key for interpretation/vision tasks, fallback to query builder key
const OPENAI_API_KEY = process.env.OPENAI_API_KEY_INTERPRETATION 
  || process.env.OPENAI_API_KEY 
  || process.env.OPENAI_API_KEY_QUERY_BUILDER;

let openaiClient = null;

function getClient() {
  if (!openaiClient && OPENAI_API_KEY) {
    openaiClient = new OpenAI({ apiKey: OPENAI_API_KEY });
  }
  return openaiClient;
}

/**
 * Extract text from image using OpenAI Vision
 * @param {Buffer|string} imageInput - Image buffer or base64 string
 * @param {object} options - Options
 * @returns {Promise<string>} - Extracted text
 */
async function extractTextFromImage(imageInput, options = {}) {
  const client = getClient();
  if (!client) {
    console.warn('[VisionOCR] No OpenAI API key configured');
    return '';
  }

  try {
    // Convert buffer to base64 if needed
    let base64Image;
    if (Buffer.isBuffer(imageInput)) {
      base64Image = imageInput.toString('base64');
    } else if (typeof imageInput === 'string') {
      // Assume already base64
      base64Image = imageInput;
    } else {
      throw new Error('Invalid image input type');
    }

    const mimeType = options.mimeType || 'image/png';
    const dataUrl = `data:${mimeType};base64,${base64Image}`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 4096,
      messages: [
        {
          role: 'system',
          content: `You are an expert OCR system. Extract ALL text from the image accurately.
Rules:
- Extract text exactly as shown, preserving formatting where possible
- For tables, convert to readable text format
- For charts/graphs, describe the key data points and labels
- If the image contains no text, respond with "[NO_TEXT]"
- Respond ONLY with the extracted text, no explanations`
        },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: dataUrl,
                detail: options.detail || 'high'
              }
            },
            {
              type: 'text',
              text: 'Extract all text from this image. Include any text in tables, charts, or graphics.'
            }
          ]
        }
      ]
    });

    const extractedText = response.choices?.[0]?.message?.content || '';
    
    if (extractedText === '[NO_TEXT]') {
      return '';
    }

    return extractedText.trim();
  } catch (error) {
    console.error('[VisionOCR] Error:', error.message);
    // Return empty string on error, don't fail the whole process
    return '';
  }
}

/**
 * Extract text from multiple images
 * @param {Array<Buffer>} images - Array of image buffers
 * @param {object} options - Options including concurrency
 * @returns {Promise<string[]>} - Array of extracted texts
 */
async function extractTextFromImages(images, options = {}) {
  const concurrency = options.concurrency || 3; // Limit concurrent API calls
  const results = [];
  
  for (let i = 0; i < images.length; i += concurrency) {
    const batch = images.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((img, idx) => 
        extractTextFromImage(img, { ...options, pageIndex: i + idx })
          .catch(err => {
            console.error(`[VisionOCR] Page ${i + idx} failed:`, err.message);
            return '';
          })
      )
    );
    results.push(...batchResults);
  }
  
  return results;
}

/**
 * Check if OpenAI Vision is available
 * @returns {boolean}
 */
function isVisionAvailable() {
  return !!OPENAI_API_KEY;
}

module.exports = {
  extractTextFromImage,
  extractTextFromImages,
  isVisionAvailable
};
