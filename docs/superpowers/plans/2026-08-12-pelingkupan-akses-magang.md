# Pelingkupan Akses Magang — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Memberi anak magang sandbox MALIKA yang hidup di server ini, tanpa kemampuan merusak 44 service produksi lain.

**Architecture:** Tiga pagar berlapis — identitas (user Linux non-privileged dengan PM2 daemon sendiri), rahasia (`.env` ditutup, database sandbox terpisah, user koneksi Metabase terisolasi), dan sumber daya (batas di sisi milik magang saja). Tidak ada satu pun langkah yang mengubah konfigurasi service produksi yang sedang berjalan.

**Tech Stack:** Debian trixie, systemd, OpenSSH, PM2 (per-user), MariaDB 11.8, Metabase, Cloudflare Tunnel, GitHub.

## Global Constraints

- **JANGAN ubah setelan memori box.** `earlyoom`, watchdog daemon, swap, `sysctl`, dan slice systemd yang ada tidak boleh disentuh. Keputusan pemilik server 2026-08-12.
- **JANGAN berikan akses PM2 root** (`/root/.pm2`) dalam kondisi apa pun.
- **JANGAN berikan akses tulis** ke `/etc/cloudflared/config.yml` atau `/root/.cloudflared/`.
- **JANGAN restart service produksi** kecuali langkah itu menyebutkannya eksplisit. Perubahan permission `.env` tidak memerlukan restart.
- Setiap file yang diubah **wajib di-backup lebih dulu**: `cp {file} {file}.backup` (per CLAUDE.md global).
- Setiap task diakhiri **verifikasi yang dijalankan sebagai user magang**, bukan sebagai root. Pagar yang tidak diuji dari sisi luar bukan pagar.
- Port sandbox: backend `5200`, admin `5250`, frontend `6200` (diverifikasi bebas 2026-08-12). **Sama untuk kedua magang, disengaja** — `EADDRINUSE` menjadi mutex yang ditegakkan kernel, menggantikan aturan "satu orang saja" yang mengandalkan disiplin.
- **2 anak magang, akun terpisah** (`magang1`, `magang2`) dengan database masing-masing (`pds_dev1`, `pds_dev2`). Akun bersama ditolak: satu daemon PM2 bersama membuat `pm2 restart all` oleh satu orang mematikan pekerjaan yang lain, dan jejak audit hilang.
- **JANGAN pasang `ulimit -v`/`as` untuk magang.** Node+ONNX memesan VSZ ~5 GB dengan RSS ~430 MB; batas `as` mematikan aplikasi tanpa membatasi memori nyata. Pagar RSS ditangani `max_memory_restart` PM2.
- Commit di repo MALIKA: `git add <path>` spesifik, **jangan `-A`** (ada perubahan sesi lain), dan **tanpa trailer `Co-Authored-By`**.

---

## File Structure

| Path | Tanggung jawab | Aksi |
|---|---|---|
| `/etc/security/limits.d/magang.conf` | Batas resource user magang | Create |
| `/etc/ssh/sshd_config` | Blok `Match Group magang` di akhir file | Modify (append) |
| `scripts/dev/make-dev-seed.sh` | Generator dump tersanitasi | Create |
| `scripts/dev/verify-dev-seed.sh` | Pembuktian dump bebas PII | Create |
| `backend/.env.example` | Lengkapi 5 key yang hilang | Modify |
| `ecosystem.dev.js` | Definisi PM2 sandbox (port + batas memori) | Create |
| `docs/ONBOARDING.md` | Panduan magang dari nol | Create |

Task 1, 2, 3, 5 menyentuh sistem (di luar repo). Task 4, 6, 7 menyentuh repo dan menghasilkan commit.

---

## Audit Dampak Lintas-Project (diverifikasi 2026-08-12)

Rencana ini **tidak mengubah satu pun password yang sudah ada.** Hanya ada dua `CREATE USER` (keduanya user baru); tidak ada `ALTER USER`, `SET PASSWORD`, maupun `GRANT` pada user lama.

Diverifikasi juga bahwa **tidak ada password yang dipakai bersama lintas project**: nilai `*PASS*`/`*PASSWORD*` dari 13 file `.env` dan dari koneksi Metabase dibandingkan lewat hash SHA-256 — semuanya unik. Satu-satunya duplikat berada **di dalam satu file yang sama** (`tamdes-web.frozen-20260516/.env`, dua key bernilai sama), bukan antar-project. Jadi tidak ada "password universal" yang bisa ikut terbawa.

| Task | Menyentuh milik project lain? | Dampak & mitigasi |
|---|---|---|
| 1 | **Ya** — 13 `.env` milik 12 project | Permission saja, isi tidak diubah. Satu file dibaca `www-data` (mod_wsgi/`bista`) → diberi `640 root:www-data`, bukan `600`. Rollback penuh tersedia dari rekaman Step 1, plus pemantauan 24 jam |
| 2 | Tidak | User & grup baru. `limits.d` khusus `@magang`. `sshd_config` global tapi blok `Match Group magang` — divalidasi `sshd -t` lalu `reload` (bukan `restart`), sesi berjalan selamat |
| 3 | Tidak | `CREATE DATABASE` + `CREATE USER` baru. Grant user lain tidak disentuh |
| 4 | Membaca DB produksi | `--single-transaction` ⇒ tanpa `LOCK TABLES`, tulisan `pds-backend` tidak tertahan. `--quick` ⇒ tidak menumpuk 1 GB di memori |
| 5 | **Ya** — instance Metabase bersama | `CREATE USER` baru; password `metabase_bps_ro` **tidak** diubah. Data source `metabase_db` punya **0 kartu** ⇒ dihapus tanpa dampak. `DATA BPS` menopang 96 kartu + 2 dashboard, dan **0** di antaranya menyeberang DB ⇒ mempersempit user koneksi aman. Grup **All Users tidak disentuh** |
| 6 | Opsional saja | Edit `config.yml` hanya bila URL dev dibutuhkan; ada backup, `ingress validate`, dan pengecekan hostname produksi setelah reload |
| 7 | Tidak | GitHub saja |

**Yang sengaja TIDAK dilakukan rencana ini**, karena berdampak ke project lain dan butuh keputusan tersendiri: rotasi password `metabase_bps_ro`, menyetel `MB_ENCRYPTION_SECRET_KEY`, mengubah `bind-address` MariaDB, dan menghapus user `root@%`/`admin@%`.

---

## Task 1: Tutup 13 `.env` yang terbaca semua user

Dikerjakan **pertama** dan **sebelum user magang dibuat**. Selama file-file ini `644`, semua pagar lain tidak ada artinya.

