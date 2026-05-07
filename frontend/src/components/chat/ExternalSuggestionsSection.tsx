"use client";

import React from "react";
import type { MalikaUiMetaV1 } from "@/types/chat";
import { safeHref } from "@/lib/chatUtils";
import { LightbulbIcon, ExternalLinkIcon, WarningIcon } from "@/components/chat/icons";

interface ExternalSuggestionsSectionProps {
  ui: MalikaUiMetaV1;
  variant?: "standalone" | "inline";
}

/**
 * Component to show external (non-BPS) links as suggestions for exploration.
 * Displays links from other government agencies with trust badges.
 */
export function ExternalSuggestionsSection({ ui, variant = "standalone" }: ExternalSuggestionsSectionProps) {
  const externalLinks = Array.isArray(ui?.externalLinks) ? ui.externalLinks : [];
  
  if (externalLinks.length === 0) {
    return null;
  }

  const wrapperClass = "mt-3 rounded-lg border border-dashed border-amber-300 bg-amber-50/50 p-3 dark:border-amber-700 dark:bg-amber-950/20";
  const containerClass = "";

  // Get trust badge icon
  const getTrustIcon = (badge: string) => {
    switch (badge) {
      case "Kementerian":
        return "🏛️";
      case "Lembaga":
        return "🏢";
      default:
        return "🌐";
    }
  };

  return (
    <div className={containerClass}>
      <div className={wrapperClass}>
        <div className="text-xs font-semibold text-amber-700 dark:text-amber-200 mb-1 flex items-center gap-1">
          <LightbulbIcon className="h-3.5 w-3.5" />
          Sumber Lain untuk Eksplorasi
        </div>
        <div className="text-[11px] text-amber-600 dark:text-amber-400 mb-3">
          Indikator terkait dari instansi pemerintah lain
        </div>

        <div className="space-y-2">
          {externalLinks.slice(0, 3).map((link, idx) => {
            const href = safeHref(link.url);
            if (!href) return null;
            return (
            <a
              key={`ext-${idx}`}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full text-left rounded-lg border border-amber-200 bg-white px-3 py-2 hover:bg-amber-50 hover:border-amber-400 transition cursor-pointer dark:border-amber-700 dark:bg-gray-900 dark:hover:bg-amber-950/30 dark:hover:border-amber-500"
            >
              <div className="flex items-start gap-2">
                <span className="text-base">{getTrustIcon(link.trustBadge)}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-semibold uppercase text-amber-700 dark:text-amber-300">
                      {link.trustBadge}
                    </span>
                    <span className="text-[9px] text-gray-400 dark:text-gray-500">
                      {link.domain}
                    </span>
                    {link.matchedGeo && (
                      <span className="text-[9px] bg-amber-100 text-amber-700 px-1 rounded dark:bg-amber-900/50 dark:text-amber-300">
                        {link.matchedGeo}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-700 dark:text-gray-300 line-clamp-2 mt-0.5 font-medium">
                    {link.title}
                  </div>
                  {link.snippet && (
                    <div className="text-[10px] text-gray-500 dark:text-gray-400 line-clamp-1 mt-0.5">
                      {link.snippet}
                    </div>
                  )}
                </div>
                <ExternalLinkIcon className="h-4 w-4 flex-shrink-0 text-gray-400" />
              </div>
            </a>
            );
          })}
        </div>

        {/* Disclaimer */}
        <div className="mt-3 pt-2 border-t border-amber-200 dark:border-amber-800">
          <div className="text-[10px] text-amber-600 dark:text-amber-400 flex items-start gap-1">
            <WarningIcon className="h-3 w-3 flex-shrink-0 mt-0.5" />
            <span>
              Sumber eksternal belum diverifikasi BPS. Gunakan data BPS untuk keperluan resmi.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
