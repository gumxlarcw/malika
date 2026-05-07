"use client";

import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { getCategoryStyle } from "@/lib/categoryStyles";

type CategorySource = {
  id: number;
  name: string;
  type: string;
};

type Category = {
  name: string;
  count: number;
  slug: string;
  sources: CategorySource[];
};

type Indicator = {
  id: number;
  name: string;
  title?: string;  // API search returns title
  type: string;
  category: string;
  score: number;
  subtitle?: string;
  link?: string;
};

type SortOption = "count" | "name";

function CategoryCardSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800" />
        <div className="flex-1 min-w-0">
          <div className="h-4 w-3/4 rounded bg-gray-200 dark:bg-gray-700" />
          <div className="mt-2 h-3 w-1/4 rounded bg-gray-100 dark:bg-gray-800" />
        </div>
      </div>
    </div>
  );
}

function CategoryCard({ category }: { category: Category }) {
  const style = getCategoryStyle(category.name);

  return (
    <Link
      href={`/kategori/${category.slug}`}
      className="group block rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs transition-all duration-200 hover:scale-[1.02] hover:shadow-lg dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="flex items-start gap-4">
        {/* Icon container */}
        <div
          className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl ${style.bgColor} transition-transform duration-200 group-hover:scale-110`}
        >
          <span className="text-2xl" role="img" aria-hidden="true">
            {style.icon}
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-gray-800 line-clamp-2 dark:text-white/90 group-hover:text-brand-600 dark:group-hover:text-brand-400">
            {category.name}
          </h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {category.count} {category.count === 1 ? "indikator" : "indikator"}
          </p>
        </div>

        {/* Arrow on hover */}
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <svg
            className="h-5 w-5 text-gray-400 dark:text-gray-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 5l7 7-7 7"
            />
          </svg>
        </div>
      </div>
    </Link>
  );
}

function IndicatorCard({ indicator }: { indicator: Indicator }) {
  const typeLabel =
    indicator.type === "exim"
      ? "EXIM"
      : indicator.type === "dynamic"
        ? "Dinamis"
        : indicator.type === "interop"
          ? "Interop"
          : indicator.type === "static"
            ? "Statis"
            : indicator.type;

  const typeBadgeClass =
    indicator.type === "exim"
      ? "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400"
      : indicator.type === "dynamic"
        ? "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400"
        : indicator.type === "interop"
          ? "bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400"
          : "bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-400";

  // Gunakan link dari API search jika tersedia, fallback ke source_id
  const href = indicator.link || `/data?source_id=${indicator.id}`;
  
  return (
    <Link
      href={href}
      className="group flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4 transition-all duration-200 hover:border-brand-200 hover:bg-brand-50/50 hover:shadow-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-brand-800 dark:hover:bg-brand-500/5"
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-600 dark:bg-brand-500/20 dark:text-brand-400">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-gray-800 truncate group-hover:text-brand-600 dark:text-white/90 dark:group-hover:text-brand-400">
            {indicator.name}
          </span>
          <span className="block text-xs text-gray-500 dark:text-gray-400 truncate">
            {indicator.category || "Lainnya"}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0 ml-2">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${typeBadgeClass}`}>
          {typeLabel}
        </span>
        <svg
          className="h-5 w-5 text-gray-400 transition-transform duration-200 group-hover:translate-x-1 dark:text-gray-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </Link>
  );
}

function IndicatorCardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-gray-200 dark:bg-gray-700" />
        <div className="flex-1 min-w-0">
          <div className="h-4 w-3/4 rounded bg-gray-200 dark:bg-gray-700" />
          <div className="mt-1.5 h-3 w-1/3 rounded bg-gray-100 dark:bg-gray-800" />
        </div>
      </div>
    </div>
  );
}

