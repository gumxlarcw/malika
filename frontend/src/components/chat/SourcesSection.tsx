/**
 * SourcesSection - Displays BRS/Publications used as references/sources
 * Extracted from ChatPageClient.tsx
 */

"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import type { MalikaUiMetaV1 } from "@/types/chat";
import { CHAT_TEXT } from "@/lib/chatConstants";
import { BookIcon, EyeIcon } from "@/components/chat/icons";

// Lazy-load KnowledgeModal (505 lines) — only fetched when user clicks a source
const KnowledgeModal = dynamic(
  () => import("./KnowledgeModal").then((m) => ({ default: m.KnowledgeModal })),
  { ssr: false }
);

export interface SourcesSectionProps {
  sources: MalikaUiMetaV1["sources"];
}

export function SourcesSection({ sources }: SourcesSectionProps) {
  const [selectedSourceId, setSelectedSourceId] = useState<number | null>(null);

  if (!sources || sources.length === 0) return null;

  return (
    <>
      <div className="mt-3 rounded-lg border border-dashed border-gray-300 bg-gray-50/50 p-3 dark:border-gray-600 dark:bg-gray-800/30">
        <div className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1 flex items-center gap-1">
          <BookIcon className="h-3.5 w-3.5" />
          <span>{CHAT_TEXT.references}</span>
        </div>
        <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-3">
          BRS dan Publikasi yang digunakan sebagai referensi
        </div>
        <div className="space-y-2">
          {sources.map((s, idx) => {
            const isBrs = s.type === "brs" || s.category === "BRS";
            const icon = isBrs ? "📰" : "📕";
            const colorClass = isBrs
              ? "border-orange-200 bg-orange-50/50 dark:border-orange-900/50 dark:bg-orange-950/30"
              : "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/30";
            const labelClass = isBrs
              ? "text-orange-600 dark:text-orange-400"
              : "text-emerald-600 dark:text-emerald-400";
            const simPercent = Math.round((s.similarity || 0) * 100);

            return (
              <button
                key={idx}
                type="button"
                onClick={() => setSelectedSourceId(s.id)}
                className={`block w-full text-left rounded-lg border p-2 transition-all hover:shadow-sm cursor-pointer ${colorClass}`}
              >
                <div className="flex items-start gap-2">
                  <span className="text-base">{icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`text-[10px] font-semibold uppercase ${labelClass}`}
                      >
                        {isBrs ? "BRS" : "Publikasi"}
                      </span>
                      {simPercent > 0 && (
                        <span className="text-[9px] text-gray-400 dark:text-gray-500">
                          {simPercent}% {CHAT_TEXT.relevancePercent}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-700 dark:text-gray-300 line-clamp-2 mt-0.5">
                      {s.title}
                    </div>
                  </div>
                  <EyeIcon className="h-4 w-4 flex-shrink-0 text-gray-400" />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Knowledge Modal */}
      {selectedSourceId && (
        <KnowledgeModal
          id={selectedSourceId}
          onClose={() => setSelectedSourceId(null)}
        />
      )}
    </>
  );
}

export default SourcesSection;
