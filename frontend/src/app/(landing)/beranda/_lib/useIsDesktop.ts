"use client";

import { useSyncExternalStore } from "react";

/** Matches the `md:` breakpoint the landing page lays out against. */
const QUERY = "(min-width: 768px)";

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/**
 * Viewport check for behaviour that genuinely can't be expressed in CSS — the
 * specialist carousel shows two cards per view on desktop and one on mobile, so
 * its number of slides differs.
 *
 * Layout never uses this: everything visual is a `md:` class. `useSyncExternalStore`
 * makes it hydration-safe — the server snapshot is used while hydrating, then the
 * real match is read immediately after.
 */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => true
  );
}
