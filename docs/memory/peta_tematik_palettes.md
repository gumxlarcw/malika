---
name: Peta Tematik palette + hover outline rule
description: Choropleth supports 5 palettes; hover outline color is intentionally complementary, not a same-hue shade — needed so the highlight stays visible across all 5 bins.
type: project
originSessionId: 701d1992-8b19-4e01-ae1b-c294cbda954f
---
`backend/src/services/petaTematik` paint pipeline uses `frontend/src/app/(admin)/peta-tematik/colorScale.ts` palettes:

- **blue**: brand-50 → brand-900, hover outline = red-600 (`#dc2626`)
- **emerald**: emerald-50 → emerald-900, hover outline = red-600
- **amber**: amber-50 → amber-900, hover outline = blue-700
- **rose**: rose-50 → rose-900, hover outline = green-700
- **purple**: purple-50 → purple-900, hover outline = green-600

**Why complementary, not same-hue:** A darker shade of the palette would blend into the deepest bin and disappear on dark polygons. The hover outline is meant to clash with all 5 bins simultaneously, so it tracks across the whole ramp.

**How to apply:** When adding a new palette, hand-pick `hoverOutline` against the *darkest* bin first — if it doesn't read clearly there, it's wrong. Don't reuse a value from `colors[]`. Selected palette persists via URL param `?palette=<id>`. Map uses Leaflet `setStyle({ color, weight, opacity })` directly (no CSS class), so the outline color tracks state without a class swap.
