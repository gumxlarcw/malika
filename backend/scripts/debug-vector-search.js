#!/usr/bin/env node
'use strict';
const { searchKnowledge } = require('../src/services/ai/vectorSearch.service');

const QUERIES = [
  'berapa jumlah rumah makan restoran di maluku utara per kabupaten kota 2024',
  'berapa PDRB harga berlaku pertambangan dan industri pengolahan maluku utara 2024',
  'berapa tingkat penghunian kamar hotel bintang di maluku utara tahun 2024',
];

async function main() {
  for (const q of QUERIES) {
    console.log('\n' + '='.repeat(70));
    console.log('Q:', q);
    const res = await searchKnowledge(q, 15, { skipRerank: true });
    const results = res.results || [];
    console.log('Results returned:', results.length);
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const is855 = r.id === 855 || r.parentId === 855 || r.parent_id === 855;
      const chunk = r.matchedChunkText ? `CHUNK(${r.matchedChunkText.length}ch)` : 'no_chunk';
      const cLen = r.content ? r.content.length : 0;
      console.log(
        `  #${i + 1} id=${r.id} parent=${r.parentId || r.parent_id || '-'}` +
        ` combined=${(r.combinedSimilarity || 0).toFixed(3)}` +
        ` cosine=${(r.cosineSimilarity || 0).toFixed(3)}` +
        ` ${chunk} cLen=${cLen}` +
        (is855 ? ' ★★★ DOC855' : '') +
        ` "${(r.title || r.name || '').substring(0, 55)}"`
      );
    }
    const has855 = results.some(r => r.id === 855 || r.parentId === 855 || r.parent_id === 855);
    console.log('Doc 855 found:', has855);
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