**Files:**
- Modify (permission saja, isi tidak berubah): 13 file `.env` di daftar bawah

**Interfaces:**
- Consumes: —
- Produces: kondisi prasyarat bagi Task 2. Tidak ada artefak kode.

- [x] **Step 1: Rekam kondisi awal sebagai jalur balik**

```bash
for f in \
  /var/www/html/project-data-strategis/backend/.env \
  /var/www/html/gamalama/.env \
  /var/www/html/big-data/.env \
  /var/www/html/sipentas/backend/.env \
  /var/www/html/django-project/django_school/.env \
  /var/www/html/tamdes-frontend.frozen-20260516/.env \
  /var/www/html/tamdes-web.frozen-20260516/.env \
  /var/www/html/knowledge-base/backend/.env \
  /opt/notulen-ai/.env \
  /opt/apify-gateway/.env \
  /opt/tiktok-signature/.env \
  /opt/social-gateway/.env \
  /opt/openclaw/.env ; do
  stat -c '%a %U:%G %n' "$f"
done | tee /root/env-perms-before-2026-08-12.txt
```

Expected: 13 baris, semuanya `644`.

- [x] **Step 2: Buktikan kebocorannya nyata (uji negatif, sebelum perbaikan)**

```bash
useradd -M -s /usr/sbin/nologin probetest 2>/dev/null || true
setpriv --reuid=$(id -u probetest) --regid=$(id -g probetest) --clear-groups \
  head -c 60 /var/www/html/gamalama/.env
```

Expected: isi file **terbaca**. Inilah yang sedang diperbaiki. Kalau sudah gagal terbaca, catat dan lanjut.

- [x] **Step 3: Ubah permission — DUA perlakuan, jangan disamakan**

`chmod` tidak mengubah pemilik maupun isi, jadi `.backup` tidak diperlukan — jalur baliknya adalah file rekaman dari Step 1.

**Kenapa tidak semuanya `600`:** `600` hanya aman bila pembaca file adalah `root` atau pemilik file itu sendiri. Audit 2026-08-12 menemukan satu file yang dibaca proses **`www-data`**, dan `600 root:root` akan mematikan layanannya.

| File | Pembaca | Perlakuan |
|---|---|---|
| `django-project/django_school/.env` | Apache mod_wsgi (`WSGIDaemonProcess` **tanpa `user=`** ⇒ jalan sebagai `www-data`), melayani `bista.bpsmalut.com` | `chown root:www-data` + **`640`** |
| 12 file lainnya | PM2 root, atau `gumxlarcw` untuk file miliknya sendiri, atau docker-compose sebagai root (`big-data`) | **`600`** |

Dua perlakuan itu sama-sama menghapus akses baca untuk "user lain" — yang memang tujuan kita — tanpa memutus pembaca sahnya.

```bash
# 12 file: 600
grep -v 'django_school' /root/env-perms-before-2026-08-12.txt | \
while read -r mode owner path; do
  chmod 600 "$path" && echo "600  $path"
done

# 1 file: 640 root:www-data, karena dibaca mod_wsgi
chown root:www-data /var/www/html/django-project/django_school/.env
chmod 640           /var/www/html/django-project/django_school/.env
echo "640  /var/www/html/django-project/django_school/.env (www-data tetap bisa baca)"
```

- [x] **Step 4: Verifikasi pagar tertutup untuk user biasa**

```bash
setpriv --reuid=$(id -u probetest) --regid=$(id -g probetest) --clear-groups \
  cat /var/www/html/gamalama/.env
setpriv --reuid=$(id -u probetest) --regid=$(id -g probetest) --clear-groups \
  cat /var/www/html/django-project/django_school/.env
```

Expected: keduanya `Permission denied` — termasuk yang `640`, karena `probetest` bukan anggota `www-data`.

```bash
awk '{print $3}' /root/env-perms-before-2026-08-12.txt | xargs stat -c '%a %U:%G %n'
```

Expected: 12 baris `600` + 1 baris `640 root:www-data`. Pemilik yang lain **tidak berubah** (`/opt/openclaw/.env` dan `knowledge-base/backend/.env` tetap `gumxlarcw:gumxlarcw`).

- [x] **Step 5: Verifikasi `www-data` masih bisa membaca file yang memang haknya**

```bash
setpriv --reuid=33 --regid=33 --clear-groups \
  head -c 1 /var/www/html/django-project/django_school/.env >/dev/null \
  && echo "OK: www-data masih bisa baca" || echo "GAGAL: bista.bpsmalut.com akan rusak"
```

Expected: `OK`. Bila `GAGAL`, pulihkan segera:
```bash
chown root:root /var/www/html/django-project/django_school/.env && chmod 644 /var/www/html/django-project/django_school/.env
```

- [x] **Step 6: Verifikasi tidak ada service yang rusak**

```bash
pm2 list | grep -cE 'online'      # bandingkan dengan angka sebelum perubahan
pm2 list | grep -E 'errored|stopped'
systemctl is-active openclaw-gateway.service apache2
for h in bista.bpsmalut.com bigdata.bpsmalut.com gamalama.bpsmalut.com \
         sipentas.bpsmalut.com knowledgebase.bpsmalut.com malika.bpsmalut.com; do
  printf '%-32s ' "$h"; curl -s -o /dev/null -w '%{http_code}\n' "https://$h"
done
```

Expected: jumlah `online` tidak berkurang, `apache2` dan `openclaw-gateway.service` = `active`, keenam hostname mengembalikan kode yang sama seperti sebelum perubahan (catat dulu sebelum Step 3).

**Rollback penuh bila ada yang rusak:**
```bash
while read -r mode owner path; do chmod "$mode" "$path"; chown "$owner" "$path"; done \
  < /root/env-perms-before-2026-08-12.txt
```

- [ ] **Step 7: Pantau 24 jam** — *dijadwalkan, cek pada 2026-08-13*

Sebagian aplikasi membaca `.env` hanya saat start, jadi kerusakan bisa muncul baru pada restart/cron berikutnya. Periksa keesokan harinya:

```bash
pm2 list | grep -E 'errored|stopped'
journalctl -p err -S '24 hours ago' | grep -iE 'permission denied|\.env' | head -20
```

Expected: tidak ada baris `permission denied` yang menyebut `.env`.

- [x] **Step 8: Bersihkan user uji**

```bash
userdel probetest
```

---

## Task 2: User magang + pagar identitas

**Files:**
- Create: `/etc/security/limits.d/magang.conf`
- Modify: `/etc/ssh/sshd_config` (append di akhir file)

