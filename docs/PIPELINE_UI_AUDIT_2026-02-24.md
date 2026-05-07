# Pipeline Process UI — UX Audit Report

**Date:** 2026-02-24  
**Status:** Backlog (for later implementation)

---

## Current State

Pipeline UI built across 6 files (~1,400 lines):
- `frontend/src/components/chat/UnifiedActivityFeed.tsx` (323 lines)
- `frontend/src/components/chat/feed/FeedComponents.tsx` (608 lines)
- `frontend/src/components/chat/feed/feedHelpers.ts` (140 lines)
- `frontend/src/components/chat/feed/feedTypes.ts` (163 lines)
- `frontend/src/components/chat/TimingBar.tsx` (150 lines)
- `frontend/src/components/chat/AssistantThread.tsx` — MalikaThinkingBubble

## What's Already Excellent

1. **Percent-done progress bar** — ProgressBar gradient fill + step counter (3/8) in header
2. **Streaming step-by-step reveal** — fadeSlideIn animation + staggered delay
3. **Active stage shimmer text** — shimmer-text CSS on active labels
4. **Elapsed timers** — Per-step LiveElapsed (500ms) + global TotalElapsed
5. **Collapsible expand/collapse** — StreamingHeader with auto-expand/auto-collapse
6. **aria-live="polite"** — Accessibility for screen readers
7. **Dark mode support** — Full coverage
8. **Tool call cards with live status** — Spinner/checkmark/elapsed/result summary

## Issues & Recommendations

### 1. CRITICAL: Mobile max-height too tall
- `max-h-[350px]` takes >50% of mobile viewport
- **Fix:** `max-h-[200px] sm:max-h-[350px]`

### 2. MEDIUM: No estimated time remaining
- Shows elapsed but no estimate for 15-40s pipeline
- **Fix:** Show "Biasanya selesai dalam ~30 detik" during first stage, or track rolling average

### 3. MEDIUM: Progress bar stalls during long stages
- Bar sits at 25% for 15s during "search" stage
- **Fix:** Intra-stage trickle animation (slowly advance within stage's slice when >3s)

### 4. MEDIUM: No upcoming stages preview
- Users don't see what's coming next in live mode
- **Fix:** Show 1-2 pending stages (grayed) below active stage

### 5. LOW: Queue wait has no time estimate
- Shows "Posisi antrian: 1" but no duration estimate
- **Fix:** Track rolling average pipeline duration in PipelineSemaphore

### 6. LOW: TimingBar labels too small on mobile
- `text-[8px]` below minimum accessible size (12px)
- **Fix:** `text-[10px] sm:text-[8px]` or hide labels on mobile

### 7. LOW: Double animation on ToolCallCard
- `animate-pulse` on card + `animate-bounce` on icon = visual noise
- **Fix:** Remove `animate-bounce` from icon, keep `animate-pulse` on card

### 8. LOW: No prefers-reduced-motion respect
- All animations ignore OS setting
- **Fix:** Add `@media (prefers-reduced-motion: reduce)` to globals.css

### 9. COSMETIC: Inconsistent emoji icon sizes
- Emojis render differently across platforms
- **Fix:** Consider SVG icons (Lucide) for pipeline stages

### 10. COSMETIC: Knowledge badges lack context
- "📰 3 BRS" unexplained for first-time users
- **Fix:** Add `title` attributes for hover tooltips

## Priority Order

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| 1 | Mobile max-height | 5 min | High |
| 2 | prefers-reduced-motion | 10 min | High |
| 3 | Progress bar trickle | 30 min | Medium |
| 4 | Upcoming stages preview | 20 min | Medium |
| 5 | Remove double animation | 5 min | Low |
| 6 | TimingBar mobile | 5 min | Low |
| 7 | Time estimate | 1-2 hr | Medium |
| 8 | Queue time estimate | 30 min | Low |
