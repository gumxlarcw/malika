export interface IndikatorItem {
  sourceId: number;
  sourceName: string;
  tableName: string;
}

export interface IndikatorList {
  totalEligible: number;
  kategori: Record<string, IndikatorItem[]>;
}

export interface YearsResponse {
  ok: boolean;
  years: number[];
  has_monthly: boolean;
}

export interface MetricsResponse {
  ok: boolean;
  metrics: string[];
}

export interface DataPoint {
  kdkab: string;
  nama_kab: string;
  value: number | null;
}

export interface DataResponse {
  ok: boolean;
  data: DataPoint[];
}

export interface SummaryResponse {
  ok: boolean;
  provinsi_total: number | null;
  top3: { nama_kab: string; value: number }[];
  bottom3: { nama_kab: string; value: number }[];
  trend: { year: number; provinsi_total: number | null }[];
}

export interface FilterState {
  indikator: number | null;
  year: number | null;
  month: number | null;
  metric: string | null;
}
