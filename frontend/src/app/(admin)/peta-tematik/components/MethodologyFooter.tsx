"use client";

import { type BinningMethod, BINNING_LABELS } from "../colorScale";

interface Props {
  indikator: number | null;
  indikatorName?: string;
  year: number | null;
  binning: BinningMethod;
  totalIndikator: number;
}

export default function MethodologyFooter({
  indikator, indikatorName, year, binning, totalIndikator,
}: Props) {
  const updated = new Date().toLocaleDateString("id-ID", {
    day: "numeric", month: "long", year: "numeric",
  });
  return (
    <footer className="mt-12 pt-8 border-t border-[var(--pt-border)]">
      <div className="grid sm:grid-cols-2 gap-6 text-xs pt-body text-[var(--pt-ink-soft)] leading-relaxed">
        <div>
          <div className="pt-eyebrow mb-2">Sumber</div>
          <div className="space-y-1">
            <div>Badan Pusat Statistik · Maluku Utara</div>
            {indikator && (
              <div>
                Tabel{" "}
                <code className="pt-mono text-[var(--pt-accent)] bg-[var(--pt-canvas-deep)] px-1.5 py-0.5 text-[10px]">
                  indikator_{indikator}
                </code>
                {year ? ` · tahun ${year}` : ""}
              </div>
            )}
            {indikatorName && (
              <div className="italic text-[var(--pt-ink-faint)] mt-1 leading-snug">
                &quot;{indikatorName}&quot;
              </div>
            )}
            <div className="pt-mono text-[var(--pt-ink-faint)]">Periode terupdate: {updated}</div>
          </div>
        </div>
        <div>
          <div className="pt-eyebrow mb-2">Metodologi</div>
          <div className="space-y-1">
            <div>
              Klasifikasi: <span className="pt-display italic">{BINNING_LABELS[binning]}</span> (5 kelas)
            </div>
            <div>10 kabupaten/kota Maluku Utara</div>
            <div>Polygon dari peta wilayah BPS · WGS 84</div>
            <div className="pt-mono text-[var(--pt-ink-faint)]">
              {totalIndikator} indikator tersedia
            </div>
          </div>
        </div>
      </div>
      <div className="mt-6 pt-4 border-t border-dotted border-[var(--pt-ink-faint)]/30 text-[10px] pt-mono text-[var(--pt-ink-faint)] tracking-wider uppercase flex flex-wrap items-center justify-between gap-2">
        <div>MALIKA · BPS Maluku Utara</div>
        <div>Editorial Cartography v1.0</div>
      </div>
    </footer>
  );
}
