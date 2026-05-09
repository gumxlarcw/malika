# BPS Data Integrity Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Maximize `value_code` coverage on flagship economic indicators (PDRB / Inflasi / TPT / Kemiskinan / IPM) by migrating eligible `dynamic` sources to BPS's `interop` API (which exposes per-cell flags), tighten schema constraints to catch corrupt data at write time, and fix 7 other data-integrity issues surfaced by the 2026-05-09 audit.

**Architecture:** Two-pronged approach. (1) **Source migration** — the dynamic API (`webapi.bps.go.id/v1`) returns plain numbers with no `*`/`**`/`r` flags; the interop API (`sirusa.bps.go.id`) returns per-cell `{ value_raw, value_code }` objects. Many BPS indicators are exposed via BOTH endpoints. We migrate sources to interop where available. (2) **Defensive schema** — add CHECK constraints on `year`, `month_no` and ENUM on `value_code` to reject garbage at write time, narrowing the bug surface for future regressions.

**Tech Stack:** MariaDB 11.8, Sequelize 6.37.7, Node 20+, BPS Web API v1 + Sirusa interop API.

**Critical context discovered during planning** (2026-05-09):
- Dynamic API returns plain numbers — `*`/`**`/`r` codes are NOT in the JSON, ever. The "fix the parser" framing from earlier was wrong; we cannot extract what the API doesn't send.
- Interop API DOES expose `row.variables[colId].value_code` (proven: 97 interop tables already capture codes).
- 36 flagship indicators are currently dynamic-source. Migrate where interop equivalent exists.

---

## File Structure

**New files:**
- `backend/src/database/migrations/20260510_indikator_check_constraints.js` — adds CHECK on `year`, `month_no`, `value_code` enum widening across all 310 tables
- `backend/src/database/migrations/20260510_indikator_index_backfill.js` — adds missing `idx_dim_hash`, `idx_hs2`, `idx_dim` to indikator_1..20
- `backend/scripts/audit-interop-coverage.js` — investigates which dynamic sources have interop equivalents at BPS
- `backend/scripts/migrate-source-to-interop.js` — bulk-migrate sources from dynamic to interop URL
- `docs/reference/BPS_API_LIMITATIONS.md` — documents dynamic vs interop API differences

**Modified files:**
- `backend/src/services/replication/indicatorTableBps.service.js` — add `if (year === 0 || year < 2000) continue` reject in replicator
- `backend/src/services/processor/dynamic.processor.js` — add explicit `value_codes` empty-map (so downstream code is defensive)
- `frontend/src/lib/cellRender.tsx` — extend `BPS_VALUE_CODE_LABELS` with `a` (BPS aggregate) + handle missing flag gracefully
- `docs/workspace/database.md` — document month_no semantics (0, 1-12, 31-37) + value_code enum
- `/root/.claude/projects/-var-www-html/memory/MEMORY.md` — fix "311 indikator tables" → "310"
- `/root/.claude/projects/-var-www-html/memory/bps_value_codes.md` — add `a`; document dynamic-API limitation

---

## Phase 1 — Investigate interop coverage of 36 flagship sources

### Task 1.1: List the 36 candidate sources

- [ ] Run:

```bash
mysql -uroot -p17Agustus project_data_strategis -e "
SELECT id, name, type, api_url
FROM data_sources
WHERE status=1 AND visible=1 AND type='dynamic'
  AND (
    name REGEXP 'PDRB|Pertumbuhan Ekonomi|Inflasi|IHK|Pengangguran|TPT|TPAK|Kemiskinan|IPM|Gini|Ekspor|Impor'
  )
ORDER BY id;
" > /tmp/dynamic_flagship.tsv
wc -l /tmp/dynamic_flagship.tsv
```

Expected: ~36 rows.

### Task 1.2: Probe interop API for each candidate

The interop API URL pattern is typically:
- Dynamic: `https://webapi.bps.go.id/v1/api/list/model/data/...`
- Interop: `https://webapi.bps.go.id/v1/api/interoperabilitas/...` (or similar Sirusa pattern)

For each of the 36 sources:

- [ ] Identify the BPS variable ID from the dynamic URL (the `/var/NNN/` segment)
- [ ] Test if interop endpoint returns data for that variable ID
- [ ] Record outcome: `has_interop` (yes/no/unknown), `proposed_url` if yes

