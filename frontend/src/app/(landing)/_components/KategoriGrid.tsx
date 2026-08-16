"use client";

import React from "react";
import Link from "next/link";
import {
  Book,
  Briefcase,
  Coins,
  Factory,
  HandCoins,
  Heart,
  Landmark,
  Tag,
  Truck,
  Users,
  Wheat,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Copy } from "../_lib/copy";
import { BORDER, SCROLL_ANCHOR, SECTION, SURFACE, TEXT, TEXT_4 } from "../_lib/ui";
import Reveal from "./Reveal";

type Props = { t: Copy };

/**
 * Subject-matter areas as drawn in the design, with its illustrative indicator
 * counts. The live catalogue lives at /kategori.
 */
const CATEGORIES: Array<{ name: string; count: number; Icon: LucideIcon; chip: string }> = [
  { name: "Pertanian & Perikanan", count: 142, Icon: Wheat, chip: "bg-green-100 text-green-600 dark:bg-green-500/15 dark:text-green-400" },
  { name: "Harga & Inflasi", count: 86, Icon: Tag, chip: "bg-yellow-100 text-yellow-600 dark:bg-yellow-500/15 dark:text-yellow-400" },
  { name: "Ekonomi & Perdagangan", count: 173, Icon: Coins, chip: "bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400" },
  { name: "Keuangan & Fiskal", count: 64, Icon: Landmark, chip: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400" },
  { name: "Pendidikan", count: 78, Icon: Book, chip: "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400" },
  { name: "Kesehatan", count: 91, Icon: Heart, chip: "bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400" },
  { name: "Kependudukan", count: 57, Icon: Users, chip: "bg-cyan-100 text-cyan-600 dark:bg-cyan-500/15 dark:text-cyan-400" },
  { name: "Ketenagakerjaan", count: 69, Icon: Briefcase, chip: "bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400" },
  { name: "Industri & Pertambangan", count: 112, Icon: Factory, chip: "bg-pink-100 text-pink-600 dark:bg-pink-500/15 dark:text-pink-400" },
  { name: "Transportasi", count: 48, Icon: Truck, chip: "bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-400" },
  { name: "Energi", count: 33, Icon: Zap, chip: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400" },
  { name: "Kemiskinan & Kesejahteraan", count: 52, Icon: HandCoins, chip: "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400" },
];

export default function KategoriGrid({ t }: Props) {
  return (
    <Reveal id="kategori" className={cn(SECTION, SCROLL_ANCHOR)}>
      <div className="mb-5 flex items-end justify-between gap-6">
        <div>
          <h2 className={cn("m-0 text-2xl font-semibold leading-8", TEXT)}>{t.tKatH}</h2>
          <p className={cn("mt-1.5 text-sm leading-5", TEXT_4)}>{t.tKatSub}</p>
        </div>
        <Link
          href="/kategori"
          className="shrink-0 text-sm font-medium text-brand-600 dark:text-brand-300"
        >
          {t.tKatLink}
        </Link>
      </div>

      <div className="grid gap-2.5 md:grid-cols-4 md:gap-3.5">
        {CATEGORIES.map(({ name, count, Icon, chip }) => (
          <Link
            key={name}
            href="/kategori"
            className={cn(
              "flex items-center gap-3.5 rounded-[14px] border p-4 px-[18px] transition-[transform,border-color,box-shadow,background] duration-150 hover:-translate-y-[3px] hover:border-brand-300 hover:bg-brand-25 hover:shadow-theme-lg dark:hover:border-brand-500/60 dark:hover:bg-[#141a33]",
              BORDER,
              SURFACE
            )}
          >
            <span className={cn("inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px]", chip)}>
              <Icon className="h-[22px] w-[22px]" strokeWidth={1.8} />
            </span>
            <span className="min-w-0">
              <span className={cn("block text-[15px] font-medium leading-[22px]", TEXT)}>{name}</span>
              <span className={cn("block text-xs leading-[18px]", TEXT_4)}>{count} indikator</span>
            </span>
          </Link>
        ))}
      </div>
    </Reveal>
  );
}
