#!/usr/bin/env node
/**
 * Re-embed All Documents Script
 * 
 * Upgrades all embeddings from text-embedding-3-small (1536 dims)
 * to text-embedding-3-large (3072 dims).
 *
 * Usage:
 *   node scripts/reembed-all.js                  # Re-embed all (skip already 3072)
 *   node scripts/reembed-all.js --force           # Force re-embed everything
 *   node scripts/reembed-all.js --knowledge-only  # Only knowledge base
 *   node scripts/reembed-all.js --datasources-only # Only datasources
 *   node scripts/reembed-all.js --dry-run          # Show what would be done
 */

'use strict';

const path = require('path');
// Load env from backend root
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const sequelize = require('../src/config/db');
const KnowledgeBase = require('../src/models/KnowledgeBase.model');
const DataSource = require('../src/models/DataSource.model');
const { generateEmbedding, buildEmbeddingText, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } = require('../src/services/ai/embedding.service');
const { Op } = require('sequelize');

// ── Configuration ────────────────────────────────────────────────────────

const DELAY_MS = parseInt(process.env.REEMBED_DELAY_MS || '200', 10);
const BATCH_PAUSE_MS = 5000;   // 5s pause every 50 docs
const BATCH_SIZE = 50;
const MAX_RETRIES = 3;

// ── CLI args ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const KB_ONLY = args.includes('--knowledge-only');
const DS_ONLY = args.includes('--datasources-only');
const DRY_RUN = args.includes('--dry-run');

// ── Helpers ──────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function needsReEmbed(embeddingJson) {
  if (!embeddingJson) return true;
  try {
    const arr = JSON.parse(embeddingJson);
    return !Array.isArray(arr) || arr.length !== EMBEDDING_DIMENSIONS;
  } catch {
    return true;
  }
}

