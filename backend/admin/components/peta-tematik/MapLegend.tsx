"use client";

import { SCALE_COLORS, NO_DATA_COLOR } from "./colorScale";

interface Props {
  breaks: number[];
  hasNoData?: boolean;
}

export default function MapLegend({ breaks, hasNoData }: Props) {
  if (breaks.length === 0) return null;
  const fmt = (n: number) =>
    new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(n);

  const labels = [
    `< ${fmt(breaks[0])}`,
    `${fmt(breaks[0])} – ${fmt(breaks[1])}`,
    `${fmt(breaks[1])} – ${fmt(breaks[2])}`,
    `${fmt(breaks[2])} – ${fmt(breaks[3])}`,
    `> ${fmt(breaks[3])}`,
  ];

  return (
    <div className="absolute bottom-4 left-4 z-[1000] bg-white/95 rounded-lg
                    shadow-lg border border-gray-200 p-3 text-xs">
      <div className="font-semibold text-gray-700 mb-2">Skala</div>
      <div className="flex flex-col gap-1">
        {SCALE_COLORS.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-5 h-3 rounded" style={{ backgroundColor: c }} />
            <span className="text-gray-600">{labels[i]}</span>
          </div>
        ))}
        {hasNoData && (
          <div className="flex items-center gap-2 mt-1 pt-1 border-t border-gray-200">
            <span className="w-5 h-3 rounded opacity-50" style={{ backgroundColor: NO_DATA_COLOR }} />
            <span className="text-gray-500">Data tidak tersedia</span>
          </div>
        )}
      </div>
    </div>
  );
}