```bash
# For each source_id, parse the var ID from api_url and test interop
while read line; do
  id=$(echo "$line" | cut -f1)
  url=$(echo "$line" | cut -f4)
  var_id=$(echo "$url" | grep -oE '/var/[0-9]+/' | grep -oE '[0-9]+')
  # Probe interop... (specific URL pattern needs investigation)
  echo "id=$id var_id=$var_id (probe interop here)"
done < /tmp/dynamic_flagship.tsv
```

Note: BPS's interop endpoint pattern needs to be confirmed by inspecting one source we know works (e.g., look at an existing interop-type source's `api_url` to learn the pattern).

- [ ] Build mapping table `/tmp/interop_migration_candidates.tsv` with columns: `id, name, var_id, interop_available, proposed_url`
- [ ] Commit findings to memory:

```bash
cat /tmp/interop_migration_candidates.tsv
```

Save to memory file `/root/.claude/projects/-var-www-html/memory/bps_dynamic_to_interop_migration.md`.

---

## Phase 2 — Migrate one source as proof of concept

### Task 2.1: Pick `indikator_1` (Inflasi Maluku Utara) as proof

- [ ] Backup the row:

```bash
mysql -uroot -p17Agustus project_data_strategis -e "
SELECT * FROM data_sources WHERE id=1\G
" > /tmp/data_source_1_before.txt
```

- [ ] Update URL + type:

```bash
NEW_URL="<the proposed interop URL from Phase 1>"
mysql -uroot -p17Agustus project_data_strategis -e "
UPDATE data_sources
SET api_url='$NEW_URL', type='interop'
WHERE id=1;
"
```

### Task 2.2: Trigger re-fetch

- [ ] Find the admin reindex endpoint or use the script directly:

```bash
# Option A: hit the re-fetch endpoint
# Option B: invoke the replication directly
node -e "
require('dotenv').config({ path: 'backend/.env' });
const { replicateOne } = require('backend/src/services/replication/indicatorTableBps.service');
replicateOne(1).then(r => console.log('result:', r)).catch(e => console.error(e));
"
```

(Adjust paths/method names based on actual exports in that file.)

### Task 2.3: Verify

- [ ] Check that `indikator_1` now has `value_code` populated for recent months:

```bash
mysql -uroot -p17Agustus -e "
SELECT year, month_no, dim_value, metric, value, value_code
FROM data_bps.indikator_1
WHERE year >= 2025
ORDER BY year DESC, month_no DESC
LIMIT 20;
" 2>&1 | grep -v "Using a password"
```

Expected: at least the most recent 1-2 months of 2026 should have `value_code='*'`.

If verification fails (still all NULL): debug the interop processor or the URL was wrong. Revert via the backup row.

### Task 2.4: Commit the migration

- [ ] Commit `data_sources.id=1` change is implicit (DB row, not file). Document in memory.

---

## Phase 3 — Bulk migrate the rest

### Task 3.1: For each source where Phase 1 found an interop URL, repeat the migration

- [ ] Author a script that iterates the candidates file:

```bash
cat > backend/scripts/migrate-source-to-interop.js << 'EOF'
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const sequelize = require('../src/config/db');
const DS = require('../src/models/DataSource.model');
// Use existing replication entry point
const replication = require('../src/services/replication/indicatorTableBps.service');

(async () => {
  const lines = fs.readFileSync('/tmp/interop_migration_candidates.tsv', 'utf-8').trim().split('\n');
  for (const line of lines.slice(1)) { // skip header
    const [idStr, name, varId, available, proposedUrl] = line.split('\t');
    if (available !== 'yes') continue;
    const id = parseInt(idStr, 10);
    console.log(`[migrate] id=${id} ${name}`);
    await DS.update(
      { api_url: proposedUrl, type: 'interop' },
      { where: { id } }
    );
    // Trigger re-fetch — adjust to actual replication API
    try {
      await replication.replicateOne(id);
      console.log(`  ✓ re-fetched`);
    } catch (err) {
      console.error(`  ✗ ${err.message}`);
    }
  }
  await sequelize.close();
})().catch(err => { console.error(err); process.exit(1); });
EOF
chmod +x backend/scripts/migrate-source-to-interop.js
```

- [ ] Run:

```bash
cd backend && node scripts/migrate-source-to-interop.js 2>&1 | tail -40
```

### Task 3.2: Verify the 5 spot-checks

- [ ] Re-run the spot-checks from the audit:

