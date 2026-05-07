"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { fetchIndikatorList, QUERY_KEYS } from "./api";
import type { FilterState } from "./types";
import Skeleton from "@/components/Skeleton";
import FilterBar from "./FilterBar";
import ChoroplethMap from "./ChoroplethMap";
import InfoPanel from "./InfoPanel";
import ExportButton from "./ExportButton";

export default function PetaTematikSection() {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [activated, setActivated] = useState(false);

  // Lazy-mount: only fetch when scrolled into view
  useEffect(() => {
    const node = wrapperRef.current;
    if (!node || activated) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setActivated(true);
          obs.disconnect();
        }
      },
      { rootMargin: "100px" },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [activated]);

  return (
    <div ref={wrapperRef} className="space-y-3 pt-4 border-t border-gray-200">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-700 flex items-center gap-2">
          <MapPin className="h-5 w-5 text-blue-600" />
          Peta Tematik
        </h2>
        {activated && (
          <ExportButton fileNameSeed="dashboard" />
        )}
      </div>
      {!activated ? (
        <Skeleton className="h-[60vh]" />
      ) : (
        <PetaTematikInner />
      )}
    </div>
  );
}

function PetaTematikInner() {
  const [filters, setFilters] = useState<FilterState>({
    indikator: null,
    year: null,
    month: null,
    metric: null,
  });

  const { data: indikatorList, isLoading: listLoading } = useQuery({
    queryKey: QUERY_KEYS.indikatorList,
    queryFn: fetchIndikatorList,
    staleTime: 60 * 60 * 1000,
  });

  // Set default indikator when list arrives
  useEffect(() => {
    if (!filters.indikator && indikatorList?.kategori) {
      const kependudukan = indikatorList.kategori["Kependudukan"];
      if (kependudukan?.length > 0) {
        setFilters((f) => ({ ...f, indikator: kependudukan[0].sourceId }));
      } else {
        const firstNonEmpty = Object.values(indikatorList.kategori).find(
          (arr) => arr.length > 0,
        );
        if (firstNonEmpty) {
          setFilters((f) => ({ ...f, indikator: firstNonEmpty[0].sourceId }));
        }
      }
    }
  }, [indikatorList, filters.indikator]);

  if (listLoading) return <Skeleton className="h-[60vh]" />;
  if (!indikatorList || indikatorList.totalEligible === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-card p-6 text-center text-gray-500">
        Tidak ada indikator yang tersedia untuk peta tematik.
      </div>
    );
  }

  return (
    <div className="space-y-4" id="peta-tematik-export-area">
      <FilterBar list={indikatorList} filters={filters} setFilters={setFilters} />
      {filters.indikator && filters.year ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <ChoroplethMap filters={filters} />
          </div>
          <div className="lg:col-span-1">
            <InfoPanel filters={filters} />
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-gray-500">
          Pilih indikator dan tahun untuk menampilkan peta.
        </div>
      )}
    </div>
  );
}
