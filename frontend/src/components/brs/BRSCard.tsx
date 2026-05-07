"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import LoadingProgressBar from "@/components/LoadingProgressBar";

const ReactPdfPreview = dynamic(() => import("./ReactPdfPreview"), {
  ssr: false,
});

function decodeBasicEntities(input: string) {
  return input
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function sanitizeText(input: string, opts?: { preserveNewlines?: boolean }) {
  let text = String(input || "");
  const preserveNewlines = opts?.preserveNewlines === true;

  // Decode entities first so encoded tags like &lt;li&gt; can be removed.
  text = decodeBasicEntities(text);

  // Preserve intended line breaks before stripping tags.
  text = text.replace(/<\s*br\s*\/?>/gi, "\n");
  text = text.replace(/<\s*\/\s*(p|div|li|ul|ol|h\d)\s*>/gi, "\n");

  // Strip HTML tags early (API sometimes returns rich text)
  text = text.replace(/<[^>]+>/g, " ");

  // Heuristic mojibake fix for UTF-8 interpreted as Latin-1/Win1252.
  if (/[ÃÂâ€]/.test(text)) {
    try {
      const bytes = new Uint8Array(Array.from(text, (c) => c.charCodeAt(0)));
      const decoded = new TextDecoder("utf-8").decode(bytes);
      if (decoded && decoded !== text && !decoded.includes("\uFFFD")) {
        text = decoded;
      }
    } catch {
      // ignore
    }
  }

  // Remove control chars and normalize whitespace
  if (preserveNewlines) {
    text = text.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, " ");
    text = text.replace(/\n\s+/g, "\n");
    text = text.replace(/[ \t\f\v]+/g, " ");
    text = text.replace(/\n{3,}/g, "\n\n");
    text = text
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n");
  } else {
    text = text.replace(/[\u0000-\u001F\u007F]/g, " ");
    text = text.replace(/\s+/g, " ").trim();
  }

  return text;
}

function parseAbstractBullets(abstract?: string) {
  
  const text = sanitizeText(abstract || "", { preserveNewlines: true });
  if (!text) return [];

  const rawLines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const bulletPrefix = /^[\u25A0\u25AA\u25CF\u25D8\u2022\u25E6\u25FE\u25AA\-–—*]+\s*/;

  const hasBullets = rawLines.some((l) => bulletPrefix.test(l));
  if (hasBullets) {
    return rawLines
      .map((l) => l.replace(bulletPrefix, "").trim())
      .filter(Boolean)
      .slice(0, 6);
  }

  if (rawLines.length > 1) {
    return rawLines.slice(0, 6);
  }

  // Fallback: split into sentences.
  return text
    .split(/;|\.(?:\s+|$)/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);
}

type BrsItem = {
  brs_id: number;
  pdf?: string;
  thumbnail?: string;
  title: string;
  abstract?: string;
  rl_date: string;
};

type BrsMeta = {
  page: number;
  pages: number;
  per_page: number;
  count: number;
  total: number;
};

function formatTanggal(tanggalStr: string) {
  const bulanIndo = [
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember",
  ];

  const parts = tanggalStr.split("-");
  if (parts.length !== 3) return tanggalStr;

  const [tahun, bulan, tanggal] = parts;
  const monthIndex = Number.parseInt(bulan, 10) - 1;
  const day = Number.parseInt(tanggal, 10);

  if (Number.isNaN(day) || monthIndex < 0 || monthIndex > 11) return tanggalStr;
  return `${day} ${bulanIndo[monthIndex]} ${tahun}`;
}

// Month names for filter dropdown
const BULAN_OPTIONS = [
  { value: "", label: "Semua Bulan" },
  { value: "01", label: "Januari" },
  { value: "02", label: "Februari" },
  { value: "03", label: "Maret" },
  { value: "04", label: "April" },
  { value: "05", label: "Mei" },
  { value: "06", label: "Juni" },
  { value: "07", label: "Juli" },
  { value: "08", label: "Agustus" },
  { value: "09", label: "September" },
  { value: "10", label: "Oktober" },
  { value: "11", label: "November" },
  { value: "12", label: "Desember" },
];

