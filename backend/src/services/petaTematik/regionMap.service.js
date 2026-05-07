'use strict';

/**
 * Maps BPS indikator dim_value (e.g. "Halmahera Barat", "Kota Ternate")
 * to kdkab code matching properties.kdkab in peta_kabko_malut.geojson.
 *
 * Province total ("Maluku Utara") and unknown values return null —
 * callers should skip them from polygon coloring.
 */

// BPS official kdkab codes for Provinsi Maluku Utara (kdprov=82):
// 8201=Halbar, 8202=Halteng, 8203=Sula, 8204=Halsel, 8205=Halut,
// 8206=Haltim, 8207=Morotai, 8208=Taliabu, 8271=Ternate, 8272=Tidore.
// Must match `properties.kdkab` in peta_kabko_malut.geojson.
const NAME_TO_KDKAB = Object.freeze({
  'halmahera barat': '01',
  'halmahera tengah': '02',
  'kepulauan sula': '03',
  'halmahera selatan': '04',
  'halmahera utara': '05',
  'halmahera timur': '06',
  'pulau morotai': '07',
  'pulau taliabu': '08',
  'ternate': '71',
  'tidore kepulauan': '72',
});

const KDKAB_TO_NAMA = Object.freeze({
  '01': 'Halmahera Barat',
  '02': 'Halmahera Tengah',
  '03': 'Kepulauan Sula',
  '04': 'Halmahera Selatan',
  '05': 'Halmahera Utara',
  '06': 'Halmahera Timur',
  '07': 'Pulau Morotai',
  '08': 'Pulau Taliabu',
  '71': 'Ternate',
  '72': 'Tidore Kepulauan',
});

function dimValueToKdkab(dimValue) {
  if (!dimValue || typeof dimValue !== 'string') return null;
  const cleaned = dimValue
    .replace(/^(Kabupaten|Kota)\s+/i, '')
    .trim()
    .toLowerCase();
  return NAME_TO_KDKAB[cleaned] || null;
}

module.exports = { dimValueToKdkab, KDKAB_TO_NAMA, NAME_TO_KDKAB };
