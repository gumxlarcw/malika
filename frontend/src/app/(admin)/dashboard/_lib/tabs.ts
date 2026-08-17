/**
 * The four dashboard tabs, and how MALIKA's 33 BPS subject categories fall into them.
 *
 * BPS category names are data, not constants — they arrive from `data_sources`
 * and have already changed spelling once ("Kondisi Tempat Tinggal, Kemiskinan
 * Dan Isu Sosial Lintas Sektor" versus "…, dan Permasalahan Sosial Lintas
 * Sektor"). So the explicit map is matched on a normalised name, a keyword rule
 * catches anything renamed or newly added, and a category that matches neither
 * returns null rather than being forced into a bucket where it would look
 * deliberate. Ringkasan shows every category regardless, so nothing is ever
 * lost from the page — only from a subject tab.
 */

export type TabKey = "ringkasan" | "ekonomi" | "sosial" | "wilayah";

export const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: "ringkasan", label: "Ringkasan" },
  { key: "ekonomi", label: "Ekonomi" },
  { key: "sosial", label: "Sosial & kependudukan" },
  { key: "wilayah", label: "Perbandingan wilayah" },
];

export function isTabKey(value: string | null | undefined): value is TabKey {
  return TABS.some((t) => t.key === value);
}

const EKONOMI = [
  "Harga-Harga",
  "Energi",
  "Keuangan Pemerintah",
  "Keuangan Pemerintah, Fiskal dan Statistik Sektor Publik",
  "Neraca Ekonomi",
  "EXIM Ekspor",
  "EXIM Impor",
  "Perdagangan Internasional dan Neraca Pembayaran",
  "Transportasi",
  "Pariwisata",
  "Statistik Bisnis",
  "Konsumsi dan Pendapatan",
  "Pertambangan, Industri, Konstruksi",
  "Pertambangan, Manufaktur, Konstruksi",
  "Pertanian, Kehutanan, Perikanan",
  "Hortikultura, Perkebunan, Peternakan",
];

const SOSIAL = [
  "Penduduk dan Ketenagakerjaan",
  "Kependudukan dan Migrasi",
  "Tenaga Kerja",
  "Ketenagakerjaan",
  "Kesehatan",
  "Pendidikan",
  "Kondisi Tempat Tinggal, Kemiskinan, dan Permasalahan Sosial Lintas Sektor",
  "Kondisi Tempat Tinggal, Kemiskinan Dan Isu Sosial Lintas Sektor",
  "Perlindungan Sosial",
  "Pemukiman dan Perumahan",
  "Peradilan Dan Kriminal",
  "Budaya",
  "Gender dan Kelompok Populasi Khusus",
  "Aktivitas Politik dan Komunitas Lainnya",
  "Masyarakat Informasi",
  "Lingkungan",
];

const WILAYAH = ["Statistik Regional dan Statistik Area Kecil"];

const normalise = (name: string) => name.toLowerCase().replace(/\s+/g, " ").trim();

const EXPLICIT = new Map<string, TabKey>();
for (const name of EKONOMI) EXPLICIT.set(normalise(name), "ekonomi");
for (const name of SOSIAL) EXPLICIT.set(normalise(name), "sosial");
for (const name of WILAYAH) EXPLICIT.set(normalise(name), "wilayah");

const KEYWORDS: ReadonlyArray<[RegExp, TabKey]> = [
  [/regional|area kecil|desa/, "wilayah"],
  [
    /ekspor|impor|perdagangan|harga|inflasi|pdrb|neraca|keuangan|fiskal|bisnis|industri|manufaktur|konstruksi|pertambangan|energi|pertanian|perkebunan|peternakan|hortikultura|perikanan|kehutanan|transportasi|pariwisata|konsumsi|pendapatan|usaha/,
    "ekonomi",
  ],
  [
    /penduduk|kependudukan|migrasi|tenaga kerja|ketenagakerjaan|kemiskinan|kesehatan|pendidikan|sosial|perumahan|pemukiman|kriminal|peradilan|budaya|gender|politik|lingkungan|informasi/,
    "sosial",
  ],
];

/** The subject tab a category belongs to, or null when it only belongs in Ringkasan. */
export function tabForCategory(name: string): TabKey | null {
  const key = normalise(name);
  const explicit = EXPLICIT.get(key);
  if (explicit) return explicit;
  for (const [pattern, tab] of KEYWORDS) if (pattern.test(key)) return tab;
  return null;
}