**Interfaces:**
- Consumes: Task 1 selesai (`.env` sudah `600`)
- Produces: user `magang1`, grup `magang`. Task 3–7 memakai `magang1` sebagai subjek verifikasi.

- [x] **Step 1: Buat grup dan DUA user terpisah**

Ada 2 anak magang. **Akun terpisah, bukan satu akun bersama** — akun bersama berarti satu daemon PM2 bersama, sehingga `pm2 restart all` oleh satu orang mematikan pekerjaan yang lain; jejak `last`/`journalctl` juga tidak bisa membedakan siapa; dan mencabut akses satu orang memaksa rotasi kredensial bagi yang tinggal.

Tanpa `sudo`, tanpa `docker` (grup docker = root-equivalent), tanpa `www-data`.

```bash
groupadd magang
for u in magang1 magang2; do
  useradd -m -g magang -s /bin/bash "$u"
  mkdir -p "/home/$u/.ssh" && chmod 700 "/home/$u/.ssh"
  touch "/home/$u/.ssh/authorized_keys" && chmod 600 "/home/$u/.ssh/authorized_keys"
  chown -R "$u:magang" "/home/$u/.ssh"
  # WAJIB 700, BUKAN 750. Keduanya berbagi grup primer `magang`, jadi bit
  # group pada 750 justru memberi mereka akses baca ke home satu sama lain.
  # Diverifikasi 2026-08-12: dengan 750, `magang2 ls /home/magang1` berhasil.
  chmod 700 "/home/$u"
done
```

Public key masing-masing ditempel ke `authorized_keys` miliknya saat mereka menyerahkannya.

- [x] **Step 2: Verifikasi keanggotaan grup dan isolasi antar-magang**

```bash
id magang1; id magang2
```

Expected: keduanya `gid=...(magang) groups=...(magang)` — **tidak boleh** memuat `sudo`, `docker`, `www-data`, atau `adm`.

```bash
sudo -u magang2 -H bash -lc 'ls /home/magang1/'
```

Expected: `Permission denied` — magang tidak saling mengintip.

- [x] **Step 3: Pasang batas resource khusus grup magang — TANPA `as`**

Hanya mengikat grup `magang`; tidak menyentuh user atau service lain, dan bukan perubahan setelan memori box.

**Jangan pasang `ulimit -v` / `as`.** Diuji 2026-08-12: `pds-backend` produksi berjalan dengan **VSZ 4,9 GB sementara RSS-nya hanya 432 MB** — Node/V8 plus ONNX runtime milik Xenova memesan ruang alamat virtual raksasa yang tidak pernah jadi memori nyata. Batas `as 2500000` akan membunuh backend magang saat start, **dan sama sekali tidak membatasi memori nyata** (`as` mengukur VSZ, bukan RSS). `ulimit -m` (RSS) diabaikan Linux. Jadi `as` hanya merusak tanpa melindungi.

Pagar memori yang benar-benar bekerja ada di `max_memory_restart` PM2 (berbasis RSS) di `ecosystem.dev.js` — Task 6.

```bash
cat > /etc/security/limits.d/magang.conf <<'EOF'
# Batas resource anak magang (2026-08-12).
# Hanya berlaku untuk grup `magang`. Tidak mengubah setelan memori sistem.
#
# TIDAK ADA batas `as`/`ulimit -v` — sengaja. Node+ONNX memesan VSZ ~5 GB
# dengan RSS hanya ~430 MB; batas `as` mematikan aplikasi tanpa membatasi
# memori nyata. Pembatasan RSS ditangani max_memory_restart PM2.
@magang  hard  nproc   400
@magang  hard  nofile  4096
EOF
chmod 644 /etc/security/limits.d/magang.conf
```

- [x] **Step 4: Tutup SSH tunneling untuk grup magang**

Tanpa ini, magang bisa `ssh -L 3306:localhost:3306` dan menembak MariaDB dari laptop dengan kredensial apa pun yang mereka temukan — melompati seluruh pagar.

Blok `Match` **wajib di akhir file**: apa pun setelah `Match` menjadi bagian dari blok itu. Jangan taruh di `sshd_config.d/` yang di-`Include` di awal.

```bash
cp /etc/ssh/sshd_config /etc/ssh/sshd_config.backup

cat >> /etc/ssh/sshd_config <<'EOF'

# ─── Anak magang (2026-08-12) — WAJIB tetap di akhir file ───
Match Group magang
    PubkeyAuthentication yes
    PasswordAuthentication no
    AllowTcpForwarding no
    AllowStreamLocalForwarding no
    GatewayPorts no
    PermitTunnel no
    X11Forwarding no
EOF
```

- [x] **Step 5: Validasi konfigurasi SEBELUM reload**

```bash
sshd -t && echo "config valid"
```

Expected: `config valid`, tanpa pesan error. **Kalau gagal, jangan reload** — pulihkan dengan `cp /etc/ssh/sshd_config.backup /etc/ssh/sshd_config`.

- [x] **Step 6: Reload (bukan restart) agar sesi berjalan selamat**

```bash
systemctl reload ssh
diff /etc/ssh/sshd_config.backup /etc/ssh/sshd_config
```

- [x] **Step 7: Verifikasi pagar identitas dari sisi magang**

Lima uji negatif — semuanya **harus gagal**:

```bash
sudo -u magang1 -H bash -lc 'cd ~ && pm2 list'                                    # daemon sendiri, kosong
sudo -u magang1 -H bash -lc 'cat /root/.cloudflared/*.json'               # Permission denied
sudo -u magang1 -H bash -lc 'echo x >> /etc/cloudflared/config.yml'       # Permission denied
sudo -u magang1 -H bash -lc 'touch /var/www/html/project-data-strategis/x' # Permission denied
sudo -u magang1 -H bash -lc 'cat /var/www/html/gamalama/.env'             # Permission denied
sudo -u magang1 -H bash -lc 'sudo -n true'                                # bukan sudoer
```

Expected: perintah pertama menampilkan tabel PM2 **kosong** (bukan 47 service). Lima sisanya `Permission denied` / `user is not in the sudoers file`.

- [x] **Step 8: Verifikasi batas resource aktif — dan Node tetap bisa jalan**

```bash
sudo -u magang1 -H bash -lc 'ulimit -Hu; ulimit -Hn; ulimit -Hv'
```

Expected: `400`, `4096`, dan **`unlimited`** untuk `-Hv`. Bila `-Hv` menunjukkan angka, batas `as` ikut terpasang dan backend akan gagal start — hapus barisnya dari `magang.conf`.

