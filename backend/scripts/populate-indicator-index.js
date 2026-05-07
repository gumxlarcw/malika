#!/usr/bin/env node
/**
 * Populate indicator_index column for all parent KB documents.
 * 
 * Extraction strategy per document type:
 * 
 * A) Publikasi with DAFTAR TABEL/LIST OF TABLES:
 *    Parse the formal TOC section extracting numbered table entries.
 *    Also parse DAFTAR ISI, DAFTAR GAMBAR, DAFTAR LAMPIRAN sections.
 * 
 * B) Publikasi without DAFTAR TABEL:
 *    Extract inline "Tabel N.N Title" patterns from full content.
 *    Also extract BAB/Chapter headers.
 * 
 * C) BRS:
 *    Extract inline "Tabel N. Title" patterns + BAB headers.
 *    BRS are small (avg 16K) so this is supplementary.
 * 
 * Format: pipe-separated "section|number|title", one per line.
 *   TOC|1.1|Keadaan Geografi
 *   TBL|8.5|Jumlah Rumah Makan/Restoran Menurut Kabupaten/Kota
 *   FIG|1.1|Peta Wilayah Provinsi Maluku Utara
 *   APP|1|Daftar Kecamatan dan Desa
 *   BAB|I|Pendahuluan
 * 
 * Usage:
 *   node scripts/populate-indicator-index.js [--dry-run] [--id=855]
 * 
 * @since 2026-02-19
 */

'use strict';

const mysql = require('mysql2/promise');
const path = require('path');

// Load .env
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DRY_RUN = process.argv.includes('--dry-run');
const SINGLE_ID = process.argv.find(a => a.startsWith('--id='))?.split('=')[1];

// ── Helpers ───────────────────────────────────────────────────────────────

/** Check if a line is an English translation */
function isEnglishLine(line) {
  const t = line.trim();
  // Starts with known English words (case-insensitive)
  if (/^(Percentage|Number|Distribution|Rate|Average|Table|Figure|Map|Population|Ratio|Index|Area|Total|Observation|Distance|Altitude|Gross|Gini|Human|Consumer|Poverty|Unemployment|Labour|Labor|Open|Inflation|Life|Gender|Literacy|School|Education|Health|Housing|Crime|Social|Religion|Election|Civil|Government|Revenue|Allocation|Realization|Export|Import|Foreign|Production|Fishery|Fish|Mining|Manufacturing|Tourism|Hotel|Accommodation|Restaurant|Length|Transportation|Communication|Banking|Saving|Credit|Cooperation|Expenditure|Consumption|Trade|Domestic|Regional|Comparison|Province|Provincial|Municipal|Municipality|Star|Non|Visitor|Guest|Room|Occupancy|Village|Subdistrict|Per\s|Percent|Growth|Volume|Value|Implicit|Source|Fuel|Energy|Toilet|Dwelling|Ownership|Floor|Drinking|Water|Electricity|Regency|Climate|Meteorolog|Weather|by |of |in |the |and )/i.test(t)) return true;
  // Line is predominantly English (>60% English words)
  const words = t.split(/\s+/).filter(w => w.length > 2);
  if (words.length >= 3) {
    const englishWords = words.filter(w => /^(the|and|or|by|of|in|at|to|for|from|with|on|is|are|was|were|be|been|has|have|had|not|but|as|an|a|province|regency|municipality|district|city|percent|billion|million|thousand|rupiah|growth|gross|domestic|product|number|index|rate|table|figure|value|volume|export|import|regional|national|per|capita|price|market|constant|current|prices|industry|expenditure|consumption|production|distribution|population|household|area|total|average|star|non|room|occupancy|visitor|guest|accommodation|hotel|restaurant|tourism|mining|manufacturing|fishery|transportation|communication|banking|saving|credit|trade|foreign|revenue|county|village|subdistrict|based|according|classification)$/i.test(w));
    if (englishWords.length / words.length > 0.55) return true;
  }
  return false;
}

/**
 * Strip English translation from a bilingual title.
 * Common pattern: "Indonesian Title, 2024 English Translation, 2024"
 */
