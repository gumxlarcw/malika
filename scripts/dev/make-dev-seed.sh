#!/usr/bin/env bash
# Menghasilkan dump `project_data_strategis` yang aman diberikan ke anak magang.
# Dijalankan sebagai root di server. Output: /root/dev-seed-<tanggal>.sql.gz
#
# Hasilnya WAJIB dibuktikan dengan verify-dev-seed.sh sebelum dibagikan.
set -euo pipefail

SRC=project_data_strategis
OUT="/root/dev-seed-$(date +%F).sql"
KB_LIMIT=2000
RC_LIMIT=3000

# --single-transaction : snapshot konsisten TANPA LOCK TABLES. Wajib —
#   mysqldump polos mengunci tabel, dan pada DB 2,3 GB itu menahan tulisan
#   pds-backend produksi selama dump berjalan.
# --quick              : streaming baris, tidak menumpuk hasil di memori
#   (retrieval_chunks sendirian 1 GB, dan box ini sudah sesak).
DUMP_OPTS=(--single-transaction --quick --skip-comments)

# Isi penuh — referensi kecil, tanpa PII.
FULL=(
  data_sources indicator_meta indicator_metric_meta data_period_map
  automation_configs app_settings indexed_brs_publikasi exim_pod_filters
  innodb_ft_stopwords indicator_static_table data_source_search_terms
)

# Hanya struktur, NOL baris — PII pengguna, log, dan cache yang bisa dibangun ulang.
EMPTY=(
  chat_messages chat_threads user_memory chat_feedbacks chat_message_flags
  chat_error_patterns active_sessions push_subscriptions push_send_logs
  admin_audit_logs page_views fetch_logs webapi_health_logs
  automation_run_logs auto_tune_logs dna_cache data_search_stats
  data_merged_cache data_processed_cache app_notifications users
)

echo "→ struktur seluruh tabel"
{
  echo "SET FOREIGN_KEY_CHECKS=0;"
  mysqldump "${DUMP_OPTS[@]}" --no-data --routines --events "$SRC"
} > "$OUT"

echo "→ data tabel referensi (${#FULL[@]} tabel)"
mysqldump "${DUMP_OPTS[@]}" --no-create-info --hex-blob \
  "$SRC" "${FULL[@]}" >> "$OUT"

# ── Dua tabel isi dokumen: disalin ke DB sementara lalu diredaksi DI SUMBER ──
#
# Redaksi WAJIB dilakukan pada kolom teks di dalam database, BUKAN dengan sed
# pada teks SQL hasil dump. `retrieval_chunks` memuat kolom `embedding`
# VECTOR(768) yang ter-hex-blob menjadi literal `0xAB12…`; pola nomor telepon
# yang cukup longgar untuk menangkap `Whatsapp:\n0821…` juga cocok di dalam
# literal hex itu (huruf hex memenuhi `[^0-9]`). Terbukti 2026-08-12: sed
# menyuntikkan token redaksi ke 3 blob embedding dan seluruh dump gagal dimuat
# dengan `ERROR 1064`. Di level kolom, batas antara teks dan biner jelas.
TMP=pds_seed_tmp

KB_MAX=$(mysql -N -e \
  "SELECT id FROM knowledge_base ORDER BY id LIMIT 1 OFFSET $((KB_LIMIT-1));" "$SRC")
echo "→ menyiapkan salinan sementara ($TMP) untuk diredaksi"

mysql <<SQL
DROP DATABASE IF EXISTS $TMP;
CREATE DATABASE $TMP;
CREATE TABLE $TMP.knowledge_base   LIKE $SRC.knowledge_base;
CREATE TABLE $TMP.retrieval_chunks LIKE $SRC.retrieval_chunks;

INSERT INTO $TMP.knowledge_base SELECT * FROM $SRC.knowledge_base
  WHERE id <= $KB_MAX;

