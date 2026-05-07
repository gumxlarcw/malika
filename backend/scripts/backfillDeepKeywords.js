#!/usr/bin/env node
/**
 * Backfill Deep Keywords for Long Documents
 *
 * Scans knowledge_base for parent docs with content > 4000 chars
 * and re-extracts keywords using deep content analysis (TOC + section headers).
 *
 * Usage:
 *   node scripts/backfillDeepKeywords.js              # All long docs
 *   node scripts/backfillDeepKeywords.js --dry-run     # Preview only
 *   node scripts/backfillDeepKeywords.js --category=Publikasi  # Only publications
 *   node scripts/backfillDeepKeywords.js --limit=50    # Process 50 docs max
 *   node scripts/backfillDeepKeywords.js --min-content=10000  # Only very long docs
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { Sequelize } = require('sequelize');
const sequelize = require('../src/config/db');
const KnowledgeBase = require('../src/models/KnowledgeBase.model');
const { extractAllKeywords } = require('../src/services/ai/keywordExtractor.service');

// Parse CLI args
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const CATEGORY = args.find(a => a.startsWith('--category='))?.split('=')[1] || null;
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0', 10) || 0;
const MIN_CONTENT = parseInt(args.find(a => a.startsWith('--min-content='))?.split('=')[1] || '4000', 10);
const CONCURRENCY = 3;
const BATCH_SIZE = 10;
const DELAY_BETWEEN_BATCHES_MS = 500;

async function main() {
  console.log('=== Deep Keywords Backfill ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Min content: ${MIN_CONTENT} chars`);
  if (CATEGORY) console.log(`Category filter: ${CATEGORY}`);
  if (LIMIT) console.log(`Limit: ${LIMIT} docs`);
  console.log('');

  await sequelize.authenticate();

  // Find all parent docs with long content
  const where = {
    parent_id: null,
  };
  if (CATEGORY) where.category = CATEGORY;

  const docs = await KnowledgeBase.findAll({
    attributes: ['id', 'title', 'description', 'keywords', 'content', 'category'],
    where: {
      ...where,
      [Sequelize.Op.and]: [
        Sequelize.literal(`LENGTH(content) >= ${MIN_CONTENT}`),
      ],
    },
    order: [[Sequelize.literal('LENGTH(content)'), 'DESC']],
    ...(LIMIT ? { limit: LIMIT } : {}),
    raw: true,
  });

  console.log(`Found ${docs.length} documents to process`);
  if (docs.length === 0) {
    process.exit(0);
  }

  // Show sample
  console.log('\nSample:');
  for (const doc of docs.slice(0, 5)) {
    const oldKwCount = doc.keywords ? doc.keywords.split(',').length : 0;
    const clen = doc.content ? doc.content.length : 0;
    console.log(`  [${doc.id}] ${doc.title.slice(0, 60)} (${clen} chars, ${oldKwCount} existing kw)`);
  }
  console.log('');

  if (DRY_RUN) {
    console.log('DRY RUN - no changes will be made');
    process.exit(0);
  }

  let success = 0;
  let failed = 0;
  let skipped = 0;
  let improved = 0;
  const startTime = Date.now();

  // Process in batches
  for (let batchStart = 0; batchStart < docs.length; batchStart += BATCH_SIZE) {
    const batch = docs.slice(batchStart, batchStart + BATCH_SIZE);

    // Process batch with concurrency
    const promises = batch.map(async (doc) => {
      try {
        const oldKwCount = doc.keywords ? doc.keywords.split(',').length : 0;

        // Extract deep keywords (title + abstract + content)
        const newKeywords = await extractAllKeywords(
          doc.title,
          doc.description,
          doc.content,
        );

        if (!newKeywords) {
          skipped++;
          return;
        }

        const newKwCount = newKeywords.split(',').length;

        // Only update if we got more keywords
        if (newKwCount > oldKwCount) {
          await KnowledgeBase.update(
            { keywords: newKeywords },
            { where: { id: doc.id } },
          );
          improved++;
          if (newKwCount > oldKwCount + 3) {
            console.log(`  [${doc.id}] ${doc.title.slice(0, 50)} — ${oldKwCount} → ${newKwCount} keywords`);
          }
        } else {
          skipped++;
        }

        success++;
      } catch (err) {
        failed++;
        console.error(`  [${doc.id}] ERROR: ${err.message}`);
      }
    });

    // Run batch with concurrency limit
    for (let i = 0; i < promises.length; i += CONCURRENCY) {
      await Promise.all(promises.slice(i, i + CONCURRENCY));
    }

    const processed = Math.min(batchStart + BATCH_SIZE, docs.length);
    if (processed % 50 === 0 || processed === docs.length) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`Progress: ${processed}/${docs.length} (${elapsed}s) — ${improved} improved, ${failed} failed`);
    }

    // Delay between batches to avoid rate limiting
    if (batchStart + BATCH_SIZE < docs.length) {
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES_MS));
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n=== Results ===');
  console.log(`Total:    ${docs.length}`);
  console.log(`Success:  ${success}`);
  console.log(`Improved: ${improved} (got more keywords from deep extraction)`);
  console.log(`Skipped:  ${skipped} (no improvement or no keywords)`);
  console.log(`Failed:   ${failed}`);
  console.log(`Time:     ${totalTime}s`);

  // Refresh keyword index
  if (improved > 0) {
    console.log('\nRefreshing keyword index...');
    try {
      const { refreshIndex } = require('../src/services/chat/datasourceKeywordIndex.service');
      await refreshIndex();
      console.log('Keyword index refreshed');
    } catch (err) {
      console.warn('Keyword index refresh failed:', err.message);
    }
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
