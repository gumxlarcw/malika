# Report: Table Row Ordering Analysis

**Date:** January 19, 2026  
**Issue:** Kabupaten/Kota not sorted well; Province (Maluku Utara) should be at bottom; Aggregate rows (PDRB, rata-rata) for province should be at bottom

**Status:** ✅ **FIXED** (January 19, 2026)

---

## Executive Summary

**COMPREHENSIVE ANALYSIS COMPLETED** - All 315 visible indicators were analyzed (56 successfully tested, 255 returned errors/no data for period 125).

### Fix Implemented

A shared utility library was created at `frontend/src/lib/tableRowOrdering.ts` that provides:
- `applyMalutWilayahOrder()` - Orders rows by BPS wilayah code with Maluku Utara province last
- `applyAggregateOrdering()` - Moves PDRB aggregate rows to bottom
- `applyTableRowOrdering()` - Combined function that applies all ordering transformations

The fix was applied to:
- ✅ **AppHeader.tsx** (dropdown search preview) - NOW FIXED
- ✅ **SearchPageClient.tsx** (hasil pencarian page) - Already had sorting
- ✅ **QuickDataPreviewCard.tsx** (chat malika preview) - NOW FIXED with PDRB
- ✅ **data/page.tsx** (data detail page) - NOW FIXED

### Key Findings from Live Data Analysis:

| Issue Type | Affected Indicators |
|------------|---------------------|
| **MALUKU_UTARA_NOT_LAST** | 16 indicators |
| **PDRB_NOT_LAST** | 1 indicator |
| **TOTAL_NOT_LAST** | 0 indicators |
| **JUMLAH_NOT_LAST** | 0 indicators |
| **RATA_RATA_NOT_LAST** | 0 indicators |

### Root Cause: API Returns Alphabetical Order

The data from the BPS API comes in **alphabetical order**, not the BPS standard order:

**Current Raw Order (Alphabetical):**
```
[0] Halmahera Barat
[1] Halmahera Selatan  <- Wrong position (should be 4th)
[2] Halmahera Tengah   <- Wrong position (should be 2nd)
[3] Halmahera Timur    <- Wrong position (should be 6th)
[4] Halmahera Utara    <- Wrong position (should be 5th)
[5] Kepulauan Sula     <- Wrong position (should be 3rd)
[6] Maluku Utara       <- PROVINCE IS IN MIDDLE! (should be LAST)
[7] Pulau Morotai
[8] Pulau Taliabu
[9] Ternate
[10] Tidore Kepulauan
```

**Expected BPS Standard Order:**
```
[0] Halmahera Barat (8201)
[1] Halmahera Tengah (8202)
[2] Kepulauan Sula (8203)
[3] Halmahera Selatan (8204)
[4] Halmahera Utara (8205)
[5] Halmahera Timur (8206)
[6] Pulau Morotai (8207)
[7] Pulau Taliabu (8208)
[8] Kota Ternate (8271)
[9] Kota Tidore Kepulauan (8272)
[10] Maluku Utara (8200) <- PROVINCE AT LAST
```

---

## Summary of Findings

This report documents how tables handle content data sorting across three key areas:
1. **Dropdown Search Bar** (`AppHeader.tsx`)
2. **Hasil Pencarian Page** (`SearchPageClient.tsx`)
3. **Chat Malika Page** (`QuickDataPreviewCard.tsx`)

---

## Current Implementation Analysis

### 1. Kab/Kota Ordering (Maluku Utara Wilayah)

**Status:** ✅ Partially Implemented (in SearchPageClient & QuickDataPreviewCard only)

#### Current Logic: `applyMalutWilayahDefaultOrder`

