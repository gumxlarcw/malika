/**
 * CandidateSelector - Shows data source candidates with preview modal
 * Extracted from ChatPageClient.tsx
 */

"use client";

import React, { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { useModal } from "@/hooks/useModal";
import { TableIcon, CloseIcon, ExternalLinkIcon, EyeIcon } from "@/components/chat/icons";
import type { MalikaUiMetaV1, CandidateItem } from "@/types/chat";
import { formatCellValue } from "@/lib/chatUtils";
import { CHAT_TEXT } from "@/lib/chatConstants";
import type { TableRow } from "./ChatTableModal";

export interface CandidateSelectorProps {
  ui: MalikaUiMetaV1;
  variant?: "standalone" | "inline";
}

export function CandidateSelector({
  ui,
  variant = "standalone",
}: CandidateSelectorProps) {
  const { isOpen, openModal, closeModal } = useModal();
  const [selectedCandidate, setSelectedCandidate] =
    useState<CandidateItem | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [tableData, setTableData] = useState<{
    columns: string[];
    rows: TableRow[];
    title: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const candidates: CandidateItem[] = Array.isArray(ui?.candidates)
    ? ui.candidates
    : [];
  const query = String(ui?.query || "").trim();

  const fetchDataForCandidate = useCallback(
    async (candidate: CandidateItem) => {
      if (!candidate) return;

      setSelectedCandidate(candidate);
      setLoadingData(true);
      setError(null);
      setTableData(null);
      openModal();

      try {
        // Parse href to get all parameters
        const url = new URL(candidate.href, window.location.origin);
        const sourceId = url.searchParams.get("source_id");
        const period = url.searchParams.get("period");
        const type = url.searchParams.get("type") || candidate.type || "dynamic";
        const month = url.searchParams.get("month");
        const geo = url.searchParams.get("geo");

        // EXIM-specific params
        const group = url.searchParams.get("group");
        const codeHs = url.searchParams.get("code_hs");
        const pod = url.searchParams.get("pod");
        const ctr = url.searchParams.get("ctr");
        const metric = url.searchParams.get("metric");

        if (!sourceId) {
          throw new Error("ID sumber data tidak ditemukan");
        }

        // Use /api/data-preview which proxies to backend
        const apiParams = new URLSearchParams();
        apiParams.set("source_id", sourceId);
        if (type) apiParams.set("type", type);

        // Period handling based on data type
        const typeNorm = type.toLowerCase();
        let resolvedPeriod = period;

        // Auto-discover latest period if missing (common when chat doesn't specify year)
        if (typeNorm !== "static" && !resolvedPeriod) {
          try {
            const periodsRes = await fetch(`/api/periods?source_id=${sourceId}`);
            if (periodsRes.ok) {
              const periodsJson = await periodsRes.json();
              const periods: string[] = (Array.isArray(periodsJson?.periods) ? periodsJson.periods : [])
                .map((p: unknown) => {
                  if (typeof p === "string") return p;
                  const pObj = p as Record<string, unknown>;
                  return pObj?.year || pObj?.th || pObj?.th_id || null;
                })
                .map((y: unknown) => String(y || "").trim())
                .filter((y: string) => /^(19\d{2}|20\d{2}|2100)$/.test(y));
              const sorted = Array.from(new Set(periods)).sort((a, b) => Number(b) - Number(a));
              if (sorted.length > 0) {
                resolvedPeriod = sorted[0];
              }
            }
          } catch {
            // Fall through — data-preview route will also try to resolve
          }

          if (!resolvedPeriod) {
            throw new Error("Periode belum tersedia untuk indikator ini");
          }
        }

        if (typeNorm !== "static" && resolvedPeriod) {
          apiParams.set("period", resolvedPeriod);
        }

        if (month) apiParams.set("month", month);

        // EXIM-specific parameters
        if (typeNorm === "exim") {
          if (group) apiParams.set("group", group);
          if (codeHs) apiParams.set("code_hs", codeHs);
          if (pod) apiParams.set("pod", pod);
          if (ctr) apiParams.set("ctr", ctr);
          if (metric) apiParams.set("metric", metric);
        }

        const apiUrl = `/api/data-preview?${apiParams.toString()}`;

        const res = await fetch(apiUrl);
        if (!res.ok) {
          let errMsg = `Gagal mengambil data (${res.status})`;
          try {
            const errJson = await res.json();
            if (errJson?.message) {
              errMsg = errJson.message;
            } else if (errJson?.detail) {
              errMsg = errJson.detail;
            }
          } catch {
            const errText = await res.text().catch(() => "");
            if (errText) errMsg = errText;
          }
          throw new Error(errMsg);
        }

        const json = await res.json();
        const processed = json?.processed || json?.data || json;

        if (
          processed &&
          Array.isArray(processed.columns) &&
          Array.isArray(processed.data)
        ) {
          setTableData({
            columns: processed.columns.slice(0, 15),
            rows: processed.data.slice(0, 50),
            title: processed.source || candidate.name,
          });
        } else {
          throw new Error("Data tidak tersedia untuk periode ini");
        }
      } catch (err: unknown) {
        // Sanitize error — don't expose internal details to user
        const raw = (err instanceof Error ? err.message : '') || '';
        const userMsg = raw.includes('tidak tersedia') ? raw
          : raw.includes('timeout') || raw.includes('Timeout') ? 'Waktu permintaan habis, coba lagi nanti'
          : raw.includes('Failed to fetch') || raw.includes('NetworkError') ? 'Gagal terhubung ke server'
          : CHAT_TEXT.error;
        setError(userMsg);
      } finally {
        setLoadingData(false);
      }
    },
    [openModal]
  );

  if (candidates.length === 0) {
    if (variant === "inline") return null;
    return (
      <div className="max-w-[min(520px,90vw)] rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
        <div className="text-sm text-gray-600 dark:text-gray-300">
          Tidak ada data yang cocok untuk query: &quot;{query}&quot;
        </div>
      </div>
    );
  }

  const wrapperClass =
    variant === "inline"
      ? ""
      : "rounded-xl border border-gray-200 bg-white p-3 sm:p-4 dark:border-gray-800 dark:bg-gray-950";
  const containerClass =
    variant === "inline" ? "" : "max-w-[min(680px,96vw)] sm:max-w-[min(680px,90vw)]";

  // ---------- Inline variant: compact list matching DataSummaryBubble ----------
  if (variant === "inline") {
    return (
      <div>
        <div className="text-sm leading-relaxed">
          {candidates.slice(0, 3).map((c, idx) => (
            <button
              key={c.id}
              type="button"
              onClick={() => fetchDataForCandidate(c)}
              className={`w-full text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${
                idx > 0 ? "mt-2 pt-2 border-t border-gray-100 dark:border-gray-800" : ""
              }`}
            >
              <div className="text-xs font-semibold text-gray-900 dark:text-white line-clamp-2">
                {c.name}
              </div>
              <div className="mt-0.5 text-xs italic text-gray-500 dark:text-gray-400">
                {c.type} · skor {c.score}
              </div>
            </button>
          ))}
        </div>

        {candidates.length > 3 && (
          <div className="mt-2 text-center text-[11px] text-gray-500 dark:text-gray-400">
            +{candidates.length - 3} data lainnya
          </div>
        )}

        {/* View data button (opens first candidate) */}
        <button
          type="button"
          onClick={() => fetchDataForCandidate(candidates[0])}
          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-600 transition"
        >
          <TableIcon className="h-4 w-4" />
          Lihat Data
        </button>

        {/* Data Modal - shared with standalone */}
        {typeof window !== "undefined" &&
          isOpen &&
          createPortal(
            <div
              role="dialog"
              aria-modal="true"
              className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/50 p-3 sm:p-4"
              onClick={closeModal}
            >
              <div
                className="relative flex h-auto max-h-[calc(100dvh-24px)] w-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900 sm:max-h-[85vh] sm:max-w-[95vw] lg:max-w-[1200px]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-base font-semibold text-gray-900 dark:text-white">
                      {selectedCandidate?.name || "Data Statistik"}
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {tableData ? `${tableData.rows.length} baris` : CHAT_TEXT.loading}
                    </p>
                  </div>
                  <button type="button" onClick={closeModal} className="ml-2 rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
                    <CloseIcon className="h-5 w-5" />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-auto bg-white dark:bg-gray-950">
                  {loadingData && (
                    <div className="flex items-center justify-center py-12">
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
                        {CHAT_TEXT.loading}
                      </div>
                    </div>
                  )}
                  {error && (
                    <div className="p-4">
                      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                        <p className="mb-2">{error}</p>
                        {selectedCandidate?.href && (
                          <a href={selectedCandidate.href} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400">
                            Coba lihat di halaman data →
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                  {tableData && !loadingData && (
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900">
                        <tr>
                          {tableData.columns.map((c) => (
                            <th key={c} className="whitespace-nowrap px-3 py-2.5 sm:px-4 sm:py-3 font-semibold text-gray-700 dark:text-gray-200 text-xs sm:text-sm">{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {tableData.rows.map((r: TableRow, idx: number) => (
                          <tr key={idx} className="border-t border-gray-100 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900/50">
                            {tableData.columns.map((c, cIdx) => (
                              <td key={c} className={`px-3 py-2 sm:px-4 sm:py-2.5 text-gray-800 dark:text-gray-200 text-xs sm:text-sm ${cIdx > 0 ? "text-right font-mono" : ""}`}>
                                {formatCellValue(r?.[c], c)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                {tableData && (
                  <div className="flex shrink-0 items-center justify-between border-t border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
                    <div className="text-xs text-gray-500 dark:text-gray-400">Sumber: BPS Maluku Utara</div>
                    {selectedCandidate?.href && (
                      <a href={selectedCandidate.href} className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 dark:text-brand-400">
                        Buka halaman data
                        <ExternalLinkIcon className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>,
            document.body
          )}
      </div>
    );
  }

  // ---------- Standalone variant: original card layout ----------

  return (
    <div className={containerClass}>
      <div className={wrapperClass}>
        <div className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
          📊 Data yang Ditemukan
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Query: &quot;{query}&quot;
        </div>

        <div className="space-y-2">
          {candidates.slice(0, 3).map((c, idx) => (
            <button
              key={c.id}
              type="button"
              onClick={() => fetchDataForCandidate(c)}
              className="w-full text-left rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 hover:bg-brand-50 hover:border-brand-300 transition dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-brand-950/30 dark:hover:border-brand-700"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-100 line-clamp-2">
                    {idx + 1}. {c.name}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                    <span className="rounded bg-gray-200 px-1.5 py-0.5 font-mono dark:bg-gray-700">
                      {c.type}
                    </span>
                    <span>Skor: {c.score}</span>
                  </div>
                </div>
                <div className="shrink-0">
                  <span className="inline-flex items-center gap-1 rounded-lg bg-brand-500 px-2 py-1.5 text-[11px] font-semibold text-white">
                    <EyeIcon className="h-3 w-3" strokeWidth={1.5} />
                    Lihat
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>

        {candidates.length > 3 && (
          <div className="mt-2 text-center text-[11px] text-gray-500 dark:text-gray-400">
            +{candidates.length - 3} data lainnya
          </div>
        )}
      </div>

      {/* Data Modal */}
      {typeof window !== "undefined" &&
        isOpen &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/50 p-3 sm:p-4"
            onClick={closeModal}
          >
            <div
              className="relative flex h-auto max-h-[calc(100dvh-24px)] w-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900 sm:max-h-[85vh] sm:max-w-[95vw] lg:max-w-[1200px]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal header */}
              <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-base font-semibold text-gray-900 dark:text-white">
                    {selectedCandidate?.name || "Data Statistik"}
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {tableData ? `${tableData.rows.length} baris` : CHAT_TEXT.loading}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeModal}
                  className="ml-2 rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <CloseIcon className="h-5 w-5" />
                </button>
              </div>

              {/* Modal body */}
              <div className="min-h-0 flex-1 overflow-auto bg-white dark:bg-gray-950">
                {loadingData && (
                  <div className="flex items-center justify-center py-12">
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
                      {CHAT_TEXT.loading}
                    </div>
                  </div>
                )}

                {error && (
                  <div className="p-4">
                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                      <p className="mb-2">{error}</p>
                      {selectedCandidate?.href && (
                        <a
                          href={selectedCandidate.href}
                          className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400"
                        >
                          Coba lihat di halaman data →
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {tableData && !loadingData && (
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900">
                      <tr>
                        {tableData.columns.map((c) => (
                          <th
                            key={c}
                            className="whitespace-nowrap px-3 py-2.5 sm:px-4 sm:py-3 font-semibold text-gray-700 dark:text-gray-200 text-xs sm:text-sm"
                          >
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tableData.rows.map((r: any, idx: number) => (
                        <tr
                          key={idx}
                          className="border-t border-gray-100 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900/50"
                        >
                          {tableData.columns.map((c, cIdx) => (
                            <td
                              key={c}
                              className={`px-3 py-2 sm:px-4 sm:py-2.5 text-gray-800 dark:text-gray-200 text-xs sm:text-sm ${cIdx > 0 ? "text-right font-mono" : ""}`}
                            >
                              {formatCellValue(r?.[c], c)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Modal footer */}
              {tableData && (
                <div className="flex shrink-0 items-center justify-between border-t border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Sumber: BPS Maluku Utara
                  </div>
                  {selectedCandidate?.href && (
                    <a
                      href={selectedCandidate.href}
                      className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 dark:text-brand-400"
                    >
                      Buka halaman data
                      <ExternalLinkIcon className="h-3 w-3" />
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

export default CandidateSelector;
