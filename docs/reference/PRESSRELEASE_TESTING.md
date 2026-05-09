## 🧪 TESTING GUIDE - PRESSRELEASE IMPLEMENTATION

### Prerequisites
- Backend running: `npm start` in `/backend`
- Admin UI running: `npm run dev` in `/backend/admin`
- Database synced (Sequelize will auto-sync)
- `BPS_API_KEY` set in `.env`

---

### Test 1: Database Verification

**Check DataSource Model:**
```bash
# Login to admin UI or use phpMyAdmin
# Verify data_sources table has updated type enum

# SQL query to check:
SHOW COLUMNS FROM data_sources WHERE FIELD='type';
# Should show: ENUM('static','dynamic','interop','exim','pressrelease')
```

✅ Expected: Type includes 'pressrelease'

---

### Test 2: Add Pressrelease Datasource

**Via Admin UI > Datasources:**
1. Click "+ New Datasource"
2. Fill form:
   - Name: "Press Release - Inflasi"
   - Type: **pressrelease** (dropdown should include it)
   - API URL: `https://webapi.bps.go.id/v1/api/list/model/pressrelease/domain/8200/page/{page}/keyword/{keyword}/key/YOUR_API_KEY/`
   - Period Key: `keyword` (optional, informational)
   - Visible: ✓
   - Status: ✓
3. Save

✅ Expected: Form accepts 'pressrelease' type without error

---

### Test 3: API Endpoint Direct Test

**Using curl or Postman:**

```bash
# Test endpoint (public, no auth)
curl "http://localhost:5000/pressrelease/5?keyword=inflasi"

# Expected Response (200 OK):
{
  "cached": false,
  "updated": true,
  "data": {
    "source": "Press Release - inflasi",
    "period": "2025-01-02 to 2025-12-01",
    "columns": [
      { "key": "brs_id", "label": "ID" },
      { "key": "title", "label": "Judul" },
      ...
    ],
    "data": [
      {
        "brs_id": 827,
        "title": "Pada November 2025 terjadi inflasi...",
        "rl_date": "2025-12-01",
        "abstract": "<p>Pada November 2025...</p>",
        "pdf_url": "https://webapi.bps.go.id/download.php?f=...",
        ...
      },
      ...
    ],
    "last_update": "2025-12-23T10:30:45.123Z"
  }
}
```

✅ Expected:
- Status: 200
- cached: false (first call)
- data.data: Array of press release items
- Each item has: title, rl_date, pdf_url, thumbnail_url

---

### Test 4: Cache Validation

**Second call should use cache:**

```bash
# Call same endpoint again
curl "http://localhost:5000/pressrelease/5?keyword=inflasi"

# Expected Response:
{
  "cached": true,      # ← NOW true
  "updated": false,    # ← updated: false
  "data": { ... same data ... }
}
```

✅ Expected:
- cached: true
- Response faster (no API calls)
- Data identical to first call

---

### Test 5: Admin UI - Cache Page

**Via Admin UI > Cache:**

1. Navigate to `/backend/cache` (or click Cache in sidebar)
2. **Datasource list loads:**
   - See "Press Release - Inflasi" in table
   - Can select it

3. **Click "Pilih" button:**
   - UI switches to "Dipilih"
   - **Keyword input field appears** (not period input)
   - Helper text: "Masukkan keyword (contoh: inflasi, ntp, ihk)"

4. **Enter keyword: "ntp"**
   - Click "Ambil & Preview Data"
   - Loading state shown

5. **Results appear:**
   - Table with columns: ID, Judul, Tanggal Rilis, Abstrak, Kategori, PDF, Slide, Thumbnail
   - Shows first 20 items
   - Status badge: "✓ Dari API" or "✓ Dari Cache"
   - Total count: "Total: 45 item"
   - Last update timestamp

6. **Links work:**
   - Click PDF link → opens in new tab
   - Click Slide link → opens in new tab

✅ Expected:
- Keyword input (not period)
- Table renders properly
- Links functional
- Cache status correct

---

### Test 6: Conditional UI Input

**Test Dynamic Datasource (for comparison):**

1. Select a "Dynamic" datasource
2. **Period input appears** (not keyword)
3. Helper text: "Format: YYYY-MM untuk monthly atau YYYY untuk yearly"
4. Enter period: "2025-12"
5. Click "Ambil & Preview Data"

