# Panduan Anak Magang — MALIKA

Dokumen ini untuk kamu yang baru bergabung mengerjakan MALIKA. Ikuti dari atas.

## Yang kamu punya

- **User Linux di server**: `magang1` atau `magang2` (tanya pembimbing yang mana)
- **Sandbox sendiri**: backend `:5200`, admin `:5250`, frontend `:6200` — dipakai bergiliran, lihat bagian "Sandbox bergiliran"
- **Database sendiri**: `pds_dev1` atau `pds_dev2` — sudah terisi data, siap pakai
- **Metabase**: akun grup Magang, akses data source `DATA BPS`
- **Workspace siap pakai** di `~/malika`: kode, dependency, hasil build, dan `.env` sudah disiapkan (belum perlu akun GitHub)

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

## Mulai bekerja — workspace-mu sudah siap

Kamu **tidak perlu clone, install, atau build apa pun**. Semuanya sudah
disiapkan di `~/malika`: kode, dependency (2,3 GB), hasil build, dan `.env`
yang sudah menunjuk ke database milikmu.

```bash
ssh magang1@<alamat-server>      # atau magang2
cd ~/malika
ss -ltn | grep -E ':(5200|5250|6200)\b'    # kosong = giliranmu
pm2 start ecosystem.dev.config.js
```

Buka `http://localhost:6200`. Selesai — itu saja untuk mulai.

Satu-satunya yang mungkin perlu kamu isi sendiri di `backend/.env` adalah
`OPENAI_API_KEY` (key proxy LLM, minta ke pembimbing) kalau kamu mengerjakan
fitur chat. Sisanya — `DB_*`, `MALIKA_ANON_SECRET`, `JWT_SECRET` — sudah terisi.

Kalau ingin bereksperimen dengan model atau NLP lain, ganti saja
`OPENAI_API_BASE_URL` di `backend/.env` ke milikmu. Itu diperbolehkan.

### Identitas commit

Sekali saja, supaya commit-mu bernama:

```bash
git config --global user.name  "Nama Kamu"
git config --global user.email "email-kamu@contoh.com"
```

### Kalau perlu memasang ulang dependency

Jarang dibutuhkan, tapi kalau `node_modules` rusak:

```bash
cd ~/malika/frontend && npm ci --legacy-peer-deps
```

⚠️ **Wajib pakai `npm ci --legacy-peer-deps`, bukan `npm install`.**
`react-leaflet@4.2.1` menuntut React 18 sementara project ini memakai React 19,
jadi `npm install` biasa gagal dengan `ERESOLVE`. Flag itu memakai pohon
dependency terkunci di `package-lock.json` yang memang sudah terbukti jalan.
`./scripts/build-all.sh` memakai `npm install` biasa, jadi **jangan dipakai
dari nol** — skrip itu untuk deploy produksi, bukan untuk menyiapkan workspace.

Setelah install ulang, build lagi:

```bash
cd ~/malika/backend/admin && npm run build
cd ~/malika/frontend      && npm run build
```

Admin di-build dengan mode `standalone`, jadi yang dijalankan adalah
`.next/standalone/server.js`, bukan `next start`. `ecosystem.dev.config.js`
sudah mengaturnya; kamu tidak perlu menghafalnya.

### Mengambil perubahan terbaru

`origin` menunjuk ke repo produksi dan bersifat **baca saja** — `git push`
ke sana akan ditolak, dan itu memang disengaja.

```bash
git pull origin main
```

## Sandbox bergiliran

Kalian berdua memakai port yang sama: `5200`, `5250`, `6200`. Kalau temanmu
sedang menjalankan sandbox, `pm2 start` milikmu gagal dengan `EADDRINUSE`.

**Itu bukan bug.** Server ini dipakai bersama 45 service produksi lain dan
memorinya sudah sesak; hanya muat satu stack sandbox pada satu waktu. Port
yang sama membuat batas itu ditegakkan sistem, bukan bergantung siapa yang ingat.

**SELALU cek dulu sebelum `pm2 start`:**

```bash
ss -ltn | grep -E ':(5200|5250|6200)\b'      # ada isinya = giliran orang lain
```

⚠️ **Jangan percaya `pm2 list` untuk hal ini.** `dev-admin` dan `dev-frontend`
memang akan berstatus `errored` kalau port terpakai — itu sinyal yang benar.
Tapi **`dev-backend` tetap tampil hijau `online` walau gagal mengikat port**;
prosesnya hidup tanpa melayani apa pun. Kalau kamu memaksa lanjut, request ke
`localhost:5200` sebenarnya masuk ke backend **milik temanmu**, bukan milikmu.

Aturan praktisnya: kalau `dev-admin` atau `dev-frontend` `errored`, hentikan
semuanya (`pm2 delete all`) dan tunggu giliran.

Selesai bekerja, **selalu** lepaskan giliran:

```bash
pm2 stop all
```

Yang tetap bisa kalian kerjakan bersamaan: `npm test` (jest tidak mengikat
port), menulis kode, `git`, dan query Metabase. Hanya sandbox hidupnya yang
bergiliran.

## Aturan memori

- Pakai hasil build yang sudah ada lalu `pm2 start`, **jangan** `npm run dev`.
  Mode dev jauh lebih boros dan bisa menjatuhkan layanan orang lain.
- **Jangan menaikkan `max_memory_restart`** di `ecosystem.dev.config.js`. Angka itu
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
| `dev-backend` hijau tapi API tak merespons | Port 5200 dipegang sandbox temanmu; `dev-backend` gagal bind tanpa error. Cek `ss -ltn` |
| `pm2` error `spawn ... EACCES` | Jalankan dari direktori yang bisa kamu akses (`cd ~/malika` dulu) |
| Chat menjawab error / 503 | Cek `OPENAI_API_BASE_URL` dan key proxy-mu |
| `pm2 list` kosong | Normal — itu daemon milikmu sendiri |

Dokumentasi per area ada di `docs/workspace/<area>.md`: `backend.md`,
`frontend.md`, `admin.md`, `chat-pipeline.md`, `database.md`.
