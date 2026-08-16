"use client";

import React from "react";
import { ArrowRightIcon, BookIcon } from "@/icons";
import { cn } from "@/lib/utils";
import type { Copy } from "../_lib/copy";
import {
  BORDER,
  BRAND_TEXT,
  CARD_HOVER,
  MONO,
  SCROLL_ANCHOR,
  SECTION,
  SURFACE,
  SURFACE_BRAND_2,
  TEXT,
  TEXT_4,
  TEXT_5,
} from "../_lib/ui";
import { FlaskIcon, FormIcon } from "./LandingIcons";
import Reveal from "./Reveal";

type Props = { t: Copy };

export default function LayananResmi({ t }: Props) {
  const services = [
    {
      name: "Website BPS Maluku Utara",
      subtitle: t.tSvc1s,
      domain: "malut.bps.go.id",
      href: "https://malut.bps.go.id",
      Icon: FlaskIcon,
      chip: cn(SURFACE_BRAND_2, BRAND_TEXT),
    },
    {
      name: "Perpustakaan online BPS",
      subtitle: t.tSvc2s,
      domain: "perpustakaan.bps.go.id/opac",
      href: "https://perpustakaan.bps.go.id/opac/",
      Icon: BookIcon,
      chip: "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400",
    },
    {
      name: "SILASTIK",
      subtitle: t.tSvc3s,
      domain: "silastik.bps.go.id",
      href: "https://silastik.bps.go.id",
      Icon: FormIcon,
      chip: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
    },
    {
      name: "ROMANTIK",
      subtitle: t.tSvc4s,
      domain: "romantik.bps.go.id",
      href: "https://romantik.bps.go.id",
      Icon: FormIcon,
      chip: "bg-warning-100 text-warning-700 dark:bg-warning-500/15 dark:text-warning-300",
    },
  ];

  return (
    <Reveal id="layanan" className={cn(SECTION, SCROLL_ANCHOR)}>
      <div className="mb-5 flex items-end justify-between gap-6">
        <div>
          <h2 className={cn("m-0 text-2xl font-semibold leading-8", TEXT)}>{t.tLayananH}</h2>
          <p className={cn("mt-1.5 text-sm leading-5", TEXT_4)}>{t.tLayananSub}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {services.map(({ name, subtitle, domain, href, Icon, chip }) => (
          <a
            key={name}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "flex flex-col gap-3.5 rounded-2xl border p-[22px] text-inherit",
              CARD_HOVER,
              BORDER,
              SURFACE
            )}
          >
            <span className="flex items-center justify-between">
              <span className={cn("inline-flex h-11 w-11 items-center justify-center rounded-xl", chip)}>
                <Icon className="h-[22px] w-[22px]" />
              </span>
              <span className={cn("inline-flex", TEXT_5)}>
                <ArrowRightIcon className="h-[18px] w-[18px]" />
              </span>
            </span>
            <span>
              <span className={cn("block text-[15px] font-semibold leading-[22px]", TEXT)}>{name}</span>
              <span className={cn("mt-1 block text-[13px] leading-5", TEXT_4)}>{subtitle}</span>
              <span className={cn("mt-2 block break-words text-xs leading-[18px]", MONO, BRAND_TEXT)}>
                {domain}
              </span>
            </span>
          </a>
        ))}
      </div>
    </Reveal>
  );
}
