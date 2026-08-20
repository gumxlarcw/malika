/**
 * Bilingual copy for the site chrome and the landing page.
 *
 * Key names are kept verbatim from the source design (`MALIKA Landing.dc.html`
 * in the "Landing page redesign mockup" project) so a later re-sync against the
 * design stays a mechanical diff rather than a rename exercise.
 *
 * Lives here rather than under the landing route because the shared header and
 * footer read from it on every page. Only the chrome's own strings are
 * translated site-wide: the sub-page bodies are Indonesian, so the ID/EN pills
 * retitle the header and footer and leave page content alone.
 */

export type Lang = "id" | "en";

const ID = {
  // header + nav
  tNavMenu: "Menu lengkap",
  tNavKonsul: "Konsultasi",
  tNavLayanan: "Layanan resmi",
  tInstall: "Install app",
  tThemeLabel: "Ubah tema",
  tSearchLabel: "Cari data statistik",

  // hero
  tHeroL1: "Tanya apa saja soal",
  tHeroL3: "data Maluku Utara",
  tHeroSub:
    "MALIKA menjawab dengan angka, tabel, dan grafik dari Badan Pusat Statistik — tanpa perlu tahu nama tabelnya.",
  tHeroCta: "Tanya MALIKA",
  tChip1: "Inflasi Ternate bulan ini",
  tChip2: "Bandingkan TPT antar kabupaten",
  tChip3: "Produksi perikanan 5 tahun terakhir",
  tChip4: "Harga cabai rawit terkini",
  tStat1: "1.240+ indikator",
  tStat2: "10 kabupaten/kota",
  tStat3: "Sumber tunggal: BPS",
  tStat4: "Gratis & tanpa login",

  // menu tiles
  tMenuH: "Semua menu, di halaman ini",
  tMenuSub: "Pilih langsung ke mana Anda ingin pergi.",
  tTile1s: "Indikator kunci dalam satu papan",
  tTile2s: "Bandingkan 10 kabupaten/kota",
  tTile3s: "Tanya dengan bahasa sehari-hari",
  tTile4s: "Jelajahi per kategori & tabel",
  tTile5s: "Rilis resmi & unduhan PDF",
  tTile6s: "Laporkan angka atau minta data",
  tTile7: "Pengaturan",
  tTile7s: "Tema, bahasa, notifikasi",
  tTile8s: "Pilih spesialis data, Zoom atau di kantor",
  tTileBadge: "Perlu daftar",

  // headline figures
  tIndH: "Angka utama Maluku Utara",
  tIndSub: "Indikator utama · nilai contoh untuk mockup",
  tIndLink: "Buka dashboard",

  // peta tematik
  tPetaH: "Lihat perbedaan antar kabupaten/kota dalam satu tatapan",
  tPetaSub:
    "Pilih indikator, geser tahun, dan bandingkan capaian 10 kabupaten/kota. Klik satu wilayah untuk melihat detail dan tren.",
  tPetaCta: "Buka peta",
  tPetaMeta: "1.240+ indikator · 2010–2026",
  tLow: "Rendah",
  tHigh: "Tinggi",
  tIndicator: "Tingkat kemiskinan",
  tPopLabel: "Indikator populer",
  tPop1: "Tingkat kemiskinan",
  tPop2: "TPT",
  tPop3: "IPM",
  tPop4: "Pertumbuhan ekonomi",
  tStatA: "kabupaten/kota",
  tStatB: "indikator tersedia",
  tStatBNum: "1.240+",
  tStatC: "tahun rentang data",
  tRank: "Peringkat",
  tRankOf: "dari 10",

  // konsultasi
  tKonsulH: "Konsultasi langsung dengan spesialis data",
  tKonsulSub: "Ajukan reservasi, lalu petugas mengonfirmasi jadwalnya",
  tKonsulBadge: "Perlu daftar / masuk dulu",
  tKonsulSoon: "Segera hadir",
  tStep1: "Daftar atau masuk",
  tStep1s: "Verifikasi email · sekali saja",
  tStep2: "Pilih spesialis",
  tStep2s: "Sesuai bidang datanya",
  tStep3: "Ajukan reservasi",
  tStep3s: "Usulkan waktu · Zoom atau tatap muka",
  tStep4: "Petugas konfirmasi",
  tStep4s: "Jadwal & tautan dikirim via email",
  tPhotoSlot: "Foto setengah badan (tanpa latar)",
  tViewProfile: "Lihat profil",
  tCtaH: "Daftar dulu untuk memesan jadwal konsultasi",
  tCtaSub:
    "Pendaftaran dipakai untuk memverifikasi identitas pemohon data. Ajukan waktu yang Anda inginkan beserta pilihan Zoom atau tatap muka, lalu petugas yang bersangkutan mengonfirmasi jadwalnya.",
  tCtaBtn: "Ajukan reservasi konsultasi",
  tCtaBtn2: "Sudah punya akun? Masuk",
  tTick1: "Gratis",
  tTick2: "Zoom atau tatap muka",
  tTick3: "Rekap hasil konsultasi dikirim via email",

  // kategori
  tKatH: "Jelajahi berdasarkan kategori",
  tKatSub: "Telusuri menurut bidang statistik",
  tKatLink: "Semua kategori",

  // rilis + trending
  tBrsH: "Rilis terbaru",
  tBrsSub: "Berita Resmi Statistik & publikasi",
  tBrsLink: "Lihat arsip",
  tTrenH: "Paling dicari",
  tTrenSub: "Tren 7 hari terakhir",

  // about
  tAboutH: "Tentang MALIKA",
  tAboutBody:
    "MALIKA — Maluku Utara Analytics & Insights for Knowledge Advancement — adalah portal data BPS Provinsi Maluku Utara yang menggabungkan pencarian, visualisasi, dan asisten AI dalam satu tempat.",
  tAboutBody2: "Satu pintu menuju statistik resmi Maluku Utara.",
  tSourceH: "Sumber data",
  tSrc1: "Basis data indikator strategis BPS Provinsi Maluku Utara",
  tSrc2: "Replika tabel dinamis BPS (data_bps)",
  tSrc3: "Berita Resmi Statistik & publikasi resmi",
  tSampleNote: "Angka pada mockup ini adalah contoh tampilan.",
  tHowH: "Cara pakai",
  tHow1: "Tulis pertanyaan seperti bicara pada petugas statistik.",
  tHow2: "Periksa tabel dan grafik yang dirujuk MALIKA.",
  tHow3: "Unduh atau bagikan tautan hasilnya.",

  // layanan resmi
  tLayananH: "Layanan resmi BPS lainnya",
  tLayananSub: "Tautan ke situs resmi BPS",
  tSvc1s: "Berita, publikasi, dan tabel statistik provinsi",
  tSvc2s: "Katalog dan koleksi digital BPS (OPAC)",
  tSvc3s: "Konsultasi serta pembelian publikasi dan data mikro",
  tSvc4s: "Rekomendasi kegiatan statistik sektoral",

  // footer
  tFootExplore: "Jelajahi",
  tFootPub: "Publikasi",
  tFootHelp: "Bantuan",
  tPub2: "Publikasi & unduhan",
  tPub3: "Notifikasi rilis",
  tHelp1: "Panduan pengguna",
  tHelp2: "Kirim feedback",
  tHelp3: "Pengaturan",
  tCopy:
    "© 2026 BPS Provinsi Maluku Utara. Data resmi, penggunaan bebas dengan menyebut sumber.",

  // modals
  tClose: "Tutup",
  tMRsvH: "Ajukan reservasi konsultasi",
  tMRsvSub:
    "Usulkan waktu dan cara konsultasi; petugas akan mengonfirmasi lewat email.",
  tMFieldWho: "Spesialis",
  tMFieldWhoHint: "Pilih petugas atau bidang data",
  tMFieldTopic: "Topik / data yang dibutuhkan",
  tMFieldTopicHint: "mis. angka kemiskinan Halmahera Selatan",
  tMFieldDate: "Tanggal usulan",
  tMFieldDateHint: "20 Agustus 2026",
  tMFieldTime: "Jam usulan",
  tMFieldTimeHint: "09.00–10.00 WIT",
  tMMode: "Cara konsultasi",
  tMModeZoom: "Zoom",
  tMModeOffice: "Datang ke kantor",
  tMRsvNote: "Konfirmasi maksimal 1 hari kerja.",
  tMRsvSend: "Kirim pengajuan",
  tMAuthH: "Masuk atau daftar",
  tMAuthSub: "Satu akun untuk reservasi konsultasi dan permintaan data.",
  tMAuthEmail: "Email",
  tMAuthOrg: "Instansi / keperluan",
  tMAuthOrgHint: "mis. Bappeda, mahasiswa, media",
  tMAuthSend: "Kirim tautan masuk",
  tMAuthNote: "Kami mengirim tautan masuk sekali pakai ke email Anda.",
  tMNotifH: "Notifikasi",
  tMPetugasNote:
    "Konsultasi dilayani sesuai piket Pelayanan Statistik Terpadu. Ajukan waktu yang Anda inginkan, petugas akan mengonfirmasi.",
  tMPetugasCta: "Ajukan reservasi dengan petugas ini",
  tMSoonH: "Reservasi konsultasi belum dibuka",
  tMSoonSub:
    "Daftar spesialis dan alur pemesanannya sudah bisa dilihat lebih dulu. Tombolnya aktif begitu layanannya siap.",
  tMSoonCta: "Mengerti",
} as const;

