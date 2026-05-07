"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export default function ReactPdfPreview(props: {
  url: string;
  width: number;
  onLoadProgressAction?: (p: { loaded: number; total: number }) => void;
  onLoadSuccessAction?: (numPages: number) => void;
  onPageRenderAction?: (pageNo: number) => void;
  onErrorAction?: (message: string) => void;
}) {
  const {
    url,
    width,
    onLoadProgressAction,
    onLoadSuccessAction,
    onPageRenderAction,
    onErrorAction,
  } = props;

  const [numPages, setNumPages] = useState(0);
  const [pagesToRender, setPagesToRender] = useState(1);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const safeWidth = useMemo(() => Math.max(320, width || 0), [width]);

  useEffect(() => {
    setNumPages(0);
    setPagesToRender(1);
  }, [url]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const el = sentinelRef.current;
    if (!el) return;
    if (numPages <= 0) return;

    // Render more pages only when the user scrolls near the bottom.
    // This keeps initial render fast, especially on mobile devices.
    const observer = new IntersectionObserver(
      (entries) => {
        const hit = entries.some((e) => e.isIntersecting);
        if (!hit) return;
        setPagesToRender((prev) => {
          if (prev >= numPages) return prev;
          return Math.min(numPages, prev + 2);
        });
      },
      { root: null, rootMargin: "600px 0px", threshold: 0.01 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [numPages]);

  return (
    <Document
      file={url}
      loading={null}
      error={null}
      onLoadProgress={onLoadProgressAction}
      onLoadSuccess={({ numPages: nextNumPages }: { numPages: number }) => {
        const safe = nextNumPages || 0;
        setNumPages(safe);
        setPagesToRender((prev) => {
          const initial = safe > 0 ? Math.min(safe, 2) : 1;
          return Math.max(prev, initial);
        });
        onLoadSuccessAction?.(safe);
      }}
      onLoadError={(e) => {
        onErrorAction?.(e instanceof Error ? e.message : "Gagal memuat PDF");
      }}
      onSourceError={(e) => {
        onErrorAction?.(e instanceof Error ? e.message : "Gagal memuat PDF");
      }}
    >
      {numPages > 0
        ? Array.from({ length: Math.min(numPages, pagesToRender) }, (_, idx) => {
            const pageNo = idx + 1;
            return (
              <div key={pageNo} className="p-[10px]">
                <Page
                  pageNumber={pageNo}
                  width={safeWidth}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  onRenderSuccess={() => onPageRenderAction?.(pageNo)}
                  onRenderError={(e) => {
                    onErrorAction?.(
                      e instanceof Error ? e.message : "Gagal merender PDF",
                    );
                  }}
                />
              </div>
            );
          })
        : null}

      {/* Sentinel to progressively render more pages when user scrolls */}
      {numPages > 0 && pagesToRender < numPages ? (
        <div ref={sentinelRef} className="h-1 w-full" />
      ) : null}
    </Document>
  );
}
