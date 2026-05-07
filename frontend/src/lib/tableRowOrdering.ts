/**
 * Table Row Ordering Utilities
 *
 * Provides consistent row ordering for tables across the application:
 * - Kab/Kota ordering: BPS standard order with Maluku Utara (province) at bottom
 * - Aggregate ordering: PDRB, Total, Jumlah, Rata-rata at bottom
 *
 * Used by:
 * - AppHeader.tsx (dropdown search preview)
 * - SearchPageClient.tsx (hasil pencarian page)
 * - QuickDataPreviewCard.tsx (chat malika preview)
 * - data/page.tsx (data detail page)
 */

// BPS wilayah codes for Maluku Utara province
export const MALUT_ORDER_CODES = [
  8201, // Halmahera Barat
  8202, // Halmahera Tengah
  8203, // Kepulauan Sula
  8204, // Halmahera Selatan
  8205, // Halmahera Utara
  8206, // Halmahera Timur
  8207, // Pulau Morotai
  8208, // Pulau Taliabu
  8271, // Kota Ternate
  8272, // Kota Tidore Kepulauan
  8200, // Maluku Utara (PROVINCE - LAST)
];

// Name to code mapping (handles different naming conventions)
export const NAME_TO_CODE: Record<string, number> = {
  'halmahera barat': 8201,
  'halmahera tengah': 8202,
  'kepulauan sula': 8203,
  'halmahera selatan': 8204,
  'halmahera utara': 8205,
  'halmahera timur': 8206,
  'pulau morotai': 8207,
  'pulau taliabu': 8208,
  'kota ternate': 8271,
  'kota tidore kepulauan': 8272,
  // Without "Kota" prefix (dynamic API uses these)
  'ternate': 8271,
  'tidore kepulauan': 8272,
  // Province
  'maluku utara': 8200,
  'malut': 8200,
};

/**
 * Normalize a name for comparison (lowercase, collapse whitespace)
 */