export type CopyKey = keyof typeof ID;
export type Copy = Record<CopyKey, string>;

const EN: Copy = {
  tNavMenu: "All menus",
  tNavKonsul: "Consultation",
  tNavLayanan: "Official services",
  tInstall: "Install app",
  tThemeLabel: "Switch theme",
  tSearchLabel: "Search statistics",

  tHeroL1: "Ask anything about",
  tHeroL3: "North Maluku data",
  tHeroSub:
    "MALIKA answers with figures, tables, and charts from Statistics Indonesia — no need to know the table name.",
  tHeroCta: "Ask MALIKA",
  tChip1: "Ternate inflation this month",
  tChip2: "Compare unemployment by regency",
  tChip3: "Fisheries output, last 5 years",
  tChip4: "Latest chilli prices",
  tStat1: "1,240+ indicators",
  tStat2: "10 regencies & cities",
  tStat3: "Single source: BPS",
  tStat4: "Free & no login",

  tMenuH: "Every menu, right on this page",
  tMenuSub: "Go straight to whatever you need.",
  tTile1s: "Key indicators on one board",
  tTile2s: "Compare 10 regencies and cities",
  tTile3s: "Ask in plain language",
  tTile4s: "Browse by category and table",
  tTile5s: "Official releases & PDF downloads",
  tTile6s: "Report a figure or request data",
  tTile7: "Settings",
  tTile7s: "Theme, language, notifications",
  tTile8s: "Pick a data specialist, Zoom or in person",
  tTileBadge: "Sign-up required",

  tIndH: "North Maluku headline figures",
  tIndSub: "Headline indicators · sample values for this mockup",
  tIndLink: "Open dashboard",

  tPetaH: "See the gap between regencies at a glance",
  tPetaSub:
    "Pick an indicator, scrub the year, and compare all 10 regencies and cities. Click a region for detail and trend.",
  tPetaCta: "Open the map",
  tPetaMeta: "1,240+ indicators · 2010–2026",
  tLow: "Low",
  tHigh: "High",
  tIndicator: "Poverty rate",
  tPopLabel: "Popular indicators",
  tPop1: "Poverty rate",
  tPop2: "Unemployment",
  tPop3: "Human development",
  tPop4: "Economic growth",
  tStatA: "regencies & cities",
  tStatB: "indicators available",
  tStatBNum: "1,240+",
  tStatC: "years of data",
  tRank: "Rank",
  tRankOf: "of 10",

  tKonsulH: "Talk to a data specialist",
  tKonsulSub: "Request a slot, then the officer confirms the schedule",
  tKonsulBadge: "Sign up / sign in first",
  tKonsulSoon: "Coming soon",
  tStep1: "Sign up or sign in",
  tStep1s: "Email verification · once only",
  tStep2: "Pick a specialist",
  tStep2s: "By subject-matter area",
  tStep3: "Request a booking",
  tStep3s: "Propose a time · Zoom or in person",
  tStep4: "Officer confirms",
  tStep4s: "Schedule & link sent by email",
  tPhotoSlot: "Half-body photo (no background)",
  tViewProfile: "View profile",
  tCtaH: "Register first to book a consultation",
  tCtaSub:
    "Registration verifies the requester's identity. Propose the time you want along with Zoom or in-person, then the officer confirms the schedule.",
  tCtaBtn: "Request a consultation",
  tCtaBtn2: "Already have an account? Sign in",
  tTick1: "Free",
  tTick2: "Zoom or in person",
  tTick3: "Summary sent by email",

  tKatH: "Browse by category",
  tKatSub: "Explore by subject-matter area",
  tKatLink: "All categories",

  tBrsH: "Latest releases",
  tBrsSub: "Official Statistics News & publications",
  tBrsLink: "View archive",
  tTrenH: "Most searched",
  tTrenSub: "Trending in the last 7 days",

  tAboutH: "About MALIKA",
  tAboutBody:
    "MALIKA — Maluku Utara Analytics & Insights for Knowledge Advancement — is the BPS North Maluku data portal, bringing search, visualisation, and an AI assistant into one place.",
  tAboutBody2: "A single front door to official statistics for North Maluku.",
  tSourceH: "Data sources",
  tSrc1: "BPS North Maluku strategic indicator database",
  tSrc2: "BPS dynamic table replica (data_bps)",
  tSrc3: "Official Statistics News & publications",
  tSampleNote: "Figures in this mockup are illustrative.",
  tHowH: "How to use it",
  tHow1: "Write your question as you would ask a statistician.",
  tHow2: "Check the tables and charts MALIKA cites.",
  tHow3: "Download or share the result link.",

  tLayananH: "Other official BPS services",
  tLayananSub: "Links to official BPS sites",
  tSvc1s: "Provincial news, publications, and statistical tables",
  tSvc2s: "BPS digital library catalogue (OPAC)",
  tSvc3s: "Consultation and purchase of publications or microdata",
  tSvc4s: "Recommendations for sectoral statistical activities",

  tFootExplore: "Explore",
  tFootPub: "Publications",
  tFootHelp: "Help",
  tPub2: "Publications & downloads",
  tPub3: "Release alerts",
  tHelp1: "User guide",
  tHelp2: "Send feedback",
  tHelp3: "Settings",
  tCopy: "© 2026 BPS North Maluku. Official data, free to reuse with attribution.",

  tClose: "Close",
  tMRsvH: "Request a consultation",
  tMRsvSub: "Propose a time and format; the officer confirms by email.",
  tMFieldWho: "Specialist",
  tMFieldWhoHint: "Pick an officer or subject area",
  tMFieldTopic: "Topic / data needed",
  tMFieldTopicHint: "e.g. poverty figures for South Halmahera",
  tMFieldDate: "Preferred date",
  tMFieldDateHint: "20 August 2026",
  tMFieldTime: "Preferred time",
  tMFieldTimeHint: "09.00–10.00 WIT",
  tMMode: "Format",
  tMModeZoom: "Zoom",
  tMModeOffice: "At the office",
  tMRsvNote: "Confirmed within one working day.",
  tMRsvSend: "Send request",
  tMAuthH: "Sign in or sign up",
  tMAuthSub: "One account for consultations and data requests.",
  tMAuthEmail: "Email",
  tMAuthOrg: "Organisation / purpose",
  tMAuthOrgHint: "e.g. planning agency, student, press",
  tMAuthSend: "Send sign-in link",
  tMAuthNote: "We email you a one-time sign-in link.",
  tMNotifH: "Notifications",
  tMPetugasNote:
    "Consultations follow the Integrated Statistics Service roster. Propose a time and the officer will confirm.",
  tMPetugasCta: "Request a booking with this officer",
  tMSoonH: "Consultation booking is not open yet",
  tMSoonSub:
    "The specialist list and the booking steps are here to preview. The buttons go live once the service is ready.",
  tMSoonCta: "Got it",
};

