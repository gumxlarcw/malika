import React from "react";
import { notFound } from "next/navigation";
import KategoriDetailClient from "./KategoriDetailClient";
import type { Category } from "../_lib/types";

// Required so notFound() returns a real 404 status under Next 16's PPR/cache model.
// Without this, the route can be statically optimized and notFound() body is served with 200.
export const dynamic = "force-dynamic";

async function fetchCategoryBySlug(slug: string): Promise<Category | null> {
  const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:5000";
  try {
    const res = await fetch(`${backendUrl}/categories`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    const list: Category[] = data?.categories ?? [];
    return list.find((c) => c.slug === slug) ?? null;
  } catch (err) {
    console.error("[/kategori/[slug]] fetch error", err);
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const title = slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return {
    title: `${title} | Kategori Data`,
    description: `Data statistik kategori ${title} - Maluku Utara dalam Angka`,
  };
}

export default async function KategoriDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const category = await fetchCategoryBySlug(slug);
  if (!category) notFound();
  return <KategoriDetailClient category={category} />;
}
