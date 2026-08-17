/** Shape of GET /dashboard/public/summary (backend services/dashboard). */

export type CardShape = "province" | "regional" | "dimensional";

export type TrendPoint = {
  year: number;
  month_no: number;
  periodLabel: string;
  value: number;
};

export type Delta = {
  absolute: number;
  previousValue: number;
  previousLabel: string;
};

export type LatestValue = {
  value: number;
  year: number;
  month_no: number;
  periodLabel: string;
  scope: "province";
};

export type IndicatorCardData = {
  sourceId: number;
  name: string;
  category: string;
  icon: string | null;
  color: string | null;
  metric: string | null;
  unit: string | null;
  /** Present in the payload but deliberately never applied — see the spec. */
  unitMultiplier: number | null;
  decimalPlaces: number | null;
  periodCount: number;
  dimKey: string | null;
  shape: CardShape;
  latest: LatestValue | null;
  trend: { points: TrendPoint[]; delta: Delta | null };
  error: boolean;
};

export type DashboardCategory = {
  name: string;
  indicators: IndicatorCardData[];
};

export type DashboardSummary = {
  ok: boolean;
  headline: IndicatorCardData[];
  categories: DashboardCategory[];
  generatedAt: string;
};
