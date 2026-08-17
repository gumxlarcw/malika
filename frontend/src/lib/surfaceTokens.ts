/**
 * Light/dark surface, border and text pairs shared by the landing page and the
 * dashboard.
 *
 * The design these came from carried its palette as CSS custom properties
 * swapped by JavaScript. Every value is already a named token in globals.css, so
 * each one is expressed here as a light/dark Tailwind pair driven by the app's
 * existing `.dark` class — no JS, and no flash of light theme on load.
 */

/** `--surface` + `--border` */
export const SURFACE = "bg-white dark:bg-gray-dark";
export const BORDER = "border-gray-200 dark:border-[#2b3648]";
export const CARD = `rounded-2xl border ${BORDER} ${SURFACE}`;

/** The quieter fill behind pills and icon chips. */
export const SURFACE_2 = "bg-gray-100 dark:bg-gray-800";

export const SURFACE_BRAND = "bg-brand-25 dark:bg-[#141a33]";
export const SURFACE_BRAND_2 = "bg-brand-50 dark:bg-brand-500/[0.16]";
export const BRAND_BORDER = "border-brand-200 dark:border-brand-500/45";

export const TEXT = "text-gray-900 dark:text-gray-100";
export const TEXT_2 = "text-gray-700 dark:text-gray-200";
export const TEXT_3 = "text-gray-600 dark:text-gray-300";
export const TEXT_4 = "text-gray-500 dark:text-gray-400";
export const TEXT_5 = "text-gray-400 dark:text-[#7d8799]";

export const BRAND_TEXT = "text-brand-600 dark:text-brand-300";

/** Lift-on-hover shared by tile, category and service cards. */
export const CARD_HOVER =
  "transition-[transform,border-color,box-shadow] duration-150 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-theme-lg dark:hover:border-brand-500/60";

/** Monospace numerals. */
export const MONO = "font-[family-name:var(--font-ibm-plex-mono)]";
