# Onboarding Anak Magang — Desain Akses & Sandbox

**Tanggal:** 2026-08-12
**Status:** Disetujui, belum diimplementasikan
**Konteks:** Anak magang akan mengerjakan MALIKA (`/var/www/html/project-data-strategis`) full-stack, boleh bereksperimen live di server, dan butuh akses Metabase. Produksi selain MALIKA tidak boleh tersentuh.

---

## 1. Keputusan pokok

| Pertanyaan awal | Keputusan | Alasan |
|---|---|---|
| Beri akses PM2 root? | **Tidak** | Daemon PM2 root menjalankan 47 service; `pm2 start` = eksekusi arbitrer sebagai root |
| Beri akses `/etc/cloudflared/config.yml`? | **Tidak** | File server-wide, 30+ hostname termasuk `ssh.bpsmalut.com` |
| Cukup `npm run build`? | **Tidak** | Di direktori live, `npm run build` menimpa `.next` yang sedang disajikan `next start` — itu deploy, bukan verifikasi |
| Akses server langsung? | **Ya, dengan 3 pagar** | Risiko sebenarnya bukan PM2, melainkan `.env` yang world-readable dan tekanan memori |
| Clone Metabase? | **Tidak** | Instance yang ada sudah 1,1 GB; akses diberikan lewat akun aplikasi |

**Prinsip:** MALIKA boleh rusak di tangan magang. 44 service lain tidak boleh terpengaruh dalam kondisi apa pun.

---

## 2. Kondisi awal yang sudah aman

Tidak perlu diubah, dicatat agar tidak salah sasaran:

- `/root` = `drwx------` → `/root/.pm2` (socket PM2 root), `/root/.cloudflared/*.json`, dan SSH key GitHub tidak terjangkau user biasa.
- PM2 bersifat **per-user** (`~/.pm2`). User `magang` menjalankan daemon sendiri; `pm2 list` miliknya kosong dari 47 service root.
- Riwayat git `gumxlarcw/malika` bersih — `.env` tidak pernah ter-commit; `docs/postman/malika.postman_environment.json` dan `backend/jest.setup.env.js` tidak memuat rahasia asli.
- Grant `pds_app` sudah terbatas pada `data_bps` + `project_data_strategis`.

---

## 3. Pagar 1 — Identitas

Satu user Linux per magang: `magang1`, `magang2`, …

- **Bukan** anggota `sudo` (berisi `bps8200`, `gumxlarcw`)
- **Bukan** anggota `docker` (grup docker = root-equivalent; berisi `gumxlarcw`)
- **Bukan** anggota `www-data`
- Tidak diberi akses `code-server` (`code-server@root.service` berjalan sebagai root dan terekspos di `code-server.bpsmalut.com` — itu root shell di browser)

Direktori produksi `/var/www/html/project-data-strategis` tetap tidak dapat ditulis oleh mereka. Kode mereka di-clone dari GitHub ke `/home/magang1/malika`.

---

## 4. Pagar 2 — Rahasia

### 4.1 Perbaikan permission (prasyarat, wajib)

13 file `.env` saat ini `-rw-r--r--` (terbaca semua user). Ubah ke `600`:

```
/var/www/html/project-data-strategis/backend/.env
/var/www/html/gamalama/.env
/var/www/html/big-data/.env
/var/www/html/sipentas/backend/.env
/var/www/html/django-project/django_school/.env
/var/www/html/tamdes-frontend.frozen-20260516/.env
/var/www/html/tamdes-web.frozen-20260516/.env
/var/www/html/knowledge-base/backend/.env
/opt/notulen-ai/.env
/opt/apify-gateway/.env
/opt/tiktok-signature/.env
/opt/social-gateway/.env
/opt/openclaw/.env
```

Rantai serangan yang ditutup: baca `.env` project lain → dapat `DB_PASS` → koneksi MariaDB sebagai user project itu → tulis/hapus datanya.

Catatan: `/opt/openclaw/.env` dan `/var/www/html/knowledge-base/backend/.env` dimiliki `gumxlarcw`; pertahankan kepemilikan saat chmod.

