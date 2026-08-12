// Instance sandbox anak magang. Port dan batas memori sengaja berbeda
// dari ecosystem.config.js (produksi) supaya keduanya bisa hidup bersama.
// Dijalankan dengan PM2 milik user magang sendiri, bukan PM2 root.
//
// PORT SENGAJA SAMA UNTUK SEMUA MAGANG. Box ini hanya sanggup menampung
// satu stack sandbox pada satu waktu, dan tidak ada pagar memori tingkat
// kernel (cgroup dilarang; ulimit -v justru mematikan Node — VSZ Node+ONNX
// ~5 GB padahal RSS ~430 MB). Dengan port yang sama, magang kedua ditolak
// kernel lewat EADDRINUSE: giliran jadi batas teknis, bukan kesepakatan.
//
// max_memory_restart mengukur RSS — inilah satu-satunya pagar memori yang
// benar-benar bekerja di sini. Jangan dinaikkan.
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
