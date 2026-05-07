"use client";

import React, { useMemo, useRef, useCallback, useState, useEffect } from "react";
import EmptyState from "@/components/common/EmptyState";
import InterpretationPanel, { type InsightResponse } from "@/components/search/InterpretationPanel";
import SearchInsightsChart from "@/components/search/SearchInsightsChart";
import { normalizeTableData, extractUnitFromTitle } from "@/lib/tableRowOrdering";
import { DATA_INSIGHT_ENABLED } from "@/lib/featureFlags";

// Download utilities
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadCsv(
  columns: string[],
  rows: Record<string, unknown>[],
  filename: string,
  formatCell: (column: string, row: Record<string, unknown>) => string
) {
  const escape = (v: unknown) => {
    const s = String(v ?? "").replace(/"/g, '""');
    return `"${s}"`;
  };
  const header = columns.map(escape).join(",");
  const body = rows.map((row) => columns.map((c) => escape(formatCell(c, row))).join(",")).join("\n");
  const csv = `${header}\n${body}`;
  downloadBlob(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8;" }), filename);
}

function downloadJson(data: unknown, filename: string) {
  downloadBlob(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    filename
  );
}

async function downloadExcel(
  columns: string[],
  rows: Record<string, unknown>[],
  filename: string,
  numericColumns: Set<string>,
  formatCell: (column: string, row: Record<string, unknown>) => string
) {
  // Dynamically import exceljs (same as SearchPageClient)
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Data");

  // Add headers
  worksheet.addRow(columns);

  // Helper to parse numbers
  const toNumberLoose = (v: unknown): number | null => {
    if (v === null || v === undefined) return null;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    const s = String(v).trim();
    if (!s) return null;
    let cleaned = s.replace(/[^0-9,\.\-+]/g, "");
    if (!cleaned) return null;
    const hasComma = cleaned.includes(",");
    const hasDot = cleaned.includes(".");
    if (hasComma && hasDot) {
      const lastComma = cleaned.lastIndexOf(",");
      const lastDot = cleaned.lastIndexOf(".");
      const decimalSep = lastComma > lastDot ? "," : ".";
      const thousandSep = decimalSep === "," ? "." : ",";
      cleaned = cleaned.split(thousandSep).join("");
      if (decimalSep === ",") cleaned = cleaned.replace(/,/g, ".");
    } else if (hasComma) {
      const last = cleaned.lastIndexOf(",");
      const frac = cleaned.slice(last + 1);
      if (frac.length >= 1 && frac.length <= 2) {
        cleaned = cleaned.replace(/\./g, "").replace(/,/g, ".");
      } else {
        cleaned = cleaned.replace(/,/g, "");
      }
    } else if (hasDot) {
      const last = cleaned.lastIndexOf(".");
      const frac = cleaned.slice(last + 1);
      if (!(frac.length >= 1 && frac.length <= 2)) {
        cleaned = cleaned.replace(/\./g, "");
      }
    }
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return null;
    return n;
  };

  // Add data rows
  for (const r of rows) {
    const row: any[] = [];
    for (const c of columns) {
      const raw = r[c];
      if (numericColumns.has(c)) {
        const n = toNumberLoose(raw);
        row.push(n === null ? formatCell(c, r) : n);
      } else {
        row.push(formatCell(c, r));
      }
    }
    worksheet.addRow(row);
  }

  const buf = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  downloadBlob(blob, filename);
}

async function downloadPdf(
  columns: string[],
  rows: Record<string, unknown>[],
  title: string,
  filename: string,
  formatCell: (column: string, row: Record<string, unknown>) => string
) {
  // Dynamically import jspdf and autotable
  const { jsPDF } = await import("jspdf");
  const autoTableMod = await import("jspdf-autotable");
  const autoTable = (autoTableMod as any).default as any;
  
  const orientation = columns.length > 6 ? "landscape" : "portrait";
  const doc = new jsPDF({ orientation, unit: "pt", format: "a4" });
  const pageWidth = orientation === "landscape" ? 842 : 595;
  const marginX = 40;
  const maxWidth = pageWidth - marginX * 2;
  
  doc.setFontSize(10);
  doc.text(title, marginX, 28, { maxWidth });
  
  const body = rows.slice(0, 200).map((r) => columns.map((c) => formatCell(c, r)));
  
  autoTable(doc, {
    head: [columns],
    body,
    startY: 54,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [245, 245, 245], textColor: 30 },
  });
  
  doc.save(filename);
}

// Type for year data from server
type YearData = {
  year: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  lastUpdate: string | null;
};

interface DataPageClientProps {
  allYearsData: YearData[];
  sourceId: number;
  sourceType: "dynamic" | "interop" | "exim" | "static";
  sourceName: string;
  initialYear: string;
  availableYears: string[];
  monthNo?: number | null;
  geo?: string | null;
  geoApplied?: boolean;
  chartConfig?: any;
  q?: string;
  unit?: string | null;
}

// Number formatting function
function formatNumberId(input: unknown): string | null {
  const toNumberLoose = (v: unknown): number | null => {
    if (v === null || v === undefined) return null;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    const s = String(v).trim();
    if (!s) return null;

    let cleaned = s.replace(/[^0-9,\.\-+]/g, "");
    if (!cleaned) return null;

    const hasComma = cleaned.includes(",");
    const hasDot = cleaned.includes(".");

    const normalizeSingleDecimalDot = (input: string) => {
      const idx = input.lastIndexOf(".");
      if (idx <= 0) return input;
      const head = input.slice(0, idx).replace(/\./g, "");
      const tail = input.slice(idx);
      return head + tail;
    };

    if (hasComma && hasDot) {
      const lastComma = cleaned.lastIndexOf(",");
      const lastDot = cleaned.lastIndexOf(".");
      const decimalSep = lastComma > lastDot ? "," : ".";
      const thousandSep = decimalSep === "," ? "." : ",";
      cleaned = cleaned.split(thousandSep).join("");
      if (decimalSep === ",") cleaned = cleaned.replace(/,/g, ".");
      cleaned = normalizeSingleDecimalDot(cleaned);
    } else if (hasComma) {
      const last = cleaned.lastIndexOf(",");
      const frac = cleaned.slice(last + 1);
      if (frac.length >= 1 && frac.length <= 2) {
        cleaned = cleaned.replace(/\./g, "").replace(/,/g, ".");
        cleaned = normalizeSingleDecimalDot(cleaned);
      } else {
        cleaned = cleaned.replace(/,/g, "");
      }
    } else if (hasDot) {
      const last = cleaned.lastIndexOf(".");
      const frac = cleaned.slice(last + 1);
      if (frac.length >= 1 && frac.length <= 2) {
        cleaned = cleaned.replace(/,/g, "");
        cleaned = normalizeSingleDecimalDot(cleaned);
      } else {
        cleaned = cleaned.replace(/\./g, "");
      }
    }

    const n = Number(cleaned);
    if (!Number.isFinite(n)) return null;
    return n;
  };

  const n = toNumberLoose(input);
  if (n === null) return null;
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function monthNameFromNo(monthNo: number): string | null {
  const map: Record<number, string> = {
    1: "Januari",
    2: "Februari",
    3: "Maret",
    4: "April",
    5: "Mei",
    6: "Juni",
    7: "Juli",
    8: "Agustus",
    9: "September",
    10: "Oktober",
    11: "November",
    12: "Desember",
  };
  return map[monthNo] || null;
}

function matchesMonthCell(val: unknown, month: number): boolean {
  const s = String(val ?? "").toLowerCase().trim();
  const monthNames = [
    "", "januari", "februari", "maret", "april", "mei", "juni",
    "juli", "agustus", "september", "oktober", "november", "desember"
  ];
  const monthAbbr = [
    "", "jan", "feb", "mar", "apr", "mei", "jun", "jul", "agu", "sep", "okt", "nov", "des"
  ];
  
  if (month >= 1 && month <= 12) {
    if (s === monthNames[month] || s.startsWith(monthNames[month])) return true;
    if (s === monthAbbr[month] || s.startsWith(monthAbbr[month])) return true;
    if (s === String(month) || s === String(month).padStart(2, "0")) return true;
  }
  return false;
}

function detectNumericColumns(rows: Record<string, unknown>[], columns: string[]): Set<string> {
  const result = new Set<string>();
  if (!Array.isArray(rows) || rows.length === 0) return result;

  for (const col of columns) {
    let numericCount = 0;
    let totalValid = 0;
    const sampleSize = Math.min(rows.length, 20);

    for (let i = 0; i < sampleSize; i++) {
      const v = rows[i]?.[col];
      if (v === null || v === undefined || String(v).trim() === "") continue;
      totalValid++;
      const s = String(v).trim();
      // Check if it looks numeric (with Indonesian/US number formats)
      if (/^[\d\s,.\-+]+$/.test(s) && /\d/.test(s)) {
        numericCount++;
      }
    }

    // If more than 60% of sampled values are numeric, consider column numeric
    if (totalValid > 0 && numericCount / totalValid >= 0.6) {
      result.add(col);
    }
  }

  return result;
}

// EXIM helpers
function eximColumnLabel(col: string, mode: "impor" | "ekspor" | null): string {
  const key = String(col || "").trim().toLowerCase();
  if (key === "pod") return "Pelabuhan";
  if (key === "ctr") return mode === "impor" ? "Negara Asal" : mode === "ekspor" ? "Negara Tujuan" : "Negara";
  if (key === "kodehs") return "Komoditas";
  if (key === "value") return "Nilai (US$)";
  if (key === "netweight") return "Volume (Kg)";
  return col;
}

function eximCellValue(col: string, value: unknown): string {
  const key = String(col || "").trim().toLowerCase();
  const raw = String(value ?? "").trim();

  if (key === "pod") {
    if (raw === "-" || raw === "") return "Semua Pelabuhan";
    return raw;
  }
  if (key === "ctr") {
    if (raw === "-" || raw === "") return "Semua Negara";
    return raw;
  }
  if (key === "kodehs") {
    if (/^all\s*hs/i.test(raw)) return "Semua Komoditas";
    if (raw === "-" || raw === "") return "Semua Komoditas";
    return raw;
  }
  if (key === "value" || key === "netweight") {
    const formatted = formatNumberId(value);
    return formatted ?? (raw || "-");
  }

  return raw || "-";
}

function detectEximModeFromName(name: string): "impor" | "ekspor" | null {
  const raw = String(name || "").toLowerCase();
  if (raw.includes("impor")) return "impor";
  if (raw.includes("ekspor")) return "ekspor";
  return null;
}

export default function DataPageClient({
  allYearsData,
  sourceId,
  sourceType,
  sourceName,
  initialYear,
  availableYears,
  monthNo,
  geo,
  geoApplied,
  chartConfig,
  q,
  unit,
}: DataPageClientProps) {
  // Client-side year selection (no navigation needed)
  const [selectedYear, setSelectedYear] = useState(initialYear);
  const insightsCacheRef = useRef<Map<string, InsightResponse>>(new Map());
  const [downloadOpen, setDownloadOpen] = useState(false);
  const downloadMenuRef = useRef<HTMLDivElement>(null);
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const columnMenuRef = useRef<HTMLDivElement>(null);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});

  // Get current year's data
  const currentYearData = useMemo(() => {
    return allYearsData.find((d) => d.year === selectedYear) || allYearsData[0];
  }, [allYearsData, selectedYear]);

  const columns = currentYearData?.columns || [];
  const rowsRaw = currentYearData?.rows || [];
  const lastUpdate = currentYearData?.lastUpdate || null;
  const visibleColumns = columns.filter((c) => !hiddenColumns.includes(c));

  // Normalize data if there's a scale mismatch (e.g., 1282937 vs 1337.2 when unit is "ribu jiwa")
  const unitFromTitle = extractUnitFromTitle(sourceName);
  const normalizationResult = useMemo(() => {
    return normalizeTableData(rowsRaw, unitFromTitle);
  }, [rowsRaw, unitFromTitle]);
  const rows = normalizationResult.rows as Record<string, unknown>[];
  if (normalizationResult.normalized) {
    console.log('[Normalization] Applied:', normalizationResult.details);
  }

  useEffect(() => {
    setHiddenColumns((prev) => prev.filter((c) => columns.includes(c)));
    setColumnWidths((prev) => {
      const next: Record<string, number> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (columns.includes(k)) next[k] = v;
      }
      return next;
    });
  }, [columns.join("|")]);

  // Combine all rows from all years for interpretation context
  const allRowsCombined = useMemo(() => {
    const combined: Array<Record<string, unknown>> = [];
    for (const yearData of allYearsData) {
      for (const row of yearData.rows) {
        combined.push({ ...row, __year: yearData.year });
      }
    }
    // Normalize combined rows for interpretation
    const normalized = normalizeTableData(combined, unitFromTitle);
    return normalized.rows;
  }, [allYearsData, unitFromTitle]);

  const hasMonth = typeof monthNo === "number" && monthNo >= 1 && monthNo <= 12;
  const isExim = sourceType === "exim";
  const eximMode = isExim ? detectEximModeFromName(sourceName) : null;

  // Detect numeric columns for formatting
  const numericColumns = useMemo(() => {
    if (isExim) {
      // EXIM has specific numeric columns
      return new Set(["value", "netweight"]);
    }
    return detectNumericColumns(rows, columns);
  }, [rows, columns, isExim]);

  // Find month key column
  const monthKeyCol = useMemo(() => {
    return (
      columns.find((c) => /^(bulan|month)$/i.test(String(c).trim())) ||
      columns.find((c) => /(bulan|month)/i.test(String(c).trim())) ||
      columns[0]
    );
  }, [columns]);

  // Close download menu on outside click
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (downloadMenuRef.current && !downloadMenuRef.current.contains(e.target as Node)) {
        setDownloadOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (columnMenuRef.current && !columnMenuRef.current.contains(e.target as Node)) {
        setColumnMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Format cell value
  const formatCell = useCallback((column: string, row: Record<string, unknown>) => {
    const value = row[column];
    
    if (isExim) {
      return eximCellValue(column, value);
    }

    if (value === null || value === undefined || String(value).trim() === "") {
      return "-";
    }

    if (numericColumns.has(column)) {
      return formatNumberId(value) ?? String(value);
    }

    return String(value);
  }, [isExim, numericColumns]);

  // Format header
  const formatHeader = useCallback((column: string) => {
    if (isExim) {
      return eximColumnLabel(column, eximMode);
    }
    return column;
  }, [isExim, eximMode]);

  // Get row class for month highlighting
  const getRowClass = useCallback((row: Record<string, unknown>, _idx: number) => {
    if (!hasMonth || !monthKeyCol) return "";
    const monthHit = matchesMonthCell(row[monthKeyCol], monthNo!);
    return monthHit ? "bg-brand-50/70 dark:bg-brand-500/10" : "";
  }, [hasMonth, monthKeyCol, monthNo]);

  // Get cell class for month highlighting
  const getCellClass = useCallback((column: string, row: Record<string, unknown>) => {
    if (!hasMonth || !monthKeyCol) return "";
    const monthHit = matchesMonthCell(row[monthKeyCol], monthNo!);
    if (!monthHit) return "";
    if (column === monthKeyCol) {
      return "font-semibold border-l-4 border-brand-500 pl-3";
    }
    return "font-semibold";
  }, [hasMonth, monthKeyCol, monthNo]);

  // Download handlers
  const handleDownload = useCallback(async (format: "excel" | "csv" | "pdf" | "json") => {
    setDownloadOpen(false);
    const sanitizedName = sourceName.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 50);
    const filename = `${sanitizedName}_${selectedYear}`;
    
    try {
      switch (format) {
        case "excel":
          await downloadExcel(columns, rows, `${filename}.xlsx`, numericColumns, formatCell);
          break;
        case "csv":
          downloadCsv(columns, rows, `${filename}.csv`, formatCell);
          break;
        case "pdf":
          await downloadPdf(columns, rows, `${sourceName} - ${selectedYear}`, `${filename}.pdf`, formatCell);
          break;
        case "json":
          downloadJson({ source: sourceName, period: selectedYear, columns, data: rows }, `${filename}.json`);
          break;
      }
    } catch (err) {
      console.error("Download failed:", err);
    }
  }, [columns, rows, sourceName, selectedYear, numericColumns, formatCell]);

  const startResize = (column: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const th = (e.currentTarget as HTMLElement).parentElement as HTMLElement | null;
    const startWidth = columnWidths[column] || th?.getBoundingClientRect().width || 120;

    const onMove = (evt: MouseEvent) => {
      const nextWidth = Math.max(80, Math.min(520, startWidth + (evt.clientX - startX)));
      setColumnWidths((prev) => ({ ...prev, [column]: nextWidth }));
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handlePrintTable = () => {
    if (visibleColumns.length === 0 || rows.length === 0) return;
    const header = visibleColumns.map((c) => formatHeader(c));
    const body = rows.slice(0, 200).map((r) => visibleColumns.map((c) => formatCell(c, r)));
    const win = window.open("", "print-table");
    if (!win) return;
    win.document.write(`<!doctype html><html><head><title>${sourceName}</title>`);
    win.document.write(`
      <style>
        body { font-family: Arial, sans-serif; padding: 24px; color: #111827; }
        h1 { font-size: 16px; margin-bottom: 4px; }
        .meta { font-size: 12px; color: #6b7280; margin-bottom: 12px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th, td { border: 1px solid #e5e7eb; padding: 6px 8px; text-align: left; }
        th { background: #f9fafb; font-weight: 600; }
      </style>
    `);
    win.document.write(`</head><body>`);
    win.document.write(`<h1>${sourceName}</h1>`);
    win.document.write(`<div class="meta">Periode: ${selectedYear}</div>`);
    win.document.write(`<table><thead><tr>${header.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>`);
    body.forEach((row) => {
      win.document.write(`<tr>${row.map((cell) => `<td>${String(cell)}</td>`).join("")}</tr>`);
    });
    win.document.write(`</tbody></table></body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  // Period label for display
  const periodLabel = useMemo(() => {
    if (/^(19\d{2}|20\d{2}|2100)$/.test(String(selectedYear || "").trim())) {
      return selectedYear;
    }
    return selectedYear;
  }, [selectedYear]);

  // Generated timestamp
  const generatedAtLabel = useMemo(() => {
    const now = new Date();
    const options: Intl.DateTimeFormatOptions = {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Makassar",
    };
    return now.toLocaleDateString("id-ID", options) + " WIT";
  }, []);

  if (rows.length === 0) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900 sm:p-6">
          <EmptyState 
            variant="no-data"
            title="Tidak ada data"
            description="Data untuk periode yang diminta belum tersedia."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Quick Result Card - Data Table */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900 sm:p-6 transition-opacity duration-300">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-800 dark:text-white/90">Hasil Cepat • Data Statistik</h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Indikator: <span className="font-medium text-gray-800 dark:text-white/90">{sourceName}</span>
              {" "}•{" "}
              Periode:{" "}
              <span className="font-medium text-gray-800 dark:text-white/90">
                {availableYears.length > 1 ? `${availableYears[availableYears.length - 1]} - ${availableYears[0]}` : periodLabel}
              </span>
              {geoApplied && geo ? (
                <>
                  {" "}• Kab/Kota: <span className="font-medium text-gray-800 dark:text-white/90">{geo}</span>
                </>
              ) : null}
              {hasMonth ? (
                <>
                  {" "}• Bulan: <span className="font-medium text-gray-800 dark:text-white/90">{monthNameFromNo(monthNo!)}</span>
                </>
              ) : null}
              {lastUpdate ? (
                <>
                  {" "}• Update: <span className="font-medium text-gray-800 dark:text-white/90">{lastUpdate}</span>
                </>
              ) : null}
              {unit ? (
                <>
                  {" "}• Satuan: <span className="font-medium text-gray-800 dark:text-white/90">{unit}</span>
                </>
              ) : null}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div ref={columnMenuRef} className="relative">
              <button
                type="button"
                disabled={columns.length === 0}
                onClick={() => setColumnMenuOpen((v) => !v)}
                className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-white/[0.05]"
              >
                Kolom
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
                  <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {columnMenuOpen ? (
                <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
                  <div className="flex items-center justify-between px-4 py-2 text-[11px] text-gray-500 dark:text-gray-400">
                    <button
                      type="button"
                      onClick={() => setHiddenColumns([])}
                      className="hover:text-gray-700 dark:hover:text-gray-200"
                    >
                      Tampilkan semua
                    </button>
                    <button
                      type="button"
                      onClick={() => setHiddenColumns(columns.slice())}
                      className="hover:text-gray-700 dark:hover:text-gray-200"
                    >
                      Sembunyikan semua
                    </button>
                  </div>
                  <div className="max-h-60 overflow-auto px-2 pb-2">
                    {columns.map((c) => {
                      const label = formatHeader(c);
                      const checked = !hiddenColumns.includes(c);
                      return (
                        <label key={c} className="flex items-center gap-2 px-2 py-1 text-xs text-gray-700 dark:text-gray-200">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setHiddenColumns((prev) => checked ? prev.concat(c) : prev.filter((col) => col !== c));
                            }}
                            className="h-3.5 w-3.5"
                          />
                          <span className="min-w-0 truncate" title={String(label)}>{label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>

            <div ref={downloadMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setDownloadOpen((v) => !v)}
                className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-white/[0.05]"
              >
                Download data
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
                  <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {downloadOpen ? (
                <div className="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
                  <button
                    type="button"
                    onClick={() => handleDownload("excel")}
                    className="block w-full px-4 py-2 text-left text-xs text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/[0.05]"
                  >
                    Excel (.xlsx)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownload("csv")}
                    className="block w-full px-4 py-2 text-left text-xs text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/[0.05]"
                  >
                    CSV (.csv)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownload("pdf")}
                    className="block w-full px-4 py-2 text-left text-xs text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/[0.05]"
                  >
                    PDF (.pdf)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownload("json")}
                    className="block w-full px-4 py-2 text-left text-xs text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/[0.05]"
                  >
                    JSON (.json)
                  </button>
                </div>
              ) : null}
            </div>

            <button
              type="button"
              disabled={visibleColumns.length === 0 || rows.length === 0}
              onClick={handlePrintTable}
              className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-white/[0.05]"
            >
              Cetak
            </button>
          </div>
        </div>

        {/* Year Pills - Client-side switching, no navigation */}
        {availableYears.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {availableYears.map((y) => {
              const active = y === selectedYear;
              return (
                <button
                  key={y}
                  type="button"
                  onClick={() => setSelectedYear(y)}
                  className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                    active
                      ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                      : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-white/[0.05]"
                  }`}
                >
                  {y}
                </button>
              );
            })}
          </div>
        ) : null}

        {/* Data Table */}
        {columns.length > 0 && visibleColumns.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
            Semua kolom disembunyikan.
            <button
              type="button"
              onClick={() => setHiddenColumns([])}
              className="ml-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-white/[0.05]"
            >
              Tampilkan semua kolom
            </button>
          </div>
        ) : (
          <div className="mt-4 max-h-96 overflow-auto rounded-2xl border border-gray-200 dark:border-gray-800 animate-fadeIn">
            <table className="min-w-full border-collapse text-sm">
              <colgroup>
                {visibleColumns.map((c) => (
                  <col key={`col-${c}`} style={columnWidths[c] ? { width: `${columnWidths[c]}px` } : undefined} />
                ))}
              </colgroup>
              <thead className="sticky top-0 z-10 bg-white dark:bg-gray-900">
                <tr className="border-b border-gray-200 dark:border-gray-800">
                  {visibleColumns.map((c, colIdx) => (
                    <th
                      key={c}
                      className={`relative px-4 py-3 text-center text-xs font-semibold text-gray-600 dark:text-gray-300 ${
                        colIdx > 0 ? 'border-l border-gray-200 dark:border-gray-800' : ''
                      } ${numericColumns.has(c) ? 'text-right' : ''}`}
                    >
                      {formatHeader(c)}
                      <span
                        role="presentation"
                        onMouseDown={(e) => startResize(c, e)}
                        className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none"
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const monthHit = hasMonth && monthKeyCol ? matchesMonthCell(r[monthKeyCol], monthNo!) : false;
                  return (
                    <tr
                      key={idx}
                      className={`border-b border-gray-100 dark:border-gray-800 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50 ${monthHit ? "bg-brand-50/70 dark:bg-brand-500/10" : ""}`}
                    >
                      {visibleColumns.map((c, colIdx) => (
                        <td
                          key={c}
                          className={`px-4 py-3 text-gray-800 dark:text-white/90 ${
                            monthHit
                              ? `font-semibold ${c === monthKeyCol ? "border-l-4 border-brand-500 pl-3" : ""}`
                              : ""
                          } ${numericColumns.has(c) ? 'text-right' : ''} ${
                            colIdx > 0 && !(monthHit && c === monthKeyCol)
                              ? 'border-l border-gray-100 dark:border-gray-800'
                              : ''
                          }`}
                        >
                          {formatCell(c, r)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span>
            Sumber: <span className="font-medium text-gray-800 dark:text-white/90">{sourceName}</span>
          </span>
          <span>
            Dihasilkan: <span className="font-medium text-gray-800 dark:text-white/90">{generatedAtLabel}</span>
          </span>
        </div>
      </div>

      {/* Interpretasi & Grafik Card */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900 sm:p-6 transition-opacity duration-300">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-white/90">Interpretasi & Grafik</h2>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2 animate-fadeIn">
          {/* Interpretation Panel - Uses all years data for stable interpretation */}
          <div className="min-w-0">
            {DATA_INSIGHT_ENABLED && (
            <InterpretationPanel
              q={(() => {
                // Remove base year notation like "(2022 = 100)" from source name
                // to avoid confusing the AI with false year references
                const cleaned = sourceName
                  .replace(/\(\s*\d{4}\s*=\s*100\s*\)/gi, "")
                  .replace(/\s+/g, " ")
                  .trim();
                return cleaned || sourceName;
              })()}
              cacheRef={insightsCacheRef}
              dataset={{
                source_id: sourceId,
                type: sourceType,
                // Use the full year range for interpretation, not just selected year
                period: (() => {
                  const validYears = availableYears
                    .map((y) => String(y || "").trim())
                    .filter((y) => /^(19\d{2}|20\d{2}|2100)$/.test(y))
                    .sort((a, b) => Number(a) - Number(b));
                  return validYears.length > 0 ? validYears[validYears.length - 1] : selectedYear;
                })(),
                month: null, // Don't pass single month for multi-year analysis
                geo: geoApplied ? geo || undefined : undefined,
              }}
              preview={{
                source: sourceName,
                period: (() => {
                  // Compute proper period label from available years
                  const validYears = availableYears
                    .map((y) => String(y || "").trim())
                    .filter((y) => /^(19\d{2}|20\d{2}|2100)$/.test(y))
                    .sort((a, b) => Number(a) - Number(b));
                  
                  if (validYears.length === 0) {
                    return `Tahun ${selectedYear}`;
                  }
                  
                  const y0 = validYears[0];
                  const y1 = validYears[validYears.length - 1];
                  
                  if (y0 && y1 && y0 !== y1) {
                    return `Tahun ${y0} - ${y1}`;
                  }
                  
                  return `Tahun ${y0 || selectedYear}`;
                })(),
                last_update: (() => {
                  // Get the most recent last_update from all years
                  const updates = allYearsData
                    .map((d) => d.lastUpdate)
                    .filter((u): u is string => !!u)
                    .sort();
                  return updates.length > 0 ? updates[updates.length - 1] : null;
                })(),
                type: sourceType,
                geo: geoApplied ? geo || undefined : undefined,
                availableYears: availableYears,
                month: null, // Don't pass single month for multi-year analysis
                columns: columns.length > 0 ? columns : (allYearsData[0]?.columns || []),
                // Use all rows for interpretation - ensures it matches displayed table
                sampleRows: rows,
                unit: unit,
              }}
            />
            )}
          </div>

          {/* Chart - Uses current selected year's data */}
          <div className="min-w-0">
            <SearchInsightsChart
              rows={rows}
              columns={columns}
              sourceId={sourceId}
              sourceType={sourceType as "dynamic" | "interop" | "exim"}
              chartConfig={chartConfig}
              allowFullTimeRange={true}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