function stripEnglishTranslation(title) {
  if (!title || title.length < 10) return title;
  
  // Pattern 1: Year appears twice - strip from the second occurrence
  // "...2020–2024 English text 2020–2024" → keep up to first year range
  const yearRanges = [...title.matchAll(/(\d{4})[–\-–](\d{4})/g)];
  if (yearRanges.length >= 2) {
    const firstEnd = yearRanges[0].index + yearRanges[0][0].length;
    const betweenText = title.substring(firstEnd, yearRanges[1].index);
    // Check if text between years contains English
    if (/\b(province|regency|municipality|percent|billion|million|rupiah|growth|gross|domestic|product|by|of|in|the)\b/i.test(betweenText)) {
      return title.substring(0, firstEnd).trim();
    }
  }
  
  // Pattern 2: Single year followed by English text
  // "...2024 Percent Distribution..." → strip from English
  const singleYearMatch = title.match(/(\b\d{4}\b)\s+(Province|Percent|Number|Growth|Gross|Volume|Value|Per\s|Implicit|Municipal|Regency|Provincial|Star|Non)/i);
  if (singleYearMatch) {
    return title.substring(0, singleYearMatch.index + singleYearMatch[1].length).trim();
  }
  
  // Pattern 3: Closing paren followed by English text  
  // "...(persen), 2024 Growth Rate..." or "...(miliar rupiah), 2024 Utara Province..."
  const parenYearMatch = title.match(/\)\s*,?\s*(\d{4})\s+([A-Z])/);
  if (parenYearMatch) {
    const afterParen = title.substring(parenYearMatch.index + parenYearMatch[0].length - 1);
    if (/\b(province|regency|gross|percent|growth|billion|million|rupiah|domestic|product|number|municipal|per\s|capita)\b/i.test(afterParen)) {
      return title.substring(0, parenYearMatch.index + parenYearMatch[0].length - 2 + parenYearMatch[1].length).trim();
    }
  }
  
  // Pattern 4: ALL-CAPS with mixed Indonesian/English  
  // "PRODUK DOMESTIK REGIONAL BRUTO PROVINSI PROVINCIAL GROSS REGIONAL DOMESTIC PRODUCT"
  if (title === title.toUpperCase()) {
    const englishCapsMatch = title.match(/\b(PROVINCIAL|MUNICIPAL|GROSS REGIONAL|DOMESTIC PRODUCT|NUMBER OF|PERCENTAGE|DISTRIBUTION|GROWTH RATE|VOLUME AND|VALUE OF|PER CAPITA|IMPLICIT)\b/);
    if (englishCapsMatch && englishCapsMatch.index > 10) {
      let cleaned = title.substring(0, englishCapsMatch.index).trim();
      cleaned = cleaned.replace(/\s*\/?\s*$/, ''); // Remove trailing slash
      if (cleaned.length > 5) return cleaned;
    }
  }
  
  return title;
}

/** Check if a line is boilerplate/noise */
function isNoiseLine(line) {
  const l = line.replace(/\t/g, ' ').trim();
  if (!l || l.length < 3) return true;
  if (/^(Halaman|Page|https?:|--\s*\d|Provinsi Maluku Utara\b|Maluku Utara Province)/i.test(l)) return true;
  if (/^--\s*\d+\s+of\s+\d+\s*--/.test(l)) return true;
  if (/^[.\s…·]+\d*\s*$/.test(l)) return true;  // Just dots and page numbers
  if (/^(malut\.bps\.go\.id|bps\.go\.id|https?:)/i.test(l)) return true;
  // Roman numeral page markers (e.g., "xiii", "xxvii")
  if (/^[ivxlcdm]+$/i.test(l) && l.length <= 10) return true;
  // Pure number (page number)
  if (/^\d+$/.test(l)) return true;
  // Standalone words that aren't entries
  if (/^(Tabel|Table|Gambar|Figure|Lampiran|Appendix|Volume|Statistik Kunci|Key Statistics)$/i.test(l)) return true;
  return false;
}

// ── Section Extraction Functions ──────────────────────────────────────────

