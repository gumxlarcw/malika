"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { Copy, Lang } from "../_lib/copy";
import {
  CYCLE_ORDER,
  MAP_H,
  MAP_W,
  PERIODS,
  formatValue,
  placeTooltip,
  sampleRank,
  sampleValue,
} from "../_lib/landingMap";
import { REGION_SHAPES } from "../_lib/regionShapes.generated";
import {
  BORDER,
  BRAND_BORDER,
  BRAND_TEXT,
  MONO,
  SCROLL_ANCHOR,
  SECTION,
  SURFACE,
  SURFACE_BRAND,
  SURFACE_BRAND_2,
  TEXT,
  TEXT_3,
  TEXT_4,
  TEXT_5,
} from "../_lib/ui";
import Reveal from "./Reveal";

type Props = { t: Copy; lang: Lang };

/** Tooltip footprint as a percentage of the map box, used for collision avoidance. */
const CARD_W = 40;
const CARD_H = 22;

/**
 * Low→high ramp. The lightest step is theme-aware, as in the design: a fixed
 * `brand-50` would read as the *brightest* swatch on a dark panel and invert the
 * ramp; the remaining steps are dark enough to work against either background.
 */
const LEGEND = [SURFACE_BRAND_2, "bg-brand-200", "bg-brand-300", "bg-brand-400", "bg-brand-500", "bg-brand-800"];

