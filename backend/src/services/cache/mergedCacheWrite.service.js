/**
 * Penulisan `data_merged_cache` yang tidak boros binlog.
 *
 * `binlog_format=ROW` menulis citra sebelum + sesudah untuk setiap UPDATE, dan
 * `merged_json` bertipe longtext (rata-rata ~450 KB, terbesar 1,7 MB). Karena
 * `updated_at` selalu diisi `new Date()`, baris yang isinya identik tetap
 * ditulis ulang. Diukur dari binlog 2026-08-28: satu UPDATE semacam itu
 * menghabiskan 3,4 MB binlog hanya untuk mengubah satu timestamp, dan
 * `data_merged_cache` menyumbang ~71% dari 9,3 GB binlog/hari.
 *
 * Perbandingan dilakukan di sisi aplikasi, lalu penulisannya tetap memakai
 * `Model.upsert()` yang asli.
 *
 * JANGAN ganti dengan raw `sequelize.query` + `replacements`: kedua config
 * (db.js / db_bps.js) tidak menyetel opsi `timezone`, jadi jalur model memakai
 * default UTC sedangkan `replacements` memakai zona lokal proses (WIT, +09).
 * Versi pertama patch ini memakai raw query dan menggeser `last_update` maju
 * 9 jam pada setiap penulisan (38 baris terdampak, sudah dipulihkan).
 *
 * Aman: tidak ada pembaca yang memakai `updated_at`. Pemilihan baris terbaru
 * memakai `last_update` (metadataReindex.service.js, dan automationRunner pada
 * resolveLastUpdate + smart-skip). Baris yang berubah tetap tertulis utuh.
 *
 * Pengawas: /opt/bps-fleet/30-data/cek-binlog-boros.sh di node ops.
 */

/**
 * Tulis satu baris merged cache, tapi lewati kalau isinya tidak berubah.
 *
 * @param {import('sequelize').ModelStatic<any>} Model MergedCache atau MergedCacheBps
 * @param {{source_id:number, signature:string, merged_json:string,
 *          last_update:Date, updated_at:Date}} row
 * @returns {Promise<boolean>} true bila baris benar-benar ditulis
 */
async function upsertMergedCacheIfChanged(Model, row) {
  try {
    const existing = await Model.findOne({
      where: { source_id: row.source_id, signature: row.signature },
      attributes: ['merged_json', 'last_update'],
    });
    if (existing) {
      const toMs = (v) => (v ? new Date(v).getTime() : null);
      if (existing.merged_json === row.merged_json
          && toMs(existing.last_update) === toMs(row.last_update)) {
        return false;
      }
    }
  } catch {
    // best-effort: kalau perbandingan gagal, tulis seperti perilaku semula
  }
  await Model.upsert(row);
  return true;
}

module.exports = { upsertMergedCacheIfChanged };