/**
 * Find the MAIN occurrence of a named section heading.
 * 
 * Strategy: Find ALL-CAPS matches of the header (e.g., "DAFTAR TABEL").
 * Among multiple matches, pick the one whose subsequent lines contain
 * actual numbered entries (not just dots/page references), which
 * distinguishes the real section from a reference inside DAFTAR ISI.
 */
function findSectionStart(content, patterns) {
  for (const pat of patterns) {
    // Use case-sensitive search (ALL-CAPS headers are the real sections)
    const globalPat = new RegExp(pat.source, 'gm');
    let match;
    const candidates = [];
    
    while ((match = globalPat.exec(content)) !== null) {
      candidates.push(match.index);
    }
    
    if (candidates.length === 0) continue;
    if (candidates.length === 1) return candidates[0];
    
    // Multiple matches: pick the one followed by actual entries
    // (numbered lines like "1.1" or "II KEPENDUDUKAN"), not just dots
    for (const idx of candidates) {
      const after = content.substring(idx, idx + 500);
      const lines = after.split('\n').slice(1, 8); // Skip header line
      const hasEntries = lines.some(l => {
        const trimmed = l.trim();
        // Numbered entry: "1.1  KEADAAN GEOGRAFI" or "II KEPENDUDUKAN"
        return /^\d+(?:\.\d+){0,3}\s+\S/.test(trimmed) || /^[IVX]{1,4}\s+[A-ZÁ-Ú]/.test(trimmed);
      });
      if (hasEntries) return idx;
    }
    
    // Fallback: return last match (usually the real section is later in doc)
    return candidates[candidates.length - 1];
  }
  return -1;
}

/**
 * Extract a section between a start marker and end markers.
 */
function extractSection(content, startPatterns, endPatterns) {
  const contentStr = String(content || '');
  
  const startIdx = findSectionStart(contentStr, startPatterns);
  if (startIdx < 0) return null;
  
  let endIdx = contentStr.length;
  const searchFrom = startIdx + 50;
  
  for (const pat of endPatterns) {
    const globalPat = new RegExp(pat.source, 'gim');
    let match;
    while ((match = globalPat.exec(contentStr)) !== null) {
      if (match.index > searchFrom) {
        if (match.index < endIdx) endIdx = match.index;
        break;
      }
    }
  }
  
  if (endIdx - startIdx > 100000) endIdx = startIdx + 100000;
  
  return contentStr.substring(startIdx, endIdx);
}

/**
 * Join multi-line entries. In yearbook TOCs, table titles often wrap across 2-3 lines:
 *   "1.1.1 Luas Daerah dan Jumlah Pulau Menurut Kabupaten/"
 *   "Kota di Provinsi Maluku Utara, 2022"
 */
function joinMultilineEntries(lines) {
  const merged = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\t/g, ' ').trim();
    if (!line) continue;
    
    // Check if line starts with a numbered entry or chapter marker
    if (/^\d+(?:\.\d+){0,3}[\s.]/.test(line) || /^[IVX]{1,4}\s+[A-ZÁ-Ú]/.test(line) || /^BAB\s/i.test(line)) {
      merged.push(line);
    } else if (merged.length > 0) {
      // Skip noise/boilerplate lines
      if (isNoiseLine(line)) continue;
      if (isEnglishLine(line)) continue;
      if (/^[.\s…·]+\d*$/.test(line)) continue;
      if (/^(Daftar|DAFTAR|LIST|Table|Figure|Gambar)\b/.test(line)) continue;
      // Skip lines ending with just dots + page number (common in TOC)
      if (/^[^\d]*[.…·]{3,}\s*\d+\s*$/.test(line)) continue;
      
      // Join to previous if it looks like a continuation (not standalone noise)
      if (line.length > 3) {
        merged[merged.length - 1] += ' ' + line;
      }
    }
  }
  
  return merged;
}

/**
 * Parse a numbered table/figure/appendix entry line.
 * Returns {num, title} or null.
 */
