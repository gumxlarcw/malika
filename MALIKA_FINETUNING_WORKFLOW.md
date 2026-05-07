# MALIKA Fine-Tuning Workflow

## Overview

Dokumen ini menjelaskan proses iteratif untuk memperbaiki kualitas MALIKA chat assistant melalui:
1. **Analisis Error** - Mengidentifikasi masalah dari chat logs
2. **Dokumentasi Issue** - Mencatat detail masalah untuk AI analysis
3. **Fix Implementation** - Implementasi perbaikan di codebase
4. **Verification** - Memastikan perbaikan berhasil
5. **Mark Resolved** - Update status di admin panel

---

## Workflow Berulang

### Step 1: Collect Issues (Admin Panel)

1. Buka Admin Panel → Error Analysis (`/backend/malika-analysis`)
2. Set **cutoff date** ke tanggal terakhir analisis sebelumnya
3. Filter flags dengan status **pending**
4. Export atau catat issues untuk analisis

### Step 2: Document for AI Analysis

Format standar untuk menjelaskan issue ke Claude:

```
## Issue Report: [ID]

**Date**: [tanggal flag dibuat]
**Thread ID**: [thread_id]
**Severity**: [low/medium/high/critical]
**Type**: [hallucination/wrong_data/incomplete/context_lost/irrelevant]

### User Query
[query lengkap dari user]

### Expected Behavior
[apa yang seharusnya terjadi]

### Actual Behavior
[apa yang terjadi / response MALIKA]

### Context
- Datasource candidates: [list id dan nama]
- Selected datasource: [id dan nama]
- Period/filters applied: [detail]

### Root Cause Analysis
[analisis awal jika ada]
```

### Step 3: AI Analysis (Claude)

Setelah menerima issue report, Claude akan:

1. **Identify Pattern** - Apakah ini masalah berulang?
2. **Locate Code** - Cari file yang perlu diubah
3. **Propose Fix** - Jelaskan solusi yang diusulkan
4. **Implement** - Lakukan perubahan code
5. **Test** - Verifikasi dengan query test

### Step 4: Categories of Fixes

| Category | File(s) to Modify | Example Issue |
|----------|-------------------|---------------|
| **Scoring/Ranking** | `datasourceSearch.service.js` | Wrong datasource selected |
| **Intent Detection** | `queryFastPath.service.js`, `geoInference.service.js` | Geo/period not detected |
| **LLM Prompt** | `queryBuilder.service.js` | Wrong interpretation |
| **Response Format** | `responseFormatter.service.js` | Bad formatting |
| **Vector Search** | `embedding.service.js`, aliases in DB | Low relevance results |
| **Data Processing** | `*processor.js` files | Wrong data format || **Institutional Knowledge** | `streaming.service.js`, `chat.service.js` | Cannot answer BPS info questions |
### Step 5: Verification Commands

```bash
# Test search ranking
curl -s "http://localhost:5000/search/intent?q=YOUR_QUERY&includeCandidates=1&limit=10" | jq '.candidates[:5]'

# Test chat response (if API available)
curl -X POST "http://localhost:5000/chat/message" \
  -H "Content-Type: application/json" \
  -d '{"thread_id":"test","message":"YOUR_QUERY"}'
```

### Step 6: Update Flag Status

Setelah fix verified, update status di admin panel:
- `reviewed` - Sudah dianalisis, belum di-fix
- `fixed` - Sudah di-fix dan diverifikasi
- `training_added` - Ditambahkan ke training data/patterns
- `ignored` - Bukan bug / expected behavior

---

## Cutoff Date System

### Concept

- **Cutoff Date**: Tanggal terakhir analisis dilakukan
- **Handled**: Flags dengan `updated_at > cutoff` DAN status bukan `pending`
- **Pending**: Flags dengan status `pending` (belum dianalisis)

### Workflow dengan Cutoff

1. **Before Analysis Session**:
   - Set cutoff date = sekarang
   - Filter: `created_at > cutoff` untuk melihat issues baru

2. **During Analysis**:
   - Process each flag
   - Update status dan notes

3. **After Analysis Session**:
   - Simpan cutoff date untuk session berikutnya
   - Generate report: X flags resolved, Y patterns created

---

## Checkpoint Format

Setiap analysis session harus menghasilkan checkpoint file:

```markdown
# CHECKPOINT_MALIKA_ANALYSIS_YYYY-MM-DD.md

## Session Info
- **Date**: YYYY-MM-DD HH:mm
- **Analyst**: [Human/AI]
- **Previous Cutoff**: YYYY-MM-DD HH:mm
- **New Cutoff**: YYYY-MM-DD HH:mm

## Issues Analyzed
| Flag ID | Type | Status Before | Status After | Fix Applied |
|---------|------|--------------|--------------|-------------|
| 123 | wrong_data | pending | fixed | Scoring adjustment |

## Code Changes
| File | Change Summary |
|------|----------------|
| datasourceSearch.service.js | Added primary vs derived penalty |

## Patterns Created/Updated
| Pattern Name | Trigger Keywords | Fix Type |
|--------------|------------------|----------|
| PDRB Primary Preference | pdrb, pertumbuhan | scoring_adjustment |

## Pending Items
- [ ] Issue #456: Needs more investigation
- [ ] Pattern for geo detection improvement

## Next Steps
1. Monitor for recurrence
2. Consider additional patterns for X
```

---

## Quick Reference: Common Fixes

### 1. Wrong Datasource Selected

**Symptom**: User asks for X, MALIKA returns Y
**Check**: `datasourceSearch.service.js` scoring logic
**Fix Types**:
- Add penalty/bonus in scoring
- Add aliases to datasource
- Update pattern in chat_error_patterns

### 2. Missing Period/Year

**Symptom**: MALIKA says "data tidak tersedia" but data exists
**Check**: `yearInference.service.js`, `queryBuilder.service.js`
**Fix Types**:
- Improve year extraction regex
- Add default year fallback

### 3. Wrong Geo Filter

**Symptom**: Shows wrong kabupaten/kota data
**Check**: `geoInference.service.js`, `frontend/src/lib/geoIntent.ts`
**Fix Types**:
- Add geo synonyms
- Improve matching logic

### 4. Hallucination

**Symptom**: MALIKA invents data that doesn't exist
**Check**: LLM prompt in `queryBuilder.service.js`
**Fix Types**:
- Strengthen guardrails in prompt
- Add validation before response

---

## API Endpoints untuk Analysis

### Get Flags with Filters
```
GET /error-learning/flags?status=pending&severity=high
```

### Update Flag Status
```
PATCH /error-learning/flags/:id
Body: { "resolution_status": "fixed", "correction_notes": "..." }
```

### Get Stats
```
GET /error-learning/stats
```

### Export for Analysis
```
GET /error-learning/export?from=YYYY-MM-DD&to=YYYY-MM-DD
```

---

## Automated Pattern Matching

Patterns di `chat_error_patterns` table digunakan untuk:
1. Auto-detect known issues
2. Apply pre-defined fixes
3. Track occurrence frequency

### Pattern Structure
```json
{
  "pattern_name": "PDRB Primary Preference",
  "pattern_type": "scoring",
  "error_description": "Derived PDRB indicators selected instead of primary",
  "trigger_keywords": ["pdrb", "produk domestik"],
  "fix_type": "scoring_adjustment",
  "fix_content": "Add -12 penalty for derived indicators",
  "is_active": true
}
```

---

## Version History

| Date | Author | Changes |
|------|--------|---------|
| 2026-01-21 | Claude Opus 4.5 | Initial workflow documentation |
