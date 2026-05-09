---
name: Leaflet PNG export needs canvas renderer
description: When exporting a Leaflet map via html2canvas/dom-to-image, polygons rendered as SVG end up misaligned with tiles. Set preferCanvas=true so vectors render to canvas (which html2canvas can composite alongside tile images correctly).
type: feedback
originSessionId: 701d1992-8b19-4e01-ae1b-c294cbda954f
---
If a Leaflet map is being exported to PNG via any DOM-to-canvas library (html2canvas, html2canvas-pro, dom-to-image, etc.), the **vector overlay (polygons / polylines / circles) will be misaligned with the tile basemap** unless you switch the map renderer to canvas.

**Why:** Leaflet's default SVG renderer positions vectors via a CSS `transform: translate3d(...)` on `.leaflet-overlay-pane`. DOM-to-canvas libraries serialize SVG into the output image but don't reliably compose the ancestor transform — vectors end up at one set of pixel coords while tiles render at another. Visible result: "melenceng jauh" (very off) misalignment in the exported PNG.

**How to apply:**
- Pass `preferCanvas={true}` to `<MapContainer>` (react-leaflet) or `preferCanvas: true` to `L.map()`.
- Polygons then render into a `<canvas>` element positioned just like the tile `<img>` elements — DOM-to-canvas libraries copy them in lockstep.
- Bonus: also wait for tiles to finish loading before capture — poll `.leaflet-tile` count vs `.leaflet-tile.leaflet-tile-loaded` count, bounded by a timeout, so we don't capture a half-loaded basemap.
- All Path APIs (`setStyle`, `bringToFront`, `bindTooltip`, mouse events) work identically with the canvas renderer. The differences only matter if you rely on per-element CSS pseudo-classes or SVG-specific filters.