### 4.2 Database sandbox

- Database `pds_dev` — salinan tersanitasi dari `project_data_strategis`.
- User MariaDB `pds_dev`@`localhost`, grant **hanya** pada `pds_dev.*`, ditambah `SELECT` pada `data_bps.*` (335 MB data publik BPS, read-only sehingga tidak bisa dirusak dan tidak perlu diduplikasi).

Isi `pds_dev` (dari 2,3 GB menjadi ~100 MB):

| Kelompok | Perlakuan | Tabel |
|---|---|---|
| Struktur | DDL penuh, semua 34 tabel | — |
| Data penuh | Referensi kecil, tanpa PII | `data_sources`, `indicator_meta`, `indicator_metric_meta`, `data_period_map`, `automation_configs`, `app_settings`, `indexed_brs_publikasi`, `exim_pod_filters`, `innodb_ft_stopwords`, `indicator_static_table` |
| Subset ~2.000 baris | Cukup untuk menguji retrieval | `retrieval_chunks` (1022 MB), `knowledge_base` (860 MB) |
| **Nol baris** | PII pengguna & log | `chat_messages`, `chat_threads`, `user_memory`, `chat_feedbacks`, `chat_message_flags`, `active_sessions`, `push_subscriptions`, `push_send_logs`, `admin_audit_logs`, `page_views`, `fetch_logs`, `webapi_health_logs`, `automation_run_logs`, `auto_tune_logs`, `dna_cache`, `data_search_stats`, `data_merged_cache`, `data_processed_cache` |
| Seed | 1 admin dev, password dummy | `users` (produksi hanya berisi 1 baris) |

### 4.3 Environment

- `backend/.env.example` dilengkapi 5 key yang hilang: `MALIKA_ANON_SECRET`, `USE_UNIFIED_RETRIEVAL`, `CHAT_PIPELINE_V`, `MALIKA_IDENTITY_STRICT`, `AUTO_TUNE_MODEL`.
  `MALIKA_ANON_SECRET` bersifat **fail-closed** — tanpa itu, clone bersih crash saat import chat controller sebelum test apa pun berjalan.
- `JWT_SECRET` dan `MALIKA_ANON_SECRET` di-generate acak oleh masing-masing magang untuk instance lokalnya.
- LLM: akun Tailscale + `PROXY_API_KEY` sendiri, `OPENAI_API_BASE_URL=https://bps8200.tail8e7302.ts.net/v1`. Mereka bebas menggantinya dengan key atau NLP sendiri.
- Embedding tidak butuh key: `Xenova/multilingual-e5-base` berjalan lokal.

---

## 5. Pagar 3 — Sumber daya

**Batasan yang ditetapkan pemilik server (2026-08-12): setelan memori box tidak boleh diubah.** Stability stack yang ada — `earlyoom`, watchdog daemon, konfigurasi swap, `RuntimeWatchdogSec=0` — adalah hasil perbaikan 2026-05-30 yang sudah teruji dan berada **di luar lingkup** pekerjaan ini. Tidak ada perubahan pada `earlyoom`, `sysctl`, swap, maupun slice systemd yang sudah ada.

Pagar ini tetap diperlukan karena `npm run dev` milik magang adalah cara paling mungkin produksi lain ikut jatuh: `earlyoom` membunuh proses **terbesar**, dan proses terbesar di box adalah service produksi (MainThread 1,7 GB, Metabase/java 1,1 GB, mariadbd 998 MB) — bukan proses magang. Karena itu batasnya dipasang **di sisi milik magang**, bukan di setelan box.

Dua lapis, keduanya hanya menyentuh aset magang:

**a. Konfigurasi aplikasi magang** — di dalam `ecosystem.dev.js` milik mereka sendiri, sepenuhnya file aplikasi biasa:

```js
max_memory_restart: "700M",
node_args: "--max-old-space-size=640",
```

Backend dev dibatasi ~700 MB (produksi memakai 2300 MB), admin dan frontend ~400 MB masing-masing. Total satu magang ≈ 1,5 GB dengan restart otomatis, bukan pertumbuhan tanpa batas.

