"use client";

import { useEffect, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { Command } from "cmdk";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Sparkles, Calendar, BarChart3 } from "lucide-react";
import type { IndikatorItem } from "../types";

interface ProcessedListLite {
  kategoriMap: Record<string, IndikatorItem[]>;
}

interface Props {
  processed: ProcessedListLite;
  years: number[];
  onPickIndikator: (id: number) => void;
  onPickYear: (year: number) => void;
}

/**
 * Cmd+K (Ctrl+K on Windows/Linux) global command palette.
 * Combines indikator search + year quick jump + filter shortcuts.
 * Cmdk handles fuzzy search & keyboard nav.
 */
export default function CommandPalette({
  processed, years, onPickIndikator, onPickYear,
}: Props) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => setMounted(true), []);

  // Global keyboard shortcut: Cmd/Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // Flatten all eligible indikator with their kategori for search
  const allItems = useMemo(() => {
    const arr: Array<IndikatorItem & { kategori: string }> = [];
    for (const [kat, items] of Object.entries(processed.kategoriMap)) {
      for (const it of items) arr.push({ ...it, kategori: kat });
    }
    return arr;
  }, [processed]);

  if (!mounted) return null;

  const palette = (
    <AnimatePresence>
      {open && (
        <div className="peta-tematik-page">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 bg-gray-900/50 backdrop-blur-[3px] z-[9000]"
          />
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="fixed top-[15vh] left-1/2 -translate-x-1/2 z-[9001] w-[min(640px,calc(100vw-32px))]
                       bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl
                       shadow-2xl overflow-hidden"
          >
            <Command shouldFilter={true} className="w-full">
              <div className="flex items-center gap-3 px-4 border-b border-[var(--pt-border)]">
                <Search className="w-4 h-4 text-[var(--pt-ink-faint)] shrink-0" />
                <Command.Input
                  value={query}
                  onValueChange={setQuery}
                  placeholder="Cari indikator atau tahun…"
                  className="flex-1 py-3.5 pt-body text-sm bg-transparent outline-none text-[var(--pt-ink)] placeholder:text-[var(--pt-ink-faint)]"
                  autoFocus
                />
                <kbd className="pt-mono text-[10px] text-[var(--pt-ink-faint)] uppercase tracking-wider px-1.5 py-0.5 border border-[var(--pt-border)] rounded-xl">
                  ESC
                </kbd>
              </div>

              <Command.List className="max-h-[480px] overflow-y-auto py-2">
                <Command.Empty className="py-6 text-center pt-body text-sm text-[var(--pt-ink-faint)]">
                  <Sparkles className="w-5 h-5 mx-auto mb-2 opacity-40" />
                  Tidak ada hasil. Coba kata kunci lain.
                </Command.Empty>

                {/* Quick year jump */}
                {query.match(/^\d{4}$/) && years.includes(parseInt(query, 10)) && (
                  <Command.Group
                    heading="Lompat ke Tahun"
                    className="
                      [&_[cmdk-group-heading]]:px-3
                      [&_[cmdk-group-heading]]:py-2
                      [&_[cmdk-group-heading]]:mt-1
                      [&_[cmdk-group-heading]]:text-[11px]
                      [&_[cmdk-group-heading]]:font-semibold
                      [&_[cmdk-group-heading]]:uppercase
                      [&_[cmdk-group-heading]]:tracking-wider
                      [&_[cmdk-group-heading]]:text-[var(--pt-accent)]
                      [&_[cmdk-group-heading]]:bg-blue-50
                      dark:[&_[cmdk-group-heading]]:bg-blue-950/40
                      [&_[cmdk-group-heading]]:border-l-2
                      [&_[cmdk-group-heading]]:border-[var(--pt-accent)]
                      [&_[cmdk-group-heading]]:sticky
                      [&_[cmdk-group-heading]]:top-0
                      [&_[cmdk-group-heading]]:z-10
                    "
                  >
                    <Command.Item
                      value={`year-${query}`}
                      onSelect={() => {
                        onPickYear(parseInt(query, 10));
                        setOpen(false);
                        setQuery("");
                      }}
                      className="flex items-center gap-3 px-3 py-2.5 cursor-pointer pt-body text-sm text-[var(--pt-ink)] aria-selected:bg-[var(--pt-canvas-deep)] aria-selected:text-[var(--pt-accent)]"
                    >
                      <Calendar className="w-4 h-4" />
                      <span>Pindah ke tahun</span>
                      <span className="pt-display italic font-medium ml-auto">{query}</span>
                    </Command.Item>
                  </Command.Group>
                )}

                {/* Years (always show top-3 most recent) */}
                {query.length === 0 && (
                  <Command.Group
                    heading="Lompat Cepat ke Tahun"
                    className="
                      [&_[cmdk-group-heading]]:px-3
                      [&_[cmdk-group-heading]]:py-2
                      [&_[cmdk-group-heading]]:mt-1
                      [&_[cmdk-group-heading]]:text-[11px]
                      [&_[cmdk-group-heading]]:font-semibold
                      [&_[cmdk-group-heading]]:uppercase
                      [&_[cmdk-group-heading]]:tracking-wider
                      [&_[cmdk-group-heading]]:text-[var(--pt-accent)]
                      [&_[cmdk-group-heading]]:bg-blue-50
                      dark:[&_[cmdk-group-heading]]:bg-blue-950/40
                      [&_[cmdk-group-heading]]:border-l-2
                      [&_[cmdk-group-heading]]:border-[var(--pt-accent)]
                      [&_[cmdk-group-heading]]:sticky
                      [&_[cmdk-group-heading]]:top-0
                      [&_[cmdk-group-heading]]:z-10
                    "
                  >
                    {years.slice(-3).reverse().map((y) => (
                      <Command.Item
                        key={`yr-${y}`}
                        value={`year ${y}`}
                        onSelect={() => {
                          onPickYear(y);
                          setOpen(false);
                        }}
                        className="flex items-center gap-3 px-3 py-2 cursor-pointer pt-body text-sm text-[var(--pt-ink)] aria-selected:bg-[var(--pt-canvas-deep)]"
                      >
                        <Calendar className="w-4 h-4 text-[var(--pt-ink-faint)]" />
                        <span>Tahun {y}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {/* Indikator (grouped by kategori) */}
                {(() => {
                  const byKat: Record<string, typeof allItems> = {};
                  for (const it of allItems) {
                    if (!byKat[it.kategori]) byKat[it.kategori] = [];
                    byKat[it.kategori].push(it);
                  }
                  return Object.entries(byKat)
                    .sort((a, b) => b[1].length - a[1].length)
                    .map(([kat, items]) => (
                      <Command.Group
                        key={kat}
                        heading={kat}
                        className="
                      [&_[cmdk-group-heading]]:px-3
                      [&_[cmdk-group-heading]]:py-2
                      [&_[cmdk-group-heading]]:mt-1
                      [&_[cmdk-group-heading]]:text-[11px]
                      [&_[cmdk-group-heading]]:font-semibold
                      [&_[cmdk-group-heading]]:uppercase
                      [&_[cmdk-group-heading]]:tracking-wider
                      [&_[cmdk-group-heading]]:text-[var(--pt-accent)]
                      [&_[cmdk-group-heading]]:bg-blue-50
                      dark:[&_[cmdk-group-heading]]:bg-blue-950/40
                      [&_[cmdk-group-heading]]:border-l-2
                      [&_[cmdk-group-heading]]:border-[var(--pt-accent)]
                      [&_[cmdk-group-heading]]:sticky
                      [&_[cmdk-group-heading]]:top-0
                      [&_[cmdk-group-heading]]:z-10
                    "
                      >
                        {items.map((it) => (
                          <Command.Item
                            key={it.sourceId}
                            value={`${it.sourceName} ${kat}`}
                            onSelect={() => {
                              onPickIndikator(it.sourceId);
                              setOpen(false);
                              setQuery("");
                            }}
                            className="flex items-start gap-3 px-3 py-2 cursor-pointer pt-body text-sm text-[var(--pt-ink)] aria-selected:bg-[var(--pt-canvas-deep)] aria-selected:text-[var(--pt-accent)]"
                          >
                            <BarChart3 className="w-4 h-4 mt-0.5 text-[var(--pt-ink-faint)] shrink-0" />
                            <span className="line-clamp-2">{it.sourceName}</span>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    ));
                })()}
              </Command.List>

              <div className="border-t border-[var(--pt-border)] px-3 py-2 flex items-center gap-3 pt-mono text-[10px] text-[var(--pt-ink-faint)] uppercase tracking-wider">
                <span><kbd className="px-1 py-0.5 border border-[var(--pt-border)] rounded-xl">↑↓</kbd> navigasi</span>
                <span><kbd className="px-1 py-0.5 border border-[var(--pt-border)] rounded-xl">↵</kbd> pilih</span>
                <span className="ml-auto">Cmd+K untuk buka</span>
              </div>
            </Command>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  return createPortal(palette, document.body);
}

/**
 * Visual hint button for keyboard discovery (rendered in toolbar).
 * Click also opens the palette via custom event.
 */
export function CommandPaletteHint() {
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    setIsMac(typeof navigator !== "undefined" && /Mac/.test(navigator.platform));
  }, []);
  const trigger = () => {
    const ev = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: !isMac,
      metaKey: isMac,
    });
    window.dispatchEvent(ev);
  };
  return (
    <button
      onClick={trigger}
      className="hidden sm:flex items-center gap-2 px-3 py-1.5 pt-mono text-[11px] uppercase tracking-wider border border-[var(--pt-border)] hover:border-[var(--pt-border-strong)] hover:bg-[var(--pt-canvas-deep)] transition-colors rounded-xl text-[var(--pt-ink-soft)]"
      aria-label="Buka pencarian cepat"
    >
      <Search className="w-3.5 h-3.5" />
      <span>Cari</span>
      <kbd className="px-1.5 py-0.5 border border-[var(--pt-border)] rounded-xl text-[10px]">
        {isMac ? "⌘K" : "Ctrl K"}
      </kbd>
    </button>
  );
}
