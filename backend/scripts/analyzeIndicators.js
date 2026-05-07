/**
 * Analyze all indicator tables in data_bps to understand their structure
 * This will help generate accurate chart configurations
 * 
 * Run: cd backend && node scripts/analyzeIndicators.js
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

const dbConfig = {
  host: process.env.DB_BPS_HOST || process.env.DB_HOST || 'localhost',
  user: process.env.DB_BPS_USER || process.env.DB_USER,
  password: process.env.DB_BPS_PASS || process.env.DB_PASS,
  database: 'data_bps',
};

async function main() {
  const conn = await mysql.createConnection(dbConfig);
  console.log('Connected to data_bps database\n');

  try {
    // Get all indicator tables
    const [tables] = await conn.query(`
      SELECT TABLE_NAME 
      FROM information_schema.tables 
      WHERE table_schema = 'data_bps' 
        AND TABLE_NAME LIKE 'indikator_%'
      ORDER BY CAST(SUBSTRING(TABLE_NAME, 11) AS UNSIGNED)
    `);

    console.log(`Found ${tables.length} indicator tables\n`);
    console.log('='.repeat(120));

    const results = [];

    for (const { TABLE_NAME } of tables) {
      const sourceId = TABLE_NAME.replace('indikator_', '');
      
      try {
        // Get indicator name from data_sources
        const [sourceInfo] = await conn.query(`
          SELECT name, type, category 
          FROM project_data_strategis.data_sources 
          WHERE id = ?
        `, [sourceId]);
        
        const sourceName = sourceInfo[0]?.name || 'Unknown';
        const sourceType = sourceInfo[0]?.type || 'unknown';
        const category = sourceInfo[0]?.category || '';

        // Analyze the indicator table structure
        const [stats] = await conn.query(`
          SELECT 
            COUNT(*) as total_rows,
            COUNT(DISTINCT dim_key) as unique_dim_keys,
            COUNT(DISTINCT dim_value) as unique_dim_values,
            COUNT(DISTINCT metric) as unique_metrics,
            COUNT(DISTINCT year) as unique_years,
            COUNT(DISTINCT month_no) as unique_months,
            MIN(year) as min_year,
            MAX(year) as max_year,
            GROUP_CONCAT(DISTINCT dim_key ORDER BY dim_key SEPARATOR ' | ') as dim_keys,
            GROUP_CONCAT(DISTINCT metric ORDER BY metric SEPARATOR ' | ') as metrics
          FROM \`${TABLE_NAME}\`
        `);

        // Get sample dim_values (first 10)
        const [dimValues] = await conn.query(`
          SELECT DISTINCT dim_value 
          FROM \`${TABLE_NAME}\` 
          ORDER BY dim_value 
          LIMIT 10
        `);

        // Get sample month_names to understand period type
        const [monthNames] = await conn.query(`
          SELECT DISTINCT month_name, month_no
          FROM \`${TABLE_NAME}\` 
          ORDER BY month_no
          LIMIT 15
        `);

        const stat = stats[0];
        const dimValuesList = dimValues.map(d => d.dim_value).filter(Boolean);
        const monthNamesList = monthNames.map(m => m.month_name).filter(Boolean);

        // Determine period type
        let periodType = 'unknown';
        const monthNos = monthNames.map(m => m.month_no);
        if (monthNos.some(m => m >= 1 && m <= 12)) {
          periodType = 'monthly';
        }
        if (monthNos.some(m => m >= 31 && m <= 34)) {
          periodType = 'quarterly';
        }
        if (monthNos.includes(0) && monthNos.length === 1) {
          periodType = 'yearly';
        }
        if (monthNos.some(m => m >= 1 && m <= 12) && monthNos.some(m => m >= 31 && m <= 34)) {
          periodType = 'mixed (monthly+quarterly)';
        }

        // Determine data type
        let dataType = 'simple'; // single dimension
        if (stat.unique_dim_values > 1 && stat.unique_dim_keys === 1) {
          dataType = 'categorical'; // has categories (like komponen pengeluaran)
        }
        if (stat.unique_dim_values > 10) {
          dataType = 'geo-categorical'; // likely has geo dimension
        }

        // Check if has geo-like values
        const hasGeoLikeValues = dimValuesList.some(v => 
          /kabupaten|kota|halmahera|ternate|tidore|taliabu|morotai|pulau/i.test(v)
        );
        if (hasGeoLikeValues) {
          dataType = 'geo';
        }

        // Determine chart recommendation
        let chartRecommended = 'bar';
        if (periodType === 'monthly' || periodType === 'quarterly') {
          chartRecommended = 'line';
        }
        if (dataType === 'geo' && stat.unique_years <= 2) {
          chartRecommended = 'bar';
        }

        const result = {
          source_id: parseInt(sourceId),
          table_name: TABLE_NAME,
          source_name: sourceName,
          source_type: sourceType,
          category,
          total_rows: stat.total_rows,
          unique_dim_keys: stat.unique_dim_keys,
          unique_dim_values: stat.unique_dim_values,
          unique_metrics: stat.unique_metrics,
          unique_years: stat.unique_years,
          unique_months: stat.unique_months,
          year_range: `${stat.min_year}-${stat.max_year}`,
          dim_keys: stat.dim_keys || '',
          metrics: stat.metrics || '',
          sample_dim_values: dimValuesList.slice(0, 5).join(' | '),
          sample_months: monthNamesList.slice(0, 5).join(' | '),
          period_type: periodType,
          data_type: dataType,
          chart_recommended: chartRecommended,
        };

        results.push(result);

        // Print summary
        console.log(`\n[${sourceId}] ${sourceName.substring(0, 80)}`);
        console.log(`  Type: ${sourceType} | Category: ${category || 'N/A'}`);
        console.log(`  Rows: ${stat.total_rows} | Years: ${stat.unique_years} (${stat.min_year}-${stat.max_year})`);
        console.log(`  Dim Keys: ${stat.unique_dim_keys} | Dim Values: ${stat.unique_dim_values} | Metrics: ${stat.unique_metrics}`);
        console.log(`  Period Type: ${periodType} | Data Type: ${dataType} | Chart: ${chartRecommended}`);
        console.log(`  Dim Key: ${stat.dim_keys || 'N/A'}`);
        console.log(`  Metrics: ${stat.metrics || 'N/A'}`);
        console.log(`  Sample Values: ${dimValuesList.slice(0, 3).join(', ') || 'N/A'}`);
        console.log(`  Sample Months: ${monthNamesList.slice(0, 5).join(', ') || 'N/A'}`);
        console.log('-'.repeat(120));

      } catch (err) {
        console.log(`\n[${sourceId}] ERROR: ${err.message}`);
        console.log('-'.repeat(120));
      }
    }

    // Generate summary statistics
    console.log('\n\n' + '='.repeat(120));
    console.log('SUMMARY STATISTICS');
    console.log('='.repeat(120));

    const periodTypeCounts = {};
    const dataTypeCounts = {};
    const chartCounts = {};

    for (const r of results) {
      periodTypeCounts[r.period_type] = (periodTypeCounts[r.period_type] || 0) + 1;
      dataTypeCounts[r.data_type] = (dataTypeCounts[r.data_type] || 0) + 1;
      chartCounts[r.chart_recommended] = (chartCounts[r.chart_recommended] || 0) + 1;
    }

    console.log('\nBy Period Type:');
    for (const [k, v] of Object.entries(periodTypeCounts)) {
      console.log(`  ${k}: ${v}`);
    }

    console.log('\nBy Data Type:');
    for (const [k, v] of Object.entries(dataTypeCounts)) {
      console.log(`  ${k}: ${v}`);
    }

    console.log('\nBy Recommended Chart:');
    for (const [k, v] of Object.entries(chartCounts)) {
      console.log(`  ${k}: ${v}`);
    }

    // Save results to JSON
    const fs = require('fs');
    const outputPath = '/var/www/html/project-data-strategis/tmp/indicator_analysis.json';
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`\n\nResults saved to: ${outputPath}`);

  } finally {
    await conn.end();
  }
}

main().catch(console.error);