export default function KategoriPageClient() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [indicators, setIndicators] = useState<Indicator[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingIndicators, setLoadingIndicators] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("count");

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const res = await fetch("/api/categories", { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to fetch categories");
        const data = await res.json();
        setCategories(data.categories || []);
      } catch (err) {
        console.error(err);
        setError("Gagal memuat kategori. Silakan coba lagi.");
      } finally {
        setLoading(false);
      }
    };

    fetchCategories();
  }, []);

  // Search indicators with debounce
  useEffect(() => {
    if (!search.trim()) {
      setIndicators([]);
      setLoadingIndicators(false);
      return;
    }

    // Set loading segera saat user mengetik
    setLoadingIndicators(true);

    const timeoutId = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(search)}&limit=20`
        );
        if (res.ok) {
          const data = await res.json();
          // Gabungkan exact dan suggestions datasources
          const exactDs = data.exact?.datasources || [];
          const suggestDs = data.suggestions?.datasources || [];
          // Dedupe by id, prioritize exact
          const seen = new Set<number>();
          const merged: Indicator[] = [];
          for (const ds of [...exactDs, ...suggestDs]) {
            if (!seen.has(ds.id)) {
              seen.add(ds.id);
              // Map to Indicator format
              merged.push({
                id: ds.id,
                name: ds.title || '',
                title: ds.title,
                type: inferTypeFromLink(ds.link),
                category: ds.subtitle || '',
                score: ds.score || 0,
                subtitle: ds.subtitle,
                link: ds.link,
              });
            }
          }
          setIndicators(merged.slice(0, 20));
        }
      } catch (err) {
        console.error("Error searching indicators:", err);
      } finally {
        setLoadingIndicators(false);
      }
    }, 200);  // Reduced from 300ms for faster response

    return () => clearTimeout(timeoutId);
  }, [search]);

  // Helper to infer type from link
  function inferTypeFromLink(link: string): string {
    if (!link) return 'dynamic';
    if (link.includes('type=exim')) return 'exim';
    if (link.includes('type=interop')) return 'interop';
    if (link.includes('type=static')) return 'static';
    return 'dynamic';
  }

  const filteredCategories = useMemo(() => {
    let result = categories;

    // Filter by search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => c.name.toLowerCase().includes(q));
    }

    // Sort
    if (sortBy === "name") {
      result = [...result].sort((a, b) => a.name.localeCompare(b.name));
    } else {
      result = [...result].sort((a, b) => b.count - a.count);
    }

    return result;
  }, [categories, search, sortBy]);

  const totalIndicators = useMemo(
    () => categories.reduce((sum, c) => sum + c.count, 0),
    [categories]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
          Jelajahi Data berdasarkan Kategori
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {loading
            ? "Memuat..."
            : `${categories.length} kategori dengan ${totalIndicators} indikator tersedia`}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <svg
              className="h-5 w-5 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
          </span>
          <input
            type="text"
            placeholder="Cari kategori atau indikator..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-11 w-full rounded-lg border border-gray-200 bg-white py-2 pl-10 pr-4 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-none focus:ring-3 focus:ring-brand-500/10 dark:border-gray-800 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-gray-500 dark:focus:border-brand-800"
          />
        </div>

        {/* Sort */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Urutkan:
          </span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 focus:border-brand-300 focus:outline-none focus:ring-3 focus:ring-brand-500/10 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
          >
            <option value="count">Jumlah Terbanyak</option>
            <option value="name">Abjad</option>
          </select>
        </div>
      </div>

      {/* Grid / Dual Section */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <CategoryCardSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center dark:border-gray-800 dark:bg-gray-900">
          <p className="text-sm text-gray-500 dark:text-gray-400">{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 inline-flex items-center justify-center rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600"
          >
            Coba Lagi
          </button>
        </div>
      ) : search.trim() !== "" ? (
        // Dual section when searching
        <div className="space-y-8">
          {(() => {
            const hasIndicators = indicators.length > 0;
            const hasCategories = filteredCategories.length > 0;
            
            // Hitung average score indikator (higher score = more relevant)
            const avgIndicatorScore = hasIndicators
              ? indicators.reduce((sum, ind) => sum + (ind.score || 0), 0) / indicators.length
              : 0;
            
            // Simple scoring untuk kategori match (1 = ada match, 0 = tidak)
            const categoryMatchScore = hasCategories ? 1 : 0;
            
            // Tampilkan indikator dulu jika score lebih tinggi
            const showIndicatorsFirst = avgIndicatorScore > categoryMatchScore;
            
            const indicatorSection = (
              <div key="indicators">
                <div className="mb-4 flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
                    📊 Indikator
                  </h2>
                  <span className="rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-500/20 dark:text-brand-400">
                    {indicators.length}
                  </span>
                </div>
                {loadingIndicators ? (
                  <div className="space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <IndicatorCardSkeleton key={i} />
                    ))}
                  </div>
                ) : indicators.length > 0 ? (
                  <div className="space-y-3">
                    {indicators.map((indicator) => (
                      <IndicatorCard key={indicator.id} indicator={indicator} />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Tidak ada indikator yang cocok
                  </p>
                )}
              </div>
            );
            
            const categorySection = (
              <div key="categories">
                <div className="mb-4 flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
                    📁 Kategori
                  </h2>
                  <span className="rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-500/20 dark:text-brand-400">
                    {filteredCategories.length}
                  </span>
                </div>
                {filteredCategories.length > 0 ? (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {filteredCategories.map((category) => (
                      <CategoryCard key={category.slug} category={category} />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Tidak ada kategori yang cocok
                  </p>
                )}
              </div>
            );
            
            // Return sections dengan urutan dinamis
            // Jika masih loading, tampilkan skeleton
            if (loadingIndicators) {
              return (
                <>
                  <div key="indicators-loading">
                    <div className="mb-4 flex items-center gap-2">
                      <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
                        📊 Indikator
                      </h2>
                      <span className="animate-pulse rounded-full bg-gray-200 px-4 py-0.5 text-xs dark:bg-gray-700">&nbsp;</span>
                    </div>
                    <div className="space-y-3">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <IndicatorCardSkeleton key={i} />
                      ))}
                    </div>
                  </div>
                  {hasCategories && categorySection}
                </>
              );
            }
            
            if (!hasIndicators && !hasCategories) {
              return (
                <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center dark:border-gray-800 dark:bg-gray-900">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Tidak ditemukan indikator atau kategori dengan kata kunci &quot;{search}&quot;
                  </p>
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="mt-4 inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    Hapus Filter
                  </button>
                </div>
              );
            }
            
            if (showIndicatorsFirst) {
              return (
                <>
                  {hasIndicators && indicatorSection}
                  {hasCategories && categorySection}
                </>
              );
            } else {
              return (
                <>
                  {hasCategories && categorySection}
                  {hasIndicators && indicatorSection}
                </>
              );
            }
          })()}
        </div>
      ) : filteredCategories.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center dark:border-gray-800 dark:bg-gray-900">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Tidak ada kategori tersedia.
          </p>
        </div>
      ) : (
        // Default view: hanya kategori
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredCategories.map((category) => (
            <CategoryCard key={category.slug} category={category} />
          ))}
        </div>
      )}
    </div>
  );
}
