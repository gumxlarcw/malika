'use strict';
/**
 * Decide which section of a document a chunk belongs to.
 *
 * The previous rule took the last caption appearing before the chunk *ended*, so a
 * chunk made of Table A's continuation rows was renamed after Table B the moment
 * B's caption fell inside it — even on the final line. That is how the chunk holding
 * the 2016 population-density table came to be titled "Tabel 3.2.11 Jumlah Pencari
 * Kerja".
 *
 * It is not a cosmetic bug. The title is embedded with the chunk and shown to the
 * model as the citation, and measured against a population-density query the wrong
 * title scores 0.7852 where no title at all scores 0.8179 — actively worse than
 * silence.
 *
 * The rule here is ownership by coverage: a section runs until the next section
 * begins, and the chunk belongs to whichever covers most of it. A table is preferred
 * over the enclosing chapter when both cover the same span, since the table is the
 * more specific answer.
 */

/**
 * @param {number} chunkStart character offset of the chunk within the document
 * @param {number} chunkEnd   character offset one past its end
 * @param {Array<{type:string, position:number, label:string}>} entries captions in document order
 * @returns {{type:string, position:number, label:string}|null}
 */
function sectionForChunk(chunkStart, chunkEnd, entries) {
  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
  if (list.length === 0) return null;

  const ordered = [...list].sort((a, b) => a.position - b.position);
  const spans = ordered.map((entry, i) => ({
    entry,
    from: entry.position,
    to: i + 1 < ordered.length ? ordered[i + 1].position : Number.MAX_SAFE_INTEGER,
  }));

  let best = null;
  let bestOverlap = 0;
  for (const s of spans) {
    const overlap = Math.min(chunkEnd, s.to) - Math.max(chunkStart, s.from);
    if (overlap <= 0) continue;
    const isTable = s.entry.type !== 'BAB';
    const bestIsTable = best && best.type !== 'BAB';
    // More coverage wins. On equal coverage a table beats the chapter that contains it.
    if (overlap > bestOverlap || (overlap === bestOverlap && isTable && !bestIsTable)) {
      best = s.entry;
      bestOverlap = overlap;
    }
  }

  // A chunk sitting entirely before the first caption still belongs to the document;
  // give it the earliest section rather than nothing.
  return best || ordered[0];
}

/**
 * The captions a chunk actually carries, which is what its title should name.
 *
 * Coverage alone is not enough. Chunk 45 of Dalam Angka 2017 spans the tail of Tabel
 * 3.1.3, the whole of 3.1.4 — the density table — and the head of 3.1.5; by coverage
 * it is named 3.1.3, the one table whose caption a reader cannot see anywhere in it.
 * A caption physically inside the chunk is a fact about the text; a carried-over
 * section is an inference. Facts win.
 *
 * Falls back to the covering section when the chunk contains no caption of its own,
 * which is the common case for a long table's continuation rows.
 *
 * @returns {Array} at most `max` entries, in document order
 */
function sectionsForChunk(chunkStart, chunkEnd, entries, max = 2) {
  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
  if (list.length === 0) return [];

  const ordered = [...list].sort((a, b) => a.position - b.position);
  const inside = ordered.filter(e => e.position >= chunkStart && e.position < chunkEnd);

  if (inside.length > 0) {
    const tables = inside.filter(e => e.type !== 'BAB');
    const chosen = tables.length > 0 ? tables : inside;
    return chosen.slice(0, max);
  }

  const covering = sectionForChunk(chunkStart, chunkEnd, ordered);
  return covering ? [covering] : [];
}

// Lifted verbatim from scripts/enrich-chunk-titles.js, which this supersedes. The
// caption parsing and body-position mapping were sound; only the offset estimate
// and the selection rule were wrong.
function parseIndicatorIndex(indexText) {
  if (!indexText) return [];
  const lines = indexText.split('\n').filter(l => l.trim());
  const entries = [];
  
  for (const line of lines) {
    const parts = line.split('|');
    if (parts.length >= 3) {
      const type = parts[0].trim();
      const num = parts[1].trim();
      const title = parts.slice(2).join('|').trim();
      
      // Build search patterns for finding this entry in content
      const searchPatterns = [];
      
      if (type === 'BAB') {
        // For BAB, search for chapter headers
        const firstWords = title.split(/\s+/).slice(0, 3).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
        if (firstWords) searchPatterns.push(new RegExp(`${num}[.\\s]*${firstWords}`, 'i'));
        searchPatterns.push(new RegExp(`BAB\\s+${num}`, 'i'));
      } else if (type === 'TBL') {
        // For tables, search for "Tabel X.Y.Z" or table number with spaces (OCR artifact)
        const numEscaped = num.replace(/\./g, '[.\\s]*');
        searchPatterns.push(new RegExp(`(?:tabel|table)\\s*${numEscaped}`, 'i'));
        // Also try just the number pattern with title words
        const titleWords = title.split(/\s+/).slice(0, 2).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
        if (titleWords) searchPatterns.push(new RegExp(`${numEscaped}[\\s.]+${titleWords}`, 'i'));
      } else if (type === 'GMB') {
        const numEscaped = num.replace(/\./g, '[.\\s]*');
        searchPatterns.push(new RegExp(`(?:gambar|figure)\\s*${numEscaped}`, 'i'));
      }
      
      // Also search for distinctive title phrases (4+ char words, first 4)
      const titleWords = title.split(/\s+/).filter(w => w.length >= 4).slice(0, 4);
      if (titleWords.length >= 3) {
        const phrase = titleWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
        searchPatterns.push(new RegExp(phrase, 'i'));
      }
      
      // Build concise label
      const typeLabel = { 'BAB': 'Bab', 'TBL': 'Tabel', 'GMB': 'Gambar', 'LMP': 'Lampiran' }[type] || type;
      let label = `${typeLabel} ${num}: ${title}`;
      if (label.length > 100) label = label.substring(0, 97) + '...';
      
      entries.push({ type, num, title, label, searchPatterns });
    }
  }
  
  return entries;
}

/**
 * Find positions of all TOC entries in parent content
 * Returns entries sorted by position
 */
function mapEntryPositions(entries, content) {
  const contentLower = content.toLowerCase();
  const mapped = [];
  
  for (const entry of entries) {
    let bestPos = -1;
    
    for (const pattern of entry.searchPatterns) {
      try {
        const match = pattern.exec(contentLower);
        if (match) {
          bestPos = match.index;
          break; // Use first matching pattern
        }
      } catch (e) {
        // Regex may fail on complex patterns, skip
      }
    }
    
    if (bestPos >= 0) {
      mapped.push({ ...entry, position: bestPos });
    }
  }
  
  // Sort by position in document
  mapped.sort((a, b) => a.position - b.position);
  return mapped;
}

/**
 * For a chunk at a given character range, find the most recent TOC entry
 * that starts before or within the chunk. Prefer TBL over BAB.
 */

module.exports = { sectionForChunk, sectionsForChunk, parseIndicatorIndex, mapEntryPositions };


