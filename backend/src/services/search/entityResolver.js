'use strict';

const DataSource = require('../../models/DataSource.model');

// Module-level cache of mined entities. Rebuilt by rebuildEntityIndex().
// Shape: Array<string> of canonical (lowercase, whitespace-normalized) entity names.
let entityIndex = [];

function normalizeText(input) {
  return String(input || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Pattern captures compound regional names: <prefix> + <noun-phrase>.
// Stops at whitespace followed by a digit, punctuation, or end.
const GEO_PATTERN = /(kota|kabupaten|pulau|kepulauan|halmahera)\s+([\p{L}][\p{L}\s]*?)(?=\s+\d|\s*[,()\/]|\s*$)/giu;

async function rebuildEntityIndex() {
  const rows = await DataSource.findAll({ attributes: ['name'] });
  const entities = new Set();

  for (const row of rows) {
    const name = normalizeText(row.name);

    // Extract via the geo pattern — one pass per row.
    for (const match of name.matchAll(GEO_PATTERN)) {
      const phrase = `${match[1]} ${match[2]}`.trim();
      if (phrase.length >= 5 && phrase.length <= 40) entities.add(phrase);
    }

    // Province-level special-case: "maluku utara" is the parent region, no prefix word.
    if (name.includes('maluku utara')) entities.add('maluku utara');
  }

  entityIndex = [...entities].sort();
}

function getEntityIndex() {
  return entityIndex.slice();
}

function resolvePrefixAlias(queryToken) {
  const tok = normalizeText(queryToken);
  if (tok.length < 5 || tok.includes(' ')) return null;

  for (const entity of entityIndex) {
    const words = entity.split(' ');
    if (words.length < 2) continue;  // prefix-alias only for multi-word entities

    // Recursive backtracking: try every valid prefix split across entity words.
    // Each word must contribute ≥2 prefix chars.
    function matchWords(wordIdx, pos) {
      if (wordIdx === words.length) return pos === tok.length;
      const word = words[wordIdx];
      // Determine how many consecutive chars from tok[pos..] match word's prefix
      let maxMatch = 0;
      while (
        maxMatch < word.length &&
        pos + maxMatch < tok.length &&
        word[maxMatch] === tok[pos + maxMatch]
      ) {
        maxMatch++;
      }
      // Try each valid split length from 2..maxMatch
      for (let take = 2; take <= maxMatch; take++) {
        if (matchWords(wordIdx + 1, pos + take)) return true;
      }
      return false;
    }

    if (matchWords(0, 0)) return entity;
  }
  return null;
}

// Test-only setter — lets tests inject a fixed index without calling rebuildEntityIndex.
function _setIndexForTesting(entities) {
  entityIndex = entities.slice();
}

// Classic iterative Levenshtein distance (O(mn) time, O(n) space).
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

function tokenize(text) {
  return String(text || '')
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}-]/gu, ''))
    .filter((t) => t.length > 0);
}

function resolveGeo(q) {
  const normQ = normalizeText(q);
  if (!normQ) return [];
  const matches = new Set();

  // Tier 1: exact substring (cheapest — ~95% of well-formed queries)
  for (const entity of entityIndex) {
    if (normQ.includes(entity)) matches.add(entity);
  }

  // Tier 2: prefix-alias for abbreviations (only if Tier 1 missed)
  if (matches.size === 0) {
    for (const token of tokenize(normQ)) {
      const alias = resolvePrefixAlias(token);
      if (alias) matches.add(alias);
    }
  }

  // Tier 3: Levenshtein for typos (only if Tier 1+2 missed)
  if (matches.size === 0) {
    for (const token of tokenize(normQ)) {
      if (token.length < 5) continue;
      for (const entity of entityIndex) {
        const entityWords = entity.split(' ');
        for (const word of entityWords) {
          if (word.length < 5) continue;
          const tolerance = Math.min(2, Math.floor(word.length / 3));
          if (levenshtein(token, word) <= tolerance) {
            matches.add(entity);
            break;
          }
        }
        if (matches.has(entity)) break;
      }
    }
  }

  return [...matches];
}

module.exports = {
  rebuildEntityIndex, getEntityIndex, resolvePrefixAlias, resolveGeo,
  _setIndexForTesting,
  // expose for focused unit testing
  _levenshtein: levenshtein,
  _tokenize: tokenize,
};
