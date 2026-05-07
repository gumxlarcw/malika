"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import "leaflet/dist/leaflet.css";
import type { Layer, Map as LeafletMap, PathOptions } from "leaflet";
import type { Feature } from "geojson";
import {
  computeBins, colorForValue, fmtNumber, getPalette,
  type BinningMethod, type Palette,
} from "./colorScale";
import type { DataPoint } from "./types";

const MapContainer = dynamic(() => import("react-leaflet").then((m) => m.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import("react-leaflet").then((m) => m.TileLayer), { ssr: false });
const GeoJSONLayer = dynamic(() => import("react-leaflet").then((m) => m.GeoJSON), { ssr: false });

// Initial center/zoom only used until the GeoJSON loads — afterwards fitBounds()
// takes over so every kab/kota stays visible regardless of viewport size.
const MALUT_CENTER: [number, number] = [-0.78, 127.85];
const MALUT_ZOOM = 7;

// Leaflet bounds expressed as [[swLat, swLng], [neLat, neLng]].
type Bounds = [[number, number], [number, number]];

/** Walk every coordinate in a GeoJSON FeatureCollection to derive lat/lng extent. */
function computeGeoJsonBounds(fc: GeoJSON.FeatureCollection): Bounds | null {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walk = (coords: any) => {
    if (typeof coords[0] === "number") {
      const [lng, lat] = coords as [number, number];
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      return;
    }
    for (const c of coords) walk(c);
  };

  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === "Polygon" || g.type === "MultiPolygon") walk(g.coordinates);
  }

  if (!Number.isFinite(minLat)) return null;
  return [
    [minLat, minLng],
    [maxLat, maxLng],
  ];
}

interface Props {
  data: DataPoint[];
  prevData?: DataPoint[];
  filterKey: string;
  binning?: BinningMethod;
  palette?: Palette;
  hoveredKdkab?: string | null;
  onPolygonClick?: (kdkab: string, namaKab: string) => void;
  onPolygonHover?: (kdkab: string | null) => void;
}

