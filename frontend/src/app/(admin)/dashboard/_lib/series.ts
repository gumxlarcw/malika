import type { Delta, TrendPoint } from "./types";

/** Shape of GET /dashboard/public/series (proxied via /api/dashboard/series). */
export type Series = {
  sourceId: number;
  name: string;
  metric: string | null;
  unit: string | null;
  decimalPlaces: number | null;
  points: TrendPoint[];
  delta: Delta | null;
};

export const MAX_SERIES_IDS = 8;

/**
 * Deeper trends than the summary carries, for the panels that need them.
 *
 * Returns [] rather than throwing: every panel that calls this already has an
 * empty state, and a failed side panel must not take the page down with it.
 */
export async function fetchSeries(ids: number[], limit = 12): Promise<Series[]> {
  const wanted = [...new Set(ids)].slice(0, MAX_SERIES_IDS);
  if (!wanted.length) return [];

  try {
    const qs = new URLSearchParams({ ids: wanted.join(","), limit: String(limit) });
    const res = await fetch(`/api/dashboard/series?${qs.toString()}`, { cache: "no-store" });
    if (!res.ok) return [];
    const body = (await res.json()) as { ok?: boolean; series?: Series[] };
    return body.ok && Array.isArray(body.series) ? body.series : [];
  } catch {
    return [];
  }
}
