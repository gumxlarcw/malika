import React, { type ReactNode } from "react";
import Link from "next/link";

/**
 * The page hero used across /dashboard, /peta-tematik and the BRS/Publikasi
 * archive.
 *
 * Modelled on the /data hero, which was the only page that had one: a bordered
 * card carrying breadcrumb, badge, title, a row of icon meta chips, and an
 * actions slot. The other pages each had their own bare heading instead, so the
 * three read as three different products.
 *
 * /data keeps its own copy for now — its aside carries sparkline maths tied to
 * the indicator payload — but the classes here are deliberately identical so
 * the two are indistinguishable on screen.
 */

export type HeroCrumb = { label: string; href?: string };
export type HeroMeta = { key: string; icon?: ReactNode; label: ReactNode };

export type PageHeroProps = {
  crumbs?: HeroCrumb[];
  badge?: string;
  title: ReactNode;
  /** Rendered in brand colour after the title, e.g. "Maluku Utara". */
  titleAccent?: string;
  description?: ReactNode;
  meta?: HeroMeta[];
  actions?: ReactNode;
  /** Optional right-hand panel — a summary figure, a legend, a chart. */
  aside?: ReactNode;
};

export default function PageHero({
  crumbs,
  badge,
  title,
  titleAccent,
  description,
  meta,
  actions,
  aside,
}: PageHeroProps) {
  const items = (meta ?? []).filter(Boolean);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
      <div className="p-4 md:p-5">
        {crumbs && crumbs.length > 0 && (
          <nav
            aria-label="Breadcrumb"
            className="mb-2 flex flex-wrap items-center gap-1.5 text-[11.5px] text-gray-500 dark:text-gray-400"
          >
            {crumbs.map((c, i) => (
              <React.Fragment key={`${c.label}-${i}`}>
                {i > 0 && (
                  <span aria-hidden className="text-gray-300 dark:text-gray-600">
                    /
                  </span>
                )}
                {c.href ? (
                  <Link
                    href={c.href}
                    className="transition-colors hover:text-gray-700 dark:hover:text-gray-200"
                  >
                    {c.label}
                  </Link>
                ) : (
                  <span className="text-gray-700 dark:text-gray-200">{c.label}</span>
                )}
              </React.Fragment>
            ))}
          </nav>
        )}

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {badge && (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-[11px] font-semibold leading-[18px] text-brand-500 dark:border-brand-500/30 dark:bg-brand-500/[0.12] dark:text-brand-400">
                  {badge}
                </span>
              </div>
            )}

            <h1 className="m-0 text-balance text-[18px] font-semibold leading-snug tracking-tight text-gray-900 dark:text-white md:text-[22px]">
              {title}
              {titleAccent && (
                <>
                  {" "}
                  <span className="text-brand-500 dark:text-brand-400">{titleAccent}</span>
                </>
              )}
            </h1>

            {description && (
              <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-gray-500 dark:text-gray-400">
                {description}
              </p>
            )}

            {items.length > 0 && (
              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-gray-500 dark:text-gray-400 md:mt-3 md:gap-x-5 md:text-[12.5px]">
                {items.map((m) => (
                  <span key={m.key} className="inline-flex items-center gap-1.5">
                    {m.icon}
                    {m.label}
                  </span>
                ))}
              </div>
            )}

            {actions && (
              <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2">{actions}</div>
            )}
          </div>

          {/* Allowed to wrap under the title rather than shrink: the peta
              toolbar measures ~477px and dragged the document sideways on a
              phone when it was held on one line. */}
          {aside && <div className="min-w-0 shrink-0">{aside}</div>}
        </div>
      </div>
    </div>
  );
}

// ── Meta icons ─────────────────────────────────────────────────────────────
// Carried here rather than imported from (admin)/data/_components/atoms, which
// is route-private by convention.

export function HeroClockIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4.2l2.8 1.6" />
    </svg>
  );
}

export function HeroCalendarIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
      <rect x="3" y="4.5" width="14" height="12.5" rx="2.5" />
      <path d="M3 8.4h14M7 3v3M13 3v3" />
    </svg>
  );
}

export function HeroGlobeIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
      <circle cx="10" cy="10" r="7" />
      <path d="M3.2 10h13.6M10 3.1c1.9 2 2.9 4.4 2.9 6.9s-1 4.9-2.9 6.9c-1.9-2-2.9-4.4-2.9-6.9s1-4.9 2.9-6.9z" />
    </svg>
  );
}

export function HeroChartIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
      <path d="M4 15.5V9M8 15.5V4.5M12 15.5v-4M16 15.5V7" />
    </svg>
  );
}

export function HeroDocIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11.5 2.5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7z" />
      <path d="M11.5 2.5V7H16M7.5 11h5M7.5 14h3" />
    </svg>
  );
}
