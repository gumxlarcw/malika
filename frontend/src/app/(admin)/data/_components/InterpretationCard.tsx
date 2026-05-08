"use client";

import React from "react";
import InterpretationPanel from "@/components/search/InterpretationPanel";
import {
  asSourceType,
  SOURCE_TYPE_PALETTE,
  type SourceType,
} from "../_lib/sourceTypePalette";

// Wraps the existing InterpretationPanel in the redesigned card chrome with
// source-type-tinted icon avatar. The streaming pulse + content come from the
// existing component; we only add the title bar + footer affordances.
type InterpretationProps = React.ComponentProps<typeof InterpretationPanel>;

export default function InterpretationCard({
  q,
  cacheRef,
  dataset,
  preview,
}: InterpretationProps) {
  const datasetType = (dataset as { type?: string } | undefined)?.type;
  const sourceType = asSourceType(datasetType);
  const stype = SOURCE_TYPE_PALETTE[sourceType];

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800 md:px-5">
        <div className="flex items-center gap-2.5">
          <span
            className="relative inline-flex h-7 w-7 items-center justify-center rounded-lg"
            style={{ background: stype.light.bg }}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 16 16"
              fill="none"
              stroke={stype.bar}
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M8 1l1.5 4 4 1.5-4 1.5L8 12 6.5 8 2.5 6.5 6.5 5z" />
              <path d="M13 11l.6 1.4L15 13l-1.4.6L13 15l-.6-1.4L11 13l1.4-.6z" />
            </svg>
          </span>
          <div>
            <h3 className="text-[13px] font-semibold text-gray-900 dark:text-white md:text-[14px]">
              Interpretasi Otomatis
            </h3>
            <div className="text-[11px] text-gray-500 dark:text-gray-400">
              Dihasilkan AI · Tinjau sebelum dikutip
            </div>
          </div>
        </div>
      </div>
      <div className="malika-rail-glow flex-1 overflow-auto px-4 py-3 md:px-5 md:py-4">
        <InterpretationPanel
          q={q}
          cacheRef={cacheRef}
          dataset={dataset}
          preview={preview}
        />
      </div>
    </div>
  );
}
