#!/usr/bin/env node
/**
 * Debug: trace Doc #855 through the full vector search scoring pipeline.
 * Shows why it does or doesn't appear in final results.
 */
'use strict';

const { searchKnowledge, loadKnowledgeEmbeddings } = require('../src/services/ai/vectorSearch.service');

async function main() {
  const query = 'berapa jumlah rumah makan restoran di maluku utara per kabupaten kota 2024';
  console.log('Query:', query);

  // Call the real search function with higher topN
  const result = await searchKnowledge(query, 30, { skipRerank: true });
  const results = result.results || [];

  console.log('\nFull pipeline results (top 30):');
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const is855 = r.id === 855 || r.parentId === 855;
    const chunk = r.matchedChunkText ? `CHUNK(${r.matchedChunkText.length})` : '';
    console.log(
      `  #${i + 1} id=${r.id}` +
      ` sim=${(r.similarity || 0).toFixed(4)}` +
      ` raw=${(r.rawSimilarity || 0).toFixed(4)}` +
      ` kw=${(r.keywordBoost || 0).toFixed(3)}` +
      ` syn=${(r.synonymBoost || 0).toFixed(3)}` +
      ` rec=${(r.recencyBoost || 0).toFixed(3)}` +
      ` per=${(r.periodMatchBoost || 0).toFixed(3)}` +
      ` topic=${(r.topicBoost || 0).toFixed(3)}` +
      ` ${chunk}` +
      (is855 ? ' ★★★ DOC855' : '') +
      ` "${(r.title || r.name || '').substring(0, 55)}"`
    );
  }

  const has855 = results.some(r => r.id === 855 || r.parentId === 855);
  console.log('\nDoc 855 found in top 30:', has855);

  if (!has855) {
    console.log('\nDoc 855 NOT in top 30. Checking its raw cosine...');
    // Manually check
    const { generateEmbedding } = require('../src/services/ai/embedding.service');
    const { expandQueryWithLLM } = require('../src/services/ai/synonymExpansion.service');
    
    // Use expanded query (same as searchKnowledge does)
    const expanded = await expandQueryWithLLM(query);
    const qEmb = await generateEmbedding(expanded);
    const cache = await loadKnowledgeEmbeddings();

    function cosine(a, b) {
      let dot = 0, na = 0, nb = 0;
      for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
      return dot / (Math.sqrt(na) * Math.sqrt(nb));
    }

    // Find best 855 chunk
    let best = null;
    for (const [id, entry] of cache) {
      if (entry.parentId !== 855 && id !== 855) continue;
      const sim = cosine(qEmb, entry.embedding);
      if (!best || sim > best.sim) best = { id, sim, title: entry.title };
    }
    if (best) {
      console.log(`Best #855 chunk (expanded query): id=${best.id} cosine=${best.sim.toFixed(4)} "${best.title}"`);
    }
    
    // Show the minSimilarity threshold vs actual score
    console.log('\nminSimilarity threshold: 0.40');
    if (results.length > 0) {
      console.log(`Lowest score in top 30: ${results[results.length - 1].similarity.toFixed(4)}`);
      console.log(`Highest score: ${results[0].similarity.toFixed(4)}`);
    }
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
