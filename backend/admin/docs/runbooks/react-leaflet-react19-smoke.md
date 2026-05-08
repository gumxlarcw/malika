# React-Leaflet × React 19 Smoke Verification

> Run after any `react`, `react-dom`, or `react-leaflet` version change.

## Why this exists
`react-leaflet@4.2.1` officially declares peer `react@^18.0.0`, but this admin runs React 19.2.1. We install via `--legacy-peer-deps`. Production has worked at runtime, but no audit-level confirmation exists. This runbook is the audit.

A clean upgrade path is `react-leaflet@5.0.0` (peer `react@^19.0.0`) — but it has API changes from 4.x. Adopt only when willing to handle the breaking changes.

## Affected pages
- `/backend/dashboard` (Peta Tematik section)
- `/backend/geojson`
- `/backend/period`
- `/backend/period-availability`

## Manual checklist (per page)

1. Navigate to the page logged in as an admin.
2. **Render:** Map tiles appear within 3s. No "Map container is being reused" console error.
3. **Pan/zoom:** Mouse drag and scroll-zoom both work; tiles re-fetch.
4. **Markers/polygons:** Each visible marker or polygon receives click events.
5. **Popup:** Click a marker → popup opens, contains expected content, closes on outside click.
6. **Re-mount:** Navigate away (e.g., to `/users`), then back. Map re-initializes without warnings.
7. **Console:** Open DevTools console. NO red errors. Yellow warnings about `findDOMNode` or `useLayoutEffect on the server` are tolerable for now (they indicate React 19 strictness, not breakage).

## If any step fails

Open an issue tagged `react19-leaflet`. Pinned upgrade path:
- Try `react-leaflet@5.0.0` (which targets React 19) and migrate API call-sites.
- Interim: pin `react-leaflet@4.2.1` and silence `findDOMNode` deprecation in the layout.
