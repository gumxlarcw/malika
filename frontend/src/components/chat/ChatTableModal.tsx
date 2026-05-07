/**
 * ChatTableModal — Enhanced table modal for MALIKA chat
 *
 * Features:
 * 1. Column sorting (click header to toggle asc/desc)
 * 2. Search/filter rows (instant text search)
 * 3. CSV download + TSV clipboard copy
 * 4. Tab switching for dual tables (Ekspor/Impor)
 * 5. Row virtualization via @tanstack/react-virtual (50+ rows)
 * 6. Sticky first column on horizontal scroll
 * 7. Mobile-optimized fullscreen layout
 * 8. Column resizing via drag handles
 */

"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { formatCellValue } from "@/lib/chatUtils";
import { CHAT_TEXT } from "@/lib/chatConstants";
import { CloseIcon, ExternalLinkIcon, DownloadIcon, ChevronDownIcon, CopyIcon, CheckIcon } from "@/components/chat/icons";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** A single row of table data — column key → cell value */
export type TableRow = Record<string, string | number | null | undefined>;

export interface ModalTableData {
  title?: string;
  columns: string[];
  rows: TableRow[];
  total_rows?: number;
  eximMode?: "ekspor" | "impor" | null;
  eximGroup?: string | null;
  bps_web_url?: string | null;
  /** Datasource ID */
  source_id?: number | null;
  /** All rows across all years (includes "Tahun" column) — for year tabs */
  allRows?: TableRow[] | null;
  /** Columns for allRows (includes "Tahun" at front) */
  allColumns?: string[] | null;
  /** Available years for year-tab pills */
  availableYears?: string[] | null;
  /** Default selected year when modal opens */
  defaultYear?: string | null;
}

export interface ChatTableModalProps {
  tables: ModalTableData[];
  isOpen: boolean;
  onClose: () => void;
  /** Which tab to show when the modal opens (0-based) */
  initialTab?: number;
}

type SortDir = "asc" | "desc" | null;

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const VIRTUALIZATION_THRESHOLD = 50;
const ESTIMATED_ROW_HEIGHT = 40;
const MIN_COL_WIDTH = 60;
const DEFAULT_COL_WIDTH = 140;
const ROW_NUM_WIDTH = 48;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Smart compare: numbers by value, strings by locale */
function smartCompare(a: unknown, b: unknown, dir: "asc" | "desc"): number {
  const aVal = a === null || a === undefined ? "" : a;
  const bVal = b === null || b === undefined ? "" : b;

  // Try numeric comparison
  const aNum = typeof aVal === "number" ? aVal : parseFloat(String(aVal).replace(/[,\s]/g, ""));
  const bNum = typeof bVal === "number" ? bVal : parseFloat(String(bVal).replace(/[,\s]/g, ""));

  if (!isNaN(aNum) && !isNaN(bNum)) {
    return dir === "asc" ? aNum - bNum : bNum - aNum;
  }

  // String comparison
  const cmp = String(aVal).localeCompare(String(bVal), "id", { sensitivity: "base" });
  return dir === "asc" ? cmp : -cmp;
}

/** Generate CSV content with proper escaping */
function generateCsv(cols: string[], rows: TableRow[]): string {
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const header = cols.map(escape).join(",");
  const body = rows.map((r) => cols.map((c) => escape(r?.[c])).join(","));
  return [header, ...body].join("\n");
}

/** Trigger browser file download */
function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob(["\uFEFF" + content], { type: mimeType }); // BOM for Excel
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/*  Sort Icon                                                          */
/* ------------------------------------------------------------------ */

