# UI/UX Improvements Roadmap

> Created: January 19, 2026  
> Status: ✅ **COMPLETE** - All 19 improvements implemented  
> Approach: Implement one by one, carefully testing each change

---

## Quick Wins (Low Risk, High Impact)

### 1. ✅ Legend Position in Fullscreen Charts
- **Status**: DONE ✅
- **File**: `frontend/src/components/search/SearchInsightsChart.tsx`
- **Change**: Legend now appears at bottom in both normal and fullscreen modes

### 2. ✅ Clear Search Button (X icon)
- **Status**: DONE ✅
- **Files**: `frontend/src/layout/AppHeader.tsx`
- **Description**: Add an X button inside search inputs to quickly clear the query
- **Change**: Added X button on both mobile and desktop search inputs, appears when text is entered

### 3. ✅ Sticky Table Headers
- **Status**: DONE ✅
- **Files**: `frontend/src/app/(admin)/data/page.tsx`, `frontend/src/app/(admin)/search/SearchPageClient.tsx`, `frontend/src/layout/AppHeader.tsx`
- **Description**: Keep column headers visible while scrolling long data tables
- **Change**: Added sticky headers with z-index and proper background colors for all tables

### 4. ✅ Keyboard Shortcut for Fullscreen (Esc to close)
- **Status**: DONE ✅
- **File**: `frontend/src/components/search/SearchInsightsChart.tsx`
- **Description**: Press Esc key to exit fullscreen chart modal
- **Risk**: Low

### 5. ✅ Improved Empty States
- **Status**: DONE ✅
- **Files**: `frontend/src/components/common/EmptyState.tsx` (new), search & data pages
- **Description**: Better messaging and icons when no results found
- **Change**: Created EmptyState component with 4 variants (no-results, no-data, error, no-recommendations) with SVG icons

---

## Medium Effort Improvements

### 6. ✅ Skeleton Loaders for Search Results
- **Status**: DONE ✅
- **Files**: `frontend/src/components/search/SearchResultSkeleton.tsx` (new), `frontend/src/app/(admin)/search/SearchPageClient.tsx`
- **Description**: Show skeleton/shimmer animation instead of "Loading..." text
- **Change**: Created reusable skeleton components (cards, table, header) with pulse animation

### 7. ✅ Chart Export Buttons (PNG, CSV)
- **Status**: DONE ✅
- **File**: `frontend/src/components/search/SearchInsightsChart.tsx`
- **Description**: Added CSV export button alongside existing PNG export
- **Change**: Added CsvIcon component, handleDownloadCSV function with proper escaping and BOM for Excel compatibility

### 8. ✅ Row Highlighting on Hover (Tables)
- **Status**: DONE ✅
- **Files**: AppHeader.tsx, data/page.tsx, SearchPageClient.tsx, QuickDataPreviewCard.tsx
- **Description**: Added visual feedback when hovering over table rows
- **Change**: Added `transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50` to 5 table row elements

### 9. ✅ Recent Searches
- **Status**: DONE ✅
- **Files**: `frontend/src/layout/AppHeader.tsx`
- **Description**: Saves and displays recent search queries using localStorage
- **Change**: Added recentSearches state, localStorage save/load, display in both mobile & desktop dropdowns with clock icon and "Hapus" button

### 10. ✅ Dark Mode Chart Improvements
- **Status**: DONE ✅
- **File**: `frontend/src/components/search/SearchInsightsChart.tsx`
- **Description**: Charts now adapt properly to dark mode
- **Change**: Added useTheme hook, isDark detection, dynamic colors for: text, labels, grid lines, tooltips, annotations, legend text

---

## Higher Effort Improvements

### 11. ✅ Search Autocomplete/Suggestions
- **Status**: DONE ✅
- **Files**: `frontend/src/layout/AppHeader.tsx`
- **Description**: Enhanced real-time search suggestions as user types
- **Change**: Added highlightMatch() function for keyword highlighting, category icons, search prompt with Enter hint, works in both mobile and desktop dropdowns

