"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import IndikatorPicker from "./IndikatorPicker";
import { fetchYears, fetchMetrics, QUERY_KEYS } from "./api";
import type { IndikatorList, FilterState } from "./types";

interface Props {
  list: IndikatorList;
  filters: FilterState;
  setFilters: (updater: (prev: FilterState) => FilterState) => void;
}

const MONTH_NAMES = [
  "", "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

export default function FilterBar({ list, filters, setFilters }: Props) {
  const yearsQuery = useQuery({
    queryKey: QUERY_KEYS.years(filters.indikator!),
    queryFn: () => fetchYears(filters.indikator!),
    enabled: !!filters.indikator,
    staleTime: 60 * 60 * 1000,
  });

  const metricsQuery = useQuery({
    queryKey: QUERY_KEYS.metrics(filters.indikator!),
    queryFn: () => fetchMetrics(filters.indikator!),
    enabled: !!filters.indikator,
    staleTime: 60 * 60 * 1000,
  });

  // Set default year + month + metric once data arrives
  useEffect(() => {
    if (!yearsQuery.data || filters.year != null) return;
    const years = yearsQuery.data.years;
    if (years.length === 0) return;
    const latestYear = years[years.length - 1];
    setFilters(f => ({
      ...f,
      year: latestYear,
      month: yearsQuery.data!.has_monthly ? 12 : null,
    }));
  }, [yearsQuery.data, filters.year, setFilters]);

  useEffect(() => {
    if (!metricsQuery.data || filters.metric != null) return;
    const metrics = metricsQuery.data.metrics;
    if (metrics.length === 0) return;
    const preferred = metrics.includes("value") ? "value" : metrics[0];
    setFilters(f => ({ ...f, metric: preferred }));
  }, [metricsQuery.data, filters.metric, setFilters]);

  const hasMonthly = yearsQuery.data?.has_monthly === true;
  const showMetricSelect = (metricsQuery.data?.metrics.length ?? 0) > 1;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <IndikatorPicker
        list={list}
        value={filters.indikator}
        onChange={(id) => setFilters(f => ({
          ...f, indikator: id, year: null, month: null, metric: null,
        }))}
      />

      {filters.indikator && yearsQuery.data && (
        <select
          value={filters.year ?? ""}
          onChange={(e) => setFilters(f => ({ ...f, year: Number(e.target.value) }))}
          className="px-3 py-2 rounded-lg border border-border bg-background text-sm"
        >
          <option value="" disabled>Tahun…</option>
          {yearsQuery.data.years.map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      )}

      {hasMonthly && filters.year && (
        <select
          value={filters.month ?? ""}
          onChange={(e) => setFilters(f => ({ ...f, month: Number(e.target.value) }))}
          className="px-3 py-2 rounded-lg border border-border bg-background text-sm"
        >
          <option value="" disabled>Bulan…</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
            <option key={m} value={m}>{MONTH_NAMES[m]}</option>
          ))}
        </select>
      )}

      {showMetricSelect && (
        <select
          value={filters.metric ?? ""}
          onChange={(e) => setFilters(f => ({ ...f, metric: e.target.value }))}
          className="px-3 py-2 rounded-lg border border-border bg-background text-sm"
        >
          {metricsQuery.data!.metrics.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      )}
    </div>
  );
}
