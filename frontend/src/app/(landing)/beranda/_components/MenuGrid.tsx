"use client";

import React from "react";
import Link from "next/link";
import {
  BookIcon,
  ChatIcon,
  GearIcon,
  GridIcon,
  MalutMapIcon,
  ShootingStarIcon,
  TableIcon,
  UserCircleIcon,
} from "@/icons";
import { cn } from "@/lib/utils";
import type { Copy } from "../_lib/copy";
import {
  BORDER,
  BRAND_BORDER,
  BRAND_TEXT,
  CARD_HOVER,
  SECTION,
  SCROLL_ANCHOR,
  SURFACE,
  SURFACE_2,
  SURFACE_BRAND_2,
  TEXT,
  TEXT_3,
  TEXT_4,
} from "../_lib/ui";
import Reveal from "./Reveal";

type Props = { t: Copy; onOpenReservasi: () => void };

type Tile = {
  title: string;
  subtitle: string;
  href: string;
  Icon: React.ComponentType<{ className?: string }>;
  /** Icon chip colours, straight from the design. */
  chip: string;
};

export default function MenuGrid({ t, onOpenReservasi }: Props) {
  const tiles: Tile[] = [
    {
      title: "Dashboard",
      subtitle: t.tTile1s,
      href: "/",
      Icon: GridIcon,
      chip: cn(SURFACE_BRAND_2, BRAND_TEXT),
    },
    {
      title: "Peta Tematik",
      subtitle: t.tTile2s,
      href: "/peta-tematik",
      Icon: MalutMapIcon,
      chip: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300",
    },
    {
      title: "Chat MALIKA",
      subtitle: t.tTile3s,
      href: "/chat",
      Icon: ChatIcon,
      chip: cn(SURFACE_BRAND_2, BRAND_TEXT),
    },
    {
      title: "Data Statistik",
      subtitle: t.tTile4s,
      href: "/kategori",
      Icon: TableIcon,
      chip: "bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300",
    },
    {
      title: "BRS & Publikasi",
      subtitle: t.tTile5s,
      href: "/brs",
      Icon: BookIcon,
      chip: "bg-warning-100 text-warning-700 dark:bg-warning-500/15 dark:text-warning-300",
    },
    {
      title: "Feedback",
      subtitle: t.tTile6s,
      href: "/feedback",
      Icon: ShootingStarIcon,
      chip: "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300",
    },
    {
      title: t.tTile7,
      subtitle: t.tTile7s,
      href: "/settings",
      Icon: GearIcon,
      chip: cn(SURFACE_2, TEXT_3),
    },
  ];

  const tileBase = cn(
    "flex flex-col gap-3.5 rounded-2xl border p-[22px]",
    CARD_HOVER
  );

  return (
    <Reveal id="menu" className={cn(SECTION, SCROLL_ANCHOR)}>
      <div className="mb-5 flex items-end justify-between gap-6">
        <div>
          <h2 className={cn("m-0 text-2xl font-semibold leading-8", TEXT)}>{t.tMenuH}</h2>
          <p className={cn("mt-1.5 text-sm leading-5", TEXT_4)}>{t.tMenuSub}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {/* Consultation leads the grid and is the one tile that opens a dialog. */}
        <button
          type="button"
          onClick={onOpenReservasi}
          className={cn(tileBase, "cursor-pointer text-left", BRAND_BORDER, SURFACE_BRAND_2)}
        >
          <span className="flex items-center justify-between gap-2">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500 text-white">
              <UserCircleIcon className="h-6 w-6" />
            </span>
            <span
              className={cn(
                "rounded-full border px-2.5 py-[3px] text-[11px] font-medium leading-4",
                BRAND_BORDER,
                SURFACE,
                BRAND_TEXT
              )}
            >
              {t.tTileBadge}
            </span>
          </span>
          <span>
            <span className={cn("block text-base font-semibold leading-6", TEXT)}>
              Konsultasi Langsung
            </span>
            <span className={cn("mt-[3px] block text-[13px] leading-5", BRAND_TEXT)}>
              {t.tTile8s}
            </span>
          </span>
        </button>

        {tiles.map(({ title, subtitle, href, Icon, chip }) => (
          <Link key={title} href={href} className={cn(tileBase, BORDER, SURFACE)}>
            <span className={cn("inline-flex h-11 w-11 items-center justify-center rounded-xl", chip)}>
              <Icon className="h-6 w-6" />
            </span>
            <span>
              <span className={cn("block text-base font-semibold leading-6", TEXT)}>{title}</span>
              <span className={cn("mt-[3px] block text-[13px] leading-5", TEXT_4)}>{subtitle}</span>
            </span>
          </Link>
        ))}
      </div>
    </Reveal>
  );
}
