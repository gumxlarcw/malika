"use client";
import type { ReactNode } from "react";
import PageHero, { HeroFigure, type HeroStat } from "@/components/site/PageHero";

interface Props {
  totalIndikator: number;
  /** Name of the indicator currently drawn, or "" before one is picked. */
  indikatorName?: string;
  activeYear?: number | null;
  yearCount?: number;
  regionCount?: number;
  actions?: ReactNode;
}

/**
 * Page intro for /peta-tematik, using the shared Atlas hero so this page opens
 * the same way as /kategori, /dashboard and the archive.
 *
 * The panel deliberately carries no composition bar: its four figures are
 * different measures, not parts of one whole, and a bar across them would
 * imply a split that does not exist.
 */
export default function EditorialHeader({
  totalIndikator,
  indikatorName,
  activeYear,
  yearCount,
  regionCount,
  actions,
}: Props) {
  const stats: HeroStat[] = [
    { key: "indikator", label: "Indikator", count: totalIndikator, color: "#60a5fa" },
    {
      key: "wilayah",
      label: "Wilayah",
      count: regionCount ?? 0,
      display: regionCount ? String(regionCount) : "—",
      color: "#a78bfa",
    },
    {
      key: "tahun",
      label: "Tahun",
      count: yearCount ?? 0,
      display: yearCount ? String(yearCount) : "—",
      color: "#fb923c",
    },
    {
      key: "periode",
      label: "Periode",
      count: activeYear ?? 0,
      display: activeYear != null ? String(activeYear) : "—",
      color: "#9ca3af",
    },
  ];

  return (
    <div className="mb-5">
      <PageHero
        eyebrow="Peta Tematik MALIKA"
        title="Sebaran Statistik"
        titleAccent="per Kabupaten/Kota"
        description={
          indikatorName ? (
            <>
              Menampilkan <HeroFigure>{indikatorName}</HeroFigure>
              {activeYear != null ? (
                <>
                  {" "}
                  tahun <HeroFigure>{activeYear}</HeroFigure>
                </>
              ) : null}
              , dari <HeroFigure>{totalIndikator} indikator</HeroFigure> yang dapat dipetakan.
            </>
          ) : (
            <>
              <HeroFigure>{totalIndikator} indikator</HeroFigure> siap dipetakan. Pilih topik di
              bawah untuk menggambar sebarannya, menelusuri tren antar tahun, dan membandingkan
              capaian antar wilayah.
            </>
          )
        }
        panel={{ title: "Cakupan Peta", note: indikatorName ? "indikator aktif" : "belum dipilih", stats }}
        actions={actions}
      />
    </div>
  );
}
