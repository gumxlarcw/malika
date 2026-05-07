"use client";

import { useQuery } from "@tanstack/react-query";
import ProvinsiTotalCard from "./ProvinsiTotalCard";
import TopBottomList from "./TopBottomList";
import TrendSparkline from "./TrendSparkline";
import { fetchSummary, QUERY_KEYS } from "./api";
import type { FilterState } from "./types";

interface Props {
  filters: FilterState;
}

export default function InfoPanel({ filters }: Props) {
  const summaryQuery = useQuery({
    queryKey: QUERY_KEYS.summary(filters.indikator!, filters.year!, filters.month, filters.metric),
    queryFn: () => fetchSummary(filters.indikator!, filters.year!, filters.month, filters.metric),
    enabled: !!filters.indikator && !!filters.year,
    staleTime: 60 * 60 * 1000,
  });

  if (summaryQuery.isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-20 bg-gray-100 animate-pulse rounded-lg" />
        <div className="h-32 bg-gray-100 animate-pulse rounded-lg" />
        <div className="h-24 bg-gray-100 animate-pulse rounded-lg" />
      </div>
    );
  }

  if (summaryQuery.isError || !summaryQuery.data) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
        Panel info gagal dimuat.
      </div>
    );
  }

  const s = summaryQuery.data;
  const prevTotal = s.trend.length >= 2
    ? s.trend[s.trend.length - 2].provinsi_total : null;

  return (
    <div className="space-y-3">
      <ProvinsiTotalCard
        total={s.provinsi_total}
        year={filters.year!}
        prevTotal={prevTotal}
      />
      <TopBottomList top3={s.top3} bottom3={s.bottom3} />
      <TrendSparkline points={s.trend} />
    </div>
  );
}
