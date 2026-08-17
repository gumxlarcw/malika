"use client";

import { useEffect, useState } from "react";
import { kdkabToKode } from "@/lib/malutGeometry";
import { buildMatrix, type RegionValue, type YearMatrix } from "./panelData";

/**
 * Every region's value for several years at once.
 *
 * `/peta-tematik/public/data` answers one year per call, and the panels that
 * compare periods — the small multiples, the year matrix, the sparkline — need
 * all of them together. Requests fan out in parallel.
 *
 * Two things this deliberately does not do. It does not depend on the `years`
 * array's identity: an unmemoised literal from the caller would change every
 * render and drive an endless fetch loop, so the request is keyed by a joined
 * string instead. And it does not store a loading flag — that is derived from
 * whether the stored result matches the current key, which also means a slow
 * response for a previous indicator can never be read as the current one's.
 */
export function useYearMatrix(indikator: number | null, years: number[], metric?: string | null) {
  const yearsKey = years.join(",");
  const key = indikator == null || !yearsKey ? "" : `${indikator}|${yearsKey}|${metric ?? ""}`;

  const [resolved, setResolved] = useState<{ key: string; matrix: YearMatrix } | null>(null);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const ys = yearsKey.split(",").map(Number);

    Promise.all(
      ys.map(async (year) => {
        try {
          const qs = new URLSearchParams({ indikator: String(indikator), year: String(year) });
          if (metric) qs.set("metric", metric);
          const res = await fetch(`/api/peta-tematik/data?${qs.toString()}`, { cache: "no-store" });
          if (!res.ok) return [] as RegionValue[];
          const body = (await res.json()) as { ok?: boolean; data?: RegionValue[] };
          return body.ok && Array.isArray(body.data) ? body.data : ([] as RegionValue[]);
        } catch {
          // One unreadable year leaves a gap in that column, not an empty panel.
          return [] as RegionValue[];
        }
      })
    ).then((byYear) => {
      if (!cancelled) setResolved({ key, matrix: buildMatrix(ys, byYear, kdkabToKode) });
    });

    return () => {
      cancelled = true;
    };
  }, [key, yearsKey, indikator, metric]);

  const ready = resolved != null && resolved.key === key;
  return {
    matrix: ready ? resolved.matrix : null,
    loading: Boolean(key) && !ready,
  };
}