```bash
sudo -u magang1 -H bash -lc 'node -e "console.log(process.version)"'
```

Expected: versi Node tercetak, bukan crash.

---

## Task 3: Database sandbox `pds_dev1` & `pds_dev2`

**Files:** tidak ada file repo; perubahan pada MariaDB.

**Interfaces:**
- Consumes: user `magang1` dari Task 2
- Produces: database `pds_dev1` + `pds_dev2`, user MariaDB `pds_dev1`/`pds_dev2`@`localhost`. Task 4 mengisinya; Task 6 memakainya di `ecosystem.dev.js`.

- [x] **Step 1: Buat SATU database + user per magang**

Database terpisah, bukan bersama: `DROP TABLE` atau migrasi setengah jadi oleh satu orang tidak boleh menghentikan yang lain. Ukurannya ~100 MB masing-masing — murah dibanding kerugian saling menimpa skema.

Ganti tiap `GANTI_PASSWORD_*` dengan hasil `openssl rand -base64 24` yang **berbeda**.

```sql
CREATE DATABASE pds_dev1 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE pds_dev2 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER 'pds_dev1'@'localhost' IDENTIFIED BY 'GANTI_PASSWORD_1';
CREATE USER 'pds_dev2'@'localhost' IDENTIFIED BY 'GANTI_PASSWORD_2';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, INDEX, ALTER,
      CREATE TEMPORARY TABLES, LOCK TABLES, REFERENCES
  ON pds_dev1.* TO 'pds_dev1'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, INDEX, ALTER,
      CREATE TEMPORARY TABLES, LOCK TABLES, REFERENCES
  ON pds_dev2.* TO 'pds_dev2'@'localhost';

GRANT SELECT ON data_bps.* TO 'pds_dev1'@'localhost';
GRANT SELECT ON data_bps.* TO 'pds_dev2'@'localhost';
FLUSH PRIVILEGES;
```

`data_bps` hanya `SELECT` — 335 MB data publik BPS, dipakai bersama, tidak perlu diduplikasi dan tidak bisa dirusak.

- [x] **Step 2: Verifikasi grant tepat sasaran**

```bash
for u in pds_dev1 pds_dev2; do echo "--- $u"; mysql -N -e "SHOW GRANTS FOR '$u'@'localhost';"; done
```

Expected: masing-masing tiga baris (`USAGE`, database miliknya, `SELECT ON data_bps.*`). **Tidak boleh** ada `project_data_strategis`, `metabase_db`, maupun database milik magang satunya.

```bash
mysql -u pds_dev1 -p'GANTI_PASSWORD_1' -e "SHOW TABLES FROM pds_dev2;"
```

Expected: `denied` — magang tidak bisa menyentuh database tetangganya.

- [x] **Step 3: Uji negatif — kredensial sandbox tidak bisa menyentuh produksi**

```bash
mysql -u pds_dev1 -p'GANTI_PASSWORD_1' -e "SELECT COUNT(*) FROM project_data_strategis.chat_messages;"
mysql -u pds_dev1 -p'GANTI_PASSWORD_1' -e "SELECT COUNT(*) FROM metabase_db.core_user;"
mysql -u pds_dev1 -p'GANTI_PASSWORD_1' -e "DROP TABLE data_bps.dummy;"
```

Expected: ketiganya `ERROR 1142`/`1044 ... denied`.

```bash
mysql -u pds_dev1 -p'GANTI_PASSWORD_1' -D data_bps -e "SHOW TABLES;" | head -3
```

Expected: **berhasil** — baca `data_bps` memang haknya.

---

## Task 4: Skrip dump tersanitasi + pembuktiannya

**Files:**
- Create: `scripts/dev/make-dev-seed.sh`
- Create: `scripts/dev/verify-dev-seed.sh`

**Interfaces:**
- Consumes: database `pds_dev1` + `pds_dev2` dari Task 3
- Produces: `/root/dev-seed-YYYY-MM-DD.sql.gz`. Task 7 merujuknya di `docs/ONBOARDING.md`.

**Kenapa penyaringan `source_kind` wajib:** `retrieval_chunks.source_kind` adalah enum yang memuat `'chat_thread'` — sebagian barisnya adalah embedding dari percakapan user, dan `content_text`-nya memuat isi obrolan. Subset `LIMIT 2000` polos akan memasukkan kembali PII yang sudah dibuang lewat pengosongan `chat_messages`.

- [ ] **Step 1: Tulis skrip generator**

```bash
mkdir -p /var/www/html/project-data-strategis/scripts/dev
cat > /var/www/html/project-data-strategis/scripts/dev/make-dev-seed.sh <<'SCRIPT'
#!/usr/bin/env bash
# Menghasilkan dump `project_data_strategis` yang aman diberikan ke anak magang.
# Dijalankan sebagai root di server. Output: /root/dev-seed-<tanggal>.sql.gz
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

# Batas id knowledge_base dihitung lebih dulu: MariaDB menolak LIMIT
# di dalam subquery IN, jadi nilainya disisipkan sebagai literal.
KB_MAX=$(mysql -N -e \
  "SELECT id FROM knowledge_base ORDER BY id LIMIT 1 OFFSET $((KB_LIMIT-1));" "$SRC")
echo "→ knowledge_base: $KB_LIMIT baris (id <= $KB_MAX)"
mysqldump "${DUMP_OPTS[@]}" --no-create-info --hex-blob \
  --where="id <= $KB_MAX" "$SRC" knowledge_base >> "$OUT"

# source_kind='chat_thread' DIBUANG: barisnya memuat isi percakapan user.
echo "→ retrieval_chunks: maks $RC_LIMIT baris, tanpa chat_thread"
mysqldump "${DUMP_OPTS[@]}" --no-create-info --hex-blob \
  --where="source_kind <> 'chat_thread' \
           AND (source_kind <> 'knowledge_chunk' OR source_ref_id <= $KB_MAX) \
           ORDER BY id LIMIT $RC_LIMIT" \
  "$SRC" retrieval_chunks >> "$OUT"

echo "→ seed admin dev (password dummy 'magang123', bcrypt cost 10)"
cat >> "$OUT" <<'SEED'
INSERT INTO users (id, name, email, password_hash, role, created_at, updated_at)
VALUES (1, 'Dev Admin', 'devadmin@local.test',
        '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
        'admin', NOW(), NOW());
SEED

echo "SET FOREIGN_KEY_CHECKS=1;" >> "$OUT"
gzip -f "$OUT"
echo "✓ selesai: $OUT.gz ($(du -h "$OUT.gz" | cut -f1))"
echo "  tabel dikosongkan: ${#EMPTY[@]} — dibuktikan oleh verify-dev-seed.sh"
SCRIPT
chmod 750 /var/www/html/project-data-strategis/scripts/dev/make-dev-seed.sh
```

