/**
 * Roster konsultasi Pelayanan Statistik Terpadu, BPS Provinsi Maluku Utara.
 *
 * `jabatan` diambil dari jabatan fungsional pada data kepegawaian; sufiks unit
 * kerja ("BPS Provinsi" / "Bagian Umum") dibuang karena tidak berarti apa-apa
 * bagi pengunjung. `chips` menampung indikator spesialisasi dan masih menunggu
 * data — selama kosong, kartu hanya menampilkan tim.
 */

/**
 * Nama resmi tim kerja BPS Provinsi (Statistik Sosial, Statistik Produksi,
 * Statistik Distribusi, Nerwilis, IPDS). `ringkas` dipakai pada chip kartu,
 * `nama` pada profil.
 */
export const TIM = {
  sosial: { nama: "Tim Statistik Sosial", ringkas: "Statistik Sosial" },
  produksi: { nama: "Tim Statistik Produksi", ringkas: "Statistik Produksi" },
  distribusi: { nama: "Tim Statistik Distribusi", ringkas: "Statistik Distribusi" },
  nerwilis: {
    nama: "Tim Neraca Wilayah dan Analisis Statistik",
    ringkas: "Neraca Wilayah",
  },
  ipds: {
    nama: "Tim Integrasi Pengolahan dan Diseminasi Statistik",
    ringkas: "IPDS",
  },
} as const;

export type TimKode = keyof typeof TIM;

export type Person = {
  init: string;
  nama: string;
  jabatan: string;
  tim: TimKode;
  /** Indikator spesialisasi — menyusul. */
  chips: string[];
};

type PersonSeed = Omit<Person, "init">;

/** "Ati'ah Dyah Lestari, S.ST." → "AL"; nama satu kata → dua huruf pertama. */
function initials(nama: string): string {
  const kata = nama
    .split(",")[0]
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z]/g, ""))
    .filter(Boolean);
  if (kata.length === 0) return "--";
  if (kata.length === 1) return kata[0].slice(0, 2).toUpperCase();
  return (kata[0][0] + kata[kata.length - 1][0]).toUpperCase();
}