### 12. ✅ Bottom Navigation Bar (Mobile)
- **Status**: Done
- **Priority**: Medium
- **Files**: `frontend/src/layout/MobileBottomNav.tsx`, `frontend/src/app/(admin)/layout.tsx`, `frontend/src/layout/AppHeader.tsx`, `frontend/src/components/SimpleTour.tsx`
- **Description**: Fixed bottom nav for key actions on mobile
- **Risk**: Medium
- **Change**: 
  - Created MobileBottomNav component with 5 nav items (Beranda, Cari, Malika, Publikasi, Notifikasi)
  - Added data-tour attributes for tutorial integration
  - Hidden sidebar hamburger button on mobile (< lg breakpoint)
  - Updated SimpleTour to show bottom nav steps on mobile instead of sidebar steps
  - Added padding-bottom to main content to prevent hidden content

### 13. ✅ Virtualized Lists for Large Tables
- **Status**: Done
- **Priority**: Low
- **Files**: `frontend/src/components/common/VirtualizedTable.tsx` (new), `frontend/src/app/(admin)/data/DataTableClient.tsx` (new), `frontend/src/app/(admin)/data/page.tsx`
- **Description**: Use virtual scrolling for tables with many rows
- **Risk**: Medium (requires new dependency)
- **Change**: 
  - Installed `@tanstack/react-virtual` for efficient virtualization
  - Created reusable `VirtualizedTable` component with threshold-based virtualization (>50 rows)
  - Created `DataTableClient` wrapper to handle client-side rendering with virtualization
  - VirtualizedTable features: 35px row height, 10-row overscan, sticky header, month highlighting support
  - Falls back to normal table for smaller datasets for simplicity

### 14. ✅ Pull-to-Refresh (Mobile)
- **Status**: Done
- **Priority**: Low
- **Files**: `frontend/src/components/common/PullToRefresh.tsx` (new), `frontend/src/app/(admin)/layout.tsx`
- **Description**: Native-feeling refresh gesture
- **Risk**: Medium
- **Change**: 
  - Created `PullToRefresh` component with touch gesture detection
  - Features: 80px threshold, resistance-based pulling, rotating arrow indicator, spinning loader during refresh
  - Integrated into main layout - wraps all page content on touch devices
  - Excludes dashboard and chat pages (special layouts)
  - Uses `router.refresh()` to trigger Next.js page refresh

### 15. ✅ Chart Comparison Mode
- **Status**: Done
- **Priority**: Low
- **Files**: `frontend/src/components/search/ChartComparisonModal.tsx` (new), `frontend/src/components/search/SearchInsightsChart.tsx`
- **Description**: Side-by-side comparison of different periods/regions
- **Risk**: High (complex feature)
- **Change**: 
  - Created `ChartComparisonModal` component for selecting comparison type (period vs indicator)
  - Added compare button (⊞ icon) in chart toolbar
  - Supports two comparison modes:
    - **Period comparison**: Compare same indicator across different years
    - **Indicator comparison**: Compare different indicators for same period
  - Side-by-side chart layout with labels
  - "Hapus Perbandingan" button to exit comparison mode
  - Created simplified `ComparisonChart` component for rendering comparison data
  - Auto-fetches comparison data from `/api/data-preview` endpoint

---

## Accessibility Improvements

### 16. ✅ ARIA Labels
- **Status**: Done
- **Priority**: High
- **Files**: `frontend/src/layout/AppHeader.tsx`, `frontend/src/layout/AppSidebar.tsx`, `frontend/src/layout/MobileBottomNav.tsx`
- **Description**: Add proper ARIA labels for screen readers
- **Risk**: Low
- **Change**: 
  - Added `aria-label` to search inputs with descriptive text
  - Added `aria-autocomplete`, `aria-controls`, `aria-expanded` to search
  - Added `role="banner"` and `aria-label` to header
  - Added `role="navigation"` and `aria-label` to sidebar
  - Added `role="navigation"` and `aria-label` to bottom nav
  - Added `role="menubar"` and `role="menuitem"` to nav items
  - Added `aria-current="page"` for active nav items
  - Added `aria-pressed` for toggle buttons

