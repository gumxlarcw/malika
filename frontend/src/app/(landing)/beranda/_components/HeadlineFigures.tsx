"use client";

import React from "react";
import Link from "next/link";
import { ArrowRightIcon } from "@/icons";
import { cn } from "@/lib/utils";
import type { Copy } from "../_lib/copy";
import { BORDER, MONO, SECTION, SURFACE, TEXT, TEXT_4 } from "../_lib/ui";
import { TrendArrow } from "./LandingIcons";
import Reveal from "./Reveal";

type Props = { t: Copy };

/**
 * Illustrative headline figures, exactly as authored in the design. The section
 * subtitle says so; `AboutStrip` repeats the note. Nothing here is fetched.
 */
const FIGURES = [
  { label: "Inflasi y-on-y", value: "2,41%", delta: "0,18", direction: "down", period: "Juli 2026" },
  { label: "Pertumbuhan ekonomi", value: "20,49%", delta: "1,7", direction: "up", period: "Triwulan II 2026" },
  { label: "Tingkat kemiskinan", value: "5,93%", delta: "0,26", direction: "down", period: "Maret 2026" },
  { label: "Tingkat pengangguran terbuka", value: "3,84%", delta: "0,12", direction: "up", period: "Februari 2026" },
] as const;

/** Down is good for inflation, poverty and unemployment; up is good for growth. */
const isFavourable = (label: string, direction: "up" | "down") =>
  label === "Pertumbuhan ekonomi" ? direction === "up" : direction === "down";

export default function HeadlineFigures({ t }: Props) {
  return (
    <Reveal className={SECTION}>
      <div className="mb-5 flex items-end justify-between gap-6">
        <div>
          <h2 className={cn("m-0 text-2xl font-semibold leading-8", TEXT)}>{t.tIndH}</h2>
          <p className={cn("mt-1.5 text-sm leading-5", TEXT_4)}>{t.tIndSub}</p>
        </div>
        <Link
          href="/"
          className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-brand-600 dark:text-brand-300"
        >
          {t.tIndLink}
          <ArrowRightIcon className="h-[18px] w-[18px]" />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {FIGURES.map((figure) => {
          const good = isFavourable(figure.label, figure.direction);
          return (
            <div
              key={figure.label}
              className={cn(
                "rounded-2xl border p-[22px] transition-[transform,border-color,box-shadow] duration-150 hover:-translate-y-[3px] hover:border-brand-300 hover:shadow-theme-lg dark:hover:border-brand-500/60",
                BORDER,
                SURFACE
              )}
            >
              <div className={cn("text-[13px] leading-5", TEXT_4)}>{figure.label}</div>
              <div className={cn("mt-2 text-3xl font-medium leading-9", MONO, TEXT)}>
                {figure.value}
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-xs font-medium leading-[18px]",
                    good
                      ? "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400"
                      : "bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-400"
                  )}
                >
                  <TrendArrow direction={figure.direction} className="h-3 w-3" />
                  {figure.delta}
                </span>
                <span className={cn("text-xs leading-[18px]", TEXT_4)}>{figure.period}</span>
              </div>
            </div>
          );
        })}
      </div>
    </Reveal>
  );
}
