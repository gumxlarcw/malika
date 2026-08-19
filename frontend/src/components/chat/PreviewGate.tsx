"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import type { MalikaUiMetaV1 } from "@/types/chat";

// Lazy load QuickDataPreviewCard (2000+ lines) for better initial load performance
const QuickDataPreviewCard = dynamic(
  () => import("@/components/search/QuickDataPreviewCard"),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-brand-500" />
      </div>
    ),
  }
);

interface PreviewGateProps {
  ui: MalikaUiMetaV1;
}

/**
 * Component to confirm and display data preview (table + chart) with query selection.
 * STRICT MODE: always requires explicit user confirmation before showing preview.
 */
export function PreviewGate({ ui }: PreviewGateProps) {
  const [show, setShow] = useState(false);
  const defaultQ = String(ui?.query || "").trim();
  const previewQueries = Array.isArray(ui?.preview_queries) ? ui!.preview_queries! : [];
  const choices = previewQueries
    .map((it) => ({ label: String(it?.label || ""), q: String(it?.q || "").trim() }))
    .filter((it) => it.q);
  const [pickedQ, setPickedQ] = useState<string>(() => (choices[0]?.q ? choices[0].q : defaultQ));
  const pickedLabel = useMemo(() => {
    const found = choices.find((c) => c.q === pickedQ);
    return String(found?.label || "").trim();
  }, [choices, pickedQ]);

  useEffect(() => {
    const next = choices[0]?.q ? choices[0].q : defaultQ;
    setPickedQ(next);
    setShow(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultQ]);

  const safeHref = useCallback((hrefRaw: unknown) => {
    const href = String(hrefRaw || '').trim();
    if (!href) return '';

    // Allow internal app links only (no protocol).
    if (href.startsWith('/')) return href;

    // Allow https links only.
    try {
      const u = new URL(href);
      if (u.protocol === 'https:') return u.toString();
    } catch {
      // ignore
    }

    return '';
  }, []);

  if (!defaultQ) return null;
  const links = Array.isArray(ui?.links) ? ui.links : [];
  const suggestions = Array.isArray(ui?.suggestions) ? ui.suggestions : [];

  const PreviewBody = () => (
    <div className="space-y-4">
      <div className="max-w-[min(980px,92vw)] rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
        <div className="font-semibold text-gray-800 dark:text-gray-100">Query yang dipakai</div>
        {pickedLabel ? <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{pickedLabel}</div> : null}
        <div className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-700 dark:bg-gray-900 dark:text-gray-200">
          {pickedQ || defaultQ}
        </div>
      </div>
      <QuickDataPreviewCard q={pickedQ || defaultQ} preferredDataLink={ui.preferred_data_link ?? null} tableOnly />

      {links.length > 0 ? (
        <div className="max-w-[min(980px,92vw)]">
          <div className="mb-1 text-xs font-semibold text-gray-700 dark:text-gray-200">Link cepat</div>
          <ul className="space-y-1">
            {links.slice(0, 6).map((l, idx) => (
              <li key={`${idx}_${l.href}`} className="text-xs">
                {(() => {
                  const href = safeHref((l as any)?.href);
                  const label = String((l as any)?.label || '').trim() || '(Link)';
                  if (!href) {
                    return <span className="text-gray-500 dark:text-gray-400">{label}</span>;
                  }

                  const isExternal = href.startsWith('https://');
                  return (
                    <a
                      href={href}
                      className="text-brand-600 hover:underline dark:text-brand-400"
                      target={isExternal ? "_blank" : undefined}
                      rel={isExternal ? "noreferrer noopener" : undefined}
                    >
                      {label}
                    </a>
                  );
                })()}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Suggestions moved to quick reply chips above input */}
    </div>
  );

  // STRICT MODE: always require explicit user confirmation before showing preview.
  if (show) return <PreviewBody />;

  const confirmQueryText = pickedQ || defaultQ;

  return (
    <div className="max-w-[min(980px,92vw)] rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
      <div className="text-xs font-semibold text-gray-800 dark:text-gray-200">Konfirmasi</div>
      <div className="mt-1 text-sm text-gray-700 dark:text-gray-200">
        Saya bisa menampilkan preview data (tabel + grafik) menggunakan query berikut. Mau ditampilkan?
      </div>

      <div className="mt-3 space-y-2">
        {choices.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {choices.map((c) => {
              const active = c.q === pickedQ;
              return (
                <button
                  key={c.q}
                  type="button"
                  onClick={() => setPickedQ(c.q)}
                  className={
                    "rounded-full px-3 py-1.5 text-xs font-semibold transition " +
                    (active
                      ? "bg-brand-500 text-white"
                      : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800")
                  }
                >
                  {c.label || "Pilih"}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-gray-600 dark:text-gray-300">(Tidak ada alternatif query. Menggunakan pertanyaan asli.)</div>
        )}

        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
          <div className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">Query yang akan dipakai</div>
          {pickedLabel ? <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{pickedLabel}</div> : null}
          <div className="mt-2 whitespace-pre-wrap break-words">{confirmQueryText}</div>
        </div>

        <div className="rounded-lg border border-dashed border-gray-300 bg-white px-3 py-2 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
          Tahapan: pilih indikator terbaik di database → ambil cache periode → tampilkan ringkasan + grafik.
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => setShow(true)}
          className="inline-flex items-center justify-center rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-600"
        >
          Ya, tampilkan preview
        </button>
        <button
          type="button"
          onClick={() => setShow(false)}
          className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          Tidak
        </button>
      </div>
    </div>
  );
}
