"use client";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Sparkles, Minus } from "lucide-react";
import { fmtNumber } from "../colorScale";
import type { DataPoint, SummaryResponse } from "../types";

interface Props {
  data: DataPoint[];
  summary: SummaryResponse | null;
  year: number;
}

/**
 * Editorial-style auto-generated insights — 3 cards above the map.
 * Translates raw numbers into headlines: "Ternate is highest", "Trend is up", etc.
 */
export default function AutoInsights({ data, summary, year }: Props) {
  const valid = data.filter((d) => d.value != null) as Array<{ kdkab: string; nama_kab: string; value: number }>;
  if (valid.length === 0) return null;

  const sorted = [...valid].sort((a, b) => b.value - a.value);
  const top = sorted[0];
  const low = sorted[sorted.length - 1];

  // Trend: compare last two valid years in summary.trend
  let trendNarrative: { label: string; pct: number; direction: "up" | "down" | "flat" } | null = null;
  if (summary?.trend && summary.trend.length >= 2) {
    const validTrend = summary.trend.filter((t) => t.provinsi_total != null);
    if (validTrend.length >= 2) {
      const first = validTrend[0].provinsi_total!;
      const last = validTrend[validTrend.length - 1].provinsi_total!;
      const pct = first !== 0 ? ((last - first) / first) * 100 : 0;
      const direction = pct > 5 ? "up" : pct < -5 ? "down" : "flat";
      trendNarrative = {
        label: `${validTrend[0].year}–${validTrend[validTrend.length - 1].year}`,
        pct,
        direction,
      };
    }
  }

  // Compute delta vs prev year for top
  let topDelta: number | null = null;
  if (summary?.trend && summary.trend.length >= 2) {
    const t = summary.trend.filter((x) => x.provinsi_total != null);
    if (t.length >= 2) {
      const cur = t[t.length - 1].provinsi_total!;
      const prev = t[t.length - 2].provinsi_total!;
      topDelta = prev !== 0 ? ((cur - prev) / prev) * 100 : null;
    }
  }

  // Narrative line — generated from data
  const narrative = (() => {
    if (!trendNarrative) {
      return `Periode ${year}: data dasar — pembanding tahun sebelumnya belum tersedia.`;
    }
    const dirText = trendNarrative.direction === "up" ? "naik" : trendNarrative.direction === "down" ? "turun" : "relatif stabil";
    const pctText = trendNarrative.pct !== 0 ? ` ${Math.abs(trendNarrative.pct).toFixed(1)}%` : "";
    return `Rata-rata provinsi ${dirText}${pctText} dari ${trendNarrative.label.split("–")[0]}.`;
  })();

  const provinsiTotal = summary?.provinsi_total;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <InsightCard
          delay={0}
          eyebrow="Tertinggi"
          emphasis={top.nama_kab}
          value={top.value}
          accent="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
          icon={<TrendingUp className="w-4 h-4" />}
        />
        <InsightCard
          delay={0.08}
          eyebrow="Terendah"
          emphasis={low.nama_kab}
          value={low.value}
          accent="bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400"
          icon={<TrendingDown className="w-4 h-4" />}
          sub={`Selisih ${fmtNumber(top.value - low.value)} dari tertinggi`}
        />
        <InsightCard
          delay={0.16}
          eyebrow={`Provinsi · ${year}`}
          emphasis={provinsiTotal != null ? fmtNumber(provinsiTotal) : "—"}
          accent="bg-[#ecf3ff] text-[#3641f5] dark:bg-blue-950/40 dark:text-blue-400"
          icon={
            trendNarrative?.direction === "up" ? <TrendingUp className="w-4 h-4" />
              : trendNarrative?.direction === "down" ? <TrendingDown className="w-4 h-4" />
              : <Minus className="w-4 h-4" />
          }
          sub={
            trendNarrative
              ? `${trendNarrative.direction === "up" ? "▲" : trendNarrative.direction === "down" ? "▼" : "—"} ${Math.abs(trendNarrative.pct).toFixed(1)}% vs ${trendNarrative.label.split("–")[0]}`
              : "Periode awal"
          }
        />
      </div>

      {/* Narrative card — "Apa kata data?" */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.24, ease: [0.4, 0, 0.2, 1] }}
        className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-gradient-to-r from-white via-white to-[#f8fafc] dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 p-4 flex items-start gap-3"
      >
        <div className="w-8 h-8 rounded-lg bg-[#ecf3ff] dark:bg-blue-950/40 text-[#3641f5] dark:text-blue-400 flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#3641f5] dark:text-blue-400">
            Apa kata data?
          </div>
          <p className="text-[13.5px] text-gray-700 dark:text-gray-200 mt-1 leading-relaxed">
            <span className="font-semibold text-gray-900 dark:text-white">{top.nama_kab}</span>{" "}
            mencatat angka tertinggi ({fmtNumber(top.value)}), sementara{" "}
            <span className="font-semibold text-gray-900 dark:text-white">{low.nama_kab}</span>{" "}
            di posisi terendah ({fmtNumber(low.value)}). {narrative}
          </p>
        </div>
      </motion.div>
    </div>
  );
}

interface InsightCardProps {
  eyebrow: string;
  emphasis: string;
  value?: number;
  sub?: string;
  accent: string;
  icon: React.ReactNode;
  delay: number;
}

function InsightCard({ eyebrow, emphasis, value, sub, accent, icon, delay }: InsightCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.4, 0, 0.2, 1] }}
      className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-theme-xs p-4 transition-shadow hover:shadow-theme-md"
    >
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {eyebrow}
        </div>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${accent}`}>
          {icon}
        </div>
      </div>
      <div className="mt-2.5 text-[20px] font-semibold text-gray-900 dark:text-white leading-tight">
        {emphasis}
      </div>
      {value != null && (
        <div className="text-[13.5px] text-gray-600 dark:text-gray-300 mt-0.5 tabular-nums">
          {fmtNumber(value)}
        </div>
      )}
      {sub && (
        <div className="text-[12px] text-gray-500 dark:text-gray-400 mt-1.5 leading-snug tabular-nums">
          {sub}
        </div>
      )}
    </motion.div>
  );
}