// Generate year options from current year down to 2020
function getYearOptions() {
  const currentYear = new Date().getFullYear();
  const years = [{ value: "", label: "Semua Tahun" }];
  for (let y = currentYear; y >= 2020; y--) {
    years.push({ value: String(y), label: String(y) });
  }
  return years;
}

export default function BRSCard() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState<BrsMeta | null>(null);
  const [items, setItems] = useState<BrsItem[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [selected, setSelected] = useState<BrsItem | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfProgress, setPdfProgress] = useState(0);
  const [clientPdfMode, setClientPdfMode] = useState<
    "unknown" | "iframe" | "pdfjs"
  >( "unknown" );

  // Filter states - initialize from URL
  const [searchQuery, setSearchQuery] = useState(() => searchParams?.get("keyword") || "");
  const [filterMonth, setFilterMonth] = useState(() => searchParams?.get("month") || "");
  const [filterYear, setFilterYear] = useState(() => searchParams?.get("year") || "");
  const [showFilters, setShowFilters] = useState(false);

  const yearOptions = useMemo(() => getYearOptions(), []);

  // Update URL when filters change
  const updateUrlParams = useCallback((month: string, year: string, keyword: string) => {
    const params = new URLSearchParams(searchParams?.toString() || "");
    
    // Update or remove month param
    if (month) {
      params.set("month", month);
    } else {
      params.delete("month");
    }
    
    // Update or remove year param
    if (year) {
      params.set("year", year);
    } else {
      params.delete("year");
    }
    
    // Update or remove keyword param
    if (keyword.trim()) {
      params.set("keyword", keyword.trim());
    } else {
      params.delete("keyword");
    }
    
    // Keep brs_id if present
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  // Debounced URL update for search query
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    setPage(1); // Reset to page 1 on search
    
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    
    searchTimeoutRef.current = setTimeout(() => {
      updateUrlParams(filterMonth, filterYear, value);
    }, 500);
  }, [filterMonth, filterYear, updateUrlParams]);

  const handleMonthChange = useCallback((value: string) => {
    setFilterMonth(value);
    setPage(1);
    updateUrlParams(value, filterYear, searchQuery);
  }, [filterYear, searchQuery, updateUrlParams]);

  const handleYearChange = useCallback((value: string) => {
    setFilterYear(value);
    setPage(1);
    updateUrlParams(filterMonth, value, searchQuery);
  }, [filterMonth, searchQuery, updateUrlParams]);

  const handleResetFilters = useCallback(() => {
    setSearchQuery("");
    setFilterMonth("");
    setFilterYear("");
    setPage(1);
    updateUrlParams("", "", "");
  }, [updateUrlParams]);

  // Ref to track if we've already opened modal for current brs_id param
  // Prevents double-opening when both list and fetch complete
  const openedForBrsIdRef = useRef<number | null>(null);

  const abstractBullets = useMemo(() => {
    return parseAbstractBullets(selected?.abstract);
  }, [selected?.abstract]);

  const apiKey = useMemo(() => {
    const apiKey =
      process.env.NEXT_PUBLIC_BPS_API_KEY ||
      "e5d1be11320576d466bdeb2f7f210387";

    return apiKey;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");

    // Build API URL with optional filter parameters
    let apiUrl = `https://webapi.bps.go.id/v1/api/list/model/pressrelease/domain/8200/page/${page}`;
    
    // Add keyword filter (server-side)
    if (searchQuery.trim()) {
      apiUrl += `/keyword/${encodeURIComponent(searchQuery.trim())}`;
    }
    
    // Add month filter (server-side)
    if (filterMonth) {
      apiUrl += `/month/${filterMonth}`;
    }
    
    // Add year filter (server-side)
    if (filterYear) {
      apiUrl += `/year/${filterYear}`;
    }
    
    apiUrl += `/key/${apiKey}/`;

    const load = async () => {
      try {
        const res = await fetch(apiUrl, {
          signal: controller.signal,
          cache: "no-store",
        });
        const rawData = (await res.json()) as {
          data?: [BrsMeta, BrsItem[]];
        };

        const nextMeta = (rawData?.data?.[0] || null) as BrsMeta | null;
        const nextItems = (rawData?.data?.[1] || []) as BrsItem[];

        setMeta(nextMeta);
        setItems(Array.isArray(nextItems) ? nextItems : []);
        setStatus("ready");
      } catch {
        if (controller.signal.aborted) return;
        setStatus("error");
      }
    };

    load();

    return () => {
      controller.abort();
    };
  }, [apiKey, page, searchQuery, filterMonth, filterYear]);

  const totalPages = meta?.pages || 1;
  const canPrev = page > 1;
  const canNext = page < totalPages;
  const paginationItems = useMemo(() => {
    const items: Array<
      { type: "page"; value: number } | { type: "ellipsis"; key: string }
    > = [];

    if (totalPages <= 1) return [{ type: "page" as const, value: 1 }];

    // Small page counts: show all
    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, i) => ({
        type: "page" as const,
        value: i + 1,
      }));
    }

    // Near the end: Prev 1 ... (last-2) (last-1) last Next
    if (page >= totalPages - 1) {
      items.push({ type: "page", value: 1 });
      items.push({ type: "ellipsis", key: "start" });
      items.push({ type: "page", value: totalPages - 2 });
      items.push({ type: "page", value: totalPages - 1 });
      items.push({ type: "page", value: totalPages });
      return items;
    }

    // Default: Prev [start][start+1][start+2] ... last Next
    const start = page <= 2 ? 1 : page - 1;
    items.push({ type: "page", value: start });
    items.push({ type: "page", value: start + 1 });
    items.push({ type: "page", value: start + 2 });
    items.push({ type: "ellipsis", key: "end" });
    items.push({ type: "page", value: totalPages });
    return items;
  }, [page, totalPages]);

  const pdfPreviewUrl = useMemo(() => {
    if (!selected?.pdf) return null;
    return `/api/pdf?url=${encodeURIComponent(selected.pdf)}`;
  }, [selected?.pdf]);

  const brsIdParam = useMemo(() => {
    const raw = searchParams?.get("brs_id") || "";
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [searchParams]);

  const closeModal = () => {
    setSelected(null);
    if (!brsIdParam) return;
    const params = new URLSearchParams(searchParams?.toString() || "");
    params.delete("brs_id");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // Reset the opened ref when brsIdParam changes
  useEffect(() => {
    openedForBrsIdRef.current = null;
  }, [brsIdParam]);

  // If opened via deep-link (?brs_id=...), auto-open the modal.
  useEffect(() => {
    if (!brsIdParam) return;
    // Already opened for this brs_id (prevents double-opening)
    if (openedForBrsIdRef.current === brsIdParam) return;
    if (selected?.brs_id === brsIdParam) {
      openedForBrsIdRef.current = brsIdParam;
      return;
    }

    const fromList = items.find((it) => it.brs_id === brsIdParam) || null;
    if (fromList) {
      openedForBrsIdRef.current = brsIdParam;
      setSelected(fromList);
      return;
    }

    const controller = new AbortController();
    const load = async () => {
      try {
        const url = `https://webapi.bps.go.id/v1/api/view/domain/8200/model/pressrelease/lang/ind/id/${brsIdParam}/key/${apiKey}/`;
        const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
        const raw = (await res.json()) as { data?: Record<string, unknown> };
        const d = raw?.data && typeof raw.data === "object" ? raw.data : null;
        if (!d) return;

        // Check again if already opened (another effect may have set it)
        if (openedForBrsIdRef.current === brsIdParam) return;

        const mapped: BrsItem = {
          brs_id: brsIdParam,
          title: String((d as any)?.title || ""),
          abstract: (d as any)?.abstract != null ? String((d as any).abstract) : undefined,
          rl_date: String((d as any)?.rl_date || ""),
          pdf:
            (d as any)?.pdf != null
              ? String((d as any).pdf)
              : (d as any)?.pdf_url != null
                ? String((d as any).pdf_url)
                : undefined,
          thumbnail:
            (d as any)?.thumbnail != null
              ? String((d as any).thumbnail)
              : (d as any)?.thumbnail_url != null
                ? String((d as any).thumbnail_url)
                : undefined,
        };

        if (mapped.title || mapped.pdf) {
          openedForBrsIdRef.current = brsIdParam;
          setSelected(mapped);
        }
      } catch {
        // best-effort
      }
    };

    load();
    return () => controller.abort();
  }, [apiKey, brsIdParam, items, selected?.brs_id]);

  // Client-only UA detection to avoid hydration mismatch.
  useEffect(() => {
    if (typeof navigator === "undefined") {
      setClientPdfMode("iframe");
      return;
    }

    const ua = navigator.userAgent || "";
    const isSafari =
      /safari/i.test(ua) && !/chrome|chromium|crios|android/i.test(ua);

    const isAndroid = /android/i.test(ua);

    const iOSDevice = /iPad|iPhone|iPod/i.test(ua);
    const iPadOS13Plus =
      // iPadOS reports MacIntel but has touch points
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (navigator as any).platform === "MacIntel" && navigator.maxTouchPoints > 1;
    const isIOS = iOSDevice || iPadOS13Plus;

    // Mobile browsers (iOS/Android) often show a built-in PDF toolbar (Open/Download)
    // and can have broken scrolling in iframes. Use PDF.js for consistent preview.
    setClientPdfMode(isIOS || isSafari || isAndroid ? "pdfjs" : "iframe");
  }, []);

  const shouldUsePdfJs = clientPdfMode === "pdfjs";

  // Items are now filtered server-side via BPS API params
  const filteredItems = items;

  function PdfJsPreview({ url }: { url: string }) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [rendering, setRendering] = useState(false);
    const [totalPages, setTotalPages] = useState(0);
    const [renderedPages, setRenderedPages] = useState(0);
    const [downloadPct, setDownloadPct] = useState<number | null>(null);
    const [containerWidth, setContainerWidth] = useState<number>(0);

    useEffect(() => {
      let resizeObserver: ResizeObserver | null = null;

      const updateWidth = () => {
        const el = containerRef.current;
        if (!el) return;
        const next = Math.floor(el.clientWidth || 0);
        if (!next) return;
        setContainerWidth((prev) => (Math.abs(prev - next) >= 12 ? next : prev));
      };

      updateWidth();

      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => updateWidth());
        if (containerRef.current) resizeObserver.observe(containerRef.current);
      }

      return () => {
        if (resizeObserver) resizeObserver.disconnect();
      };
    }, [url]);

    useEffect(() => {
      // Reset progress counters on URL change
      setError(null);
      setTotalPages(0);
      setRenderedPages(0);
      setDownloadPct(null);
      setRendering(true);
    }, [url]);

    return (
      <div className="pdfjs-scroll h-full w-full overflow-y-auto overscroll-contain bg-white pb-16 [-webkit-overflow-scrolling:touch] dark:bg-gray-900">
        {error ? (
          <div className="flex h-full w-full items-center justify-center px-4 text-theme-sm text-gray-500 dark:text-gray-400">
            {error}
          </div>
        ) : null}

        {rendering ? (
          <div className="px-4 py-3">
            <div className="flex items-center justify-between text-theme-sm text-gray-700 dark:text-gray-200">
              <span>
                Memuat PDF
                {typeof downloadPct === "number" ? ` (${downloadPct}%)` : "..."}
              </span>
              {totalPages > 0 ? (
                <span className="text-theme-xs text-gray-500 dark:text-gray-400">
                  {Math.min(Math.max(renderedPages, 1), totalPages)}/{totalPages} halaman
                </span>
              ) : null}
            </div>

            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
              <div
                className="h-full rounded-full bg-gray-900 transition-[width] duration-200 dark:bg-white"
                style={{ width: `${typeof downloadPct === "number" ? downloadPct : 10}%` }}
              />
            </div>
          </div>
        ) : null}

        <div ref={containerRef} className="mx-auto w-full max-w-[900px]">
          <ReactPdfPreview
            url={url}
            width={containerWidth}
            onLoadProgressAction={(p) => {
              const total = p?.total || 0;
              const loaded = p?.loaded || 0;
              if (total > 0) {
                const pct = Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
                setDownloadPct(pct);
              }
            }}
            onLoadSuccessAction={(numPages) => {
              setTotalPages(numPages || 0);
            }}
            onPageRenderAction={(pageNo) => {
              setRenderedPages((p) => (pageNo > p ? pageNo : p));
              if (pageNo === 1) setRendering(false);
            }}
            onErrorAction={(message) => {
              setError(message || "Gagal memuat PDF");
              setRendering(false);
            }}
          />
        </div>
      </div>
    );
  }

  useEffect(() => {
    if (!selected) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelected(null);
        if (brsIdParam) {
          const params = new URLSearchParams(searchParams?.toString() || "");
          params.delete("brs_id");
          const qs = params.toString();
          router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
        }
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [brsIdParam, pathname, router, searchParams, selected]);

  useEffect(() => {
    if (!selected?.pdf) {
      setPdfLoading(false);
      setPdfProgress(0);
      return;
    }

    if (shouldUsePdfJs) {
      // PDF.js rendering (no iframe onLoad), so avoid blocking overlay.
      setPdfLoading(false);
      setPdfProgress(0);
      return;
    }

    setPdfLoading(true);
    setPdfProgress(0);

    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const eased = 1 - Math.exp(-elapsed / 600);
      const next = Math.min(90, Math.round(eased * 90));
      setPdfProgress((p) => (next > p ? next : p));
    }, 80);

    return () => window.clearInterval(interval);
  }, [selected?.pdf, shouldUsePdfJs]);

  useEffect(() => {
    if (!selected) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [selected]);

  // Active filter count for badge
  const activeFilterCount = (searchQuery.trim() ? 1 : 0) + (filterMonth ? 1 : 0) + (filterYear ? 1 : 0);

  return (
    <div className="min-w-0">
      {/* Filter Section - Mobile optimized */}
      <div className="mb-4 space-y-3">
        {/* Mobile: Search + Filter Toggle Button */}
        <div className="flex gap-2">
          {/* Search Input */}
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Cari judul BRS..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="h-11 w-full rounded-lg border border-gray-200 bg-white px-4 py-2 pl-10 text-sm text-gray-900 placeholder-gray-500 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/30 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500"
            />
            <svg
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>

          {/* Filter Toggle Button (Mobile) */}
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className="relative flex h-11 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-400/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 sm:hidden"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            {activeFilterCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* Desktop: Inline Dropdowns */}
          <div className="hidden gap-2 sm:flex">
            {/* Month Filter */}
            <select
              value={filterMonth}
              onChange={(e) => handleMonthChange(e.target.value)}
              className="h-11 min-w-[130px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/30 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            >
              {BULAN_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            {/* Year Filter */}
            <select
              value={filterYear}
              onChange={(e) => handleYearChange(e.target.value)}
              className="h-11 min-w-[100px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/30 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            >
              {yearOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Mobile: Expandable Filter Panel */}
        {showFilters && (
          <div className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50 sm:hidden">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Bulan</label>
            <select
              value={filterMonth}
              onChange={(e) => handleMonthChange(e.target.value)}
              className="h-11 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/30 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            >
              {BULAN_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            <label className="mt-1 text-xs font-medium text-gray-600 dark:text-gray-400">Tahun</label>
            <select
              value={filterYear}
              onChange={(e) => handleYearChange(e.target.value)}
              className="h-11 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/30 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            >
              {yearOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="mt-2 h-10 w-full rounded-lg bg-red-50 text-sm font-medium text-red-600 transition-colors hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30"
              >
                Reset Semua Filter
              </button>
            )}
          </div>
        )}

        {/* Filter Info & Results Count */}
        {(searchQuery || filterMonth || filterYear) && status === "ready" && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm dark:bg-blue-900/20">
            <span className="text-blue-800 dark:text-blue-200">
              <span className="font-medium">{meta?.total || items.length}</span> hasil ditemukan
              {searchQuery && (
                <span className="ml-1 inline-flex items-center rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-800/50 dark:text-blue-200">
                  &quot;{searchQuery}&quot;
                </span>
              )}
              {filterMonth && (
                <span className="ml-1 inline-flex items-center rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-800/50 dark:text-blue-200">
                  {BULAN_OPTIONS.find(b => b.value === filterMonth)?.label}
                </span>
              )}
              {filterYear && (
                <span className="ml-1 inline-flex items-center rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-800/50 dark:text-blue-200">
                  {filterYear}
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={handleResetFilters}
              className="hidden text-sm font-medium text-blue-600 hover:underline dark:text-blue-400 sm:inline"
            >
              Reset Filter
            </button>
          </div>
        )}
      </div>

      {status === "loading" && (
        <LoadingProgressBar className="mt-4" label="Loading" />
      )}

      {status === "error" && (
        <p className="mt-4 text-theme-sm text-red-600 dark:text-red-400">
          Gagal memuat BRS
        </p>
      )}

      {status === "ready" && items.length === 0 && (
        <p className="mt-4 text-theme-sm text-gray-500 dark:text-gray-400">
          BRS tidak ditemukan
        </p>
      )}

      {status === "ready" && items.length > 0 && filteredItems.length === 0 && (
        <p className="mt-4 text-theme-sm text-gray-500 dark:text-gray-400">
          Tidak ada BRS yang sesuai dengan filter
        </p>
      )}

      {filteredItems.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {filteredItems.map((item) => (
            <button
              key={item.brs_id}
              type="button"
              onClick={() => setSelected(item)}
              className="origin-center overflow-hidden rounded-lg sm:rounded-xl border border-gray-200 bg-white shadow-theme-sm transition-transform duration-200 hover:scale-[1.02] hover:shadow-theme-md dark:border-gray-800 dark:bg-white/[0.03]"
            >
              <div className="w-full bg-gray-100 dark:bg-white/[0.05]">
                {item.thumbnail ? (
                  <img
                    src={item.thumbnail}
                    alt=""
                    loading="lazy"
                    className="block h-auto w-full aspect-[3/4] object-cover"
                  />
                ) : (
                  <div className="aspect-[3/4] w-full" />
                )}
              </div>

              <div className="p-2 sm:p-3">
                <p className="text-xs sm:text-sm font-semibold text-gray-900 dark:text-white/90 line-clamp-2">
                  {sanitizeText(item?.title || "") || "(Tanpa judul)"}
                </p>
                <p className="mt-1 text-[10px] sm:text-theme-sm text-gray-500 dark:text-gray-400">
                  {item?.rl_date ? formatTanggal(item.rl_date) : "-"}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {typeof window !== "undefined" && selected && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[2147483647] flex items-start justify-center overflow-y-auto bg-black/50 p-4 overscroll-contain [-webkit-overflow-scrolling:touch] lg:items-center lg:overflow-y-hidden"
          onClick={closeModal}
        >
          <div
            className="relative w-full max-w-6xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-md dark:border-gray-800 dark:bg-gray-900 lg:h-[calc(100dvh-2rem)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex min-h-0 flex-col gap-0 lg:h-full lg:flex-row">
              <div className="w-full border-b border-gray-200 p-4 dark:border-gray-800 lg:flex lg:h-full lg:w-[520px] lg:flex-col lg:border-b-0 lg:border-r">
                <div className="w-full overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-white/[0.03] lg:min-h-0 lg:flex-1">
                  {selected.thumbnail ? (
                    <img
                      src={selected.thumbnail}
                      alt=""
                      className="block h-auto w-full lg:h-full lg:w-full lg:object-contain"
                    />
                  ) : (
                    <div className="aspect-4/3 w-full lg:h-full" />
                  )}
                </div>

                <div className="mt-4 space-y-2 lg:flex-none">
                  <p className="line-clamp-3 text-sm font-semibold text-gray-900 dark:text-white/90">
                    {sanitizeText(selected.title || "") || "(Tanpa judul)"}
                  </p>

                  {abstractBullets.length > 0 ? (
                    <ul className="list-disc space-y-1 pl-5 text-theme-sm text-gray-700 dark:text-gray-300">
                      {abstractBullets.map((b, i) => (
                        <li key={i}>{b}</li>
                      ))}
                    </ul>
                  ) : null}

                  <p className="text-theme-sm text-gray-500 dark:text-gray-400">
                    {selected?.rl_date ? formatTanggal(selected.rl_date) : "-"}
                  </p>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={closeModal}
                      className="rounded-lg border border-pink-500/50 bg-pink-500/35 px-3 py-2 text-sm font-medium text-pink-700 shadow-theme-sm backdrop-blur-sm transition-colors hover:bg-pink-500/45 dark:border-pink-400/40 dark:bg-pink-500/20 dark:text-pink-200"
                    >
                      Tutup
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col p-4">
                <div className="relative w-full flex-1 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] lg:min-h-0">
                  <div className="w-full aspect-[210/297] lg:aspect-auto lg:h-full">
                    {pdfPreviewUrl ? (
                      shouldUsePdfJs ? (
                        <PdfJsPreview url={pdfPreviewUrl} />
                      ) : (
                        <iframe
                          title="Preview PDF"
                          src={pdfPreviewUrl}
                          className="h-full w-full"
                          scrolling="yes"
                          allowFullScreen
                          onLoad={() => {
                            setPdfProgress(100);
                            window.setTimeout(() => setPdfLoading(false), 250);
                          }}
                        />
                      )
                    ) : (
                      <div className="flex h-full w-full items-center justify-center px-4 text-theme-sm text-gray-500 dark:text-gray-400">
                        Preview PDF tidak tersedia
                      </div>
                    )}
                  </div>

                  {pdfPreviewUrl && pdfLoading ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/70 dark:bg-gray-900/60">
                      <div className="w-full max-w-md px-6">
                        <div className="flex items-center justify-between text-sm font-medium text-gray-700 dark:text-gray-200">
                          <span>Memuat PDF</span>
                          <span>{pdfProgress}%</span>
                        </div>
                        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                          <div
                            className="h-full rounded-full bg-gray-900 transition-[width] duration-200 dark:bg-white"
                            style={{ width: `${pdfProgress}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      <div className="mt-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
          <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={!canPrev || status === "loading"}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-opacity disabled:opacity-50 dark:border-gray-800 dark:bg-white/[0.03] dark:text-white/90"
            >
              Prev
            </button>

            <div className="flex flex-1 flex-wrap items-center justify-center gap-1 sm:flex-initial sm:justify-start">
              {paginationItems.map((it) => {
                if (it.type === "ellipsis") {
                  return (
                    <span
                      key={it.key}
                      className="px-2 py-2 text-sm text-gray-500 dark:text-gray-400"
                    >
                      ...
                    </span>
                  );
                }

                const n = it.value;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setPage(n)}
                    disabled={status === "loading"}
                    className={`min-w-9 rounded-lg border px-3 py-2 text-sm font-medium transition-opacity disabled:opacity-50 dark:bg-white/[0.03] ${
                      n === page
                        ? "border-gray-900 text-gray-900 dark:border-gray-200 dark:text-white/90"
                        : "border-gray-200 text-gray-700 dark:border-gray-800 dark:text-white/90"
                    }`}
                  >
                    {n}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={!canNext || status === "loading"}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-opacity disabled:opacity-50 dark:border-gray-800 dark:bg-white/[0.03] dark:text-white/90"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
