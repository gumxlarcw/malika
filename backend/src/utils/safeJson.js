/**
 * Safe JSON Parsing Utilities
 * 
 * Provides crash-safe JSON parsing with fallback values
 * to prevent service crashes from malformed data.
 * 
 * Usage:
 *   const { safeJsonParse, safeJsonStringify } = require('../utils/safeJson');
 *   
 *   // Parse with fallback
 *   const data = safeJsonParse(jsonString, { default: 'value' });
 *   
 *   // Parse array
 *   const arr = safeJsonParse(jsonString, []);
 */

const logger = require('./logger');

/**
 * Safely parse JSON with fallback value
 * @param {string|any} text - JSON string to parse (or already parsed object)
 * @param {any} fallback - Fallback value if parsing fails (default: null)
 * @param {string} context - Context for logging (optional)
 * @returns {any} Parsed object or fallback
 */
function safeJsonParse(text, fallback = null, context = '') {
  // If already an object (not string), return as-is
  if (text !== null && typeof text === 'object') {
    return text;
  }
  
  // Empty or non-string input
  if (!text || typeof text !== 'string') {
    return fallback;
  }
  
  // Empty string check
  const trimmed = text.trim();
  if (!trimmed) {
    return fallback;
  }
  
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    // Log at debug level (not error) since fallback handles it gracefully
    if (context) {
      logger.debug({ context, error: error.message, preview: text.slice(0, 100) }, 'JSON parse failed, using fallback');
    }
    return fallback;
  }
}

/**
 * Safely parse JSON array with fallback to empty array
 * @param {string|any[]} text - JSON string or array
 * @param {string} context - Context for logging (optional)
 * @returns {any[]} Parsed array or empty array
 */
function safeJsonParseArray(text, context = '') {
  const result = safeJsonParse(text, [], context);
  return Array.isArray(result) ? result : [];
}

/**
 * Safely parse JSON object with fallback to empty object
 * @param {string|object} text - JSON string or object
 * @param {string} context - Context for logging (optional)
 * @returns {object} Parsed object or empty object
 */
function safeJsonParseObject(text, context = '') {
  const result = safeJsonParse(text, {}, context);
  return (result && typeof result === 'object' && !Array.isArray(result)) ? result : {};
}

/**
 * Safely stringify to JSON with error handling
 * @param {any} obj - Object to stringify
 * @param {string} fallback - Fallback string if stringify fails (default: '{}')
 * @param {string} context - Context for logging (optional)
 * @returns {string} JSON string or fallback
 */
function safeJsonStringify(obj, fallback = '{}', context = '') {
  if (obj === undefined || obj === null) {
    return fallback;
  }
  
  try {
    return JSON.stringify(obj);
  } catch (error) {
    if (context) {
      logger.warn({ context, error: error.message }, 'JSON stringify failed, using fallback');
    }
    return fallback;
  }
}

/**
 * Parse JSON from SSE data line (handles "data: " prefix)
 * @param {string} line - SSE data line
 * @param {any} fallback - Fallback value if parsing fails
 * @returns {any} Parsed object or fallback
 */
function parseSseData(line, fallback = null) {
  if (!line || typeof line !== 'string') {
    return fallback;
  }
  
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) {
    return fallback;
  }
  
  const jsonStr = trimmed.slice(5).trim();
  if (!jsonStr || jsonStr === '[DONE]') {
    return fallback;
  }
  
  return safeJsonParse(jsonStr, fallback, 'SSE');
}

module.exports = {
  safeJsonParse,
  safeJsonParseArray,
  safeJsonParseObject,
  safeJsonStringify,
  parseSseData,
};