function parseNumberedEntry(line) {
  const cleaned = line.replace(/\t/g, ' ');
  
  // Pattern: "1.1.1 Title text ... 17" or "1. GEOGRAFI DAN IKLIM"
  const match = cleaned.match(/^(\d+(?:\.\d+){0,3})\s+(.{3,500})/);
  if (!match) return null;
  
  let title = match[2].trim();
  
  // Remove trailing dots + page number
  title = title.replace(/\s*[.\s…·]{3,}\s*\d+\s*$/, '').trim();
  // Remove mid-line page numbers after dots
  title = title.replace(/\s*[.…·]{3,}\s*\d+/, '').trim();
  
  // Remove English bilingual portion after "/"
  // Only strip if what follows "/" looks English
  const bilingualSlash = title.match(/\s*\/\s*(The |A |An |By |In |Of |And |With |For |To |From |Number|Percentage|Distribution|Rate|Average|Total|Gross|Area|Population|Index|Ratio|Life|Gender|Open|Consumer|Poverty|Map|Observation|Altitude|Distance|Village|Length|Star|Non|Visitor|Guest|Room|Tourism|Hotel|Fishery|Mining|Manufacture|Export|Import|Banking|Saving|Credit|Revenue|Trade|Domestic|Regional|Expenditure|Comparison)\w/i);
  if (bilingualSlash) {
    title = title.substring(0, title.indexOf(bilingualSlash[0])).trim();
  }
  
  // Strip English translation that got joined from multi-line
  title = stripEnglishTranslation(title);
  
  if (title.length < 3) return null;
  
  return { num: match[1], title };
}

/**
 * Parse DAFTAR TABEL / LIST OF TABLES section.
 */
function parseDaftarTabel(content) {
  const section = extractSection(content,
    [/^DAFTAR\s+TABEL/m],
    [/^DAFTAR\s+GAMBAR/m, /^DAFTAR\s+LAMPIRAN/m, /^DAFTAR\s+SINGKATAN/m,
     /^PENJELASAN\s+UMUM/m, /^BAB\s+[I1]/m, /^STATISTIK\s+KUNCI/m]
  );
  if (!section) return [];
  
  const lines = section.split('\n');
  const merged = joinMultilineEntries(lines);
  
  const entries = [];
  const seen = new Set();
  
  for (const line of merged) {
    if (isEnglishLine(line)) continue;
    if (isNoiseLine(line)) continue;
    
    // Chapter header with tab/multi-space — "1.  GEOGRAFI DAN IKLIM"
    const chapterMatch = line.match(/^(\d+)\.\s{2,}([A-ZÁ-Ú][\w\sA-ZÁ-Ú,&\-/()]+)/);
    if (chapterMatch) {
      const num = chapterMatch[1];
      let title = chapterMatch[2].trim();
      const slashIdx = title.search(/\s*\/\s*[A-Z]{2}/);
      if (slashIdx > 0) title = title.substring(0, slashIdx).trim();
      title = stripEnglishTranslation(title);
      title = title.replace(/\s*\/?\s*$/, ''); // Remove trailing slash
      const key = `BAB|${num}|${title}`;
      if (!seen.has(key.toLowerCase())) {
        seen.add(key.toLowerCase());
        entries.push(key);
      }
      continue;
    }
    
    // Roman numeral chapter — "II KEPENDUDUKAN/DEMOGRAPHY"
    const romanChapterMatch = line.match(/^([IVX]{1,4})\s+([A-ZÁ-Ú][\w\sA-ZÁ-Ú,&\-/()]+)/);
    if (romanChapterMatch && /^[IVX]+$/.test(romanChapterMatch[1])) {
      const num = romanChapterMatch[1];
      let title = romanChapterMatch[2].trim();
      const slashIdx = title.search(/\s*\/\s*[A-Z]{2}/);
      if (slashIdx > 0) title = title.substring(0, slashIdx).trim();
      title = stripEnglishTranslation(title);
      title = title.replace(/\s*\/?\s*$/, ''); // Remove trailing slash
      const key = `BAB|${num}|${title}`;
      if (!seen.has(key.toLowerCase())) {
        seen.add(key.toLowerCase());
        entries.push(key);
      }
      continue;
    }
    
    // Numbered entry
    const parsed = parseNumberedEntry(line);
    if (parsed) {
      const key = `TBL|${parsed.num}|${parsed.title}`;
      if (!seen.has(key.toLowerCase())) {
        seen.add(key.toLowerCase());
        entries.push(key);
      }
    }
  }
  
  return entries;
}

