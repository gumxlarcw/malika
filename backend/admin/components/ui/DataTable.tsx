"use client";

import React from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Column<T = any> = {
  key: keyof T | string;
  label: string;
  className?: string;
  render?: (item: T, index: number) => React.ReactNode;
  sortable?: boolean;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DataTableProps<T = any> = {
  columns: Column<T>[];
  data: T[];
  keyField?: keyof T;
  emptyMessage?: string;
  onRowClick?: (item: T) => void;
  rowClassName?: (item: T) => string;
  loading?: boolean;
  loadingRows?: number;
  stickyHeader?: boolean;
  compact?: boolean;
};

function getNestedValue<T>(obj: T, path: string): unknown {
  return path.split(".").reduce((acc: unknown, part: string) => {
    if (acc && typeof acc === "object" && part in acc) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function DataTable<T extends Record<string, any>>({
  columns,
  data,
  keyField = "id" as keyof T,
  emptyMessage = "Tidak ada data",
  onRowClick,
  rowClassName,
  loading = false,
  loadingRows = 5,
  stickyHeader = false,
  compact = false,
}: DataTableProps<T>) {
  const cellPadding = compact ? "px-3 py-1.5" : "px-4 py-2";
  
  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card text-card-foreground overflow-hidden">
        <div className="w-full max-w-full overflow-x-auto overscroll-x-contain">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-muted">
                {columns.map((col) => (
                  <th
                    key={String(col.key)}
                    className={`${cellPadding} text-left font-medium ${col.className || ""}`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: loadingRows }).map((_, rowIdx) => (
                <tr key={rowIdx} className="border-t border-border">
                  {columns.map((col, colIdx) => (
                    <td key={colIdx} className={cellPadding}>
                      <div className="h-4 bg-muted rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card text-card-foreground p-8 text-center text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card text-card-foreground overflow-hidden">
      <div className="w-full max-w-full overflow-x-auto overscroll-x-contain">
        <table className="min-w-full text-sm">
          <thead className={stickyHeader ? "sticky top-0 z-10" : ""}>
            <tr className="bg-muted">
              {columns.map((col) => (
                <th
                  key={String(col.key)}
                  className={`${cellPadding} text-left font-medium ${col.className || ""}`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((item, idx) => {
              const key = item[keyField] !== undefined ? String(item[keyField]) : idx;
              return (
                <tr
                  key={key}
                  className={`border-t border-border hover:bg-muted/50 transition-colors ${
                    onRowClick ? "cursor-pointer" : ""
                  } ${rowClassName ? rowClassName(item) : ""}`}
                  onClick={() => onRowClick?.(item)}
                >
                  {columns.map((col) => (
                    <td
                      key={String(col.key)}
                      className={`${cellPadding} ${col.className || ""}`}
                    >
                      {col.render
                        ? col.render(item, idx)
                        : String(getNestedValue(item, String(col.key)) ?? "-")}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