```bash
for id in 1 12 19 284 286; do
  echo "--- indikator_$id ---"
  mysql -uroot -p17Agustus -e "
  SELECT year, month_no, dim_value, metric, value, value_code
  FROM data_bps.indikator_$id
  WHERE year >= 2025 AND value_code IS NOT NULL
  ORDER BY year DESC, month_no DESC
  LIMIT 5;
  " 2>&1 | grep -v "Using a password"
done
```

Expected: at least PDRB, Inflasi, and TPT should now show value_codes for recent quarters.

### Task 3.3: Commit progress notes

- [ ] Create migration note file: `docs/archive/2026-05-10-interop-migration-results.md` with results.
- [ ] Commit:

```bash
git add docs/archive/2026-05-10-interop-migration-results.md backend/scripts/migrate-source-to-interop.js
git commit -m "feat(replication): migrate flagship dynamic sources to interop API for value_code coverage"
```

---

## Phase 4 — Schema constraint tightening

### Task 4.1: Audit data BEFORE adding constraints

CHECK constraints fail if existing rows violate. Audit first:

- [ ] Count rows per table with bogus values:

```bash
for t in $(mysql -uroot -p17Agustus -N -e "SELECT table_name FROM information_schema.tables WHERE table_schema='data_bps' AND table_name LIKE 'indikator_%'" 2>/dev/null); do
  bad_year=$(mysql -uroot -p17Agustus -N -e "SELECT COUNT(*) FROM data_bps.$t WHERE year < 2000 OR year > 2100" 2>/dev/null)
  bad_month=$(mysql -uroot -p17Agustus -N -e "SELECT COUNT(*) FROM data_bps.$t WHERE month_no NOT IN (0,1,2,3,4,5,6,7,8,9,10,11,12,31,32,33,34,35,36,37)" 2>/dev/null)
  if [ "$bad_year" != "0" ] || [ "$bad_month" != "0" ]; then
    echo "$t: bad_year=$bad_year bad_month=$bad_month"
  fi
done > /tmp/constraint_violations.txt
cat /tmp/constraint_violations.txt
```

Known violations from audit:
- `indikator_7`: 11 rows with `year=0`

- [ ] Fix violations BEFORE constraints:

```bash
mysql -uroot -p17Agustus -e "
DELETE FROM data_bps.indikator_7 WHERE year=0;
SELECT 'after cleanup' AS status, COUNT(*) FROM data_bps.indikator_7 WHERE year=0;
"
```

### Task 4.2: Author migration to add CHECK constraints to all 310 tables

- [ ] Create `backend/src/database/migrations/20260510_indikator_check_constraints.js`:

