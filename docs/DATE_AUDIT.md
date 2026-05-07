# Date/Time Audit (Backend)

**Date**: 2026-01-24

## Summary
- Centralized formatting and parsing lives in `backend/src/utils/dateHelper.js`.
- Default timezone for display formatting is **WIT (Asia/Jayapura)** via `APP_TIMEZONE`.
- Inline timestamp usage is being consolidated to `dateHelper` helpers.

## Common Date Formats
- **ISO 8601**: `YYYY-MM-DDTHH:mm:ss.sssZ` (e.g., `nowISO()`)
- **MySQL DATETIME**: `YYYY-MM-DD HH:mm:ss` (e.g., `nowMySQL()`)
- **Period strings**:
  - Monthly: `YYYY-MM` (e.g., `2024-01`)
  - Quarterly: `YYYY-Qn` (e.g., `2024-Q1`)
  - Semester: `YYYY-Sn` (e.g., `2024-S1`)
  - Yearly: `YYYY`

## Formatting Patterns in Code
- `toISOString()` for machine-readable timestamps.
- `toLocaleDateString('id-ID', { ... })` for human-readable Indonesian dates.
- `Date` parsing from API payloads for BRS/PressRelease and EXIM workflows.

## Timezone Handling
- UI-facing formatting uses `Asia/Jayapura` (WIT) by default.
- Parsing from upstream APIs remains timezone-agnostic (raw ISO or date strings).

## Action Taken
- Added timezone-aware formatting in `dateHelper`.
- Replaced multiple inline `Date.now()` / `new Date()` usages in chat, scheduler, cache, and EXIM services with `dateHelper` utilities.

## Follow-ups
- Continue replacing legacy `Date.now()` / `new Date()` where appropriate.
- Prefer `dateHelper` for new code to keep time semantics consistent.
