"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useReducedMotion } from "framer-motion";
import { ArrowRightIcon, ChatIcon } from "@/icons";
import { cn } from "@/lib/utils";
import { getQuestions, type Copy, type Lang } from "../_lib/copy";
import { NAVY_PANEL } from "../_lib/ui";

type Props = { t: Copy; lang: Lang };

/**
 * The rotating question lives in the input's *placeholder*, as in the source
 * design — the field stays a real, typeable input throughout. Kept in its own
 * component so the ~18 updates/second it produces don't re-render the chips and
 * stats around it.
 */
function AskBox({ t, lang }: Props) {
  const reduceMotion = useReducedMotion();
  const [typed, setTyped] = useState("");
  const [caret, setCaret] = useState(true);

  useEffect(() => {
    if (reduceMotion) return;

    const questions = getQuestions(lang);
    let questionIndex = 0;
    let charIndex = 0;
    let deleting = false;
    let hold = 0;

    const tick = setInterval(() => {
      const full = questions[questionIndex];
      if (!deleting) {
        charIndex += 1;
        if (charIndex >= full.length) {
          deleting = true;
          hold = 14;
        }
      } else if (hold > 0) {
        hold -= 1;
      } else {
        charIndex -= 3;
        if (charIndex <= 0) {
          charIndex = 0;
          deleting = false;
          questionIndex = (questionIndex + 1) % questions.length;
        }
      }
      setTyped(full.slice(0, Math.max(0, charIndex)));
    }, 55);

    const blink = setInterval(() => setCaret((c) => !c), 480);
    return () => {
      clearInterval(tick);
      clearInterval(blink);
    };
  }, [lang, reduceMotion]);

  // Under reduce-motion the field shows one settled question instead of typing.
  const placeholder = reduceMotion ? getQuestions(lang)[0] : typed + (caret ? "▌" : " ");

  return (
    <div
      className={cn(
        "landing-rise mx-auto mt-7 flex max-w-[760px] flex-col items-stretch gap-2.5 rounded-[18px] bg-white p-3 shadow-[0px_20px_24px_-4px_rgba(16,24,40,0.18),0px_8px_8px_-4px_rgba(16,24,40,0.06)] transition-[transform,box-shadow] duration-200 [animation-delay:640ms]",
        "hover:-translate-y-[3px] hover:shadow-[0_0_0_4px_rgba(70,95,255,0.28),0px_24px_30px_-6px_rgba(16,24,40,0.24)]",
        "md:mt-9 md:flex-row md:items-center md:gap-3 md:py-3 md:pl-5 md:pr-3"
      )}
    >
      <ChatIcon className="h-[22px] w-[22px] shrink-0 text-brand-500" />
      <input
        type="text"
        aria-label={t.tHeroCta}
        placeholder={placeholder}
        className="min-w-0 flex-auto border-0 bg-transparent text-base leading-6 text-gray-700 outline-none placeholder:text-gray-700"
      />
      <Link
        href="/chat"
        className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand-500 px-[22px] text-[15px] font-semibold text-white transition-[background,transform,box-shadow] duration-150 hover:-translate-y-px hover:bg-brand-600 hover:shadow-[0px_8px_16px_-4px_rgba(70,95,255,0.5)]"
      >
        {t.tHeroCta}
        <ArrowRightIcon className="h-5 w-5" />
      </Link>
    </div>
  );
}

export default function Hero({ t, lang }: Props) {
  const chips = [t.tChip1, t.tChip2, t.tChip3, t.tChip4];
  const stats = [t.tStat1, t.tStat2, t.tStat3, t.tStat4];

  return (
    <section
      className={cn(
        "relative mx-[18px] mt-4 overflow-hidden rounded-[20px] md:mx-8 md:mt-5 md:rounded-3xl",
        NAVY_PANEL
      )}
    >
      <div className="mx-auto max-w-[1136px] px-5 pb-11 pt-12 text-center md:px-12 md:pb-18 md:pt-22">
        <h1 className="mt-6 text-[34px] font-semibold leading-10 -tracking-[0.02em] text-white md:text-[60px] md:leading-[68px]">
          <span className="landing-rise inline-block [animation-delay:60ms]">{t.tHeroL1}</span>
          <br />
          <span className="landing-rise landing-sheen inline-block bg-[linear-gradient(90deg,#ffffff_0%,#9cb9ff_35%,#ffffff_70%,#9cb9ff_100%)] bg-clip-text text-transparent [animation-delay:220ms]">
            {t.tHeroL3}
          </span>
        </h1>

        <p className="landing-rise mx-auto mt-4 max-w-[620px] text-[15px] leading-6 text-brand-200 [animation-delay:560ms] md:text-lg md:leading-7">
          {t.tHeroSub}
        </p>

        <AskBox t={t} lang={lang} />

        <div className="mx-auto mt-5 flex max-w-full flex-nowrap justify-start gap-2 overflow-x-auto pb-1 md:flex-wrap md:justify-center md:overflow-x-visible md:pb-0">
          {chips.map((chip, i) => (
            <Link
              key={chip}
              href="/chat"
              className="landing-rise whitespace-nowrap rounded-full border border-white/[0.18] bg-white/[0.06] px-3.5 py-2 text-[13px] leading-5 text-brand-100 transition-[background,transform,border-color] duration-150 hover:-translate-y-0.5 hover:border-white/40 hover:bg-white/[0.16]"
              style={{ animationDelay: `${760 + i * 80}ms` }}
            >
              {chip}
            </Link>
          ))}
        </div>

        <div className="landing-fade mx-auto mt-10 flex flex-wrap justify-center gap-x-8 gap-y-2 text-[13px] leading-5 text-brand-300 [animation-delay:1100ms]">
          {stats.map((stat) => (
            <span key={stat}>{stat}</span>
          ))}
        </div>
      </div>
    </section>
  );
}
