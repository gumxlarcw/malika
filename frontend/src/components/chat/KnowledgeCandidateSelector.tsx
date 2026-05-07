"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import type { MalikaUiMetaV1 } from "@/types/chat";
import { BookIcon, EyeIcon } from "@/components/chat/icons";

// Lazy-load KnowledgeModal (505 lines) — only fetched when user clicks a knowledge item
const KnowledgeModal = dynamic(
  () => import("./KnowledgeModal").then((m) => ({ default: m.KnowledgeModal })),
  { ssr: false }
);

interface KnowledgeCandidateSelectorProps {
  ui: MalikaUiMetaV1;
  variant?: "standalone" | "inline";
}

/**
 * Component to display BRS and Publication knowledge candidates
 * from BPS Maluku Utara for user selection.
 */
export function KnowledgeCandidateSelector({ ui, variant = "standalone" }: KnowledgeCandidateSelectorProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const knowledgeCandidates = Array.isArray(ui?.knowledgeCandidates) ? ui.knowledgeCandidates : [];
  const brsItems = knowledgeCandidates.filter((k: any) => k?.type === "brs");
  const pubItems = knowledgeCandidates.filter((k: any) => k?.type === "publication");
  const ppidItems = knowledgeCandidates.filter((k: any) => k?.type === "ppid");
  
  if (knowledgeCandidates.length === 0) {
    return null;
  }

  const wrapperClass = variant === "inline"
    ? "mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/30"
    : "rounded-xl border border-blue-200 bg-blue-50 p-3 sm:p-4 dark:border-blue-800 dark:bg-blue-950/30";
  const containerClass = variant === "inline"
    ? ""
    : "max-w-[min(680px,96vw)] sm:max-w-[min(680px,90vw)] mt-3";

  return (
    <>
      <div className={containerClass}>
        <div className={wrapperClass}>
          <div className="text-xs font-semibold text-blue-700 dark:text-blue-200 mb-1 flex items-center gap-1">
            <BookIcon className="h-3.5 w-3.5" />
            Referensi Terkait
          </div>
          <div className="text-[11px] text-blue-600 dark:text-blue-400 mb-3">
            {ppidItems.length > 0 && brsItems.length === 0 && pubItems.length === 0
              ? "Informasi kelembagaan dari BPS"
              : "Sumber BRS dan Publikasi dari BPS Maluku Utara"}
          </div>

          {brsItems.length > 0 && (
            <div className="mb-3">
              <div className="mb-2 text-[11px] font-semibold text-green-700 dark:text-green-300">
                BRS (Berita Resmi Statistik)
              </div>
              <div className="space-y-1.5">
                {brsItems.slice(0, 3).map((k: any, idx: number) => (
                  <button
                    key={`brs-${k.id}`}
                    type="button"
                    onClick={() => setSelectedId(k.id)}
                    className="block w-full text-left rounded-lg border border-green-200 bg-green-50/50 px-3 py-2 hover:bg-green-100 hover:border-green-400 transition cursor-pointer dark:border-green-700 dark:bg-green-950/20 dark:hover:bg-green-950/40 dark:hover:border-green-600"
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-base">📰</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-semibold uppercase text-green-600 dark:text-green-400">
                            BRS
                          </span>
                          {k.similarity > 0 && (
                            <span className="text-[9px] text-gray-400 dark:text-gray-500">
                              {Math.round((k.similarity || 0) * 100)}% relevan
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-700 dark:text-gray-300 line-clamp-2 mt-0.5">
                          {k.name}
                        </div>
                      </div>
                      <EyeIcon className="h-4 w-4 flex-shrink-0 text-gray-400" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {pubItems.length > 0 && (
            <div>
              <div className="mb-2 text-[11px] font-semibold text-purple-700 dark:text-purple-300">
                Publikasi
              </div>
              <div className="space-y-1.5">
                {pubItems.slice(0, 3).map((k: any, idx: number) => (
                  <button
                    key={`pub-${k.id}`}
                    type="button"
                    onClick={() => setSelectedId(k.id)}
                    className="block w-full text-left rounded-lg border border-purple-200 bg-purple-50/50 px-3 py-2 hover:bg-purple-100 hover:border-purple-400 transition cursor-pointer dark:border-purple-700 dark:bg-purple-950/20 dark:hover:bg-purple-950/40 dark:hover:border-purple-600"
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-base">📕</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-semibold uppercase text-purple-600 dark:text-purple-400">
                            Publikasi
                          </span>
                          {k.similarity > 0 && (
                            <span className="text-[9px] text-gray-400 dark:text-gray-500">
                              {Math.round((k.similarity || 0) * 100)}% relevan
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-700 dark:text-gray-300 line-clamp-2 mt-0.5">
                          {k.name}
                        </div>
                      </div>
                      <EyeIcon className="h-4 w-4 flex-shrink-0 text-gray-400" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {ppidItems.length > 0 && (
            <div className={brsItems.length > 0 || pubItems.length > 0 ? "mt-3" : ""}>
              <div className="mb-2 text-[11px] font-semibold text-teal-700 dark:text-teal-300">
                Informasi Kelembagaan
              </div>
              <div className="space-y-1.5">
                {ppidItems.slice(0, 3).map((k: any) => (
                  <button
                    key={`ppid-${k.id}`}
                    type="button"
                    onClick={() => setSelectedId(k.id)}
                    className="block w-full text-left rounded-lg border border-teal-200 bg-teal-50/50 px-3 py-2 hover:bg-teal-100 hover:border-teal-400 transition cursor-pointer dark:border-teal-700 dark:bg-teal-950/20 dark:hover:bg-teal-950/40 dark:hover:border-teal-600"
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-base">🏛️</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-semibold uppercase text-teal-600 dark:text-teal-400">
                            {k.category || "PPID"}
                          </span>
                          {k.similarity > 0 && (
                            <span className="text-[9px] text-gray-400 dark:text-gray-500">
                              {Math.round((k.similarity || 0) * 100)}% relevan
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-700 dark:text-gray-300 line-clamp-2 mt-0.5">
                          {k.name}
                        </div>
                      </div>
                      <EyeIcon className="h-4 w-4 flex-shrink-0 text-gray-400" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Knowledge Modal */}
      {selectedId && (
        <KnowledgeModal
          id={selectedId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </>
  );
}