function SortIcon({ dir }: { dir: SortDir }) {
  return (
    <span className="ml-1 inline-flex flex-col text-[8px] leading-none opacity-60">
      <span className={dir === "asc" ? "text-brand-500" : ""}>▲</span>
      <span className={dir === "desc" ? "text-brand-500" : ""}>▼</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Resize Handle                                                      */
/* ------------------------------------------------------------------ */

function ResizeHandle({
  onResize,
}: {
  onResize: (delta: number) => void;
}) {
  const startXRef = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      startXRef.current = e.clientX;

      const handleMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startXRef.current;
        startXRef.current = ev.clientX;
        onResize(delta);
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [onResize]
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-brand-300/40 dark:hover:bg-brand-500/30 transition-colors z-20"
      onMouseDown={handleMouseDown}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Table Renderer (with virtualization)                               */
/* ------------------------------------------------------------------ */

interface TableRendererProps {
  cols: string[];
  rows: TableRow[];
  sortCol: string | null;
  sortDir: SortDir;
  onSort: (col: string) => void;
  colWidths: Record<string, number>;
  onColResize: (col: string, delta: number) => void;
  stickyFirstCol: boolean;
}

function TableRenderer({
  cols,
  rows,
  sortCol,
  sortDir,
  onSort,
  colWidths,
  onColResize,
  stickyFirstCol,
}: TableRendererProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldVirtualize = rows.length >= VIRTUALIZATION_THRESHOLD;

  // Scroll-hint: show right-edge gradient when table has more columns to scroll
  const [canScrollRight, setCanScrollRight] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => {
      setCanScrollRight(el.scrollWidth - el.scrollLeft - el.clientWidth > 2);
    };
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", check); ro.disconnect(); };
  }, [cols.length, rows.length]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 15,
  });

  // Sticky first column classes
  const stickyThCls = stickyFirstCol
    ? "sticky left-0 z-20 bg-gray-50 dark:bg-gray-900 after:absolute after:right-0 after:top-0 after:bottom-0 after:w-px after:bg-gray-200 dark:after:bg-gray-700"
    : "";
  const stickyRowNumThCls = stickyFirstCol
    ? "sticky left-0 z-20 bg-gray-50 dark:bg-gray-900"
    : "";

  const getStickyTdCls = (idx: number, rowIdx: number) => {
    if (!stickyFirstCol) return "";
    const bg = rowIdx % 2 === 1
      ? "bg-gray-50 dark:bg-gray-950"
      : "bg-white dark:bg-gray-950";
    if (idx === -1) return `sticky left-0 z-10 ${bg}`;
    if (idx === 0) return `sticky z-10 ${bg} after:absolute after:right-0 after:top-0 after:bottom-0 after:w-px after:bg-gray-200 dark:after:bg-gray-700`;
    return "";
  };

  const getStickyLeft = (idx: number) => {
    if (!stickyFirstCol) return undefined;
    if (idx === -1) return 0; // row number column
    if (idx === 0) return ROW_NUM_WIDTH; // first data column
    return undefined;
  };

  const renderRow = (row: TableRow, rowIdx: number, displayIdx: number) => (
    <tr
      key={rowIdx}
      className={`border-t border-gray-100 hover:bg-blue-50/50 dark:border-gray-800 dark:hover:bg-gray-800/40 ${
        displayIdx % 2 === 1 ? "bg-gray-50/50 dark:bg-gray-950/60" : ""
      }`}
    >
      {/* Row number */}
      <td
        className={`px-2 py-2 text-gray-400 dark:text-gray-500 text-xs text-center tabular-nums whitespace-nowrap ${getStickyTdCls(-1, displayIdx)}`}
        style={{ width: ROW_NUM_WIDTH, minWidth: ROW_NUM_WIDTH, maxWidth: ROW_NUM_WIDTH, left: getStickyLeft(-1) }}
      >
        {displayIdx + 1}
      </td>
      {cols.map((c, cIdx) => (
        <td
          key={c}
          className={`px-3 py-2 text-gray-800 dark:text-gray-200 text-xs sm:text-sm ${
            cIdx > 0 ? "text-right font-mono tabular-nums whitespace-nowrap" : ""
          } ${cIdx === 0 ? getStickyTdCls(0, displayIdx) : ""}`}
          style={{
            minWidth: MIN_COL_WIDTH,
            left: cIdx === 0 ? getStickyLeft(0) : undefined,
          }}
        >
          {formatCellValue(row?.[c], c)}
        </td>
      ))}
    </tr>
  );

  const scrollHint = canScrollRight ? (
    <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-white/80 to-transparent dark:from-gray-950/80 sm:hidden z-40" />
  ) : null;

  // Non-virtualized
  if (!shouldVirtualize) {
    return (
      <div className="relative flex-1 flex flex-col">
        {scrollHint}
        <div ref={scrollRef} className="overflow-auto flex-1">
        <table className="w-full text-left text-sm border-collapse table-auto" role="table">
          <thead className="sticky top-0 z-30 bg-gray-50 dark:bg-gray-900">
            <tr>
              <th
                scope="col"
                className={`px-2 py-2.5 font-semibold text-gray-400 dark:text-gray-500 text-xs text-center whitespace-nowrap ${stickyRowNumThCls}`}
                style={{ width: ROW_NUM_WIDTH, minWidth: ROW_NUM_WIDTH, maxWidth: ROW_NUM_WIDTH, left: getStickyLeft(-1) }}
              >
                #
              </th>
              {cols.map((c, cIdx) => (
                <th
                  key={c}
                  scope="col"
                  className={`px-3 py-2.5 font-semibold text-gray-700 dark:text-gray-200 text-xs sm:text-sm cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-800 relative group whitespace-nowrap ${
                    cIdx === 0 ? stickyThCls : ""
                  }`}
                  style={{
                    minWidth: MIN_COL_WIDTH,
                    left: cIdx === 0 ? getStickyLeft(0) : undefined,
                  }}
                  onClick={() => onSort(c)}
                  aria-sort={sortCol === c ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                >
                  <span className="inline-flex items-center gap-0.5">
                    {c}
                    <SortIcon dir={sortCol === c ? sortDir : null} />
                  </span>
                  <ResizeHandle onResize={(d) => onColResize(c, d)} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => renderRow(r, idx, idx))}
          </tbody>
        </table>
      </div>
      </div>
    );
  }

  // Virtualized
  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div className="relative flex-1 flex flex-col">
      {scrollHint}
      <div ref={scrollRef} className="overflow-auto flex-1">
      <table className="w-full text-left text-sm border-collapse table-auto">
        <thead className="sticky top-0 z-30 bg-gray-50 dark:bg-gray-900">
          <tr>
            <th
              className={`px-2 py-2.5 font-semibold text-gray-400 dark:text-gray-500 text-xs text-center whitespace-nowrap ${stickyRowNumThCls}`}
              style={{ width: ROW_NUM_WIDTH, minWidth: ROW_NUM_WIDTH, maxWidth: ROW_NUM_WIDTH, left: getStickyLeft(-1) }}
            >
              #
            </th>
            {cols.map((c, cIdx) => (
              <th
                key={c}
                className={`px-3 py-2.5 font-semibold text-gray-700 dark:text-gray-200 text-xs sm:text-sm cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-800 relative group whitespace-nowrap ${
                  cIdx === 0 ? stickyThCls : ""
                }`}
                style={{
                  minWidth: MIN_COL_WIDTH,
                  left: cIdx === 0 ? getStickyLeft(0) : undefined,
                }}
                onClick={() => onSort(c)}
              >
                <span className="inline-flex items-center gap-0.5">
                  {c}
                  <SortIcon dir={sortCol === c ? sortDir : null} />
                </span>
                <ResizeHandle onResize={(d) => onColResize(c, d)} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Top spacer */}
          {virtualItems.length > 0 && virtualItems[0].start > 0 && (
            <tr style={{ height: virtualItems[0].start }} aria-hidden="true">
              <td colSpan={cols.length + 1} />
            </tr>
          )}
          {virtualItems.map((vRow) => {
            const row = rows[vRow.index];
            return (
              <tr
                key={vRow.key}
                data-index={vRow.index}
                ref={virtualizer.measureElement}
                className={`border-t border-gray-100 hover:bg-blue-50/50 dark:border-gray-800 dark:hover:bg-gray-800/40 ${
                  vRow.index % 2 === 1 ? "bg-gray-50/50 dark:bg-gray-950/60" : ""
                }`}
              >
                <td
                  className={`px-2 py-2 text-gray-400 dark:text-gray-500 text-xs text-center tabular-nums whitespace-nowrap ${getStickyTdCls(-1, vRow.index)}`}
                  style={{ width: ROW_NUM_WIDTH, minWidth: ROW_NUM_WIDTH, maxWidth: ROW_NUM_WIDTH, left: getStickyLeft(-1) }}
                >
                  {vRow.index + 1}
                </td>
                {cols.map((c, cIdx) => (
                  <td
                    key={c}
                    className={`px-3 py-2 text-gray-800 dark:text-gray-200 text-xs sm:text-sm ${
                      cIdx > 0 ? "text-right font-mono tabular-nums whitespace-nowrap" : ""
                    } ${cIdx === 0 ? getStickyTdCls(0, vRow.index) : ""}`}
                    style={{
                      minWidth: MIN_COL_WIDTH,
                      left: cIdx === 0 ? getStickyLeft(0) : undefined,
                    }}
                  >
                    {formatCellValue(row?.[c], c)}
                  </td>
                ))}
              </tr>
            );
          })}
          {/* Bottom spacer */}
          {virtualItems.length > 0 && (
            <tr
              style={{
                height:
                  totalSize - (virtualItems[virtualItems.length - 1]?.end ?? 0),
              }}
              aria-hidden="true"
            >
              <td colSpan={cols.length + 1} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Modal Component                                               */
/* ------------------------------------------------------------------ */

export function ChatTableModal({ tables, isOpen, onClose, initialTab = 0 }: ChatTableModalProps) {
  const hasDualTables = tables.length > 1;

  // State
  const [activeTab, setActiveTab] = useState(initialTab);

  // Sync activeTab when initialTab or isOpen changes
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(false);
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // ── Year tab state ──────────────────────────────────────────────────
  const activeTable = tables[activeTab] || tables[0];
  const hasYearTabs = Boolean(
    activeTable?.allRows?.length && activeTable?.availableYears?.length && (activeTable.availableYears.length > 1)
  );
  const yearList = useMemo(() => {
    if (!hasYearTabs || !activeTable?.availableYears) return [];
    // Sort years descending (newest first)
    return [...activeTable.availableYears].sort((a, b) => Number(b) - Number(a));
  }, [hasYearTabs, activeTable?.availableYears]);

  const [selectedYear, setSelectedYear] = useState<string | null>(null);

  // Sync selectedYear when tab or modal opens
  useEffect(() => {
    if (isOpen && activeTable) {
      setSelectedYear(activeTable.defaultYear || yearList[0] || null);
    }
  }, [isOpen, activeTab, activeTable?.defaultYear, yearList]);

  // Reset sort/search when switching tabs or year
  useEffect(() => {
    setSortCol(null);
    setSortDir(null);
    setSearch("");
  }, [activeTab, selectedYear]);

  // Close export menu on click outside
  useEffect(() => {
    if (!showExportMenu) return;
    const handler = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showExportMenu]);

  // Escape key to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  // ── Derive displayed columns and rows based on year tab ─────────────
  // When year tabs are active: use allRows filtered by year, allColumns (minus "Tahun")
  // When no year tabs: use original rows/columns
  const { cols, allRows: displayRows } = useMemo(() => {
    if (hasYearTabs && activeTable?.allRows && activeTable?.allColumns && selectedYear) {
      // Filter allRows by the selected year's Tahun column
      const yearFiltered = activeTable.allRows.filter(
        (r: TableRow) => String(r?.Tahun) === String(selectedYear)
      );
      // Remove "Tahun" from displayed columns since year is shown via tabs
      const colsWithoutTahun = activeTable.allColumns.filter((c) => c !== "Tahun");
      return { cols: colsWithoutTahun, allRows: yearFiltered };
    }
    return {
      cols: activeTable?.columns || [],
      allRows: activeTable?.rows || [],
    };
  }, [hasYearTabs, activeTable, selectedYear]);

  // Filter rows by search
  const filteredRows = useMemo(() => {
    if (!search.trim()) return displayRows;
    const q = search.toLowerCase();
    return displayRows.filter((r: TableRow) =>
      cols.some((c) => {
        const v = r?.[c];
        if (v === null || v === undefined) return false;
        return String(v).toLowerCase().includes(q);
      })
    );
  }, [displayRows, cols, search]);

  // Sort rows
  const sortedRows = useMemo(() => {
    if (!sortCol || !sortDir) return filteredRows;
    return [...filteredRows].sort((a, b) =>
      smartCompare(a?.[sortCol], b?.[sortCol], sortDir)
    );
  }, [filteredRows, sortCol, sortDir]);

  // Sort handler
  const handleSort = useCallback(
    (col: string) => {
      if (sortCol === col) {
        if (sortDir === "asc") setSortDir("desc");
        else if (sortDir === "desc") {
          setSortCol(null);
          setSortDir(null);
        }
      } else {
        setSortCol(col);
        setSortDir("asc");
      }
    },
    [sortCol, sortDir]
  );

  // Column resize handler
  const handleColResize = useCallback((col: string, delta: number) => {
    setColWidths((prev) => ({
      ...prev,
      [col]: Math.max(MIN_COL_WIDTH, (prev[col] || DEFAULT_COL_WIDTH) + delta),
    }));
  }, []);

  // Copy to clipboard (all tables as TSV)
  const handleCopy = useCallback(async () => {
    const parts: string[] = [];
    for (const t of tables) {
      if (t.title) parts.push(t.title);
      const header = t.columns.join("\t");
      const body = t.rows.map((r: TableRow) =>
        t.columns
          .map((c) => {
            const v = r?.[c];
            if (v === null || v === undefined) return "";
            return String(v);
          })
          .join("\t")
      );
      parts.push([header, ...body].join("\n"));
      parts.push(""); // separator
    }
    try {
      await navigator.clipboard.writeText(parts.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [tables]);

  // CSV download (active table)
  const handleDownloadCsv = useCallback(() => {
    const csv = generateCsv(cols, sortedRows);
    const title = activeTable?.title || "data";
    const safeName = title.replace(/[^a-zA-Z0-9_\-\s]/g, "").trim().replace(/\s+/g, "_");
    downloadFile(csv, `${safeName}.csv`, "text/csv;charset=utf-8;");
    setShowExportMenu(false);
  }, [cols, sortedRows, activeTable?.title]);

  // CSV download (all tables)
  const handleDownloadAllCsv = useCallback(() => {
    const parts: string[] = [];
    for (const t of tables) {
      if (t.title) parts.push(`"${t.title}"`);
      parts.push(generateCsv(t.columns, t.rows));
      parts.push(""); // separator between tables
    }
    downloadFile(parts.join("\n"), "data_malika.csv", "text/csv;charset=utf-8;");
    setShowExportMenu(false);
  }, [tables]);

  // Total rows across all tables
  const totalAllRows = useMemo(
    () => tables.reduce((sum, t) => sum + (t.rows?.length || 0), 0),
    [tables]
  );

  if (!isOpen || typeof window === "undefined") return null;

  // Modal title
  const modalTitle = hasDualTables
    ? tables[0]?.eximMode
      ? "Data Ekspor & Impor"
      : `${tables[0]?.title || "Tabel 1"} & ${tables[1]?.title || "Tabel 2"}`
    : activeTable?.title || "Data Statistik";

  const modalSubtitle = hasDualTables
    ? `${totalAllRows} baris total (${tables.map((t) => t.rows.length).join(" + ")})`
    : `${sortedRows.length}${search ? ` dari ${displayRows.length}` : ""} baris${
        hasYearTabs && selectedYear ? ` • ${selectedYear}` : ""
      }${
        activeTable?.total_rows && activeTable.total_rows > displayRows.length && !hasYearTabs
          ? ` dari ${activeTable.total_rows} total`
          : ""
      }`;

  // Tab colors by eximMode
  const getTabColor = (t: ModalTableData, isActive: boolean) => {
    if (t.eximMode === "ekspor")
      return isActive
        ? "border-brand-500 text-brand-600 dark:text-brand-400 bg-brand-50/50 dark:bg-brand-950/30"
        : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400";
    if (t.eximMode === "impor")
      return isActive
        ? "border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/30"
        : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400";
    return isActive
      ? "border-brand-500 text-brand-600 dark:text-brand-400 bg-brand-50/50 dark:bg-brand-950/30"
      : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400";
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[999999] flex items-end sm:items-center justify-center bg-black/50 sm:p-4"
      onClick={onClose}
    >
      <div
        className="relative flex h-[100dvh] sm:h-auto sm:max-h-[90vh] w-full flex-col overflow-hidden bg-white shadow-2xl dark:bg-gray-900 sm:rounded-2xl sm:border sm:border-gray-200 sm:dark:border-gray-800 sm:max-w-[95vw] lg:max-w-[1200px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ───── Header ───── */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              {modalTitle}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {modalSubtitle}
              {sortCol && (
                <span className="ml-2 text-brand-500">
                  Urut: {sortCol} ({sortDir === "asc" ? "↑" : "↓"})
                </span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 ml-2 shrink-0"
            aria-label="Tutup"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        {/* ───── Toolbar: Tabs + Search ───── */}
        <div className="shrink-0 border-b border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
          {/* Tab bar (only for dual tables) */}
          {hasDualTables && (
            <div className="flex border-b border-gray-200 dark:border-gray-800">
              {tables.map((t, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setActiveTab(idx)}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${getTabColor(
                    t,
                    activeTab === idx
                  )}`}
                >
                  {t.eximMode
                    ? t.eximMode === "ekspor"
                      ? "📤 Ekspor"
                      : "📥 Impor"
                    : `Tabel ${idx + 1}`}
                  <span className="ml-1.5 text-xs opacity-60">({t.rows.length})</span>
                </button>
              ))}
            </div>
          )}

          {/* Year pills — tab-style year switching */}
          {hasYearTabs && yearList.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 py-2 border-b border-gray-200 dark:border-gray-800">
              <span className="self-center text-xs text-gray-400 dark:text-gray-500 mr-1">Tahun:</span>
              {yearList.map((y) => {
                const active = y === selectedYear;
                return (
                  <button
                    key={y}
                    type="button"
                    onClick={() => setSelectedYear(y)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      active
                        ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300 dark:border-brand-400"
                        : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                    }`}
                  >
                    {y}
                  </button>
                );
              })}
            </div>
          )}

          {/* Search bar */}
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="relative flex-1 max-w-sm">
              <svg
                className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari dalam tabel..."
                className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-9 pr-8 text-sm text-gray-700 placeholder-gray-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:placeholder-gray-500"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              )}
            </div>
            {search && (
              <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                {sortedRows.length} hasil
              </span>
            )}
          </div>
        </div>

        {/* ───── Table body ───── */}
        <div className="min-h-0 flex-1 flex flex-col bg-white dark:bg-gray-950">
          {sortedRows.length === 0 ? (
            <div className="flex-1 flex items-center justify-center py-12">
              <div className="text-center">
                <svg className="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                  {search
                    ? `Tidak ditemukan hasil untuk "${search}"`
                    : "Tidak ada data"}
                </p>
              </div>
            </div>
          ) : (
            <TableRenderer
              cols={cols}
              rows={sortedRows}
              sortCol={sortCol}
              sortDir={sortDir}
              onSort={handleSort}
              colWidths={colWidths}
              onColResize={handleColResize}
              stickyFirstCol={cols.length > 3}
            />
          )}
        </div>

        {/* ───── Footer ───── */}
        <div className="flex shrink-0 items-center justify-between border-t border-gray-200 bg-gray-50 px-4 py-2.5 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
            {tables[activeTab]?.bps_web_url ? (
              <a
                href={tables[activeTab].bps_web_url!}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
              >
                Lihat di Website Resmi BPS
                <ExternalLinkIcon className="h-3.5 w-3.5" />
              </a>
            ) : (
              <span>
                {sortedRows.length < displayRows.length
                  ? `${sortedRows.length} dari ${displayRows.length} baris ditampilkan`
                  : "Data dari cache database"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Export dropdown */}
            <div className="relative" ref={exportMenuRef}>
              <button
                type="button"
                onClick={() => setShowExportMenu((p) => !p)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                <DownloadIcon />
                <span className="hidden sm:inline">Ekspor</span>
                <ChevronDownIcon className="h-3 w-3 opacity-50" />
              </button>
              {showExportMenu && (
                <div className="absolute right-0 bottom-full mb-1 w-52 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800 z-50">
                  <button
                    type="button"
                    onClick={handleDownloadCsv}
                    className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700 flex items-center gap-2"
                  >
                    <svg className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Unduh CSV (tabel aktif)
                  </button>
                  {hasDualTables && (
                    <button
                      type="button"
                      onClick={handleDownloadAllCsv}
                      className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700 flex items-center gap-2"
                    >
                      <svg className="h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                      </svg>
                      Unduh CSV (semua tabel)
                    </button>
                  )}
                  <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
                  <button
                    type="button"
                    onClick={() => {
                      handleCopy();
                      setShowExportMenu(false);
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700 flex items-center gap-2"
                  >
                    <CopyIcon className="h-4 w-4 text-gray-500" />
                    Salin ke clipboard
                  </button>
                </div>
              )}
            </div>

            {/* Copy feedback */}
            {copied && (
              <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                <CheckIcon className="h-3.5 w-3.5" />
                Tersalin!
              </span>
            )}

            {/* Close */}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              {CHAT_TEXT.close}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default ChatTableModal;
