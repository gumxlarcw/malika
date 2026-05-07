"use client";

import React from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

export type PaginationProps = {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  showFirstLast?: boolean;
  showInfo?: boolean;
  totalItems?: number;
  itemsPerPage?: number;
  compact?: boolean;
};

export default function Pagination({
  page,
  totalPages,
  onPageChange,
  showFirstLast = true,
  showInfo = true,
  totalItems,
  itemsPerPage,
  compact = false,
}: PaginationProps) {
  const canPrev = page > 1;
  const canNext = page < totalPages;

  const buttonClass = `p-2 rounded border border-border hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
    compact ? "p-1.5" : "p-2"
  }`;

  const iconSize = compact ? "h-4 w-4" : "h-5 w-5";

  if (totalPages <= 1) {
    return showInfo && totalItems !== undefined ? (
      <div className="text-sm text-muted-foreground">
        Total: {totalItems} item
      </div>
    ) : null;
  }

  return (
    <div className="flex items-center justify-between gap-4">
      {/* Info */}
      {showInfo && (
        <div className="text-sm text-muted-foreground">
          {totalItems !== undefined && itemsPerPage !== undefined ? (
            <>
              Menampilkan {Math.min((page - 1) * itemsPerPage + 1, totalItems)}-
              {Math.min(page * itemsPerPage, totalItems)} dari {totalItems}
            </>
          ) : (
            <>
              Halaman {page} dari {totalPages}
            </>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-1">
        {showFirstLast && (
          <button
            onClick={() => onPageChange(1)}
            disabled={!canPrev}
            className={buttonClass}
            title="Halaman pertama"
          >
            <ChevronsLeft className={iconSize} />
          </button>
        )}
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={!canPrev}
          className={buttonClass}
          title="Sebelumnya"
        >
          <ChevronLeft className={iconSize} />
        </button>

        {/* Page indicator */}
        <span className="px-3 py-1 text-sm font-medium">
          {page} / {totalPages}
        </span>

        <button
          onClick={() => onPageChange(page + 1)}
          disabled={!canNext}
          className={buttonClass}
          title="Selanjutnya"
        >
          <ChevronRight className={iconSize} />
        </button>
        {showFirstLast && (
          <button
            onClick={() => onPageChange(totalPages)}
            disabled={!canNext}
            className={buttonClass}
            title="Halaman terakhir"
          >
            <ChevronsRight className={iconSize} />
          </button>
        )}
      </div>
    </div>
  );
}

// Simple offset-based pagination for APIs that use offset/limit
export type OffsetPaginationProps = {
  offset: number;
  limit: number;
  total?: number;
  onOffsetChange: (newOffset: number) => void;
  compact?: boolean;
};

export function OffsetPagination({
  offset,
  limit,
  total,
  onOffsetChange,
  compact = false,
}: OffsetPaginationProps) {
  const page = Math.floor(offset / limit) + 1;
  const totalPages = total !== undefined ? Math.ceil(total / limit) : undefined;

  const canPrev = offset > 0;
  const canNext = total !== undefined ? offset + limit < total : true;

  const buttonClass = `p-2 rounded border border-border hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
    compact ? "p-1.5" : "p-2"
  }`;

  const iconSize = compact ? "h-4 w-4" : "h-5 w-5";

  return (
    <div className="flex items-center justify-between gap-4">
      {/* Info */}
      <div className="text-sm text-muted-foreground">
        {total !== undefined ? (
          <>
            Menampilkan {Math.min(offset + 1, total)}-{Math.min(offset + limit, total)} dari {total}
          </>
        ) : (
          <>offset={offset} limit={limit}</>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => onOffsetChange(Math.max(0, offset - limit))}
          disabled={!canPrev}
          className={buttonClass}
          title="Sebelumnya"
        >
          <ChevronLeft className={iconSize} />
        </button>

        {totalPages !== undefined && (
          <span className="px-3 py-1 text-sm font-medium">
            {page} / {totalPages}
          </span>
        )}

        <button
          onClick={() => onOffsetChange(offset + limit)}
          disabled={!canNext}
          className={buttonClass}
          title="Selanjutnya"
        >
          <ChevronRight className={iconSize} />
        </button>
      </div>
    </div>
  );
}
