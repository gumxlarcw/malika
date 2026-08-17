"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { BORDER, SURFACE, TEXT, TEXT_4 } from "@/lib/surfaceTokens";
import { DashboardChrome } from "./DashboardChrome";
import { FilterRow } from "./FilterRow";
import { KpiCard } from "./KpiCard";
import { TrendCard } from "./TrendCard";
import { BarsCard } from "./BarsCard";
import { HeatCard } from "./HeatCard";
import { RankCard } from "./RankCard";
import { RegionProfileCard } from "./RegionProfileCard";
import { RegionTable, type RegionColumn } from "./RegionTable";
import { IndicatorIndex } from "./IndicatorIndex";
import { DetailModal, type DetailTable } from "./DetailModal";
import { Toast } from "./Toast";
import { formatValue } from "../_lib/format";
import { fetchSeries, type Series } from "../_lib/series";
import {
  fetchEligibleIndicators,
  fetchRegionValues,
  fetchRegionYears,
  rankRegions,
  type EligibleIndicator,
} from "../_lib/regions";
import { barsIndicator, categoriesForTab, inflationSeriesIds, kpisForTab, leadIndicator } from "../_lib/select";
import type { TabKey } from "../_lib/tabs";
import type { DashboardSummary, IndicatorCardData } from "../_lib/types";

const MAX_REGION_COLUMNS = 4;
const HEAT_TABS: TabKey[] = ["ringkasan", "ekonomi"];

