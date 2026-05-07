#!/usr/bin/env node
/**
 * generateChartConfigs.js
 * 
 * Generates chart_config for each indicator based on analysis results.
 * Populates data_sources.chart_config column.
 * 
 * Usage: node scripts/generateChartConfigs.js [--dry-run]
 */

require('dotenv').config();
const { Sequelize } = require('sequelize');
const path = require('path');
const fs = require('fs');

const DRY_RUN = process.argv.includes('--dry-run');

// Database connection
const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASS,
  { host: process.env.DB_HOST, dialect: 'mysql', logging: false }
);

/**
 * Generate chart config from analysis result
 */
function generateChartConfig(indicator) {
  const config = {
    // Chart type: line (time series) or bar (comparison/categorical)
    chart_type: indicator.chart_recommended || 'bar',
    
    // Period type for time axis interpretation
    period_type: indicator.period_type || 'yearly',
    
    // Data structure type
    data_type: indicator.data_type || 'simple',
    
    // Primary dimension key for facet/category selector
    facet_column: null,
    
    // Available metrics (for multi-metric indicators)
    available_metrics: [],
    
    // Default metric to show
    default_metric: null,
    
    // Whether to show geo selector (kabupaten/kota breakdown)
    has_geo_dimension: false,
    
    // Whether to show category/facet selector
    has_facet_dimension: false,
    
    // Year range for reference
    year_range: {
      min: indicator.year_range?.min || null,
      max: indicator.year_range?.max || null
    },
    
    // Auto-generated timestamp
    generated_at: new Date().toISOString(),
    
    // Analysis source version
    analysis_version: '1.0'
  };
  
  // Set facet column based on dim_keys
  const dimKeys = indicator.dim_keys || [];
  if (dimKeys.length > 0 && dimKeys[0] !== 'N/A') {
    config.facet_column = dimKeys[0];
  }
  
  // Parse metrics
  const metricsStr = indicator.metrics;
  if (metricsStr && typeof metricsStr === 'string') {
    config.available_metrics = metricsStr.split(' | ').map(m => m.trim()).filter(Boolean);
    if (config.available_metrics.length > 0) {
      config.default_metric = config.available_metrics[0];
    }
  }
  
  // Determine dimension types based on data_type
  switch (indicator.data_type) {
    case 'geo':
      config.has_geo_dimension = true;
      config.has_facet_dimension = false;
      break;
    case 'geo-categorical':
      config.has_geo_dimension = true;
      config.has_facet_dimension = true;
      break;
    case 'categorical':
      config.has_geo_dimension = false;
      config.has_facet_dimension = true;
      break;
    case 'simple':
    default:
      config.has_geo_dimension = false;
      config.has_facet_dimension = false;
      break;
  }
  
  // Special handling for quarterly data with growth metrics
  if (config.period_type === 'quarterly') {
    // PDRB growth rates typically use line charts
    config.chart_type = 'line';
    
    // If multiple growth metrics available, default to y-on-y
    if (config.available_metrics.some(m => m.includes('y-on-y'))) {
      config.default_metric = config.available_metrics.find(m => m.includes('y-on-y'));
    }
  }
  
  // Special handling for monthly data
  if (config.period_type === 'monthly') {
    config.chart_type = 'line';
  }
  
  // Override period_type from sample_months detection
  // Priority: Triwulan > Tahunan (mixed quarterly + yearly data should be treated as quarterly)
  const sampleMonthsStr = String(indicator.sample_months || '');
  if (/Triwulan|Q[1-4]/i.test(sampleMonthsStr)) {
    config.period_type = 'quarterly';
    config.chart_type = 'line';
    // If multiple growth metrics available, default to y-on-y
    if (config.available_metrics.some(m => m.includes('y-on-y'))) {
      config.default_metric = config.available_metrics.find(m => m.includes('y-on-y'));
    }
  } else if (/Tahunan/i.test(sampleMonthsStr) && !/(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)/i.test(sampleMonthsStr)) {
    // Pure "Tahunan" without monthly data
    config.period_type = 'yearly';
    config.chart_type = 'bar';
  }
  
  return config;
}

async function main() {
  console.log('Generate Chart Configs');
  console.log('='.repeat(60));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no database changes)' : 'LIVE UPDATE'}`);
  console.log('');
  
  // Load analysis results
  const analysisPath = path.join(__dirname, '../../tmp/indicator_analysis.json');
  if (!fs.existsSync(analysisPath)) {
    console.error('Error: indicator_analysis.json not found');
    console.error('Run: node scripts/analyzeIndicators.js first');
    process.exit(1);
  }
  
  const analysisData = require(analysisPath);
  console.log(`Loaded ${analysisData.length} indicator analyses\n`);
  
  try {
    await sequelize.authenticate();
    console.log('Connected to database\n');
    
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const indicator of analysisData) {
      const sourceId = indicator.source_id;
      
      // Skip invalid source_ids
      if (!sourceId || sourceId <= 0) {
        console.log(`[SKIP] Invalid source_id: ${sourceId}`);
        skipped++;
        continue;
      }
      
      // Generate config
      const chartConfig = generateChartConfig(indicator);
      
      if (DRY_RUN) {
        console.log(`[DRY] source_id=${sourceId}: ${indicator.source_name?.substring(0, 50)}...`);
        console.log(`      chart_type=${chartConfig.chart_type}, period=${chartConfig.period_type}, data=${chartConfig.data_type}`);
        console.log(`      metrics=[${chartConfig.available_metrics.slice(0, 3).join(', ')}${chartConfig.available_metrics.length > 3 ? '...' : ''}]`);
        console.log('');
        updated++;
      } else {
        try {
          await sequelize.query(`
            UPDATE data_sources 
            SET chart_config = :chartConfig 
            WHERE id = :sourceId
          `, {
            replacements: {
              chartConfig: JSON.stringify(chartConfig),
              sourceId: sourceId
            }
          });
          
          updated++;
          if (updated % 50 === 0) {
            console.log(`Updated ${updated} indicators...`);
          }
        } catch (err) {
          console.error(`[ERROR] source_id=${sourceId}: ${err.message}`);
          errors++;
        }
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total analyzed: ${analysisData.length}`);
    console.log(`Updated: ${updated}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Errors: ${errors}`);
    
    if (DRY_RUN) {
      console.log('\nThis was a DRY RUN. Run without --dry-run to update database.');
    } else {
      console.log('\nChart configs saved to data_sources.chart_config');
    }
    
  } catch (err) {
    console.error('Database error:', err.message);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

main();
