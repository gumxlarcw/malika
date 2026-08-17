"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  ChartIcon,
  ChevronRightIcon,
  CloseIcon,
  DistributionBar,
  EmptyState,
  FolderIcon,
  SearchIcon,
  SectionHeader,
  SortIcon,
  TypeBadge,
} from "./_components/atoms";
import { getCategoryDesign } from "./_lib/categoryIcons";
import {
  countByType,
  emptyTypeCounts,
  inferTypeFromLink,
  nfmt,
  SOURCE_TYPES,
  SOURCE_TYPE_LABEL,
  type Category,
  type Indicator,
  type SourceType,
  type TypeCounts,
} from "./_lib/types";

type SortOption = "count" | "abjad";

export default function KategoriPageClient() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOption>("count");

  const [indicators, setIndicators] = useState<Indicator[]>([]);
  const [hasExactIndicators, setHasExactIndicators] = useState(false);
  const [loadingIndicators, setLoadingIndicators] = useState(false);

  // Initial categories fetch
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/categories", { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to fetch categories");
        const data = await res.json();
        if (!alive) return;
        setCategories(data.categories ?? []);
      } catch (err) {
        console.error(err);
        if (alive) setError("Gagal memuat kategori. Silakan coba lagi.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Debounced indicator search
  useEffect(() => {
    if (!search.trim()) {
      setIndicators([]);
      setHasExactIndicators(false);
      setLoadingIndicators(false);
      return;
    }
    setLoadingIndicators(true);
    const id = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(search)}&limit=20`,
        );
        if (!res.ok) return;
        const data = await res.json();
        const exactDs = data.exact?.datasources ?? [];
        const suggestDs = data.suggestions?.datasources ?? [];
        const seen = new Set<number>();
        const merged: Indicator[] = [];
        for (const ds of [...exactDs, ...suggestDs]) {
          if (!seen.has(ds.id)) {
            seen.add(ds.id);
            merged.push({
              id: ds.id,
              name: ds.title ?? "",
              title: ds.title,
              type: inferTypeFromLink(ds.link),
              category: ds.subtitle ?? "",
              score: ds.score ?? 0,
              subtitle: ds.subtitle,
              link: ds.link,
            });
          }
        }
        setIndicators(merged.slice(0, 20));
        setHasExactIndicators(exactDs.length > 0);
      } catch (err) {
        console.error("Error searching indicators:", err);
      } finally {
        setLoadingIndicators(false);
      }
    }, 200);
    return () => clearTimeout(id);
  }, [search]);

  // Total composition (across all categories) — used by the hero summary panel
  const totalIndicators = useMemo(
    () => categories.reduce((a, c) => a + c.count, 0),
    [categories],
  );
  const totalComposition: TypeCounts = useMemo(() => {
    const acc = emptyTypeCounts();
    for (const c of categories) {
      const tc = countByType(c);
      for (const t of SOURCE_TYPES) acc[t] += tc[t];
    }
    return acc;
  }, [categories]);

  const filteredCategories = useMemo(() => {
    let out = categories;
    if (search.trim()) {
      const ql = search.toLowerCase();
      out = out.filter((c) => c.name.toLowerCase().includes(ql));
    }
    out = [...out].sort((a, b) =>
      sort === "abjad" ? a.name.localeCompare(b.name) : b.count - a.count,
    );
    return out;
  }, [categories, search, sort]);

  const featured = filteredCategories.slice(0, 4);
  const secondary = filteredCategories.slice(4);

  const showIndicators = !!search.trim() && hasExactIndicators && indicators.length > 0;
  const noResults =
    !!search.trim() &&
    filteredCategories.length === 0 &&
    indicators.length === 0 &&
    !loadingIndicators;

  return (
    <div className="space-y-0">
      {/* ── HERO (dark brand band) — full bleed via -mx ──────────────────── */}
      <Hero
        catCount={categories.length}
        totalIndicators={totalIndicators}
        composition={totalComposition}
        loading={loading}
      />

      {/* ── STICKY FILTER ────────────────────────────────────────────────── */}
      {/*
        Offsets track the site header: 60px, 68px from `md`. They were 76/89 for
        the old sidebar shell's taller bar, which left the strip floating a
        visible gap below the header. The negative margins match the shell's
        gutters (18px, 32px from `md`) so the strip bleeds to the column edges.
      */}
      <div className="sticky top-[60px] z-[5] -mx-[18px] border-b border-gray-200/60 bg-gray-50/85 px-[18px] py-3 backdrop-blur-md dark:border-gray-800/60 dark:bg-[#020617]/85 md:-mx-8 md:top-[68px] md:px-8">
        {/* Wraps: at 360px the search field plus both sort buttons overrun the row. */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900 lg:max-w-md">
            <SearchIcon size={15} className="text-gray-400 dark:text-gray-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari kategori atau indikator…"
              className="flex-1 border-0 bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400 dark:text-white/95 dark:placeholder:text-gray-500"
              aria-label="Cari kategori atau indikator"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="flex items-center text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                aria-label="Hapus pencarian"
              >
                <CloseIcon size={14} />
              </button>
            )}
          </div>

          {/* sort: compact toggle on mobile, segmented on desktop */}
          <button
            type="button"
            onClick={() => setSort(sort === "count" ? "abjad" : "count")}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 lg:hidden"
            aria-label={
              sort === "count"
                ? "Urutkan berdasarkan abjad"
                : "Urutkan berdasarkan jumlah terbanyak"
            }
          >
            <SortIcon size={13} className="text-brand-500 dark:text-brand-400" />
            {sort === "count" ? "Terbanyak" : "A–Z"}
          </button>

          <div className="hidden gap-1 rounded-lg bg-black/5 p-[3px] dark:bg-white/5 lg:flex">
            {(
              [
                { k: "count" as const, label: "Jumlah Terbanyak" },
                { k: "abjad" as const, label: "Abjad" },
              ]
            ).map((o) => {
              const active = sort === o.k;
              return (
                <button
                  key={o.k}
                  type="button"
                  onClick={() => setSort(o.k)}
                  className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                    active
                      ? "bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-white"
                      : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
                  }`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>

          <div className="hidden flex-1 lg:block" />
          <div className="hidden text-sm text-gray-500 dark:text-gray-400 lg:block">
            Menampilkan{" "}
            <strong className="font-bold text-gray-900 dark:text-white/95">
              {filteredCategories.length}
            </strong>{" "}
            kategori
          </div>
        </div>
      </div>

      {/* ── ERROR ────────────────────────────────────────────────────────── */}
      {error && (
        <div className="pt-6">
          <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center dark:border-gray-800 dark:bg-gray-900">
            <p className="text-sm text-gray-500 dark:text-gray-400">{error}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 inline-flex items-center justify-center rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-600"
            >
              Coba Lagi
            </button>
          </div>
        </div>
      )}

      {/* ── LOADING SKELETON ─────────────────────────────────────────────── */}
      {loading && !error && <ListSkeleton />}

      {/* ── NO-RESULTS ───────────────────────────────────────────────────── */}
      {!loading && !error && noResults && (
        <div className="pt-8 lg:pt-12">
          <EmptyState
            query={search}
            onClear={() => setSearch("")}
            size="md"
          />
        </div>
      )}

      {/* ── INDICATORS-FIRST (when search has exact hits) ────────────────── */}
      {!loading && showIndicators && (
        <section className="pt-5 lg:pt-8">
          <SectionHeader
            icon={<ChartIcon size={14} />}
            label="Indikator"
            count={indicators.length}
            size="lg"
          />
          <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2 lg:gap-3">
            {indicators.map((ind) => (
              <IndicatorRow key={ind.id} ind={ind} />
            ))}
          </div>
        </section>
      )}

      {/* ── FEATURED (top-4 color-tinted cards) ──────────────────────────── */}
      {!loading && filteredCategories.length > 0 && (
        <section className="pt-5 lg:pt-8">
          <SectionHeader
            icon={<FolderIcon size={14} />}
            label={search ? "Kategori" : "Pilihan Populer"}
            count={search ? filteredCategories.length : featured.length}
            subtitle={search ? undefined : "Empat kategori dengan indikator terbanyak"}
            size="lg"
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
            {featured.map((cat) => (
              <FeaturedCard key={cat.slug} cat={cat} />
            ))}
          </div>
        </section>
      )}

      {/* ── SECONDARY (rest as compact cards) ────────────────────────────── */}
      {!loading && !search && secondary.length > 0 && (
        <section className="pt-7 pb-2 lg:pt-10">
          <SectionHeader
            icon={<FolderIcon size={14} />}
            label="Semua Kategori"
            count={secondary.length}
            subtitle="Diurutkan berdasarkan jumlah indikator"
            size="lg"
          />
          <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-3 lg:gap-3">
            {secondary.map((cat) => (
              <CompactCard key={cat.slug} cat={cat} />
            ))}
          </div>
        </section>
      )}

      {/* ── INDICATOR SUGGESTIONS (after categories when no exact) ───────── */}
      {!loading && search && !showIndicators && indicators.length > 0 && (
        <section className="pt-7 pb-2 lg:pt-10">
          <SectionHeader
            icon={<ChartIcon size={14} />}
            label="Indikator Terkait"
            count={indicators.length}
            size="lg"
          />
          <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2 lg:gap-3">
            {indicators.map((ind) => (
              <IndicatorRow key={ind.id} ind={ind} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// HERO — dark brand band with title, stats, composition donut + breakdown
// ──────────────────────────────────────────────────────────────────────────
function Hero({
  catCount,
  totalIndicators,
  composition,
  loading,
}: {
  catCount: number;
  totalIndicators: number;
  composition: TypeCounts;
  loading: boolean;
}) {
  return (
    <section
      className="relative -mx-4 overflow-hidden text-white md:-mx-6"
      style={{
        background:
          "linear-gradient(120deg, #161950 0%, #252dae 60%, #3641f5 100%)",
      }}
    >
      {/* brand-rail glow (defined globally in globals.css, respects reduce-motion) */}
      <div
        aria-hidden
        className="malika-rail-glow pointer-events-none absolute left-0 right-0 top-0 h-[2px]"
        style={{
          background:
            "linear-gradient(90deg, transparent, #7592ff 50%, transparent)",
        }}
      />
      {/* dot pattern + radial spotlight */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{
          backgroundImage:
            "radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
          maskImage:
            "radial-gradient(ellipse at top right, rgba(0,0,0,0.7), transparent 60%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at top right, rgba(0,0,0,0.7), transparent 60%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-20 h-[260px] w-[260px] rounded-full lg:h-[380px] lg:w-[380px]"
        style={{
          background:
            "radial-gradient(circle, rgba(149,178,255,0.32), transparent 60%)",
        }}
      />

      <div className="relative px-4 py-7 md:px-6 lg:px-11 lg:py-9">
        <div className="grid items-end gap-6 lg:grid-cols-[1.4fr_1fr] lg:gap-10">
          <div>
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.06em] text-brand-300 lg:text-xs">
              Katalog Data MALIKA
            </div>
            <h1 className="m-0 max-w-[560px] text-balance text-[26px] font-bold leading-[1.13] tracking-tight lg:text-[40px]">
              Jelajahi Data berdasarkan{" "}
              <span
                className="bg-clip-text text-transparent"
                style={{
                  backgroundImage:
                    "linear-gradient(120deg, #fff 0%, #c2d6ff 100%)",
                }}
              >
                Kategori
              </span>
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/75 lg:mt-4 lg:text-[15px]">
              {loading ? (
                <span className="inline-flex h-4 w-64 animate-pulse rounded bg-white/10" />
              ) : (
                <>
                  <strong className="font-bold text-white">
                    {catCount} kategori
                  </strong>{" "}
                  dengan{" "}
                  <strong className="font-bold text-white">
                    {nfmt(totalIndicators)} indikator
                  </strong>{" "}
                  tersedia, terdistribusi di empat jenis sumber data.
                </>
              )}
            </p>

            {/* mobile-only compact distribution */}
            <div className="mt-5 lg:hidden">
              {!loading && (
                <DistributionBar
                  counts={composition}
                  height={8}
                  showLegend
                  palette="dark"
                />
              )}
            </div>
          </div>

          {/* desktop summary panel: donut + per-type breakdown */}
          <div className="hidden rounded-2xl border border-white/10 bg-white/[0.07] p-5 backdrop-blur-md lg:block">
            <div className="mb-3 flex items-baseline justify-between">
              <div className="text-[11px] font-bold uppercase tracking-[0.05em] text-brand-300">
                Komposisi Sumber
              </div>
              <div className="text-[11px] text-white/60">
                {nfmt(totalIndicators)} indikator
              </div>
            </div>
            <DistributionBar
              counts={composition}
              height={10}
              palette="dark"
              showLegend={false}
            />
            <div className="mt-4 grid grid-cols-4 gap-2">
              {SOURCE_TYPES.map((t) => (
                <div
                  key={t}
                  className="rounded-lg bg-white/[0.06] px-2.5 py-2"
                >
                  <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-white/60">
                    {SOURCE_TYPE_LABEL[t]}
                  </div>
                  <div className="text-[18px] font-bold tabular-nums text-white">
                    {composition[t]}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// FEATURED CARD — large, color-tinted, "populer" badge, distribution bar
// ──────────────────────────────────────────────────────────────────────────
function FeaturedCard({ cat }: { cat: Category }) {
  const design = getCategoryDesign(cat.name);
  const tc = countByType(cat);
  const tintVars = {
    ["--cat-bg-light" as string]: design.light.bg,
    ["--cat-bg-dark" as string]: design.dark.bg,
    ["--cat-text-light" as string]: design.light.text,
    ["--cat-text-dark" as string]: design.dark.text,
    ["--cat-icon-light" as string]: design.light.icon,
    ["--cat-icon-dark" as string]: design.dark.icon,
    ["--cat-accent-light" as string]: design.light.accent,
    ["--cat-accent-dark" as string]: design.dark.icon,
  } as CSSProperties;

  return (
    <Link
      href={`/kategori/${cat.slug}`}
      style={tintVars}
      className="group relative flex min-h-[170px] flex-col gap-3 overflow-hidden rounded-2xl border border-black/[0.04] bg-[var(--cat-bg-light)] p-4 text-[color:var(--cat-text-light)] shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-all duration-200 hover:-translate-y-[3px] hover:shadow-[0_16px_40px_rgba(16,24,40,0.1)] dark:border-white/[0.04] dark:bg-[var(--cat-bg-dark)] dark:text-[color:var(--cat-text-dark)] dark:shadow-none lg:min-h-[200px] lg:p-5"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-12 h-[150px] w-[150px] rounded-full opacity-[0.13] dark:opacity-[0.18] lg:h-[180px] lg:w-[180px]"
        style={{ background: "var(--cat-accent-light)" }}
      />
      <div className="relative flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/70 dark:bg-white/[0.08] lg:h-12 lg:w-12">
          <span className="text-[color:var(--cat-icon-light)] dark:text-[color:var(--cat-icon-dark)]">
            {design.render(22, "currentColor")}
          </span>
        </div>
        <span className="ml-auto rounded-full bg-white/70 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.05em] dark:bg-white/[0.07]">
          Populer
        </span>
      </div>
      <div className="relative flex-1">
        <div className="text-balance text-[15px] font-bold leading-[1.25] tracking-tight lg:text-[17px]">
          {cat.name}
        </div>
      </div>
      <div className="relative flex items-baseline gap-1.5">
        <span className="text-[26px] font-bold tabular-nums tracking-tight lg:text-[32px]">
          {cat.count}
        </span>
        <span className="text-[11px] font-semibold opacity-65 lg:text-xs">
          indikator
        </span>
      </div>
      <div className="relative">
        <DistributionBar counts={tc} height={4} />
      </div>
    </Link>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// COMPACT CARD — for the secondary grid (Indeks-style row with bar)
// ──────────────────────────────────────────────────────────────────────────
function CompactCard({ cat }: { cat: Category }) {
  const design = getCategoryDesign(cat.name);
  const tc = countByType(cat);
  const typeCount = SOURCE_TYPES.filter((t) => tc[t] > 0).length;

  return (
    <Link
      href={`/kategori/${cat.slug}`}
      className="group flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3 transition-all duration-150 hover:-translate-y-[1px] hover:shadow-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700 lg:p-4"
      style={
        {
          ["--cat-bg-light" as string]: design.light.bg,
          ["--cat-bg-dark" as string]: design.dark.bg,
          ["--cat-icon-light" as string]: design.light.icon,
          ["--cat-icon-dark" as string]: design.dark.icon,
        } as CSSProperties
      }
    >
      <div
        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--cat-bg-light)] text-[color:var(--cat-icon-light)] dark:bg-[var(--cat-bg-dark)] dark:text-[color:var(--cat-icon-dark)] lg:h-11 lg:w-11"
      >
        {design.render(20, "currentColor")}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <div className="line-clamp-1 text-sm font-bold tracking-tight text-gray-900 dark:text-white/95 lg:text-[14px]">
            {cat.name}
          </div>
          <div className="text-sm font-bold tabular-nums text-gray-900 dark:text-white/95 lg:text-[14px]">
            {cat.count}
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2.5">
          <div className="min-w-0 flex-1">
            <DistributionBar counts={tc} height={4} />
          </div>
          <span className="whitespace-nowrap text-[10.5px] text-gray-400 dark:text-gray-500">
            {typeCount} jenis
          </span>
        </div>
      </div>
      <ChevronRightIcon
        size={16}
        className="hidden text-gray-400 transition-transform group-hover:translate-x-0.5 dark:text-gray-500 lg:block"
      />
    </Link>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// INDICATOR ROW — for search hits (when /api/search returns datasources)
// ──────────────────────────────────────────────────────────────────────────
function IndicatorRow({ ind }: { ind: Indicator }) {
  const href = ind.link || `/data?source_id=${ind.id}`;
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 transition-all duration-150 hover:-translate-y-[1px] hover:shadow-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
    >
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
        <ChartIcon size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-sm font-semibold leading-snug text-gray-900 transition-colors group-hover:text-brand-600 dark:text-white/95 dark:group-hover:text-brand-300">
          {ind.title || ind.name}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-gray-500 dark:text-gray-400">
          {ind.subtitle || ind.category || "Lainnya"}
        </div>
      </div>
      <TypeBadge type={(ind.type as SourceType) || "dynamic"} small />
      <ChevronRightIcon
        size={14}
        className="text-gray-400 transition-transform group-hover:translate-x-0.5 dark:text-gray-500"
      />
    </Link>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// LOADING SKELETON
// ──────────────────────────────────────────────────────────────────────────
function ListSkeleton() {
  return (
    <div className="space-y-6 pt-6 lg:pt-8">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-[170px] animate-pulse rounded-2xl border border-gray-200 bg-gray-100 dark:border-gray-800 dark:bg-gray-900 lg:h-[200px]"
          />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-3 lg:gap-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <div
            key={i}
            className="h-[68px] animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
          />
        ))}
      </div>
    </div>
  );
}
