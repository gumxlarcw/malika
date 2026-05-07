# ThinkingFeed — Claude CLI-Style Unified Thinking Display

**Date:** 2026-03-18
**Status:** Approved

## Summary

Replace `UnifiedActivityFeed` + `ThinkingBubble` in the chat typing bubble with a single `ThinkingFeed` component that displays pipeline checkpoints + raw Extended Thinking text in one unified flow, styled like Claude Code CLI.

## Visual Spec

### During Streaming

```
✓ Mengenali topik & wilayah          46ms
✓ 5 sumber data ditemukan           327ms
✓ 2 BRS + 3 Publikasi dimuat          4s
✓ 3 baris data tabel dimuat          45ms
✓ Konteks disusun (MALIKA Deep)      10s

⟳ Thinking...                         5s

  Saya perlu menganalisis data
  kemiskinan Maluku Utara...

  Dari BRS "Profil Kemiskinan 2024":
  - Persentase: 6.32% (Maret 2024)
  - GK: Rp604.460/kapita/bulan
  █
```

### After Streaming (Visible, Collapsible)

```
✓ Mengenali topik & wilayah          46ms
✓ 5 sumber data ditemukan           327ms
✓ 2 BRS + 3 Publikasi dimuat          4s
✓ 3 baris data tabel dimuat          45ms
✓ Konteks disusun (MALIKA Deep)      10s
✓ Thought for 8s               [▼ Hide]

  Saya perlu menganalisis data...
  (full text, scrollable)
```

## Architecture

### New Component: `ThinkingFeed`

**Location:** `components/chat/ThinkingFeed.tsx`

**Props:**
```typescript
interface ThinkingFeedProps {
  checkpoints: Checkpoint[];
  reasoningText: string;
  isStreaming: boolean;
  isThinkingActive: boolean;
  onStop?: () => void;
  onRetry?: () => void;
}

interface Checkpoint {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'done';
  elapsedMs?: number;
  detail?: string;
}
```

### SSE → Checkpoint Mapping

| SSE thinking step | Checkpoint Label | Status Trigger |
|---|---|---|
| `step=query` | Mengenali topik & wilayah | done immediately |
| `step=sources` | `{count}` sumber data ditemukan | done immediately |
| `step=knowledge` | `{brsCount}` BRS + `{pubCount}` Publikasi dimuat | done immediately |
| `step=data` | `{count}` baris data tabel dimuat | done immediately |
| `step=reasoning` | Konteks disusun (`{modelLabel}`) | done immediately |
| `step=thinking-delta` (first) | Thinking... (with elapsed timer) | active while streaming |
| Stream finishes | Thought for `{elapsed}` | done |

Thinking items arrive as `done` (they fire after their pipeline stage completes). The `thinking-delta` step transitions the thinking checkpoint from `active` → `done` when streaming ends.

### Behavior

- **Checkpoints:** Appear one by one. Checkmark icon + label + elapsed badge (right-aligned).
- **Thinking section:** Starts when first `thinking-delta` arrives. Always expanded. Auto-scroll.
- **Post-stream:** All checkpoints + thinking text remain visible. Thinking text collapsible via `[Hide/Show]` toggle. Checkpoints always visible.
- **Historical (page reload):** Restored from `uiMeta.thinkingItems`. Collapsed by default, expandable.

### Styling

| Element | Style |
|---|---|
| Checkpoint label | `text-xs text-gray-600 dark:text-gray-400` |
| Elapsed badge | `text-[10px] font-mono text-gray-400 tabular-nums` |
| Spinner (active) | Animated SVG, `text-violet-500` |
| Checkmark (done) | SVG check, `text-emerald-500` |
| Thinking text | `font-mono text-[12.5px] leading-[1.7] text-gray-700 dark:text-gray-200` |
| Thinking text indent | `pl-6` (indented under checkpoint) |
| Cursor | `w-[3px] h-[15px] bg-violet-500 animate-pulse` |
| Container | `border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50/60 dark:bg-gray-900/30` |

### State Changes in ChatPageClient

**Keep:**
- `thinkingItems` state — used to build checkpoints
- `reasoningText` + `reasoningBufferRef` — raw thinking text
- `isThinkingActive` — whether thinking-delta is streaming
- `onThinking` handler — unchanged

**New:**
- `checkpoints` state — derived from `thinkingItems` in a useMemo/useEffect

**Remove from typing bubble:**
- `<UnifiedActivityFeed>` (keep for historical display)
- `<ThinkingBubble>` (merged into ThinkingFeed)
- `processSteps` — no longer rendered (backend still sends status events, just not displayed)

### Files Changed

1. **New:** `components/chat/ThinkingFeed.tsx`
2. **Edit:** `ChatPageClient.tsx` — replace typing bubble render, add checkpoint derivation
3. **No change:** Backend pipeline, SSE events, proxy

### What's NOT Changed

- Backend pipeline stages — all stay as-is
- SSE event format — no changes
- Historical thinking display (UnifiedActivityFeed) — still used for old messages
- ThinkingBubble.tsx — kept as file but no longer imported in typing bubble