Skema `users` sudah diverifikasi 2026-08-12: `id, name, email, password_hash, role, created_at, updated_at` — perhatikan kolomnya `password_hash`, **bukan** `password`, dan tidak ada kolom `username`. Konfirmasi ulang bila skema berubah:

```bash
mysql project_data_strategis -e "SHOW COLUMNS FROM users;"
```

- [ ] **Step 2: Tulis skrip verifikasi**

Dump yang tidak dibuktikan bebas PII sama saja dengan dump produksi.

```bash
cat > /var/www/html/project-data-strategis/scripts/dev/verify-dev-seed.sh <<'SCRIPT'
#!/usr/bin/env bash
# Membuktikan dump magang bebas PII. Keluar bukan-nol bila ada temuan.
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

echo "── pemindaian pola PII ──"
for pat in '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.(com|id|go\.id)' '\+62[0-9]{8,}'; do
  n=$(zgrep -coE "$pat" "$DUMP" || true)
  [ "$n" -gt 0 ] && { echo "PERIKSA: $n kecocokan pola $pat"; FAIL=1; } || echo "ok   : nol kecocokan $pat"
done

echo "── ukuran ──"
echo "  $(du -h "$DUMP" | cut -f1)"
[ "$FAIL" -eq 0 ] && echo "✓ LULUS" || echo "✗ ADA TEMUAN — jangan dibagikan"
exit $FAIL
SCRIPT
chmod 750 /var/www/html/project-data-strategis/scripts/dev/verify-dev-seed.sh
```

- [ ] **Step 3: Jalankan generator**

```bash
/var/www/html/project-data-strategis/scripts/dev/make-dev-seed.sh
```

Expected: selesai tanpa error, ukuran hasil ≈ 50–120 MB (dari 2,3 GB).

- [ ] **Step 4: Jalankan verifikasi — ini gerbangnya**

```bash
/var/www/html/project-data-strategis/scripts/dev/verify-dev-seed.sh /root/dev-seed-$(date +%F).sql.gz
```

Expected: `✓ LULUS`. Bila ada `GAGAL`/`PERIKSA`, **jangan bagikan dump-nya** — perbaiki daftar tabel lalu ulangi Step 3.

- [ ] **Step 5: Muat ke `pds_dev1` dan `pds_dev2` dan buktikan aplikasi bisa jalan di atasnya**

Dump yang sama dimuat ke kedua database magang.

```bash
for db in pds_dev1 pds_dev2; do
  echo "== $db"
  zcat /root/dev-seed-$(date +%F).sql.gz | mysql "$db"
  mysql "$db" -N -e "
    SELECT 'chat_messages', COUNT(*) FROM chat_messages
    UNION ALL SELECT 'user_memory', COUNT(*) FROM user_memory
    UNION ALL SELECT 'retrieval_chunks', COUNT(*) FROM retrieval_chunks
    UNION ALL SELECT 'knowledge_base', COUNT(*) FROM knowledge_base
    UNION ALL SELECT 'data_sources', COUNT(*) FROM data_sources
    UNION ALL SELECT 'chunks_chat_thread',
      COUNT(*) FROM retrieval_chunks WHERE source_kind='chat_thread';"
done
```

Expected untuk keduanya: `chat_messages` = 0, `user_memory` = 0, `chunks_chat_thread` = **0**, `retrieval_chunks` > 0, `knowledge_base` ≈ 2000, `data_sources` = 298.

- [ ] **Step 6: Commit**

```bash
cd /var/www/html/project-data-strategis
git add scripts/dev/make-dev-seed.sh scripts/dev/verify-dev-seed.sh
git commit -m "chore(dev): skrip dump sandbox tersanitasi untuk anak magang"
```

---

## Task 5: Isolasi Metabase

Metabase **tidak** di-clone. Lubangnya ditutup di lapisan database, bukan di UI — pembatasan UI bisa dilewati dengan query lintas-database.

**Files:** tidak ada file repo; perubahan pada MariaDB dan konfigurasi Metabase.

**Interfaces:**
- Consumes: —
- Produces: user MariaDB `metabase_data_bps_ro`, grup Metabase `Magang`.

- [ ] **Step 1: Buktikan lubangnya ada (uji negatif, sebelum perbaikan)**

`metabase_bps_ro` adalah user koneksi untuk **ketiga** data source, dan punya `SELECT` pada `project_data_strategis`:

```bash
mysql -N -e "SHOW GRANTS FOR 'metabase_bps_ro'@'localhost';"
```

Expected: memuat `SELECT ON project_data_strategis.*` dan `SELECT ON metabase_db.*` — inilah yang membuat SQL editor magang bisa membaca 14.478 percakapan user.

- [ ] **Step 2: Buat user koneksi terisolasi**

Ganti `GANTI_PASSWORD_KUAT2` dengan hasil `openssl rand -base64 24`.

```sql
CREATE USER 'metabase_data_bps_ro'@'localhost' IDENTIFIED BY 'GANTI_PASSWORD_KUAT2';
GRANT SELECT ON data_bps.* TO 'metabase_data_bps_ro'@'localhost';
FLUSH PRIVILEGES;
```

- [ ] **Step 3: Verifikasi user baru benar-benar buntu**

```bash
mysql -u metabase_data_bps_ro -p'GANTI_PASSWORD_KUAT2' \
  -e "SELECT COUNT(*) FROM project_data_strategis.chat_messages;"
mysql -u metabase_data_bps_ro -p'GANTI_PASSWORD_KUAT2' \
  -e "SELECT COUNT(*) FROM metabase_db.core_user;"
mysql -u metabase_data_bps_ro -p'GANTI_PASSWORD_KUAT2' \
  -D data_bps -e "SHOW TABLES;" | head -3
```

Expected: dua pertama `denied`, ketiga berhasil.

- [ ] **Step 4: Arahkan data source "DATA BPS" ke user baru**

Lewat UI Metabase, **bukan** dengan mengedit tabel `metabase_database` langsung (kolom `details` adalah JSON terserialisasi; menyuntingnya berisiko merusak koneksi).

`metabase.bpsmalut.com` → gerigi ⚙ → **Admin settings** → **Databases** → **DATA BPS** → ubah *Username* menjadi `metabase_data_bps_ro`, *Password* ke nilai baru → **Save** → **Sync database schema now**.