export function getCopy(lang: Lang): Copy {
  return lang === "en" ? EN : ID;
}

/** Typewriter prompts cycled through the hero ask box. */
export function getQuestions(lang: Lang): string[] {
  return lang === "en"
    ? [
        "What was the poverty rate in South Halmahera last year?",
        "Compare Ternate and Tidore inflation over 12 months",
        "North Maluku capture fisheries output since 2020",
        "Which regency has the highest school participation rate?",
      ]
    : [
        "Berapa tingkat kemiskinan di Halmahera Selatan tahun lalu?",
        "Bandingkan inflasi Ternate dan Tidore 12 bulan terakhir",
        "Produksi perikanan tangkap Maluku Utara sejak 2020",
        "Kabupaten mana dengan angka partisipasi sekolah tertinggi?",
      ];
}

export type NotifItem = { title: string; time: string };

export function getNotifItems(lang: Lang): NotifItem[] {
  return lang === "en"
    ? [
        { title: "Consumer Price Index, July 2026 released", time: "1 Aug 2026 · 11.00 WIT" },
        { title: "Q2 2026 economic growth released", time: "5 Aug 2026 · 11.00 WIT" },
        { title: "Regional Statistics 2026 now downloadable", time: "12 Aug 2026 · 09.00 WIT" },
      ]
    : [
        { title: "BRS Indeks Harga Konsumen Juli 2026 terbit", time: "1 Agu 2026 · 11.00 WIT" },
        { title: "BRS Pertumbuhan Ekonomi Triwulan II 2026 terbit", time: "5 Agu 2026 · 11.00 WIT" },
        { title: "Publikasi Statistik Daerah 2026 bisa diunduh", time: "12 Agu 2026 · 09.00 WIT" },
      ];
}
