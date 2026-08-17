/**
 * Which indicators each panel shows.
 *
 * Nothing here is a hardcoded source id. The dashboard has to survive BPS
 * adding tables, renaming categories and rebasing indices, so every panel picks
 * its subject by querying the payload it was given. The one curated input is
 * the headline list, which an admin sets in /backend/dashboard-curation.
 */

import type { DashboardCategory, DashboardSummary, IndicatorCardData } from "./types";
import { tabForCategory, type TabKey } from "./tabs";

/** Categories a tab is responsible for. Ringkasan owns all of them. */
export function categoriesForTab(summary: DashboardSummary, tab: TabKey): DashboardCategory[] {
  if (tab === "ringkasan") return summary.categories;
  return summary.categories.filter((c) => tabForCategory(c.name) === tab);
}

/** Better cards first: a figure beats no figure, then depth of history. */
function byUsefulness(a: IndicatorCardData, b: IndicatorCardData): number {
  const figure = Number(Boolean(b.latest)) - Number(Boolean(a.latest));
  if (figure !== 0) return figure;
  const trend = b.trend.points.length - a.trend.points.length;
  if (trend !== 0) return trend;
  return b.periodCount - a.periodCount;
}

export const KPI_COUNT = 4;

/**
 * The four figures at the top of a tab.
 *
 * Curated headline indicators that belong to the tab come first — an admin
 * chose them, which beats any ranking — and the rest is filled from the tab's
 * own categories so a subject tab is never short of cards.
 */
export function kpisForTab(summary: DashboardSummary, tab: TabKey): IndicatorCardData[] {
  if (tab === "ringkasan") return summary.headline.slice(0, KPI_COUNT);

  const pool = categoriesForTab(summary, tab).flatMap((c) => c.indicators);
  const inTab = new Set(pool.map((c) => c.sourceId));
  const curated = summary.headline.filter((c) => inTab.has(c.sourceId));

  const chosen: IndicatorCardData[] = [];
  const taken = new Set<number>();
  for (const card of [...curated, ...pool.slice().sort(byUsefulness)]) {
    if (taken.has(card.sourceId)) continue;
    if (!card.latest) continue;
    chosen.push(card);
    taken.add(card.sourceId);
    if (chosen.length === KPI_COUNT) break;
  }
  return chosen;
}

/** The indicator the trend panel plots: the tab's strongest series. */
export function leadIndicator(kpis: IndicatorCardData[]): IndicatorCardData | null {
  const withTrend = kpis.filter((c) => c.trend.points.length > 1);
  return withTrend.length ? withTrend[0] : null;
}

/** A second, different indicator for the bar panel. */
export function barsIndicator(kpis: IndicatorCardData[], lead: IndicatorCardData | null): IndicatorCardData | null {
  const candidates = kpis.filter((c) => c.trend.points.length > 1 && c.sourceId !== lead?.sourceId);
  return candidates.length ? candidates[0] : null;
}

const BASE_YEAR = /\((\d{4})\s*=\s*100\)/;
const IS_INFLASI = /\binflasi\b/i;
const IS_PROVINCE = /provinsi|maluku utara/i;

/**
 * The rows of the inflation heat map: one IHK series per city, plus the province.
 *
 * MALIKA stores each IHK city in its own undimensioned table rather than one
 * table dimensioned by city, so the "rows" are separate indicators that have to
 * be recognised by name. They are grouped by index base — mixing a 2022=100
 * series with a 2012=100 one would put two different definitions of the same
 * month in adjacent cells — and only the newest base is kept.
 */
export function inflationSeriesIds(summary: DashboardSummary, max = 4): number[] {
  const all = [...summary.headline, ...summary.categories.flatMap((c) => c.indicators)];

  const byBase = new Map<number, IndicatorCardData[]>();
  const seen = new Set<number>();
  for (const card of all) {
    if (seen.has(card.sourceId) || !IS_INFLASI.test(card.name) || !card.latest) continue;
    const match = BASE_YEAR.exec(card.name);
    if (!match) continue;
    seen.add(card.sourceId);
    const base = Number(match[1]);
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base)!.push(card);
  }
  if (!byBase.size) return [];

  const newest = Math.max(...byBase.keys());
  const group = byBase.get(newest) || [];

  // Province first — it is the row a reader compares the cities against.
  const province = group.filter((c) => IS_PROVINCE.test(c.name));
  const cities = group.filter((c) => !IS_PROVINCE.test(c.name)).sort((a, b) => a.name.localeCompare(b.name, "id"));
  return [...province, ...cities].slice(0, max).map((c) => c.sourceId);
}

/** "Inflasi Kota Ternate (2022=100)" → "Kota Ternate". */
export function inflationRowLabel(name: string): string {
  return name.replace(BASE_YEAR, "").replace(IS_INFLASI, "").replace(/\s+/g, " ").trim() || name;
}
