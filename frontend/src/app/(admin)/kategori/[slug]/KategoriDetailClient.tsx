"use client";

import Link from "next/link";
import React, { useMemo, useState, type CSSProperties } from "react";
import {
  ArrowLeftIcon,
  ChartIcon,
  ChevronRightIcon,
  CloseIcon,
  CompositionDonut,
  DistributionBar,
  EmptyState,
  HomeIcon,
  SearchIcon,
  TypeBadge,
} from "../_components/atoms";
import { getCategoryDesign } from "../_lib/categoryIcons";
import {
  countByType,
  dominantType,
  SOURCE_TYPE_LABEL,
  SOURCE_TYPES,
  type Category,
  type CategorySource,
  type SourceType,
} from "../_lib/types";

type Filter = SourceType | "all";

export default function KategoriDetailClient({ category }: { category: Category }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const design = useMemo(() => getCategoryDesign(category.name), [category.name]);
  const tc = useMemo(() => countByType(category), [category]);
  const dominant = SOURCE_TYPE_LABEL[dominantType(tc)].toLowerCase();
  const typeCount = SOURCE_TYPES.filter((t) => tc[t] > 0).length;

  const filteredSources = useMemo(() => {
    let out = category.sources;
    if (filter !== "all") out = out.filter((s) => s.type === filter);
    if (q) {
      const ql = q.toLowerCase();
      out = out.filter((s) => s.name.toLowerCase().includes(ql));
    }
    return out;
  }, [category.sources, filter, q]);

  // CSS vars carry the per-category palette so Tailwind dark: modifiers can switch
  // between light/dark variants without re-rendering JSX trees.
  const tintVars: CSSProperties = {
    ["--cat-bg-light" as string]: design.light.bg,
    ["--cat-bg-dark" as string]: design.dark.bg,
    ["--cat-text-light" as string]: design.light.text,
    ["--cat-text-dark" as string]: design.dark.text,
    ["--cat-icon-light" as string]: design.light.icon,
    ["--cat-icon-dark" as string]: design.dark.icon,
    ["--cat-accent-light" as string]: design.light.accent,
    ["--cat-accent-dark" as string]: design.dark.icon,
  };

  return (
    <div className="space-y-0">
      {/* ── HERO (color-tinted by category) — full bleed via -mx ─────────── */}
      <section
        style={tintVars}
        className="relative -mx-4 overflow-hidden bg-[var(--cat-bg-light)] text-[color:var(--cat-text-light)] dark:bg-[var(--cat-bg-dark)] dark:text-[color:var(--cat-text-dark)] md:-mx-6"
      >
        {/* decorative splash */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-24 h-[280px] w-[280px] rounded-full opacity-[0.13] lg:h-[380px] lg:w-[380px]"
          style={{ background: "var(--cat-accent-light)" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-24 hidden h-[280px] w-[280px] rounded-full opacity-[0.18] dark:block lg:h-[380px] lg:w-[380px]"
          style={{ background: "var(--cat-accent-dark)" }}
        />

        <div className="relative px-4 py-6 md:px-6 lg:px-11 lg:py-9">
          {/* Breadcrumb */}
          <nav
            aria-label="Breadcrumb"
            className="mb-4 flex items-center gap-1.5 text-xs opacity-80"
          >
            <Link
              href="/"
              className="inline-flex items-center gap-1 hover:opacity-100"
            >
              <HomeIcon size={12} />
              Beranda
            </Link>
            <ChevronRightIcon size={11} className="opacity-60" />
            <Link href="/kategori" className="font-semibold hover:opacity-100">
              Kategori
            </Link>
            <ChevronRightIcon size={11} className="opacity-60" />
            <span className="truncate font-bold" style={{ maxWidth: 220 }}>
              {category.name}
            </span>
          </nav>

          <div className="grid items-center gap-6 lg:grid-cols-[1fr_auto] lg:gap-10">
            {/* left column: back button + title + description */}
            <div className="min-w-0">
              <Link
                href="/kategori"
                className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-white/65 px-3 py-1.5 text-xs font-semibold backdrop-blur-sm transition-colors hover:bg-white/85 dark:bg-white/10 dark:hover:bg-white/15"
              >
                <ArrowLeftIcon size={14} />
                Kembali ke Kategori
              </Link>
              <div className="flex items-start gap-4 lg:gap-5">
                <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-white/70 dark:bg-white/10 lg:h-20 lg:w-20">
                  <span className="text-[color:var(--cat-icon-light)] dark:text-[color:var(--cat-icon-dark)]">
                    {design.render(28, "currentColor")}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.05em] opacity-70 lg:text-[11px]">
                    Sektor Data
                  </div>
                  <h1 className="m-0 text-balance text-2xl font-bold leading-[1.15] tracking-tight lg:text-4xl">
                    {category.name}
                  </h1>
                  <p className="mt-2 max-w-xl text-sm leading-relaxed opacity-80 lg:mt-3 lg:text-[15px]">
                    <strong className="font-bold">{category.count} indikator</strong>{" "}
                    dari <strong className="font-bold">{typeCount} jenis sumber</strong>
                    {dominant && tc[dominantType(tc)] > 0 ? (
                      <>
                        , dengan dominasi <strong className="font-bold">{dominant}</strong>{" "}
                        sebagai sumber utama.
                      </>
                    ) : (
                      "."
                    )}
                  </p>
                </div>
              </div>

              {/* mobile-only distribution bar — desktop uses donut panel on the right */}
              <div className="mt-5 lg:hidden">
                <DistributionBar counts={tc} height={6} showLegend />
              </div>
            </div>

            {/* desktop-only donut panel */}
            <div className="hidden rounded-2xl border border-white/70 bg-white/50 p-4 backdrop-blur-sm dark:border-white/10 dark:bg-white/5 lg:flex lg:items-center lg:gap-5">
              <CompositionDonut
                counts={tc}
                size={160}
                strokeWidth={22}
                centerLabel={category.count.toLocaleString("id-ID")}
                centerSubLabel="INDIKATOR"
              />
              <div className="flex min-w-[140px] flex-col gap-1.5">
                {SOURCE_TYPES.map((t) =>
                  tc[t] > 0 ? (
                    <div key={t} className="flex items-center gap-2 text-xs">
                      <TypeBadge type={t} small />
                      <span className="ml-auto font-bold tabular-nums">{tc[t]}</span>
                    </div>
                  ) : null,
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── STICKY FILTER (search + segmented type filter) ───────────────── */}
      <div className="sticky top-[76px] z-[5] -mx-4 border-b border-gray-200/60 bg-gray-50/85 px-4 py-3 backdrop-blur-md dark:border-gray-800/60 dark:bg-[#020617]/85 md:-mx-6 md:top-[89px] md:px-6 lg:px-11">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900 lg:max-w-md">
            <SearchIcon size={15} className="text-gray-400 dark:text-gray-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Cari di ${category.count} sumber data…`}
              className="flex-1 border-0 bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400 dark:text-white/95 dark:placeholder:text-gray-500"
              aria-label="Cari sumber data"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                className="flex items-center text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                aria-label="Hapus pencarian"
              >
                <CloseIcon size={14} />
              </button>
            )}
          </div>

          <div className="-mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:px-0">
            <div className="flex gap-1 rounded-lg bg-black/5 p-[3px] dark:bg-white/5">
              {(
                [
                  { k: "all" as const, label: "Semua", n: category.count },
                  ...SOURCE_TYPES.filter((t) => tc[t] > 0).map((t) => ({
                    k: t,
                    label: SOURCE_TYPE_LABEL[t],
                    n: tc[t],
                  })),
                ]
              ).map((seg) => {
                const active = filter === seg.k;
                return (
                  <button
                    key={seg.k}
                    type="button"
                    onClick={() => setFilter(seg.k)}
                    className={`flex-shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                      active
                        ? "bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-white"
                        : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
                    }`}
                  >
                    {seg.label}{" "}
                    <span className="ml-1 opacity-60">{seg.n}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="hidden flex-1 lg:block" />
          <div className="text-xs text-gray-500 dark:text-gray-400 lg:text-sm">
            <strong className="font-bold text-gray-900 dark:text-white/95">
              {filteredSources.length}
            </strong>{" "}
            sumber{q && ` cocok dengan "${q}"`}
          </div>
        </div>
      </div>

      {/* ── SOURCE LIST ──────────────────────────────────────────────────── */}
      <section className="pt-5 lg:pt-8">
        {filteredSources.length === 0 ? (
          <EmptyState
            query={q || filter !== "all" ? q : ""}
            message={
              q
                ? `Tidak ada sumber yang cocok dengan "${q}"`
                : "Tidak ada sumber pada filter ini."
            }
            onClear={() => {
              setQ("");
              setFilter("all");
            }}
          />
        ) : (
          <div
            className="grid gap-2.5 lg:gap-3"
            style={{ gridTemplateColumns: "1fr" }}
          >
            <SourceGrid sources={filteredSources} accentLight={design.light.icon} accentDark={design.dark.icon} />
          </div>
        )}
      </section>
    </div>
  );
}

function SourceGrid({
  sources,
  accentLight,
  accentDark,
}: {
  sources: CategorySource[];
  accentLight: string;
  accentDark: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2 lg:gap-3">
      {sources.map((src) => (
        <SourceRow key={src.id} src={src} accentLight={accentLight} accentDark={accentDark} />
      ))}
    </div>
  );
}

function SourceRow({
  src,
  accentLight,
  accentDark,
}: {
  src: CategorySource;
  accentLight: string;
  accentDark: string;
}) {
  const t = src.type as SourceType;
  return (
    <Link
      href={`/data?source_id=${src.id}`}
      className="group flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 transition-all duration-150 hover:-translate-y-[1px] hover:shadow-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700 lg:p-4"
      style={
        {
          ["--accent-light" as string]: accentLight,
          ["--accent-dark" as string]: accentDark,
        } as CSSProperties
      }
    >
      {/* colored stripe — type-based */}
      <span
        aria-hidden
        className={`h-9 w-1 flex-shrink-0 rounded-full ${stripeFor(t)}`}
      />
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 transition-colors dark:bg-brand-500/15 dark:text-brand-300 group-hover:text-[color:var(--accent-light)] dark:group-hover:text-[color:var(--accent-dark)]">
        <ChartIcon size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-sm font-semibold leading-snug text-gray-900 transition-colors dark:text-white/95 group-hover:text-[color:var(--accent-light)] dark:group-hover:text-[color:var(--accent-dark)]">
          {src.name}
        </div>
        <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
          source · #{src.id}
        </div>
      </div>
      <TypeBadge type={src.type} small />
      <ChevronRightIcon
        size={16}
        className="text-gray-400 transition-transform group-hover:translate-x-0.5 dark:text-gray-500"
      />
    </Link>
  );
}

function stripeFor(t: SourceType | string): string {
  switch (t) {
    case "dynamic": return "bg-blue-500 dark:bg-blue-400";
    case "interop": return "bg-violet-500 dark:bg-violet-400";
    case "exim":    return "bg-orange-500 dark:bg-orange-400";
    case "static":  return "bg-gray-500 dark:bg-gray-400";
    default:        return "bg-gray-300 dark:bg-gray-600";
  }
}
