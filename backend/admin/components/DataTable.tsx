"use client";

import React from "react";
import { useUiStore } from "@/lib/store/useUiStore";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  RowSelectionState,
  SortingState,
  Table,
  Row,
  Cell,
  HeaderGroup,
  Header,
  useReactTable,
} from "@tanstack/react-table";
import { ChevronDown, ChevronUp } from "lucide-react";
import Pagination from "@/components/ui/Pagination";

export type DataTableColumn<TData> = ColumnDef<TData, unknown> & {
  meta?: {
    align?: "left" | "center" | "right";
  };
};

export type BulkAction<TData> = {
  label: string;
  onClick: (rows: TData[]) => void;
  variant?: "default" | "danger";
};

export type DataTableProps<TData> = {
  columns: DataTableColumn<TData>[];
  data: TData[];
  loading?: boolean;
  emptyMessage?: string;
  pageSize?: number;
  pageIndex?: number;
  pageCount?: number;
  totalItems?: number;
  manualPagination?: boolean;
  onPageChange?: (page: number) => void;
  showPagination?: boolean;
  enableGlobalFilter?: boolean;
  globalFilterPlaceholder?: string;
  enableRowSelection?: boolean;
  bulkActions?: BulkAction<TData>[];
  onRowClick?: (row: TData) => void;
  getRowId?: (row: TData, index: number) => string;
  density?: "comfortable" | "compact";
  mobileCard?: boolean;
};