export default function DashboardClient({ summary }: { summary: DashboardSummary | null }) {
  const router = useRouter();

  const [tab, setTab] = useState<TabKey>("ringkasan");
  const [region, setRegion] = useState<string | null>(null);
  const [pickedIndicator, setPickedIndicator] = useState<number | null>(null);
  const [pickedYear, setPickedYear] = useState<number | null>(null);
  const [detail, setDetail] = useState<DetailTable | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [eligible, setEligible] = useState<EligibleIndicator[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [inflation, setInflation] = useState<Series[]>([]);
  /*
   * Region values are stored with the query that produced them. Reading them
   * back only on an exact key match means a pending fetch shows no columns
   * rather than the previous year's columns under the new year's heading —
   * stale figures under a fresh label are worse than an empty panel.
   */
  const [fetchedColumns, setFetchedColumns] = useState<{ key: string; columns: RegionColumn[] }>({
    key: "",
    columns: [],
  });

  const kpis = useMemo(() => (summary ? kpisForTab(summary, tab) : []), [summary, tab]);
  const categories = useMemo(() => (summary ? categoriesForTab(summary, tab) : []), [summary, tab]);
  const lead = useMemo(() => leadIndicator(kpis), [kpis]);
  const bars = useMemo(() => barsIndicator(kpis, lead), [kpis, lead]);

  const eligibleIds = useMemo(() => new Set(eligible.map((e) => e.sourceId)), [eligible]);

  /*
   * Filter state is derived, not synchronised. Storing "the current year" in an
   * effect that watches the available years means a render where the two
   * disagree — a year the new indicator does not publish, briefly querying for
   * an empty map. Falling back during render keeps them consistent by
   * construction, and the user's pick survives as long as it stays valid.
   */
  const defaultIndicator = useMemo(() => {
    const fromTab = kpis.find((c) => eligibleIds.has(c.sourceId));
    return fromTab?.sourceId ?? eligible[0]?.sourceId ?? null;
  }, [kpis, eligible, eligibleIds]);

  const indicator = pickedIndicator != null && eligibleIds.has(pickedIndicator) ? pickedIndicator : defaultIndicator;
  const year = pickedYear != null && years.includes(pickedYear) ? pickedYear : (years[0] ?? null);

  const columnIds = useMemo(() => {
    const ids: number[] = [];
    for (const card of kpis) if (eligibleIds.has(card.sourceId)) ids.push(card.sourceId);
    if (indicator != null && !ids.includes(indicator)) ids.unshift(indicator);
    return ids.slice(0, MAX_REGION_COLUMNS);
  }, [kpis, eligibleIds, indicator]);
  const columnKey = columnIds.join(",");

  /** Clean names and decimal places come from the summary where it knows the indicator. */
  const describe = useCallback(
    (id: number) => {
      const all = summary ? [...summary.headline, ...summary.categories.flatMap((c) => c.indicators)] : [];
      const card = all.find((c) => c.sourceId === id);
      return {
        name: card?.name ?? eligible.find((e) => e.sourceId === id)?.sourceName ?? `Indikator ${id}`,
        decimalPlaces: card?.decimalPlaces ?? 2,
      };
    },
    [summary, eligible]
  );

  useEffect(() => {
    let cancelled = false;
    fetchEligibleIndicators().then((list) => {
      if (!cancelled) setEligible(list.sort((a, b) => a.sourceName.localeCompare(b.sourceName, "id")));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (indicator == null) return;
    let cancelled = false;
    fetchRegionYears(indicator).then((list) => {
      if (!cancelled) setYears(list);
    });
    return () => {
      cancelled = true;
    };
  }, [indicator]);

  const columnsKey = `${year ?? ""}|${columnKey}`;
  const regionColumns = fetchedColumns.key === columnsKey ? fetchedColumns.columns : [];

  useEffect(() => {
    if (year == null || !columnKey) return;
    let cancelled = false;
    const ids = columnKey.split(",").map(Number);
    Promise.all(
      ids.map(async (id) => ({ sourceId: id, ...describe(id), values: await fetchRegionValues(id, year) }))
    ).then((cols) => {
      // A column with no values at all is dropped: an all-dash column tells the
      // reader nothing except that the page tried.
      if (!cancelled) {
        setFetchedColumns({ key: columnsKey, columns: cols.filter((c) => c.values.some((v) => v.value != null)) });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [year, columnKey, columnsKey, describe]);

  const inflationIds = useMemo(() => (summary ? inflationSeriesIds(summary) : []), [summary]);
  const showHeat = HEAT_TABS.includes(tab) && inflationIds.length > 0;
  const inflationKey = inflationIds.join(",");

  useEffect(() => {
    if (!showHeat || !inflationKey) return;
    let cancelled = false;
    fetchSeries(inflationKey.split(",").map(Number), 12).then((s) => {
      if (!cancelled) setInflation(s);
    });
    return () => {
      cancelled = true;
    };
  }, [showHeat, inflationKey]);

  const openCardDetail = useCallback((card: IndicatorCardData) => {
    const points = card.trend.points;
    setDetail({
      title: card.name,
      subtitle: `${points.length} periode terakhir · Badan Pusat Statistik`,
      columns: ["Periode", "Nilai", "Perubahan"],
      rows: points
        .slice()
        .reverse()
        .map((p, i, arr) => {
          const prev = arr[i + 1];
          return {
            a: p.periodLabel,
            b: formatValue(p.value, card.decimalPlaces),
            c: prev ? `${p.value - prev.value > 0 ? "+" : ""}${formatValue(p.value - prev.value, card.decimalPlaces)}` : "—",
          };
        }),
    });
  }, []);

  const openRankDetail = useCallback((column: RegionColumn, forYear: number | null) => {
    const ranked = rankRegions(column.values);
    setDetail({
      title: column.name,
      subtitle: `Per kabupaten/kota${forYear ? ` · ${forYear}` : ""} · Badan Pusat Statistik`,
      columns: ["Wilayah", "Nilai", "Peringkat"],
      rows: ranked.map((r, i) => ({
        a: r.nama_kab,
        b: formatValue(r.value, column.decimalPlaces),
        c: `${i + 1}`,
      })),
    });
  }, []);

  const onShare = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setToast("Tautan dasbor disalin");
    } catch {
      setToast("Tautan tidak dapat disalin");
    }
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    router.refresh();
    // router.refresh resolves when the server payload arrives; the short hold is
    // only so the control reads as having done something.
    setTimeout(() => {
      setRefreshing(false);
      setToast("Data dimuat ulang");
    }, 800);
  }, [router]);

  const onDownload = useCallback((csv: string, filename: string) => {
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setToast(`Mengunduh ${filename}`);
  }, []);

  if (!summary) {
    return (
      <div className={cn("rounded-2xl border p-6", BORDER, SURFACE)}>
        <h1 className={cn("text-lg font-semibold", TEXT)}>Indikator Strategis</h1>
        <p className={cn("mt-2 text-sm", TEXT_4)}>
          Data dashboard sedang tidak tersedia. Coba muat ulang beberapa saat lagi.
        </p>
      </div>
    );
  }

  const rankColumn = regionColumns.find((c) => c.sourceId === indicator) ?? regionColumns[0] ?? null;
  const regionNames = rankColumn ? rankRegions(rankColumn.values).map((v) => v.nama_kab) : [];
  const totalIndicators = summary.categories.reduce((n, c) => n + c.indicators.length, 0);

  return (
    <div className="flex flex-col gap-6">
      <DashboardChrome
        tab={tab}
        onTab={setTab}
        generatedAt={summary.generatedAt}
        indicatorCount={totalIndicators}
        onRefresh={onRefresh}
        onShare={onShare}
        refreshing={refreshing}
      />

      <FilterRow
        indicators={eligible}
        indicator={indicator}
        onIndicator={setPickedIndicator}
        years={years}
        year={year}
        onYear={setPickedYear}
        regions={regionNames}
        region={region}
        onRegion={setRegion}
        canReset={pickedIndicator != null || pickedYear != null || region != null}
        onReset={() => {
          setPickedIndicator(null);
          setPickedYear(null);
          setRegion(null);
        }}
      />

      <div className="grid grid-cols-12 gap-4">
        {kpis.length ? (
          <section aria-label="Angka utama" className="col-span-12 grid grid-cols-12 gap-4">
            {kpis.map((card) => (
              <div key={card.sourceId} className="col-span-12 sm:col-span-6 xl:col-span-3">
                <KpiCard card={card} onExpand={openCardDetail} />
              </div>
            ))}
          </section>
        ) : null}

        <TrendCard card={lead} onExpand={openCardDetail} />
        <RegionProfileCard columns={regionColumns} region={region} onSelectRegion={setRegion} />

        <BarsCard card={bars} onExpand={openCardDetail} />
        <RankCard
          title={rankColumn?.name ?? "Peringkat kabupaten/kota"}
          subtitle={year ? `Per kabupaten/kota · ${year}` : undefined}
          values={rankColumn?.values ?? []}
          decimalPlaces={rankColumn?.decimalPlaces ?? 2}
          selectedRegion={region}
          onSelectRegion={setRegion}
          onExpand={rankColumn ? () => openRankDetail(rankColumn, year) : undefined}
        />

        {showHeat ? <HeatCard series={inflation} /> : null}

        <RegionTable
          columns={regionColumns}
          year={year}
          selectedRegion={region}
          onSelectRegion={setRegion}
          onDownload={onDownload}
        />

        <IndicatorIndex categories={categories} />
      </div>

      <DetailModal detail={detail} onClose={() => setDetail(null)} />
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}
