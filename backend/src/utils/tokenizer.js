/**
 * Token Counter Utility
 *
 * Uses gpt-tokenizer (BPE) for accurate OpenAI token counting.
 * Falls back to char/4 estimation if the tokenizer fails to load.
 *
 * Encoding: o200k_base (used by GPT-4o, GPT-4.1-mini, GPT-5-mini)
 *
 * @module utils/tokenizer
 */

'use strict';

let _encode = null;
let _initFailed = false;

/**
 * Lazy-load the BPE encoder on first use.
 * This avoids startup cost if token counting is never called.
 */
function getEncoder() {
  if (_encode) return _encode;
  if (_initFailed) return null;

  try {
    const mod = require('gpt-tokenizer/encoding/o200k_base');
    _encode = mod.encode;
    return _encode;
  } catch (err) {
    _initFailed = true;
    // Warn once — don't spam logs
    console.warn('[tokenizer] gpt-tokenizer not available, falling back to char/4 estimation:', err.message);
    return null;
  }
}

/**
 * Count tokens in a text string using BPE tokenizer.
 * Falls back to Math.ceil(length / 4) if tokenizer is unavailable.
 *
 * @param {string} text - Text to count tokens for
 * @returns {number} Token count
 */
function countTextTokens(text) {
  if (!text) return 0;
  const normalized = String(text).trim();
  if (!normalized) return 0;

  const encode = getEncoder();
  if (encode) {
    try {
      return encode(normalized).length;
    } catch {
      // BPE encoding failed for this input — fall back
      return Math.ceil(normalized.length / 4);
    }
  }

  // Fallback: ~4 chars per token (English average; Indonesian slightly less)
  return Math.ceil(normalized.length / 4);
}

/**
 * Normalize multi-part message content to a plain string.
 *
 * @param {string|Array|Object} content - Message content (string, array of parts, or object with .text)
 * @returns {string}
 */
function normalizeMessageContent(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => {
      if (typeof part === 'string') return part;
      if (part?.text) return part.text;
      return '';
    }).join(' ');
  }
  if (content?.text) return content.text;
  return '';
}

/**
 * Count tokens across an input that may be a string, message array, or payload object.
 *
 * Supports:
 *   - Plain string
 *   - Array of { role, content } messages
 *   - Object with .messages or .input property
 *
 * @param {string|Array|Object} input
 * @returns {number} Total token count
 */
function countTokens(input) {
  if (!input) return 0;
  if (typeof input === 'string') return countTextTokens(input);
  if (Array.isArray(input)) {
    return input.reduce((sum, message) => {
      const content = normalizeMessageContent(message?.content ?? message);
      return sum + countTextTokens(content);
    }, 0);
  }
  if (input?.messages) return countTokens(input.messages);
  if (input?.input) return countTokens(input.input);
  return 0;
}

module.exports = {
  countTextTokens,
  countTokens,
  normalizeMessageContent,
};