export default function ChoroplethMap({
  data,
  prevData = [],
  filterKey,
  binning = "quantile",
  palette = getPalette("blue"),
  hoveredKdkab = null,
  onPolygonClick,
  onPolygonHover,
}: Props) {
  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [geoError, setGeoError] = useState(false);
  // Map of kdkab → Leaflet layer, populated by onEachFeature
  const layerByKdkab = useRef<Record<string, Layer>>({});
  // Leaflet map instance — populated via callback ref once MapContainer mounts.
  const [leafletMap, setLeafletMap] = useState<LeafletMap | null>(null);
  // Container element for ResizeObserver — refit bounds when the map's box resizes.
  const mapBoxRef = useRef<HTMLDivElement | null>(null);

  const bounds = useMemo(() => (geojson ? computeGeoJsonBounds(geojson) : null), [geojson]);

  // Fit the map to enclose every kab/kota. Padding leaves breathing room so the
  // outermost polygons (Morotai north, Taliabu south, Sula west) don't touch
  // the map's edge. Re-runs whenever the container resizes.
  const fitToBounds = useCallback(() => {
    if (!leafletMap || !bounds) return;
    leafletMap.invalidateSize();
    leafletMap.fitBounds(bounds, { padding: [24, 24], animate: false });
  }, [leafletMap, bounds]);

  useEffect(() => {
    fitToBounds();
  }, [fitToBounds]);

  useEffect(() => {
    if (!mapBoxRef.current) return;
    const ro = new ResizeObserver(() => fitToBounds());
    ro.observe(mapBoxRef.current);
    return () => ro.disconnect();
  }, [fitToBounds]);

  useEffect(() => {
    fetch("/api/peta-tematik/geojson")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setGeojson)
      .catch((e) => {
        console.error("GeoJSON load failed:", e);
        setGeoError(true);
      });
  }, []);

  const valueByKdkab = useMemo(() => {
    const m: Record<string, number | null> = {};
    for (const d of data) m[d.kdkab] = d.value;
    return m;
  }, [data]);

  const prevValueByKdkab = useMemo(() => {
    const m: Record<string, number | null> = {};
    for (const d of prevData) m[d.kdkab] = d.value;
    return m;
  }, [prevData]);

  const breaks = useMemo(() => {
    return computeBins(data.filter((d) => d.value != null).map((d) => d.value as number), binning);
  }, [data, binning]);

  const dataHash = useMemo(
    () => `${binning}|${palette.id}|${data.map((d) => `${d.kdkab}:${d.value ?? "n"}`).join("|")}`,
    [data, binning, palette.id],
  );

  // Styles are inlined (not driven via CSS class) so the hover outline can
  // track whichever palette is active — Leaflet's setStyle accepts a `color`
  // prop directly, no class swap needed.
  const baseStrokeColor = "#1f2937"; // gray-800 — quiet default outline

  const styleFn = (feature?: Feature): PathOptions => {
    const kdkab = feature?.properties?.kdkab as string;
    const v = valueByKdkab[kdkab];
    return {
      fillColor: v == null ? palette.noData : colorForValue(v, breaks, palette),
      fillOpacity: v == null ? 0.5 : 0.88,
      color: baseStrokeColor,
      weight: 1,
      opacity: 0.4,
    };
  };

  const hoverStyle: PathOptions = {
    color: palette.hoverOutline,
    weight: 4,
    opacity: 1,
    fillOpacity: 1,
    dashArray: undefined,
  };

  const onEachFeature = (feature: Feature, layer: Layer) => {
    const kdkab = feature.properties?.kdkab as string;
    layerByKdkab.current[kdkab] = layer;
    const namaKab = (feature.properties?.nama_kab as string)
      ?.replace(/^(Kabupaten|Kota)\s+/i, "") ?? kdkab;
    const v = valueByKdkab[kdkab];
    const prev = prevValueByKdkab[kdkab];

    const valueLine =
      v == null
        ? '<span style="color:#9ca3af;font-style:italic">Data tidak tersedia</span>'
        : `<strong style="color:#111827;font-size:18px;font-weight:600">${fmtNumber(v)}</strong>`;

    let deltaLine = "";
    if (v != null && prev != null && prev !== 0) {
      const delta = v - prev;
      const pct = (delta / prev) * 100;
      const arrow = delta >= 0 ? "▲" : "▼";
      const color = delta >= 0 ? "#16a34a" : "#dc2626";
      deltaLine = `<div style="color:${color};margin-top:6px;font-size:11px;font-variant-numeric:tabular-nums">${arrow} ${fmtNumber(delta)} (${pct.toFixed(1)}%) y/y</div>`;
    }

    const clickHint = onPolygonClick && v != null
      ? '<div style="margin-top:8px;padding-top:6px;border-top:1px dotted #d1d5db;font-size:10px;color:#6b7280;letter-spacing:0.08em;text-transform:uppercase;font-weight:500">Klik untuk detail →</div>'
      : "";

    layer.bindTooltip(
      `<div style="line-height:1.4">
         <div style="font-size:14px;font-weight:600;color:#111827;margin-bottom:6px">${namaKab}</div>
         <div>${valueLine}</div>
         ${deltaLine}
         ${clickHint}
       </div>`,
      { sticky: true, direction: "top", offset: [0, -4] },
    );

    layer.on({
      mouseover: (e) => {
        const l = e.target;
        l.setStyle(hoverStyle);
        l.bringToFront();
        if (onPolygonHover) onPolygonHover(kdkab);
      },
      mouseout: (e) => {
        e.target.setStyle(styleFn(feature));
        if (onPolygonHover) onPolygonHover(null);
      },
      click: () => {
        if (onPolygonClick && v != null) onPolygonClick(kdkab, namaKab);
      },
    });
  };

  // External hover sync: when sibling component (bar chart) hovers a kab,
  // apply hover style to the matching map polygon — and reset the rest.
  useEffect(() => {
    Object.entries(layerByKdkab.current).forEach(([k, layer]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const l = layer as any;
      if (k === hoveredKdkab) {
        l.setStyle(hoverStyle);
        l.bringToFront();
      } else {
        const feat = l.feature as Feature | undefined;
        if (feat) l.setStyle(styleFn(feat));
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoveredKdkab, valueByKdkab, breaks, palette.id]);

  if (geoError) {
    return <FallbackTable data={data} />;
  }
  if (!geojson) {
    return <div className="h-[60vh] bg-[var(--pt-canvas-deep)] animate-pulse rounded-xl border border-[var(--pt-border)]" />;
  }

  const hasNoData = data.some((d) => d.value == null);
  const labels = breaks.length > 0
    ? [
        `< ${fmtNumber(breaks[0])}`,
        `${fmtNumber(breaks[0])} – ${fmtNumber(breaks[1])}`,
        `${fmtNumber(breaks[1])} – ${fmtNumber(breaks[2])}`,
        `${fmtNumber(breaks[2])} – ${fmtNumber(breaks[3])}`,
        `> ${fmtNumber(breaks[3])}`,
      ]
    : [];

  return (
    <div ref={mapBoxRef} className="relative rounded-xl overflow-hidden border border-[var(--pt-border-strong)]">
      <MapContainer
        ref={setLeafletMap}
        center={MALUT_CENTER}
        zoom={MALUT_ZOOM}
        style={{ height: "60vh", width: "100%", background: "var(--pt-canvas)" }}
        scrollWheelZoom={false}
        preferCanvas={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          maxZoom={19}
        />
        <GeoJSONLayer
          key={`${filterKey}-${dataHash}`}
          data={geojson}
          style={styleFn as () => PathOptions}
          onEachFeature={onEachFeature}
        />
      </MapContainer>
      {labels.length > 0 && (
        <div className="absolute bottom-3 left-3 z-[1000] bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm border border-gray-200 dark:border-gray-700 rounded-xl p-3 text-xs shadow-theme-md">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Skala</div>
          <div className="flex flex-col gap-1.5">
            {palette.colors.map((c, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <span
                  className="w-6 h-3 border border-gray-300/40 dark:border-gray-600/40"
                  style={{ backgroundColor: c }}
                />
                <span className="text-[11px] text-gray-700 dark:text-gray-200 tabular-nums">{labels[i]}</span>
              </div>
            ))}
            {hasNoData && (
              <div className="flex items-center gap-2.5 mt-1.5 pt-1.5 border-t border-dotted border-gray-300/40 dark:border-gray-600/40">
                <span
                  className="w-6 h-3 border border-gray-300/40 dark:border-gray-600/40 opacity-60"
                  style={{ backgroundColor: palette.noData }}
                />
                <span className="text-[11px] text-gray-400 dark:text-gray-500 italic">Data tidak tersedia</span>
              </div>
            )}
            <div className="flex items-center gap-2.5 mt-1.5 pt-1.5 border-t border-dotted border-gray-300/40 dark:border-gray-600/40">
              <span
                className="w-6 h-3 rounded-sm"
                style={{ background: "transparent", border: `2px solid ${palette.hoverOutline}` }}
              />
              <span className="text-[11px] text-gray-500 dark:text-gray-400">Sorot wilayah</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FallbackTable({ data }: { data: DataPoint[] }) {
  return (
    <div className="rounded-xl border border-[var(--pt-border)] overflow-hidden">
      <table className="min-w-full divide-y divide-[var(--pt-border)]">
        <thead className="bg-[var(--pt-canvas-deep)]">
          <tr>
            <th className="px-4 py-2 text-left pt-eyebrow">Kabupaten/Kota</th>
            <th className="px-4 py-2 text-right pt-eyebrow">Nilai</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--pt-border)]">
          {data.map((d) => (
            <tr key={d.kdkab}>
              <td className="px-4 py-2 pt-body text-sm text-[var(--pt-ink)]">{d.nama_kab}</td>
              <td className="px-4 py-2 pt-mono text-sm text-right">
                {d.value == null ? "—" : fmtNumber(d.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