-- source_kind='chat_thread' DIBUANG: barisnya adalah hasil embedding
-- percakapan user, jadi content_text-nya memuat isi obrolan. Tanpa filter ini
-- PII masuk kembali setelah chat_messages dikosongkan.
INSERT INTO $TMP.retrieval_chunks SELECT * FROM $SRC.retrieval_chunks
  WHERE source_kind <> 'chat_thread'
    AND (source_kind <> 'knowledge_chunk' OR source_ref_id <= $KB_MAX)
  ORDER BY id LIMIT $RC_LIMIT;
SQL

# REGEXP_REPLACE MariaDB memakai PCRE, jadi lookaround tersedia. Hanya kolom
# teks yang disentuh — `embedding` tidak ikut dalam satu pun pernyataan ini.
redact() {  # redact <tabel> <kolom>
  mysql -e "UPDATE $TMP.$1 SET \`$2\` =
      REGEXP_REPLACE(
      REGEXP_REPLACE(
      REGEXP_REPLACE(
      REGEXP_REPLACE(\`$2\`,
        '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\\\.[A-Za-z]{2,}', '[email-redacted]'),
        '\\\\+62[0-9]{8,13}', '[hp-redacted]'),
        '(?<![0-9])08[0-9]{8,11}(?![0-9])', '[hp-redacted]'),
        '(NIK|KTP)([^0-9]{0,20})[0-9]{16}', '\$1\$2[nik-redacted]')
    WHERE \`$2\` IS NOT NULL;"
}

# Kolom teks DITEMUKAN dari information_schema, bukan didaftar manual.
# Daftar manual sempat melewatkan `knowledge_base.indicator_index` (audit
# 2026-08-12) dan PII lolos ke dump. Enumerasi otomatis juga tetap benar
# ketika skema berubah. Tipe biner/VECTOR tidak pernah masuk daftar ini.
text_columns() {
  mysql -N -e "SELECT column_name FROM information_schema.columns
               WHERE table_schema='$TMP' AND table_name='$1'
                 AND data_type IN ('varchar','char','text','tinytext',
                                   'mediumtext','longtext');"
}

echo "→ redaksi kolom teks (embedding tidak disentuh)"
for t in knowledge_base retrieval_chunks; do
  cols=$(text_columns "$t")
  echo "   $t: $(echo "$cols" | tr '\n' ' ')"
  for c in $cols; do redact "$t" "$c"; done
done

echo "→ knowledge_base: $KB_LIMIT baris (id <= $KB_MAX)"
mysqldump "${DUMP_OPTS[@]}" --no-create-info --hex-blob \
  "$TMP" knowledge_base >> "$OUT"

echo "→ retrieval_chunks: maks $RC_LIMIT baris, tanpa chat_thread"
mysqldump "${DUMP_OPTS[@]}" --no-create-info --hex-blob \
  "$TMP" retrieval_chunks >> "$OUT"

mysql -e "DROP DATABASE $TMP;"

echo "→ seed admin dev (password dummy 'magang123', bcrypt cost 10)"
cat >> "$OUT" <<'SEED'
INSERT INTO users (id, name, email, password_hash, role, created_at, updated_at)
VALUES (1, 'Dev Admin', 'devadmin@local.test',
        '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
        'admin', NOW(), NOW());
SEED

echo "SET FOREIGN_KEY_CHECKS=1;" >> "$OUT"

# Catatan: 16 digit TIDAK diredaksi borongan. Deret seperti
# `975675342187124\n2434113678347830` berasal dari ekstraksi PDF
# "Maluku Utara Dalam Angka" — angka tabel statistik publik, bukan NIK.
# Diverifikasi 2026-08-12: 0 baris memuat 16 digit berdekatan label NIK/KTP.
# Redaksi borongan akan merusak data yang justru dibutuhkan magang, sekaligus
# membuat gerbang verifikasi selalu merah sehingga orang belajar mengabaikannya.

gzip -f "$OUT"
echo "✓ selesai: $OUT.gz ($(du -h "$OUT.gz" | cut -f1))"
echo "  tabel dikosongkan: ${#EMPTY[@]} — dibuktikan oleh verify-dev-seed.sh"