export default function PetaPreview({ t, lang }: Props) {
  const reduceMotion = useReducedMotion();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (reduceMotion) return;
    const id = setInterval(() => setStep((s) => s + 1), 900);
    return () => clearInterval(id);
  }, [reduceMotion]);

  const view = useMemo(() => {
    const periodIndex = step % PERIODS.length;
    const kode = CYCLE_ORDER[Math.floor(step / PERIODS.length) % CYCLE_ORDER.length];
    const active = REGION_SHAPES.find((s) => s.kode === kode);
    if (!active) return null;
    return {
      periodIndex,
      kode,
      spot: placeTooltip(active, CARD_W, CARD_H),
      name: active.name,
      value: formatValue(sampleValue(kode, periodIndex), lang),
      rank: `${t.tRank} ${sampleRank(kode)} ${t.tRankOf} · ${PERIODS[periodIndex]}`,
    };
  }, [step, lang, t.tRank, t.tRankOf]);

  const popular = [t.tPop1, t.tPop2, t.tPop3, t.tPop4];

  return (
    <Reveal id="peta" className={cn(SECTION, SCROLL_ANCHOR)}>
      <div className={cn("grid overflow-hidden rounded-[20px] border md:grid-cols-2", BORDER, SURFACE)}>
        {/* Left: the pitch */}
        <div className="flex min-w-0 flex-col gap-1 p-6 md:p-10">
          <span className="inline-flex w-fit items-center gap-2 whitespace-nowrap rounded-full bg-cyan-100 px-3 py-[5px] text-xs font-medium leading-[18px] text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300">
            Peta Tematik
          </span>
          <h2 className={cn("mt-[18px] text-3xl font-semibold leading-[38px] -tracking-[0.01em]", TEXT)}>
            {t.tPetaH}
          </h2>
          <p className={cn("mt-3 max-w-[460px] text-[15px] leading-6", TEXT_3)}>{t.tPetaSub}</p>

          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
            <Link
              href="/peta-tematik"
              className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-brand-500 px-5 text-[15px] font-semibold text-white transition-[background,transform,box-shadow] duration-150 hover:-translate-y-px hover:bg-brand-600 hover:shadow-[0px_8px_16px_-4px_rgba(70,95,255,0.5)]"
            >
              {t.tPetaCta}
            </Link>
            <span className={cn("text-[13px] leading-5", TEXT_4)}>{t.tPetaMeta}</span>
          </div>

          <div className="mt-7 flex flex-wrap items-center gap-x-2.5 gap-y-2">
            <span className={cn("text-xs leading-[18px]", TEXT_4)}>{t.tLow}</span>
            <span className="flex gap-1">
              {LEGEND.map((swatch) => (
                <span key={swatch} className={cn("h-2.5 w-5 rounded-[3px] sm:w-[30px]", swatch)} />
              ))}
            </span>
            <span className={cn("text-xs leading-[18px]", TEXT_4)}>{t.tHigh}</span>
          </div>

          <div className="mt-6">
            <div className={cn("text-xs font-semibold uppercase leading-[18px] tracking-[0.06em]", TEXT_5)}>
              {t.tPopLabel}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {popular.map((chip, i) => (
                <Link
                  key={chip}
                  href="/peta-tematik"
                  className={cn(
                    "rounded-full border px-[13px] py-[7px] text-[13px] leading-5 transition-[transform,border-color] duration-150 hover:-translate-y-0.5",
                    i === 0
                      ? cn(BRAND_BORDER, SURFACE_BRAND_2, BRAND_TEXT, "font-medium")
                      : cn(BORDER, TEXT_3, "hover:border-brand-200 dark:hover:border-brand-500/45")
                  )}
                >
                  {chip}
                </Link>
              ))}
            </div>
          </div>

          <div className={cn("mt-7 grid grid-cols-3 gap-3 border-t pt-[22px] md:gap-[18px]", BORDER)}>
            {[
              { num: "10", label: t.tStatA },
              { num: t.tStatBNum, label: t.tStatB },
              { num: "17", label: t.tStatC },
            ].map((stat) => (
              <div key={stat.label}>
                <div className={cn("text-[28px] font-medium leading-[34px] -tracking-[0.02em]", MONO, TEXT)}>
                  {stat.num}
                </div>
                <div className={cn("mt-0.5 text-xs leading-[18px]", TEXT_4)}>{stat.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: the map */}
        <div
          className={cn(
            "relative flex min-w-0 flex-col items-center justify-center gap-5 border-t p-5 min-h-80 md:min-h-95 md:border-l md:border-t-0 md:p-8",
            BORDER,
            SURFACE_BRAND
          )}
        >
          <div className="relative aspect-[100/95] w-full max-w-[420px]">
            <svg
              viewBox={`0 0 ${MAP_W} ${MAP_H}`}
              className="h-auto w-full max-w-full stroke-brand-25 dark:stroke-[#141a33]"
              strokeWidth="0.35"
              strokeLinejoin="round"
              role="img"
              aria-label={`${t.tIndicator} — ${t.tStat2}`}
            >
              {REGION_SHAPES.map((shape) => (
                <path
                  key={shape.kode}
                  d={shape.d}
                  fill={shape.kode === view?.kode ? "#465fff" : "#d0d5dd"}
                  opacity={shape.kode === view?.kode ? 1 : 0.85}
                  className="transition-[fill,opacity] duration-500"
                >
                  <title>{shape.name}</title>
                </path>
              ))}
            </svg>

            {view ? (
              <div
                className={cn(
                  "pointer-events-none absolute max-w-[40%] rounded-xl border px-3.5 py-2.5 shadow-theme-md",
                  BORDER,
                  SURFACE
                )}
                style={{ left: view.spot.left, top: view.spot.top }}
              >
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-[3px] border border-gray-900/[0.12] bg-brand-500" />
                  <span className={cn("text-xs leading-[18px]", TEXT_4)}>
                    {view.name}
                  </span>
                </div>
                <div className={cn("mt-0.5 text-lg font-medium leading-6", MONO, TEXT)}>
                  {view.value}
                </div>
                <div className={cn("text-[11px] leading-4", TEXT_5)}>{view.rank}</div>
              </div>
            ) : null}
          </div>

          <div
            className={cn(
              "box-border flex w-full max-w-[420px] flex-wrap items-center justify-center gap-x-3 gap-y-1.5 rounded-full border px-3.5 py-2 lg:justify-between",
              BORDER,
              SURFACE
            )}
          >
            <span className={cn("flex items-center gap-2 whitespace-nowrap text-xs leading-[18px]", TEXT_3)}>
              <span className="malika-pulse h-1.5 w-1.5 rounded-full bg-brand-500" />
              {t.tIndicator}
            </span>
            <span className="flex items-center gap-1.5">
              {PERIODS.map((period, i) => (
                <span
                  key={period}
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] leading-4 transition-[background,color] duration-300",
                    MONO,
                    i === (view?.periodIndex ?? 0)
                      ? "bg-brand-500 text-white"
                      : "bg-transparent text-gray-400"
                  )}
                >
                  {period}
                </span>
              ))}
            </span>
          </div>
        </div>
      </div>
    </Reveal>
  );
}
