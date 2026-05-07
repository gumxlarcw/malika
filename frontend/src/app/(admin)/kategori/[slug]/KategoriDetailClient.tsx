"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
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

function DatasourceCard({ source }: { source: CategorySource }) {
  const typeLabel =
    source.type === "exim"
      ? "EXIM"
      : source.type === "dynamic"
        ? "Dinamis"
        : source.type === "interop"
          ? "Interop"
          : source.type === "static"
            ? "Statis"
            : source.type;

  const typeBadgeClass =
    source.type === "exim"
      ? "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400"
      : source.type === "dynamic"
        ? "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400"
        : "bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-400";

  return (
    <Link
      href={`/data?source_id=${source.id}`}
      className="group flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4 transition-all duration-200 hover:border-brand-200 hover:bg-brand-50/50 hover:shadow-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-brand-800 dark:hover:bg-brand-500/5"
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0112 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m8.625-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M12 10.875v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125M13.125 12h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125M20.625 12c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5M12 14.625v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 14.625c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125m0 1.5v-1.5m0 0c0-.621.504-1.125 1.125-1.125m0 0h7.5" />
          </svg>
        </div>
        <span className="text-sm font-medium text-gray-800 truncate group-hover:text-brand-600 dark:text-white/90 dark:group-hover:text-brand-400">
          {source.name}
        </span>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
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

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-gray-200 dark:bg-gray-700" />
        <div className="h-4 w-2/3 rounded bg-gray-200 dark:bg-gray-700" />
      </div>
    </div>
  );
}

export default function KategoriDetailClient() {
  const params = useParams();
  const slug = typeof params.slug === "string" ? params.slug : "";
  
  const [category, setCategory] = useState<Category | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const fetchCategory = async () => {
      try {
        const res = await fetch("/api/categories", { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to fetch categories");
        const data = await res.json();
        const categories: Category[] = data.categories || [];
        const found = categories.find((c) => c.slug === slug);
        if (!found) {
          setError("Kategori tidak ditemukan.");
        } else {
          setCategory(found);
        }
      } catch (err) {
        console.error(err);
        setError("Gagal memuat data. Silakan coba lagi.");
      } finally {
        setLoading(false);
      }
    };

    if (slug) {
      fetchCategory();
    }
  }, [slug]);

  const filteredSources = useMemo(() => {
    if (!category) return [];
    if (!search.trim()) return category.sources;
    const q = search.toLowerCase();
    return category.sources.filter((s) => s.name.toLowerCase().includes(q));
  }, [category, search]);

  const style = category ? getCategoryStyle(category.name) : null;

  if (loading) {
    return (
      <div className="space-y-6">
        {/* Breadcrumb skeleton */}
        <div className="flex items-center gap-2">
          <div className="h-4 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          <span className="text-gray-300">/</span>
          <div className="h-4 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        </div>
        {/* Header skeleton */}
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700" />
          <div>
            <div className="h-6 w-48 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            <div className="mt-2 h-4 w-24 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
          </div>
        </div>
        {/* List skeleton */}
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (error || !category) {
    return (
      <div className="space-y-6">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm">
          <Link href="/" className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            Beranda
          </Link>
          <span className="text-gray-300 dark:text-gray-600">/</span>
          <Link href="/kategori" className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            Kategori
          </Link>
        </nav>

        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center dark:border-gray-800 dark:bg-gray-900">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {error || "Kategori tidak ditemukan."}
          </p>
          <Link
            href="/kategori"
            className="mt-4 inline-flex items-center justify-center rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600"
          >
            Kembali ke Daftar Kategori
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm">
        <Link href="/" className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
          Beranda
        </Link>
        <span className="text-gray-300 dark:text-gray-600">/</span>
        <Link href="/kategori" className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
          Kategori
        </Link>
        <span className="text-gray-300 dark:text-gray-600">/</span>
        <span className="font-medium text-gray-800 dark:text-white/90 truncate max-w-[200px]">
          {category.name}
        </span>
      </nav>

      {/* Header */}
      <div className="flex items-start gap-4">
        {style && (
          <div
            className={`flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl ${style.bgColor}`}
          >
            <span className="text-3xl" role="img" aria-hidden="true">
              {style.icon}
            </span>
          </div>
        )}
        <div>
          <h1 className="text-xl font-semibold text-gray-800 dark:text-white/90 sm:text-2xl">
            {category.name}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {category.count} indikator tersedia
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
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
          placeholder="Cari indikator..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-11 w-full rounded-lg border border-gray-200 bg-white py-2 pl-10 pr-4 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-none focus:ring-3 focus:ring-brand-500/10 dark:border-gray-800 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-gray-500 dark:focus:border-brand-800"
        />
      </div>

      {/* List */}
      {filteredSources.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center dark:border-gray-800 dark:bg-gray-900">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {search
              ? `Tidak ditemukan indikator dengan kata kunci "${search}"`
              : "Tidak ada indikator dalam kategori ini."}
          </p>
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="mt-4 inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Hapus Filter
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredSources.map((source) => (
            <DatasourceCard key={source.id} source={source} />
          ))}
        </div>
      )}
    </div>
  );
}
