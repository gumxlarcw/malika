#!/usr/bin/env bash
# Membuktikan dump magang bebas PII. Keluar bukan-nol bila ada temuan.
# Dump yang tidak lolos skrip ini TIDAK boleh dibagikan.
set -uo pipefail
DUMP="${1:?pemakaian: verify-dev-seed.sh /root/dev-seed-YYYY-MM-DD.sql.gz}"
FAIL=0

EMPTY=(
  chat_messages chat_threads user_memory chat_feedbacks chat_message_flags
  chat_error_patterns active_sessions push_subscriptions push_send_logs
  admin_audit_logs page_views fetch_logs webapi_health_logs
  automation_run_logs auto_tune_logs dna_cache data_search_stats
  data_merged_cache data_processed_cache app_notifications
)

echo "── tabel yang wajib nol baris ──"
for t in "${EMPTY[@]}"; do
  if zgrep -qE "^INSERT INTO \`$t\`" "$DUMP"; then
    echo "GAGAL: $t memuat baris data"; FAIL=1
  else
    echo "ok   : $t kosong"
  fi
done

echo "── retrieval_chunks tidak boleh memuat baris chat_thread ──"
# Hanya baris INSERT yang diperiksa. Literal 'chat_thread' di dalam DDL adalah
# definisi enum dan memang wajar ada — yang tidak wajar adalah nilainya terpakai.
if zgrep -E "^INSERT INTO \`retrieval_chunks\`" "$DUMP" | grep -q "'chat_thread'"; then
  echo "GAGAL: retrieval_chunks memuat baris hasil embedding percakapan user"; FAIL=1
else
  echo "ok   : retrieval_chunks bebas chat_thread"
fi

echo "── pemindaian pola PII di dalam isi teks ──"
# Literal hex dari kolom VECTOR(768) dibuang lebih dulu. Tanpa ini, deret hex
# seperti `...BD0846263909...` cocok dengan pola nomor HP dan gerbang ini
# selalu merah karena alasan palsu (terbukti 2026-08-12).
# `devadmin@local.test` adalah akun seed buatan generator, bukan PII.
# Escape `\n`/`\r`/`\t` diubah jadi spasi lebih dulu. Di teks SQL keduanya
# adalah karakter biasa bagi regex, sehingga menempel ke token tetangganya —
# terbukti 2026-08-12 menyebabkan DUA arah kesalahan: nomor HP lolos deteksi
# (`Whatsapp:\n0821…`) dan email semu terdeteksi (`MINUMAN\n@gmall.com`
# terbaca sebagai `n@gmall.com`, padahal sumbernya memang tanpa local-part).
SCAN=$(mktemp)
trap 'rm -f "$SCAN"' EXIT
zcat -f "$DUMP" \
  | sed -E 's/\\[nrt]/ /g; s/0x[0-9A-Fa-f]+//g; s/devadmin@local\.test//g' > "$SCAN"
# Klasifikasi per-tabel tidak menangkap PII yang tertanam di isi dokumen.
# Audit 2026-08-12 menemukan email pribadi, nomor HP, dan calon NIK di dalam
# knowledge_base.content dan retrieval_chunks.content_text. Generator
# meredaksinya; blok ini membuktikan redaksinya benar-benar bekerja.
check() {
  local label="$1" pat="$2" allow="${3:-0}"
  local n; n=$(grep -coE "$pat" "$SCAN" || true)
  if [ "$n" -gt "$allow" ]; then
    echo "GAGAL: $label — $n kecocokan (maks $allow)"; FAIL=1
  else
    echo "ok   : $label bersih ($n kecocokan)"
  fi
}
# Token redaksi ([email-redacted] dst) tidak cocok dengan pola mana pun di
# bawah, jadi setiap kecocokan = PII asli yang lolos.
check "email"         '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' 0
check "nomor HP +62"  '\+62[0-9]{8,13}' 0
check "nomor HP 08xx" '(^|[^0-9])08[0-9]{8,11}([^0-9]|$)' 0
# NIK dicek BERJANGKAR pada labelnya, bukan "16 digit apa pun". Dump ini memuat
# ekstraksi PDF publikasi statistik yang penuh deret angka panjang; pemeriksaan
# borongan akan selalu merah dan melatih orang untuk mengabaikan gerbang ini.
check "NIK berlabel"  '(NIK|KTP)[^0-9]{0,20}[0-9]{16}' 0

echo "── ukuran ──"
echo "  $(du -h "$DUMP" | cut -f1)"
[ "$FAIL" -eq 0 ] && echo "✓ LULUS" || echo "✗ ADA TEMUAN — jangan dibagikan"
exit $FAIL
