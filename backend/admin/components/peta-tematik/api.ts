import { api } from '@/lib/axios';
import type {
  IndikatorList, YearsResponse, MetricsResponse, DataResponse, SummaryResponse,
} from './types';

export const QUERY_KEYS = {
  indikatorList: ['peta-tematik', 'indikator-list'] as const,
  years: (id: number) => ['peta-tematik', 'years', id] as const,
  metrics: (id: number) => ['peta-tematik', 'metrics', id] as const,
  data: (id: number, year: number, month: number | null, metric: string | null) =>
    ['peta-tematik', 'data', id, year, month, metric] as const,
  summary: (id: number, year: number, month: number | null, metric: string | null) =>
    ['peta-tematik', 'summary', id, year, month, metric] as const,
};

export async function fetchIndikatorList(): Promise<IndikatorList> {
  const { data } = await api.get('/peta-tematik/indikator-list');
  return { totalEligible: data.totalEligible, kategori: data.kategori };
}

export async function fetchYears(indikator: number): Promise<YearsResponse> {
  const { data } = await api.get('/peta-tematik/years', { params: { indikator } });
  return data;
}

export async function fetchMetrics(indikator: number): Promise<MetricsResponse> {
  const { data } = await api.get('/peta-tematik/metrics', { params: { indikator } });
  return data;
}

export async function fetchData(
  indikator: number, year: number, month: number | null, metric: string | null,
): Promise<DataResponse> {
  const { data } = await api.get('/peta-tematik/data', {
    params: { indikator, year, ...(month != null ? { month } : {}), ...(metric ? { metric } : {}) },
  });
  return data;
}

export async function fetchSummary(
  indikator: number, year: number, month: number | null, metric: string | null,
): Promise<SummaryResponse> {
  const { data } = await api.get('/peta-tematik/summary', {
    params: { indikator, year, ...(month != null ? { month } : {}), ...(metric ? { metric } : {}) },
  });
  return data;
}
