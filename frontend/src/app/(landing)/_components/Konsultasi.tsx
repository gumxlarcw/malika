"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { ArrowRightIcon, ChevronLeftIcon } from "@/icons";
import { cn } from "@/lib/utils";
import type { Copy } from "../_lib/copy";
import { PEOPLE, TIM } from "../_lib/people";
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
  /** Booking is not live yet; every control in this section routes here. */
  onComingSoon: () => void;
};

const AUTO_ADVANCE_MS = 10000;
// Past this, one dot per slide stops being a readable position indicator
// (and stops being a sane number of tab stops) — fall back to a rail.
const MAX_DOTS = 8;

export default function Konsultasi({ t, onComingSoon }: Props) {
  const isDesktop = useIsDesktop();
  const reduceMotion = useReducedMotion();
  // A page is 3x2 on a wide screen. Phones keep the two rows but drop to one
  // column, so they carry a third of the cards per page.
  const perPage = isDesktop ? 6 : 2;
  const pages = Math.max(1, Math.ceil(PEOPLE.length / perPage));
  const [page, setPage] = useState(0);
  // Bumped on manual navigation to restart the auto-advance timer.
  const [nudge, setNudge] = useState(0);
  // Pointer or keyboard focus inside the carousel means someone is reading it —
  // swapping six cards out from under them is the wrong move.
  const [held, setHeld] = useState(false);

  // Widening the viewport packs more cards per page, leaving fewer pages than
  // the track may currently be parked on — clamp on read rather than storing a
  // corrected value back into state.
  const activePage = Math.min(page, pages - 1);

  useEffect(() => {
    if (reduceMotion || held) return;
    const id = setInterval(
      () => setPage((p) => (Math.min(p, pages - 1) + 1) % pages),
      AUTO_ADVANCE_MS
    );
    return () => clearInterval(id);
  }, [pages, reduceMotion, held, nudge]);

  const goTo = useCallback(
    (index: number) => {
      setPage(((index % pages) + pages) % pages);
      setNudge((n) => n + 1);
    },
    [pages]
  );

  const steps = [
    { n: "01", title: t.tStep1, sub: t.tStep1s },
    { n: "02", title: t.tStep2, sub: t.tStep2s },
    { n: "03", title: t.tStep3, sub: t.tStep3s },
    { n: "04", title: t.tStep4, sub: t.tStep4s },
  ];

  const counter =
    String(activePage * perPage + 1).padStart(2, "0") +
    "–" +
    String(Math.min((activePage + 1) * perPage, PEOPLE.length)).padStart(2, "0") +
    " / " +
    String(PEOPLE.length).padStart(2, "0");

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
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-medium leading-[18px] text-brand-700 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-300">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden="true" />
            {t.tKonsulSoon}
          </span>
          <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-warning-200 bg-warning-50 px-3 py-1.5 text-xs font-medium leading-[18px] text-warning-700 dark:border-warning-500/40 dark:bg-warning-500/10 dark:text-warning-300">
            {t.tKonsulBadge}
          </span>
        </div>
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

      {/* Specialist carousel — a page of cards at a time, 3x2 on desktop */}
      {/* onFocus/onBlur bubble in React, so this covers keyboard focus too. */}
      <div
        className="relative"
        onMouseEnter={() => setHeld(true)}
        onMouseLeave={() => setHeld(false)}
        onFocus={() => setHeld(true)}
        onBlur={() => setHeld(false)}
      >
        <div className="overflow-hidden">
          <div
            className="flex transition-transform duration-500 ease-[cubic-bezier(.2,.8,.2,1)]"
            style={{ transform: `translateX(-${activePage * 100}%)` }}
          >
            {Array.from({ length: pages }, (_, p) => (
              <div
                key={p}
                className="grid w-full shrink-0 grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
                inert={p !== activePage}
              >
                {PEOPLE.slice(p * perPage, (p + 1) * perPage).map((person) => (
                    <article
                      key={person.nama}
                      className={cn(
                        "relative box-border flex items-stretch gap-1 rounded-2xl border",
                        BORDER,
                        SURFACE,
                        "bg-[linear-gradient(150deg,#f2f7ff_0%,#ffffff_62%)] dark:bg-[linear-gradient(150deg,#141a33_0%,#1a2231_62%)]"
                      )}
                    >
                      {/* Photo slot: initials stand in until real portraits are dropped in. */}
                      <div
                        className={cn(
                          "relative flex min-h-[200px] w-28 shrink-0 items-center justify-center self-stretch overflow-hidden rounded-l-2xl md:w-[132px]",
                          SURFACE_BRAND
                        )}
                      >
                        <span
                          className={cn("text-3xl font-semibold", MONO, BRAND_TEXT)}
                          aria-hidden="true"
                        >
                          {person.init}
                        </span>
                      </div>

                      <div className="flex min-w-0 flex-auto flex-col items-start justify-end gap-2 py-5 pl-3 pr-4 text-left">
                        <div>
                          <div
                            className={cn(
                              "text-[15px] font-semibold leading-[21px] -tracking-[0.01em]",
                              TEXT
                            )}
                          >
                            {person.nama}
                          </div>
                          <div className={cn("mt-1 text-xs leading-[18px]", TEXT_4)}>
                            {person.jabatan}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {[TIM[person.tim].ringkas, ...person.chips].map((chip) => (
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
                          onClick={onComingSoon}
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
            ))}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-center gap-3.5">
          <button
            type="button"
            onClick={() => goTo(activePage - 1)}
            className={navButton}
            aria-label="Sebelumnya"
          >
            <ChevronLeftIcon className="h-[18px] w-[18px]" />
          </button>
          {pages <= MAX_DOTS ? (
            <span className="flex items-center gap-1.5">
              {Array.from({ length: pages }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => goTo(i)}
                  aria-label={`Halaman ${i + 1}`}
                  aria-current={activePage === i ? "true" : undefined}
                  className={cn(
                    "h-2 cursor-pointer rounded-full border-0 p-0 transition-[width,background] duration-300",
                    activePage === i ? "w-[22px] bg-brand-500" : "w-2 bg-gray-300 dark:bg-gray-700"
                  )}
                />
              ))}
            </span>
          ) : (
            <span
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={pages}
              aria-valuenow={activePage + 1}
              className="h-2 w-[140px] overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800"
            >
              <span
                className="block h-full rounded-full bg-brand-500 transition-transform duration-300"
                style={{
                  width: `${100 / pages}%`,
                  transform: `translateX(${activePage * 100}%)`,
                }}
              />
            </span>
          )}
          <button
            type="button"
            onClick={() => goTo(activePage + 1)}
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
            onClick={onComingSoon}
            className="h-[46px] cursor-pointer rounded-xl border-0 bg-white px-6 text-[15px] font-semibold text-brand-800 transition-[transform,box-shadow] duration-150 hover:-translate-y-px hover:shadow-[0px_10px_20px_-6px_rgba(0,0,0,0.45)]"
          >
            {t.tCtaBtn}
          </button>
          <button
            type="button"
            onClick={onComingSoon}
            className="h-[46px] cursor-pointer rounded-xl border border-white/[0.28] bg-transparent px-6 text-[15px] font-medium text-white transition-colors duration-150 hover:bg-white/[0.12]"
          >
            {t.tCtaBtn2}
          </button>
        </div>
      </div>
    </Reveal>
  );
}
