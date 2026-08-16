/**
 * Shared class strings for the landing page.
 *
 * The source design carried its palette as CSS custom properties (`--surface`,
 * `--text-3`, …) swapped by JavaScript on theme change. Those values are already
 * named tokens in `globals.css`, so here each one becomes a light/dark Tailwind
 * pair driven by the app's existing `.dark` class — no JS, no flash of light
 * theme on load. Grouping the repeated pairs here keeps the section components
 * readable and keeps the design→token mapping in one place.
 */

/** `--bg` */
export const PAGE_BG = "bg-gray-50 dark:bg-gray-950";

/** `--surface` + `--border` */
export const SURFACE = "bg-white dark:bg-gray-dark";
export const BORDER = "border-gray-200 dark:border-[#2b3648]";
export const CARD = `rounded-2xl border ${BORDER} ${SURFACE}`;

/** `--surface-2` — the quieter fill behind pills and icon chips. */
export const SURFACE_2 = "bg-gray-100 dark:bg-gray-800";

/** `--surface-brand` / `--surface-brand-2` */
export const SURFACE_BRAND = "bg-brand-25 dark:bg-[#141a33]";
export const SURFACE_BRAND_2 = "bg-brand-50 dark:bg-brand-500/[0.16]";
export const BRAND_BORDER = "border-brand-200 dark:border-brand-500/45";

/** `--text` … `--text-5` */
export const TEXT = "text-gray-900 dark:text-gray-100";
export const TEXT_2 = "text-gray-700 dark:text-gray-200";
export const TEXT_3 = "text-gray-600 dark:text-gray-300";
export const TEXT_4 = "text-gray-500 dark:text-gray-400";
export const TEXT_5 = "text-gray-400 dark:text-[#7d8799]";

/** `--brand-text` */
export const BRAND_TEXT = "text-brand-600 dark:text-brand-300";

/** Section shell: the design's `maxWidth: 1200` + responsive gutters. */
export const SECTION = "mx-auto max-w-[1200px] px-[18px] pt-10 md:px-8 md:pt-14";

/** Sections that a header link jumps to need clearance for the sticky header. */
export const SCROLL_ANCHOR = "scroll-mt-[76px] md:scroll-mt-10";

/** Lift-on-hover shared by the tile, category, and service cards. */
export const CARD_HOVER =
  "transition-[transform,border-color,box-shadow] duration-150 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-theme-lg dark:hover:border-brand-500/60";

/** The dark navy panel used by the hero and the consultation CTA. */
export const NAVY_PANEL = "bg-brand-950 bg-[radial-gradient(120%_120%_at_12%_0%,rgba(70,95,255,0.55)_0%,rgba(22,25,80,0)_55%)]";

/** Monospace numerals, matching the design's IBM Plex Mono usage. */
export const MONO = "font-[family-name:var(--font-ibm-plex-mono)]";
