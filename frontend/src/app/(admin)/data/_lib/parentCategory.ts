// Resolve the parent category for a given source_id by scanning the categories tree.
// Used during SSR in page.tsx so the hero can render a category chip + back link
// without a second client-side fetch.

import type { Category } from "../../kategori/_lib/types";

export type ParentCategory = {
  slug: string;
  name: string;
};

export async function fetchParentCategory(sourceId: number): Promise<ParentCategory | null> {
  const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:5000";
  try {
    const res = await fetch(`${backendUrl}/categories`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    const list: Category[] = data?.categories ?? [];
    for (const cat of list) {
      const hit = cat.sources?.find((s) => Number(s.id) === Number(sourceId));
      if (hit) return { slug: cat.slug, name: cat.name };
    }
    return null;
  } catch (err) {
    console.error("[/data] parent-category resolve error", err);
    return null;
  }
}