async function embedWithRetry(text, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await generateEmbedding(text);
    } catch (e) {
      const status = e?.response?.status || e?.statusCode;
      if (attempt === retries) throw e;
      // Rate limit — wait longer
      const backoff = status === 429 ? 30000 : 2000 * attempt;
      console.warn(`  ⚠ Attempt ${attempt} failed (${e.message}), retrying in ${backoff}ms...`);
      await sleep(backoff);
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║        Re-embed All Documents → text-embedding-3-large  ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log(`Model: ${EMBEDDING_MODEL} (${EMBEDDING_DIMENSIONS} dims)`);
  console.log(`Force: ${FORCE}, DryRun: ${DRY_RUN}, Delay: ${DELAY_MS}ms`);
  console.log();

  await sequelize.authenticate();
  console.log('✓ Database connected\n');

  const stats = { total: 0, embedded: 0, skipped: 0, errors: 0, errorDetails: [] };

  // ── 1. Knowledge Base ──────────────────────────────────────────────

  if (!DS_ONLY) {
    const kbDocs = await KnowledgeBase.findAll({
      where: { status: 'ready' },
      order: [['id', 'ASC']],
      attributes: ['id', 'title', 'content', 'embedding'],
    });

    const kbToEmbed = FORCE ? kbDocs : kbDocs.filter(d => needsReEmbed(d.embedding));
    console.log(`📚 Knowledge Base: ${kbToEmbed.length}/${kbDocs.length} need re-embedding`);
    stats.total += kbToEmbed.length;

    for (let i = 0; i < kbToEmbed.length; i++) {
      const doc = kbToEmbed[i];
      const text = [doc.title, doc.content].filter(Boolean).join('\n\n');
      const shortTitle = (doc.title || '').slice(0, 50);

      if (DRY_RUN) {
        console.log(`  [${i + 1}/${kbToEmbed.length}] Would re-embed KB#${doc.id}: ${shortTitle}`);
        stats.embedded++;
        continue;
      }

      try {
        const embedding = await embedWithRetry(text);
        await KnowledgeBase.update(
          { embedding: JSON.stringify(embedding), embedding_updated_at: new Date() },
          { where: { id: doc.id } }
        );
        stats.embedded++;
        process.stdout.write(`  ✓ [${i + 1}/${kbToEmbed.length}] KB#${doc.id}: ${shortTitle}...\r`);
      } catch (e) {
        stats.errors++;
        stats.errorDetails.push(`KB#${doc.id}: ${e.message}`);
        console.error(`  ✗ KB#${doc.id}: ${e.message}`);
      }

      // Rate limiting
      if (i < kbToEmbed.length - 1) {
        await sleep(DELAY_MS);
        if ((i + 1) % BATCH_SIZE === 0) {
          console.log(`\n  ⏸ Batch pause (${BATCH_PAUSE_MS}ms) after ${i + 1} docs...`);
          await sleep(BATCH_PAUSE_MS);
        }
      }
    }
    console.log(`\n✓ Knowledge Base complete: ${stats.embedded} embedded, ${stats.errors} errors\n`);
  }

  // ── 2. DataSources ─────────────────────────────────────────────────

  if (!KB_ONLY) {
    const kbEmbedded = stats.embedded;
    const kbErrors = stats.errors;

    const dsSources = await DataSource.findAll({
      where: { status: true },
      order: [['id', 'ASC']],
      attributes: ['id', 'name', 'description', 'aliases', 'category', 'embedding'],
    });

    const dsToEmbed = FORCE ? dsSources : dsSources.filter(d => needsReEmbed(d.embedding));
    console.log(`📊 DataSources: ${dsToEmbed.length}/${dsSources.length} need re-embedding`);
    stats.total += dsToEmbed.length;

    for (let i = 0; i < dsToEmbed.length; i++) {
      const source = dsToEmbed[i];
      const text = buildEmbeddingText(source);
      const shortName = (source.name || '').slice(0, 50);

      if (!text) {
        stats.skipped++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`  [${i + 1}/${dsToEmbed.length}] Would re-embed DS#${source.id}: ${shortName}`);
        stats.embedded++;
        continue;
      }

      try {
        const embedding = await embedWithRetry(text);
        await DataSource.update(
          { embedding: JSON.stringify(embedding), embedding_updated_at: new Date() },
          { where: { id: source.id } }
        );
        stats.embedded++;
        process.stdout.write(`  ✓ [${i + 1}/${dsToEmbed.length}] DS#${source.id}: ${shortName}...\r`);
      } catch (e) {
        stats.errors++;
        stats.errorDetails.push(`DS#${source.id}: ${e.message}`);
        console.error(`  ✗ DS#${source.id}: ${e.message}`);
      }

      // Rate limiting
      if (i < dsToEmbed.length - 1) {
        await sleep(DELAY_MS);
        if ((i + 1) % BATCH_SIZE === 0) {
          console.log(`\n  ⏸ Batch pause (${BATCH_PAUSE_MS}ms) after ${i + 1} docs...`);
          await sleep(BATCH_PAUSE_MS);
        }
      }
    }
    const dsEmbedded = stats.embedded - kbEmbedded;
    const dsErrors = stats.errors - kbErrors;
    console.log(`\n✓ DataSources complete: ${dsEmbedded} embedded, ${dsErrors} errors\n`);
  }

  // ── Summary ────────────────────────────────────────────────────────

  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log(`║  TOTAL: ${stats.embedded} embedded, ${stats.skipped} skipped, ${stats.errors} errors`);
  console.log(`║  Model: ${EMBEDDING_MODEL} (${EMBEDDING_DIMENSIONS} dims)`);
  if (DRY_RUN) console.log('║  ⚠ DRY RUN — no actual changes made');
  console.log('╚═══════════════════════════════════════════════════════════╝');

  if (stats.errorDetails.length > 0) {
    console.log('\nError details:');
    stats.errorDetails.forEach(e => console.log(`  - ${e}`));
  }

  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
