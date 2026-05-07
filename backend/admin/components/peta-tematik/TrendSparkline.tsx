"use client";

interface Point {
  year: number;
  provinsi_total: number | null;
}

interface Props {
  points: Point[];
}

export default function TrendSparkline({ points }: Props) {
  const valid = points.filter(p => p.provinsi_total != null) as
    Array<{ year: number; provinsi_total: number }>;
  if (valid.length < 2) {
    return (
      <div className="rounded-lg border border-border p-3 bg-card">
        <div className="text-xs uppercase text-gray-500 font-semibold mb-2">
          📈 Trend Provinsi
        </div>
        <div className="text-sm text-gray-400">Data trend tidak cukup.</div>
      </div>
    );
  }

  const W = 240, H = 50, P = 4;
  const xs = valid.map(p => p.year);
  const ys = valid.map(p => p.provinsi_total);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const xScale = (x: number) =>
    P + ((x - xMin) / (xMax - xMin || 1)) * (W - 2 * P);
  const yScale = (y: number) =>
    H - P - ((y - yMin) / (yMax - yMin || 1)) * (H - 2 * P);

  const path = valid.map((p, i) =>
    `${i === 0 ? "M" : "L"}${xScale(p.year).toFixed(1)},${yScale(p.provinsi_total).toFixed(1)}`
  ).join(" ");

  return (
    <div className="rounded-lg border border-border p-3 bg-card">
      <div className="text-xs uppercase text-gray-500 font-semibold mb-2">
        📈 Trend Provinsi {xMin}–{xMax}
      </div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <path d={path} stroke="#3B82F6" strokeWidth="2" fill="none" />
        {valid.map(p => (
          <circle
            key={p.year}
            cx={xScale(p.year)}
            cy={yScale(p.provinsi_total)}
            r="2"
            fill="#3B82F6"
          />
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-gray-500 mt-1 px-1">
        <span>{xMin}</span><span>{xMax}</span>
      </div>
    </div>
  );
}
