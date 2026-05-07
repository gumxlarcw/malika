#!/usr/bin/env node
/**
 * Rechunk All Long Documents Script
 *
 * Splits all knowledge base documents >4000 chars into overlapping chunks,
 * generates embeddings for each chunk, enabling full-document semantic search.
 *
 * Parent documents keep their full content (for BM25/keyword search).
 * Child chunks cover the entire document with embeddings for deep-content retrieval.
 *
 * Usage:
 *   node scripts/rechunk-all.js                    # Rechunk + embed all long docs
 *   node scripts/rechunk-all.js --dry-run           # Preview only
 *   node scripts/rechunk-all.js --force             # Re-chunk even if already chunked
 *   node scripts/rechunk-all.js --chunk-only        # Create chunks without embedding
 *   node scripts/rechunk-all.js --embed-only        # Embed existing pending chunks
 *   node scripts/rechunk-all.js --batch-size 30     # Customize batch size
 *   node scripts/rechunk-all.js --start-id 500      # Start from a specific parent ID
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const sequelize = require('../src/config/db');
const KnowledgeBase = require('../src/models/KnowledgeBase.model');
const { generateEmbedding, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } = require('../src/services/ai/embedding.service');
const { chunkText, MAX_CHUNK_SIZE, CHUNK_OVERLAP } = require('../src/services/ai/knowledgeDoc.service');
const { Op } = require('sequelize');

// ── Configuration ────────────────────────────────────────────────────────

const DELAY_MS = parseInt(process.env.RECHUNK_DELAY_MS || '200', 10);
const BATCH_PAUSE_MS = parseInt(process.env.RECHUNK_BATCH_PAUSE_MS || '10000', 10);
const DEFAULT_BATCH_SIZE = 50;
const MAX_RETRIES = 3;

// ── CLI args ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');
const CHUNK_ONLY = args.includes('--chunk-only');
const EMBED_ONLY = args.includes('--embed-only');

function getArgValue(name, defaultVal) {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  return parseInt(args[idx + 1], 10) || defaultVal;
}
const BATCH_SIZE = getArgValue('--batch-size', DEFAULT_BATCH_SIZE);
const START_ID = getArgValue('--start-id', 0);

// ── Helpers ──────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function embedWithRetry(text, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await generateEmbedding(text);
    } catch (e) {
      const status = e?.response?.status || e?.statusCode;
      if (attempt === retries) throw e;
      const backoff = status === 429 ? 30000 : 2000 * attempt;
      console.warn(`  ⚠ Attempt ${attempt} failed (${e.message}), retrying in ${backoff}ms...`);
      await sleep(backoff);
    }
  }
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

// ── Phase 1: Create chunks ─────────────────────────────────────────────

async function createChunksForAllDocs() {
  console.log('\n═══ Phase 1: Creating chunks ═══\n');

  // Find all parent docs that are long enough to chunk
  const whereClause = {
    parent_id: null,
    status: 'ready',
    id: { [Op.gte]: START_ID },
  };
  
  const parents = await KnowledgeBase.findAll({
    where: whereClause,
    order: [['id', 'ASC']],
    attributes: ['id', 'title', 'content', 'category', 'source_type', 'source_filename', 'source_url', 'created_by'],
  });

  // Filter by content length
  const longDocs = parents.filter(p => (p.content || '').length > MAX_CHUNK_SIZE);
  console.log(`Found ${longDocs.length} documents with content > ${MAX_CHUNK_SIZE} chars\n`);

  // If not forcing, skip docs that already have child chunks
  let toProcess;
  if (FORCE) {
    toProcess = longDocs;
  } else {
    const existingChunks = await KnowledgeBase.findAll({
      where: { parent_id: { [Op.in]: longDocs.map(d => d.id) } },
      attributes: ['parent_id'],
      group: ['parent_id'],
      raw: true,
    });
    const alreadyChunked = new Set(existingChunks.map(c => c.parent_id));
    toProcess = longDocs.filter(d => !alreadyChunked.has(d.id));
    console.log(`Skipping ${alreadyChunked.size} already-chunked docs, processing ${toProcess.length}\n`);
  }

  const stats = { processed: 0, chunksCreated: 0, errors: 0, errorDetails: [] };
  const startTime = Date.now();

  for (let i = 0; i < toProcess.length; i++) {
    const parent = toProcess[i];
    const content = String(parent.content || '').trim();
    const shortTitle = (parent.title || '').slice(0, 50);

    // Split into chunks
    const allChunks = chunkText(content, MAX_CHUNK_SIZE, CHUNK_OVERLAP);
    if (allChunks.length <= 1) {
      stats.processed++;
      continue;
    }

    // Skip chunk 0 (parent covers it), create children for chunks 1..N
    const childChunks = allChunks.slice(1);
    const baseTitle = parent.title.replace(/\s*\(\d+\/\d+\)\s*$/, '');

    if (DRY_RUN) {
      console.log(`  [DRY] #${parent.id}: "${shortTitle}..." (${content.length} chars → ${allChunks.length} chunks, ${childChunks.length} new)`);
      stats.processed++;
      stats.chunksCreated += childChunks.length;
      continue;
    }

    try {
      // Delete existing child chunks if forcing
      if (FORCE) {
        await KnowledgeBase.destroy({ where: { parent_id: parent.id } });
      }

      // Create child rows
      for (let j = 0; j < childChunks.length; j++) {
        const chunk = childChunks[j];
        await KnowledgeBase.create({
          title: `${baseTitle} (${j + 2}/${allChunks.length})`,
          description: null,
          category: parent.category,
          source_type: parent.source_type,
          source_filename: parent.source_filename,
          source_url: parent.source_url,
          content: chunk,
          content_length: chunk.length,
          chunk_index: j + 1,
          parent_id: parent.id,
          status: 'pending',
          created_by: parent.created_by,
        });
      }

      // Mark parent as chunk_index=0
      await KnowledgeBase.update({ chunk_index: 0 }, { where: { id: parent.id } });

      stats.processed++;
      stats.chunksCreated += childChunks.length;

      const elapsed = formatDuration(Date.now() - startTime);
      const rate = stats.processed / ((Date.now() - startTime) / 1000);
      const eta = formatDuration(((toProcess.length - i - 1) / Math.max(rate, 0.1)) * 1000);
      process.stdout.write(`  ✓ [${i + 1}/${toProcess.length}] #${parent.id}: ${childChunks.length} chunks (total: ${stats.chunksCreated}) [${elapsed}, ETA: ${eta}]\r`);
    } catch (e) {
      stats.errors++;
      stats.errorDetails.push(`#${parent.id}: ${e.message}`);
      console.error(`\n  ✗ #${parent.id}: ${e.message}`);
    }
  }

  console.log(`\n\n✓ Phase 1 complete: ${stats.processed} docs, ${stats.chunksCreated} chunks created, ${stats.errors} errors`);
  if (stats.errorDetails.length > 0) {
    console.log('Errors:', stats.errorDetails.slice(0, 10).join('; '));
  }
  return stats;
}

// ── Phase 2: Embed all pending chunks ──────────────────────────────────

async function embedPendingChunks() {
  console.log('\n═══ Phase 2: Embedding chunks ═══\n');

  // Find all pending chunks (child rows without embeddings)
  const pendingChunks = await KnowledgeBase.findAll({
    where: {
      parent_id: { [Op.ne]: null },
      [Op.or]: [
        { status: 'pending' },
        { status: 'error' },
        { embedding: null },
      ],
    },
    order: [['parent_id', 'ASC'], ['chunk_index', 'ASC']],
    attributes: ['id', 'title', 'content', 'parent_id', 'chunk_index'],
  });

  console.log(`Found ${pendingChunks.length} chunks needing embeddings\n`);

  if (DRY_RUN) {
    console.log(`  [DRY] Would embed ${pendingChunks.length} chunks`);
    return { embedded: pendingChunks.length, errors: 0 };
  }

  // Pre-load parent titles for embedding text (title + chunk content)
  const parentIds = [...new Set(pendingChunks.map(c => c.parent_id))];
  const parentDocs = await KnowledgeBase.findAll({
    where: { id: { [Op.in]: parentIds } },
    attributes: ['id', 'title'],
    raw: true,
  });
  const parentTitleMap = new Map(parentDocs.map(p => [p.id, p.title.replace(/\s*\(\d+\/\d+\)\s*$/, '')]));

  const stats = { embedded: 0, errors: 0, errorDetails: [] };
  const startTime = Date.now();

  for (let i = 0; i < pendingChunks.length; i++) {
    const chunk = pendingChunks[i];
    const parentTitle = parentTitleMap.get(chunk.parent_id) || chunk.title;
    const embeddingText = [parentTitle, chunk.content].filter(Boolean).join('\n\n');

    try {
      await KnowledgeBase.update({ status: 'processing' }, { where: { id: chunk.id } });

      const embedding = await embedWithRetry(embeddingText);

      await KnowledgeBase.update(
        {
          embedding: JSON.stringify(embedding),
          embedding_updated_at: new Date(),
          status: 'ready',
          error_message: null,
        },
        { where: { id: chunk.id } }
      );

      stats.embedded++;

      const elapsed = formatDuration(Date.now() - startTime);
      const rate = stats.embedded / ((Date.now() - startTime) / 1000);
      const eta = formatDuration(((pendingChunks.length - i - 1) / Math.max(rate, 0.1)) * 1000);
      process.stdout.write(`  ✓ [${i + 1}/${pendingChunks.length}] KB#${chunk.id} (parent #${chunk.parent_id}, chunk ${chunk.chunk_index}) [${elapsed}, ETA: ${eta}]\r`);
    } catch (e) {
      stats.errors++;
      stats.errorDetails.push(`KB#${chunk.id}: ${e.message}`);
      console.error(`\n  ✗ KB#${chunk.id}: ${e.message}`);
      await KnowledgeBase.update(
        { status: 'error', error_message: e.message },
        { where: { id: chunk.id } }
      ).catch(() => {});
    }

    // Rate limiting
    if (i < pendingChunks.length - 1) {
      await sleep(DELAY_MS);
      if ((i + 1) % BATCH_SIZE === 0) {
        console.log(`\n  ⏸ Batch pause (${BATCH_PAUSE_MS / 1000}s) after ${i + 1} chunks...`);
        await sleep(BATCH_PAUSE_MS);
      }
    }
  }

  console.log(`\n\n✓ Phase 2 complete: ${stats.embedded} embedded, ${stats.errors} errors`);
  if (stats.errorDetails.length > 0) {
    console.log('Errors:', stats.errorDetails.slice(0, 10).join('; '));
  }
  return stats;
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║    Full Document Chunking — Every Page, Every Document        ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log(`Embedding Model: ${EMBEDDING_MODEL} (${EMBEDDING_DIMENSIONS} dims)`);
  console.log(`Chunk Size: ${MAX_CHUNK_SIZE} chars, Overlap: ${CHUNK_OVERLAP} chars`);
  console.log(`Flags: DryRun=${DRY_RUN}, Force=${FORCE}, ChunkOnly=${CHUNK_ONLY}, EmbedOnly=${EMBED_ONLY}`);
  console.log(`BatchSize=${BATCH_SIZE}, Delay=${DELAY_MS}ms, BatchPause=${BATCH_PAUSE_MS}ms`);
  if (START_ID > 0) console.log(`Starting from parent ID >= ${START_ID}`);
  console.log();

  await sequelize.authenticate();
  console.log('✓ Database connected');

  // Pre-flight stats
  const [preStats] = await sequelize.query(`
    SELECT
      COUNT(*) as total_docs,
      SUM(parent_id IS NULL) as parents,
      SUM(parent_id IS NOT NULL) as existing_chunks,
      SUM(parent_id IS NULL AND CHAR_LENGTH(content) > ${MAX_CHUNK_SIZE}) as need_chunking,
      ROUND(AVG(CASE WHEN parent_id IS NULL AND CHAR_LENGTH(content) > ${MAX_CHUNK_SIZE}
                      THEN CHAR_LENGTH(content) END)) as avg_long_doc_len
    FROM knowledge_base WHERE status = 'ready'
  `);
  const pre = preStats[0];
  console.log(`\nPre-flight: ${pre.parents} parents, ${pre.existing_chunks} existing chunks`);
  console.log(`${pre.need_chunking} docs need chunking (avg ${pre.avg_long_doc_len} chars)`);

  // Estimate chunks
  const avgChunks = Math.ceil(((pre.avg_long_doc_len || 67000) - MAX_CHUNK_SIZE) / (MAX_CHUNK_SIZE - CHUNK_OVERLAP));
  const estTotal = (pre.need_chunking || 0) * avgChunks;
  console.log(`Estimated new chunks: ~${estTotal.toLocaleString()}`);
  const estCost = (estTotal * 2500 * 1.5 / 1000000) * 0.13; // avg 2500 chars × 1.5 tok/char × $0.13/1M
  console.log(`Estimated embedding cost: ~$${estCost.toFixed(2)}`);
  console.log(`Estimated RAM increase: ~${((estTotal * 3072 * 8) / (1024 * 1024)).toFixed(0)}MB for embedding vectors\n`);

  const overallStart = Date.now();

  // Phase 1: Create chunks
  let chunkStats = { chunksCreated: 0 };
  if (!EMBED_ONLY) {
    chunkStats = await createChunksForAllDocs();
  }

  // Phase 2: Embed chunks
  let embedStats = { embedded: 0, errors: 0 };
  if (!CHUNK_ONLY && !DRY_RUN) {
    embedStats = await embedPendingChunks();
  }

  // Post-flight stats
  const [postStats] = await sequelize.query(`
    SELECT
      COUNT(*) as total_rows,
      SUM(parent_id IS NULL) as parents,
      SUM(parent_id IS NOT NULL) as chunks,
      SUM(status = 'ready') as ready,
      SUM(status = 'pending') as pending,
      SUM(status = 'error') as errored
    FROM knowledge_base
  `);
  const post = postStats[0];

  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                       SUMMARY                                ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log(`Duration: ${formatDuration(Date.now() - overallStart)}`);
  console.log(`Chunks created: ${chunkStats.chunksCreated}`);
  console.log(`Chunks embedded: ${embedStats.embedded}`);
  console.log(`Embedding errors: ${embedStats.errors}`);
  console.log(`\nDatabase state:`);
  console.log(`  Total rows: ${post.total_rows}`);
  console.log(`  Parents: ${post.parents}`);
  console.log(`  Chunks: ${post.chunks}`);
  console.log(`  Ready: ${post.ready}`);
  console.log(`  Pending: ${post.pending}`);
  console.log(`  Error: ${post.errored}`);

  process.exit(0);
}

main().catch(e => {
  console.error('\n\nFATAL:', e);
  process.exit(1);
});
