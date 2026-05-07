export interface IndikatorItem {
  sourceId: number;
  sourceName: string;
  tableName: string;
}

export interface IndikatorList {
  ok?: boolean;
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

export interface IndikatorMeta {
  source_id: number;
  source_type: "static" | "dynamic" | "interop" | "exim";
  title_id_html: string | null;
  title_clean: string | null;
  subject_label: string | null;
  bab: string | null;
  responsible_party: string | null;
  source_citation_html: string | null;
  bps_last_update: string | null;
  bps_table_id: string | null;
  unit: string | null;
  unit_multiplier: number | null;
  unit_multiplier_desc: string | null;
  decimal_places: number;
  data_legend: Record<string, string> | null;
  metric: {
    metric_key: string;
    label_id: string | null;
    label_en: string | null;
    metric_type: string;
    definition: string | null;
    notes: string | null;
    formula_html: string | null;
  } | null;
}

export interface DataResponse {
  ok: boolean;
  data: DataPoint[];
  meta?: IndikatorMeta | null;
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
