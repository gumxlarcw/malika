"use client";

import React from "react";
import { cn } from "@/lib/utils";
import type { Copy } from "../_lib/copy";
import { BORDER, BRAND_TEXT, MONO, SECTION, SURFACE, TEXT, TEXT_3, TEXT_4 } from "../_lib/ui";
import Reveal from "./Reveal";

type Props = { t: Copy };

export default function AboutStrip({ t }: Props) {
  const heading = cn("m-0 text-[22px] font-semibold leading-[30px]", TEXT);

  return (
    <Reveal className={SECTION}>
      <div
        className={cn(
          "grid gap-6 rounded-[20px] border p-6 md:grid-cols-3 md:gap-10 md:p-10",
          BORDER,
          SURFACE
        )}
      >
        <div>
          <h2 className={heading}>{t.tAboutH}</h2>
          <p className={cn("mt-2.5 text-sm leading-[22px]", TEXT_3)}>{t.tAboutBody}</p>
          <p className={cn("mt-2.5 text-[13px] leading-5", TEXT_4)}>{t.tAboutBody2}</p>
        </div>

        <div>
          <h2 className={heading}>{t.tSourceH}</h2>
          <ul className="m-0 mt-2.5 flex list-none flex-col gap-2 p-0">
            {[t.tSrc1, t.tSrc2, t.tSrc3].map((src) => (
              <li key={src} className={cn("text-sm leading-[22px]", TEXT_3)}>
                {src}
              </li>
            ))}
          </ul>
          <p className={cn("mt-3 text-[13px] leading-5", TEXT_4)}>{t.tSampleNote}</p>
        </div>

        <div>
          <h2 className={heading}>{t.tHowH}</h2>
          <ul className="m-0 mt-2.5 flex list-none flex-col gap-2.5 p-0">
            {[t.tHow1, t.tHow2, t.tHow3].map((how, i) => (
              <li key={how} className={cn("flex gap-2.5 text-sm leading-[22px]", TEXT_3)}>
                <span className={cn(MONO, BRAND_TEXT)}>{String(i + 1).padStart(2, "0")}</span>
                {how}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Reveal>
  );
}
