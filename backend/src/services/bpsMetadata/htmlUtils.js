'use strict';

/**
 * HTML entity decode + tag handling for BPS API metadata strings.
 *
 * BPS frequently returns text wrapped in HTML, sometimes double-encoded
 * (e.g. `&lt;sup&gt;1&lt;/sup&gt;` for footnote markers). We need to:
 *  - decode entities so the markup is parseable
 *  - PRESERVE certain tags (`<sup>` footnote markers, `<i>` italics in citations)
 *    when storing for later browser rendering
 *  - STRIP all tags for plain-text display / FULLTEXT search
 */

const ENTITY_MAP = {
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
  '&quot;': '"',
  '&apos;': "'",
  '&nbsp;': ' ',
  '&#39;': "'",
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&rdquo;': '”',
  '&ldquo;': '“',
  '&hellip;': '…',
};

/** Decode HTML entities (handles double-encoded BPS strings). */
function decodeEntities(input) {
  if (input == null) return null;
  let s = String(input);
  // Two passes — BPS sometimes double-encodes
  for (let pass = 0; pass < 2; pass++) {
    s = s.replace(/&(lt|gt|amp|quot|apos|nbsp|#39|rsquo|lsquo|rdquo|ldquo|hellip);/g, (m) => ENTITY_MAP[m] ?? m);
    s = s.replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCharCode(code) : '';
    });
  }
  return s;
}

/**
 * Strip ALL HTML tags. Used for plain-text fields (flat_text, search index).
 * Decodes entities first.
 */
function stripHtml(input) {
  if (input == null) return null;
  return decodeEntities(input)
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Decode entities and normalize whitespace, but PRESERVE useful inline tags
 * for browser rendering: <sup>, <sub>, <b>, <strong>, <i>, <em>, <br>.
 * Strips everything else (scripts, styles, divs, attributes).
 */
function sanitizeKeepInline(input) {
  if (input == null) return null;
  let s = decodeEntities(input);

  // Drop entire <script> / <style> blocks
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '');

  // Strip attributes from kept tags so we don't re-emit risky values
  const KEEP = new Set(['sup', 'sub', 'b', 'strong', 'i', 'em', 'br']);
  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\s*[^>]*>/g, (full, tag) => {
    const name = String(tag).toLowerCase();
    if (!KEEP.has(name)) return '';
    // Keep just the tag without attributes
    if (full.startsWith('</')) return `</${name}>`;
    if (name === 'br') return '<br>';
    return `<${name}>`;
  });

  return s.replace(/\s+/g, ' ').trim();
}

/** True if a string contains any HTML tag. */
function hasMarkup(input) {
  return typeof input === 'string' && /<[a-zA-Z][^>]*>/.test(input);
}

/** Normalize empty / whitespace-only strings to null for cleaner DB rows. */
function nullIfEmpty(input) {
  if (input == null) return null;
  const s = String(input).trim();
  return s === '' || s === 'null' ? null : s;
}

module.exports = {
  decodeEntities,
  stripHtml,
  sanitizeKeepInline,
  hasMarkup,
  nullIfEmpty,
};
