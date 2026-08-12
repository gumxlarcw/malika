# Panduan Anak Magang — MALIKA

Dokumen ini untuk kamu yang baru bergabung mengerjakan MALIKA. Ikuti dari atas.

## Yang kamu punya

- **User Linux di server**: `magang1` atau `magang2` (tanya pembimbing yang mana)
- **Sandbox sendiri**: backend `:5200`, admin `:5250`, frontend `:6200` — dipakai bergiliran, lihat bagian "Sandbox bergiliran"
- **Database sendiri**: `pds_dev1` atau `pds_dev2` — sudah terisi data, siap pakai
- **Metabase**: akun grup Magang, akses data source `DATA BPS`
- **Kode**: clone dari repo di server ini (belum perlu akun GitHub)

## Yang tidak bisa kamu lakukan — dan itu memang disengaja

`/var/www/html/project-data-strategis` adalah **produksi**, melayani
`malika.bpsmalut.com` untuk pengguna sungguhan. Kamu tidak punya izin tulis
ke sana. Jangan pernah menjalankan `npm run build` di direktori itu —
perintah tersebut langsung menimpa bundle yang sedang disajikan.

`pm2` yang kamu jalankan adalah **daemon milikmu sendiri**. Kamu tidak akan
melihat 45 service produksi di `pm2 list`, dan itu normal, bukan error.

Kamu juga tidak bisa membaca file `.env` project lain, dan port-forwarding
SSH ditutup. Semua itu batas yang sengaja dipasang; jangan mencari jalan
memutarnya — kalau ada yang kamu butuhkan tapi terhalang, bilang ke pembimbing.

## Setup pertama kali

### 1. Ambil kode

Untuk sekarang kode diambil langsung dari repo di server ini — belum perlu
akun GitHub.

```bash
cd ~
git clone /var/www/html/project-data-strategis malika
cd malika
```

Kalau muncul `fatal: detected dubious ownership`, jalankan sekali ini lalu
ulangi clone (repo produksi dimiliki user lain, jadi git minta konfirmasi):

```bash
git config --global --add safe.directory /var/www/html/project-data-strategis
git config --global --add safe.directory /var/www/html/project-data-strategis/.git
```

Identitas commit-mu:

```bash
git config --global user.name  "Nama Kamu"
git config --global user.email "email-kamu@contoh.com"
```

`origin` menunjuk ke repo produksi dan bersifat **baca saja** — `git push`
ke sana akan ditolak, dan itu memang disengaja. Ambil perubahan terbaru
dengan `git pull origin main`.

File `.env` tidak ikut ter-clone (memang di-gitignore); kamu membuatnya
sendiri di langkah 3.

### 3. Environment

```bash
cp backend/.env.example backend/.env
```

Isi minimal berikut (ganti `N` dengan nomor akunmu — `magang1` → `pds_dev1`):

```
DB_HOST=localhost
DB_USER=pds_devN
DB_NAME=pds_devN
DB_PASS=<minta ke pembimbing>

MALIKA_ANON_SECRET=<hasil: openssl rand -hex 32>
JWT_SECRET=<hasil: openssl rand -hex 32>

OPENAI_API_BASE_URL=https://bps8200.tail8e7302.ts.net/v1
OPENAI_API_KEY=<key proxy milikmu, minta ke pembimbing>
```

`MALIKA_ANON_SECRET` wajib diisi. Kalau kosong, backend gagal start dengan
error saat import chat controller — bukan bug, memang dirancang fail-closed.

Kalau kamu ingin bereksperimen dengan model atau NLP lain, ganti saja
`OPENAI_API_BASE_URL` ke milikmu. Itu diperbolehkan.

### 4. Dependency dan build

```bash
cd ~/malika
./scripts/build-all.sh
```

Skrip ini sudah ada di repo dan mengurus install + build backend, admin, dan
frontend sekaligus.

### 5. Jalankan

```bash
cd ~/malika
pm2 start ecosystem.dev.js
pm2 logs dev-backend
```

