"use client";

import React from "react";
import Link from "next/link";
import { Book, Coins, type LucideIcon } from "lucide-react";
import { BookIcon } from "@/icons";
import { cn } from "@/lib/utils";
import type { Copy } from "../_lib/copy";
import {
  BORDER,
  MONO,
  SCROLL_ANCHOR,
  SECTION,
  SURFACE,
  TEXT,
  TEXT_2,
  TEXT_3,
  TEXT_4,
  TEXT_5,
} from "../_lib/ui";
import Reveal from "./Reveal";

type Props = { t: Copy };

type Release = {
  kind: string;
  meta: string;
  title: string;
  summary: string;
  chip: string;
  badge: string;
  Icon: LucideIcon | React.ComponentType<{ className?: string }>;
};

/** Sample releases from the design; the live archive lives at /brs. */
const RELEASES: Release[] = [
  {
    kind: "BRS",
    meta: "1 Agustus 2026",
    title: "Perkembangan Indeks Harga Konsumen Maluku Utara, Juli 2026",
    summary:
      "Inflasi y-on-y 2,41 persen; andil terbesar dari kelompok makanan, minuman, dan tembakau.",
    chip: "bg-warning-100 text-warning-700 dark:bg-warning-500/15 dark:text-warning-300",
    badge: "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-300",
    Icon: BookIcon,
  },
  {
    kind: "BRS",
    meta: "5 Agustus 2026",
    title: "Pertumbuhan Ekonomi Maluku Utara Triwulan II 2026",
    summary: "Ekonomi tumbuh 20,49 persen (y-on-y), ditopang industri pengolahan logam dasar.",
    chip: "bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400",
    badge: "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300",
    Icon: Coins,
  },
  {
    kind: "Publikasi",
    meta: "PDF · 4,2 MB",
    title: "Statistik Daerah Provinsi Maluku Utara 2026",
    summary:
      "Ringkasan indikator sosial dan ekonomi seluruh kabupaten/kota dalam satu jilid.",
    chip: "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400",
    badge: "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
    Icon: Book,
  },
];

const TRENDING = [
  { rank: "01", title: "Inflasi Kota Ternate", hits: "3.204" },
  { rank: "02", title: "Jumlah penduduk per kabupaten/kota", hits: "2.871" },
  { rank: "03", title: "Tingkat pengangguran terbuka", hits: "2.140" },
  { rank: "04", title: "Produksi perikanan tangkap", hits: "1.965" },
  { rank: "05", title: "Angka partisipasi sekolah", hits: "1.702" },
  { rank: "06", title: "PDRB per kapita", hits: "1.588" },
];

export default function RilisTrending({ t }: Props) {
  return (
    <Reveal className={cn(SECTION, "grid items-stretch gap-6 md:grid-cols-[1.35fr_1fr]")}>
      <div id="brs" className={SCROLL_ANCHOR}>
        <div className="mb-5 flex items-end justify-between gap-6">
          <div>
            <h2 className={cn("m-0 text-2xl font-semibold leading-8", TEXT)}>{t.tBrsH}</h2>
            <p className={cn("mt-1.5 text-sm leading-5", TEXT_4)}>{t.tBrsSub}</p>
          </div>
          <Link href="/brs" className="shrink-0 text-sm font-medium text-brand-600 dark:text-brand-300">
            {t.tBrsLink}
          </Link>
        </div>

        <div className="flex flex-col gap-3">
          {RELEASES.map((release) => (
            <Link
              key={release.title}
              href="/brs"
              className={cn(
                "flex gap-4 rounded-2xl border p-5 text-inherit transition-[transform,border-color,box-shadow] duration-150 hover:translate-x-1 hover:border-brand-300 hover:shadow-theme-md dark:hover:border-brand-500/60",
                BORDER,
                SURFACE
              )}
            >
              <span
                className={cn(
                  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px]",
                  release.chip
                )}
              >
                <release.Icon className="h-[22px] w-[22px]" />
              </span>
              <span className="min-w-0">
                <span className={cn("flex flex-wrap items-center gap-2 text-xs leading-[18px]", TEXT_4)}>
                  <span className={cn("rounded-full px-2 py-0.5 font-medium", release.badge)}>
                    {release.kind}
                  </span>
                  {release.meta}
                </span>
                <span className={cn("mt-1.5 block text-base font-semibold leading-6", TEXT)}>
                  {release.title}
                </span>
                <span className={cn("mt-1 block text-sm leading-5", TEXT_3)}>{release.summary}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>

      <div className="flex flex-col">
        <div className="mb-5">
          <h2 className={cn("m-0 text-2xl font-semibold leading-8", TEXT)}>{t.tTrenH}</h2>
          <p className={cn("mt-1.5 text-sm leading-5", TEXT_4)}>{t.tTrenSub}</p>
        </div>
        <div
          className={cn(
            "flex flex-auto flex-col justify-between rounded-2xl border p-2",
            BORDER,
            SURFACE
          )}
        >
          {TRENDING.map((item) => (
            <Link
              key={item.rank}
              href="/kategori"
              className="flex flex-auto items-center gap-3.5 rounded-[10px] px-3.5 py-[13px] text-inherit transition-[background,padding-left] duration-150 hover:bg-brand-25 hover:pl-5 dark:hover:bg-[#141a33]"
            >
              <span className={cn("w-[18px] shrink-0 text-[13px]", MONO, TEXT_5)}>{item.rank}</span>
              <span className={cn("min-w-0 flex-auto text-sm font-medium leading-5", TEXT_2)}>
                {item.title}
              </span>
              <span className={cn("shrink-0 text-xs leading-[18px]", TEXT_4)}>{item.hits}</span>
            </Link>
          ))}
        </div>
      </div>
    </Reveal>
  );
}
