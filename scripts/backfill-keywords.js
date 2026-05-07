#!/usr/bin/env node
/**
 * Backfill Keywords for Knowledge Base
 *
 * One-time script to extract statistical keywords for all existing
 * knowledge_base parent documents that don't have keywords yet.
 *
 * Usage:
 *   node scripts/backfill-keywords.js                  # Run all (default batch=20)
 *   node scripts/backfill-keywords.js --batch=50       # Custom batch size
 *   node scripts/backfill-keywords.js --dry-run        # Preview only, no DB writes
 *   node scripts/backfill-keywords.js --limit=100      # Only process first 100
 *
 * Estimated cost: ~1322 parent docs × $0.00002/doc ≈ $0.026 total
 * Estimated time: ~1322 × 0.5s ≈ 11 min (with rate limiting)
 */

'use strict';

// Parse CLI args
const args = process.argv.slice(2);
const BATCH_SIZE = parseInt(args.find(a => a.startsWith('--batch='))?.split('=')[1]) || 20;
const DRY_RUN = args.includes('--dry-run');
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1]) || 0;

async function main() {
  // Initialize Sequelize
  // Load env from backend directory where dotenv is installed
  process.env.NODE_PATH = require('path').join(__dirname, '..', 'backend', 'node_modules');
  require('module').Module._initPaths();
  require('dotenv').config({ path: require('path').join(__dirname, '..', 'backend', '.env') });
  const sequelize = require('../backend/src/config/db');

  try {
    await sequelize.authenticate();
    console.log('Database connected');
  } catch (err) {
    console.error('DB connection failed:', err.message);
    process.exit(1);
  }

  const KnowledgeBase = require('../backend/src/models/KnowledgeBase.model');
  const { extractKeywords, extractKeywordsFallback } = require('../backend/src/services/ai/keywordExtractor.service');

  // Find parent docs without keywords
  const where = {
    parent_id: null,    // Only parent docs (not chunks)
    keywords: null,     // Not yet extracted
  };

  const total = await KnowledgeBase.count({ where });
  const effectiveLimit = LIMIT > 0 ? Math.min(LIMIT, total) : total;

  console.log(`\nBackfill Keywords`);
  console.log(`─────────────────────────────`);
  console.log(`Total parent docs without keywords: ${total}`);
  console.log(`Processing: ${effectiveLimit}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no DB writes)' : 'LIVE'}`);
  console.log(`─────────────────────────────\n`);

  let processed = 0;
  let success = 0;
  let failed = 0;
  let llmUsed = 0;
  let fallbackUsed = 0;

  // Process in batches
  let offset = 0;
  while (processed < effectiveLimit) {
    const batchLimit = Math.min(BATCH_SIZE, effectiveLimit - processed);
    const docs = await KnowledgeBase.findAll({
      where,
      attributes: ['id', 'title', 'description', 'category', 'content'],
      order: [['id', 'ASC']],
      limit: batchLimit,
      offset: 0,  // Always 0 since we UPDATE as we go, removing from the WHERE set
      raw: true,
    });

    if (docs.length === 0) break;

    for (const doc of docs) {
      try {
        // Extract abstract from content (first 500 chars after title)
        let abstract = '';
        if (doc.content) {
          const lines = doc.content.split('\n').slice(1); // Skip title line
          abstract = lines.join('\n').slice(0, 500);
        }

        const keywords = await extractKeywords(doc.title, abstract || doc.description);

        if (keywords) {
          if (!DRY_RUN) {
            await KnowledgeBase.update(
              { keywords },
              { where: { id: doc.id } }
            );
          }

          // Check if LLM was used (LLM returns more diverse keywords vs fallback)
          const isFallback = keywords === extractKeywordsFallback(doc.title);
          if (isFallback) fallbackUsed++;
          else llmUsed++;

          success++;
        } else {
          failed++;
        }

        processed++;

        // Progress log
        if (processed % 10 === 0 || processed === effectiveLimit) {
          const pct = ((processed / effectiveLimit) * 100).toFixed(1);
          console.log(`[${pct}%] ${processed}/${effectiveLimit} | OK:${success} Fail:${failed} | Last: "${doc.title?.slice(0, 50)}..." → ${keywords?.slice(0, 60)}`);
        }

        // Rate limiting delay between LLM calls
        if (processed < effectiveLimit) {
          await new Promise(r => setTimeout(r, 300));
        }
      } catch (err) {
        console.error(`  ERROR doc ${doc.id}: ${err.message}`);
        failed++;
        processed++;
      }
    }
  }

  console.log(`\n─────────────────────────────`);
  console.log(`Backfill Complete`);
  console.log(`─────────────────────────────`);
  console.log(`Processed: ${processed}`);
  console.log(`Success:   ${success}`);
  console.log(`Failed:    ${failed}`);
  console.log(`LLM used:  ${llmUsed}`);
  console.log(`Fallback:  ${fallbackUsed}`);
  if (DRY_RUN) console.log(`(DRY RUN — no changes written)`);
  console.log(`─────────────────────────────\n`);

  // Verify
  if (!DRY_RUN) {
    const remaining = await KnowledgeBase.count({
      where: { parent_id: null, keywords: null }
    });
    console.log(`Remaining without keywords: ${remaining}`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
