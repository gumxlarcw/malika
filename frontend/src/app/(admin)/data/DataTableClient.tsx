"use client";

import React from "react";
import { VirtualizedTable } from "@/components/common/VirtualizedTable";
import EmptyState from "@/components/common/EmptyState";
import { renderCellWithCode } from "@/lib/cellRender";

interface DataTableClientProps {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  monthKeyCol: string | null;
  monthNo: number | null;
}

function matchesMonthCell(val: unknown, month: number): boolean {
  const s = String(val ?? "").toLowerCase().trim();
  // Indonesian month names
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
    // Numeric month
    if (s === String(month) || s === String(month).padStart(2, "0")) return true;
  }
  return false;
}

/**
 * Client-side data table component with virtualization support.
 * Used in the /data page for displaying large datasets.
 */
export default function DataTableClient({
  columns,
  rows,
  monthKeyCol,
  monthNo,
}: DataTableClientProps) {
  if (rows.length === 0) {
    return (
      <EmptyState 
        variant="no-data"
        title="Tidak ada data"
        description="Tidak ada data yang sesuai dengan filter yang dipilih."
      />
    );
  }

  const hasMonth = !!monthKeyCol && monthNo !== null;

  return (
    <VirtualizedTable
      columns={columns}
      rows={rows}
      height="70vh"
      virtualizationThreshold={50}
      formatCell={(column, row) => renderCellWithCode(row, column)}
      getRowClass={(row, _idx) => {
        if (!hasMonth) return "";
        const monthHit = matchesMonthCell(row[monthKeyCol!], monthNo!);
        return monthHit ? "bg-brand-50/70 dark:bg-brand-500/10" : "";
      }}
      getCellClass={(column, row) => {
        if (!hasMonth) return "";
        const monthHit = matchesMonthCell(row[monthKeyCol!], monthNo!);
        if (!monthHit) return "";
        if (column === monthKeyCol) {
          return "font-semibold border-l-4 border-brand-500 pl-3";
        }
        return "font-semibold";
      }}
    />
  );
}
