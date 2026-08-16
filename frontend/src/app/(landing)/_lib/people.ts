/**
 * Illustrative consultation roster from the design. These are sample officers
 * for the mockup, not the live Pelayanan Statistik Terpadu duty roster.
 */
export type Person = {
  init: string;
  nama: string;
  jabatan: string;
  chips: string[];
};

export const PEOPLE: Person[] = [
  {
    init: "NS",
    nama: "Nurhayati Salim, S.Si., M.Stat.",
    jabatan: "Statistisi Ahli Madya",
    chips: ["Statistik Sosial", "Kependudukan"],
  },
  {
    init: "RH",
    nama: "Rahmat Hidayat, S.ST., M.Ec.Dev.",
    jabatan: "Statistisi Ahli Muda",
    chips: ["Neraca Wilayah", "Inflasi"],
  },
  {
    init: "YT",
    nama: "Yulianti Tomagola, S.Tr.Stat.",
    jabatan: "Statistisi Ahli Pertama",
    chips: ["Produksi", "Pertanian & Perikanan"],
  },
  {
    init: "AF",
    nama: "Ahmad Fauzan, S.Si.",
    jabatan: "Pranata Komputer Ahli Muda",
    chips: ["Data Mikro", "SILASTIK"],
  },
];