/**
 * Parse DAFTAR ISI / CONTENTS section.
 */
function parseDaftarIsi(content) {
  const section = extractSection(content,
    [/^DAFTAR\s+ISI/m],
    [/^DAFTAR\s+TABEL/m, /^DAFTAR\s+GAMBAR/m, /^DAFTAR\s+LAMPIRAN/m,
     /^DAFTAR\s+SINGKATAN/m]
  );
  if (!section) return [];
  
  const lines = section.split('\n');
  const merged = joinMultilineEntries(lines);
  
  const entries = [];
  const seen = new Set();
  
  for (const line of merged) {
    if (isEnglishLine(line)) continue;
    if (isNoiseLine(line)) continue;
    
    const babMatch = line.match(/^(?:BAB|Bab)\s+([IVX\d]+)\s+(.{4,120})/i);
    if (babMatch) {
      let title = babMatch[2].trim().replace(/\s*[.\s…·]{3,}\s*\d+\s*$/, '').trim();
      const slashIdx = title.search(/\s*\/\s*[A-Z]{2}/);
      if (slashIdx > 0) title = title.substring(0, slashIdx).trim();
      const key = `BAB|${babMatch[1]}|${title}`;
      if (!seen.has(key.toLowerCase())) {
        seen.add(key.toLowerCase());
        entries.push(key);
      }
      continue;
    }
    
    const parsed = parseNumberedEntry(line);
    if (parsed) {
      const key = `TOC|${parsed.num}|${parsed.title}`;
      if (!seen.has(key.toLowerCase())) {
        seen.add(key.toLowerCase());
        entries.push(key);
      }
    }
  }
  
  return entries;
}

/**
 * Parse DAFTAR GAMBAR / LIST OF FIGURES section.
 */
function parseDaftarGambar(content) {
  const section = extractSection(content,
    [/^DAFTAR\s+GAMBAR/m],
    [/^DAFTAR\s+LAMPIRAN/m, /^DAFTAR\s+SINGKATAN/m, /^PENJELASAN\s+UMUM/m,
     /^BAB\s+[I1]/m, /^LAMPIRAN/m]
  );
  if (!section) return [];
  
  const lines = section.split('\n');
  const merged = joinMultilineEntries(lines);
  
  const entries = [];
  const seen = new Set();
  
  for (const line of merged) {
    if (isEnglishLine(line)) continue;
    if (isNoiseLine(line)) continue;
    
    const parsed = parseNumberedEntry(line);
    if (parsed) {
      const key = `FIG|${parsed.num}|${parsed.title}`;
      if (!seen.has(key.toLowerCase())) {
        seen.add(key.toLowerCase());
        entries.push(key);
      }
    }
  }
  
  return entries;
}

/**
 * Parse DAFTAR LAMPIRAN section.
 */
function parseDaftarLampiran(content) {
  const section = extractSection(content,
    [/^DAFTAR\s+LAMPIRAN/m],
    [/^DAFTAR\s+SINGKATAN/m, /^PENJELASAN\s+UMUM/m, /^BAB\s+[I1]/m]
  );
  if (!section) return [];
  
  const lines = section.split('\n');
  const merged = joinMultilineEntries(lines);
  
  const entries = [];
  const seen = new Set();
  
  for (const line of merged) {
    if (isEnglishLine(line)) continue;
    if (isNoiseLine(line)) continue;
    
    const parsed = parseNumberedEntry(line);
    if (parsed) {
      const key = `APP|${parsed.num}|${parsed.title}`;
      if (!seen.has(key.toLowerCase())) {
        seen.add(key.toLowerCase());
        entries.push(key);
      }
    }
  }
  
  return entries;
}

/**
 * Extract inline table references from content body.
 * For docs without a formal DAFTAR TABEL section.
 */
