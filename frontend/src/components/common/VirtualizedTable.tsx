"use client";

import React, { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

interface VirtualizedTableProps<T extends Record<string, unknown>> {
  columns: string[];
  rows: T[];
  /** Height of the container (e.g., "70vh", "400px") */
  height?: string;
  /** Estimated row height in pixels */
  estimateRowHeight?: number;
  /** Function to format cell value */
  formatCell?: (column: string, row: T) => React.ReactNode;
  /** Function to get row class */
  getRowClass?: (row: T, index: number) => string;
  /** Function to get cell class */
  getCellClass?: (column: string, row: T) => string;
  /** Column header formatter */
  formatHeader?: (column: string) => React.ReactNode;
  /** Set of numeric columns for right-alignment */
  numericColumns?: Set<string>;
  /** Threshold to enable virtualization (default: 50) */
  virtualizationThreshold?: number;
}

/**
 * VirtualizedTable - A performant table component that virtualizes rows
 * when the row count exceeds the threshold.
 * 
 * For small tables, renders normally. For large tables (50+ rows by default),
 * uses virtualization to only render visible rows.
 */
export function VirtualizedTable<T extends Record<string, unknown>>({
  columns,
  rows,
  height = "70vh",
  estimateRowHeight = 44,
  formatCell,
  getRowClass,
  getCellClass,
  formatHeader,
  numericColumns = new Set(),
  virtualizationThreshold = 50,
}: VirtualizedTableProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  
  // Only virtualize if we have many rows
  const shouldVirtualize = rows.length >= virtualizationThreshold;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateRowHeight,
    overscan: 10, // Render 10 extra rows above/below for smoother scrolling
  });

  const renderCell = (column: string, row: T) => {
    if (formatCell) {
      return formatCell(column, row);
    }
    const value = row[column];
    if (value === null || value === undefined) return "-";
    return String(value);
  };

  const renderHeader = (column: string) => {
    if (formatHeader) {
      return formatHeader(column);
    }
    return column;
  };

  const getCellClassName = (column: string, row: T) => {
    const baseClass = "px-4 py-3 text-gray-800 dark:text-white/90";
    const alignClass = numericColumns.has(column) ? "text-right" : "";
    const customClass = getCellClass ? getCellClass(column, row) : "";
    return `${baseClass} ${alignClass} ${customClass}`.trim();
  };

  // Non-virtualized rendering for small tables
  if (!shouldVirtualize) {
    return (
      <div 
        ref={parentRef}
        className="overflow-auto rounded-2xl border border-gray-200 dark:border-gray-800 animate-fadeIn"
        style={{ maxHeight: height }}
      >
        <table className="min-w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-white dark:bg-gray-900">
            <tr className="border-b border-gray-200 dark:border-gray-800">
              {columns.map((c) => (
                <th
                  key={c}
                  className={`px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 ${
                    numericColumns.has(c) ? "text-right" : ""
                  }`}
                >
                  {renderHeader(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={idx}
                className={`border-b border-gray-100 dark:border-gray-800 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50 ${
                  getRowClass ? getRowClass(row, idx) : ""
                }`}
              >
                {columns.map((c) => (
                  <td key={c} className={getCellClassName(c, row)}>
                    {renderCell(c, row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // Virtualized rendering for large tables
  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div 
      ref={parentRef}
      className="overflow-auto rounded-2xl border border-gray-200 dark:border-gray-800 animate-fadeIn"
      style={{ maxHeight: height }}
    >
      <table className="min-w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-white dark:bg-gray-900">
          <tr className="border-b border-gray-200 dark:border-gray-800">
            {columns.map((c) => (
              <th
                key={c}
                className={`px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 ${
                  numericColumns.has(c) ? "text-right" : ""
                }`}
              >
                {renderHeader(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Spacer for items above viewport */}
          {virtualItems.length > 0 && virtualItems[0].start > 0 && (
            <tr style={{ height: virtualItems[0].start }} aria-hidden="true">
              <td colSpan={columns.length} />
            </tr>
          )}
          
          {/* Visible rows */}
          {virtualItems.map((virtualRow) => {
            const row = rows[virtualRow.index];
            return (
              <tr
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className={`border-b border-gray-100 dark:border-gray-800 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50 ${
                  getRowClass ? getRowClass(row, virtualRow.index) : ""
                }`}
              >
                {columns.map((c) => (
                  <td key={c} className={getCellClassName(c, row)}>
                    {renderCell(c, row)}
                  </td>
                ))}
              </tr>
            );
          })}
          
          {/* Spacer for items below viewport */}
          {virtualItems.length > 0 && (
            <tr 
              style={{ 
                height: totalSize - (virtualItems[virtualItems.length - 1]?.end ?? 0) 
              }} 
              aria-hidden="true"
            >
              <td colSpan={columns.length} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default VirtualizedTable;
