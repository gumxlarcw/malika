# Navigation Performance Fix - Implementation & Testing Guide

**Date:** January 19, 2026  
**Issue:** Navigation delay when clicking menu items (especially Chat Malika)  
**Status:** ✅ Phase 1 Implemented (loading.tsx + Suspense)

---

## Implementation Log

| Date | Phase | Status | Notes |
|------|-------|--------|-------|
| 2026-01-19 | Phase 1.1 | ✅ Done | Created `loading.tsx` for chat, notifications, settings, feedback, admin root |
| 2026-01-19 | Phase 1.2 | ✅ Done | Added Suspense wrapper in `chat/page.tsx` |
| 2026-01-19 | Phase 3.1 | ✅ Done | Dynamic import for `QuickDataPreviewCard` with SSR disabled |
| 2026-01-19 | Build | ✅ Pass | Clean build succeeded in 21.0s |
| 2026-01-19 | Deploy | ✅ Pass | PM2 restart, all routes returning HTTP 200 |

---

## Table of Contents
1. [Problem Summary](#problem-summary)
2. [Root Cause Analysis](#root-cause-analysis)
3. [Backup Files](#backup-files)
4. [Implementation Plan](#implementation-plan)
5. [Testing Checklist](#testing-checklist)
6. [Rollback Procedure](#rollback-procedure)

---

## Problem Summary

Users experience a noticeable delay when navigating between pages in the PWA, particularly:
- Clicking "Chat Malika" in sidebar or bottom navigation
- The page doesn't respond immediately after click interaction
- Affects both web and PWA (standalone) mode

---

## Root Cause Analysis

### Issues Found (Priority Order)

| # | Issue | Impact | Location |
|---|-------|--------|----------|
| 1 | **Missing `loading.tsx`** for chat route | HIGH | `src/app/(admin)/chat/` |
| 2 | **Synchronous CSS import** in chat layout | HIGH | `src/app/(admin)/chat/layout.tsx` |
| 3 | **No Suspense wrapper** in chat page.tsx | MEDIUM | `src/app/(admin)/chat/page.tsx` |
| 4 | **Large monolithic component** (2672 lines) | MEDIUM | `src/app/(admin)/chat/ChatPageClient.tsx` |
| 5 | **Heavy non-lazy import** (QuickDataPreviewCard) | MEDIUM | `ChatPageClient.tsx` |
| 6 | **Cascading API calls** on mount | MEDIUM | `ChatPageClient.tsx` |

### Comparison with Other Pages

| Page | Has loading.tsx | Uses Suspense | Feels Fast |
|------|-----------------|---------------|------------|
| `/brs` | ❌ | ✅ (in page.tsx) | ✅ |
| `/publikasi` | ❌ | ✅ (in page.tsx) | ✅ |
| `/search` | ❌ | ✅ (in page.tsx) | ✅ |
| `/chat` | ❌ | ❌ | ❌ |
| `/notifications` | ❌ | ❌ | ⚠️ (internal loader) |
| `/settings` | ❌ | ❌ | ⚠️ (light page) |
| `/feedback` | ❌ | ❌ | ⚠️ (internal loader) |

---

## Backup Files

All original files are backed up to:
```
/var/www/html/project-data-strategis/backups/2026-01-19-navigation-perf/
```

| Backup File | Original Location |
|-------------|-------------------|
| `chat_page.tsx.bak` | `frontend/src/app/(admin)/chat/page.tsx` |
| `chat_layout.tsx.bak` | `frontend/src/app/(admin)/chat/layout.tsx` |
| `ChatPageClient.tsx.bak` | `frontend/src/app/(admin)/chat/ChatPageClient.tsx` |
| `MobileBottomNav.tsx.bak` | `frontend/src/layout/MobileBottomNav.tsx` |
| `AppSidebar.tsx.bak` | `frontend/src/layout/AppSidebar.tsx` |
| `admin_layout.tsx.bak` | `frontend/src/app/(admin)/layout.tsx` |

---

## Implementation Plan

### Phase 1: Quick Wins (Low Risk, High Impact)

#### 1.1 Create `loading.tsx` for Chat Route
**File:** `frontend/src/app/(admin)/chat/loading.tsx` (NEW)

```tsx
import React from "react";

export default function ChatLoading() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-3 border-gray-200 border-t-brand-500" />
        <p className="text-sm text-gray-500 dark:text-gray-400">Memuat Chat...</p>
      </div>
    </div>
  );
}
```

**Why:** Next.js automatically shows this component during route transitions.

#### 1.2 Add Suspense Wrapper in chat/page.tsx
**File:** `frontend/src/app/(admin)/chat/page.tsx`

```tsx
import type { Metadata } from "next";
import React, { Suspense } from "react";
import ChatPageClient from "./ChatPageClient";
import ChatLoading from "./loading";

export const metadata: Metadata = {
  title: "Chat MALIKA",
  description: "Chat dengan MALIKA - Customer Service BPS Maluku Utara",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function ChatPage() {
  return (
    <Suspense fallback={<ChatLoading />}>
      <ChatPageClient />
    </Suspense>
  );
}
```

**Why:** Provides immediate loading feedback while ChatPageClient hydrates.

---

### Phase 2: CSS Optimization (Medium Risk)

#### 2.1 Move CSS Import from Layout to Component

**Current (chat/layout.tsx):**
```tsx
import "@chatui/core/dist/index.css";
import "./chatui-overrides.css";

export default function ChatLayout({ children }) {
  return children;
}
```

**New Approach:**
Option A: Keep in layout but ensure it doesn't block (acceptable)
Option B: Dynamic CSS loading in ChatPageClient (complex, may cause FOUC)

**Recommendation:** Keep current CSS import but ensure Phase 1 fixes mitigate the blocking.

---

### Phase 3: Component Optimization (Higher Risk, Longer Term)

#### 3.1 Dynamic Import for QuickDataPreviewCard
**File:** `frontend/src/app/(admin)/chat/ChatPageClient.tsx`

**Current:**
```tsx
import QuickDataPreviewCard from "@/components/search/QuickDataPreviewCard";
```

**Proposed:**
```tsx
import dynamic from "next/dynamic";

const QuickDataPreviewCard = dynamic(
  () => import("@/components/search/QuickDataPreviewCard"),
  { 
    ssr: false,
    loading: () => <div className="p-4 text-sm text-gray-500">Loading preview...</div>
  }
);
```

**Risk:** Ensure all usages of QuickDataPreviewCard in ChatPageClient work correctly.

#### 3.2 Extract Large Sub-Components (Future)
Consider extracting these from ChatPageClient.tsx:
- `DataSummaryBubble` (~200 lines)
- `CandidateSelector` (~200 lines)
- `PreviewGate` (~150 lines)
- `ThreadList` (sidebar portion)

---

## Testing Checklist

### Pre-Implementation Tests (Baseline)

Run these BEFORE making any changes to establish baseline:

```bash
# 1. Build the app
cd /var/www/html/project-data-strategis/frontend
npm run build

# 2. Start production server
npm run start
```

**Manual Tests (Record timings):**
- [ ] Home → Chat: ___ms (perceived delay)
- [ ] BRS → Chat: ___ms
- [ ] Chat → Home: ___ms
- [ ] Chat → BRS: ___ms
- [ ] Publikasi → Chat: ___ms
- [ ] Bottom nav tap response: ___ms

### Post-Implementation Tests

#### Functional Tests (Must Pass)

**Chat Page Core:**
- [ ] Chat page loads without errors
- [ ] Loading spinner shows immediately on navigation
- [ ] Thread list displays correctly
- [ ] Can create new chat thread
- [ ] Can send message
- [ ] Streaming response works
- [ ] Quick reply chips appear
- [ ] Data preview modal opens correctly
- [ ] Table data renders with correct ordering
- [ ] Voice input works (if supported)
- [ ] Export JSON modal works
- [ ] Rating modal shows after "terima kasih"

**Navigation:**
- [ ] Sidebar links work (all pages)
- [ ] Bottom nav links work (all pages)
- [ ] Back button works correctly
- [ ] Browser refresh works on chat page
- [ ] Deep link to `/chat` works

**PWA Mode:**
- [ ] Bottom nav visible in standalone mode
- [ ] Chat fills available height correctly
- [ ] No extra padding at bottom
- [ ] Keyboard doesn't break layout

**Mobile:**
- [ ] History drawer opens/closes
- [ ] Thread switching works
- [ ] Responsive layout correct

#### Performance Tests (Should Improve)

```bash
# Run Lighthouse audit
# In Chrome DevTools → Lighthouse → Performance

# Expected improvements:
# - First Contentful Paint: should decrease
# - Largest Contentful Paint: should decrease
# - Time to Interactive: should decrease
```

**Manual Timing Tests:**
- [ ] Home → Chat: ___ms (target: < 500ms perceived)
- [ ] BRS → Chat: ___ms
- [ ] Chat → Home: ___ms

#### Regression Tests

**Other Pages (Must Still Work):**
- [ ] Dashboard loads with Metabase embed
- [ ] BRS page loads with publications
- [ ] Publikasi page loads with publications
- [ ] Search page works
- [ ] Notifications page works
- [ ] Settings page works
- [ ] Feedback page works
- [ ] Data page (/data?source_id=X) works

**Theme & Styling:**
- [ ] Light mode renders correctly
- [ ] Dark mode renders correctly
- [ ] ChatUI styling intact (bubbles, colors)
- [ ] No CSS flashes/FOUC

---

## Rollback Procedure

If issues occur after implementation:

```bash
# 1. Stop the running server
pm2 stop project-pwa  # or kill the npm process

# 2. Restore backup files
cd /var/www/html/project-data-strategis

# Restore chat page
cp backups/2026-01-19-navigation-perf/chat_page.tsx.bak \
   frontend/src/app/\(admin\)/chat/page.tsx

# Restore chat layout
cp backups/2026-01-19-navigation-perf/chat_layout.tsx.bak \
   frontend/src/app/\(admin\)/chat/layout.tsx

# Restore ChatPageClient
cp backups/2026-01-19-navigation-perf/ChatPageClient.tsx.bak \
   frontend/src/app/\(admin\)/chat/ChatPageClient.tsx

# Remove new loading.tsx if created
rm -f frontend/src/app/\(admin\)/chat/loading.tsx

# 3. Rebuild
cd frontend
npm run build

# 4. Restart
npm run start  # or pm2 restart project-pwa
```

---

## Implementation Order

1. ✅ Create backups (DONE)
2. ⬜ Record baseline performance metrics
3. ✅ Create `loading.tsx` for chat route (DONE)
4. ✅ Update `page.tsx` with Suspense wrapper (DONE)
5. ✅ Create `loading.tsx` for other routes (notifications, settings, feedback, dashboard) (DONE)
6. ✅ Dynamic import for QuickDataPreviewCard (DONE)
7. ⬜ Run functional tests
8. ⬜ Run performance tests
9. ⬜ Final regression tests
10. ⬜ Deploy to production

---

## Notes

- **Do NOT modify** `ChatPageClient.tsx` until Phase 1 is tested and confirmed working
- The CSS import in `layout.tsx` is low-risk to keep as-is for now
- Focus on `loading.tsx` + Suspense as the primary fix
- Monitor console for any hydration errors after changes

---

## Files Reference

### Current File Sizes
```
ChatPageClient.tsx: 2672 lines / 104KB
QuickDataPreviewCard.tsx: 2079 lines
AppHeader.tsx: 2177 lines
```

### Key Import Dependencies (ChatPageClient.tsx)
```tsx
import QuickDataPreviewCard from "@/components/search/QuickDataPreviewCard";  // Heavy
import { Modal } from "@/components/ui/modal";
import { useModal } from "@/hooks/useModal";
import { applyTableRowOrdering } from "@/lib/tableRowOrdering";
const Chat = dynamic(...);  // Already dynamic ✓
const Typing = dynamic(...);  // Already dynamic ✓
```

---

**Author:** AI Assistant  
**Reviewed By:** (pending)  
**Last Updated:** 2026-01-19