function extractInlineTables(content) {
  const entries = [];
  const seen = new Set();
  const contentStr = String(content || '');
  
  const re = /Tabel\s+(\d+(?:\.\d+){0,3})[.\s]+([^\n]{5,150})/gi;
  let match;
  while ((match = re.exec(contentStr)) !== null) {
    let title = match[2].trim();
    title = title.replace(/\s*[.\s…·]{3,}\s*\d+\s*$/, '').trim();
    
    if (title.length < 5) continue;
    if (/^(menunjukkan|menggambarkan|menyajikan|memperlihatkan|berikut|di\s|pada\s|merupakan|adalah|dapat\s|terlihat|menjelaskan|di\s*atas|di\s*bawah|ini\s)/i.test(title)) continue;
    
    const key = `TBL|${match[1]}|${title}`;
    if (!seen.has(key.toLowerCase())) {
      seen.add(key.toLowerCase());
      entries.push(key);
    }
  }
  
  return entries;
}

/**
 * Extract BAB/Chapter headers from content body.
 */
function extractInlineChapters(content) {
  const entries = [];
  const seen = new Set();
  const lines = String(content || '').split('\n');
  
  for (const rawLine of lines) {
    const line = rawLine.trim();
    
    const babMatch = line.match(/^BAB\s+([IVX\d]+)\s+(.{4,80})/i);
    if (babMatch) {
      let title = babMatch[2].trim();
      const slashIdx = title.search(/\s*\/\s*[A-Z]{2}/);
      if (slashIdx > 0) title = title.substring(0, slashIdx).trim();
      const key = `BAB|${babMatch[1]}|${title}`;
      if (!seen.has(key.toLowerCase())) {
        seen.add(key.toLowerCase());
        entries.push(key);
      }
    }
  }
  
  return entries;
}

/**
 * Main extraction: combines all section parsers.
 * Returns pipe-delimited indicator index string or null.
 */
