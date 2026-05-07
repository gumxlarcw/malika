"use client";

interface Props {
  total: number | null;
  year: number;
  prevTotal?: number | null;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(n);

export default function ProvinsiTotalCard({ total, year, prevTotal }: Props) {
  if (total == null) {
    return (
      <div className="rounded-lg border border-border p-3 bg-card">
        <div className="text-xs uppercase text-gray-500 font-semibold">
          Provinsi Maluku Utara
        </div>
        <div className="text-2xl font-bold text-gray-400 mt-1">—</div>
        <div className="text-xs text-gray-400 mt-1">Data tidak tersedia</div>
      </div>
    );
  }

  let deltaEl = null;
  if (prevTotal != null && prevTotal !== 0) {
    const delta = total - prevTotal;
    const pct = (delta / prevTotal) * 100;
    const arrow = delta >= 0 ? "▲" : "▼";
    const cls = delta >= 0 ? "text-green-600" : "text-red-600";
    deltaEl = (
      <div className={`text-xs ${cls} mt-1`}>
        {arrow} {fmt(delta)} ({pct.toFixed(1)}%) dari {year - 1}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border p-3 bg-card">
      <div className="text-xs uppercase text-gray-500 font-semibold">
        📊 Provinsi Maluku Utara
      </div>
      <div className="text-2xl font-bold text-gray-900 mt-1">{fmt(total)}</div>
      <div className="text-xs text-gray-500">({year})</div>
      {deltaEl}
    </div>
  );
}
