/**
 * KnowledgeModal - Displays BRS/Publication documents with PDF preview
 * Aligned with BRSCard / PublikasiCard page modals (same BPS WebAPI, styling, PDF strategy)
 */

"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import type { KnowledgeDocument } from "@/types/chat";
import {
  sanitizeText,
  parseAbstractBullets,
  formatDateIndo,
} from "@/lib/chatUtils";
import { getBpsApiKey, CHAT_TEXT } from "@/lib/chatConstants";

const ReactPdfPreview = dynamic(
  () => import("@/components/brs/ReactPdfPreview"),
  { ssr: false }
);

// M8: In-memory doc cache — avoids refetching same document within a session
const DOC_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const docCache = new Map<number, { doc: KnowledgeDocument; ts: number }>();

function getCachedDoc(id: number): KnowledgeDocument | null {
  const entry = docCache.get(id);
  if (!entry) return null;
  if (Date.now() - entry.ts > DOC_CACHE_TTL_MS) {
    docCache.delete(id);
    return null;
  }
  return entry.doc;
}

function setCachedDoc(id: number, doc: KnowledgeDocument) {
  // Evict oldest if cache exceeds 50 entries
  if (docCache.size >= 50) {
    const oldest = docCache.keys().next().value;
    if (oldest !== undefined) docCache.delete(oldest);
  }
  docCache.set(id, { doc, ts: Date.now() });
}

export interface KnowledgeModalProps {
  id: number;
  onClose: () => void;
}

