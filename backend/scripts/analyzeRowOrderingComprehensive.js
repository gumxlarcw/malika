/**
 * Comprehensive Row Ordering Analysis for ALL Indicators
 * Checks for aggregate rows not at last position
 */

const db = require('../src/config/db');
const DataSource = require('../src/models/DataSource.model');
const axios = require('axios');

async function run() {
  await db.authenticate();
  
  const sources = await DataSource.findAll({
    where: { visible: true },
    attributes: ['id', 'name', 'type'],
    order: [['id', 'ASC']]
  });
  
  console.log('=== COMPREHENSIVE ALL-INDICATOR ANALYSIS ===');
  console.log('Total visible indicators:', sources.length);
  
  const results = [];
  const baseUrl = 'http://127.0.0.1:5000';
  let tested = 0;
  let errors = 0;
  
  // Test ALL indicators
  for (const src of sources) {
    if (src.type === 'static' || src.type === 'exim') continue;
    
    try {
      const endpoint = src.type === 'interop' ? 'interop' : 'dynamic';
      const url = `${baseUrl}/${endpoint}/${src.id}?period=125`;
      
      const res = await axios.get(url, { timeout: 15000 });
      const data = res.data?.data;
      tested++;
      
      if (!data?.columns || !data?.data || data.data.length === 0) continue;
      
      const firstCol = data.columns[0];
      const allValues = data.data.map(r => String(r?.[firstCol] || ''));
      const totalRows = allValues.length;
      
      // Detect all aggregate patterns
      const patterns = {
        malukuUtara: { pos: -1, label: '' },
        total: { pos: -1, label: '' },
        jumlah: { pos: -1, label: '' },
        rataRata: { pos: -1, label: '' },
        pdrb: { pos: -1, label: '' },
        indonesia: { pos: -1, label: '' },
      };
      
      for (let i = 0; i < allValues.length; i++) {
        const v = allValues[i];
        const vTrim = v.trim();
        
        if (/^maluku utara$/i.test(vTrim) || /^provinsi maluku utara$/i.test(vTrim)) {
          if (patterns.malukuUtara.pos === -1) {
            patterns.malukuUtara.pos = i;
            patterns.malukuUtara.label = vTrim;
          }
        }
        if (/^total$/i.test(vTrim)) {
          if (patterns.total.pos === -1) {
            patterns.total.pos = i;
            patterns.total.label = vTrim;
          }
        }
        if (/^jumlah$/i.test(vTrim)) {
          if (patterns.jumlah.pos === -1) {
            patterns.jumlah.pos = i;
            patterns.jumlah.label = vTrim;
          }
        }
        // Rata-rata but NOT "Rata-rata Lama Sekolah" which is an indicator name
        if (/rata-?rata/i.test(v) && !/rata-?rata.*sekolah/i.test(v) && !/rata-?rata.*pengeluaran/i.test(v)) {
          if (patterns.rataRata.pos === -1) {
            patterns.rataRata.pos = i;
            patterns.rataRata.label = v.slice(0, 40);
          }
        }
        if (/produk domestik regional bruto/i.test(v)) {
          if (patterns.pdrb.pos === -1) {
            patterns.pdrb.pos = i;
            patterns.pdrb.label = v.slice(0, 40);
          }
        }
        if (/^indonesia$/i.test(vTrim)) {
          if (patterns.indonesia.pos === -1) {
            patterns.indonesia.pos = i;
            patterns.indonesia.label = vTrim;
          }
        }
      }
      
      // Check if table is kab/kota breakdown
      const hasKabKota = allValues.some(v => /halmahera|sula|morotai|taliabu|ternate|tidore/i.test(v));
      const titleKabKota = /menurut.*kabupaten.*kota|kabupaten.*kota/i.test(src.name);
      const isKabKotaTable = hasKabKota || titleKabKota;
      
      // Collect issues
      const issues = [];
      
      // Province aggregate issues (only for kab/kota tables)
      if (isKabKotaTable && patterns.malukuUtara.pos !== -1 && patterns.malukuUtara.pos < totalRows - 1) {
        issues.push(`MALUKU_UTARA_NOT_LAST:${patterns.malukuUtara.pos}/${totalRows-1}`);
      }
      
      // General aggregate issues
      if (patterns.total.pos !== -1 && patterns.total.pos < totalRows - 1) {
        issues.push(`TOTAL_NOT_LAST:${patterns.total.pos}/${totalRows-1}`);
      }
      if (patterns.jumlah.pos !== -1 && patterns.jumlah.pos < totalRows - 1) {
        issues.push(`JUMLAH_NOT_LAST:${patterns.jumlah.pos}/${totalRows-1}`);
      }
      if (patterns.rataRata.pos !== -1 && patterns.rataRata.pos < totalRows - 1) {
        issues.push(`RATA_RATA_NOT_LAST:${patterns.rataRata.pos}/${totalRows-1}`);
      }
      if (patterns.pdrb.pos !== -1 && patterns.pdrb.pos < totalRows - 1) {
        issues.push(`PDRB_NOT_LAST:${patterns.pdrb.pos}/${totalRows-1}`);
      }
      
      if (issues.length > 0 || patterns.malukuUtara.pos !== -1) {
        results.push({
          id: src.id,
          name: src.name,
          type: src.type,
          rows: totalRows,
          patterns,
          isKabKotaTable,
          issues,
          sampleRows: allValues.slice(0, 12)
        });
      }
    } catch (e) {
      errors++;
    }
  }
  
  // Categorize issues
  const malutIssues = results.filter(r => r.issues.some(i => i.startsWith('MALUKU_UTARA_NOT_LAST')));
  const totalIssues = results.filter(r => r.issues.some(i => i.startsWith('TOTAL_NOT_LAST')));
  const jumlahIssues = results.filter(r => r.issues.some(i => i.startsWith('JUMLAH_NOT_LAST')));
  const rataIssues = results.filter(r => r.issues.some(i => i.startsWith('RATA_RATA_NOT_LAST')));
  const pdrbIssues = results.filter(r => r.issues.some(i => i.startsWith('PDRB_NOT_LAST')));
  
  console.log('\nTested:', tested, '| Errors:', errors);
  console.log('\n========================================');
  console.log('ISSUE SUMMARY');
  console.log('========================================');
  console.log('MALUKU_UTARA_NOT_LAST:', malutIssues.length, 'indicators');
  console.log('TOTAL_NOT_LAST:', totalIssues.length, 'indicators');
  console.log('JUMLAH_NOT_LAST:', jumlahIssues.length, 'indicators');
  console.log('RATA_RATA_NOT_LAST:', rataIssues.length, 'indicators');
  console.log('PDRB_NOT_LAST:', pdrbIssues.length, 'indicators');
  
  console.log('\n=== ALL INDICATORS WITH ISSUES ===\n');
  const allWithIssues = results.filter(r => r.issues.length > 0);
  for (const r of allWithIssues) {
    console.log(`[${r.id}] ${r.name.slice(0, 75)}`);
    console.log(`  Rows: ${r.rows} | Issues: ${r.issues.join(', ')}`);
    console.log(`  Sample: ${r.sampleRows.slice(0, 6).join(' | ')}`);
    console.log('');
  }
  
  console.log('\n=== MALUKU UTARA CORRECTLY AT LAST ===\n');
  const malutCorrect = results.filter(r => r.patterns.malukuUtara.pos === r.rows - 1 && r.isKabKotaTable);
  for (const r of malutCorrect.slice(0, 5)) {
    console.log(`[${r.id}] ${r.name.slice(0, 75)}`);
    console.log(`  Maluku Utara at pos: ${r.patterns.malukuUtara.pos} (last, correct)`);
  }
  if (malutCorrect.length > 5) {
    console.log(`  ... and ${malutCorrect.length - 5} more`);
  }
  
  // Save detailed results
  const output = {
    summary: {
      tested,
      errors,
      issues: {
        malukuUtaraNotLast: malutIssues.length,
        totalNotLast: totalIssues.length,
        jumlahNotLast: jumlahIssues.length,
        rataRataNotLast: rataIssues.length,
        pdrbNotLast: pdrbIssues.length
      }
    },
    allIssues: allWithIssues.map(r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      rows: r.rows,
      issues: r.issues,
      sampleRows: r.sampleRows
    })),
    malutCorrect: malutCorrect.map(r => ({
      id: r.id,
      name: r.name,
      pos: r.patterns.malukuUtara.pos
    }))
  };
  
  require('fs').writeFileSync(
    require('path').join(__dirname, '../../tmp/comprehensive_row_ordering_analysis.json'),
    JSON.stringify(output, null, 2)
  );
  console.log('\nDetailed JSON saved to: tmp/comprehensive_row_ordering_analysis.json');
  
  process.exit(0);
}

run().catch(e => { 
  console.error(e.message); 
  process.exit(1); 
});