export default function DataTable<TData>({
  columns,
  data,
  loading = false,
  emptyMessage = "Tidak ada data",
  pageSize = 10,
  pageIndex,
  pageCount,
  totalItems,
  manualPagination = false,
  onPageChange,
  showPagination = true,
  enableGlobalFilter = true,
  globalFilterPlaceholder = "Cari data...",
  enableRowSelection = false,
  bulkActions = [],
  onRowClick,
  getRowId,
  density,
  mobileCard = true,
}: DataTableProps<TData>) {
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const storedDensity = useUiStore((state) => state.tableDensity);
  const resolvedDensity = density || storedDensity || "comfortable";
  const cellPadding = resolvedDensity === "compact" ? "px-3 py-1.5" : "px-4 py-2";

  const selectionColumn = React.useMemo<ColumnDef<TData> | null>(() => {
    if (!enableRowSelection) return null;
    return {
      id: "select",
      header: ({ table }: { table: Table<TData> }) => (
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={table.getIsAllPageRowsSelected()}
          onChange={table.getToggleAllPageRowsSelectedHandler()}
          onClick={(e) => e.stopPropagation()}
          aria-label="Pilih semua"
        />
      ),
      cell: ({ row }: { row: Row<TData> }) => (
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()}
          onClick={(e) => e.stopPropagation()}
          aria-label="Pilih baris"
        />
      ),
      enableSorting: false,
      enableGlobalFilter: false,
      meta: { align: "center" },
    } as ColumnDef<TData>;
  }, [enableRowSelection]);

  const tableColumns = React.useMemo(
    () => (selectionColumn ? [selectionColumn, ...columns] : columns),
    [columns, selectionColumn]
  );

  const table = useReactTable({
    data,
    columns: tableColumns,
    state: {
      globalFilter,
      sorting,
      rowSelection,
      ...(manualPagination
        ? { pagination: { pageIndex: Math.max(0, (pageIndex || 1) - 1), pageSize } }
        : {}),
    },
    globalFilterFn: "includesString",
    enableGlobalFilter,
    enableRowSelection,
    manualPagination,
    pageCount: manualPagination ? pageCount : undefined,
    getRowId: getRowId ? (row: TData, index: number) => getRowId(row, index) : undefined,
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: { pageSize },
    },
  });

  const selectedRows = table
    .getSelectedRowModel()
    .rows.map((row: Row<TData>) => row.original);

  return (
    <div className="space-y-3">
      {(enableGlobalFilter || enableRowSelection) && (
        <div className="flex flex-wrap items-center gap-2 justify-between">
          {enableGlobalFilter && (
            <input
              value={globalFilter ?? ""}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder={globalFilterPlaceholder}
              className="w-full md:w-72 rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          )}

          {enableRowSelection && bulkActions.length > 0 && selectedRows.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {selectedRows.length} dipilih
              </span>
              {bulkActions.map((action) => (
                <button
                  key={action.label}
                  onClick={() => action.onClick(selectedRows)}
                  className={`px-3 py-1.5 rounded text-xs font-medium transition-colors border ${
                    action.variant === "danger"
                      ? "border-red-600 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                      : "border-border text-foreground hover:bg-muted"
                  }`}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card text-card-foreground overflow-hidden">
        {mobileCard && (
          <div className="sm:hidden space-y-3 p-3">
            {loading ? (
              <div className="text-center text-muted-foreground py-6">Memuat data...</div>
            ) : table.getRowModel().rows.length === 0 ? (
              <div className="text-center text-muted-foreground py-6">{emptyMessage}</div>
            ) : (
              table.getRowModel().rows.map((row: Row<TData>) => (
                <div
                  key={row.id}
                  className={`rounded-lg border border-border bg-background p-3 space-y-2 ${
                    onRowClick ? "cursor-pointer hover:bg-muted/40" : ""
                  }`}
                  onClick={() => onRowClick?.(row.original)}
                >
                  {row.getVisibleCells().map((cell: Cell<TData, unknown>) => {
                    const header = cell.column.columnDef.header;
                    const headerLabel =
                      typeof header === "string"
                        ? header
                        : React.isValidElement(header)
                          ? header
                          : cell.column.id;
                    return (
                      <div key={cell.id} className="flex items-start justify-between gap-3">
                        <span className="text-xs text-muted-foreground">{headerLabel}</span>
                        <span className="text-sm text-right">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        )}

        <div className="w-full max-w-full overflow-x-auto overscroll-x-contain hidden sm:block">
          <table className="min-w-full text-sm" aria-label="Data table">
            <thead className="bg-muted">
              {table.getHeaderGroups().map((headerGroup: HeaderGroup<TData>) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header: Header<TData, unknown>) => {
                    const meta = header.column.columnDef.meta as { align?: string } | undefined;
                    const align = meta?.align ?? "left";
                    return (
                      <th
                        key={header.id}
                        className={`${cellPadding} text-${align} font-medium`}
                        scope="col"
                      >
                        {header.isPlaceholder ? null : (
                          <button
                            type="button"
                            className={`inline-flex items-center gap-1 ${
                              header.column.getCanSort() ? "hover:text-foreground" : "cursor-default"
                            }`}
                            onClick={header.column.getToggleSortingHandler()}
                            aria-label={`Sort by ${String(header.column.id)}`}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {header.column.getIsSorted() === "asc" && (
                              <ChevronUp className="h-4 w-4" />
                            )}
                            {header.column.getIsSorted() === "desc" && (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </button>
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={tableColumns.length}
                    className={`${cellPadding} text-center text-muted-foreground`}
                  >
                    Memuat data...
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={tableColumns.length}
                    className={`${cellPadding} text-center text-muted-foreground`}
                  >
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row: Row<TData>) => (
                  <tr
                    key={row.id}
                    className={`border-t border-border hover:bg-muted/40 ${
                      onRowClick ? "cursor-pointer" : ""
                    }`}
                    onClick={() => onRowClick?.(row.original)}
                  >
                    {row.getVisibleCells().map((cell: Cell<TData, unknown>) => {
                      const meta = cell.column.columnDef.meta as { align?: string } | undefined;
                      const align = meta?.align ?? "left";
                      return (
                        <td key={cell.id} className={`${cellPadding} text-${align}`}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showPagination && (
        <Pagination
          page={manualPagination ? pageIndex || 1 : table.getState().pagination.pageIndex + 1}
          totalPages={manualPagination ? pageCount || 1 : table.getPageCount()}
          totalItems={
            manualPagination
              ? totalItems || 0
              : table.getFilteredRowModel().rows.length
          }
          itemsPerPage={pageSize}
          onPageChange={(page) => {
            if (manualPagination && onPageChange) {
              onPageChange(page);
            } else {
              table.setPageIndex(Math.max(0, page - 1));
            }
          }}
        />
      )}
    </div>
  );
}
