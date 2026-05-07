"use client";

import React, { useState } from "react";
import { ChevronDownIcon } from "@/components/chat/icons";
import type { DnaUiMetadata, DnaUiItem } from "@/types/chat";

/* ── Constants ────────────────────────────────────────────────────── */

const TYPE_LABELS: Record<DnaUiItem["type"], string> = {
  variable: "Variabel",
  indicator: "Indikator",
  kegiatan: "Kegiatan Statistik",
};

const TYPE_COLORS: Record<
  DnaUiItem["type"],
  { badge: string; icon: string; border: string }
> = {
  variable: {
    badge:
      "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
    icon: "text-sky-500 dark:text-sky-400",
    border: "border-sky-200 dark:border-sky-800",
  },
  indicator: {
    badge:
      "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
    icon: "text-violet-500 dark:text-violet-400",
    border: "border-violet-200 dark:border-violet-800",
  },
  kegiatan: {
    badge:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    icon: "text-amber-500 dark:text-amber-400",
    border: "border-amber-200 dark:border-amber-800",
  },
};

/* ── Helper: metadata field row ───────────────────────────────────── */

function MetaRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-xs min-w-0">
      <span className="font-medium text-gray-500 dark:text-gray-400 w-[72px] sm:w-[90px] flex-shrink-0">
        {label}
      </span>
      <span className="text-gray-700 dark:text-gray-300 leading-relaxed min-w-0 break-words">
        {value}
      </span>
    </div>
  );
}

/* ── Single DNA item card ─────────────────────────────────────────── */

function DnaItemCard({ item }: { item: DnaUiItem }) {
  const colors = TYPE_COLORS[item.type] || TYPE_COLORS.variable;

  return (
    <div
      className={`rounded-lg border ${colors.border} bg-white/60 dark:bg-gray-900/40 p-2.5 sm:p-3 space-y-2 overflow-hidden`}
    >
      {/* Header: type badge + name */}
      <div className="flex items-start gap-1.5 sm:gap-2 min-w-0">
        <span
          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] font-semibold uppercase tracking-wide flex-shrink-0 ${colors.badge}`}
        >
          {TYPE_LABELS[item.type]}
        </span>
        <span className="text-xs sm:text-sm font-semibold text-gray-900 dark:text-white leading-tight min-w-0 break-words">
          {item.nama}
        </span>
      </div>

      {/* Alias if present */}
      {item.alias && (
        <div className="text-[11px] text-gray-500 dark:text-gray-400 -mt-1 break-words">
          Alias: <span className="italic">{item.alias}</span>
        </div>
      )}

      {/* Metadata fields */}
      <div className="space-y-1 pt-1">
        <MetaRow label="Definisi" value={item.definisi} />
        <MetaRow label="Konsep" value={item.konsep} />
        <MetaRow label="Satuan" value={item.satuan} />
        <MetaRow label="Ukuran" value={item.ukuran} />
        <MetaRow label="Ref. Waktu" value={item.referensiWaktu} />
        <MetaRow label="Tujuan" value={item.tujuan} />
        <MetaRow label="Metode" value={item.metode} />
        <MetaRow label="Frekuensi" value={item.frekuensi} />
      </div>

      {/* BPS badge */}
      {item.isBps && (
        <div className="flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500 pt-1">
          <svg
            className="h-3 w-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          Definisi resmi BPS
        </div>
      )}
    </div>
  );
}

/* ── Main section ─────────────────────────────────────────────────── */

interface DnaMetadataSectionProps {
  dnaMetadata: DnaUiMetadata | null | undefined;
}

export default function DnaMetadataSection({
  dnaMetadata,
}: DnaMetadataSectionProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!dnaMetadata?.items?.length) return null;

  return (
    <div className="mt-3 rounded-lg border border-teal-200 bg-teal-50/70 p-2.5 sm:p-3 dark:border-teal-800 dark:bg-teal-950/30 overflow-hidden">
      {/* Toggle header */}
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 sm:gap-2 rounded-lg px-1 py-0.5 text-left hover:bg-teal-100/50 dark:hover:bg-teal-900/30 transition-colors group min-w-0"
      >
        {/* DNA icon */}
        <svg
          className="h-4 w-4 text-teal-500 dark:text-teal-400 flex-shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
          />
        </svg>
        <span className="text-[11px] font-medium text-teal-700 dark:text-teal-300 flex-1">
          Metadata Statistik — DNA Nucleus BPS
        </span>
        <span className="text-[10px] text-teal-500 dark:text-teal-400 group-hover:text-teal-700 dark:group-hover:text-teal-300">
          {dnaMetadata.items.length} item
        </span>
        <ChevronDownIcon className={`h-3.5 w-3.5 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {/* Collapsible content */}
      {isOpen && (
        <div className="mt-2 space-y-2 px-1">
          {dnaMetadata.items.map((item, idx) => (
            <DnaItemCard key={`${item.type}-${idx}`} item={item} />
          ))}
          <div className="text-[10px] text-gray-400 dark:text-gray-500 text-right pr-1 pt-1">
            Sumber: DNA Nucleus BPS (dna.web.bps.go.id)
          </div>
        </div>
      )}
    </div>
  );
}