✅ Expected:
- Different input field based on type
- Dynamic data loads correctly
- Existing functionality unaffected

---

### Test 7: Error Handling

**Test invalid keyword:**

```bash
curl "http://localhost:5000/pressrelease/5?keyword="
# Expected: 400 Bad Request
# Message: "Missing required parameter: keyword query parameter is required"
```

**Test non-existent source:**

```bash
curl "http://localhost:5000/pressrelease/999?keyword=test"
# Expected: 404 Not Found
# Message: "error: Source not found"
```

**Test wrong datasource type:**
Create dynamic datasource, call `/pressrelease/:id`:
```bash
curl "http://localhost:5000/pressrelease/2?keyword=test"
# Expected: 400 Bad Request
# Message: "Invalid source type: Expected type 'pressrelease' but got 'dynamic'"
```

✅ Expected: Proper error messages, correct status codes

---

### Test 8: Multi-Page Fetching

**Verify all pages are fetched:**

In backend console, you should see logs:
```
[PressRelease] Fetching list page 1 for keyword: inflasi
[PressRelease] Total pages: 17, total items: 161
[PressRelease] Fetching detail for 161 items...
[PressRelease] Successfully fetched 161/161 details
[PressRelease] Successfully processed 161 items
```

✅ Expected:
- Multi-page handling (not just page 1)
- All brs_ids collected
- Details fetched in batches
- Success count matches total count

---

### Test 9: Backward Compatibility

**Verify existing datasources still work:**

1. Dynamic: `GET /dynamic/1?period=2025-12` → ✅ Works
2. Interop: `GET /interop/2?period=2025` → ✅ Works
3. EXIM: `GET /cache/merge/3?all=true` → ✅ Works
4. Static: `GET /static/4` → ✅ Works

✅ Expected:
- All existing endpoints respond correctly
- No 404 or 500 errors
- Data structure unchanged

---

### Test 10: Database Persistence

**Verify cache is stored in ProcessedCache:**

```sql
SELECT * FROM data_processed_cache 
WHERE source_id = 5 AND period_value LIKE '%inflasi%';
```

✅ Expected:
- 1 row per (source_id, keyword) combination
- processed_json contains full data
- last_update timestamp present
- Cache persists across app restarts

---

### Common Issues & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| "BPS_API_KEY not set" | Missing env var | Set `BPS_API_KEY=...` in `.env` |
| 404 on `/pressrelease/*` | Route not mounted | Check `app.js` imports & mounting |
| Type enum error | DB out of sync | Run `sequelize.sync({ alter: true })` |
| UI shows period input for PR | Cache logic issue | Clear browser cache, restart server |
| No data returned | API rate limit | Wait, check BPS API status |
| Empty brs_ids array | No PRs match keyword | Try different keyword (e.g., "inflasi" vs "ntp") |

---

### Performance Baseline

**Expected performance:**

| Operation | Time | Notes |
|-----------|------|-------|
| Fetch list (17 pages) | ~5-10s | Parallel requests |
| Fetch detail (161 items) | ~10-15s | Batched concurrency (5) |
| Process & cache | ~0.5s | Local operation |
| **Total (first call)** | ~15-25s | Depends on BPS API |
| **Fetch (cached)** | ~50ms | DB lookup only |

---

### ✅ Sign-Off Checklist

- [ ] DataSource enum includes 'pressrelease'
- [ ] Create datasource form accepts 'pressrelease' type
- [ ] `/pressrelease/:id?keyword=X` returns 200 with data
- [ ] Second call returns cached: true
- [ ] Admin UI shows keyword input (not period)
- [ ] Table preview displays correctly
- [ ] Links (PDF, Slide) work
- [ ] Dynamic/Interop/EXIM still work (backward compat)
- [ ] Error handling works (missing keyword, wrong type, etc)
- [ ] Cache persists in DB
- [ ] Console logs show multi-page fetching

**If all ✅ → IMPLEMENTATION SUCCESSFUL!**

---

### 🐛 Debug Mode

Enable verbose logging:

```javascript
// In pressrelease.controller.js, uncomment:
console.log('[Controller] Getting pressrelease source...');
console.log('[Controller] Cache hit/miss...');
```

Backend console will show:
```
[PressRelease] Fetching list page 1...
[PressRelease] Total pages: 17...
[PressRelease] Successfully fetched 161/161 details
[Controller] Successfully processed 161 items
```

---

**Ready to test!** 🚀