const SEEDS: PersonSeed[] = [
  { nama: "Irma A. Rasid", jabatan: "Staf", tim: "ipds", chips: [] },
  { nama: "Desi Novita, S.E.", jabatan: "Statistisi Ahli Pertama", tim: "produksi", chips: [] },
  { nama: "Hasnim Saadi, SE.", jabatan: "Statistisi Ahli Madya", tim: "sosial", chips: [] },
  { nama: "Daniel Mading, SE.", jabatan: "Statistisi Ahli Madya", tim: "produksi", chips: [] },
  { nama: "Halima, S.Kom.", jabatan: "Statistisi Ahli Madya", tim: "ipds", chips: [] },
  {
    nama: "Asma Jufrida Rumanama, SP., M.E.",
    jabatan: "Statistisi Ahli Muda",
    tim: "produksi",
    chips: [],
  },
  { nama: "Halil Said, SE.", jabatan: "Statistisi Ahli Muda", tim: "produksi", chips: [] },
  {
    nama: "Soraya Diana Uli, SST., M.M.",
    jabatan: "Statistisi Ahli Madya",
    tim: "nerwilis",
    chips: [],
  },
  { nama: "Sutrisna Tilaar, S.Si.", jabatan: "Fungsional Umum", tim: "sosial", chips: [] },
  { nama: "Farida Nasir, SE.", jabatan: "Statistisi Ahli Muda", tim: "sosial", chips: [] },
  { nama: "Bayu Suseno, SST., M.Si.", jabatan: "Staf", tim: "nerwilis", chips: [] },
  { nama: "Siti Manfusa, S.E.", jabatan: "Statistisi Ahli Pertama", tim: "distribusi", chips: [] },
  {
    nama: "Ati'ah Dyah Lestari, S.ST.",
    jabatan: "Statistisi Ahli Madya",
    tim: "nerwilis",
    chips: [],
  },
  { nama: "Heidy Soleman, SE.", jabatan: "Statistisi Ahli Pertama", tim: "distribusi", chips: [] },
  { nama: "Nony Rosdiana, S.A.P.", jabatan: "Statistisi Ahli Pertama", tim: "produksi", chips: [] },
  {
    nama: "Evida Karismawati, S.ST., M.Si.",
    jabatan: "Statistisi Ahli Madya",
    tim: "nerwilis",
    chips: [],
  },
  { nama: "Hartini, SE.", jabatan: "Statistisi Ahli Pertama", tim: "produksi", chips: [] },
  { nama: "Wahyunita Aditama, S.E.", jabatan: "Statistisi Ahli Pertama", tim: "ipds", chips: [] },
  { nama: "Juniyati, SE.", jabatan: "Statistisi Ahli Pertama", tim: "distribusi", chips: [] },
  {
    nama: "Erna Suprihartiningsih, SST., M.E.",
    jabatan: "Statistisi Ahli Muda",
    tim: "distribusi",
    chips: [],
  },
  { nama: "Fadlun A. R. Latara, SST.", jabatan: "Statistisi Ahli Madya", tim: "sosial", chips: [] },
  {
    nama: "Nurul Khomsatun Isnaeni, SST., M.Ak.",
    jabatan: "Statistisi Ahli Muda",
    tim: "distribusi",
    chips: [],
  },
  { nama: "Bukhari Fauzul Rahman, SST.", jabatan: "Fungsional Umum", tim: "nerwilis", chips: [] },
  { nama: "Salman Al Farizi, SST.", jabatan: "Statistisi Ahli Muda", tim: "nerwilis", chips: [] },
  { nama: "Syaza 'Adilah, SST.", jabatan: "Statistisi Ahli Pertama", tim: "produksi", chips: [] },
  { nama: "Rio Sanagu Birlian, SST.", jabatan: "Statistisi Ahli Muda", tim: "produksi", chips: [] },
  {
    nama: "Hari Adityawan, S.Tr.Stat.",
    jabatan: "Statistisi Ahli Pertama",
    tim: "distribusi",
    chips: [],
  },
  {
    nama: "Emilia Fitri Siregar, S.Tr.Stat.",
    jabatan: "Statistisi Ahli Pertama",
    tim: "sosial",
    chips: [],
  },
  {
    nama: "Mohammad Rifqi Khikmawan, S.Tr.Stat.",
    jabatan: "Statistisi Ahli Pertama",
    tim: "sosial",
    chips: [],
  },
  {
    nama: "Denny Dharma Saputra, S.Tr.Stat.",
    jabatan: "Statistisi Ahli Pertama",
    tim: "nerwilis",
    chips: [],
  },
  { nama: "Ridwan Prayogi, S.Tr.Stat.", jabatan: "Statistisi Ahli Muda", tim: "sosial", chips: [] },
  {
    nama: "Ahmad Muchtarom, S.Tr.Stat.",
    jabatan: "Statistisi Ahli Pertama",
    tim: "sosial",
    chips: [],
  },
  {
    nama: "Nurul Fajria, S.Tr.Stat.",
    jabatan: "Statistisi Ahli Pertama",
    tim: "produksi",
    chips: [],
  },
  {
    nama: "Wisnu Candra Gumelar, S.Tr.Stat.",
    jabatan: "Pranata Komputer Ahli Pertama",
    tim: "ipds",
    chips: [],
  },
  {
    nama: "Fahreza Arfan Nur Indriansyah, S.Tr.Stat.",
    jabatan: "Statistisi Ahli Pertama",
    tim: "sosial",
    chips: [],
  },
  {
    nama: "Bayu Nirwana Makasuci, S.Tr.Stat.",
    jabatan: "Pranata Komputer Ahli Pertama",
    tim: "ipds",
    chips: [],
  },
  {
    nama: "Mutia Elyani, S.Tr.Stat.",
    jabatan: "Pranata Komputer Ahli Muda",
    tim: "ipds",
    chips: [],
  },
  {
    nama: "Nada Salvia, S.Tr.Stat.",
    jabatan: "Statistisi Ahli Pertama",
    tim: "nerwilis",
    chips: [],
  },
  {
    nama: "Maulana Dawam Ihza Albana, S.Tr.Stat.",
    jabatan: "Statistisi Ahli Pertama",
    tim: "sosial",
    chips: [],
  },
  {
    nama: "Luqman Ismail Abdurrahim, S.Tr.Stat.",
    jabatan: "Pranata Komputer Ahli Pertama",
    tim: "ipds",
    chips: [],
  },
  {
    nama: "Akbar Mubarak Amin, S.Stat.",
    jabatan: "Statistisi Ahli Pertama",
    tim: "nerwilis",
    chips: [],
  },
  {
    nama: "Ujang Kurnia Krismayanto, S.Tr.Stat.",
    jabatan: "Statistisi Ahli Pertama",
    tim: "distribusi",
    chips: [],
  },
  {
    nama: "Amalia Fitriyani, A.Md.Stat.",
    jabatan: "Statistisi Terampil",
    tim: "distribusi",
    chips: [],
  },
  {
    nama: "Arul Fathurrahman, S.Tr.Stat.",
    jabatan: "Statistisi Ahli Pertama",
    tim: "nerwilis",
    chips: [],
  },
  {
    nama: "Fenty Berliana Tifalny, S.Tr.Stat.",
    jabatan: "Pranata Komputer Ahli Pertama",
    tim: "ipds",
    chips: [],
  },
  {
    nama: "Shafira Caesari Julianita, A.Md.Stat.",
    jabatan: "Statistisi Terampil",
    tim: "nerwilis",
    chips: [],
  },
  {
    nama: "Lalu Riza Singrapati, S.Tr.Stat.",
    jabatan: "Statistisi Ahli Pertama",
    tim: "distribusi",
    chips: [],
  },
  { nama: "Elsa Oktavia, S.Tr.Stat.", jabatan: "Staf", tim: "sosial", chips: [] },
];

export const PEOPLE: Person[] = SEEDS.map((p) => ({ ...p, init: initials(p.nama) }));
