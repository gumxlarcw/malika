"use client";

interface Item {
  nama_kab: string;
  value: number;
}

interface Props {
  top3: Item[];
  bottom3: Item[];
}

const fmt = (n: number) =>
  new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(n);

export default function TopBottomList({ top3, bottom3 }: Props) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border p-3 bg-card">
        <div className="text-xs uppercase text-green-700 font-semibold mb-2">
          ▲ Tertinggi
        </div>
        {top3.length === 0 ? (
          <div className="text-sm text-gray-400">—</div>
        ) : (
          <ol className="space-y-1">
            {top3.map((it, i) => (
              <li key={it.nama_kab} className="flex justify-between text-sm">
                <span className="text-gray-700">{i + 1}. {it.nama_kab}</span>
                <span className="font-medium tabular-nums">{fmt(it.value)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="rounded-lg border border-border p-3 bg-card">
        <div className="text-xs uppercase text-red-700 font-semibold mb-2">
          ▼ Terendah
        </div>
        {bottom3.length === 0 ? (
          <div className="text-sm text-gray-400">—</div>
        ) : (
          <ol className="space-y-1">
            {bottom3.map((it, i) => (
              <li key={it.nama_kab} className="flex justify-between text-sm">
                <span className="text-gray-700">{i + 1}. {it.nama_kab}</span>
                <span className="font-medium tabular-nums">{fmt(it.value)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
