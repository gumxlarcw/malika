export type ChangelogCategory = "baru" | "perbaikan" | "peningkatan";

export type ChangelogEntry = {
  id: string;
  title: string;
  summary: string;
  details?: string[];
  category: ChangelogCategory;
  area: string;
};

/** Satu rilis per hari — versi mengikuti format YYYY.MM.DD */
export type ChangelogRelease = {
  /** Versi bertitik, mis. "2026.05.08" */
  version: string;
  /** Tanggal ISO YYYY-MM-DD */
  date: string;
  /** Ringkasan satu baris untuk hari tersebut */
  headline?: string;
  entries: ChangelogEntry[];
};

export const CHANGELOG_CATEGORY_LABELS: Record<ChangelogCategory, string> = {
  baru: "Fitur Baru",
  perbaikan: "Perbaikan",
  peningkatan: "Peningkatan",
};

/** Ubah tanggal ISO menjadi versi bertitik (2026-05-08 → 2026.05.08). */
export function dateToVersion(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${y}.${m}.${d}`;
}

/** Format tampilan versi dengan prefiks v (v2026.05.08). */
export function formatVersionLabel(version: string): string {
  return version.startsWith("v") ? version : `v${version}`;
}

/**
 * Riwayat lengkap MALIKA — dikompilasi per hari, ditulis untuk pengguna.
 * Sumber: git log + docs/workspace + docs/peta-tematik/CHANGELOG.md
 */
export const CHANGELOG_RELEASES: ChangelogRelease[] = [
  {
    version: "2026.08.14",
    date: "2026-08-14",
    headline: "Halaman Change Log untuk transparansi pembaruan",
    entries: [
      {
        id: "change-log-page",
        area: "Aplikasi",
        category: "baru",
        title: "Menu Change Log di sidebar",
        summary:
          "Anda kini bisa melihat ringkasan semua pembaruan MALIKA dalam satu halaman — diurutkan per hari dengan nomor versi.",
        details: [
          "Setiap hari rilis punya versi bertitik (contoh: v2026.05.08).",
          "Penjelasan sengaja ditulis tanpa istilah teknis.",
        ],
      },
    ],
  },
  {
    version: "2026.05.17",
    date: "2026-05-17",
    headline: "Penyempurnaan tampilan arsip dokumen",
    entries: [
      {
        id: "archive-chrome-blend",
        area: "BRS & Publikasi",
        category: "peningkatan",
        title: "Arsip BRS & Publikasi lebih selaras dengan tampilan MALIKA",
        summary:
          "Halaman arsip dokumen resmi kini memakai gaya visual yang sama dengan halaman lain — lebih nyaman dibaca di HP maupun desktop.",
      },
    ],
  },
  {
    version: "2026.05.16",
    date: "2026-05-16",
    headline: "Chat MALIKA disederhanakan jadi satu identitas",
    entries: [
      {
        id: "chat-single-identity",
        area: "Chat MALIKA",
        category: "peningkatan",
        title: "Satu wajah MALIKA — tanpa pilihan model",
        summary:
          "Dropdown pemilihan model AI dihapus. Semua percakapan kini tampil sebagai MALIKA saja, sehingga pengalaman lebih konsisten dan tidak membingungkan.",
      },
      {
        id: "insights-stability",
        area: "Chat MALIKA",
        category: "perbaikan",
        title: "Ringkasan otomatis di chat lebih stabil",
        summary:
          "Fitur insight/ringkasan di dalam chat diperbaiki agar lebih andal saat diproses — tanpa perubahan cara Anda menggunakannya.",
      },
    ],
  },
  {
    version: "2026.05.15",
    date: "2026-05-15",
    headline: "BRS dan Publikasi digabung jadi satu arsip",
    entries: [
      {
        id: "archive-unified",
        area: "BRS & Publikasi",
        category: "baru",
        title: "Arsip editorial BRS + Publikasi",
        summary:
          "Berita Resmi Statistik (BRS) dan Publikasi BPS sekarang ada dalam satu halaman arsip. Telusuri dokumen resmi tanpa pindah menu.",
        details: [
          "Filter dan pencarian arsip tetap tersedia.",
          "Menu sidebar tetap bernama BRS & Publikasi.",
        ],
      },
    ],
  },
  {
    version: "2026.05.13",
    date: "2026-05-13",
    headline: "Chat lebih tepat untuk data triwulan dan pertanyaan kompleks",
    entries: [
      {
        id: "chat-quarter-filter",
        area: "Chat MALIKA",
        category: "perbaikan",
        title: "Jawaban triwulan/bulan lebih akurat",
        summary:
          "Saat Anda menanyakan data per triwulan atau periode tertentu, MALIKA lebih teliti memilih baris data yang sesuai — bukan campuran periode lain.",
      },
      {
        id: "chat-negation",
        area: "Chat MALIKA",
        category: "perbaikan",
        title: "Pemahaman pertanyaan ber-negasi lebih baik",
        summary:
          "Pertanyaan dengan kata 'bukan', 'tidak', atau lawan kata lainnya ditangani lebih baik saat MALIKA mencari indikator yang relevan.",
      },
      {
        id: "chat-personnel-deferral",
        area: "Chat MALIKA",
        category: "perbaikan",
        title: "Pertanyaan tentang pejabat ditangani lebih hati-hati",
        summary:
          "MALIKA tidak lagi asal menyebut nama pejabat BPS; untuk pertanyaan kepegawaian, jawaban diarahkan ke sumber resmi.",
      },
    ],
  },
  {
    version: "2026.05.12",
    date: "2026-05-12",
    headline: "Paket peningkatan akurasi jawaban Chat MALIKA",
    entries: [
      {
        id: "chat-term-split",
        area: "Chat MALIKA",
        category: "peningkatan",
        title: "Pertanyaan gabungan lebih mudah dipahami",
        summary:
          "Pertanyaan yang menggabungkan beberapa istilah statistik (misalnya inflasi dan pengangguran sekaligus) dikenali lebih baik.",
      },
      {
        id: "chat-date-awareness",
        area: "Chat MALIKA",
        category: "peningkatan",
        title: "MALIKA tahu tanggal hari ini",
        summary:
          "MALIKA mempertimbangkan tanggal saat ini dan jadwal rilis data BPS, sehingga jawaban tentang 'data terbaru' lebih masuk akal.",
      },
      {
        id: "chat-period-fallback",
        area: "Chat MALIKA",
        category: "peningkatan",
        title: "Penjelasan saat data periode belum ada",
        summary:
          "Jika data untuk periode yang Anda minta belum dirilis, MALIKA menjelaskan dengan bahasa yang lebih jelas alih-alih hanya menolak.",
      },
      {
        id: "chat-no-fabricated-names",
        area: "Chat MALIKA",
        category: "perbaikan",
        title: "Larangan menyebut nama pejabat fiktif",
        summary:
          "MALIKA tidak akan mengarang nama pejabat atau petugas BPS — mencegah informasi kepegawaian yang salah.",
      },
      {
        id: "chat-multi-indicator",
        area: "Chat MALIKA",
        category: "peningkatan",
        title: "Analisis multi-indikator lebih fokus",
        summary:
          "Saat Anda minta analisis komprehensif beberapa indikator sekaligus, MALIKA menyusun jawaban lebih terstruktur.",
      },
      {
        id: "chat-hallucination-guard",
        area: "Chat MALIKA",
        category: "perbaikan",
        title: "Pengawasan angka yang tidak masuk akal",
        summary:
          "MALIKA lebih waspada agar tidak menyebut angka statistik fiktif untuk tahun yang belum ada datanya.",
      },
    ],
  },
  {
    version: "2026.05.11",
    date: "2026-05-11",
    headline: "Tombol lapor di chat",
    entries: [
      {
        id: "chat-report-flag",
        area: "Chat MALIKA",
        category: "baru",
        title: "Tombol Laporkan di balasan MALIKA",
        summary:
          "Jika ada jawaban yang kurang tepat, Anda bisa menandainya langsung dari chat. Tim kami memakai laporan ini untuk evaluasi kualitas.",
        details: [
          "Tombol tersedia di setiap balasan asisten MALIKA.",
          "Anda bisa memberi konteks singkat saat melaporkan.",
        ],
      },
    ],
  },
  {
    version: "2026.05.09",
    date: "2026-05-09",
    headline: "Penampil data baru + kualitas data lebih bersih",
    entries: [
      {
        id: "data-viewer-redesign",
        area: "Data Statistik",
        category: "peningkatan",
        title: "Penampil tabel data dirancang ulang",
        summary:
          "Halaman lihat data (setelah memilih indikator) punya layout baru — lebih mudah dibaca, difilter, dan diekspor ke Excel/PDF.",
      },
      {
        id: "value-code-a-label",
        area: "Data Statistik",
        category: "peningkatan",
        title: "Label catatan data 'a' ditambahkan",
        summary:
          "Kode catatan khusus 'a' di sel tabel kini punya penjelasan yang jelas saat Anda arahkan kursor ke tanda kecilnya.",
      },
      {
        id: "data-year-cleanup",
        area: "Data Statistik",
        category: "perbaikan",
        title: "Data tahun tidak valid dibersihkan",
        summary:
          "Data dengan tahun 0 atau di luar rentang wajar (sebelum 2000 / setelah 2100) tidak lagi muncul — angka yang Anda lihat lebih dapat dipercaya.",
      },
    ],
  },
  {
    version: "2026.05.08",
    date: "2026-05-08",
    headline: "Rilis besar — platform MALIKA + pembaruan fitur utama",
    entries: [
      {
        id: "platform-launch",
        area: "Aplikasi",
        category: "baru",
        title: "Peluncuran platform MALIKA",
        summary:
          "MALIKA siap dipakai sebagai portal data BPS Maluku Utara: dashboard, chat AI, peta, katalog data, arsip dokumen, notifikasi, dan feedback.",
        details: [
          "Instal sebagai PWA di HP (Add to Home Screen).",
          "Navigasi sidebar + bottom bar di mobile.",
          "Mode gelap mengikuti preferensi perangkat.",
        ],
      },
      {
        id: "peta-tematik-launch",
        area: "Peta Tematik",
        category: "baru",
        title: "Peta Tematik interaktif (Leaflet)",
        summary:
          "Jelajahi 200+ indikator per kabupaten/kota Maluku Utara dalam peta warna interaktif — migrasi dari embed Metabase ke peta native yang lebih cepat.",
        details: [
          "Pilih indikator, tahun, dan triwulan/bulan.",
          "Grafik batang terhubung dengan hover di peta.",
          "5 palet warna dan 3 metode pembagian kelas data.",
          "Bagikan atau embed peta lewat tautan.",
          "Cari indikator dengan Command Palette (Ctrl+K).",
        ],
      },
      {
        id: "peta-metadata",
        area: "Peta Tematik",
        category: "peningkatan",
        title: "Info indikator lengkap di drawer peta",
        summary:
          "Saat membuka detail kabupaten/kota, definisi, rumus, satuan, dan sumber data BPS ditampilkan lengkap.",
      },
      {
        id: "chat-ui-redesign",
        area: "Chat MALIKA",
        category: "peningkatan",
        title: "Tampilan chat baru dengan langkah berpikir",
        summary:
          "Chat MALIKA punya antarmuka baru: kartu langkah proses, empty state yang ramah, dan saran pertanyaan cepat (quick replies).",
        details: [
          "Langkah proses (mencari data, menyusun jawaban, dll.) bisa dibuka/tutup.",
          "Langkah yang sudah selesai dikelompokkan dalam dropdown.",
        ],
      },
      {
        id: "chat-loading",
        area: "Chat MALIKA",
        category: "perbaikan",
        title: "Chat terbuka lebih cepat",
        summary:
          "Area chat muncul lebih dulu; saran pertanyaan menunggu sampai MALIKA siap agar tidak menampilkan chip usang.",
      },
      {
        id: "chat-dynamic-suggestions",
        area: "Chat MALIKA",
        category: "baru",
        title: "Saran pertanyaan dinamis per percakapan",
        summary:
          "Chip saran di bawah chat kini diambil dari server sesuai konteks thread — bukan daftar statis yang sama untuk semua.",
      },
      {
        id: "chat-table-value-codes",
        area: "Chat MALIKA",
        category: "peningkatan",
        title: "Tabel di chat menampilkan catatan sel data",
        summary:
          "Saat MALIKA menampilkan tabel data di popup, tanda catatan khusus (nihil, belum tersedia, dll.) ikut ditampilkan.",
      },
      {
        id: "chat-ui-meta-persist",
        area: "Chat MALIKA",
        category: "perbaikan",
        title: "Kartu interaktif chat tersimpan di riwayat",
        summary:
          "Visualisasi dan metadata UI di balasan MALIKA tidak hilang saat Anda membuka kembali percakapan lama.",
      },
      {
        id: "kategori-redesign",
        area: "Data Statistik",
        category: "peningkatan",
        title: "Halaman kategori data dirancang ulang",
        summary:
          "Daftar kategori dan halaman detail indikator lebih mudah dipindai — hero berwarna per kategori, grafik komposisi, filter tipe sumber.",
        details: [
          "Pencarian dan filter WebAPI / Mikrodata / dll. lebih jelas.",
          "Halaman kategori yang tidak ada kini menampilkan pesan 404 yang benar.",
        ],
      },
      {
        id: "value-code-flags",
        area: "Data Statistik",
        category: "baru",
        title: "Catatan khusus di sel tabel data",
        summary:
          "Angka di tabel bisa punya tanda kecil untuk nihil (–), belum tersedia (...), tidak berlaku (NA), dan kode lainnya.",
        details: [
          "Arahkan kursor ke tanda kecil untuk penjelasan singkat.",
          "Berlaku di halaman /data dan tabel di chat.",
        ],
      },
      {
        id: "search-semantic",
        area: "Pencarian",
        category: "peningkatan",
        title: "Pencarian indikator lebih pintar di chat",
        summary:
          "MALIKA bisa mencari indikator secara semantik (bukan hanya kata kunci persis) sehingga pertanyaan natural lebih mudah ketemu datanya.",
      },
      {
        id: "brs-publikasi-separate",
        area: "BRS & Publikasi",
        category: "baru",
        title: "Arsip Berita Resmi Statistik & Publikasi",
        summary:
          "Telusuri rilis pers BPS dan publikasi resmi — dengan thumbnail, filter, dan pratinjau PDF (sebelum digabung 2026.05.15).",
      },
      {
        id: "notifications-settings",
        area: "Notifikasi",
        category: "baru",
        title: "Notifikasi & pengaturan per perangkat",
        summary:
          "Lihat riwayat notifikasi dan atur preferensi push dari menu Settings — tanpa perlu login.",
      },
      {
        id: "feedback-page",
        area: "Feedback",
        category: "baru",
        title: "Halaman feedback pengguna",
        summary:
          "Berikan rating bintang dan ulasan singkat tentang pengalaman Anda menggunakan MALIKA; lihat juga statistik feedback komunitas.",
      },
      {
        id: "reduced-motion",
        area: "Aplikasi",
        category: "perbaikan",
        title: "Animasi loading tetap hidup saat reduced-motion",
        summary:
          "Pengguna dengan preferensi 'kurangi animasi' di perangkat tetap melihat indikator loading yang berfungsi — tidak beku diam.",
      },
    ],
  },
  {
    version: "2026.03.02",
    date: "2026-03-02",
    headline: "Stabilitas awal chat & komponen pendukung",
    entries: [
      {
        id: "chat-threads-fix",
        area: "Chat MALIKA",
        category: "perbaikan",
        title: "Riwayat percakapan chat diperbaiki",
        summary:
          "Daftar thread chat MALIKA kembali dimuat dengan benar — percakapan lama tidak lagi hilang dari sidebar.",
      },
      {
        id: "chat-export-rating",
        area: "Chat MALIKA",
        category: "baru",
        title: "Ekspor, rating, dan pintasan keyboard chat",
        summary:
          "Fitur ekspor percakapan, modal rating jawaban, dan daftar pintasan keyboard ditambahkan ke chat MALIKA.",
      },
      {
        id: "splash-screen",
        area: "Aplikasi",
        category: "perbaikan",
        title: "Layar pembuka (splash) diperbaiki",
        summary:
          "Logo dan teks MALIKA tampil benar saat aplikasi pertama kali dibuka — tidak lagi kosong karena gambar hilang.",
      },
    ],
  },
];

/** Versi aplikasi terbaru (rilis pertama dalam daftar). */
export const CURRENT_APP_VERSION =
  CHANGELOG_RELEASES[0]?.version ??
  dateToVersion(new Date().toISOString().slice(0, 10));

/** Semua entri flat — untuk pencarian atau statistik. */
export const CHANGELOG_ENTRIES: ChangelogEntry[] = CHANGELOG_RELEASES.flatMap(
  (release) => release.entries,
);

/** Rilis terurut dari terbaru ke terlama. */
export function getChangelogReleasesSorted(
  releases: ChangelogRelease[] = CHANGELOG_RELEASES,
): ChangelogRelease[] {
  return [...releases].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
}

/** Grup per hari dengan versi — untuk tampilan timeline. */
export function groupChangelogByDay(
  releases: ChangelogRelease[] = CHANGELOG_RELEASES,
): ChangelogRelease[] {
  return getChangelogReleasesSorted(releases);
}

function formatDayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function formatReleaseHeading(release: ChangelogRelease): string {
  return `${formatDayLabel(release.date)} · ${formatVersionLabel(release.version)}`;
}
