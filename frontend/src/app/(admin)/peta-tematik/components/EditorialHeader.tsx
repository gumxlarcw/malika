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
  /** Categories the catalogue is grouped into, shown before a pick is made. */
  kategoriCount?: number;
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
  kategoriCount,
  actions,
}: Props) {
  /*
   * Two shapes, so no cell is ever an em dash. Before an indicator is picked
   * the map is deliberately blank, and year or period would have nothing to
   * report — the panel describes the catalogue instead. The ten kabupaten/kota
   * hold either way: that is the province's makeup, not a property of whatever
   * indicator happens to be drawn.
   */
  const picked = Boolean(indikatorName);
  const stats: HeroStat[] = picked
    ? [
        { key: "indikator", label: "Indikator", count: totalIndikator, color: "#60a5fa" },
        { key: "wilayah", label: "Wilayah", count: regionCount || 10, color: "#a78bfa" },
        {
          key: "tahun",
          label: "Tahun",
          count: yearCount || 1,
          color: "#fb923c",
        },
        {
          key: "periode",
          label: "Periode",
          count: activeYear ?? 0,
          display: String(activeYear ?? new Date().getFullYear()),
          color: "#9ca3af",
        },
      ]
    : [
        { key: "indikator", label: "Indikator", count: totalIndikator, color: "#60a5fa" },
        { key: "wilayah", label: "Wilayah", count: 10, color: "#a78bfa" },
        {
          key: "kategori",
          label: "Kategori",
          count: kategoriCount ?? 0,
          display: kategoriCount ? String(kategoriCount) : "9",
          color: "#fb923c",
        },
      ];

  return (
    <div className="mb-5">
      <PageHero
        eyebrow="Peta Tematik MALIKA"
        title="Sebaran Statistik"
        titleAccent="per Kabupaten/Kota"
        description={
          picked ? (
            /* The indicator's own name is not repeated here: it runs to 50-odd
               characters, wrapped this line onto a second row and made the
               hero taller than every other page's. ActiveIndikatorBanner
               carries it in full directly below. */
            <>
              Sebaran{" "}
              {activeYear != null ? (
                <>
                  tahun <HeroFigure>{activeYear}</HeroFigure>{" "}
                </>
              ) : null}
              per kabupaten/kota, dari{" "}
              <HeroFigure>{totalIndikator} indikator</HeroFigure> yang dapat dipetakan.
            </>
          ) : (
            <>
              <HeroFigure>{totalIndikator} indikator</HeroFigure> siap dipetakan per
              kabupaten/kota.
            </>
          )
        }
        panel={{
          title: "Cakupan Peta",
          note: picked ? "indikator aktif" : "siap dipetakan",
          stats,
        }}
      />
      {actions && (
        <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
