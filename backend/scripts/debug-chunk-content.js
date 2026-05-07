#!/usr/bin/env node
/**
 * Debug: Check what chunk was matched for Doc 855 and what it contains.
 */
'use strict';
require('dotenv/config');

const { Sequelize, DataTypes } = require('sequelize');
const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASS, {
  host: process.env.DB_HOST, dialect: 'mysql', logging: false,
});

const KnowledgeBase = sequelize.define('KnowledgeBase', {
  id: { type: DataTypes.INTEGER, primaryKey: true },
  title: DataTypes.STRING,
  content: DataTypes.TEXT('long'),
  content_length: DataTypes.INTEGER,
  parent_id: DataTypes.INTEGER,
  chunk_index: DataTypes.INTEGER,
  embedding: DataTypes.BLOB,
}, { tableName: 'knowledge_base', timestamps: false });

const { generateEmbedding } = require('../src/services/ai/embedding.service');

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function main() {
  const queries = [
    { label: 'T1: Hotel', text: 'tingkat penghunian kamar hotel bintang di maluku utara 2024', check: ['52,24', '49,00', '47,89', '35,38'] },
    { label: 'T2: Restaurant', text: 'jumlah rumah makan restoran di maluku utara per kabupaten kota 2024', check: ['207', '663', '75', '90', '67'] },
    { label: 'T3: PDRB', text: 'PDRB harga berlaku pertambangan industri pengolahan maluku utara 2024', check: ['17.741', '32.487', '11.920'] },
  ];

  // Get all chunks for parent_id=855
  const chunks = await KnowledgeBase.findAll({
    where: { parent_id: 855 },
    attributes: ['id', 'chunk_index', 'content', 'embedding'],
    order: [['chunk_index', 'ASC']],
  });
  console.log(`Doc 855 has ${chunks.length} chunks\n`);

  // Also get parent doc 855 content
  const parent = await KnowledgeBase.findByPk(855, { attributes: ['id', 'title', 'content', 'content_length'] });
  console.log(`Parent: "${parent.title}" (${parent.content_length} chars)`);

  // Check ground truth in parent content
  for (const q of queries) {
    console.log(`\n${q.label}: checking ground truth in full parent content...`);
    for (const v of q.check) {
      const pos = parent.content.indexOf(v);
      if (pos >= 0) {
        const pct = ((pos / parent.content_length) * 100).toFixed(1);
        const ctx = parent.content.slice(Math.max(0, pos - 60), pos + 60).replace(/\n/g, '|');
        console.log(`  ✅ "${v}" found at position ${pos}/${parent.content_length} (${pct}%) ctx: ...${ctx}...`);
      } else {
        console.log(`  ❌ "${v}" NOT found in parent content`);
      }
    }
  }

  // For each query, find best chunk by cosine similarity
  for (const q of queries) {
    console.log(`\n${'═'.repeat(60)}\n${q.label}: "${q.text}"`);
    const qEmb = await generateEmbedding(q.text);

    const scored = chunks.map(c => {
      const emb = new Float32Array(c.embedding.buffer, c.embedding.byteOffset, c.embedding.length / 4);
      return { id: c.id, chunk_index: c.chunk_index, sim: cosineSim(qEmb, emb), content: c.content };
    }).sort((a, b) => b.sim - a.sim);

    // Show top-5 chunks
    console.log('\nTop-5 matching chunks:');
    for (let i = 0; i < Math.min(5, scored.length); i++) {
      const s = scored[i];
      const hasGT = q.check.filter(v => s.content.includes(v));
      console.log(`  #${i+1} chunk_idx=${s.chunk_index} (id=${s.id}) cosine=${s.sim.toFixed(4)} len=${s.content.length}`);
      console.log(`      GT values found: ${hasGT.length}/${q.check.length} [${hasGT.join(', ')}]`);
      console.log(`      First 200 chars: ${s.content.slice(0, 200).replace(/\n/g, '|')}...`);
    }

    // Find which chunks contain ALL ground truth values
    const gtChunks = [];
    for (const s of scored) {
      const hasGT = q.check.filter(v => s.content.includes(v));
      if (hasGT.length >= q.check.length * 0.5) {
        gtChunks.push({ ...s, hasGT });
      }
    }
    console.log(`\nChunks with ≥50% ground truth values: ${gtChunks.length}`);
    for (const c of gtChunks.slice(0, 3)) {
      console.log(`  chunk_idx=${c.chunk_index} (id=${c.id}) cosine=${c.sim.toFixed(4)} GT: [${c.hasGT.join(', ')}]`);
      console.log(`    Rank by cosine: #${scored.findIndex(s => s.id === c.id) + 1} of ${scored.length}`);
    }
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