Buka `http://localhost:6200` (atau lewat SSH tunnel dari laptopmu bila
pembimbing sudah menyiapkan aksesnya).

Admin di-build dengan mode `standalone`, jadi yang dijalankan adalah
`.next/standalone/server.js`, bukan `next start`. `ecosystem.dev.js` sudah
mengaturnya; kamu tidak perlu menghafalnya.

## Sandbox bergiliran

Kalian berdua memakai port yang sama: `5200`, `5250`, `6200`. Kalau temanmu
sedang menjalankan sandbox, `pm2 start` milikmu gagal dengan `EADDRINUSE`.

**Itu bukan bug.** Server ini dipakai bersama 45 service produksi lain dan
memorinya sudah sesak; hanya muat satu stack sandbox pada satu waktu. Port
yang sama membuat batas itu ditegakkan sistem, bukan bergantung siapa yang ingat.

Cek siapa yang sedang memakai:

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

## Aturan memori

- Pakai `./scripts/build-all.sh` lalu `pm2 start`, **jangan** `npm run dev`.
  Mode dev jauh lebih boros dan bisa menjatuhkan layanan orang lain.
- **Jangan menaikkan `max_memory_restart`** di `ecosystem.dev.js`. Angka itu
  satu-satunya pengaman yang mencegah proses kalian menjatuhkan produksi.

## Reset database kalau rusak

Datamu sendiri, bebas diobok-obok. Kalau kacau, muat ulang:

```bash
mysql -u pds_devN -p -e "DROP DATABASE pds_devN; CREATE DATABASE pds_devN
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
zcat /srv/magang/dev-seed.sql.gz | mysql -u pds_devN -p pds_devN
```

Isi database ini sudah disanitasi: percakapan pengguna, memori pengguna, dan
seluruh log dikosongkan, serta email/nomor telepon di dalam isi dokumen
diganti `[email-redacted]` / `[hp-redacted]`. Kalau kamu menemukan data yang
tampak pribadi, **laporkan ke pembimbing** — jangan disalin ke mana pun.

Akun admin dev: `devadmin@local.test` / `magang123`.

## Alur kontribusi

```bash
git checkout -b fitur/nama-singkat
# ... kerjakan ...
npm --prefix backend test
git add <file-spesifik>          # jangan `git add -A`
git commit -m "feat: deskripsi singkat"
```

Kerjaanmu tetap di clone milikmu. Kalau sudah siap ditinjau, **beri tahu
pembimbing nama branch-mu** — pembimbing menariknya langsung dari clone-mu:

```bash
# dijalankan pembimbing, bukan kamu
git fetch /home/magang1/malika fitur/nama-singkat
```

Jadi kamu tidak perlu push ke mana pun. Jangan menyalin kode ke luar server
(email, Drive pribadi, flashdisk) — kirim lewat branch saja.

Ambil perubahan terbaru secara berkala supaya tidak jauh tertinggal:

```bash
git pull origin main
```

Merge tidak berarti tayang. Deploy ke produksi dilakukan pembimbing secara
manual setelah review.

> Nanti kalau akses GitHub dibuka, alurnya berubah jadi fork + Pull Request.
> Pembimbing akan memberi tahu saat itu tiba.

## Kalau tersangkut

| Gejala | Penyebab |
|---|---|
| Backend gagal start, error soal `MALIKA_ANON_SECRET` | Key itu wajib; isi `openssl rand -hex 32` |
| `pm2 start` gagal `EADDRINUSE` | Temanmu sedang memakai sandbox; tunggu giliran |
| `pm2` error `spawn ... EACCES` | Jalankan dari direktori yang bisa kamu akses (`cd ~/malika` dulu) |
| Chat menjawab error / 503 | Cek `OPENAI_API_BASE_URL` dan key proxy-mu |
| `pm2 list` kosong | Normal — itu daemon milikmu sendiri |

Dokumentasi per area ada di `docs/workspace/<area>.md`: `backend.md`,
`frontend.md`, `admin.md`, `chat-pipeline.md`, `database.md`.