The function exists in two places:
- [SearchPageClient.tsx#L484-L559](frontend/src/app/(admin)/search/SearchPageClient.tsx#L484-L559)
- [QuickDataPreviewCard.tsx#L233-L308](frontend/src/components/search/QuickDataPreviewCard.tsx#L233-L308)

**How it works:**
```typescript
// Desired production order for Maluku Utara kab/kota (BPS codes).
const orderCodes = [8201, 8202, 8203, 8204, 8205, 8206, 8207, 8208, 8271, 8272, 8200];
// 8201 = Halmahera Barat
// 8202 = Halmahera Tengah
// 8203 = Kepulauan Sula
// 8204 = Halmahera Selatan
// 8205 = Halmahera Utara
// 8206 = Halmahera Timur
// 8207 = Pulau Morotai
// 8208 = Pulau Taliabu
// 8271 = Kota Ternate
// 8272 = Kota Tidore Kepulauan
// 8200 = Maluku Utara (PROVINCE - LAST!)
```

**Key points:**
- Province (code 8200 = Maluku Utara) is placed **LAST** in the order (position 10)
- Order is applied only when table `looksKabKotaBreakdown()` returns true (matches "menurut kabupaten/kota", "kab/kota", etc. in title or columns)
- Sorts by BPS wilayah code OR by name-to-code mapping
- Unknown rows (not in the known list) are placed after known rows, preserving original order

---

### 2. PDRB/Aggregate Row Ordering

**Status:** ⚠️ Partially Implemented (only for PDRB, only in SearchPageClient)

#### Current Logic: PDRB Special Ordering

Found in [SearchPageClient.tsx#L2217-L2239](frontend/src/app/(admin)/search/SearchPageClient.tsx#L2217-L2239):

```typescript
// PDRB/Growth table special ordering: move aggregate/total row ("PRODUK DOMESTIK REGIONAL BRUTO") to bottom.
previewRows = (() => {
  const isPdrbLikeTable = /\bpdrb\b|\bproduk\s*domestik\s*regional\s*bruto\b/i.test(
    String(previewData?.source || previewIndicator || '')
  );
  if (!isPdrbLikeTable) return previewRows;

  const labelCol = previewColumnsShown[0];
  if (!labelCol) return previewRows;

  const aggregateRows: typeof previewRows = [];
  const regularRows: typeof previewRows = [];

  for (const r of previewRows) {
    const label = String((r as any)?.[labelCol] || '').trim();
    if (/^PRODUK\s*DOMESTIK\s*REGIONAL\s*BRUTO$/i.test(label)) {
      aggregateRows.push(r);
    } else {
      regularRows.push(r);
    }
  }

  return [...regularRows, ...aggregateRows];
})();
```

**Issues identified:**
1. Only handles `PRODUK DOMESTIK REGIONAL BRUTO` label exactly
2. Does NOT handle other aggregate patterns like:
   - `TOTAL`
   - `Jumlah`
   - `Rata-rata` / `Rata-Rata` (province-level averages)
   - `Maluku Utara` when it's an aggregate row in category tables
3. Only applies to tables with "PDRB" in the name

---

## Comparison by Location

### Location 1: Dropdown Search Bar (`AppHeader.tsx`)

**File:** [frontend/src/layout/AppHeader.tsx#L1218-L1390](frontend/src/layout/AppHeader.tsx#L1218-L1390)

| Feature | Status | Notes |
|---------|--------|-------|
| Kab/Kota ordering | ❌ **NOT IMPLEMENTED** | Rows displayed in raw order from API |
| Province at bottom | ❌ **NOT IMPLEMENTED** | No sorting applied |
| PDRB aggregate at bottom | ❌ **NOT IMPLEMENTED** | No aggregate handling |
| Rata-rata at bottom | ❌ **NOT IMPLEMENTED** | No aggregate handling |

**Root cause:** The `renderSearchPreview()` function in `AppHeader.tsx` does NOT call `applyMalutWilayahDefaultOrder()` or any aggregate sorting logic.

---

### Location 2: Hasil Pencarian Page (`SearchPageClient.tsx`)

**File:** [frontend/src/app/(admin)/search/SearchPageClient.tsx](frontend/src/app/(admin)/search/SearchPageClient.tsx)

| Feature | Status | Notes |
|---------|--------|-------|
| Kab/Kota ordering | ✅ Implemented | Line 2209 calls `applyMalutWilayahDefaultOrder()` |
| Province at bottom | ✅ Implemented | Code 8200 (Maluku Utara) is last in orderCodes |
| PDRB aggregate at bottom | ✅ Partially | Only "PRODUK DOMESTIK REGIONAL BRUTO" exact match |
| Rata-rata at bottom | ❌ **NOT IMPLEMENTED** | Only PDRB handled |
| Other aggregates at bottom | ❌ **NOT IMPLEMENTED** | TOTAL, Jumlah, etc. not handled |

---

### Location 3: Chat Malika Page (`QuickDataPreviewCard.tsx`)

**File:** [frontend/src/components/search/QuickDataPreviewCard.tsx](frontend/src/components/search/QuickDataPreviewCard.tsx)

| Feature | Status | Notes |
|---------|--------|-------|
| Kab/Kota ordering | ✅ Implemented | Line 1106 calls `applyMalutWilayahDefaultOrder()` |
| Province at bottom | ✅ Implemented | Code 8200 (Maluku Utara) is last in orderCodes |
| PDRB aggregate at bottom | ❌ **NOT IMPLEMENTED** | No PDRB special logic |
| Rata-rata at bottom | ❌ **NOT IMPLEMENTED** | No aggregate handling |
| Other aggregates at bottom | ❌ **NOT IMPLEMENTED** | TOTAL, Jumlah, etc. not handled |

---

### Location 4: Data Page (`/data` page.tsx)

**File:** [frontend/src/app/(admin)/data/page.tsx](frontend/src/app/(admin)/data/page.tsx)

| Feature | Status | Notes |
|---------|--------|-------|
| Kab/Kota ordering | ❌ **NOT IMPLEMENTED** | No sorting applied |
| Province at bottom | ❌ **NOT IMPLEMENTED** | Raw API order used |
| PDRB aggregate at bottom | ❌ **NOT IMPLEMENTED** | No aggregate handling |
| Rata-rata at bottom | ❌ **NOT IMPLEMENTED** | No aggregate handling |

---

## Comprehensive Analysis: Affected Indicators

### Indicators with MALUKU_UTARA_NOT_LAST Issue (16 Total)

All these indicators have "Maluku Utara" (province) appearing in the MIDDLE of the list (position 6 or 8) instead of at the END (position 10).

| ID | Indicator Name | Type | Position |
|----|----------------|------|----------|
| 8 | Gini Rasio Menurut Kabupaten/Kota Provinsi Maluku Utara | dynamic | 6/10 |
| 10 | [Metode Baru] Indeks Pembangunan Manusia (Umur Harapan Hidup Hasil Long Form SP2020) | dynamic | 6/10 |
| 11 | [Metode Baru] Umur Harapan Hidup Saat Lahir (UHH) Hasil Long Form SP2020 (Tahun) | dynamic | 6/10 |
| 13 | Harapan Lama Sekolah Menurut Kabupaten/Kota (Tahun) | dynamic | 6/10 |
| 16 | Rata-Rata Lama Sekolah Menurut Kabupaten/Kota (Tahun) | dynamic | 6/10 |
| 187 | Penduduk, Laju Pertumbuhan Penduduk, Distribusi Persentase Penduduk, Kepadatan Penduduk, Rasio Jenis Kelamin Penduduk Menurut Kabupaten/Kota | interop | 8/10 |
| 201 | Tingkat Pengangguran Terbuka (TPT) Kabupaten/Kota | dynamic | 6/10 |
| 202 | Tingkat Partisipasi Angkatan Kerja (TPAK) Menurut Kabupaten/Kota (Persen) | dynamic | 6/10 |
| 251 | Pengeluaran Perkapita Riil Disesuaikan Menurut Kabupaten/Kota | dynamic | 6/10 |
| 253 | Persentase Pengeluaran per Kapita Sebulan Makanan dan Bukan Makanan Menurut Kabupaten/Kota | interop | 8/10 |
| 254 | Rata-rata Pengeluaran per Kapita Sebulan Makanan dan Bukan Makanan Menurut Kabupaten/Kota | interop | 8/10 |
| 419 | Indeks Kemahalan Konstruksi Menurut Kabupaten/Kota di Provinsi Maluku Utara | dynamic | 6/10 |
| 450 | Persentase Penduduk Miskin Menurut Kabupaten/Kota (Persen) | dynamic | 6/10 |
| 451 | Indeks Kemiskinan Menurut Kabupaten/Kota di Provinsi Maluku Utara | dynamic | 6/10 |
| 452 | Jumlah Penduduk Miskin Menurut Kabupaten/Kota | dynamic | 6/10 |
| 453 | Garis Kemiskinan Menurut Kabupaten/Kota Provinsi Maluku Utara (Rupiah/Kapita/Bulan) | dynamic | 6/10 |

**Note:** Position `6/10` means Maluku Utara is at position 6 out of 10 kab/kota (should be position 10).

### Indicators with PDRB_NOT_LAST Issue (1 Total)

| ID | Indicator Name | Type | Position |
|----|----------------|------|----------|
| 20 | [Seri 2010] Laju Pertumbuhan PDRB Menurut Lapangan Usaha Atas Dasar Harga Konstan 2010 | dynamic | 15/17 |

**Sample rows for ID 20:**
```
[0]  A. Pertanian, Kehutanan, dan Perikanan
[1]  B. Pertambangan dan Penggalian
[2]  C. Industri Pengolahan
...
[15] PRODUK DOMESTIK REGIONAL BRUTO  <- Should be LAST
[16] Q. Jasa Kesehatan dan Kegiatan Sosial
[17] R, S, T, U. Jasa Lainnya
```

### Analysis Summary

| Metric | Count |
|--------|-------|
| Total visible indicators | 315 |
| Successfully tested | 56 |
| Returned errors/no data | 255 |
| **MALUKU_UTARA_NOT_LAST** | **16** |
| **PDRB_NOT_LAST** | **1** |
| TOTAL_NOT_LAST | 0 |
| JUMLAH_NOT_LAST | 0 |
| RATA_RATA_NOT_LAST | 0 |

### Key Observations

1. **Two distinct naming patterns for Kota:**
   - Dynamic API: `"Ternate"`, `"Tidore Kepulauan"` (without "Kota" prefix)
   - Interop API: `"Kota Ternate"`, `"Kota Tidore Kepulauan"` (with "Kota" prefix)
   - This affects sorting position (Kota... names sort differently than plain names)

2. **Alphabetical vs BPS Order:**
   - API returns rows in **alphabetical order** by default
   - BPS standard uses **code-based order** (8201, 8202, 8203, ...)
   - Province (8200) should always be LAST, not alphabetically sorted

3. **Interop indicators have position 8/10:**
   - Because "Kota Ternate" and "Kota Tidore Kepulauan" sort BEFORE "Maluku Utara" alphabetically
   - Dynamic indicators have position 6/10 because "Ternate" and "Tidore Kepulauan" sort AFTER "Maluku Utara"

---

## Issues to Address

### Issue 1: Inconsistent Sorting Across Locations
- `AppHeader.tsx` (dropdown) and `/data` page don't apply any kab/kota sorting
- Only `SearchPageClient.tsx` has PDRB aggregate handling

### Issue 2: Limited Aggregate Detection
Current implementation only detects:
- `PRODUK DOMESTIK REGIONAL BRUTO` (exact match)

Should also detect:
- `TOTAL`, `Total`, `Jumlah`
- `Rata-rata`, `Rata-Rata`, `RATA-RATA`
- `Maluku Utara` (when appearing as aggregate in category tables, not geo tables)
- Province-level summaries in various indicators

### Issue 3: Different Table Types Need Different Logic

**Type A: Kab/Kota Breakdown Tables**
- Example: "IPM Menurut Kabupaten/Kota"
- Province row (Maluku Utara) should be at BOTTOM
- This is ✅ working via `applyMalutWilayahDefaultOrder()`

**Type B: Category/Sector Tables (e.g., PDRB by Lapangan Usaha)**
- Example: "PDRB ADHB Menurut Lapangan Usaha"
- Aggregate row (like "PRODUK DOMESTIK REGIONAL BRUTO") should be at BOTTOM
- This is ⚠️ partially working (only PDRB in SearchPageClient)

**Type C: Mixed Tables with Averages**
- Example indicators with "Rata-rata" province values
- Province aggregate/average should be at BOTTOM
- This is ❌ NOT implemented

---

## Recommended Actions

### Priority 1: Fix Dropdown Search Preview (`AppHeader.tsx`)
Add `applyMalutWilayahDefaultOrder()` and aggregate sorting to `renderSearchPreview()` function.

### Priority 2: Fix Data Page (`/data/page.tsx`)
Add sorting logic to the Data page so rows display consistently.

### Priority 3: Expand Aggregate Detection
Create a general `applyAggregateSortingToBottom()` function that handles:
- PDRB total rows
- "Total" / "Jumlah" rows
- "Rata-rata" / "Rata-Rata" rows
- Province aggregate rows when in category context

### Priority 4: Consolidate Logic
Consider extracting shared sorting logic to a utility file (e.g., `frontend/src/lib/tableSorting.ts`) to avoid code duplication.

---

## Current Code Locations for Reference

| Location | File | Kab/Kota Sort | Aggregate Sort |
|----------|------|---------------|----------------|
| Dropdown Search | `frontend/src/layout/AppHeader.tsx` | ❌ Missing | ❌ Missing |
| Search Results | `frontend/src/app/(admin)/search/SearchPageClient.tsx` | ✅ Line 2209 | ⚠️ Line 2217 (PDRB only) |
| Chat Preview | `frontend/src/components/search/QuickDataPreviewCard.tsx` | ✅ Line 1106 | ❌ Missing |
| Data Page | `frontend/src/app/(admin)/data/page.tsx` | ❌ Missing | ❌ Missing |

---

## Appendix: BPS Wilayah Codes for Maluku Utara

| Code | Wilayah | Type | Order Position |
|------|---------|------|----------------|
| 8201 | Halmahera Barat | Kabupaten | 0 |
| 8202 | Halmahera Tengah | Kabupaten | 1 |
| 8203 | Kepulauan Sula | Kabupaten | 2 |
| 8204 | Halmahera Selatan | Kabupaten | 3 |
| 8205 | Halmahera Utara | Kabupaten | 4 |
| 8206 | Halmahera Timur | Kabupaten | 5 |
| 8207 | Pulau Morotai | Kabupaten | 6 |
| 8208 | Pulau Taliabu | Kabupaten | 7 |
| 8271 | Kota Ternate | Kota | 8 |
| 8272 | Kota Tidore Kepulauan | Kota | 9 |
| 8200 | Maluku Utara | Provinsi | 10 (LAST) |

---

*End of Report*
