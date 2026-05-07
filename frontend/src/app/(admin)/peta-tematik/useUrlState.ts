"use client";

/**
 * URL state sync for peta-tematik filters.
 * Pattern: filters live in React state (source of truth). URL is a side effect:
 *  - On mount: read URL params, hydrate state if present
 *  - On state change: replace URL silently (no scroll, no history pollution)
 * Result: shareable deep links + browser back/forward respect filters.
 */

import { useEffect, useRef } from "react";
import type { FilterState } from "./types";
import type { BinningMethod, PaletteId } from "./colorScale";
import { PALETTES, DEFAULT_PALETTE } from "./colorScale";

const VALID_BINNING: BinningMethod[] = ["quantile", "jenks", "equal"];

interface FullState {
  filters: FilterState;
  binning: BinningMethod;
  palette: PaletteId;
}

/** Read URL params at mount. Returns null if URL has no peta state. */
export function readUrlState(): Partial<FullState> | null {
  if (typeof window === "undefined") return null;
  const sp = new URLSearchParams(window.location.search);
  const ind = sp.get("ind") ?? sp.get("indikator");
  const year = sp.get("y") ?? sp.get("year");
  const month = sp.get("m") ?? sp.get("month");
  const metric = sp.get("metric");
  const binning = sp.get("bin") ?? sp.get("binning");
  const palette = sp.get("palette") ?? sp.get("color");

  if (!ind && !year) return null;

  const filters: Partial<FilterState> = {};
  if (ind && /^\d+$/.test(ind)) filters.indikator = parseInt(ind, 10);
  if (year && /^\d+$/.test(year)) filters.year = parseInt(year, 10);
  if (month && /^\d+$/.test(month)) filters.month = parseInt(month, 10);
  if (metric) filters.metric = metric;

  const out: Partial<FullState> = { filters: filters as FilterState };
  if (binning && (VALID_BINNING as string[]).includes(binning)) {
    out.binning = binning as BinningMethod;
  }
  if (palette && palette in PALETTES) {
    out.palette = palette as PaletteId;
  }
  return out;
}

/**
 * Hook: write filter+binning state to URL whenever they change.
 * Uses replaceState (no history entry per change). Only writes when fully formed
 * (indikator + year set) to avoid empty URLs during init.
 */
export function useSyncUrl(filters: FilterState, binning: BinningMethod, palette: PaletteId = DEFAULT_PALETTE) {
  const initialSkipDone = useRef(false);

  useEffect(() => {
    // Skip the very first render (init phase), wait for filters to settle
    if (!initialSkipDone.current) {
      initialSkipDone.current = true;
      return;
    }
    if (!filters.indikator || !filters.year) return;

    const sp = new URLSearchParams();
    sp.set("ind", String(filters.indikator));
    sp.set("y", String(filters.year));
    if (filters.month != null) sp.set("m", String(filters.month));
    if (filters.metric) sp.set("metric", filters.metric);
    if (binning !== "quantile") sp.set("bin", binning);
    if (palette !== DEFAULT_PALETTE) sp.set("palette", palette);

    const newUrl = `${window.location.pathname}?${sp.toString()}`;
    window.history.replaceState({}, "", newUrl);
  }, [filters.indikator, filters.year, filters.month, filters.metric, binning, palette]);
}

/** Build a shareable URL with current state (for "Salin Link" button). */
export function buildShareUrl(filters: FilterState, binning: BinningMethod, palette: PaletteId = DEFAULT_PALETTE): string {
  if (typeof window === "undefined") return "";
  const sp = new URLSearchParams();
  if (filters.indikator) sp.set("ind", String(filters.indikator));
  if (filters.year) sp.set("y", String(filters.year));
  if (filters.month != null) sp.set("m", String(filters.month));
  if (filters.metric) sp.set("metric", filters.metric);
  if (binning !== "quantile") sp.set("bin", binning);
  if (palette !== DEFAULT_PALETTE) sp.set("palette", palette);
  return `${window.location.origin}${window.location.pathname}?${sp.toString()}`;
}
