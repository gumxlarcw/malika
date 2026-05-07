/**
 * DataSummaryBubble - Shows data summary in chat with table modal
 * Extracted from ChatPageClient.tsx
 */

"use client";

import React, { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useModal } from "@/hooks/useModal";
import type { MalikaUiMetaV1 } from "@/types/chat";
import { safeHref } from "@/lib/chatUtils";
import { CHAT_TEXT, WHATSAPP_LINK, WHATSAPP_DEFAULT_MESSAGE } from "@/lib/chatConstants";
import { applyTableRowOrdering } from "@/lib/tableRowOrdering";
import { MessageFeedback } from "./MessageFeedback";
import DnaMetadataSection from "./DnaMetadataSection";
import { TableIcon, EyeIcon, WarningIcon } from "@/components/chat/icons";
import type { ModalTableData } from "./ChatTableModal";
import { MiniSparkline, detectSparklineData } from "./MiniSparkline";
import { profileChartData, profileToChartConfig } from "@/lib/chartDataProfiler";

// Lazy-load ChatChart (ApexCharts) — only fetched when LLM chart config is available
const ChatChart = dynamic(() => import("./ChatChart"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-[140px] sm:h-[280px] rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
      <div className="animate-pulse text-xs text-gray-400">Memuat grafik…</div>
    </div>
  ),
});

// Lazy-load ChatTableModal (891 lines) — only fetched when user opens the table detail
const ChatTableModal = dynamic(() => import("./ChatTableModal"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/40">
      <div className="animate-pulse rounded-xl bg-white p-8 dark:bg-gray-800">
        <div className="h-6 w-48 rounded bg-gray-200 dark:bg-gray-700" />
      </div>
    </div>
  ),
});

// Forward declarations for components used inline
// These will be imported from the main file or extracted separately
export interface DataSummaryBubbleProps {
  ui: MalikaUiMetaV1;
  KnowledgeCandidateSelector?: React.ComponentType<{ ui: MalikaUiMetaV1; variant?: "standalone" | "inline" }>;
  ExternalSuggestionsSection?: React.ComponentType<{ ui: MalikaUiMetaV1; variant?: "standalone" | "inline" }>;
  /** Render slot for BRS/Publikasi references (SourcesSection) */
  sourcesSlot?: React.ReactNode;
  /** Render slot for agent recommendations */
  recommendationsSlot?: React.ReactNode;
}

/**
 * Generate summary text from table data
 */
function generateTableSummary(table: MalikaUiMetaV1["table"], table2?: MalikaUiMetaV1["table"]): string {
  if (!table || !table.columns?.length || !table.rows?.length) {
    if (table2 && table2.columns?.length && table2.rows?.length) {
      // Only table2 has data
      const totalRows2 = table2.total_rows || table2.rows.length;
      return `**${table2.title || "Data Statistik"}**\n\n_${totalRows2} baris data tersedia_`;
    }
    return CHAT_TEXT.noDataAvailable;
  }

  const totalRows = table.total_rows || table.rows.length;

  const hasTable2 = table2 && table2.columns?.length && table2.rows?.length;

  const lines: string[] = [];
  const t1Label = hasTable2 ? `Tabel 1. ${table.title || "Data Statistik"}` : (table.title || "Data Statistik");
  lines.push(`**${t1Label}**`);
  lines.push("");
  lines.push(`_${totalRows} baris data tersedia_`);

  // If there's a second table, include its summary
  if (hasTable2) {
    const totalRows2 = table2!.total_rows || table2!.rows.length;
    lines.push("");
    lines.push(`**Tabel 2. ${table2!.title || "Data Statistik"}**`);
    lines.push("");
    lines.push(`_${totalRows2} baris data tersedia_`);
  }

  return lines.join("\n");
}

