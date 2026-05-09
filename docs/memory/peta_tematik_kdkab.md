---
name: Peta Tematik kdkab BPS standard
description: BPS official kdkab codes for Maluku Utara — beware: 03=Kepulauan Sula, 05=Halmahera Utara (NOT the other way around). Earlier bug had these swapped.
type: project
originSessionId: 701d1992-8b19-4e01-ae1b-c294cbda954f
---
BPS official kdkab codes for Provinsi Maluku Utara (kdprov=82):

- 8201 / `01` = Halmahera Barat
- 8202 / `02` = Halmahera Tengah
- **8203 / `03` = Kepulauan Sula** ← easy to confuse
- 8204 / `04` = Halmahera Selatan
- **8205 / `05` = Halmahera Utara** ← easy to confuse
- 8206 / `06` = Halmahera Timur
- 8207 / `07` = Pulau Morotai
- 8208 / `08` = Pulau Taliabu
- 8271 / `71` = Kota Ternate
- 8272 / `72` = Kota Tidore Kepulauan

**Why:** Project's GeoJSON `peta_kabko_malut.geojson` follows BPS standard. Backend `regionMap.service.js` had 03/05 swapped (Halut=03, Sula=05) until 2026-05-07 — caused all map colors and bar-chart highlights for these two regions to display the wrong region's number, only visible after linked-hover feature was added.

**How to apply:** When wiring any region/kdkab logic for Maluku Utara, verify against the GeoJSON `properties.kdkab` first, never author kdkab tables from memory. The single canonical source is `backend/src/services/petaTematik/regionMap.service.js` (`KDKAB_TO_NAMA` and `NAME_TO_KDKAB`). If adding any new kab/kota mapping table elsewhere, import from regionMap instead of duplicating.