**b. Port sandbox yang sama untuk kedua magang** — `5200` / `5250` / `6200`. Karena keduanya mengikat port yang sama, magang kedua ditolak kernel dengan `EADDRINUSE`. Aturan "satu stack pada satu waktu" berubah dari kesepakatan menjadi **batas teknis yang ditegakkan sistem**, tanpa satu pun setelan memori box disentuh.

`/etc/security/limits.d/magang.conf` tetap dipasang untuk `nproc` dan `nofile`, tetapi **tanpa batas `as`**.

**Kenapa tanpa `as` — diuji 2026-08-12:** `pds-backend` produksi berjalan dengan **VSZ 4,9 GB sementara RSS-nya hanya 432 MB**. Node/V8 plus ONNX runtime milik Xenova memesan ruang alamat virtual raksasa yang tidak pernah menjadi memori nyata. `ulimit -v` membatasi VSZ, bukan RSS — jadi batas `as 2500000` akan **membunuh backend magang saat start** sekaligus **tidak membatasi pemakaian memori nyata sama sekali**. `ulimit -m` (RSS) diabaikan Linux. Satu-satunya pagar berbasis RSS yang bekerja tanpa cgroup adalah `max_memory_restart` PM2 di poin (a).

Yang sengaja **tidak** dilakukan: `MemoryMax` pada slice systemd, `ulimit -v`, penyetelan ulang `earlyoom`, pembersihan swap, atau pengurangan service yang berjalan.

**Konsekuensi yang diterima secara sadar:** pagar memori bersifat kooperatif — `max_memory_restart` hanya berlaku untuk proses yang dijalankan lewat PM2. Magang yang menjalankan `node` atau `npm run dev` langsung tidak terikat apa pun selain mutex port. Perlindungannya nyata namun tidak absolut, dan itu konsekuensi dari keputusan tidak menyentuh setelan memori box — bukan kelalaian desain.

**Aturan operasional pendamping:** frontend dijalankan `npm run build && npm start` (bukan `npm run dev`), karena `next dev` jauh lebih boros.

---

## 6. Sandbox yang mereka dapat

| Aspek | Nilai |
|---|---|
| Kode | `/home/magang1/malika` (clone dari GitHub, bukan dari direktori produksi) |
| Port | backend `5200`, admin `5250`, frontend `6200` (diverifikasi bebas 2026-08-12) |
| Proses | PM2 daemon milik sendiri di `~/.pm2` |
| URL live | Opsional `malika-dev.bpsmalut.com → 127.0.0.1:6200`; satu kali penambahan ke `config.yml` oleh pemilik server |
| Database | `pds_dev` (tulis) + `data_bps` (baca saja) |

Mereka benar-benar bereksperimen live di server dengan URL dan DB sungguhan — hanya instance-nya milik sendiri.

---

## 7. Alur kontribusi kode

Repo `gumxlarcw/malika` private di akun personal plan Free → **branch protection dan rulesets dua-duanya tidak tersedia** (terverifikasi `403: Upgrade to GitHub Pro`). Dengan write access, tidak ada mekanisme yang mencegah `push --force` ke `main`.

Karena itu:

1. Magang ditambahkan sebagai collaborator **Read**, bukan Write.
2. Mereka **fork** repo ke akun sendiri (`allow_forking: true`, terverifikasi) → branch → Pull Request.
3. Review dan merge dilakukan pemilik repo.
4. Saat magang selesai: cabut collaborator — GitHub otomatis menghapus fork private mereka.

Konsekuensi yang diterima: collaborator read tetap membaca seluruh riwayat commit. Sudah diaudit bersih.

**Merge ≠ deploy.** Tidak ada auto-deploy dari `main`, dan desain ini sengaja tidak menambahkannya. Deploy produksi tetap tindakan manual pemilik server:

```bash
cd /var/www/html/project-data-strategis && git pull
cd frontend && npm run build && pm2 reload pds-frontend --update-env
cd ../backend/admin && npm run build && pm2 reload pds-admin --update-env
pm2 reload pds-backend --update-env
```

---

## 8. Akses Metabase

