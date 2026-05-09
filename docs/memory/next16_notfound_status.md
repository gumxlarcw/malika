---
name: Next 16 notFound() returns HTTP 200 instead of 404
description: In Next.js 16, calling notFound() from an in-route dynamic server component renders the not-found UI but emits HTTP 200, not 404. Genuinely-unrouted paths still return 404, so this is specific to in-route notFound() calls.
type: feedback
originSessionId: d0319318-3ffd-4ede-bd35-ec8a8064dbe8
---
In Next.js 16 (verified on 16.0.10, the version pds-frontend runs), calling `notFound()` from inside a dynamic server-component page renders the closest `not-found.tsx` UI correctly but the HTTP response status stays at **200**, not 404.

**Why:** Next 16 treats a "matched route that called notFound()" as a soft-404 / graceful empty state and reserves 404 status for "no route matched at all". Confirmed by:
- `curl http://127.0.0.1:6060/this-page-truly-does-not-exist` → **HTTP 404** (no route) ✓
- `curl http://127.0.0.1:6060/kategori/this-slug-does-not-exist` → **HTTP 200** with not-found body ✗

**How to apply:**
- Don't waste time trying to "fix" notFound() to return 404 — adding `export const dynamic = "force-dynamic"`, adding a route-segment `not-found.tsx`, and rebuilding all leave the status at 200. Confirmed empirically while shipping the kategori redesign on 2026-05-08.
- The body still renders correctly, so user-facing UX is fine. Only SEO / crawlers / monitoring get the wrong signal.
- If a real 404 status is required (e.g., for Google indexing exclusion or uptime monitoring), the only working approach is **edge middleware** that intercepts the route and returns a real 404 Response when the slug doesn't exist. That doubles the backend roundtrip for slug validation, so weigh the cost.
- Don't add `not-found.tsx` files just to "fix the status code" — they only override which UI is rendered, not the status.

Files to look at if revisiting: `(admin)/kategori/[slug]/page.tsx` (calls notFound), `(admin)/kategori/[slug]/not-found.tsx` (the segment-level UI). The build output marks `/kategori/[slug]` as `ƒ (Dynamic)` so static optimization is not the cause.