- [ ] **Step 5: Verifikasi 96 kartu DATA BPS tidak rusak**

```bash
mysql metabase_db -N -e \
  "SELECT id, name, JSON_UNQUOTE(JSON_EXTRACT(details,'\$.user')) FROM metabase_database WHERE id=4;"
```

Expected: `4  DATA BPS  metabase_data_bps_ro`.

Data source ini menopang **96 pertanyaan tersimpan** dan **2 dashboard**. Sudah diverifikasi 2026-08-12 bahwa tidak ada satu pun di antaranya yang menyeberang ke `project_data_strategis` atau `metabase_db`, jadi mempersempit user koneksi ke `data_bps` saja tidak memutus apa pun. Konfirmasi ulang sebelum melanjutkan:

```bash
mysql metabase_db -N -e "SELECT COUNT(*) FROM report_card WHERE archived=0 \
  AND (dataset_query LIKE '%project_data_strategis%' OR dataset_query LIKE '%metabase_db%');"
```

Expected: `0`. Bila **bukan** 0, kartu-kartu itu akan rusak — daftar dulu namanya dan putuskan bersama pemilik sebelum lanjut.

Lalu buka kedua dashboard di browser dan pastikan datanya tampil.

- [ ] **Step 6: Hapus data source `metabase_db` (id 2)**

Ini menutup lubangnya di akarnya, bukan menambal izinnya. Data source itu masih memakai `metabase_bps_ro` yang punya `SELECT` pada `project_data_strategis` — selama ia terdaftar, siapa pun yang bisa menjangkaunya bisa menyeberang ke DB MALIKA dan ke `core_user`.

Dampaknya nol, sudah diverifikasi 2026-08-12:

```bash
mysql metabase_db -N -e \
  "SELECT COUNT(*) FROM report_card WHERE archived=0 AND database_id=2;"
```

Expected: `0` — tidak ada satu pun pertanyaan tersimpan yang memakainya. Bila hasilnya **bukan** 0, **jangan hapus**; ganti langkah ini dengan memindahkan koneksinya ke user ber-grant sempit seperti Step 2.

Admin settings → **Databases** → **metabase_db** → **Remove this database**.

- [ ] **Step 7: Buat grup Magang — tanpa menyentuh grup "All Users"**

Rencana awal sempat menyuruh membatasi grup **All Users**. Itu tidak diperlukan dan justru berisiko: grup itu menampung akun Anda sendiri (`bps8200@bps.go.id`) beserta 37 kartu Sample Database dan 96 kartu DATA BPS. Di Metabase, izin **Blocked** pada satu grup mengalahkan izin longgar dari grup lain — jadi membatasi grup Magang saja sudah cukup, dan akun yang ada tidak tersentuh sama sekali.

Admin settings → **People** → **Groups** → **Create a group** → `Magang`.
Tambahkan akun magang ke grup itu. **Jangan** centang *Administrator*.

Permissions → Data → grup **Magang**:
- `DATA BPS` → *View data* = **Can view**, *Create queries* = **Query builder and native**
- `Sample Database` → **Blocked**

Grup **All Users**: **jangan diubah.**

- [ ] **Step 8: Verifikasi dari akun magang sendiri**

Login sebagai akun magang, buka SQL editor, jalankan:

```sql
SELECT * FROM project_data_strategis.chat_messages LIMIT 1;
SELECT * FROM metabase_db.core_user LIMIT 1;
```

Expected: keduanya error izin dari MariaDB. Lalu jalankan query wajar pada `data_bps` dan pastikan berhasil.

- [ ] **Step 9: Catat temuan untuk tindak lanjut terpisah — JANGAN dikerjakan di sini**

Ketiganya berdampak ke project lain dan **bukan bagian dari rencana ini**. Dicatat agar tidak hilang, bukan untuk dieksekusi sekarang:

1. `metabase_database.details` menyimpan password **plaintext** → `MB_ENCRYPTION_SECRET_KEY` belum diset. Password `metabase_bps_ro` juga sempat tercetak di transkrip sesi 2026-08-12, jadi **rotasi disarankan**. Tapi user itu masih dipakai data source lain — rotasinya harus dibarengi pembaruan koneksi di Metabase dalam satu jendela pemeliharaan, bukan disisipkan ke pekerjaan magang.
2. MariaDB `LISTEN 0.0.0.0:3306` (terbuka ke LAN) dengan user `root@%` dan `admin@%` yang boleh konek dari host mana pun. Mempersempitnya berpotensi memutus klien yang tidak terdata — perlu inventarisasi lebih dulu.
3. `WSGIDaemonProcess django_school` berjalan sebagai `www-data` tanpa `user=` eksplisit. Bukan kerentanan, tapi membuat setiap perubahan permission di sekitarnya rawan salah — layak didokumentasikan di runbook `bista`.

---

## Task 6: Runtime sandbox

**Files:**
- Modify: `backend/.env.example`
- Create: `ecosystem.dev.js`

**Interfaces:**
- Consumes: database `pds_dev1`/`pds_dev2` (Task 3), dump termuat (Task 4)
- Produces: `ecosystem.dev.js` yang dirujuk `docs/ONBOARDING.md` di Task 7.

- [ ] **Step 1: Lengkapi `.env.example`**

Lima key ini ada di `.env` produksi tetapi hilang dari `.env.example`. `MALIKA_ANON_SECRET` bersifat **fail-closed** — tanpa itu clone bersih crash saat import chat controller, sebelum test apa pun berjalan. Magang hari pertama pasti tersandung.

```bash
cd /var/www/html/project-data-strategis
cp backend/.env.example backend/.env.example.backup

cat >> backend/.env.example <<'EOF'

# ─── Wajib diisi, jika kosong aplikasi gagal start ───
# Identitas anonim chat bersifat fail-closed: import akan throw bila kosong.
# Buat nilai acak untuk instance lokal: openssl rand -hex 32
MALIKA_ANON_SECRET=
MALIKA_IDENTITY_STRICT=true

# ─── Flag pipeline ───
USE_UNIFIED_RETRIEVAL=true
CHAT_PIPELINE_V=2
AUTO_TUNE_MODEL=
EOF

diff backend/.env.example.backup backend/.env.example
```

- [ ] **Step 2: Verifikasi tidak ada lagi key yang hilang**

```bash
comm -23 \
  <(grep -oE '^[A-Z_]+' backend/.env | sort -u) \
  <(grep -oE '^[A-Z_]+' backend/.env.example | sort -u)
```

Expected: keluaran **kosong**.

- [ ] **Step 3: Buat `ecosystem.dev.js`**