Metabase **tidak di-clone**. Akses diberikan lewat akun aplikasi pada instance yang ada (PM2 24, `:3000`, `metabase.bpsmalut.com`).

### 8.1 Lubang yang harus ditutup lebih dulu

Kondisi saat ini:

- Data source tersambung: `Sample Database` (h2), `metabase_db` (DB aplikasi Metabase sendiri), `DATA BPS`.
- Ketiganya memakai satu user koneksi `metabase_bps_ro`, yang punya `SELECT` pada `data_bps`, `metabase_db`, **dan `project_data_strategis`**.
- Grup **All Users** — penampung otomatis setiap akun baru — punya `perms/create-queries = query-builder-and-native` dan `perms/view-data = unrestricted` pada ketiga database.

Akibatnya, akun magang baru langsung bisa menjalankan:

```sql
SELECT * FROM project_data_strategis.chat_messages;   -- 14.478 pertanyaan user
SELECT * FROM project_data_strategis.user_memory;     -- 3.187 baris memori per-user
SELECT * FROM metabase_db.core_user;                  -- hash password akun Metabase
SELECT details FROM metabase_db.metabase_database;    -- password DB, plaintext
```

MySQL mengizinkan query lintas-database dengan nama berkualifikasi penuh selama user koneksi punya grant — memblokir database di UI Metabase **tidak** menutup jalur ini. Tanpa perbaikan, Metabase mengembalikan seluruh PII yang sudah susah payah dibuang dari dump di §4.2.

### 8.2 Perbaikan

1. **User koneksi baru** `metabase_data_bps_ro`@`localhost` dengan grant tunggal `SELECT ON data_bps.*`. Repoint data source `DATA BPS` (id 4) ke user ini. Ini menutup lubang di lapisan database, bukan di lapisan UI — berlaku apa pun yang diketik magang.
2. Grup Metabase **Magang**; akun magang non-superuser.
3. Batasi grup **All Users** menjadi `view-data = blocked` pada `Sample Database` dan `metabase_db` (bukan hanya grup Magang — All Users berlaku untuk semua orang).
4. Grup Magang: akses hanya ke `DATA BPS`, `create-queries = query-builder-and-native` (aman setelah langkah 1), `download-results` dibatasi.
5. Pertimbangkan menghapus `metabase_db` sebagai data source bila tidak dipakai dashboard.

### 8.3 Temuan terpisah (bukan akibat magang)

- Password koneksi tersimpan **plaintext** di `metabase_database.details` → `MB_ENCRYPTION_SECRET_KEY` belum diset. Nilainya juga sempat tercetak di transkrip sesi 2026-08-12. **Rotasi password `metabase_bps_ro` disarankan.**
- MariaDB `LISTEN 0.0.0.0:3306` (terbuka ke LAN), dan terdapat user `root@%` serta `admin@%` yang boleh konek dari host mana pun.

---

## 9. Keputusan

**Sudah diputuskan (2026-08-12):**

1. Setelan memori box **tidak diubah**. Pagar sumber daya dipasang di sisi magang saja (§5).
2. Fokus pekerjaan adalah **pelingkupan** — memastikan magang tidak dapat merusak produksi selain MALIKA.
3. Magang **tidak** menyentuh instance MALIKA produksi (`pds-*`) pada tahap awal; sandbox milik sendiri sudah cukup. Deploy produksi tetap tindakan manual pemilik server.

**Dapat ditinjau kemudian:**

- Bila magang terbukti dan perlu ikut deploy produksi: siapkan skrip root-owned `/usr/local/sbin/malika-deploy` dengan satu entri sudo NOPASSWD — sempit dan bisa diaudit, jauh lebih aman daripada memberi akses PM2 root. Jangan berikan akses PM2 root dalam kondisi apa pun.

---

## 10. Di luar lingkup

`npm run build` menimpa `.next` saat `next start` menyajikan trafik — risiko produksi yang sudah ada terlepas dari magang, dan menjadi lebih relevan seiring bertambahnya kontributor. Ditangani terpisah agar lingkup dokumen ini tetap fokus.
