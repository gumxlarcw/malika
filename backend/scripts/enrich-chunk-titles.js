#!/usr/bin/env node
/**
 * enrich-chunk-titles.js
 * 
 * One-time script to enrich chunk titles from parent's indicator_index.
 * Uses POSITION-BASED mapping: finds where each TOC entry appears in
 * the parent content, then assigns chunks based on their char range.
 * 
 * Before: "Provinsi Maluku Utara Dalam Angka 2025 (221/299)"
 * After:  "Provinsi Maluku Utara Dalam Angka 2025 (221/299) — Tabel 8.5: Jumlah Rumah Makan/Restoran Menurut Kab/Kota"
 * 
 * Usage:
 *   node scripts/enrich-chunk-titles.js              # Dry run (preview only)
 *   node scripts/enrich-chunk-titles.js --execute     # Apply changes
 *   node scripts/enrich-chunk-titles.js --parent=855  # Only one parent (dry run)
 *   node scripts/enrich-chunk-titles.js --verbose      # Show all changes
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Sequelize, Op } = require('sequelize');
const sequelize = new Sequelize(
  process.env.DB_NAME || 'project_data_strategis',
  process.env.DB_USER || 'root',
  process.env.DB_PASS || '',
  {
    host: process.env.DB_HOST || 'localhost',
    dialect: 'mysql',
    logging: false,
  }
);

const EXECUTE = process.argv.includes('--execute');
const PARENT_ONLY = process.argv.find(a => a.startsWith('--parent='));
const TARGET_PARENT = PARENT_ONLY ? parseInt(PARENT_ONLY.split('=')[1]) : null;
const VERBOSE = process.argv.includes('--verbose');

// Chunk parameters (must match knowledgeDoc.service.js)
const CHUNK_SIZE = parseInt(process.env.KB_CHUNK_SIZE || '4000', 10);
const CHUNK_OVERLAP = parseInt(process.env.KB_CHUNK_OVERLAP || '400', 10);
const CHUNK_STRIDE = CHUNK_SIZE - CHUNK_OVERLAP; // 3600

/**
 * Parse indicator_index into structured entries
 * Format: TYPE|NUM|TITLE (one per line)
 */
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
function findSectionForChunk(chunkStart, chunkEnd, mappedEntries) {
  let bestTbl = null;
  let bestBab = null;
  
  for (const entry of mappedEntries) {
    // Entry must start before the chunk ends
    if (entry.position > chunkEnd) break;
    
    if (entry.type === 'BAB') {
      bestBab = entry;
    } else {
      bestTbl = entry;
    }
  }
  
  // Prefer specific entry (TBL/GMB) over BAB
  // TBL should be "recent enough" — within 3 chunks back (reasonable for multi-page tables)
  if (bestTbl && bestTbl.position >= chunkStart - CHUNK_SIZE * 5) {
    return bestTbl;
  }
  
  // Fall back to BAB
  if (bestBab) {
    return bestBab;
  }
  
  return bestTbl || null;
}

/**
 * Extract chunk number from title like "Doc Name (221/299)"
 */
function extractChunkNum(title) {
  const match = title.match(/\((\d+)\/(\d+)\)\s*$/);
  if (!match) return null;
  return { num: parseInt(match[1]), total: parseInt(match[2]) };
}