function extractIndicatorIndex(content, category) {
  if (!content || content.length < 500) return null;
  
  const allEntries = [];
  const addedKeys = new Set();
  
  function addEntries(entries) {
    for (const entry of entries) {
      const lower = entry.toLowerCase();
      if (!addedKeys.has(lower)) {
        addedKeys.add(lower);
        allEntries.push(entry);
      }
    }
  }
  
  const daftarTabel = parseDaftarTabel(content);
  addEntries(daftarTabel);
  
  const daftarIsi = parseDaftarIsi(content);
  addEntries(daftarIsi);
  
  const daftarGambar = parseDaftarGambar(content);
  addEntries(daftarGambar);
  
  const daftarLampiran = parseDaftarLampiran(content);
  addEntries(daftarLampiran);
  
  if (daftarTabel.length === 0) {
    const inlineTables = extractInlineTables(content);
    addEntries(inlineTables);
  }
  
  if (daftarIsi.length === 0) {
    const inlineChapters = extractInlineChapters(content);
    addEntries(inlineChapters);
  }
  
  if (allEntries.length === 0) return null;
  
  // Post-process: strip remaining English fragments from entry titles
  const cleaned = allEntries.map(entry => {
    const parts = entry.split('|');
    if (parts.length < 3) return entry;
    const type = parts[0];
    const num = parts[1];
    let title = parts.slice(2).join('|');
    
    // Strip duplicate year ranges: "2019–2024 2019–2024" → "2019–2024"
    title = title.replace(/(\d{4}[–\-]\d{4})\s+\1/g, '$1');
    
    // Strip English text that got joined from multiline (e.g., "...2024 Actual Provincial...")
    // Pattern: Indonesian text ending with year, then English text
    title = title.replace(/(\d{4})\s+(?:Actual|Summary|Number|Percentage|Distribution|Rate|Average|Table|Figure|Population|Ratio|Index|Area|Total|Gross|Human|Consumer|Poverty|Life|Gender|School|Health|Social|Government|Revenue|Export|Import|Production|Tourism|Hotel|Length|Banking|Expenditure|Trade|Regional|Provincial|Municipal|Regency|Star|Non|Visitor|Guest|Room|Occupancy|Village|Growth|Volume|Value|Implicit|Fuel|Dwelling|Ownership|Floor|Drinking|Electricity|Climate|By |Of |In |The |And |Per |Source |Based |According |Harvested|Paddy|Rice|Horticulture|Livestock|Fish|Mining|Manufacturing|Transportation|Communication|Cooperation|Domestic|Foreign|Comparison|Weather|Meteorolog)\b.*/i, '$1');
    
    // Strip year followed by " Uta" (truncated province name from multiline)
    title = title.replace(/(\d{4})\s+Uta\b.*$/i, '$1');
    
    // Strip "ENGLISH CAPS" after Indonesian CAPS: "KEADAAN GEOGRAFI GEOGRAPHY CONDITION" → "KEADAAN GEOGRAFI"
    if (title === title.toUpperCase() && title.length > 10) {
      const words = title.split(/\s+/);
      const cutIdx = words.findIndex((w, i) => i > 0 && /^(GEOGRAPHY|CONDITION|ADMINISTRATIVE|AREA|REGION|EMPLOYMENT|LABOR|POPULATION|EDUCATION|HEALTH|SOCIAL|WELFARE|AGRICULTURE|FORESTRY|FISHERY|MINING|MANUFACTURING|TOURISM|TRANSPORTATION|BANKING|TRADE|EXPENDITURE|CONSUMPTION|PRICE|REVENUE|PRODUCT|INCOME|DEVELOPMENT|POVERTY|ENVIRONMENT|AND|THE|OF|IN|BY|FOR|FROM|WITH|FOOD|CROPS|HORTICULTURE|LIVESTOCK|ENERGY|COMMUNICATION|COOPERATION)$/i.test(w));
      if (cutIdx > 0) {
        title = words.slice(0, cutIdx).join(' ');
      }
    }
    
    // Strip "/English Text" pattern: "...2024 /Subdistricts by Regency..." → "...2024"
    title = title.replace(/\s*\/\s*(?:Subdistrict|Number|Percentage|Distribution|Growth|Volume|Value|By |Of |In |The |And |Per |Star |Non |Room |Guest |Visitor |Tourism |Hotel |Actual |Summary |Harvested|Paddy|Rice)\w*.*/i, '');
    
    // Strip trailing English fragments
    title = title.replace(/\s+(?:Agency|Station|Province|Regency|Municipality)\s+(?:Station|in|of|by)\b.*/i, '');
    
    // Strip trailing " Utara Province..." pattern
    title = title.replace(/\s+Utara Province.*$/i, '');
    
    // Strip trailing "GRDP Growth Rate..." or other English
    title = title.replace(/\s+(?:GRDP|GDP|Growth Rate|at Constant)\b.*$/i, '');
    
    // Strip embedded English from multiline join: "...di Actuale Revenues and..."
    title = title.replace(/\s+(?:Actual|Actuale|Revenues|Expenditures|Summary|Previous|Characteristic|Classification)\s+(?:and|of|by|in|the)\b.*/i, '');
    
    // Strip trailing "Previous Week..." pattern
    title = title.replace(/(\d{4})\s+(?:Previous|Current|Week|During|Based)\b.*/i, '$1');
    
    // Clean up trailing punctuation/whitespace
    title = title.replace(/[\s,/]+$/, '').trim();
    
    // Validate: skip entries with invalid numbers (like FIG|2010 from bad parse)
    if (type === 'FIG' && /^\d{4}$/.test(num)) return null;
    // Skip entries where the "number" is just a year (bad parse)
    if (/^\d{4}$/.test(num) && !/\d{4}\.\d/.test(num)) return null;
    // Skip titles that are just English fragments
    if (/^(and|or|the|of|in|by|at|to|for)\s/i.test(title)) return null;
    if (title.length < 3) return null;
    
    return `${type}|${num}|${title}`;
  }).filter(Boolean);
  
  let result = cleaned.join('\n');
  // Generous limit — MEDIUMTEXT column can hold 16MB
  if (result.length > 65000) {
    const limited = cleaned.slice(0, Math.floor(cleaned.length * 65000 / result.length));
    result = limited.join('\n');
  }
  
  return result;
}

// ── Main Script ───────────────────────────────────────────────────────────

