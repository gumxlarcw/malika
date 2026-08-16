"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { ArrowRightIcon, ChevronLeftIcon } from "@/icons";
import { cn } from "@/lib/utils";
import type { Copy } from "../_lib/copy";
import { PEOPLE } from "../_lib/people";
import { useIsDesktop } from "../_lib/useIsDesktop";
import {
  BORDER,
  BRAND_BORDER,
  BRAND_TEXT,
  MONO,
  NAVY_PANEL,
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

type Props = {
  t: Copy;
  onOpenReservasi: () => void;
  onOpenMasuk: () => void;
  onOpenPetugas: (index: number) => void;
};

const AUTO_ADVANCE_MS = 5000;

export default function Konsultasi({ t, onOpenReservasi, onOpenMasuk, onOpenPetugas }: Props) {
  const isDesktop = useIsDesktop();
  const reduceMotion = useReducedMotion();
  const perView = isDesktop ? 2 : 1;
  const slides = Math.max(1, PEOPLE.length - perView + 1);
  const [slide, setSlide] = useState(0);
  // Bumped on manual navigation to restart the auto-advance timer.
  const [nudge, setNudge] = useState(0);

  // Widening the viewport shows two cards at once, leaving fewer slides than the
  // track may currently be parked on — clamp on read rather than storing a
  // corrected value back into state.
  const activeSlide = Math.min(slide, slides - 1);

  useEffect(() => {
    if (reduceMotion) return;
    const id = setInterval(
      () => setSlide((s) => (Math.min(s, slides - 1) + 1) % slides),
      AUTO_ADVANCE_MS
    );
    return () => clearInterval(id);
  }, [slides, reduceMotion, nudge]);

  const goTo = useCallback(
    (index: number) => {
      setSlide(((index % slides) + slides) % slides);
      setNudge((n) => n + 1);
    },
    [slides]
  );

  const steps = [
    { n: "01", title: t.tStep1, sub: t.tStep1s },
    { n: "02", title: t.tStep2, sub: t.tStep2s },
    { n: "03", title: t.tStep3, sub: t.tStep3s },
    { n: "04", title: t.tStep4, sub: t.tStep4s },
  ];

  const counter =
    String(activeSlide + 1).padStart(2, "0") +
    "–" +
    String(Math.min(activeSlide + perView, PEOPLE.length)).padStart(2, "0") +
    " / 0" +
    PEOPLE.length;

  const navButton = cn(
    "inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border transition-colors duration-150",
    BORDER,
    SURFACE,
    TEXT_3,
    "hover:bg-gray-100 dark:hover:bg-gray-800"
  );

  return (
    <Reveal id="konsultasi" className={cn(SECTION, SCROLL_ANCHOR)}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className={cn("m-0 text-2xl font-semibold leading-8", TEXT)}>{t.tKonsulH}</h2>
          <p className={cn("mt-1.5 text-sm leading-5", TEXT_4)}>{t.tKonsulSub}</p>
        </div>
        <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-warning-200 bg-warning-50 px-3 py-1.5 text-xs font-medium leading-[18px] text-warning-700 dark:border-warning-500/40 dark:bg-warning-500/10 dark:text-warning-300">
          {t.tKonsulBadge}
        </span>
      </div>

      {/* How a booking works */}
      <div
        className={cn(
          "mb-4 grid gap-4 rounded-[20px] border p-5 md:grid-cols-4 md:gap-6 md:px-7 md:py-6",
          BORDER,
          SURFACE
        )}
      >
        {steps.map((step) => (
          <div key={step.n} className="flex items-start gap-3">
            <span
              className={cn(
                "inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-xs font-medium",
                MONO,
                SURFACE_BRAND_2,
                BRAND_TEXT
              )}
            >
              {step.n}
            </span>
            <span>
              <span className={cn("block text-sm font-semibold leading-5", TEXT)}>{step.title}</span>
              <span className={cn("mt-0.5 block text-xs leading-[18px]", TEXT_4)}>{step.sub}</span>
            </span>
          </div>
        ))}
      </div>

      {/* Specialist carousel */}
      <div className="relative">
        <div className="overflow-hidden">
          <div
            className="flex gap-4 transition-transform duration-500 ease-[cubic-bezier(.2,.8,.2,1)] [--card-step:calc(100%+16px)] md:[--card-step:calc(50%+8px)]"
            style={{ transform: `translateX(calc(var(--card-step) * -${activeSlide}))` }}
          >
            {PEOPLE.map((person, i) => (
              <article
                key={person.nama}
                className={cn(
                  "relative box-border flex w-full shrink-0 items-stretch gap-1 rounded-2xl border md:w-[calc((100%-16px)/2)]",
                  BORDER,
                  SURFACE,
                  "bg-[linear-gradient(150deg,#f2f7ff_0%,#ffffff_62%)] dark:bg-[linear-gradient(150deg,#141a33_0%,#1a2231_62%)]"
                )}
                inert={i < activeSlide || i >= activeSlide + perView}
              >
                {/* Photo slot: initials stand in until real portraits are dropped in. */}
                <div
                  className={cn(
                    "relative flex min-h-[210px] w-32 shrink-0 items-center justify-center self-stretch overflow-hidden rounded-l-2xl md:min-h-[250px] md:w-[170px]",
                    SURFACE_BRAND
                  )}
                >
                  <span className={cn("text-3xl font-semibold", MONO, BRAND_TEXT)} aria-hidden="true">
                    {person.init}
                  </span>
                </div>

                <div className="flex min-w-0 flex-auto flex-col items-start justify-end gap-2 py-6 pl-2 pr-[22px] text-left">
                  <div>
                    <div className={cn("text-[15px] font-semibold leading-[21px] -tracking-[0.01em]", TEXT)}>
                      {person.nama}
                    </div>
                    <div className={cn("mt-1 text-xs leading-[18px]", TEXT_4)}>{person.jabatan}</div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {person.chips.map((chip) => (
                      <span
                        key={chip}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[11px] font-medium leading-4",
                          BRAND_BORDER,
                          SURFACE,
                          BRAND_TEXT
                        )}
                      >
                        {chip}
                      </span>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenPetugas(i)}
                    className={cn(
                      "mt-0.5 inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-xs font-semibold leading-[18px] hover:underline",
                      BRAND_TEXT
                    )}
                  >
                    {t.tViewProfile}
                    <ArrowRightIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-center gap-3.5">
          <button
            type="button"
            onClick={() => goTo(activeSlide - 1)}
            className={navButton}
            aria-label="Sebelumnya"
          >
            <ChevronLeftIcon className="h-[18px] w-[18px]" />
          </button>
          <span className="flex items-center gap-1.5">
            {Array.from({ length: slides }, (_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`Slide ${i + 1}`}
                aria-current={activeSlide === i ? "true" : undefined}
                className={cn(
                  "h-2 cursor-pointer rounded-full border-0 p-0 transition-[width,background] duration-300",
                  activeSlide === i ? "w-[22px] bg-brand-500" : "w-2 bg-gray-300 dark:bg-gray-700"
                )}
              />
            ))}
          </span>
          <button
            type="button"
            onClick={() => goTo(activeSlide + 1)}
            className={navButton}
            aria-label="Selanjutnya"
          >
            <ChevronLeftIcon className="h-[18px] w-[18px] rotate-180" />
          </button>
          <span className={cn("ml-1.5 text-xs leading-[18px]", MONO, TEXT_5)}>{counter}</span>
        </div>
      </div>

      {/* Registration CTA */}
      <div
        className={cn(
          "mt-4 flex flex-col items-stretch justify-between gap-5 rounded-[20px] px-[22px] py-6 md:flex-row md:items-center md:gap-8 md:px-8 md:py-7",
          NAVY_PANEL
        )}
      >
        <div>
          <div className="text-lg font-semibold leading-[26px] text-white">{t.tCtaH}</div>
          <p className="mt-2 max-w-[620px] text-sm leading-[22px] text-brand-200">{t.tCtaSub}</p>
          <div className="mt-3.5 flex flex-wrap gap-4 text-xs leading-[18px] text-brand-300">
            {[t.tTick1, t.tTick2, t.tTick3].map((tick) => (
              <span key={tick} className="inline-flex items-center gap-1.5">
                <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                  <path
                    d="M13.4017 4.35986L6.12166 11.6399L2.59833 8.11657"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {tick}
              </span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2.5">
          <button
            type="button"
            onClick={onOpenReservasi}
            className="h-[46px] cursor-pointer rounded-xl border-0 bg-white px-6 text-[15px] font-semibold text-brand-800 transition-[transform,box-shadow] duration-150 hover:-translate-y-px hover:shadow-[0px_10px_20px_-6px_rgba(0,0,0,0.45)]"
          >
            {t.tCtaBtn}
          </button>
          <button
            type="button"
            onClick={onOpenMasuk}
            className="h-[46px] cursor-pointer rounded-xl border border-white/[0.28] bg-transparent px-6 text-[15px] font-medium text-white transition-colors duration-150 hover:bg-white/[0.12]"
          >
            {t.tCtaBtn2}
          </button>
        </div>
      </div>
    </Reveal>
  );
}
