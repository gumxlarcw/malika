"use client";
import { motion } from "framer-motion";
import { MapPin } from "lucide-react";

interface Props {
  kategori: string;
  indikatorName: string;
  year: number | null;
  month: number | null;
  metric: string | null;
  totalKabkota?: number;
  validCount?: number;
  yearsRange?: { min: number; max: number } | null;
  satuan?: string | null;
  responsibleParty?: string | null;
}

const MONTH_NAMES = [
  "", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];

/**
 * Hero banner — gradient brand-blue card. State mirror untuk indikator + filter
 * yang sedang aktif. Pattern dari design bundle: bold gradient dengan
 * decorative blur orbs, 4 metric inline (Cakupan, Satuan, Periode, Diperbarui).
 */
export default function ActiveIndikatorBanner({
  kategori, indikatorName, year, month, metric, totalKabkota, validCount, yearsRange,
  satuan, responsibleParty,
}: Props) {
  const today = new Date().toLocaleDateString("id-ID", {
    day: "numeric", month: "short", year: "numeric",
  });

  return (
    <motion.div
      key={`${indikatorName}-${year}-${month}-${metric}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
      className="rounded-2xl bg-gradient-to-br from-[#262e89] via-[#3641f5] to-[#465fff] text-white p-5 sm:p-6 relative overflow-hidden shadow-theme-xs"
    >
      {/* decorative gradient orbs */}
      <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-white/10 blur-2xl pointer-events-none" />
      <div className="absolute bottom-0 right-20 w-32 h-32 rounded-full bg-[#7592ff]/30 blur-2xl pointer-events-none" />

      <div className="relative">
        {/* Eyebrow line — kategori chip + filter context */}
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-white/70 flex-wrap">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/15 backdrop-blur">
            <MapPin className="w-3 h-3" />
            {kategori}
          </span>
          {year != null && (
            <>
              <span>·</span>
              <span>Tahun {year}</span>
            </>
          )}
          {month != null && month >= 1 && month <= 12 && (
            <>
              <span>·</span>
              <span>{MONTH_NAMES[month]}</span>
            </>
          )}
          {metric && metric !== "value" && (
            <>
              <span>·</span>
              <span className="normal-case tracking-normal">{metric}</span>
            </>
          )}
        </div>

        {/* Title */}
        <h2 className="mt-2.5 text-xl sm:text-2xl lg:text-[26px] font-semibold leading-tight tracking-tight break-words">
          {indikatorName}
        </h2>

        {/* Subtitle */}
        <p className="mt-1.5 text-white/75 text-[13px] sm:text-sm max-w-2xl leading-relaxed">
          Distribusi spasial di 10 kabupaten/kota Provinsi Maluku Utara
          {responsibleParty ? (
            <> · Sumber: {responsibleParty}</>
          ) : (
            <> · Sumber: BPS Maluku Utara</>
          )}
        </p>

        {/* Metric strip */}
        <div className="mt-4 sm:mt-5 flex flex-wrap items-center gap-x-5 gap-y-3 text-xs sm:text-[12.5px]">
          {totalKabkota != null && validCount != null && (
            <div>
              <div className="text-white/60 text-[10.5px] uppercase tracking-wider">Cakupan</div>
              <div className="font-semibold tabular-nums mt-0.5">
                {validCount}/{totalKabkota} kab/kota
              </div>
            </div>
          )}
          {satuan && (
            <>
              <div className="hidden sm:block w-px h-7 bg-white/20" />
              <div>
                <div className="text-white/60 text-[10.5px] uppercase tracking-wider">Satuan</div>
                <div className="font-semibold mt-0.5">{satuan}</div>
              </div>
            </>
          )}
          <div className="hidden sm:block w-px h-7 bg-white/20" />
          <div>
            <div className="text-white/60 text-[10.5px] uppercase tracking-wider">Tahun</div>
            <div className="font-semibold tabular-nums mt-0.5">{year ?? "—"}</div>
          </div>
          {yearsRange && yearsRange.min !== yearsRange.max && (
            <>
              <div className="hidden sm:block w-px h-7 bg-white/20" />
              <div>
                <div className="text-white/60 text-[10.5px] uppercase tracking-wider">Periode</div>
                <div className="font-semibold tabular-nums mt-0.5">
                  {yearsRange.min}–{yearsRange.max}
                </div>
              </div>
            </>
          )}
          <div className="hidden sm:block w-px h-7 bg-white/20" />
          <div>
            <div className="text-white/60 text-[10.5px] uppercase tracking-wider">Diperbarui</div>
            <div className="font-semibold mt-0.5">{today}</div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