async function main() {
  console.log('=== Populate Indicator Index ===');
  console.log('Mode:', DRY_RUN ? 'DRY RUN' : 'LIVE');
  if (SINGLE_ID) console.log('Single doc:', SINGLE_ID);
  console.log();
  
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'project_data_strategis',
  });
  
  let query = `SELECT id, title, category, content 
               FROM knowledge_base 
               WHERE parent_id IS NULL`;
  const params = [];
  
  if (SINGLE_ID) {
    query += ' AND id = ?';
    params.push(parseInt(SINGLE_ID));
  }
  
  query += ' ORDER BY id';
  
  console.log('Fetching parent documents...');
  const [docs] = await conn.query(query, params);
  console.log(`Found ${docs.length} parent documents\n`);
  
  const stats = {
    total: docs.length,
    extracted: 0,
    skipped: 0,
    errors: 0,
    byCategory: {},
    bySection: { TOC: 0, TBL: 0, FIG: 0, APP: 0, BAB: 0 },
    totalEntries: 0,
    maxEntries: 0,
    maxEntriesDoc: null,
  };
  
  for (const doc of docs) {
    try {
      const index = extractIndicatorIndex(doc.content, doc.category);
      
      if (!index) {
        stats.skipped++;
        continue;
      }
      
      const entryCount = index.split('\n').length;
      stats.extracted++;
      stats.totalEntries += entryCount;
      
      if (entryCount > stats.maxEntries) {
        stats.maxEntries = entryCount;
        stats.maxEntriesDoc = { id: doc.id, title: doc.title };
      }
      
      stats.byCategory[doc.category] = (stats.byCategory[doc.category] || 0) + 1;
      
      for (const line of index.split('\n')) {
        const type = line.split('|')[0];
        if (stats.bySection[type] !== undefined) {
          stats.bySection[type]++;
        }
      }
      
      if (DRY_RUN) {
        if (SINGLE_ID || docs.length <= 5) {
          console.log(`[${doc.id}] ${doc.title.substring(0, 70)}`);
          console.log(`  Category: ${doc.category}, Content: ${(doc.content?.length || 0).toLocaleString()} chars`);
          console.log(`  Entries: ${entryCount}`);
          console.log(`  Preview (first 20):`);
          index.split('\n').slice(0, 20).forEach(e => console.log(`    ${e}`));
          if (entryCount > 20) console.log(`    ... (${entryCount - 20} more)`);
          console.log();
        }
      } else {
        await conn.query('UPDATE knowledge_base SET indicator_index = ? WHERE id = ?', [index, doc.id]);
      }
    } catch (err) {
      stats.errors++;
      console.error(`[${doc.id}] Error:`, err.message);
    }
  }
  
  const avgEntries = stats.extracted > 0 ? Math.round(stats.totalEntries / stats.extracted) : 0;
  
  if (!DRY_RUN && !SINGLE_ID) {
    console.log('\nPropagating indicator_index to chunks...');
    const [result] = await conn.query(`
      UPDATE knowledge_base c
      INNER JOIN knowledge_base p ON c.parent_id = p.id
      SET c.indicator_index = p.indicator_index
      WHERE c.parent_id IS NOT NULL
        AND p.indicator_index IS NOT NULL
    `);
    console.log(`Updated ${result.affectedRows} chunks`);
  }
  
  console.log('\n=== Results ===');
  console.log(`Total docs:       ${stats.total}`);
  console.log(`Extracted:        ${stats.extracted}`);
  console.log(`Skipped (empty):  ${stats.skipped}`);
  console.log(`Errors:           ${stats.errors}`);
  console.log(`Total entries:    ${stats.totalEntries}`);
  console.log(`Avg entries/doc:  ${avgEntries}`);
  console.log(`Max entries:      ${stats.maxEntries} (${stats.maxEntriesDoc?.title || 'N/A'})`);
  console.log(`\nBy category:`);
  Object.entries(stats.byCategory).forEach(([k, v]) => console.log(`  ${k}: ${v} docs`));
  console.log(`\nEntry types:`);
  Object.entries(stats.bySection).forEach(([k, v]) => console.log(`  ${k}: ${v} entries`));
  
  await conn.end();
  console.log('\nDone!');
}

// Only run main() if executed directly (not required as module)
if (require.main === module) {
  main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}

module.exports = { extractIndicatorIndex, parseDaftarTabel, parseDaftarIsi, parseDaftarGambar, parseDaftarLampiran, extractInlineTables, extractInlineChapters };
