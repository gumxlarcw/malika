"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import { applyTableRowOrdering, normalizeTableData } from "@/lib/tableRowOrdering";
import { DATA_INSIGHT_ENABLED } from "@/lib/featureFlags";
import { type InsightResponse } from "@/components/search/InterpretationPanel";
import Hero from "./_components/Hero";
import FilterBar, { type DownloadFormat } from "./_components/FilterBar";
import DataTable from "./_components/DataTable";
import StuckContextBar from "./_components/StuckContextBar";
import ChartCard from "./_components/ChartCard";
import InterpretationCard from "./_components/InterpretationCard";
import {
  asSourceType,
  type SourceType,
} from "./_lib/sourceTypePalette";

// ─────────────────────────────────────────────────────────────────────────────
// Number parsing/formatting (preserved from original — handles id-ID +
// comma decimals + value-code suffixes like "1234 r"). Hoisted into a
// reusable `toNumberLoose` so sparkline-series builders can extract numerics
// without round-tripping through the locale formatter (audit-finding B2).
// ─────────────────────────────────────────────────────────────────────────────
function toNumberLoose(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).trim();
  if (!s) return null;
  let cleaned = s.replace(/[^0-9,\.\-+]/g, "");
  if (!cleaned) return null;
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  const stripDots = (input: string) => {
    const idx = input.lastIndexOf(".");
    if (idx <= 0) return input;
    return input.slice(0, idx).replace(/\./g, "") + input.slice(idx);
  };
  if (hasComma && hasDot) {
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    const decimalSep = lastComma > lastDot ? "," : ".";
    const thousandSep = decimalSep === "," ? "." : ",";
    cleaned = cleaned.split(thousandSep).join("");
    if (decimalSep === ",") cleaned = cleaned.replace(/,/g, ".");
    cleaned = stripDots(cleaned);
  } else if (hasComma) {
    const last = cleaned.lastIndexOf(",");
    const frac = cleaned.slice(last + 1);
    if (frac.length >= 1 && frac.length <= 2) {
      cleaned = cleaned.replace(/\./g, "").replace(/,/g, ".");
      cleaned = stripDots(cleaned);
    } else {
      cleaned = cleaned.replace(/,/g, "");
    }
  } else if (hasDot) {
    const last = cleaned.lastIndexOf(".");
    const frac = cleaned.slice(last + 1);
    if (frac.length >= 1 && frac.length <= 2) {
      cleaned = cleaned.replace(/,/g, "");
      cleaned = stripDots(cleaned);
    } else {
      cleaned = cleaned.replace(/\./g, "");
    }
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function formatNumberId(input: unknown): string | null {
  const n = toNumberLoose(input);
  if (n === null) return null;
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

// EXIM-specific helpers (preserved from original)
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
  if (key === "pod") return raw === "-" || raw === "" ? "Semua Pelabuhan" : raw;
  if (key === "ctr") return raw === "-" || raw === "" ? "Semua Negara" : raw;
  if (key === "kodehs") {
    if (/^all\s*hs/i.test(raw) || raw === "-" || raw === "") return "Semua Komoditas";
    return raw;
  }
  if (key === "value" || key === "netweight") return formatNumberId(value) ?? (raw || "-");
  return raw || "-";
}
function detectEximModeFromName(name: string): "impor" | "ekspor" | null {
  const raw = String(name || "").toLowerCase();
  if (raw.includes("impor")) return "impor";
  if (raw.includes("ekspor")) return "ekspor";
  return null;
}

// Heuristic match for "provincial total" rows (BPS uses "Maluku Utara" as the total)
function isProvincialTotalRow(row: Record<string, unknown>, firstCol: string): boolean {
  const v = String(row[firstCol] ?? "").toLowerCase();
  return v === "maluku utara" || v === "indonesia" || v.includes("total") || v.includes("provinsi");
}

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
  chartConfig?: unknown;
  q?: string;
  unit?: string | null;
  parentCategoryName?: string | null;
  parentCategorySlug?: string | null;
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
  parentCategoryName,
  parentCategorySlug,
}: DataPageClientProps) {
  const isExim = sourceType === "exim";
  const eximMode = isExim ? detectEximModeFromName(sourceName) : null;

  // ── State ─────────────────────────────────────────────────────────────────
  const [selectedYear, setSelectedYear] = useState(initialYear);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const insightsCacheRef = useRef<Map<string, InsightResponse>>(new Map());

  const stype = asSourceType(sourceType);

  // ── Derived data ──────────────────────────────────────────────────────────
  const currentYearData = useMemo(
    () =>
      allYearsData.find((d) => d.year === selectedYear) ??
      allYearsData[allYearsData.length - 1] ??
      null,
    [allYearsData, selectedYear],
  );

  const { columns: allColumns, rows: rawRows } = useMemo(() => {
    if (!currentYearData) return { columns: [] as string[], rows: [] as Array<Record<string, unknown>> };
    const cols = currentYearData.columns;
    const normalized = normalizeTableData(currentYearData.rows, unit);
    let rows: Array<Record<string, unknown>> = normalized.rows;
    if (!isExim) {
      rows = applyTableRowOrdering({
        rows,
        columns: cols,
        title: sourceName,
      });
    }
    return { columns: cols, rows };
  }, [currentYearData, isExim, sourceName, unit]);

  const visibleColumns = useMemo(
    () => allColumns.filter((c) => !hiddenColumns.includes(c)),
    [allColumns, hiddenColumns],
  );

  const numericColumns = useMemo(() => {
    const set = new Set<string>();
    if (isExim) {
      const eximNumericKeys = ["value", "netweight"];
      for (const c of allColumns) {
        if (eximNumericKeys.includes(c.trim().toLowerCase())) set.add(c);
      }
      return set;
    }
    for (const c of allColumns) {
      if (rawRows.some((r) => typeof r[c] === "number")) set.add(c);
    }
    return set;
  }, [allColumns, rawRows, isExim]);

  // formatCell — preserved logic for EXIM + numeric handling
  const formatCell = useCallback(
    (column: string, row: Record<string, unknown>): string => {
      const value = row[column];
      if (isExim) return eximCellValue(column, value);
      if (value === null || value === undefined || String(value).trim() === "") return "-";
      if (numericColumns.has(column)) return formatNumberId(value) ?? String(value);
      return String(value);
    },
    [isExim, numericColumns],
  );

  // Per-row sparkline series across all years (keyed by first column / region label).
  // Parses values directly via `toNumberLoose` instead of round-tripping through
  // the locale formatter — that round-trip dropped value-code-suffixed numbers like
  // "1234 r" to NaN, killing the row's sparkline (audit-finding B2).
  const buildRowSeries = useCallback(
    (regionLabel: string): number[] => {
      const firstCol = allColumns[0];
      if (!firstCol) return [];
      const lastDataCol = allColumns[allColumns.length - 1];
      if (!lastDataCol) return [];
      const yearsAsc = [...allYearsData].sort((a, b) => Number(a.year) - Number(b.year));
      return yearsAsc.map((yd) => {
        const row = yd.rows.find((r) => String(r[firstCol] ?? "") === regionLabel);
        if (!row) return NaN;
        const parsed = toNumberLoose(row[lastDataCol]);
        return parsed === null ? NaN : parsed;
      });
    },
    [allColumns, allYearsData],
  );

  // Pick the most informative aggregate column for the hero sparkline. The
  // design's mock data was Padi-style (single aggregate column), so just using
  // `lastCol` worked. Real tables can have 25+ commodity columns where the
  // alphabetically-last one (e.g. "Sukun") is sparse — picking it produces a
  // sparkline of mostly NaN. Instead, score each non-first column by how many
  // year × row cells have a parseable number, and prefer the column with the
  // best coverage. Tie-break on rightmost (closer to the design's intent for
  // clean datasets) (audit-finding B1).
  const aggregateColumn = useMemo(() => {
    if (allColumns.length < 2) return null;
    const firstCol = allColumns[0];
    type Candidate = { col: string; coverage: number; idx: number };
    let best: Candidate | null = null;
    allColumns.forEach((col, idx) => {
      if (col === firstCol) return;
      let coverage = 0;
      for (const yd of allYearsData) {
        for (const row of yd.rows) {
          if (toNumberLoose(row[col]) !== null) coverage++;
        }
      }
      // local alias so TS narrows correctly inside the OR chain
      const cur: Candidate | null = best;
      if (
        !cur ||
        coverage > cur.coverage ||
        (coverage === cur.coverage && idx > cur.idx)
      ) {
        best = { col, coverage, idx };
      }
    });
    return best && (best as Candidate).coverage > 0 ? (best as Candidate).col : null;
  }, [allColumns, allYearsData]);

  // Total provincial series for hero sparkline. Uses the chosen aggregate col;
  // returns NaN where no provincial-total row exists, falling back to a sum
  // across rows for source types where summation is meaningful.
  const totalSeries = useMemo(() => {
    const firstCol = allColumns[0];
    if (!firstCol || !aggregateColumn) return [];
    const yearsAsc = [...allYearsData].sort((a, b) => Number(a.year) - Number(b.year));
    return yearsAsc.map((yd) => {
      // Prefer a row labeled "Maluku Utara" / "Total" / "Provinsi"; otherwise sum non-total rows.
      const totalRow = yd.rows.find((r) => isProvincialTotalRow(r, firstCol));
      if (totalRow) {
        const parsed = toNumberLoose(totalRow[aggregateColumn]);
        return parsed === null ? NaN : parsed;
      }
      let sum = 0;
      let any = false;
      for (const r of yd.rows) {
        const parsed = toNumberLoose(r[aggregateColumn]);
        if (parsed !== null) {
          sum += parsed;
          any = true;
        }
      }
      return any ? sum : NaN;
    });
  }, [allColumns, aggregateColumn, allYearsData]);

  const regionsCount = useMemo(() => {
    const firstCol = allColumns[0];
    if (!firstCol) return 0;
    const set = new Set<string>();
    for (const r of rawRows) {
      const k = String(r[firstCol] ?? "").trim();
      if (k && !isProvincialTotalRow(r, firstCol)) set.add(k);
    }
    return set.size;
  }, [allColumns, rawRows]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleToggleColumn = useCallback((col: string) => {
    setHiddenColumns((prev) => (prev.includes(col) ? prev.filter((c) => c !== col) : prev.concat(col)));
  }, []);
  const handleShowAllColumns = useCallback(() => setHiddenColumns([]), []);
  const handleHideAllColumns = useCallback(() => setHiddenColumns(allColumns.slice()), [allColumns]);

  const handleDownload = useCallback(
    async (format: DownloadFormat) => {
      if (visibleColumns.length === 0 || rawRows.length === 0) return;
      const sanitizedName = sourceName.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 50);
      const filename = `${sanitizedName}_${selectedYear}`;
      try {
        if (format === "excel") {
          const ExcelJS = await import("exceljs");
          const wb = new ExcelJS.Workbook();
          const ws = wb.addWorksheet(`${selectedYear}`);
          ws.columns = visibleColumns.map((c) => ({ header: isExim ? eximColumnLabel(c, eximMode) : c, key: c, width: 18 }));
          for (const r of rawRows) {
            const obj: Record<string, unknown> = {};
            for (const c of visibleColumns) obj[c] = formatCell(c, r);
            ws.addRow(obj);
          }
          const buf = await wb.xlsx.writeBuffer();
          downloadBlob(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${filename}.xlsx`);
        } else if (format === "csv") {
          const lines = [
            visibleColumns.map((c) => csvEscape(isExim ? eximColumnLabel(c, eximMode) : c)).join(","),
            ...rawRows.map((r) => visibleColumns.map((c) => csvEscape(formatCell(c, r))).join(",")),
          ];
          downloadBlob(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }), `${filename}.csv`);
        } else if (format === "pdf") {
          const { jsPDF } = await import("jspdf");
          const autoTableMod = await import("jspdf-autotable");
          const autoTableModule = autoTableMod as unknown as {
            default?: (...args: unknown[]) => unknown;
            (...args: unknown[]): unknown;
          };
          const autoTable =
            (typeof autoTableModule.default === "function" ? autoTableModule.default : autoTableModule) as
              (...args: unknown[]) => unknown;
          const doc = new jsPDF({ orientation: visibleColumns.length > 6 ? "landscape" : "portrait", unit: "pt", format: "a4" });
          doc.setFontSize(13);
          doc.text(`${sourceName} — ${selectedYear}`, 40, 40);
          autoTable(doc, {
            head: [visibleColumns.map((c) => (isExim ? eximColumnLabel(c, eximMode) : c))],
            body: rawRows.map((r) => visibleColumns.map((c) => formatCell(c, r))),
            startY: 60,
            styles: { fontSize: 9 },
          });
          doc.save(`${filename}.pdf`);
        } else if (format === "json") {
          const json = JSON.stringify(
            { source: sourceName, period: selectedYear, columns: visibleColumns, data: rawRows },
            null,
            2,
          );
          downloadBlob(new Blob([json], { type: "application/json;charset=utf-8" }), `${filename}.json`);
        }
      } catch (err) {
        console.error("Download failed:", err);
      }
    },
    [visibleColumns, rawRows, sourceName, selectedYear, isExim, eximMode, formatCell],
  );

  // Print: build the popup DOM with createElement (no document.write — safer +
  // hook-friendly). User-controlled strings flow through textContent so HTML
  // injection is structurally impossible.
  const handlePrint = useCallback(() => {
    if (visibleColumns.length === 0 || rawRows.length === 0) return;
    const win = window.open("", "print-table");
    if (!win) return;
    const doc = win.document;

    doc.title = sourceName;

    const style = doc.createElement("style");
    style.textContent =
      "body{font-family:Inter,system-ui;padding:24px;color:#111}" +
      "h1{font-size:18px;margin:0 0 12px}" +
      "table{width:100%;border-collapse:collapse;font-size:12px}" +
      "th,td{border:1px solid #d1d5db;padding:6px 10px;text-align:left}" +
      "thead{background:#f3f4f6}";
    doc.head.appendChild(style);

    const h1 = doc.createElement("h1");
    h1.textContent = `${sourceName} — ${selectedYear}`;
    doc.body.appendChild(h1);

    const table = doc.createElement("table");
    const thead = doc.createElement("thead");
    const headerRow = doc.createElement("tr");
    for (const c of visibleColumns) {
      const th = doc.createElement("th");
      th.textContent = isExim ? eximColumnLabel(c, eximMode) : c;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = doc.createElement("tbody");
    for (const r of rawRows.slice(0, 200)) {
      const tr = doc.createElement("tr");
      for (const c of visibleColumns) {
        const td = doc.createElement("td");
        td.textContent = formatCell(c, r);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    doc.body.appendChild(table);

    win.focus();
    setTimeout(() => win.print(), 250);
  }, [visibleColumns, rawRows, sourceName, selectedYear, isExim, eximMode, formatCell]);

  const handleCopyLink = useCallback(() => {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url);
  }, []);

  // Pre-rendered table rows: keep raw numbers (so DataTable can right-align +
  // tabular-nums), passthrough formatted strings for non-numeric, preserve
  // value_codes for the cell-tooltip / superscript chip.
  const tableRows = useMemo(() => {
    return rawRows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const c of visibleColumns) {
        const formatted = formatCell(c, row);
        const raw = row[c];
        out[c] =
          typeof raw === "number" && Number.isFinite(raw) ? raw : formatted;
      }
      const codes = (row.value_codes ?? null) as Record<string, string> | null;
      if (codes) (out as Record<string, unknown>).value_codes = codes;
      return out;
    });
  }, [rawRows, visibleColumns, formatCell]);

  const lastUpdate = currentYearData?.lastUpdate ?? null;

  // Most recent lastUpdate across all years (for hero meta strip)
  const heroLastUpdate = useMemo(() => {
    const updates = allYearsData
      .map((d) => d.lastUpdate)
      .filter((u): u is string => !!u)
      .sort();
    return updates[updates.length - 1] ?? lastUpdate;
  }, [allYearsData, lastUpdate]);

  // Insight panel inputs (preserve original logic)
  const insightDataset = useMemo(() => {
    const validYears = availableYears
      .map((y) => String(y || "").trim())
      .filter((y) => /^(19\d{2}|20\d{2}|2100)$/.test(y))
      .sort((a, b) => Number(a) - Number(b));
    return {
      source_id: sourceId,
      type: sourceType,
      period: validYears.length > 0 ? validYears[validYears.length - 1] : selectedYear,
      month: null,
      geo: geoApplied ? geo || undefined : undefined,
    };
  }, [availableYears, sourceId, sourceType, selectedYear, geo, geoApplied]);

  const insightPreview = useMemo(() => {
    const validYears = availableYears
      .map((y) => String(y || "").trim())
      .filter((y) => /^(19\d{2}|20\d{2}|2100)$/.test(y))
      .sort((a, b) => Number(a) - Number(b));
    let periodLabel = `Tahun ${selectedYear}`;
    if (validYears.length > 0) {
      const y0 = validYears[0];
      const y1 = validYears[validYears.length - 1];
      periodLabel = y0 && y1 && y0 !== y1 ? `Tahun ${y0} - ${y1}` : `Tahun ${y0 || selectedYear}`;
    }
    return {
      source: sourceName,
      period: periodLabel,
      last_update: heroLastUpdate,
      type: sourceType,
      geo: geoApplied ? geo || undefined : undefined,
      availableYears,
      month: null,
      columns: allColumns.length > 0 ? allColumns : currentYearData?.columns ?? [],
      sampleRows: rawRows,
      unit: unit ?? undefined,
    };
  }, [availableYears, selectedYear, sourceName, heroLastUpdate, sourceType, geo, geoApplied, allColumns, currentYearData, rawRows, unit]);

  const cleanedQ = useMemo(
    () => sourceName.replace(/\(\s*\d{4}\s*=\s*100\s*\)/gi, "").replace(/\s+/g, " ").trim() || sourceName,
    [sourceName],
  );

  return (
    <div className="space-y-5">
      <StuckContextBar
        sourceName={sourceName}
        sourceType={stype}
        selectedYear={selectedYear}
        monthNo={monthNo ?? null}
        geo={geo ?? null}
        geoApplied={!!geoApplied}
        onCopyLink={handleCopyLink}
        onDownload={() => handleDownload("excel")}
      />

      <Hero
        sourceId={sourceId}
        sourceName={sourceName}
        sourceType={stype}
        unit={unit}
        lastUpdate={heroLastUpdate}
        availableYears={availableYears}
        regionsCount={regionsCount}
        parentCategoryName={parentCategoryName ?? null}
        parentCategorySlug={parentCategorySlug ?? null}
        totalSeries={totalSeries}
      />

      <div className="sticky top-[120px] z-[5] md:top-[133px]">
        <FilterBar
          sourceType={stype}
          availableYears={availableYears}
          selectedYear={selectedYear}
          onYearChange={setSelectedYear}
          monthNo={monthNo ?? null}
          geo={geo ?? null}
          geoApplied={!!geoApplied}
          columns={allColumns}
          hiddenColumns={hiddenColumns}
          onToggleColumn={handleToggleColumn}
          onShowAllColumns={handleShowAllColumns}
          onHideAllColumns={handleHideAllColumns}
          onDownload={handleDownload}
          onPrint={handlePrint}
          rowsCount={rawRows.length}
        />
      </div>

      {visibleColumns.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
          Semua kolom disembunyikan.
          <button
            type="button"
            onClick={handleShowAllColumns}
            className="ml-2 inline-flex items-center justify-center rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Tampilkan semua kolom
          </button>
        </div>
      ) : (
        <DataTable
          sourceId={sourceId}
          sourceType={stype}
          unit={unit}
          selectedYear={selectedYear}
          availableYears={availableYears}
          rows={tableRows}
          columns={visibleColumns}
          allColumns={allColumns}
          totalRowMatcher={isProvincialTotalRow}
          rowSeries={buildRowSeries}
          lastUpdate={lastUpdate}
        />
      )}

      <div className="grid gap-5 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <ChartCard
            rows={rawRows}
            columns={allColumns}
            sourceId={sourceId}
            sourceType={stype}
            chartConfig={chartConfig}
            selectedYear={selectedYear}
            unit={unit}
            lastUpdate={lastUpdate}
          />
        </div>
        <div className="lg:col-span-5">
          {DATA_INSIGHT_ENABLED && (
            <InterpretationCard
              q={cleanedQ}
              cacheRef={insightsCacheRef}
              dataset={insightDataset}
              preview={insightPreview}
            />
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-gray-500 dark:text-gray-400">
        <span>
          Sumber:{" "}
          <span className="font-medium text-gray-800 dark:text-white/90">{sourceName}</span>
        </span>
        {q && (
          <span>
            Pencarian: <span className="italic">{q}</span>
          </span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiny utils
// ─────────────────────────────────────────────────────────────────────────────
function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function csvEscape(s: unknown): string {
  const str = String(s ?? "");
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}