export function normalizeName(v: unknown): string {
  return String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Parse a wilayah code from a value (handles numeric, string, embedded codes)
 */
export function parseWilayahCode(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  const s = String(v).trim();
  const m = s.match(/\b\d{4}\b/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isInteger(n) ? n : null;
}

/**
 * Check if a title/columns look like a kab/kota breakdown table
 */
export function looksLikeKabKotaBreakdown(title: string, columns: string[]): boolean {
  const t = String(title || '');
  const cols = Array.isArray(columns) ? columns : [];
  const colsJoined = cols.join(' ');
  // Check title/columns for explicit kab/kota patterns
  if (/(menurut\s+kabupaten\s*\/\s*kota|kabupaten\s*\/\s*kota|kab\s*\/\s*kota|kab\s*kota)/i.test(t + ' ' + colsJoined)) {
    return true;
  }
  // Also detect if first column is "Wilayah" (common in interop tables)
  const firstCol = String(cols[0] || '').trim().toLowerCase();
  if (firstCol === 'wilayah') {
    return true;
  }
  return false;
}

/**
 * Find the wilayah code column from columns array
 */
export function findWilayahCodeColumn(columns: string[]): string | null {
  const cols = Array.isArray(columns) ? columns : [];
  const exact = cols.find((c) =>
    /^(kode|kode_wilayah|kode_kabkota|kode_kab_kota|id_wilayah|idkab|id_kab|id_kabkota|id_kab_kota)$/i.test(String(c || '').trim())
  );
  if (exact) return exact;
  return cols.find((c) => /(kode|id).*(wilayah|kab|kota)/i.test(String(c || '').trim())) || null;
}

/**
 * Find the geo key column (for wilayah name matching)
 */
export function findGeoKeyColumn(columns: string[]): string | null {
  if (!Array.isArray(columns) || columns.length === 0) return null;
  const exact = columns.find((c) =>
    /^(wilayah|kabupaten|kota|kabupaten\/kota|kab\/kota|daerah|region)$/i.test(String(c || '').trim())
  );
  if (exact) return exact;
  const partial = columns.find((c) =>
    /(wilayah|kabupaten|kota|daerah|region)/i.test(String(c || '').trim())
  );
  if (partial) return partial;
  // Fallback to first column if it looks like a label column
  const first = columns[0];
  if (first && !/^(tahun|year|bulan|month|periode|period|nilai|value|jumlah|total)/i.test(String(first || ''))) {
    return first;
  }
  return null;
}

/**
 * Apply Maluku Utara kab/kota ordering (BPS standard order, province last)
 *
 * @param rows - Array of row objects
 * @param geoKeyCol - Column name for geo/wilayah name (e.g., "Wilayah")
 * @param wilayahCodeCol - Column name for wilayah code (e.g., "kode_wilayah")
 * @param title - Table/indicator title
 * @param columns - Array of column names
 * @returns Sorted rows array
 */
export function applyMalutWilayahOrder(args: {
  rows: any[];
  geoKeyCol: string | null;
  wilayahCodeCol: string | null;
  title: string;
  columns: string[];
}): any[] {
  const { rows, geoKeyCol, wilayahCodeCol, title, columns } = args;

  if (!Array.isArray(rows) || rows.length === 0) return rows;
  if (!looksLikeKabKotaBreakdown(title, columns)) return rows;

  const orderPos = new Map<number, number>();
  MALUT_ORDER_CODES.forEach((code, idx) => orderPos.set(code, idx));

  const getRowCode = (r: any): number | null => {
    // Try code column first
    if (wilayahCodeCol) {
      const c = parseWilayahCode(r?.[wilayahCodeCol]);
      if (c != null) return c;
    }
    // Fall back to name-to-code mapping
    if (geoKeyCol) {
      const name = normalizeName(r?.[geoKeyCol]);
      if (name && typeof NAME_TO_CODE[name] === 'number') return NAME_TO_CODE[name];
    }
    return null;
  };

  // Only activate if this table has at least one known Malut kab/kota
  const hasAnyKnown = rows.some((r) => {
    const code = getRowCode(r);
    return typeof code === 'number' && orderPos.has(code);
  });
  if (!hasAnyKnown) return rows;

  // Stable sort: known codes first in BPS order; unknown keep original relative order after
  const decorated = rows.map((r, idx) => {
    const code = getRowCode(r);
    const pos = typeof code === 'number' ? orderPos.get(code) : undefined;
    return { r, idx, pos: typeof pos === 'number' ? pos : null };
  });

  decorated.sort((a, b) => {
    const ap = a.pos;
    const bp = b.pos;
    if (ap != null && bp != null) return ap - bp;
    if (ap != null && bp == null) return -1;
    if (ap == null && bp != null) return 1;
    return a.idx - b.idx;
  });

  return decorated.map((x) => x.r);
}

/**
 * Check if a label matches aggregate patterns (PDRB, Total, Jumlah, Rata-rata)
 */
export function isAggregateLabel(label: string): boolean {
  const s = String(label || '').trim();
  // PDRB total row
  if (/^PRODUK\s*DOMESTIK\s*REGIONAL\s*BRUTO$/i.test(s)) return true;
  // Total/Jumlah patterns (exact match or prefix with indicator)
  if (/^(TOTAL|JUMLAH)$/i.test(s)) return true;
  if (/^(TOTAL|JUMLAH)\s*:/i.test(s)) return true;
  // Note: We do NOT mark "Rata-rata" as aggregate by default because it's often
  // a valid data label in the middle of tables. Only specific contexts should use it.
  return false;
}

/**
 * Check if the table looks like a PDRB/lapangan usaha table
 */
export function looksLikePdrbTable(title: string): boolean {
  return /\bpdrb\b|\bproduk\s*domestik\s*regional\s*bruto\b/i.test(String(title || ''));
}

/**
 * Apply aggregate ordering (move PDRB/Total rows to bottom)
 *
 * @param rows - Array of row objects
 * @param labelCol - Column name for the row label (usually first column)
 * @param title - Table/indicator title
 * @returns Sorted rows array
 */
export function applyAggregateOrdering(args: {
  rows: any[];
  labelCol: string | null;
  title: string;
}): any[] {
  const { rows, labelCol, title } = args;

  if (!Array.isArray(rows) || rows.length === 0) return rows;
  if (!labelCol) return rows;

  // Only apply to PDRB-like tables (conservative)
  if (!looksLikePdrbTable(title)) return rows;

  const aggregateRows: any[] = [];
  const regularRows: any[] = [];

  for (const r of rows) {
    const label = String(r?.[labelCol] || '').trim();
    if (isAggregateLabel(label)) {
      aggregateRows.push(r);
    } else {
      regularRows.push(r);
    }
  }

  return [...regularRows, ...aggregateRows];
}

/**
 * Apply all row ordering transformations
 *
 * Combines:
 * 1. Kab/Kota ordering (Maluku Utara province last)
 * 2. Aggregate ordering (PDRB total last)
 *
 * @param rows - Array of row objects
 * @param columns - Array of column names
 * @param title - Table/indicator title
 * @returns Sorted rows array
 */
export function applyTableRowOrdering(args: {
  rows: any[];
  columns: string[];
  title: string;
}): any[] {
  const { columns, title } = args;
  let { rows } = args;

  if (!Array.isArray(rows) || rows.length === 0) return rows;

  // Find relevant columns
  const geoKeyCol = findGeoKeyColumn(columns);
  const wilayahCodeCol = findWilayahCodeColumn(columns);
  const labelCol = columns[0] || null;

  // Step 1: Kab/Kota ordering
  rows = applyMalutWilayahOrder({
    rows,
    geoKeyCol,
    wilayahCodeCol,
    title,
    columns,
  });

  // Step 2: Aggregate ordering (PDRB)
  rows = applyAggregateOrdering({
    rows,
    labelCol,
    title,
  });

  return rows;
}
// ============================================================================
// DATA NORMALIZATION UTILITIES
// Detects and normalizes mixed-scale data (e.g., 1282937 vs 1337.2 when unit is "ribu jiwa")
// ============================================================================

export type NormalizationResult = {
  rows: Array<Record<string, unknown>>;
  normalized: boolean;
  details?: string;
  scaleFactor?: number;
  affectedYears?: string[];
};

/**
 * Check if a unit string indicates scaled values (ribu, juta, etc.)
 */
export function isScaledUnit(unit?: string | null): boolean {
  if (!unit) return false;
  const unitLower = unit.toLowerCase();
  return /ribu|juta|miliar|triliun/.test(unitLower);
}

/**
 * Extract year columns from row data (columns named like 2020, 2021, etc.)
 */
export function extractYearColumns(rows: Array<Record<string, unknown>>): string[] {
  if (!rows || rows.length === 0) return [];
  
  const sampleRow = rows[0];
  const yearColumns: string[] = [];
  
  for (const key of Object.keys(sampleRow)) {
    if (/^\d{4}$/.test(key)) {
      yearColumns.push(key);
    }
  }
  
  return yearColumns.sort();
}

/**
 * Extract numeric metric columns from row data (columns with numeric values, excluding labels).
 * Used for normalizing single-period data where columns are metric names, not years.
 */
/**
 * Helper: parse value to number, handling both number and string types
 */
function toNumericValue(val: unknown): number | null {
  if (typeof val === "number" && !isNaN(val)) {
    return val;
  }
  if (typeof val === "string") {
    // Parse string, handling comma as decimal separator (Indonesian format)
    const cleaned = val.replace(/\s/g, "").replace(/,/g, ".");
    const parsed = parseFloat(cleaned);
    if (!isNaN(parsed)) return parsed;
  }
  return null;
}

export function extractNumericColumns(rows: Array<Record<string, unknown>>): string[] {
  if (!rows || rows.length === 0) return [];
  
  // Sample multiple rows to detect numeric columns (not just first row)
  const numericCols: string[] = [];
  
  // Label columns to skip (case-insensitive patterns)
  const labelPatterns = /^(wilayah|region|kab|kota|provinsi|area|bulan|tahun|periode|__.*|id|kode)$/i;
  
  // Get all keys from first row
  const sampleRow = rows[0];
  const candidates = Object.keys(sampleRow).filter(key => {
    // Skip if it looks like a label column
    if (labelPatterns.test(key)) return false;
    // Skip year columns (will be handled separately)
    if (/^\d{4}$/.test(key)) return false;
    return true;
  });
  
  // Check each candidate against multiple rows (sample 80 to match chart's pickValueCandidates)
  for (const key of candidates) {
    let hasNumeric = false;
    // Check first 80 rows for numeric values (aligned with chart profiler)
    for (let i = 0; i < Math.min(rows.length, 80); i++) {
      const val = toNumericValue(rows[i][key]);
      if (val !== null && val > 0) {
        hasNumeric = true;
        break;
      }
    }
    if (hasNumeric) {
      numericCols.push(key);
    }
  }
  
  return numericCols;
}

/**
 * Detect if there's a scale mismatch in the data.
 * Returns true if some values are >100000 and others are <10000.
 * Now also handles string values (which BPS API often returns).
 */
export function detectScaleMismatch(
  rows: Array<Record<string, unknown>>,
  columns: string[]
): { hasMismatch: boolean; hasLarge: boolean; hasSmall: boolean } {
  if (!rows || rows.length === 0 || columns.length === 0) {
    return { hasMismatch: false, hasLarge: false, hasSmall: false };
  }

  let hasLarge = false;
  let hasSmall = false;

  for (const row of rows) {
    for (const col of columns) {
      const val = toNumericValue(row[col]);
      if (val !== null && val > 0) {
        if (val > 100000) hasLarge = true;
        if (val < 10000) hasSmall = true;
        
        // Early exit if mismatch found
        if (hasLarge && hasSmall) {
          return { hasMismatch: true, hasLarge: true, hasSmall: true };
        }
      }
    }
  }

  return { hasMismatch: hasLarge && hasSmall, hasLarge, hasSmall };
}

/**
 * Detect if values in a single-period dataset are in raw units when they should be scaled.
 * For "ribu jiwa" unit, values >100000 are likely in raw units (not thousands).
 * 
 * Updated to handle mixed-period data where some values are large and others are small.
 * Now also handles string values (which BPS API often returns).
 */
export function detectRawUnitsForScaledUnit(
  rows: Array<Record<string, unknown>>,
  columns: string[]
): { needsNormalization: boolean; hasLargeValues: boolean; hasMixedScale: boolean } {
  if (!rows || rows.length === 0 || columns.length === 0) {
    return { needsNormalization: false, hasLargeValues: false, hasMixedScale: false };
  }

  // Check if values have mixed scales (some >10000, others <1000)
  // This handles cases like:
  // - 2020: 63452 (raw) - should be 63.45 ribu
  // - 2024: 124.3 (ribu jiwa) - already correct
  // Use 10000 as threshold: Indonesian province/kota populations range 10-5000 ribu jiwa
  let hasLargeValues = false;  // values > 10000 (likely raw units)
  let hasSmallValues = false;  // values < 1000 (likely already scaled)
  let allValuesLarge = true;

  for (const row of rows) {
    for (const col of columns) {
      const val = toNumericValue(row[col]);
      if (val !== null && val > 0) {
        if (val > 10000) {
          hasLargeValues = true;
        } else if (val < 1000) {
          allValuesLarge = false;
          hasSmallValues = true;
        }
      }
    }
  }

  // Mixed scale: some values are large (raw units) and some are small (already scaled)
  const hasMixedScale = hasLargeValues && hasSmallValues;
  
  // Normalize if:
  // 1. ALL values are large (single period with raw data), OR
  // 2. Mixed scale detected (multi-period with inconsistent formatting)
  const needsNormalization = (hasLargeValues && allValuesLarge) || hasMixedScale;
  
  return { needsNormalization, hasLargeValues, hasMixedScale };
}

/**
 * Normalize mixed-scale data by dividing large values to match small value scale.
 * Handles two scenarios:
 * 1. Multi-year data: Year columns (2020, 2021) with mismatch (some >100000, others <10000)
 * 2. Single-period data: Metric columns with all values in raw units (>1000 when unit is "ribu")
 * 
 * @param rows - Array of data rows
 * @param unit - Unit string (e.g., "ribu jiwa") - normalization only applies to scaled units
 * @returns Normalization result with potentially modified rows
 */
export function normalizeTableData(
  rows: Array<Record<string, unknown>>,
  unit?: string | null
): NormalizationResult {
  // Return original if no rows
  if (!rows || rows.length === 0) {
    return { rows, normalized: false };
  }

  // Only apply for units that indicate scale (ribu, juta, etc.)
  if (!isScaledUnit(unit)) {
    return { rows, normalized: false };
  }

  const unitLower = (unit || "").toLowerCase();
  
  // SCENARIO 0: Multi-year data with __preview_year marker (most common case)
  // This handles data from previewPayloadByYear where each row has __preview_year field
  const hasPreviewYear = rows.some((r) => r.__preview_year !== undefined);
  if (hasPreviewYear) {
    const numericColumns = extractNumericColumns(rows);
    if (numericColumns.length > 0) {
      // Group rows by year and check for scale mismatch
      const yearGroups = new Map<string, Array<Record<string, unknown>>>();
      for (const row of rows) {
        const year = String(row.__preview_year || "");
        if (!year) continue;
        if (!yearGroups.has(year)) yearGroups.set(year, []);
        yearGroups.get(year)!.push(row);
      }
      
      // Check each year's typical value scale
      const yearScales = new Map<string, { max: number; min: number }>();
      for (const [year, yearRows] of yearGroups) {
        let max = 0;
        let min = Infinity;
        for (const row of yearRows) {
          for (const col of numericColumns) {
            const val = toNumericValue(row[col]);
            if (val !== null && val > 0) {
              max = Math.max(max, val);
              min = Math.min(min, val);
            }
          }
        }
        if (max > 0) yearScales.set(year, { max, min: min === Infinity ? 0 : min });
      }
      
      // Detect scale mismatch: some years have max >10000, others have max <1000
      let hasLargeYears = false;
      let hasSmallYears = false;
      const largeYears: string[] = [];
      const smallYears: string[] = [];
      
      for (const [year, scale] of yearScales) {
        if (scale.max > 10000) {
          hasLargeYears = true;
          largeYears.push(year);
        } else if (scale.max < 1000 && scale.max > 0) {
          hasSmallYears = true;
          smallYears.push(year);
        }
      }
      
      console.log('[Normalization SCENARIO 0] __preview_year detected:', {
        years: Array.from(yearScales.keys()),
        largeYears,
        smallYears,
        hasMismatch: hasLargeYears && hasSmallYears,
        numericColumns: numericColumns.slice(0, 3)
      });
      
      // Only normalize if there's a clear scale mismatch between years
      if (hasLargeYears && hasSmallYears) {
        const scaleFactor = 1000;
        const threshold = 10000; // Values >10000 are in raw units for "ribu" data
        
        const normalizedRows = rows.map((row) => {
          const year = String(row.__preview_year || "");
          // Only normalize rows from years with large values
          if (!largeYears.includes(year)) return row;
          
          const newRow = { ...row };
          for (const col of numericColumns) {
            const val = toNumericValue(row[col]);
            if (val !== null && val > threshold) {
              newRow[col] = Math.round((val / scaleFactor) * 100) / 100;
            }
          }
          return newRow;
        });
        
        return {
          rows: normalizedRows,
          normalized: true,
          details: `Data tahun ${largeYears.join(", ")} dinormalisasi (÷${scaleFactor}) ke satuan ${unitLower}`,
          scaleFactor,
          affectedYears: largeYears,
        };
      }
    }
  }
  
  // SCENARIO 1: Multi-year data with year columns
  const yearColumns = extractYearColumns(rows);
  if (yearColumns.length > 0) {
    // Detect scale mismatch in year columns
    const { hasMismatch } = detectScaleMismatch(rows, yearColumns);
    if (!hasMismatch) {
      // No mismatch detected - return original data unchanged
      return { rows, normalized: false };
    }

    // Normalize year columns
    const scaleFactor = 1000;
    const threshold = 100000; // Values above this are in raw units, not scaled

    const normalizedRows = rows.map((row) => {
      const newRow = { ...row };
      for (const col of yearColumns) {
        const val = toNumericValue(row[col]);
        if (val !== null && val > threshold) {
          newRow[col] = Math.round((val / scaleFactor) * 100) / 100;
        }
      }
      return newRow;
    });

    const affectedYears = yearColumns.filter((col) =>
      rows.some((row) => {
        const val = toNumericValue(row[col]);
        return val !== null && val > threshold;
      })
    );

    const details = affectedYears.length > 0
      ? `Data tahun ${affectedYears.join(", ")} dinormalisasi (÷${scaleFactor}) ke satuan ${unitLower}`
      : undefined;

    return {
      rows: normalizedRows,
      normalized: true,
      details,
      scaleFactor,
      affectedYears,
    };
  }

  // SCENARIO 2: Single-period data with metric columns
  const numericColumns = extractNumericColumns(rows);
  if (numericColumns.length === 0) {
    return { rows, normalized: false };
  }

  // Check if values are in raw units or have mixed scales
  const { needsNormalization, hasMixedScale } = detectRawUnitsForScaledUnit(rows, numericColumns);
  if (!needsNormalization) {
    return { rows, normalized: false };
  }

  // Normalize metric columns
  const scaleFactor = 1000;
  // Use higher threshold: values >10000 are raw units for "ribu" data
  // (e.g., 63452 should become 63.45 ribu, but 1337.2 should stay as-is)
  const threshold = 10000;

  const normalizedRows = rows.map((row) => {
    const newRow = { ...row };
    for (const col of numericColumns) {
      const val = toNumericValue(row[col]);
      if (val !== null && val > threshold) {
        newRow[col] = Math.round((val / scaleFactor) * 100) / 100;
      }
    }
    return newRow;
  });

  const details = hasMixedScale 
    ? `Data dengan skala berbeda dinormalisasi (÷${scaleFactor}) ke satuan ${unitLower}`
    : `Data dinormalisasi (÷${scaleFactor}) ke satuan ${unitLower}`;

  return {
    rows: normalizedRows,
    normalized: true,
    details,
    scaleFactor,
  };
}

/**
 * Extract unit from source title using common patterns.
 * Matches patterns like "(ribu jiwa)", "(juta rupiah)", etc.
 */
export function extractUnitFromTitle(title?: string | null): string | null {
  if (!title) return null;
  
  // Match content in parentheses that looks like a unit
  const match = title.match(/\(([^)]*(?:ribu|juta|miliar|triliun|persen|%|kg|ton|liter|unit)[^)]*)\)/i);
  if (match) {
    return match[1].trim();
  }
  
  return null;
}