Port berbeda dari produksi, dan batas memori dipasang di sini — di file aplikasi milik magang, bukan di setelan memori box.

```bash
cat > ecosystem.dev.js <<'EOF'
// Instance sandbox anak magang. Port dan batas memori sengaja berbeda
// dari ecosystem.config.js (produksi) supaya keduanya bisa hidup bersama.
// Dijalankan dengan PM2 milik user magang sendiri, bukan PM2 root.
//
// PORT SENGAJA SAMA UNTUK SEMUA MAGANG. Box ini hanya sanggup menampung
// satu stack sandbox pada satu waktu, dan tidak ada pagar memori tingkat
// kernel (cgroup dilarang; ulimit -v justru mematikan Node — lihat Task 2).
// Dengan port yang sama, magang kedua ditolak kernel lewat EADDRINUSE:
// giliran jadi batas teknis, bukan sekadar kesepakatan.
//
// max_memory_restart mengukur RSS — inilah satu-satunya pagar memori yang
// benar-benar bekerja di sini.
module.exports = {
  apps: [
    {
      name: "dev-backend",
      cwd: "./backend",
      script: "server.js",
      exec_mode: "fork",
      instances: 1,
      node_args: "--max-old-space-size=640",
      max_memory_restart: "700M",
      env: { NODE_ENV: "development", PORT: 5200 }
    },
    {
      // backend/admin/next.config memakai output:"standalone", jadi `next start`
      // TIDAK didukung — jalankan server hasil build langsung, sama seperti
      // ecosystem.config.js produksi. Port diatur lewat env PORT, bukan flag.
      name: "dev-admin",
      cwd: "./backend/admin",
      script: ".next/standalone/server.js",
      exec_mode: "fork",
      instances: 1,
      max_memory_restart: "400M",
      env: { NODE_ENV: "production", PORT: 5250 }
    },
    {
      name: "dev-frontend",
      cwd: "./frontend",
      script: "node_modules/.bin/next",
      args: "start -p 6200",
      exec_mode: "fork",
      instances: 1,
      max_memory_restart: "400M",
      env: { NODE_ENV: "production", PORT: 6200 }
    }
  ]
};
EOF
```

- [ ] **Step 4: Verifikasi port sandbox belum dipakai**

```bash
ss -ltn | grep -E ':(5200|5250|6200)\b' || echo "ketiga port bebas"
```

Expected: `ketiga port bebas`.

- [ ] **Step 5: Commit**

```bash
git add backend/.env.example ecosystem.dev.js
git commit -m "chore(dev): ecosystem sandbox magang + lengkapi .env.example"
```

- [ ] **Step 6 (opsional): URL publik untuk sandbox**

Hanya bila magang perlu menunjukkan hasil kerjanya lewat browser di luar server. Dikerjakan **pemilik server**, satu kali; magang tidak pernah menyentuh file ini.

```bash
cp /etc/cloudflared/config.yml /etc/cloudflared/config.yml.backup
```

Sisipkan entri berikut **sebelum** baris `- service: http_status:404` di akhir daftar `ingress` (urutan penting — cloudflared mencocokkan dari atas, dan entri catch-all menelan apa pun setelahnya):

```yaml
- hostname: malika-dev.bpsmalut.com
  service: http://127.0.0.1:6200
```

```bash
cloudflared tunnel ingress validate
diff /etc/cloudflared/config.yml.backup /etc/cloudflared/config.yml
systemctl reload cloudflared || systemctl restart cloudflared
```

Expected: `validate` melaporkan konfigurasi valid. Bila gagal, pulihkan dari `.backup` dan **jangan** reload.

Tambahkan juga DNS route-nya sekali:

```bash
cloudflared tunnel route dns 874a8c89-33ee-4eb3-ad00-1a1db8ce6f4d malika-dev.bpsmalut.com
```

Verifikasi hostname produksi tetap hidup setelah reload:

```bash
for h in malika.bpsmalut.com api-malika.bpsmalut.com metabase.bpsmalut.com; do
  echo -n "$h "; curl -s -o /dev/null -w '%{http_code}\n' "https://$h"
done
```

---

## Task 7: Akses GitHub + panduan onboarding

**Files:**
- Create: `docs/ONBOARDING.md`

**Interfaces:**
- Consumes: seluruh task sebelumnya
- Produces: dokumen yang diserahkan ke magang di hari pertama.

- [ ] **Step 1: Undang magang sebagai collaborator Read**

Repo private di plan Free → branch protection dan rulesets **tidak tersedia** (terverifikasi `403: Upgrade to GitHub Pro`). Dengan Write access, tidak ada yang mencegah `push --force` ke `main`. Read + fork membuatnya mustahil secara teknis.

```bash
gh api -X PUT repos/gumxlarcw/malika/collaborators/<username-magang> -f permission=pull
```

- [ ] **Step 2: Verifikasi permission benar `pull`**

```bash
gh api repos/gumxlarcw/malika/collaborators --jq '.[] | "\(.login) push=\(.permissions.push) admin=\(.permissions.admin)"'
```

Expected: baris magang menunjukkan `push=false admin=false`. Bila `push=true`, ulangi Step 1 — Write access membatalkan seluruh perlindungan ini.

- [ ] **Step 3: Tulis panduan onboarding**

```bash
cat > docs/ONBOARDING.md <<'EOF'
# Panduan Anak Magang — MALIKA

## Yang kamu punya

- User Linux di server: `magang1` atau `magang2` (login SSH dengan kunci publikmu)
- Sandbox: backend `:5200`, admin `:5250`, frontend `:6200` — **dipakai bergiliran**, lihat bagian di bawah
- Database sendiri: `pds_dev1` atau `pds_dev2` (boleh ditulis) + `data_bps` (baca saja)
- Metabase: akun grup **Magang**, akses data source `DATA BPS`
- GitHub: akses baca `gumxlarcw/malika` — kontribusi lewat fork + Pull Request

## Yang TIDAK boleh dan memang tidak bisa

`/var/www/html/project-data-strategis` adalah **produksi**. Kamu tidak punya
izin tulis ke sana, dan itu disengaja. Jangan pernah menjalankan
`npm run build` di direktori itu — perintah itu langsung menimpa bundle yang
sedang disajikan ke pengguna.

`pm2` yang kamu jalankan adalah daemon milikmu sendiri. Kamu tidak akan
melihat service produksi, dan itu normal.

## Setup pertama kali

```bash
# 1. Fork gumxlarcw/malika lewat GitHub UI, lalu:
git clone git@github.com:<username-kamu>/malika.git ~/malika
cd ~/malika
git remote add upstream git@github.com:gumxlarcw/malika.git

