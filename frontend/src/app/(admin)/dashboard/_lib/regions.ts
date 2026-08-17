/**
 * Per-kabupaten/kota values, from the peta-tematik public endpoints.
 *
 * The dashboard summary is province-only by design — its province rule refuses
 * to synthesise a provincial figure from regional rows. The regional panels are
 * the other half of that split: they read the kabupaten/kota values directly,
 * from the service that already owns them, rather than teaching the summary a
 * second shape.
 */

export type RegionValue = { kdkab: string; nama_kab: string; value: number | null };

export type RegionSeries = {
  indikator: number;
  year: number;
  values: RegionValue[];
};

/** Only indicators in peta-tematik's eligible list resolve; the rest return []. */
export async function fetchRegionValues(indikator: number, year: number): Promise<RegionValue[]> {
  try {
    const qs = new URLSearchParams({ indikator: String(indikator), year: String(year) });
    const res = await fetch(`/api/peta-tematik/data?${qs.toString()}`, { cache: "no-store" });
    if (!res.ok) return [];
    const body = (await res.json()) as { ok?: boolean; data?: RegionValue[] };
    return body.ok && Array.isArray(body.data) ? body.data : [];
  } catch {
    return [];
  }
}

/**
 * Years that actually carry values, newest first.
 *
 * `years_empty` exists because a year can be listed and still hold nothing —
 * offering those in the period filter produces a blank map for no stated reason.
 */
export async function fetchRegionYears(indikator: number): Promise<number[]> {
  try {
    const qs = new URLSearchParams({ indikator: String(indikator) });
    const res = await fetch(`/api/peta-tematik/years?${qs.toString()}`, { cache: "no-store" });
    if (!res.ok) return [];
    const body = (await res.json()) as { ok?: boolean; years?: number[]; years_empty?: number[] };
    if (!body.ok || !Array.isArray(body.years)) return [];
    const empty = new Set(body.years_empty || []);
    return body.years.filter((y) => !empty.has(y)).sort((a, b) => b - a);
  } catch {
    return [];
  }
}

export type EligibleIndicator = { sourceId: number; sourceName: string; kategori: string };

/**
 * The indicators peta-tematik will actually serve region values for.
 *
 * Eligibility is the map service's own judgement — an indicator needs rows for
 * the kabupaten/kota dimension — and it is not derivable from the summary's
 * `shape`: TPT carries both a province row and regional rows, so it reports as
 * `province` while still being fully mappable. Asking the owning service keeps
 * the region filter honest as the replica gains tables.
 */
export async function fetchEligibleIndicators(): Promise<EligibleIndicator[]> {
  try {
    const res = await fetch("/api/peta-tematik/indikator-list", { cache: "no-store" });
    if (!res.ok) return [];
    const body = (await res.json()) as {
      ok?: boolean;
      kategori?: Record<string, Array<{ sourceId: number; sourceName: string }>>;
    };
    if (!body.ok || !body.kategori) return [];
    return Object.entries(body.kategori).flatMap(([kategori, items]) =>
      (items || []).map((it) => ({ sourceId: it.sourceId, sourceName: it.sourceName, kategori }))
    );
  } catch {
    return [];
  }
}

/** Highest first, dropping regions the source has no value for. */
export function rankRegions(values: RegionValue[]): Array<RegionValue & { value: number }> {
  return values
    .filter((v): v is RegionValue & { value: number } => v.value != null)
    .sort((a, b) => b.value - a.value);
}

/** "Halmahera Barat" → "Hal. Barat", so ten labels fit under ten bars. */
export function shortRegionName(name: string): string {
  return name
    .replace(/^Halmahera\s+/i, "Hal. ")
    .replace(/^Kepulauan\s+/i, "Kep. ")
    .replace(/^Pulau\s+/i, "P. ")
    .replace(/^Kota\s+/i, "");
}
