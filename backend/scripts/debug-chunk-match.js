#!/usr/bin/env node
/**
 * Debug: trace what vector search returns for each test query.
 * Shows which chunk was matched for Doc 855 and its content.
 */
'use strict';
require('dotenv/config');

async function main() {
  // Wait for KB to be loaded
  const { searchKnowledge, loadKnowledgeEmbeddings } = require('../src/services/ai/vectorSearch.service');
  await loadKnowledgeEmbeddings();

  const queries = [
    { label: 'T2: Restaurant', text: 'jumlah rumah makan restoran di maluku utara per kabupaten kota 2024', groundTruth: ['207', '663'] },
    { label: 'T3: PDRB', text: 'PDRB harga berlaku pertambangan industri pengolahan maluku utara 2024', groundTruth: ['17.741', '32.487'] },
  ];

  for (const q of queries) {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`${q.label}: "${q.text}"`);
    
    const result = await searchKnowledge(q.text, 10, { skipRerank: true });
    const results = result.results || [];
    
    console.log(`\nTop-10 results:`);
    for (let i = 0; i < Math.min(10, results.length); i++) {
      const r = results[i];
      const is855 = r.id === 855 || r.parentId === 855;
      const chunk = r.matchedChunkText || '';
      const chunkLen = chunk.length;
      const contentLen = (r.content || '').length;
      
      // Check if ground truth values are in the chunk
      const gtInChunk = q.groundTruth.filter(v => chunk.includes(v));
      const gtInContent = q.groundTruth.filter(v => (r.content || '').includes(v));
      
      console.log(
        `  #${i + 1} id=${r.id} sim=${(r.similarity || 0).toFixed(4)} raw=${(r.rawSimilarity || 0).toFixed(4)}` +
        ` chunk=${chunkLen} content=${contentLen}` +
        (is855 ? ' ★★★ DOC855' : '') +
        ` "${(r.title || r.name || '').substring(0, 55)}"`
      );
      if (chunkLen > 0) {
        console.log(`      Chunk first 150: ${chunk.slice(0, 150).replace(/\n/g, '|')}...`);
        if (gtInChunk.length > 0) {
          console.log(`      ✅ Ground truth in CHUNK: [${gtInChunk.join(', ')}]`);
        }
      }
      if (gtInContent.length > 0) {
        console.log(`      ✅ Ground truth in CONTENT: [${gtInContent.join(', ')}]`);
      }
    }
    
    // Check if Doc 855 is in results
    const doc855 = results.find(r => r.id === 855 || r.parentId === 855);
    if (doc855) {
      console.log(`\nDoc 855 details:`);
      console.log(`  Position: #${results.indexOf(doc855) + 1}`);
      console.log(`  Chunk length: ${(doc855.matchedChunkText || '').length}`);
      console.log(`  Content length: ${(doc855.content || '').length}`);
      console.log(`  Chunk text:\n${(doc855.matchedChunkText || '').slice(0, 500).replace(/\n/g, '|')}...`);
    } else {
      console.log(`\n❌ Doc 855 NOT in top-10 results`);
    }
  }
  
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
