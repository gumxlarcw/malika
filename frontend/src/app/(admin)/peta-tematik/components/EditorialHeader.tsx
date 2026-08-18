"use client";
import type { ReactNode } from "react";
import PageHero, {
  HeroCalendarIcon,
  HeroChartIcon,
  HeroGlobeIcon,
  type HeroMeta,
} from "@/components/site/PageHero";

interface Props {
  totalIndikator: number;
  /** Accent of the palette the map is currently drawn in. */
  paletteAccent?: string;
  /** Name of the indicator currently drawn, or "" before one is picked. */
  indikatorName?: string;
  activeYear?: number | null;
  yearCount?: number;
  regionCount?: number;
  actions?: ReactNode;
}

/**
 * Page intro for /peta-tematik, now the shared PageHero so this page, the
 * dashboard, the archive and /data all open the same way. It used to be a bare
 * H1 plus a paragraph, which read as a different product from /data's hero.
 *
 * The meta chips describe what is actually on screen: before an indicator is
 * picked the map is deliberately empty, so only the catalogue size is claimed.
 */
export default function EditorialHeader({
  totalIndikator,
  paletteAccent,
  indikatorName,
  activeYear,
  yearCount,
  regionCount,
  actions,
}: Props) {
  const meta: HeroMeta[] = [
    {
      key: "indikator",
      icon: <HeroChartIcon />,
      label: `${totalIndikator} indikator`,
    },
  ];

  if (indikatorName) {
    meta.push({
      key: "periode",
      icon: <HeroCalendarIcon />,
      label:
        activeYear != null
          ? `${activeYear}${yearCount && yearCount > 1 ? ` · ${yearCount} tahun tersedia` : ""}`
          : "Periode belum dipilih",
    });
  }

  if (regionCount && regionCount > 0) {
    meta.push({
      key: "wilayah",
      icon: <HeroGlobeIcon />,
      label: `${regionCount} kabupaten/kota`,
    });
  }

  return (
    <div className="mb-5">
      <PageHero
        crumbs={[{ label: "Beranda", href: "/" }, { label: "Peta Tematik" }]}
        badge="Peta resmi"
        title="Peta Tematik"
        titleAccent="Maluku Utara"
        description={
          indikatorName
            ? indikatorName
            : "Pilih indikator untuk menggambar sebarannya per kabupaten/kota, telusuri tren antar tahun, dan bandingkan capaian antar wilayah."
        }
        meta={meta}
        actions={actions}
        // The rail carries the map's own scale colour, so switching palette
        // re-tints the page header with it.
        accent={paletteAccent}
      />
    </div>
  );
}
