/**
 * Research script: analyze KB documents for TOC / Daftar Tabel structure
 * to plan the indicator index feature
 */
const seq = require('../src/config/db');
const KB = require('../src/models/KnowledgeBase.model');

async function main() {
  // Sample different doc types and sizes
  const ids = [
    997,   // Indikator Kesejahteraan Rakyat (203K)
    866,   // Statistik Kesejahteraan Rakyat 2024 (586K)
    834,   // Statistik Pemotongan Ternak (871K)
    858,   // Potensi Desa
  ];
  
  for (const id of ids) {
    const doc = await KB.findByPk(id, { attributes: ['id', 'title', 'content', 'category'] });
    if (!doc) { console.log('Doc', id, 'not found'); continue; }
    const c = doc.content;
    console.log(`\n=== [${id}] ${doc.category} | ${(c.length/1000).toFixed(0)}K | ${doc.title.slice(0, 70)} ===`);
    
    // Check for TOC patterns
    const patterns = ['Daftar Tabel', 'DAFTAR TABEL', 'Daftar Isi', 'DAFTAR ISI'];
    let found = false;
    for (const p of patterns) {
      const idx = c.indexOf(p);
      if (idx >= 0) {
        console.log(`  Found "${p}" at ${idx} (${(idx/c.length*100).toFixed(1)}%)`);
        console.log(c.substring(idx, idx + 800));
        console.log('  ...');
        found = true;
        break;
      }
    }
    
    if (!found) {
      console.log('  NO TOC found. First 400 chars:');
      console.log(c.substring(0, 400));
    }
  }
  
  // Now check BRS docs
  console.log('\n\n=== SAMPLING BRS DOCS ===');
  const brsDocs = await KB.findAll({
    where: { parent_id: null, status: 'ready', category: 'BRS' },
    attributes: ['id', 'title', 'content', 'category'],
    order: seq.literal('LENGTH(content) DESC'),
    limit: 3,
  });
  
  for (const doc of brsDocs) {
    const c = doc.content;
    console.log(`\n[${doc.id}] BRS | ${(c.length/1000).toFixed(0)}K | ${doc.title.slice(0, 70)}`);
    
    const hasToc = ['Daftar Tabel', 'DAFTAR TABEL', 'Daftar Isi', 'DAFTAR ISI', 'Tabel '].some(p => c.indexOf(p) >= 0);
    console.log(`  Has TOC patterns: ${hasToc}`);
    
    // Check for inline table headers
    const tableMatches = c.match(/Tabel \d+[\.\s]/g);
    if (tableMatches) {
      console.log(`  Inline table references: ${tableMatches.length} (samples: ${tableMatches.slice(0, 5).join(', ')})`);
    }
    
    console.log('  First 300 chars:', c.substring(0, 300).replace(/\n/g, ' '));
  }
  
  // Count docs with Daftar Tabel
  console.log('\n\n=== STATS: How many parent docs have "Daftar Tabel" ===');
  const [result] = await seq.query(`
    SELECT 
      category,
      COUNT(*) AS total,
      SUM(CASE WHEN content LIKE '%Daftar Tabel%' OR content LIKE '%DAFTAR TABEL%' THEN 1 ELSE 0 END) AS has_toc,
      ROUND(AVG(LENGTH(content))/1000, 0) AS avg_len_k
    FROM knowledge_base
    WHERE parent_id IS NULL AND status = 'ready'
    GROUP BY category
    ORDER BY total DESC
  `);
  console.table(result);
  
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
