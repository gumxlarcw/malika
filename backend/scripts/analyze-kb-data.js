#!/usr/bin/env node
/**
 * Analyze real KB data and chat token usage for token maximization decisions.
 */
'use strict';

const db = require('../src/config/db');

async function run() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  MALIKA Token Budget Analysis — Real Database Data');
  console.log('═══════════════════════════════════════════════════════════\n');

  // 1. Total KB docs + chunks
  const [total] = await db.query('SELECT COUNT(*) as cnt FROM knowledge_base');
  const [parents] = await db.query('SELECT COUNT(*) as cnt FROM knowledge_base WHERE parent_id IS NULL');
  const [chunks] = await db.query('SELECT COUNT(*) as cnt FROM knowledge_base WHERE parent_id IS NOT NULL');
  console.log('=== KB Overview ===');
  console.log('Total rows:', total[0].cnt);
  console.log('Parent docs:', parents[0].cnt);
  console.log('Chunks:', chunks[0].cnt);

  // 2. Parent doc content sizes by category
  const [catBasic] = await db.query(`
    SELECT category, 
           COUNT(*) as cnt,
           ROUND(AVG(content_length)) as avg_len,
           MIN(content_length) as min_len,
           MAX(content_length) as max_len,
           SUM(content_length) as total_chars
    FROM knowledge_base
    WHERE parent_id IS NULL
    GROUP BY category
    ORDER BY cnt DESC
  `);
  console.log('\n=== Parent Docs by Category ===');
  console.table(catBasic);

  // 3. Percentiles via ranked subquery (MySQL-compatible)
  for (const cat of ['BRS', 'Publikasi', 'PPID']) {
    const [rows] = await db.query(`
      SELECT content_length FROM knowledge_base 
      WHERE parent_id IS NULL AND category = ?
      ORDER BY content_length
    `, { replacements: [cat] });
    if (rows.length > 0) {
      const vals = rows.map(r => r.content_length);
      const p50 = vals[Math.floor(vals.length * 0.50)];
      const p75 = vals[Math.floor(vals.length * 0.75)];
      const p90 = vals[Math.floor(vals.length * 0.90)];
      const p95 = vals[Math.floor(vals.length * 0.95)];
      const p99 = vals[Math.floor(vals.length * 0.99)];
      console.log(`\n  ${cat} Percentiles: P50=${p50} P75=${p75} P90=${p90} P95=${p95} P99=${p99}`);
    }
  }

  // 4. Distribution of content_length for parent docs
  const [distrib] = await db.query(`
    SELECT 
      CASE 
        WHEN content_length < 5000 THEN '01: <5K'
        WHEN content_length < 10000 THEN '02: 5-10K'
        WHEN content_length < 20000 THEN '03: 10-20K'
        WHEN content_length < 30000 THEN '04: 20-30K'
        WHEN content_length < 50000 THEN '05: 30-50K'
        WHEN content_length < 80000 THEN '06: 50-80K'
        WHEN content_length < 100000 THEN '07: 80-100K'
        WHEN content_length < 150000 THEN '08: 100-150K'
        ELSE '09: 150K+'
      END as size_bucket,
      COUNT(*) as cnt
    FROM knowledge_base
    WHERE parent_id IS NULL
    GROUP BY size_bucket
    ORDER BY size_bucket
  `);
  console.log('\n=== Parent Doc Size Distribution ===');
  console.table(distrib);

  // 5. Top 20 largest docs
  const [largest] = await db.query(`
    SELECT id, category, content_length, LEFT(title, 70) as title
    FROM knowledge_base
    WHERE parent_id IS NULL
    ORDER BY content_length DESC
    LIMIT 20
  `);
  console.log('\n=== Top 20 Largest Parent Docs ===');
  console.table(largest);

  // 6. Docs over various thresholds (to see what gets truncated)
  for (const threshold of [30000, 50000, 80000, 100000, 150000]) {
    const [res] = await db.query(`
      SELECT COUNT(*) as cnt, ROUND(AVG(content_length)) as avg_len, MAX(content_length) as max_len
      FROM knowledge_base
      WHERE parent_id IS NULL AND content_length > ?
    `, { replacements: [threshold] });
    console.log(`Docs > ${(threshold/1000).toFixed(0)}K chars: ${res[0].cnt} docs (avg ${res[0].avg_len}, max ${res[0].max_len})`);
  }

  // 7. Chunk stats
  const [chunkStats] = await db.query(`
    SELECT 
      COUNT(*) as total_chunks,
      ROUND(AVG(content_length)) as avg_chunk_len,
      MIN(content_length) as min_chunk_len,
      MAX(content_length) as max_chunk_len
    FROM knowledge_base
    WHERE parent_id IS NOT NULL
  `);
  console.log('\n=== Chunk Stats ===');
  console.table(chunkStats);

  // 8. How many chunks per parent doc (to understand fan-out)
  const [chunkFanout] = await db.query(`
    SELECT 
      parent_id,
      COUNT(*) as chunk_count,
      k.content_length as parent_content_length,
      LEFT(k.title, 50) as title
    FROM knowledge_base c
    JOIN knowledge_base k ON k.id = c.parent_id
    WHERE c.parent_id IS NOT NULL
    GROUP BY parent_id
    ORDER BY chunk_count DESC
    LIMIT 10
  `);
  console.log('\n=== Top 10 Docs by Chunk Count ===');
  console.table(chunkFanout);

  // ═══════════════════════════════════════════════════════════════════
  // CHAT TOKEN USAGE FROM REAL MESSAGES
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  REAL CHAT TOKEN USAGE');
  console.log('═══════════════════════════════════════════════════════════\n');

  // 9. Token usage from chat_messages metadata
  const [tokenStats] = await db.query(`
    SELECT 
      COUNT(*) as total_messages,
      COUNT(CASE WHEN role = 'assistant' THEN 1 END) as assistant_msgs,
      COUNT(CASE WHEN JSON_EXTRACT(metadata, '$.tokens') IS NOT NULL THEN 1 END) as msgs_with_tokens
    FROM chat_messages
  `);
  console.log('=== Chat Message Overview ===');
  console.table(tokenStats);

  // 10. Extract actual token counts from metadata
  const [tokenData] = await db.query(`
    SELECT 
      JSON_EXTRACT(metadata, '$.tokens.input') as input_tokens,
      JSON_EXTRACT(metadata, '$.tokens.output') as output_tokens,
      JSON_EXTRACT(metadata, '$.tokens.total') as total_tokens,
      JSON_EXTRACT(metadata, '$.tokens.cached') as cached_tokens,
      JSON_EXTRACT(metadata, '$.tokens.reasoning') as reasoning_tokens,
      JSON_EXTRACT(metadata, '$.model') as model,
      JSON_EXTRACT(metadata, '$.tier') as tier,
      created_at
    FROM chat_messages
    WHERE role = 'assistant' 
      AND JSON_EXTRACT(metadata, '$.tokens.total') IS NOT NULL
      AND JSON_EXTRACT(metadata, '$.tokens.total') > 0
    ORDER BY created_at DESC
    LIMIT 200
  `);
  
  if (tokenData.length > 0) {
    console.log(`\n=== Token Usage (last ${tokenData.length} messages with token data) ===`);
    
    // Aggregate stats
    const inputs = tokenData.map(r => Number(r.input_tokens) || 0).filter(v => v > 0);
    const outputs = tokenData.map(r => Number(r.output_tokens) || 0).filter(v => v > 0);
    const totals = tokenData.map(r => Number(r.total_tokens) || 0).filter(v => v > 0);
    const cacheds = tokenData.map(r => Number(r.cached_tokens) || 0).filter(v => v > 0);
    const reasonings = tokenData.map(r => Number(r.reasoning_tokens) || 0).filter(v => v > 0);
    
    const stats = (arr, label) => {
      if (arr.length === 0) return console.log(`  ${label}: no data`);
      arr.sort((a, b) => a - b);
      const sum = arr.reduce((s, v) => s + v, 0);
      console.log(`  ${label} (n=${arr.length}):`);
      console.log(`    avg=${Math.round(sum/arr.length)} min=${arr[0]} max=${arr[arr.length-1]}`);
      console.log(`    P50=${arr[Math.floor(arr.length*0.5)]} P90=${arr[Math.floor(arr.length*0.9)]} P95=${arr[Math.floor(arr.length*0.95)]} P99=${arr[Math.floor(arr.length*0.99)]}`);
    };
    
    stats(inputs, 'Input Tokens');
    stats(outputs, 'Output Tokens');
    stats(totals, 'Total Tokens');
    stats(cacheds, 'Cached Tokens');
    stats(reasonings, 'Reasoning Tokens');
    
    // By model
    const byModel = {};
    for (const r of tokenData) {
      const model = (r.model || 'unknown').replace(/"/g, '');
      if (!byModel[model]) byModel[model] = { inputs: [], outputs: [], totals: [], count: 0 };
      byModel[model].count++;
      if (Number(r.input_tokens) > 0) byModel[model].inputs.push(Number(r.input_tokens));
      if (Number(r.output_tokens) > 0) byModel[model].outputs.push(Number(r.output_tokens));
      if (Number(r.total_tokens) > 0) byModel[model].totals.push(Number(r.total_tokens));
    }
    
    console.log('\n=== Token Usage by Model ===');
    for (const [model, data] of Object.entries(byModel)) {
      console.log(`\n  Model: ${model} (${data.count} messages)`);
      if (data.inputs.length > 0) {
        const avg = Math.round(data.inputs.reduce((s,v) => s+v, 0) / data.inputs.length);
        const max = Math.max(...data.inputs);
        console.log(`    Input:  avg=${avg} max=${max}`);
      }
      if (data.outputs.length > 0) {
        const avg = Math.round(data.outputs.reduce((s,v) => s+v, 0) / data.outputs.length);
        const max = Math.max(...data.outputs);
        console.log(`    Output: avg=${avg} max=${max}`);
      }
      if (data.totals.length > 0) {
        const avg = Math.round(data.totals.reduce((s,v) => s+v, 0) / data.totals.length);
        const max = Math.max(...data.totals);
        console.log(`    Total:  avg=${avg} max=${max}`);
      }
    }

    // By tier
    const byTier = {};
    for (const r of tokenData) {
      const tier = (r.tier || 'unknown').replace(/"/g, '');
      if (!byTier[tier]) byTier[tier] = { inputs: [], outputs: [], count: 0 };
      byTier[tier].count++;
      if (Number(r.input_tokens) > 0) byTier[tier].inputs.push(Number(r.input_tokens));
      if (Number(r.output_tokens) > 0) byTier[tier].outputs.push(Number(r.output_tokens));
    }
    
    console.log('\n=== Token Usage by Tier ===');
    for (const [tier, data] of Object.entries(byTier)) {
      console.log(`  Tier: ${tier} (${data.count} messages)`);
      if (data.inputs.length > 0) {
        const avg = Math.round(data.inputs.reduce((s,v) => s+v, 0) / data.inputs.length);
        const max = Math.max(...data.inputs);
        console.log(`    Input:  avg=${avg} max=${max}`);
      }
      if (data.outputs.length > 0) {
        const avg = Math.round(data.outputs.reduce((s,v) => s+v, 0) / data.outputs.length);
        const max = Math.max(...data.outputs);
        console.log(`    Output: avg=${avg} max=${max}`);
      }
    }
  } else {
    console.log('No messages with token data found.');
    // Fallback: check if metadata has tokens at all
    const [sample] = await db.query(`
      SELECT metadata FROM chat_messages WHERE role='assistant' AND metadata IS NOT NULL LIMIT 5
    `);
    console.log('\nSample metadata fields:');
    for (const r of sample) {
      try { console.log(Object.keys(JSON.parse(r.metadata))); } catch(e) { console.log(r.metadata?.substring?.(0, 200)); }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // DATA PREVIEW (ProcessedCache) SIZES
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  DATA PREVIEW / PROCESSED CACHE SIZES');
  console.log('═══════════════════════════════════════════════════════════\n');

  const [cacheStats] = await db.query(`
    SELECT 
      COUNT(*) as total_caches,
      ROUND(AVG(LENGTH(processed_json))) as avg_json_len,
      MIN(LENGTH(processed_json)) as min_json_len,
      MAX(LENGTH(processed_json)) as max_json_len,
      SUM(LENGTH(processed_json)) as total_json_chars
    FROM data_processed_cache
    WHERE processed_json IS NOT NULL
  `);
  console.log('=== ProcessedCache JSON Sizes ===');
  console.table(cacheStats);

  // Distribution
  const [cacheDistrib] = await db.query(`
    SELECT 
      CASE 
        WHEN LENGTH(processed_json) < 5000 THEN '01: <5K'
        WHEN LENGTH(processed_json) < 10000 THEN '02: 5-10K'
        WHEN LENGTH(processed_json) < 20000 THEN '03: 10-20K'
        WHEN LENGTH(processed_json) < 50000 THEN '04: 20-50K'
        WHEN LENGTH(processed_json) < 100000 THEN '05: 50-100K'
        ELSE '06: 100K+'
      END as size_bucket,
      COUNT(*) as cnt
    FROM data_processed_cache
    WHERE processed_json IS NOT NULL
    GROUP BY size_bucket
    ORDER BY size_bucket
  `);
  console.log('\n=== ProcessedCache Size Distribution ===');
  console.table(cacheDistrib);

  // Top 10 largest data sources
  const [largestCache] = await db.query(`
    SELECT pc.source_id, ds.name, pc.period_value,
           LENGTH(pc.processed_json) as json_len
    FROM data_processed_cache pc
    LEFT JOIN data_sources ds ON ds.id = pc.source_id
    WHERE pc.processed_json IS NOT NULL
    ORDER BY LENGTH(pc.processed_json) DESC
    LIMIT 10
  `);
  console.log('\n=== Top 10 Largest ProcessedCache Entries ===');
  console.table(largestCache);

  // ═══════════════════════════════════════════════════════════════════
  // MERGED CACHE SIZES
  // ═══════════════════════════════════════════════════════════════════
  const [mergeStats] = await db.query(`
    SELECT 
      COUNT(*) as total_merged,
      ROUND(AVG(LENGTH(merged_json))) as avg_json_len,
      MAX(LENGTH(merged_json)) as max_json_len
    FROM data_merged_cache
    WHERE merged_json IS NOT NULL
  `);
  console.log('\n=== MergedCache JSON Sizes ===');
  console.table(mergeStats);

  // ═══════════════════════════════════════════════════════════════════
  // DATASOURCE COUNT + TYPES
  // ═══════════════════════════════════════════════════════════════════
  const [dsStats] = await db.query(`
    SELECT type, COUNT(*) as cnt FROM data_sources GROUP BY type ORDER BY cnt DESC
  `);
  console.log('\n=== Datasources by Type ===');
  console.table(dsStats);

  const [dsTotal] = await db.query('SELECT COUNT(*) as cnt FROM data_sources');
  console.log('Total datasources:', dsTotal[0].cnt);

  // ═══════════════════════════════════════════════════════════════════
  // SIMULATED: What would 10 top KB docs combined look like?
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  SIMULATION: Typical Context Sizes');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Simulate: pick 10 BRS docs (typical search result)
  const [simBrs] = await db.query(`
    SELECT content_length FROM knowledge_base
    WHERE parent_id IS NULL AND category = 'BRS'
    ORDER BY content_length DESC
    LIMIT 10
  `);
  const simBrsTotal = simBrs.reduce((s, r) => s + r.content_length, 0);
  console.log(`10 largest BRS docs combined: ${(simBrsTotal/1000).toFixed(1)}K chars (${Math.round(simBrsTotal/4)} tokens est.)`);

  // Pick 10 random BRS
  const [simBrsRand] = await db.query(`
    SELECT content_length FROM knowledge_base
    WHERE parent_id IS NULL AND category = 'BRS'
    ORDER BY RAND()
    LIMIT 10
  `);
  const simBrsRandTotal = simBrsRand.reduce((s, r) => s + r.content_length, 0);
  console.log(`10 random BRS docs combined: ${(simBrsRandTotal/1000).toFixed(1)}K chars (${Math.round(simBrsRandTotal/4)} tokens est.)`);

  // Worst case: 10 largest Pubs
  const [simPub] = await db.query(`
    SELECT content_length FROM knowledge_base
    WHERE parent_id IS NULL AND category = 'Publikasi'
    ORDER BY content_length DESC
    LIMIT 10
  `);
  const simPubTotal = simPub.reduce((s, r) => s + r.content_length, 0);
  console.log(`10 largest Publikasi docs combined: ${(simPubTotal/1000).toFixed(1)}K chars (${Math.round(simPubTotal/4)} tokens est.)`);

  // Combined worst case: 5 BRS + 5 Pub largest
  const combined = simBrs.slice(0, 5).concat(simPub.slice(0, 5));
  const combinedTotal = combined.reduce((s, r) => s + r.content_length, 0);
  console.log(`5 largest BRS + 5 largest Pub combined: ${(combinedTotal/1000).toFixed(1)}K chars (${Math.round(combinedTotal/4)} tokens est.)`);

  // 12 docs scenario
  const [sim12] = await db.query(`
    SELECT content_length FROM knowledge_base
    WHERE parent_id IS NULL
    ORDER BY content_length DESC
    LIMIT 12
  `);
  const sim12Total = sim12.reduce((s, r) => s + r.content_length, 0);
  console.log(`12 largest docs (any category): ${(sim12Total/1000).toFixed(1)}K chars (${Math.round(sim12Total/4)} tokens est.)`);

  // Add typical data preview to the mix
  const [typicalPrev] = await db.query(`
    SELECT ROUND(AVG(LENGTH(processed_json))) as avg_len FROM data_processed_cache WHERE processed_json IS NOT NULL
  `);
  const avgPreviewLen = typicalPrev[0].avg_len || 5000;
  
  // Scenario: 10 KB docs + 1 data preview + system prompt (~2K) + history (~5K)
  const systemPrompt = 2000;
  const historyEst = 5000;
  const scenarioTotal = simBrsRandTotal + avgPreviewLen + systemPrompt + historyEst;
  console.log(`\nTypical scenario (10 random KB + 1 data preview + prompt + history):`);
  console.log(`  = ${(simBrsRandTotal/1000).toFixed(1)}K KB + ${(avgPreviewLen/1000).toFixed(1)}K data + 2K prompt + 5K history`);
  console.log(`  = ${(scenarioTotal/1000).toFixed(1)}K chars total (${Math.round(scenarioTotal/4)} tokens est.)`);
  console.log(`  vs MAX_CONTEXT_CHARS = 100K → ${scenarioTotal > 100000 ? '⚠️ OVER BUDGET' : '✅ fits'}`);
  console.log(`  vs 300K proposed → ${scenarioTotal > 300000 ? '⚠️ OVER BUDGET' : '✅ fits'}`);

  // Worst case
  const worstCase = sim12Total + 50000 + systemPrompt + 10000; // 12 big docs + big data preview + prompt + long history
  console.log(`\nWorst case (12 largest KB + big data preview + prompt + long history):`);
  console.log(`  = ${(sim12Total/1000).toFixed(1)}K KB + 50K data + 2K prompt + 10K history`);
  console.log(`  = ${(worstCase/1000).toFixed(1)}K chars total (${Math.round(worstCase/4)} tokens est.)`);
  console.log(`  vs MAX_CONTEXT_CHARS = 100K → ${worstCase > 100000 ? '⚠️ OVER BUDGET — trimming needed' : '✅ fits'}`);
  console.log(`  vs 300K proposed → ${worstCase > 300000 ? '⚠️ OVER BUDGET' : '✅ fits'}`);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  Analysis complete.');
  console.log('═══════════════════════════════════════════════════════════');

  await db.close();
}

run().catch(e => { console.error(e); process.exit(1); });
