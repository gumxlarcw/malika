/**
 * Landing-page layout constants.
 *
 * The surface/border/text pairs are shared with the dashboard and live in
 * `@/lib/surfaceTokens`; only the values that are genuinely specific to this
 * page are defined here.
 */

export {
  SURFACE,
  BORDER,
  CARD,
  SURFACE_2,
  SURFACE_BRAND,
  SURFACE_BRAND_2,
  BRAND_BORDER,
  TEXT,
  TEXT_2,
  TEXT_3,
  TEXT_4,
  TEXT_5,
  BRAND_TEXT,
  CARD_HOVER,
  MONO,
} from "@/lib/surfaceTokens";

/** `--bg` */
export const PAGE_BG = "bg-gray-50 dark:bg-gray-950";

/** Section shell: the design's `maxWidth: 1200` + responsive gutters. */
export const SECTION = "mx-auto max-w-[1200px] px-[18px] pt-10 md:px-8 md:pt-14";

/** Sections that a header link jumps to need clearance for the sticky header. */
export const SCROLL_ANCHOR = "scroll-mt-[76px] md:scroll-mt-10";

/** The dark navy panel used by the hero and the consultation CTA. */
export const NAVY_PANEL = "bg-brand-950 bg-[radial-gradient(120%_120%_at_12%_0%,rgba(70,95,255,0.55)_0%,rgba(22,25,80,0)_55%)]";
