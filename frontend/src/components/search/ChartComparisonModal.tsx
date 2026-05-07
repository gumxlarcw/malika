"use client";

import React, { useState, useEffect, useCallback } from "react";

// Compare icon for button
function CompareIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="18" rx="1" />
      <rect x="14" y="3" width="7" height="18" rx="1" />
      <path d="M10 12h4" />
    </svg>
  );
}

// Close icon
function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

type ComparisonType = "period" | "indicator";

interface AvailablePeriod {
  th_id: string;
  year: string;
  label?: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentSourceId: number;
  currentSourceName: string;
  currentPeriod?: string;
  currentYear?: string;
  availablePeriods?: AvailablePeriod[];
  onCompare: (data: ComparisonData) => void;
}

export interface ComparisonData {
  type: ComparisonType;
  // For period comparison
  secondPeriod?: string;
  secondYear?: string;
  // For indicator comparison
  secondSourceId?: number;
  secondSourceName?: string;
}

export default function ChartComparisonModal({
  isOpen,
  onClose,
  currentSourceId,
  currentSourceName,
  currentPeriod,
  currentYear,
  availablePeriods = [],
  onCompare,
}: Props) {
  const [comparisonType, setComparisonType] = useState<ComparisonType>("period");
  const [selectedPeriod, setSelectedPeriod] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ id: number; name: string }>>([]);
  const [selectedIndicator, setSelectedIndicator] = useState<{ id: number; name: string } | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  // Filter periods to exclude current
  const comparablePeriods = availablePeriods.filter(
    (p) => p.year !== currentYear || p.th_id !== currentPeriod
  );

  // Search for indicators
  const handleSearch = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      
      // Extract datasources from results, excluding current
      const datasources = [
        ...(data.exact?.datasources || []),
        ...(data.suggestions?.datasources || []),
      ]
        .filter((d: any) => Number(d.id) !== currentSourceId)
        .slice(0, 10)
        .map((d: any) => ({ id: Number(d.id), name: d.title || d.name || `Indikator ${d.id}` }));

      setSearchResults(datasources);
    } catch (err) {
      console.error("Search error:", err);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [currentSourceId]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      handleSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, handleSearch]);

  // Handle compare action
  const handleCompare = () => {
    if (comparisonType === "period" && selectedPeriod) {
      const period = comparablePeriods.find((p) => p.th_id === selectedPeriod);
      if (period) {
        onCompare({
          type: "period",
          secondPeriod: period.th_id,
          secondYear: period.year,
        });
        onClose();
      }
    } else if (comparisonType === "indicator" && selectedIndicator) {
      onCompare({
        type: "indicator",
        secondSourceId: selectedIndicator.id,
        secondSourceName: selectedIndicator.name,
      });
      onClose();
    }
  };

  // Escape key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const canCompare =
    (comparisonType === "period" && selectedPeriod) ||
    (comparisonType === "indicator" && selectedIndicator);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
      <div
        className="relative max-h-[90vh] w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <CompareIcon className="h-5 w-5 text-brand-500" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Bandingkan Grafik
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
          {/* Current indicator info */}
          <div className="mb-4 rounded-lg bg-gray-50 p-3 dark:bg-gray-800">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Indikator Saat Ini
            </p>
            <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white">
              {currentSourceName}
            </p>
            {currentYear && (
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                Periode: {currentYear}
              </p>
            )}
          </div>

          {/* Comparison type tabs */}
          <div className="mb-4 flex rounded-lg border border-gray-200 p-1 dark:border-gray-700">
            <button
              type="button"
              onClick={() => setComparisonType("period")}
              className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                comparisonType === "period"
                  ? "bg-brand-500 text-white"
                  : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              }`}
            >
              Bandingkan Periode
            </button>
            <button
              type="button"
              onClick={() => setComparisonType("indicator")}
              className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                comparisonType === "indicator"
                  ? "bg-brand-500 text-white"
                  : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              }`}
            >
              Bandingkan Indikator
            </button>
          </div>

          {/* Period comparison */}
          {comparisonType === "period" && (
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Pilih Periode Pembanding
              </label>
              {comparablePeriods.length > 0 ? (
                <div className="grid max-h-60 gap-2 overflow-y-auto">
                  {comparablePeriods.map((period) => (
                    <button
                      key={period.th_id}
                      type="button"
                      onClick={() => setSelectedPeriod(period.th_id)}
                      className={`rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
                        selectedPeriod === period.th_id
                          ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-400"
                          : "border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:border-gray-600 dark:hover:bg-gray-800"
                      }`}
                    >
                      <span className="font-medium">{period.label || period.year}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                  Tidak ada periode lain yang tersedia untuk dibandingkan.
                </p>
              )}
            </div>
          )}

          {/* Indicator comparison */}
          {comparisonType === "indicator" && (
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Cari Indikator Pembanding
              </label>
              <div className="relative mb-3">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Ketik untuk mencari indikator..."
                  className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder-gray-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-400"
                />
                {isSearching && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2">
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-brand-500" />
                  </span>
                )}
              </div>

              {/* Selected indicator */}
              {selectedIndicator && (
                <div className="mb-3 flex items-center justify-between rounded-lg border border-brand-200 bg-brand-50 px-4 py-2 dark:border-brand-800 dark:bg-brand-900/20">
                  <span className="text-sm font-medium text-brand-700 dark:text-brand-400">
                    {selectedIndicator.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedIndicator(null)}
                    className="text-brand-500 hover:text-brand-700"
                  >
                    <CloseIcon className="h-4 w-4" />
                  </button>
                </div>
              )}

              {/* Search results */}
              {searchResults.length > 0 && !selectedIndicator && (
                <div className="max-h-48 space-y-1 overflow-y-auto">
                  {searchResults.map((result) => (
                    <button
                      key={result.id}
                      type="button"
                      onClick={() => {
                        setSelectedIndicator(result);
                        setSearchQuery("");
                        setSearchResults([]);
                      }}
                      className="w-full rounded-lg px-4 py-2.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      {result.name}
                    </button>
                  ))}
                </div>
              )}

              {searchQuery.length >= 2 && !isSearching && searchResults.length === 0 && !selectedIndicator && (
                <p className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                  Tidak ditemukan indikator yang cocok.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleCompare}
            disabled={!canCompare}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Bandingkan
          </button>
        </div>
      </div>
    </div>
  );
}

export { CompareIcon };
