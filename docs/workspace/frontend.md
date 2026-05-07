# Frontend PWA — Project Line

> Last updated: 2026-03-02

## Current State
- **Framework**: Next.js 16.0.10 + React 19.2.0 + Tailwind CSS v4
- **Port**: 6060 (PM2: pds-frontend)
- **Git**: Submodule (push terpisah)
- **Origin**: TailAdmin template, heavily customized

## Pages
Admin: `/` (dashboard), `/chat`, `/data`, `/brs`, `/feedback`, `/kategori`, `/kategori/[slug]`, `/notifications`, `/publikasi`, `/search`, `/settings`
Auth: `/signin`, `/signup`, `/error-404`

## Key Components
- Chat: 20+ files (`ChatPageClient.tsx` ~3600 lines, `UnifiedActivityFeed`, `DataSummaryBubble`, `ToolCallCard`, etc.)
- Layout: `AppHeader.tsx`, `AppSidebar.tsx`, `MobileBottomNav.tsx`
- PWA: ServiceWorkerRegister, InstallNudge, PushOnboarding, OfflineIndicator

## Contexts: ChatProcess, Sidebar, Theme
## Hooks: useChatRating, useVoiceInput, useLocalMessages, useAnalytics, useGoBack, useModal
## Libs: chatTransport.ts (SSE), chartDataProfiler.ts, tableRowOrdering.ts, geoIntent.ts

## Change Log
| Date | Change | Files Affected |
|---|---|---|
| 2026-03-02 | Fix 404: apiBase missing `/chat` prefix — `GET /threads` → `GET /chat/threads` | ChatPageClient.tsx:233 |
| 2026-03-02 | Fix build: install missing npm packages (clsx, @assistant-ui/react, exceljs, jspdf, jspdf-autotable, lottie-web, react-pdf, pdfjs-dist, highlight.js, driver.js, react-markdown, remark-gfm, rehype-highlight, @tanstack/react-virtual) | package.json |
| 2026-03-02 | Fix build: create 7 missing component/helper files | icons.tsx, TimingBar.tsx, DnaMetadataSection.tsx, ChatExportModal.tsx, ChatRatingModal.tsx, ChatShortcutsModal.tsx, chatHelpers.tsx |
| 2026-03-02 | Fix build: add MODEL_ALIASES + WELCOME_PROMPTS exports | chatConstants.ts |
| 2026-03-02 | Fix build: add ThinkingItem type + extend BackendMessage/MalikaUiMetaV1 | types/chat.ts |
| 2026-03-02 | Fix build: extend component props (MalikaThread, MalikaUserMessage, MalikaAssistantMessage, MalikaQuickReplies, DataSummaryBubble) | AssistantThread.tsx, DataSummaryBubble.tsx |
| 2026-03-02 | Fix build: exclude playwright.config.ts and e2e/ from tsconfig | tsconfig.json |
| 2026-03-02 | Fix splash screen: replace missing logo images with text | AppSplashScreen.tsx |
| 2026-03-02 | Initial audit & documentation | - |
