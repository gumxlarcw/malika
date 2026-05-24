"use client";
import type { HistoryBucket } from "../types";

interface Props {
  buckets: HistoryBucket[];
}

const BAR_W = 16;
const BAR_GAP = 2;
const H = 80;

function colorFor(failed: number, probes: number): string {
  if (probes === 0) return "#e5e7eb";
  const ratio = failed / probes;
  if (ratio === 0) return "#16a34a"; // green-600
  if (ratio <= 0.25) return "#f59e0b"; // amber-500
  return "#dc2626"; // red-600
}

export default function HistoryChart({ buckets }: Props) {
  if (buckets.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="text-sm text-muted-foreground">Belum ada data 24 jam terakhir.</div>
      </div>
    );
  }

  const width = buckets.length * (BAR_W + BAR_GAP);

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold">Failed Probes (24h)</h3>
        <div className="text-xs text-muted-foreground">
          Tiap bar = 1 jam · merah = &gt;25% gagal · kuning = ≤25% · hijau = OK
        </div>
      </div>
      <svg width="100%" height={H} viewBox={`0 0 ${width} ${H}`} preserveAspectRatio="none">
        {buckets.map((b, i) => {
          const h = b.probes === 0 ? 4 : Math.max(4, (b.failed / b.probes) * (H - 4));
          return (
            <rect
              key={b.t}
              x={i * (BAR_W + BAR_GAP)}
              y={H - h}
              width={BAR_W}
              height={h}
              fill={colorFor(b.failed, b.probes)}
            >
              <title>{`${new Date(b.t).toLocaleString("id-ID")} — ${b.failed}/${b.probes} gagal`}</title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}
