"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import { Play, Pause, Rewind } from "lucide-react";

interface Props {
  years: number[];
  value: number;
  onChange: (year: number) => void;
}

const PLAY_INTERVAL_MS = 1500;

/**
 * Time scrubber: circular year ticks with auto-play.
 * Brand-blue active ring, hollow outline for past years, gray for future.
 */
export default function TimeScrubber({ years, value, onChange }: Props) {
  const [playing, setPlaying] = useState(false);
  const idx = years.indexOf(value);
  const intervalRef = useRef<number | null>(null);
  const latestRef = useRef({ years, value, onChange });
  useEffect(() => {
    latestRef.current = { years, value, onChange };
  }, [years, value, onChange]);

  const tick = useCallback(() => {
    const { years: ys, value: v, onChange: cb } = latestRef.current;
    const i = ys.indexOf(v);
    if (i >= ys.length - 1) {
      cb(ys[0]);
      return;
    }
    cb(ys[i + 1]);
  }, []);

  useEffect(() => {
    if (!playing) {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    intervalRef.current = window.setInterval(tick, PLAY_INTERVAL_MS) as unknown as number;
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, [playing, tick]);

  if (years.length < 2) return null;

  const reset = () => {
    setPlaying(false);
    onChange(years[0]);
  };
  const togglePlay = () => setPlaying((p) => !p);
  const pct = idx >= 0 ? (idx / (years.length - 1)) * 100 : 0;

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-theme-xs p-3 sm:p-4">
      <div className="flex items-center gap-3">
        {/* Rewind */}
        <button
          type="button"
          onClick={reset}
          className="w-9 h-9 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-center text-gray-500 dark:text-gray-300 transition-colors"
          aria-label="Mulai dari awal"
        >
          <Rewind className="w-4 h-4" />
        </button>

        {/* Play / Pause */}
        <button
          type="button"
          onClick={togglePlay}
          className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
            playing ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900" : "bg-[#465fff] text-white hover:bg-[#3641f5]"
          }`}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </button>

        {/* Track + circular year ticks */}
        <div className="flex-1 relative h-9 flex items-center min-w-0">
          {/* track */}
          <div className="absolute left-0 right-0 h-1 rounded-full bg-gray-100 dark:bg-gray-700" />
          <div
            className="absolute left-0 h-1 rounded-full bg-[#465fff] transition-all"
            style={{ width: `${pct}%` }}
          />
          {/* ticks */}
          {years.map((y, i) => {
            const left = years.length === 1 ? 50 : (i / (years.length - 1)) * 100;
            const active = value === y;
            const past = i <= idx;
            return (
              <button
                key={y}
                type="button"
                onClick={() => {
                  setPlaying(false);
                  onChange(y);
                }}
                style={{ left: `calc(${left}% - 14px)` }}
                className="absolute top-1/2 -translate-y-1/2 group"
                aria-label={`Tahun ${y}`}
              >
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                    active
                      ? "bg-[#465fff] text-white shadow-md ring-4 ring-[#ecf3ff] dark:ring-blue-950/60"
                      : past
                      ? "bg-white dark:bg-gray-800 border-2 border-[#465fff] text-[#465fff]"
                      : "bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-600 text-gray-400 dark:text-gray-500 group-hover:border-gray-300 dark:group-hover:border-gray-500"
                  }`}
                >
                  <span className="text-[10px] font-bold tabular-nums">{String(y).slice(2)}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Year display */}
        <div className="text-right pl-3 border-l border-gray-100 dark:border-gray-700 hidden sm:block">
          <div className="text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">Tahun</div>
          <div className="text-[18px] font-semibold text-gray-900 dark:text-white tabular-nums leading-tight">{value}</div>
        </div>
      </div>

      {playing && (
        <div className="text-[10px] text-[#465fff] uppercase tracking-wider mt-2 text-center font-medium">
          ● Memutar — {idx + 1}/{years.length}
        </div>
      )}
    </div>
  );
}