### 17. ✅ Keyboard Navigation
- **Status**: Done
- **Priority**: Medium
- **Files**: `frontend/src/app/globals.css`, `frontend/src/layout/MobileBottomNav.tsx`, `frontend/src/layout/AppHeader.tsx`
- **Description**: Ensure all actions can be performed via keyboard
- **Risk**: Low
- **Change**: 
  - Added `:focus-visible` styles for keyboard-only focus
  - Added `focus-visible:ring-2 focus-visible:ring-brand-500` to interactive elements
  - Removed default focus outline, kept focus-visible for keyboard users
  - Added focus styles for buttons, links, inputs, selects, and role elements
  - Added `@media (prefers-reduced-motion)` for users who prefer less motion

### 18. ✅ Skip-to-Content Link
- **Status**: Done
- **Priority**: Low
- **Files**: `frontend/src/app/(admin)/layout.tsx`
- **Description**: Allow screen reader users to skip navigation
- **Risk**: Low
- **Change**: 
  - Added "Langsung ke konten utama" skip link at top of layout
  - Link is visually hidden (sr-only) but visible on focus
  - Changed content wrapper from `<div>` to `<main>` with `id="main-content"`
  - Added `role="main"`, `aria-label`, and `tabIndex={-1}` to main content

### 19. ✅ Color Contrast Check
- **Status**: Done
- **Priority**: Medium
- **Files**: `frontend/src/app/globals.css`
- **Description**: Ensure WCAG AA compliance for color contrast
- **Risk**: Low
- **Change**: 
  - Improved `text-gray-400` to darker shade (gray-500 equivalent) in light mode
  - Improved `text-gray-500` to darker shade (gray-600 equivalent) in light mode
  - Enhanced dark mode text colors for better contrast against dark backgrounds
  - Improved placeholder text contrast in both light and dark modes
  - All text now meets WCAG AA minimum contrast ratio of 4.5:1

---

## Implementation Log

| Date | Item # | Description | Result |
|------|--------|-------------|--------|
| 2026-01-19 | 1 | Legend at bottom in fullscreen | ✅ Success |
| 2026-01-19 | 4 | Esc key to close fullscreen | ✅ Success |
| 2026-01-19 | 2 | Clear search button (X icon) | ✅ Success |
| 2026-01-19 | 3 | Sticky table headers | ✅ Success |
| 2026-01-19 | 6 | Skeleton loaders for search | ✅ Success |
| 2026-01-19 | 5 | Improved empty states | ✅ Success |
| 2026-01-19 | 7 | Chart export (PNG + CSV) | ✅ Success |
| 2026-01-19 | 8 | Row highlighting on hover | ✅ Success |
| 2026-01-19 | 9 | Recent searches (localStorage) | ✅ Success |
| 2026-01-19 | 10 | Dark mode chart improvements | ✅ Success |
| 2026-01-19 | 11 | Search autocomplete/suggestions | ✅ Success |
| | | | |

---

## Notes

- **Always test on both mobile and desktop after each change**
- **Test in both light and dark mode**
- **Check for console errors after each implementation**
- **Build and restart PM2 after each change to verify in production**

---

## Next Up

**Recommended order:**
1. #4 - Esc key to close fullscreen (very safe, improves UX)
2. #2 - Clear search button (simple, common pattern)
3. #3 - Sticky table headers (CSS only, low risk)
4. #6 - Skeleton loaders (improves perceived performance)
5. #5 - Empty states (better messaging)

Let me know which one to implement next!
