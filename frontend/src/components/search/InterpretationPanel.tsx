"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { InterpretationSkeleton } from "@/components/search/SearchResultSkeleton";

function extractYearsFromQuery(text: string): number[] {
  const s = String(text || "");
  const matches = s.match(/\b(19\d{2}|20\d{2}|2100)\b/g) || [];
  const out: number[] = [];
  for (const m of matches) {
    const n = Number(m);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function normalizeAvailableYears(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const set = new Set<number>();
  for (const v of input) {
    const raw = String(v ?? "").trim();
    if (!raw) continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    if (n >= 1900 && n <= 2100) {
      set.add(n);
      continue;
    }
    // BPS period_value style (e.g., 125 => 2025)
    if (n >= 0 && n <= 300) {
      set.add(1900 + n);
    }
  }
  return Array.from(set).sort((a, b) => a - b);
}

type InsightItem = {
  icon: string;
  label: string;
  text: string;
};

type InterpretationData = {
  title: string;
  headline?: string;
  subheadline?: string;
  insights?: InsightItem[];
  bullets: string[]; // backward compatibility
  methodology?: string;
  confidence?: "high" | "medium" | "low";
  disclaimer?: string;
};

type InsightResponse = {
  ok: boolean;
  mode: "ai" | "template";
  interpretation: InterpretationData;
  chart?: {
    recommended?: "line" | "bar" | "pie";
    reason?: string;
    labelKey?: string;
    valueKey?: string;
  };
  error?: string;
};

export type { InsightResponse };

type Props = {
  q: string;
  dataset?: {
    source_id: string | number;
    type?: string;
    period?: string;
    periods?: string[];
    month?: string | number | null;
    geo?: string;
    group?: string;
    code_hs?: string;
    pod?: string;
    ctr?: string;
    metric?: string;
  };
  preview: {
    source?: string;
    period?: string;
    availableYears?: string[];
    last_update?: string | null;
    type?: string;
    geo?: string;
    month?: number | null;
    columns?: string[];
    sampleRows?: Array<Record<string, unknown>>;
    unit?: string | null;
  };
  chartHint?: {
    recommended?: "line" | "bar" | "pie";
    labelKey?: string;
    valueKey?: string;
  };
  cacheRef?: React.MutableRefObject<Map<string, InsightResponse>>;
  onComplete?: () => void;
};

export default function InterpretationPanel({ q, dataset, preview, chartHint, cacheRef: externalCacheRef, onComplete }: Props) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<InsightResponse | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const localCacheRef = React.useRef<Map<string, InsightResponse>>(new Map());
  const cacheRef = externalCacheRef ?? localCacheRef;

  const availableYearsNormalized = useMemo(() => normalizeAvailableYears(preview?.availableYears), [preview?.availableYears]);
  const queryYears = useMemo(() => extractYearsFromQuery(q), [q]);

  const requestedYearFromQuery = queryYears.length > 0 ? queryYears[queryYears.length - 1] : null;
  const focusYear = availableYearsNormalized.length > 0 ? availableYearsNormalized[availableYearsNormalized.length - 1] : null;
  const shouldPinToLatestYear = !!(
    focusYear &&
    availableYearsNormalized.length > 0 &&
    (requestedYearFromQuery === null || !availableYearsNormalized.includes(requestedYearFromQuery))
  );

  const effectiveDataset = useMemo(() => {
    if (!dataset) return dataset;
    if (!shouldPinToLatestYear || !focusYear) return dataset;
    // In fallback mode (query missing year OR requested year unavailable), keep interpretation stable
    // and focused on the latest available year regardless of the active tab.
    return {
      ...dataset,
      period: String(focusYear),
      // Avoid tab-driven month differences in fallback mode.
      month: null,
    };
  }, [dataset, shouldPinToLatestYear, focusYear]);

  const datasetKey = useMemo(() => {
    const d = effectiveDataset || ({} as any);
    const periods = Array.isArray(d.periods)
      ? d.periods
          .map((p: any) => String(p || "").trim())
          .filter(Boolean)
          .sort((a: string, b: string) => {
            const na = Number(a);
            const nb = Number(b);
            if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
            return a.localeCompare(b);
          })
      : [];

    const period = String(d.period || "").trim();

    return JSON.stringify({
      source_id: String(d.source_id ?? "").trim(),
      type: String(d.type || "").trim().toLowerCase(),
      period,
      periods,
      month: d.month ?? null,
      geo: String(d.geo || "").trim().toLowerCase(),
      group: String(d.group || "").trim().toLowerCase(),
      code_hs: String(d.code_hs || "").trim().toLowerCase(),
      pod: String(d.pod || "").trim().toLowerCase(),
      ctr: String(d.ctr || "").trim().toLowerCase(),
      metric: String(d.metric || "").trim().toLowerCase(),
    });
  }, [
    effectiveDataset?.source_id,
    effectiveDataset?.type,
    effectiveDataset?.period,
    effectiveDataset?.month,
    effectiveDataset?.geo,
    effectiveDataset?.group,
    effectiveDataset?.code_hs,
    effectiveDataset?.pod,
    effectiveDataset?.ctr,
    effectiveDataset?.metric,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    JSON.stringify(effectiveDataset?.periods || []),
  ]);

  const requestKey = useMemo(() => {
    return JSON.stringify({
      q: String(q || "").trim(),
      datasetKey,
      // Include only lightweight preview identity. Exclude tab-driven preview.period.
      source: String(preview?.source || "").trim(),
      type: String(preview?.type || "").trim().toLowerCase(),
    });
  }, [q, datasetKey, preview?.source, preview?.type]);

  const requestBody = useMemo(() => {
    return {
      q,
      dataset: effectiveDataset,
      preview: {
        ...preview,
        columns: Array.isArray(preview.columns) ? preview.columns : [],
        // Use client-side data only - ensures interpretation matches what's displayed in table
        sampleRows: Array.isArray(preview.sampleRows) ? preview.sampleRows : [],
        // Signal to API that client data should be used (skip server re-fetch)
        useClientData: true,
      },
      chart: chartHint,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, datasetKey, preview.source, preview.last_update, preview.type, effectiveDataset]);

  useEffect(() => {
    let cancelled = false;
    let retryCount = 0;
    const MAX_RETRIES = 3;

    const cached = cacheRef.current.get(requestKey);
    if (cached) {
      setData(cached);
      setLoading(false);
      onComplete?.();
      return;
    }

    async function attemptFetch(): Promise<InsightResponse | null> {
      try {
        const res = await fetch("/api/insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });
        const json = (await res.json()) as InsightResponse;
        return json;
      } catch {
        return null;
      }
    }

    async function run() {
      setLoading(true);
      
      while (retryCount < MAX_RETRIES && !cancelled) {
        const result = await attemptFetch();
        
        if (cancelled) return;
        
        if (result && result.ok) {
          cacheRef.current.set(requestKey, result);
          setData(result);
          setLoading(false);
          onComplete?.();
          return;
        }
        
        retryCount++;
        
        if (retryCount < MAX_RETRIES) {
          // Exponential backoff: 1s, 2s, 4s
          const delay = Math.pow(2, retryCount - 1) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      
      // All retries exhausted or cancelled
      if (!cancelled) {
        setData(null);
        setLoading(false);
        onComplete?.();
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [requestBody, requestKey, onComplete, retryKey]);

  // Get insights array or fall back to bullets
  const insights = data?.interpretation?.insights || [];
  const bullets = data?.interpretation?.bullets || [];
  const hasNewFormat = insights.length > 0;

  // Confidence badge styling
  const confidenceConfig = {
    high: { label: "Tinggi", color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
    medium: { label: "Sedang", color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
    low: { label: "Rendah", color: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400" },
  };
  const confidence = data?.interpretation?.confidence || "medium";
  const confidenceBadge = confidenceConfig[confidence];

  // Show skeleton while loading
  if (loading) {
    return <InterpretationSkeleton />;
  }

  // Show error state with retry option if no data after retries
  if (!data && !loading) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-white/90">Interpretasi</h3>
        <div className="mt-4 flex flex-col items-center justify-center py-6 text-center">
          <svg className="h-10 w-10 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Gagal memuat interpretasi</p>
          <button
            type="button"
            onClick={() => {
              // Clear cache and trigger re-fetch
              cacheRef.current.delete(requestKey);
              setRetryKey((k) => k + 1);
            }}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Coba Lagi
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-white/90">
            {data?.interpretation?.title || "Interpretasi"}
          </h3>
          {data?.mode === "ai" && (
            <span className="mt-1 inline-flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
              <span>🤖</span>
              <span>AI-assisted</span>
            </span>
          )}
        </div>
        {data?.interpretation?.confidence && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${confidenceBadge.color}`}>
            {confidenceBadge.label}
          </span>
        )}
      </div>

      {/* Headline Card */}
      {data?.interpretation?.headline && (
        <div className="mt-3 rounded-xl bg-gradient-to-r from-brand-50 to-blue-50 p-3 dark:from-brand-900/20 dark:to-blue-900/20">
          <div className="text-xl font-bold text-gray-900 dark:text-white">
            {data.interpretation.headline}
          </div>
          {data.interpretation.subheadline && (
            <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {data.interpretation.subheadline}
            </div>
          )}
        </div>
      )}

      {/* Insights with Icons (New Format) */}
      {hasNewFormat && (
        <div className="mt-4 space-y-3">
          {insights.slice(0, 7).map((insight, idx) => (
            <div key={idx} className="flex gap-3">
              <span className="shrink-0 text-base" title={insight.label}>
                {insight.icon}
              </span>
              <div className="min-w-0 flex-1">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {insight.label}
                </span>
                <p className="mt-0.5 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                  {insight.text}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Bullets (Fallback/Old Format) */}
      {!hasNewFormat && bullets.length > 0 && (
        <div className="mt-3 space-y-3">
          {bullets.slice(0, 7).map((b, idx) => (
            <div key={idx} className="flex min-w-0 gap-2 text-sm leading-6 text-gray-700 dark:text-gray-300">
              <span className="mt-[2px] text-gray-400 dark:text-gray-500">•</span>
              <span className="min-w-0 break-words">{b}</span>
            </div>
          ))}
        </div>
      )}

      {/* Footer: Methodology + Disclaimer */}
      {(data?.interpretation?.methodology || data?.interpretation?.disclaimer) && (
        <div className="mt-4 border-t border-gray-100 pt-3 dark:border-gray-800">
          {data.interpretation.methodology && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              📋 {data.interpretation.methodology}
            </p>
          )}
          {data.interpretation.disclaimer && !data.interpretation.methodology && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {data.interpretation.disclaimer}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