# 2. Muat database sandbox (file diberikan pembimbing)
#    Ganti N dengan nomor akunmu: magang1 → pds_dev1, magang2 → pds_dev2
zcat ~/dev-seed.sql.gz | mysql -u pds_devN -p pds_devN

# 3. Siapkan environment
cp backend/.env.example backend/.env
# Isi minimal (N = nomor akunmu):
#   DB_HOST=localhost  DB_USER=pds_devN  DB_NAME=pds_devN  DB_PASS=<dari pembimbing>
#   MALIKA_ANON_SECRET=$(openssl rand -hex 32)
#   JWT_SECRET=$(openssl rand -hex 32)
#   OPENAI_API_BASE_URL=https://bps8200.tail8e7302.ts.net/v1
#   OPENAI_API_KEY=<key proxy milikmu>

# 4. Pasang dependency dan build (skrip ini sudah ada di repo)
./scripts/build-all.sh

# 5. Jalankan
pm2 start ecosystem.dev.js
pm2 logs dev-backend
```

Admin di-build dengan mode `standalone`, jadi yang dijalankan adalah
`.next/standalone/server.js` — bukan `next start`. `ecosystem.dev.js` sudah
mengaturnya; kamu tidak perlu menghafalnya.

## Sandbox dipakai bergiliran — dan itu disengaja

Kalian berdua memakai port yang sama: `5200`, `5250`, `6200`. Kalau temanmu
sedang menjalankan sandbox, `pm2 start` milikmu akan gagal dengan
`EADDRINUSE`. Itu **bukan bug** — server ini hanya sanggup menampung satu
stack sandbox pada satu waktu, dan port yang sama membuat batas itu ditegakkan
sistem, bukan bergantung pada siapa yang ingat.

Cek siapa yang sedang memakai sebelum mulai:

```bash
ss -ltn | grep -E ':(5200|5250|6200)\b'
```

Selesai bekerja, **selalu** lepaskan giliran:

```bash
pm2 stop all
```

Yang tetap bisa kalian kerjakan bersamaan: `npm test` (jest tidak mengikat
port), menulis kode, `git`, dan query Metabase. Hanya sandbox hidupnya yang
bergiliran.

## Aturan memori — penting

Server ini dipakai bersama 44 service produksi lain dan memorinya sudah sesak.

- Pakai `npm run build && pm2 start`, **jangan** `npm run dev`. Mode dev jauh
  lebih boros dan bisa menjatuhkan service orang lain.
- Jangan menaikkan `max_memory_restart` di `ecosystem.dev.js`. Angka itu satu-
  satunya pengaman yang mencegah proses kalian menjatuhkan layanan produksi.

## Alur kontribusi

```bash
git checkout -b fitur/nama-singkat
# ... kerjakan ...
npm --prefix backend test
git add <file-spesifik>          # jangan `git add -A`
git commit -m "feat: deskripsi singkat"
git push origin fitur/nama-singkat
# Buka Pull Request ke gumxlarcw/malika lewat GitHub
```

Merge tidak berarti tayang. Deploy ke produksi dilakukan pembimbing secara
manual setelah review.

## Kalau tersangkut

- Backend gagal start dengan error soal `MALIKA_ANON_SECRET` → key itu wajib,
  isi dengan `openssl rand -hex 32`.
- Chat menjawab error → cek `OPENAI_API_BASE_URL` dan key proxy-mu.
- `docs/workspace/<area>.md` memuat catatan per area.
EOF
```

- [ ] **Step 4: Uji panduan sebagai magang sungguhan**

Jalankan Step "Setup pertama kali" dari awal sebagai user `magang1`. Perintah pertama yang gagal adalah cacat di panduan — perbaiki dokumennya, jangan diakali manual.

```bash
sudo -u magang1 -H bash -lc 'cd ~ && node --version && npm --version && mysql -u pds_dev1 -p -e "SELECT COUNT(*) FROM pds_dev1.data_sources;"'
sudo -u magang2 -H bash -lc 'cd ~ && node --version && npm --version && mysql -u pds_dev2 -p -e "SELECT COUNT(*) FROM pds_dev2.data_sources;"'
```

Expected: versi node/npm tampil untuk keduanya, query mengembalikan `298`.

- [ ] **Step 5: Commit**

```bash
git add docs/ONBOARDING.md
git commit -m "docs: panduan onboarding anak magang"
```

---

## Verifikasi akhir — jalankan setelah semua task selesai

Satu rangkaian uji negatif dari sisi magang. **Semuanya harus gagal**, kecuali yang ditandai.

```bash
# Pagar identitas
sudo -u magang1 -H bash -lc 'cd ~ && pm2 list'                                     # kosong
sudo -u magang1 -H bash -lc 'sudo -n true'                                 # bukan sudoer
sudo -u magang1 -H bash -lc 'cat /root/.cloudflared/*.json'                # denied
sudo -u magang1 -H bash -lc 'echo x >> /etc/cloudflared/config.yml'        # denied
sudo -u magang1 -H bash -lc 'touch /var/www/html/project-data-strategis/x' # denied

# Pagar rahasia
sudo -u magang1 -H bash -lc 'cat /var/www/html/gamalama/.env'              # denied
sudo -u magang1 -H bash -lc 'cat /opt/malika-llm-proxy/.env'               # denied
mysql -u pds_dev1 -p -e "SELECT 1 FROM project_data_strategis.users;"      # denied
mysql -u pds_dev1 -p -e "SHOW TABLES FROM pds_dev2;"                       # denied (antar-magang)
mysql -u metabase_data_bps_ro -p -e "SELECT 1 FROM metabase_db.core_user;" # denied
sudo -u magang2 -H bash -lc 'ls /home/magang1/'                            # denied

# Yang HARUS berhasil
mysql -u pds_dev1 -p -e "SELECT COUNT(*) FROM pds_dev1.data_sources;"      # 298
mysql -u pds_dev2 -p -e "SELECT COUNT(*) FROM pds_dev2.data_sources;"      # 298
mysql -u pds_dev1 -p -D data_bps -e "SHOW TABLES;" | head -3               # daftar tabel

# Produksi tidak terganggu
pm2 list | grep -cE 'online'                                               # sama seperti sebelum mulai
curl -s -o /dev/null -w '%{http_code}\n' https://malika.bpsmalut.com       # 200
```

Kalau ada satu saja uji negatif yang **berhasil**, pagarnya bocor — hentikan dan perbaiki sebelum magang diberi akses.