export function DataSummaryBubble({ 
  ui, 
  KnowledgeCandidateSelector,
  ExternalSuggestionsSection,
  sourcesSlot,
  recommendationsSlot,
}: DataSummaryBubbleProps) {
  const { isOpen, openModal, closeModal } = useModal();
  const [selectedTableIdx, setSelectedTableIdx] = useState(0);

  const openModalTab = useCallback((tabIdx: number) => {
    setSelectedTableIdx(tabIdx);
    openModal();
  }, [openModal]);

  const table = ui.table;
  const table2 = ui.table2;
  const cols = Array.isArray(table?.columns) ? table!.columns : [];
  const rawRows = Array.isArray(table?.rows) ? table!.rows : [];
  const cols2 = Array.isArray(table2?.columns) ? table2!.columns : [];
  const rawRows2 = Array.isArray(table2?.rows) ? table2!.rows : [];

  // Apply BPS standard ordering: kab/kota in code order, province (Maluku Utara) last
  const rows = useMemo(() => {
    if (rawRows.length === 0 || cols.length === 0) return rawRows;
    return applyTableRowOrdering({
      rows: rawRows,
      columns: cols,
      title: table?.title || "",
    });
  }, [rawRows, cols, table?.title]);

  const rows2 = useMemo(() => {
    if (rawRows2.length === 0 || cols2.length === 0) return rawRows2;
    return applyTableRowOrdering({
      rows: rawRows2,
      columns: cols2,
      title: table2?.title || "",
    });
  }, [rawRows2, cols2, table2?.title]);

  const hasData = cols.length > 0 && rows.length > 0;
  const hasData2 = cols2.length > 0 && rows2.length > 0;
  const hasAnyData = hasData || hasData2;
  const summary = hasAnyData ? generateTableSummary(table, table2) : CHAT_TEXT.noDataAvailable;

  const links = Array.isArray(ui?.links) ? ui.links : [];
  const hasKnowledgeCandidates =
    Array.isArray(ui?.knowledgeCandidates) && ui.knowledgeCandidates.length > 0;

  // ── Chart resolution cascade: LLM Agent → Rule-based profiler → MiniSparkline ──
  const llmChartConfig = ui.chart;
  const hasLLMChart = llmChartConfig?.should_render === true && (llmChartConfig.series?.length ?? 0) > 0;

  // Fallback: rule-based profiler generates ChartAgentOutput-compatible config
  const profilerChartConfig = useMemo(() => {
    try {
      if (hasLLMChart) return null; // LLM chart takes priority
      if (!hasData || rows.length <= 2) return null;
      const result = profileChartData(cols, rows);
      return profileToChartConfig(result, table?.title || undefined);
    } catch {
      return null; // Graceful fallback — never crash the bubble
    }
  }, [hasLLMChart, hasData, cols, rows, table?.title]);

  // Active chart config: LLM > rule-based profiler > null
  const chartConfig = hasLLMChart ? llmChartConfig : profilerChartConfig;
  const hasFullChart = chartConfig?.should_render === true && (chartConfig.series?.length ?? 0) > 0;

  // Sparkline: last resort when no full chart available
  const sparklineData = useMemo(() => {
    if (hasFullChart) return null;
    if (!hasData) return null;
    return detectSparklineData(cols, rows);
  }, [hasFullChart, hasData, cols, rows]);

  // Show chart by default (full chart, or sparkline)
  const [showChart, setShowChart] = useState(true);
  const hasAnyChart = hasFullChart || sparklineData;

  // Build table array for ChatTableModal
  const modalTables = useMemo<ModalTableData[]>(() => {
    const result: ModalTableData[] = [];
    if (hasData) {
      result.push({
        title: table?.title,
        columns: cols,
        rows,
        total_rows: table?.total_rows,
        eximMode: table?.eximMode,
        eximGroup: table?.eximGroup,
        bps_web_url: table?.bps_web_url,
        // Year-tab data
        source_id: table?.source_id,
        allRows: table?.allRows,
        allColumns: table?.allColumns,
        availableYears: table?.availableYears,
        defaultYear: table?.defaultYear,
      });
    }
    if (hasData2) {
      result.push({
        title: table2?.title,
        columns: cols2,
        rows: rows2,
        total_rows: table2?.total_rows,
        eximMode: table2?.eximMode,
        eximGroup: table2?.eximGroup,
        bps_web_url: table2?.bps_web_url,
        // Year-tab data
        source_id: table2?.source_id,
        allRows: table2?.allRows,
        allColumns: table2?.allColumns,
        availableYears: table2?.availableYears,
        defaultYear: table2?.defaultYear,
      });
    }
    return result;
  }, [hasData, hasData2, cols, rows, cols2, rows2, table, table2]);

  return (
    <div className="max-w-[min(680px,96vw)] sm:max-w-[min(680px,90vw)]">
      {/* Confidence indicator (OpenClaw-inspired) */}
      {ui.confidence && (
        <div
          className={`
          inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium mb-2
          ${
            ui.confidence.level === "high"
              ? "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300"
              : ui.confidence.level === "medium"
                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
                : "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300"
          }
        `}
        >
          <span
            className={`
            w-1.5 h-1.5 rounded-full
            ${
              ui.confidence.level === "high"
                ? "bg-green-500"
                : ui.confidence.level === "medium"
                  ? "bg-amber-500"
                  : "bg-red-500"
            }
          `}
          />
          {ui.confidence.level === "high"
            ? "Relevansi Tinggi"
            : ui.confidence.level === "medium"
              ? "Relevansi Sedang"
              : "Relevansi Rendah"}
        </div>
      )}

      {/* Table data section — unified Tabel Data cards (single or dual) */}
      <div className="Bubble text">
        {/* Metadata Statistik — DNA Nucleus BPS (moved above table) */}
        <DnaMetadataSection dnaMetadata={ui.dnaMetadata} />

        {hasAnyData ? (
          <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50/50 p-3 dark:border-brand-800 dark:bg-brand-950/30">
            <div className="text-xs font-semibold text-brand-700 dark:text-brand-200 mb-2 flex items-center gap-1.5">
              <TableIcon className="h-3.5 w-3.5" />
              Tabel Data
              {/* Chart/Table toggle when any chart is available */}
              {hasAnyChart && (
                <button
                  type="button"
                  onClick={() => setShowChart((v) => !v)}
                  className="ml-auto flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium text-brand-600 hover:bg-brand-100 dark:text-brand-300 dark:hover:bg-brand-900/40 transition-colors"
                >
                  {showChart ? "📋 Tabel" : "📈 Grafik"}
                </button>
              )}
            </div>

            {/* Full chart: LLM Agent config or rule-based profiler fallback */}
            {hasFullChart && showChart && (
              <div className="mb-2">
                <ChatChart
                  config={chartConfig!}
                  rows={rows}
                  columns={cols}
                />
              </div>
            )}

            {/* Last resort: inline sparkline (when no full chart available) */}
            {!hasFullChart && sparklineData && showChart && (
              <div className="mb-2">
                <MiniSparkline
                  values={sparklineData.values}
                  labels={sparklineData.labels}
                  title={sparklineData.title}
                  color="#6366f1"
                />
              </div>
            )}

            <div className="space-y-1.5">
              {/* Table 1 card */}
              {hasData && (
                <button
                  type="button"
                  onClick={() => openModalTab(0)}
                  className={`block w-full text-left rounded-lg border px-3 py-2 hover:border-brand-400 transition cursor-pointer ${
                    table?.eximMode === 'ekspor'
                      ? 'border-brand-200 bg-brand-50/50 hover:bg-brand-100 dark:border-brand-700 dark:bg-brand-950/20 dark:hover:bg-brand-950/40'
                      : 'border-blue-200 bg-blue-50/50 hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-950/20 dark:hover:bg-blue-950/40'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">{table?.eximMode === 'ekspor' ? '📤' : '📊'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[10px] font-semibold uppercase ${
                          table?.eximMode === 'ekspor'
                            ? 'text-brand-600 dark:text-brand-400'
                            : 'text-blue-600 dark:text-blue-400'
                        }`}>
                          {table?.eximMode === 'ekspor' ? 'Ekspor' : hasData2 ? 'Tabel 1' : 'Tabel'}
                        </span>
                        <span className="text-[9px] text-gray-400 dark:text-gray-500">
                          {rows.length} baris
                        </span>
                      </div>
                      <div className="text-xs text-gray-700 dark:text-gray-300 mt-0.5">
                        {table?.title || 'Data Statistik'}
                      </div>
                    </div>
                    <EyeIcon className="h-4 w-4 flex-shrink-0 text-gray-400" />
                  </div>
                </button>
              )}

              {/* Table 2 card */}
              {hasData2 && (
                <button
                  type="button"
                  onClick={() => openModalTab(hasData ? 1 : 0)}
                  className={`block w-full text-left rounded-lg border px-3 py-2 hover:border-emerald-400 transition cursor-pointer ${
                    table2?.eximMode === 'impor'
                      ? 'border-emerald-200 bg-emerald-50/50 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/40'
                      : 'border-indigo-200 bg-indigo-50/50 hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-950/20 dark:hover:bg-indigo-950/40'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">{table2?.eximMode === 'impor' ? '📥' : '📊'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[10px] font-semibold uppercase ${
                          table2?.eximMode === 'impor'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-indigo-600 dark:text-indigo-400'
                        }`}>
                          {table2?.eximMode === 'impor' ? 'Impor' : 'Tabel 2'}
                        </span>
                        <span className="text-[9px] text-gray-400 dark:text-gray-500">
                          {rows2.length} baris
                        </span>
                      </div>
                      <div className="text-xs text-gray-700 dark:text-gray-300 mt-0.5">
                        {table2?.title || 'Data Statistik'}
                      </div>
                    </div>
                    <EyeIcon className="h-4 w-4 flex-shrink-0 text-gray-400" />
                  </div>
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="text-sm text-gray-700 dark:text-gray-200">{summary}</div>
        )}

        {/* Fallback escalation for low confidence (OpenClaw-inspired) */}
        {ui.confidence?.level === "low" && !hasData && (
          <div className="mt-3 p-3 rounded-lg border border-amber-200 bg-amber-50/80 dark:border-amber-800 dark:bg-amber-950/30">
            <div className="flex items-start gap-2">
              <WarningIcon className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-medium text-amber-800 dark:text-amber-200">
                  Tidak yakin dengan hasil pencarian?
                </div>
                <div className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                  Jika informasi yang Anda cari belum ditemukan, hubungi petugas
                  BPS Maluku Utara untuk bantuan lebih lanjut.
                </div>
                <a
                  href={`${WHATSAPP_LINK}?text=${WHATSAPP_DEFAULT_MESSAGE}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-100 rounded-lg hover:bg-green-200 dark:bg-green-900/50 dark:text-green-300 dark:hover:bg-green-900/70 transition"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                  </svg>
                  Hubungi via WhatsApp
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Quick links if available */}
        {links.length > 0 && (
          <div className="mt-3 border-t border-gray-100 pt-2 dark:border-gray-700">
            <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">
              Link Cepat
            </div>
            <div className="flex flex-wrap gap-1">
              {links.slice(0, 3).map((l, idx) => {
                const href = safeHref((l as any)?.href);
                const label = String((l as any)?.label || "").trim() || "Link";
                if (!href) return null;
                return (
                  <a
                    key={idx}
                    href={href}
                    className="inline-flex items-center rounded bg-gray-100 px-2 py-1 text-[11px] text-brand-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-brand-400 dark:hover:bg-gray-700"
                  >
                    {label}
                  </a>
                );
              })}
            </div>
          </div>
        )}

        {/* Inline sections — same padding as table section */}

        {/* Knowledge candidates */}
        {hasKnowledgeCandidates && KnowledgeCandidateSelector && (
          <KnowledgeCandidateSelector ui={ui} variant="inline" />
        )}

        {/* External suggestions */}
        {ExternalSuggestionsSection && (
          <ExternalSuggestionsSection ui={ui} variant="inline" />
        )}

        {/* BRS & Publikasi references */}
        {sourcesSlot}

        {/* Agent recommendations */}
        {recommendationsSlot}

        {/* BPS Contact — WhatsApp escalation (always shown) */}
        <div className="mt-3 border-t border-gray-100 pt-2.5 dark:border-gray-800">
          <div className="flex items-center gap-2 rounded-lg bg-green-50/60 px-3 py-2 dark:bg-green-950/20 border border-green-100 dark:border-green-900/30">
            <svg className="h-4 w-4 flex-shrink-0 text-green-600 dark:text-green-400" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
            <div className="flex-1 min-w-0">
              <span className="text-[11px] text-gray-600 dark:text-gray-400">
                Butuh bantuan lebih lanjut?{" "}
              </span>
              <a
                href={`${WHATSAPP_LINK}?text=${WHATSAPP_DEFAULT_MESSAGE}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-medium text-green-700 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300 hover:underline"
              >
                Hubungi BPS Maluku Utara via WhatsApp
              </a>
            </div>
          </div>
        </div>

        {/* Message feedback */}
        <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
          <MessageFeedback messageId={`data-${ui?.query || "unknown"}`} />
        </div>
      </div>

      {/* Full table modal - ChatTableModal handles portal + all features */}
      <ChatTableModal
        tables={modalTables[selectedTableIdx] ? [modalTables[selectedTableIdx]] : modalTables}
        isOpen={isOpen}
        onClose={closeModal}
      />
    </div>
  );
}

export default DataSummaryBubble;