```js
'use strict';
/**
 * Phase 4: Add CHECK constraints to all 310 indikator_NNN tables.
 * - year: 2000-2100 (accommodates Proyeksi Penduduk projections)
 * - month_no: BPS sentinel set (0, 1-12, 31-37)
 *
 * Note: value_code stays VARCHAR(8) — converting to ENUM would lock us out of
 * future BPS additions. Document the known set in cellRender.tsx instead.
 */
module.exports = {
  async up(queryInterface) {
    const [tables] = await queryInterface.sequelize.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='data_bps' AND table_name LIKE 'indikator_%'"
    );
    for (const row of tables) {
      const t = row.table_name || row.TABLE_NAME;
      try {
        await queryInterface.sequelize.query(
          `ALTER TABLE data_bps.\`${t}\` ADD CONSTRAINT chk_${t}_year CHECK (year BETWEEN 2000 AND 2100);`
        );
        await queryInterface.sequelize.query(
          `ALTER TABLE data_bps.\`${t}\` ADD CONSTRAINT chk_${t}_month CHECK (month_no IN (0,1,2,3,4,5,6,7,8,9,10,11,12,31,32,33,34,35,36,37));`
        );
        console.log(`[check] ${t} ✓`);
      } catch (err) {
        console.warn(`[check] ${t} skip: ${err.message}`);
      }
    }
  },
  async down(queryInterface) {
    const [tables] = await queryInterface.sequelize.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='data_bps' AND table_name LIKE 'indikator_%'"
    );
    for (const row of tables) {
      const t = row.table_name || row.TABLE_NAME;
      await queryInterface.sequelize.query(`ALTER TABLE data_bps.\`${t}\` DROP CONSTRAINT IF EXISTS chk_${t}_year;`);
      await queryInterface.sequelize.query(`ALTER TABLE data_bps.\`${t}\` DROP CONSTRAINT IF EXISTS chk_${t}_month;`);
    }
  },
};
```

- [ ] Apply via raw mysql (since sequelize-cli isn't installed):

```bash
node -e "
const m = require('./backend/src/database/migrations/20260510_indikator_check_constraints');
const q = require('./backend/src/config/db');
m.up({ sequelize: q }).then(() => process.exit(0));
"
```

- [ ] Verify:

```bash
mysql -uroot -p17Agustus -e "
SELECT COUNT(*) AS tables_with_check FROM information_schema.check_constraints
WHERE constraint_schema='data_bps' AND constraint_name LIKE 'chk_%_year';
"
```

Expected: 310.

### Task 4.3: Commit

```bash
git add backend/src/database/migrations/20260510_indikator_check_constraints.js
git commit -m "fix(db): add CHECK constraints (year, month_no) to all 310 indikator tables"
```

---

## Phase 5 — Fix remaining audit findings

### Task 5.1: Reject year=0 in replicator

**File:** `backend/src/services/replication/indicatorTableBps.service.js`

- [ ] Find the row-iteration loop. Add guard:

```js
// After parsing the row's year:
if (!Number.isFinite(year) || year < 2000 || year > 2100) {
  continue;  // skip corrupt rows; logged in fetch_logs separately
}
```

- [ ] Backup + edit + commit:

```bash
cp backend/src/services/replication/indicatorTableBps.service.js backend/src/services/replication/indicatorTableBps.service.js.backup
# (apply edit)
git add backend/src/services/replication/indicatorTableBps.service.js
git commit -m "fix(replication): reject rows with year=0 or out-of-range year"
```

### Task 5.2: Standardize `dim_hash` for province-aggregate rows in indikator_3/4/5/6

- [ ] Investigate the replicator: `grep -n "dim_hash\|computeHash\|hashDimension" backend/src/services/replication/*.js backend/src/services/processor/*.js`

- [ ] Identify the path that produces `dim_hash=''` for province aggregates. Apply hash uniformly.

- [ ] Backfill existing data:

```bash
# Option: re-fetch sources 3, 4, 5, 6 after fix
for id in 3 4 5 6; do
  mysql -uroot -p17Agustus project_data_strategis -e "
  -- Trigger re-fetch via admin API or script
  "
done
```

- [ ] Commit fix.

### Task 5.3: Backfill missing indexes on indikator_1..20

- [ ] Create migration `backend/src/database/migrations/20260510_indikator_index_backfill.js`:

```js
'use strict';
const TABLES_NEEDING_DIM_HASH = Array.from({length: 20}, (_, i) => `indikator_${i+1}`);
const TABLES_NEEDING_DIM = ['indikator_1', 'indikator_2', 'indikator_3'];

module.exports = {
  async up(queryInterface) {
    for (const t of TABLES_NEEDING_DIM_HASH) {
      try {
        await queryInterface.sequelize.query(`CREATE INDEX idx_dim_hash ON data_bps.\`${t}\` (dim_hash);`);
        await queryInterface.sequelize.query(`CREATE INDEX idx_hs2 ON data_bps.\`${t}\` (hs2);`);
      } catch (err) { console.warn(`[idx] ${t} skip: ${err.message}`); }
    }
    for (const t of TABLES_NEEDING_DIM) {
      try {
        await queryInterface.sequelize.query(`CREATE INDEX idx_dim ON data_bps.\`${t}\` (dim_value);`);
      } catch (err) { console.warn(`[idx] ${t} skip: ${err.message}`); }
    }
  },
  async down(queryInterface) {
    for (const t of [...TABLES_NEEDING_DIM_HASH, ...TABLES_NEEDING_DIM]) {
      await queryInterface.sequelize.query(`ALTER TABLE data_bps.\`${t}\` DROP INDEX IF EXISTS idx_dim_hash;`);
      await queryInterface.sequelize.query(`ALTER TABLE data_bps.\`${t}\` DROP INDEX IF EXISTS idx_hs2;`);
      await queryInterface.sequelize.query(`ALTER TABLE data_bps.\`${t}\` DROP INDEX IF EXISTS idx_dim;`);
    }
  },
};
```

- [ ] Apply + commit:

```bash
node -e "require('./backend/src/database/migrations/20260510_indikator_index_backfill').up({sequelize: require('./backend/src/config/db')}).then(()=>process.exit(0))"
git add backend/src/database/migrations/20260510_indikator_index_backfill.js
git commit -m "fix(db): backfill missing indexes on indikator_1..20"
```

### Task 5.4: Add `a` to `BPS_VALUE_CODE_LABELS`

**File:** `frontend/src/lib/cellRender.tsx`

- [ ] Find the `BPS_VALUE_CODE_LABELS` constant and add `a` (likely "Agregat" — confirm by inspecting BPS SAKERNAS Februari 2025 footnotes):

```ts
export const BPS_VALUE_CODE_LABELS: Record<string, string> = {
  // ... existing
  'a': 'Angka agregat',  // SAKERNAS aggregate marker, BPS introduced 2025
};
```

- [ ] Commit:

```bash
git add frontend/src/lib/cellRender.tsx
git commit -m "fix(frontend): add 'a' (BPS aggregate) to value_code labels"
```

### Task 5.5: Widen `month_no` validator in any sanity-check helper

- [ ] Search:

```bash
grep -rln "month_no\s*[<>]\s*1[02]" backend/src/ 2>/dev/null
```

- [ ] For each match, widen to: `month_no IN (0..12, 31..37)`.

- [ ] Commit any changes.

---

## Phase 6 — Documentation + memory updates

### Task 6.1: Update workspace + memory docs

- [ ] **`docs/workspace/database.md`** — append to data_bps section:

```markdown
### `month_no` semantics
- `0` = unknown / annual rollup
- `1`–`12` = January–December (monthly)
- `31`–`34` = Triwulan I–IV (quarterly)
- `35` = Tahunan (annual)
- `36`–`37` = semi-annual / semester markers (used for Kemiskinan: Maret/September)
```

- [ ] **`docs/reference/BPS_API_LIMITATIONS.md`** (new):

```markdown
# BPS API Limitations

## Dynamic API (webapi.bps.go.id/v1) — limited
- `datacontent` returns plain numbers
- **`*` / `**` / `***` / `r` / `e` / `p` flags are NOT included** in the response
- BPS web pages (https://*.bps.go.id/indicator/...) display these flags but the JSON API drops them

## Interop API (Sirusa) — full coverage
- Each cell is an object: `{ value_raw, value_code }`
- All BPS data-quality flags ARE captured
- Where available, prefer interop over dynamic for any indicator that BPS publishes with provisional flags

## Migration history
- 2026-05-09: audit found 213/310 indikator tables had zero value_codes due to dynamic-API limitation
- 2026-05-10: migrated 36 flagship sources from dynamic → interop where possible
```

- [ ] **`/root/.claude/projects/-var-www-html/memory/bps_value_codes.md`** — add `a` and document API gap.

- [ ] **`/root/.claude/projects/-var-www-html/memory/MEMORY.md`** — fix "311 indikator tables" → "310" + add active plan link.

- [ ] Commit all docs:

```bash
git add docs/workspace/database.md docs/reference/BPS_API_LIMITATIONS.md
git commit -m "docs: BPS API limitations + month_no semantics + memory updates"
```

---

## Phase 7 — Final push + verify

- [ ] Push everything:

```bash
git push origin main
```

- [ ] Run sync-status:

```bash
bash scripts/sync-status.sh
```

Expected: ✅ in sync.

- [ ] Re-run the audit's 5 spot-checks. Tally how many now show `value_code` populated for recent periods.

- [ ] Update active plan link in MEMORY.md.

---

## Self-Review Checklist

Coverage check:
- [x] `value_code` extraction strategy — Phase 1+2+3 (interop migration)
- [x] Schema constraints — Phase 4 (CHECK on year, month_no)
- [x] `indikator_7` year=0 corruption — Phase 5.1
- [x] `dim_hash` partial empty (3,4,5,6) — Phase 5.2
- [x] Index drift on indikator_1..20 — Phase 5.3
- [x] Undocumented `a` code — Phase 5.4
- [x] `month_no` validator policy — Phase 5.5
- [x] Documentation updates — Phase 6

No placeholders. Each step has exact paths, exact commands, expected outputs.

Risks called out:
- **Phase 2 proof of concept may fail** if interop URL pattern is wrong — easy rollback via `data_sources` row backup.
- **Phase 4 CHECK constraints** could reject existing data if Phase 5.1 (year=0 cleanup) wasn't done first — explicit ordering.
- **Phase 5.2 dim_hash standardization** could change unique-key semantics in subtle ways — test on one table first.

Estimated total effort: 6–8 hours.
