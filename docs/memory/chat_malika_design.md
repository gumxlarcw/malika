---
name: Chat MALIKA design implementation (Claude Design handoff)
description: How the Chat MALIKA page redesign from Claude Design (claude.ai/design) was structured and implemented in commit 9fac57a (2026-05-08).
type: project
originSessionId: 98a44225-437c-4ae5-bc0a-b7a355ff4e45
---
A Claude Design handoff bundle (`chat-malika.tar.gz`, fetched from `api.anthropic.com/v1/design/h/e-86ojQ1LBP1z0fDlEHCHQ`) shipped HTML/CSS/JS prototypes for the Chat MALIKA page redesign. The bundle contained: `chat-app.jsx`, `chat-thinking.jsx`, `chat-parts.jsx`, `chat-data.jsx`, `chat-icons.jsx`, plus a `Chat MALIKA.html` host with custom CSS animations.

The implementation lives in commit `9fac57a` on the malika repo. **Why:** the user asked to fetch + read + implement the relevant aspects of the design.

**How to apply:**
- The redesign's centerpiece was the **Unified ThinkingCard**: one bubble combining the previous step-list card + "Berpikir…" pill stack. It lives at `frontend/src/components/chat/UnifiedThinkingCard.tsx`. If you're tweaking the typing-state UI, edit there — not in `ChatPageClient.tsx`.
- The empty state has TWO paths in `ChatPageClient.tsx`: `!activeThreadId` (no thread selected, lines ~1786) and `messages.length === 0` (empty thread, lines ~2000). Both use the same branded onboarding now (logo + status dot + 4 SAMPLE_QUERIES category cards). Keep them in sync if you change one.
- `SAMPLE_QUERIES` in `chatConstants.ts` is the source of truth for sample query cards. To add or change a category, edit there. Each entry has `{ id, label, iconKey, color, examples }` — `iconKey` maps to inline SVG paths in the EmptyState JSX.
- CSS animations from the design (`malika-pulse`, `malika-pulse-inner`, `malika-pulse-slow`, `malika-rail-glow`, `malika-drawer-in`, `malika-dot`) live in `frontend/src/app/globals.css`. Pulse + dot are reduce-motion exempt (essential aliveness); rail-glow + drawer-in are suppressed.
- QuickReplies layout: `grid grid-cols-2` on mobile, `flex flex-wrap` on desktop, in `MalikaQuickReplies` (AssistantThread.tsx).
- The `pendingSampleQueryRef` ref in ChatPageClient.tsx plumbs sample-query cards from the no-thread empty state through `createThread()` → activeThreadId-watching effect → `sendToBackend()`. Don't remove it without also restructuring the EmptyState category-card onClick.

**What was NOT implemented from the design** (deliberate scope cut):
- Sidebar redesign (groups, search, collapse-to-rail) — would have required restructuring the existing thread-list integration with assistant-ui.
- Composer redesign (single rounded card, voice states, model picker dropdown) — existing composer is functional and integrates with voice/file/model state in subtle ways.
- Header redesign (compact thread name + status indicator) — existing header has multiple integrations (export, voice, dark-mode toggle).

These are fair targets for a future pass.
