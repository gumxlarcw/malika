"use client";

import { useState, useCallback, useMemo } from "react";

export type UsePaginationOptions = {
  initialPage?: number;
  initialLimit?: number;
  total?: number;
};

export type UsePaginationReturn = {
  page: number;
  offset: number;
  limit: number;
  total: number | undefined;
  totalPages: number;
  canPrev: boolean;
  canNext: boolean;
  setPage: (page: number) => void;
  setTotal: (total: number) => void;
  setLimit: (limit: number) => void;
  next: () => void;
  prev: () => void;
  first: () => void;
  last: () => void;
  reset: () => void;
  goTo: (page: number) => void;
};

/**
 * Hook for managing pagination state.
 * Provides page-based navigation with computed offset.
 */
export function usePagination(options: UsePaginationOptions = {}): UsePaginationReturn {
  const { initialPage = 1, initialLimit = 50, total: initialTotal } = options;

  const [page, setPageState] = useState(initialPage);
  const [limit, setLimit] = useState(initialLimit);
  const [total, setTotal] = useState<number | undefined>(initialTotal);

  const totalPages = useMemo(() => {
    if (total === undefined) return 1;
    return Math.max(1, Math.ceil(total / limit));
  }, [total, limit]);

  const offset = useMemo(() => (page - 1) * limit, [page, limit]);

  const canPrev = page > 1;
  const canNext = page < totalPages;

  const setPage = useCallback(
    (newPage: number) => {
      const clamped = Math.max(1, Math.min(newPage, totalPages));
      setPageState(clamped);
    },
    [totalPages]
  );

  const next = useCallback(() => {
    if (canNext) setPageState((p) => p + 1);
  }, [canNext]);

  const prev = useCallback(() => {
    if (canPrev) setPageState((p) => p - 1);
  }, [canPrev]);

  const first = useCallback(() => {
    setPageState(1);
  }, []);

  const last = useCallback(() => {
    setPageState(totalPages);
  }, [totalPages]);

  const reset = useCallback(() => {
    setPageState(1);
  }, []);

  const goTo = useCallback(
    (targetPage: number) => {
      setPage(targetPage);
    },
    [setPage]
  );

  return {
    page,
    offset,
    limit,
    total,
    totalPages,
    canPrev,
    canNext,
    setPage,
    setTotal,
    setLimit,
    next,
    prev,
    first,
    last,
    reset,
    goTo,
  };
}

/**
 * Simpler offset-based pagination hook for APIs that use offset/limit directly.
 */
export function useOffsetPagination(initialLimit = 50) {
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(initialLimit);
  const [total, setTotal] = useState<number | undefined>(undefined);

  const page = Math.floor(offset / limit) + 1;
  const totalPages = total !== undefined ? Math.ceil(total / limit) : undefined;

  const canPrev = offset > 0;
  const canNext = total !== undefined ? offset + limit < total : true;

  const next = useCallback(() => {
    if (canNext) setOffset((o) => o + limit);
  }, [canNext, limit]);

  const prev = useCallback(() => {
    if (canPrev) setOffset((o) => Math.max(0, o - limit));
  }, [canPrev, limit]);

  const reset = useCallback(() => {
    setOffset(0);
  }, []);

  const goToOffset = useCallback((newOffset: number) => {
    setOffset(Math.max(0, newOffset));
  }, []);

  return {
    offset,
    limit,
    total,
    page,
    totalPages,
    canPrev,
    canNext,
    setOffset: goToOffset,
    setLimit,
    setTotal,
    next,
    prev,
    reset,
  };
}
