"use client";

import { useEffect, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import "leaflet/dist/leaflet.css";
import type { Layer, PathOptions } from "leaflet";
import type { Feature } from "geojson";
import { fetchData, QUERY_KEYS } from "./api";
import { quantileBins, colorForValue, NO_DATA_COLOR } from "./colorScale";
import MapLegend from "./MapLegend";
import type { DataPoint, FilterState } from "./types";

const MapContainer = dynamic(
  () => import("react-leaflet").then(m => m.MapContainer), { ssr: false });
const TileLayer = dynamic(
  () => import("react-leaflet").then(m => m.TileLayer), { ssr: false });
const GeoJSON = dynamic(
  () => import("react-leaflet").then(m => m.GeoJSON), { ssr: false });

interface Props {
  filters: FilterState;
}

const MALUT_CENTER: [number, number] = [-0.78, 127.85];
const MALUT_ZOOM = 7;

const fmtNumber = (n: number) =>
  new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(n);

export default function ChoroplethMap({ filters }: Props) {
  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [geoError, setGeoError] = useState(false);

  useEffect(() => {
    fetch("/geojson/peta_kabko_malut.geojson")
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setGeojson)
      .catch(e => { console.error("GeoJSON load failed:", e); setGeoError(true); });
  }, []);

  const dataQuery = useQuery({
    queryKey: QUERY_KEYS.data(filters.indikator!, filters.year!, filters.month, filters.metric),
    queryFn: () => fetchData(filters.indikator!, filters.year!, filters.month, filters.metric),
    enabled: !!filters.indikator && !!filters.year,
    staleTime: 60 * 60 * 1000,
  });

  const prevYearQuery = useQuery({
    queryKey: QUERY_KEYS.data(filters.indikator!, filters.year! - 1, filters.month, filters.metric),
    queryFn: () => fetchData(filters.indikator!, filters.year! - 1, filters.month, filters.metric),
    enabled: !!filters.indikator && !!filters.year && filters.year > 0,
    staleTime: 60 * 60 * 1000,
  });

  const valueByKdkab = useMemo(() => {
    const m: Record<string, number | null> = {};
    for (const d of dataQuery.data?.data ?? []) m[d.kdkab] = d.value;
    return m;
  }, [dataQuery.data]);

  const prevValueByKdkab = useMemo(() => {
    const m: Record<string, number | null> = {};
    for (const d of prevYearQuery.data?.data ?? []) m[d.kdkab] = d.value;
    return m;
  }, [prevYearQuery.data]);

  const breaks = useMemo(() => {
    const values = (dataQuery.data?.data ?? [])
      .filter(d => d.value != null)
      .map(d => d.value as number);
    return quantileBins(values);
  }, [dataQuery.data]);

  const styleFn = (feature?: Feature): PathOptions => {
    const kdkab = feature?.properties?.kdkab as string;
    const v = valueByKdkab[kdkab];
    return {
      fillColor: v == null ? NO_DATA_COLOR : colorForValue(v, breaks),
      fillOpacity: v == null ? 0.4 : 0.7,
      weight: 1,
      color: "white",
    };
  };

  const onEachFeature = (feature: Feature, layer: Layer) => {
    const kdkab = feature.properties?.kdkab as string;
    const namaKab = (feature.properties?.nama_kab as string)
      ?.replace(/^(Kabupaten|Kota)\s+/i, "")
      ?? kdkab;
    const v = valueByKdkab[kdkab];
    const prev = prevValueByKdkab[kdkab];

    const valueLine = v == null
      ? '<span class="text-gray-500">Data tidak tersedia</span>'
      : `<strong>${fmtNumber(v)}</strong>`;

    let deltaLine = "";
    if (v != null && prev != null && prev !== 0) {
      const delta = v - prev;
      const pct = (delta / prev) * 100;
      const arrow = delta >= 0 ? "▲" : "▼";
      const cls = delta >= 0 ? "text-green-600" : "text-red-600";
      deltaLine = `<div class="${cls} mt-1">${arrow} ${fmtNumber(delta)} (${pct.toFixed(1)}%)</div>`;
    }

    layer.bindTooltip(
      `<div class="text-sm">
         <div class="font-semibold mb-1">${namaKab}</div>
         <div>${valueLine}</div>
         ${deltaLine}
       </div>`,
      { sticky: true, direction: "top" }
    );

    layer.on({
      mouseover: (e) => {
        const l = e.target;
        l.setStyle({ weight: 2.5, color: "#1e40af", fillOpacity: 0.9 });
        l.bringToFront();
      },
      mouseout: (e) => {
        e.target.setStyle(styleFn(feature));
      },
    });
  };

  if (geoError) {
    return <FallbackTable data={dataQuery.data?.data ?? []} />;
  }
  if (!geojson) {
    return <div className="h-[60vh] bg-gray-100 animate-pulse rounded-xl" />;
  }

  const hasNoData = (dataQuery.data?.data ?? []).some(d => d.value == null);

  return (
    <div className="relative rounded-xl border border-border overflow-hidden">
      <MapContainer
        center={MALUT_CENTER}
        zoom={MALUT_ZOOM}
        style={{ height: "60vh", width: "100%" }}
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <GeoJSON
          key={`${filters.indikator}-${filters.year}-${filters.month ?? 0}-${filters.metric ?? "*"}`}
          data={geojson}
          style={styleFn as () => PathOptions}
          onEachFeature={onEachFeature}
        />
      </MapContainer>
      <MapLegend breaks={breaks} hasNoData={hasNoData} />
    </div>
  );
}

function FallbackTable({ data }: { data: DataPoint[] }) {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
              Kabupaten/Kota
            </th>
            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
              Nilai
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {data.map(d => (
            <tr key={d.kdkab}>
              <td className="px-4 py-2 text-sm">{d.nama_kab}</td>
              <td className="px-4 py-2 text-sm text-right">
                {d.value == null ? "-" : fmtNumber(d.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
