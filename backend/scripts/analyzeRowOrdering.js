/**
 * Script to analyze row ordering issues across all indicators
 * Checks for:
 * - Maluku Utara (province) not at last position in kab/kota tables
 * - Total/Jumlah rows not at last position
 * - Rata-rata rows not at last position
 * - PDRB aggregate rows not at last position
 */

const db = require('../src/config/db');
const ProcessedCache = require('../src/models/ProcessedCache.model');
const DataSource = require('../src/models/DataSource.model');

async function run() {
  await db.authenticate();
  console.log('Database connected. Fetching cached data...\n');
  
  // Get all cached data
  const cached = await ProcessedCache.findAll({
    attributes: ['source_id', 'period_value', 'processed_json'],
    order: [['source_id', 'ASC']],
  });
  
  // Get datasource names
  const sources = await DataSource.findAll({
    where: { visible: true },
    attributes: ['id', 'name', 'type']
  });
  const sourceMap = new Map(sources.map(s => [s.id, s]));
  
  // Get unique source_ids with their latest cache
  const bySource = new Map();
  for (const c of cached) {
    if (!bySource.has(c.source_id)) {
      bySource.set(c.source_id, c);
    }
  }
  
  console.log(`Found ${bySource.size} unique indicators with cached data\n`);
  
  // Analyze each indicator
  const results = [];
  
  for (const [sourceId, cache] of bySource) {
    try {
      const json = typeof cache.processed_json === 'string' 
        ? JSON.parse(cache.processed_json) 
        : cache.processed_json;
      
      const columns = json?.columns || [];
      const data = json?.data || [];
      const source = json?.source || sourceMap.get(sourceId)?.name || '';
      
      if (data.length === 0) continue;
      
      // Detect geo column
      const geoCol = columns.find(c => /kabupaten\s*\/?\s*kota|wilayah|daerah/i.test(c)) || null;
      const categoryCol = columns[0];
      
      // Analyze row values in first column
      const firstColValues = data.map(r => String(r?.[categoryCol] || '')).filter(Boolean);
      
      // Check for known patterns
      const hasMalukuUtara = firstColValues.some(v => /^maluku utara$|^provinsi maluku utara$/i.test(v.trim()));
      const hasTotal = firstColValues.some(v => /^(total|jumlah)$/i.test(v.trim()));
      const hasRataRata = firstColValues.some(v => /rata-?rata/i.test(v));
      const hasPdrbAggregate = firstColValues.some(v => /^produk domestik regional bruto$/i.test(v.trim()));
      const hasKabKota = firstColValues.some(v => /halmahera|sula|morotai|taliabu|ternate|tidore/i.test(v));
      
      // Check if table title indicates kab/kota breakdown
      const titleIndicatesKabKota = /(menurut|kabupaten|kota)\s*(\/|\s)?\s*(kabupaten|kota)/i.test(source);
      
      // Get position of special rows
      let malukuUtaraPos = -1;
      let totalPos = -1;
      let rataRataPos = -1;
      let pdrbPos = -1;
      let rataRataLabel = '';
      
      for (let i = 0; i < firstColValues.length; i++) {
        const v = firstColValues[i];
        if (/^maluku utara$|^provinsi maluku utara$/i.test(v.trim()) && malukuUtaraPos === -1) {
          malukuUtaraPos = i;
        }
        if (/^(total|jumlah)$/i.test(v.trim()) && totalPos === -1) {
          totalPos = i;
        }
        if (/rata-?rata/i.test(v) && rataRataPos === -1) {
          rataRataPos = i;
          rataRataLabel = v;
        }
        if (/^produk domestik regional bruto$/i.test(v.trim()) && pdrbPos === -1) {
          pdrbPos = i;
        }
      }
      
      // Flag potential issues
      const issues = [];
      const totalRows = firstColValues.length;
      
      // Issue: Maluku Utara NOT at last position in kab/kota table
      if ((hasKabKota || titleIndicatesKabKota) && hasMalukuUtara && malukuUtaraPos !== -1 && malukuUtaraPos < totalRows - 1) {
        issues.push(`MALUKU_UTARA_NOT_LAST (pos:${malukuUtaraPos}/${totalRows-1})`);
      }
      
      // Issue: Total/Jumlah NOT at last position
      if (hasTotal && totalPos !== -1 && totalPos < totalRows - 1) {
        issues.push(`TOTAL_NOT_LAST (pos:${totalPos}/${totalRows-1})`);
      }
      
      // Issue: Rata-rata NOT at last position
      if (hasRataRata && rataRataPos !== -1 && rataRataPos < totalRows - 1) {
        issues.push(`RATA_RATA_NOT_LAST (pos:${rataRataPos}/${totalRows-1}, label:"${rataRataLabel.slice(0,40)}")`);
      }
      
      // Issue: PDRB aggregate NOT at last position
      if (hasPdrbAggregate && pdrbPos !== -1 && pdrbPos < totalRows - 1) {
        issues.push(`PDRB_AGGREGATE_NOT_LAST (pos:${pdrbPos}/${totalRows-1})`);
      }
      
      results.push({
        source_id: sourceId,
        source: source.slice(0, 100),
        period: cache.period_value,
        totalRows,
        geoCol,
        categoryCol,
        hasMalukuUtara,
        malukuUtaraPos,
        hasTotal,
        totalPos,
        hasRataRata,
        rataRataPos,
        hasPdrbAggregate,
        pdrbPos,
        hasKabKota,
        titleIndicatesKabKota,
        issues,
        sampleValues: firstColValues.slice(0, 15)
      });
    } catch (e) {
      console.error(`Error processing source_id ${sourceId}:`, e.message);
    }
  }
  
  // Group by issue type
  const malukuUtaraIssues = results.filter(r => r.issues.some(i => i.includes('MALUKU_UTARA_NOT_LAST')));
  const totalIssues = results.filter(r => r.issues.some(i => i.includes('TOTAL_NOT_LAST')));
  const rataRataIssues = results.filter(r => r.issues.some(i => i.includes('RATA_RATA_NOT_LAST')));
  const pdrbIssues = results.filter(r => r.issues.some(i => i.includes('PDRB_AGGREGATE_NOT_LAST')));
  
  console.log('\n========================================');
  console.log('MALUKU UTARA NOT AT LAST POSITION ISSUES');
  console.log('========================================\n');
  for (const r of malukuUtaraIssues) {
    console.log(`[ID ${r.source_id}] ${r.source}`);
    console.log(`  Period: ${r.period}, Rows: ${r.totalRows}, Maluku Utara at position: ${r.malukuUtaraPos}`);
    console.log(`  Sample values: ${r.sampleValues.join(' | ')}`);
    console.log('');
  }
  
  console.log('\n========================================');
  console.log('TOTAL/JUMLAH NOT AT LAST POSITION ISSUES');
  console.log('========================================\n');
  for (const r of totalIssues) {
    console.log(`[ID ${r.source_id}] ${r.source}`);
    console.log(`  Period: ${r.period}, Rows: ${r.totalRows}, Total at position: ${r.totalPos}`);
    console.log(`  Sample values: ${r.sampleValues.join(' | ')}`);
    console.log('');
  }
  
  console.log('\n========================================');
  console.log('RATA-RATA NOT AT LAST POSITION ISSUES');
  console.log('========================================\n');
  for (const r of rataRataIssues) {
    console.log(`[ID ${r.source_id}] ${r.source}`);
    console.log(`  Period: ${r.period}, Rows: ${r.totalRows}, Rata-rata at position: ${r.rataRataPos}`);
    console.log(`  Sample values: ${r.sampleValues.join(' | ')}`);
    console.log('');
  }
  
  console.log('\n========================================');
  console.log('PDRB AGGREGATE NOT AT LAST POSITION ISSUES');
  console.log('========================================\n');
  for (const r of pdrbIssues) {
    console.log(`[ID ${r.source_id}] ${r.source}`);
    console.log(`  Period: ${r.period}, Rows: ${r.totalRows}, PDRB at position: ${r.pdrbPos}`);
    console.log(`  Sample values: ${r.sampleValues.join(' | ')}`);
    console.log('');
  }
  
  // Tables with Maluku Utara correctly at last
  const malukuUtaraCorrect = results.filter(r => r.hasMalukuUtara && r.malukuUtaraPos === r.totalRows - 1);
  
  console.log('\n========================================');
  console.log('SUMMARY');
  console.log('========================================');
  console.log(`Total indicators analyzed: ${bySource.size}`);
  console.log(`Indicators with cached data: ${results.length}`);
  console.log('');
  console.log('ISSUE COUNTS:');
  console.log(`  - MALUKU_UTARA_NOT_LAST: ${malukuUtaraIssues.length} indicators`);
  console.log(`  - TOTAL_NOT_LAST: ${totalIssues.length} indicators`);
  console.log(`  - RATA_RATA_NOT_LAST: ${rataRataIssues.length} indicators`);
  console.log(`  - PDRB_AGGREGATE_NOT_LAST: ${pdrbIssues.length} indicators`);
  console.log('');
  console.log('CORRECT:');
  console.log(`  - Tables with Maluku Utara correctly at last: ${malukuUtaraCorrect.length} indicators`);
  
  // Output detailed JSON
  const output = {
    summary: {
      totalIndicators: bySource.size,
      indicatorsWithData: results.length,
      issues: {
        malukuUtaraNotLast: malukuUtaraIssues.length,
        totalNotLast: totalIssues.length,
        rataRataNotLast: rataRataIssues.length,
        pdrbNotLast: pdrbIssues.length
      }
    },
    malukuUtaraIssues: malukuUtaraIssues.map(r => ({ 
      source_id: r.source_id, 
      source: r.source, 
      pos: r.malukuUtaraPos, 
      total: r.totalRows,
      sampleValues: r.sampleValues 
    })),
    totalIssues: totalIssues.map(r => ({ 
      source_id: r.source_id, 
      source: r.source, 
      pos: r.totalPos, 
      total: r.totalRows,
      sampleValues: r.sampleValues 
    })),
    rataRataIssues: rataRataIssues.map(r => ({ 
      source_id: r.source_id, 
      source: r.source, 
      pos: r.rataRataPos, 
      total: r.totalRows,
      sampleValues: r.sampleValues 
    })),
    pdrbIssues: pdrbIssues.map(r => ({ 
      source_id: r.source_id, 
      source: r.source, 
      pos: r.pdrbPos, 
      total: r.totalRows,
      sampleValues: r.sampleValues 
    }))
  };
  
  require('fs').writeFileSync(
    require('path').join(__dirname, '../../tmp/row_ordering_analysis.json'),
    JSON.stringify(output, null, 2)
  );
  console.log('\nDetailed JSON saved to: tmp/row_ordering_analysis.json');
  
  process.exit(0);
}

run().catch(e => { 
  console.error(e); 
  process.exit(1); 
});