async function main() {
  console.log(`\n=== Chunk Title Enrichment (Position-Based) ===`);
  console.log(`Mode: ${EXECUTE ? '🔴 EXECUTE (will update DB)' : '🟢 DRY RUN (preview only)'}`);
  console.log(`Chunk params: size=${CHUNK_SIZE}, overlap=${CHUNK_OVERLAP}, stride=${CHUNK_STRIDE}`);
  if (TARGET_PARENT) console.log(`Target parent: ${TARGET_PARENT}`);
  console.log('');
  
  await sequelize.authenticate();
  
  // Load parent metadata
  const parents = await sequelize.query(
    `SELECT id, title, LENGTH(content) as content_len, LENGTH(indicator_index) as idx_len
     FROM knowledge_base 
     WHERE parent_id IS NULL AND status='ready' 
       AND indicator_index IS NOT NULL AND LENGTH(indicator_index) > 10
       ${TARGET_PARENT ? `AND id = ${parseInt(TARGET_PARENT)}` : ''}
     ORDER BY id`,
    { type: Sequelize.QueryTypes.SELECT }
  );
  
  console.log(`Found ${parents.length} parents with indicator_index\n`);
  
  let totalChunks = 0;
  let enrichedChunks = 0;
  let skippedChunks = 0;
  let noMatchChunks = 0;
  let errorCount = 0;
  const updates = [];
  
  for (let pi = 0; pi < parents.length; pi++) {
    const parentMeta = parents[pi];
    
    // Load full parent content + indicator_index
    const [parent] = await sequelize.query(
      `SELECT id, title, content, indicator_index FROM knowledge_base WHERE id = ?`,
      { replacements: [parentMeta.id], type: Sequelize.QueryTypes.SELECT }
    );
    
    if (!parent || !parent.content || !parent.indicator_index) continue;
    
    const entries = parseIndicatorIndex(parent.indicator_index);
    if (entries.length === 0) continue;
    
    // Map entries to positions in content
    const mapped = mapEntryPositions(entries, parent.content);
    
    if (mapped.length === 0) {
      if (VERBOSE) console.log(`  ⚪ Parent #${parent.id}: No entries mapped to content positions`);
      continue;
    }
    
    // Load chunks (only id, title, chunk_index)
    const chunks = await sequelize.query(
      `SELECT id, title, chunk_index FROM knowledge_base 
       WHERE parent_id = ? AND status = 'ready' ORDER BY id`,
      { replacements: [parent.id], type: Sequelize.QueryTypes.SELECT }
    );
    
    if (chunks.length === 0) continue;
    
    if (VERBOSE) {
      console.log(`\n📖 Parent #${parent.id}: "${parent.title}" (${entries.length} TOC, ${mapped.length} mapped, ${chunks.length} chunks)`);
    }
    
    let parentEnriched = 0;
    
    for (const chunk of chunks) {
      totalChunks++;
      
      // Skip if already enriched
      if (chunk.title.includes(' — ')) {
        skippedChunks++;
        continue;
      }
      
      try {
        const chunkInfo = extractChunkNum(chunk.title);
        if (!chunkInfo) {
          noMatchChunks++;
          continue;
        }
        
        // chunk (M/N) = allChunks[M-1]
        // allChunks[k] = content[k*STRIDE : k*STRIDE+CHUNK_SIZE]
        const chunkIdx = chunkInfo.num - 1; // 0-based
        const chunkStart = chunkIdx * CHUNK_STRIDE;
        const chunkEnd = chunkStart + CHUNK_SIZE;
        
        const section = findSectionForChunk(chunkStart, chunkEnd, mapped);
        
        if (!section) {
          noMatchChunks++;
          continue;
        }
        
        let newTitle = `${chunk.title} — ${section.label}`;
        // Ensure title fits in VARCHAR(500) column
        if (newTitle.length > 490) {
          const maxLabel = 490 - chunk.title.length - 3; // 3 for " — "
          newTitle = `${chunk.title} — ${section.label.substring(0, maxLabel)}...`;
        }
        
        if (VERBOSE || TARGET_PARENT) {
          console.log(`  ✅ #${chunk.id}: (${chunkInfo.num}/${chunkInfo.total}) [${chunkStart}-${chunkEnd}]`);
          console.log(`     → ${section.label}`);
        }
        
        updates.push({ id: chunk.id, newTitle });
        enrichedChunks++;
        parentEnriched++;
      } catch (e) {
        errorCount++;
        if (VERBOSE) console.error(`  ❌ Error on chunk #${chunk.id}: ${e.message}`);
      }
    }
    
    if (!VERBOSE && !TARGET_PARENT && parentEnriched > 0) {
      // Compact progress log
      if ((pi + 1) % 100 === 0 || pi === parents.length - 1) {
        console.log(`  Progress: ${pi + 1}/${parents.length} parents, ${enrichedChunks} enriched`);
      }
    }
  }
  
  // Apply updates in batch
  if (EXECUTE && updates.length > 0) {
    console.log(`\nApplying ${updates.length} title updates...`);
    const BATCH_SIZE = 100;
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE);
      const cases = batch.map(u => `WHEN ${u.id} THEN ${sequelize.escape(u.newTitle)}`).join(' ');
      const ids = batch.map(u => u.id).join(',');
      await sequelize.query(`UPDATE knowledge_base SET title = CASE id ${cases} END WHERE id IN (${ids})`);
      if ((i + BATCH_SIZE) % 1000 === 0 || i + BATCH_SIZE >= updates.length) {
        console.log(`  Applied ${Math.min(i + BATCH_SIZE, updates.length)}/${updates.length}`);
      }
    }
  }
  
  console.log(`\n=== Results ===`);
  console.log(`Total chunks processed: ${totalChunks}`);
  console.log(`Enriched: ${enrichedChunks}`);
  console.log(`Skipped (already enriched): ${skippedChunks}`);
  console.log(`No match found: ${noMatchChunks}`);
  console.log(`Errors: ${errorCount}`);
  
  if (!EXECUTE) {
    console.log(`\n⚠️  DRY RUN — no changes made. Run with --execute to apply.`);
  } else {
    console.log(`\n✅ Done! ${enrichedChunks} chunk titles updated.`);
  }
  
  await sequelize.close();
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