export function KnowledgeModal({ id, onClose }: KnowledgeModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<KnowledgeDocument | null>(null);
  const [thumbError, setThumbError] = useState(false);

  const apiKey = useMemo(() => getBpsApiKey(), []);

  // --------------- UA-based PDF strategy (matches BRSCard / PublikasiCard) ---------------
  const [clientPdfMode, setClientPdfMode] = useState<"iframe" | "pdfjs" | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfProgress, setPdfProgress] = useState(0);

  useEffect(() => {
    if (typeof navigator === "undefined") {
      setClientPdfMode("iframe");
      return;
    }
    const ua = navigator.userAgent || "";
    const isSafari = /safari/i.test(ua) && !/chrome|chromium|crios|android/i.test(ua);
    const isAndroid = /android/i.test(ua);
    const iOSDevice = /iPad|iPhone|iPod/i.test(ua);
    const iPadOS13Plus =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (navigator as any).platform === "MacIntel" && navigator.maxTouchPoints > 1;
    const isIOS = iOSDevice || iPadOS13Plus;
    setClientPdfMode(isIOS || isSafari || isAndroid ? "pdfjs" : "iframe");
  }, []);

  const shouldUsePdfJs = clientPdfMode === "pdfjs";

  // --------------- Fetch document from BPS WebAPI (2-step, with cache) ---------------
  useEffect(() => {
    // M8: Check cache first
    const cached = getCachedDoc(id);
    if (cached) {
      setDoc(cached);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();

    const fetchDoc = async () => {
      setLoading(true);
      setError(null);
      try {
        // Step 1: Get BPS API mapping from our backend
        const mappingRes = await fetch(`/api/search/knowledge/${id}`, {
          signal: controller.signal,
        });
        if (!mappingRes.ok) throw new Error("Gagal memuat dokumen");
        const mapping = await mappingRes.json();

        let result: KnowledgeDocument;

        // Step 2: If it's a BPS document, fetch from BPS WebAPI directly
        if (mapping.source === "bps_api" && mapping.external_id && apiKey) {
          const model =
            mapping.doc_type === "brs" ? "pressrelease" : "publication";
          const bpsUrl = `https://webapi.bps.go.id/v1/api/view/domain/8200/model/${model}/lang/ind/id/${encodeURIComponent(mapping.external_id)}/key/${apiKey}/`;

          const bpsRes = await fetch(bpsUrl, {
            signal: controller.signal,
            cache: "no-store",
          });
          const bpsData = (await bpsRes.json()) as {
            data?: Record<string, unknown>;
          };
          const d =
            bpsData?.data && typeof bpsData.data === "object"
              ? bpsData.data
              : null;

          if (d) {
            result = {
              title: String(
                (d as Record<string, unknown>).title || mapping.title || ""
              ),
              abstract:
                (d as Record<string, unknown>).abstract != null
                  ? String((d as Record<string, unknown>).abstract)
                  : undefined,
              release_date: String(
                (d as Record<string, unknown>).rl_date ||
                  mapping.release_date ||
                  ""
              ),
              pdf:
                (d as Record<string, unknown>).pdf != null
                  ? String((d as Record<string, unknown>).pdf)
                  : (d as Record<string, unknown>).pdf_url != null
                    ? String((d as Record<string, unknown>).pdf_url)
                    : mapping.pdf_url || undefined,
              thumbnail:
                mapping.doc_type === "brs"
                  ? (d as Record<string, unknown>).thumbnail != null
                    ? String((d as Record<string, unknown>).thumbnail)
                    : undefined
                  : (d as Record<string, unknown>).cover != null
                    ? String((d as Record<string, unknown>).cover)
                    : undefined,
              doc_type: mapping.doc_type,
            };
          } else {
            result = {
              title: mapping.title || "",
              release_date: mapping.release_date || "",
              pdf: mapping.pdf_url || undefined,
              doc_type: mapping.doc_type,
            };
          }
        } else {
          result = {
            title: mapping.title || "",
            abstract: mapping.content || mapping.description || undefined,
            pdf: mapping.source_url || undefined,
            doc_type: "custom",
          };
        }

        setCachedDoc(id, result);
        setDoc(result);
      } catch (err: unknown) {
        if ((err as Error).name !== "AbortError") {
          setError((err as Error).message || CHAT_TEXT.error);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchDoc();
    return () => controller.abort();
  }, [id, apiKey]);

  // Close on ESC key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Lock body scroll when modal is open
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  // --------------- Iframe simulated progress (matches BRSCard) ---------------
  useEffect(() => {
    if (!doc?.pdf) {
      setPdfLoading(false);
      setPdfProgress(0);
      return;
    }
    if (shouldUsePdfJs) {
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
  }, [doc?.pdf, shouldUsePdfJs]);

  const pdfPreviewUrl = doc?.pdf
    ? `/api/pdf?url=${encodeURIComponent(doc.pdf)}`
    : null;

  const isBrs = doc?.doc_type === "brs";
  const abstractBullets = useMemo(
    () => parseAbstractBullets(doc?.abstract),
    [doc?.abstract]
  );
  const formattedDate = useMemo(
    () => formatDateIndo(doc?.release_date || ""),
    [doc?.release_date]
  );

  // --------------- PdfJsPreview (matches BRSCard internal component) ---------------
  function PdfJsPreview({ url }: { url: string }) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [pdfError, setPdfError] = useState<string | null>(null);
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
      return () => { if (resizeObserver) resizeObserver.disconnect(); };
    }, [url]);

    useEffect(() => {
      setPdfError(null);
      setTotalPages(0);
      setRenderedPages(0);
      setDownloadPct(null);
      setRendering(true);
    }, [url]);

    return (
      <div className="pdfjs-scroll h-full w-full overflow-y-auto overscroll-contain bg-white pb-16 [-webkit-overflow-scrolling:touch] dark:bg-gray-900">
        {pdfError ? (
          <div className="flex h-full w-full items-center justify-center px-4 text-theme-sm text-gray-500 dark:text-gray-400">
            {pdfError}
          </div>
        ) : null}

        {rendering ? (
          <div className="px-4 py-3">
            <div className="flex items-center justify-between text-theme-sm text-gray-700 dark:text-gray-200">
              <span>
                Memuat PDF{typeof downloadPct === "number" ? ` (${downloadPct}%)` : "..."}
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
          {containerWidth > 0 && (
            <ReactPdfPreview
              url={url}
              width={containerWidth}
              onLoadProgressAction={(p: { loaded?: number; total?: number }) => {
                const total = p?.total || 0;
                const loaded = p?.loaded || 0;
                if (total > 0) {
                  const pct = Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
                  setDownloadPct(pct);
                }
              }}
              onLoadSuccessAction={(numPages: number) => {
                setTotalPages(numPages || 0);
              }}
              onPageRenderAction={(pageNo: number) => {
                setRenderedPages((p) => (pageNo > p ? pageNo : p));
                if (pageNo === 1) setRendering(false);
              }}
              onErrorAction={(message: string) => {
                setPdfError(message || "Gagal memuat PDF");
                setRendering(false);
              }}
            />
          )}
        </div>
      </div>
    );
  }

  // --------------- Render (aligned with BRSCard / PublikasiCard modal) ---------------
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[2147483647] flex items-start justify-center overflow-y-auto bg-black/50 p-4 overscroll-contain [-webkit-overflow-scrolling:touch] lg:items-center lg:overflow-y-hidden"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-6xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-md dark:border-gray-800 dark:bg-gray-900 lg:h-[calc(100dvh-2rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Loading state */}
        {loading && (
          <div className="flex h-64 items-center justify-center lg:h-full">
            <div className="flex items-center gap-2 text-gray-500">
              <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>{CHAT_TEXT.loadingDocument}</span>
            </div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="flex h-64 items-center justify-center lg:h-full">
            <div className="rounded-lg bg-red-50 p-4 text-center text-red-600 dark:bg-red-950/50 dark:text-red-400">
              {error}
            </div>
          </div>
        )}

        {/* Document content */}
        {!loading && !error && doc && (
          <div className="flex min-h-0 flex-col gap-0 lg:h-full lg:flex-row">
            {/* Left panel: Thumbnail + Info */}
            <div className="w-full border-b border-gray-200 p-4 dark:border-gray-800 lg:flex lg:h-full lg:w-[520px] lg:flex-col lg:border-b-0 lg:border-r">
              {/* Thumbnail */}
              <div className="w-full overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-white/[0.03] lg:min-h-0 lg:flex-1">
                {doc.thumbnail && !thumbError ? (
                  <img
                    src={doc.thumbnail}
                    alt=""
                    className="block h-auto w-full lg:h-full lg:w-full lg:object-contain"
                    onError={() => setThumbError(true)}
                  />
                ) : (
                  <div className="flex aspect-4/3 w-full items-center justify-center lg:h-full">
                    <div className="flex flex-col items-center gap-2 text-gray-400 dark:text-gray-600">
                      <svg className="h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span className="text-xs">Gambar tidak tersedia</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Info section */}
              <div className="mt-4 space-y-2 lg:flex-none">
                {/* Category badge */}
                <span
                  className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${
                    isBrs
                      ? "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300"
                      : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
                  }`}
                >
                  {isBrs ? `📰 ${CHAT_TEXT.brs}` : `📕 ${CHAT_TEXT.publication}`}
                </span>

                {/* Title */}
                <p className="line-clamp-3 text-sm font-semibold text-gray-900 dark:text-white/90">
                  {sanitizeText(doc.title || "") || "(Tanpa judul)"}
                </p>

                {/* Abstract bullets */}
                {abstractBullets.length > 0 && (
                  <ul className="list-disc space-y-1 pl-5 text-theme-sm text-gray-700 dark:text-gray-300">
                    {abstractBullets.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                )}

                {/* Release date */}
                {formattedDate && (
                  <p className="text-theme-sm text-gray-500 dark:text-gray-400">
                    {formattedDate}
                  </p>
                )}

                {/* Action buttons - glassmorphic style matching page modals */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg border border-pink-500/50 bg-pink-500/35 px-3 py-2 text-sm font-medium text-pink-700 shadow-theme-sm backdrop-blur-sm transition-colors hover:bg-pink-500/45 dark:border-pink-400/40 dark:bg-pink-500/20 dark:text-pink-200"
                  >
                    {CHAT_TEXT.close}
                  </button>
                  {doc.pdf && (
                    <a
                      href={doc.pdf}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-lg border border-blue-500/50 bg-blue-500/35 px-3 py-2 text-sm font-medium text-blue-700 shadow-theme-sm backdrop-blur-sm transition-colors hover:bg-blue-500/45 dark:border-blue-400/40 dark:bg-blue-500/20 dark:text-blue-200"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      {CHAT_TEXT.downloadPdf}
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Right panel: PDF Preview */}
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

                {/* Iframe loading overlay (matches BRSCard) */}
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
        )}
      </div>
    </div>,
    document.body
  );
}

export default KnowledgeModal;
