import React, { type ReactNode } from "react";

/**
 * The Atlas brand hero, taken from /kategori and shared across /dashboard,
 * /peta-tematik and the BRS/Publikasi archive.
 *
 * Every page used to open differently — a bare heading, a toolbar strip, or a
 * white card — so the app read as several products. /kategori is the reference:
 * a brand-gradient band with a rail glow, dot pattern and spotlight, an eyebrow,
 * a large two-tone title, a sentence whose figures are emboldened, and a
 * translucent summary panel carrying a composition bar plus a stat grid.
 *
 * The gradient, overlays and spacing here are copied from that page verbatim so
 * the two are the same object, not a lookalike.
 */

export type HeroStat = {
  key: string;
  label: string;
  /** Drives the composition bar's segment width. */
  count: number;
  /** Shown in the grid; defaults to a localised `count`. */
  display?: string;
  /** Segment and dot colour. Use the dark-surface palette. */
  color: string;
  /**
   * Whether this figure is part of the composition. False for values that are
   * not quantities — a year like 2003 counted as a share made "Sejak" the
   * widest segment on the bar and dwarfed the catalogues it sat beside.
   */
  share?: boolean;
};

export type HeroPanel = {
  title: string;
  note?: string;
  stats: HeroStat[];
  /**
   * Draw the composition bar. Only true when the stats really partition a
   * whole — a bar over unrelated figures would invent a relationship.
   */
  bar?: boolean;
};

export type PageHeroProps = {
  eyebrow: string;
  title: ReactNode;
  /** Rendered in the light gradient wash, as "Kategori" is on /kategori. */
  titleAccent?: string;
  description?: ReactNode;
  panel?: HeroPanel;
  actions?: ReactNode;
  loading?: boolean;
};

const nf = (n: number) => n.toLocaleString("id-ID");

function CompositionBar({ stats, height = 10 }: { stats: HeroStat[]; height?: number }) {
  const parts = stats.filter((s) => s.share !== false);
  const total = parts.reduce((a, s) => a + Math.max(0, s.count), 0) || 1;
  return (
    <div className="flex w-full overflow-hidden rounded-full" style={{ height, gap: 2 }}>
      {parts.map((s) =>
        s.count > 0 ? (
          <div
            key={s.key}
            className="rounded-sm"
            style={{ flex: (s.count / total) * 100, background: s.color }}
          />
        ) : null,
      )}
    </div>
  );
}

export default function PageHero({
  eyebrow,
  title,
  titleAccent,
  description,
  panel,
  actions,
  loading,
}: PageHeroProps) {
  return (
    <section
      className="relative -mx-4 overflow-hidden text-white md:-mx-6"
      style={{
        background: "linear-gradient(120deg, #161950 0%, #252dae 60%, #3641f5 100%)",
      }}
    >
      {/* brand-rail glow (defined globally in globals.css, respects reduce-motion) */}
      <div
        aria-hidden
        className="malika-rail-glow pointer-events-none absolute left-0 right-0 top-0 h-[2px]"
        style={{ background: "linear-gradient(90deg, transparent, #7592ff 50%, transparent)" }}
      />
      {/* dot pattern + radial spotlight */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
          maskImage: "radial-gradient(ellipse at top right, rgba(0,0,0,0.7), transparent 60%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at top right, rgba(0,0,0,0.7), transparent 60%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-20 h-[260px] w-[260px] rounded-full lg:h-[380px] lg:w-[380px]"
        style={{ background: "radial-gradient(circle, rgba(149,178,255,0.32), transparent 60%)" }}
      />

      <div className="relative px-4 py-7 md:px-6 lg:px-11 lg:py-9">
        <div className="grid items-end gap-6 lg:grid-cols-[1.4fr_1fr] lg:gap-10">
          <div>
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.06em] text-brand-300 lg:text-xs">
              {eyebrow}
            </div>

            <h1 className="m-0 max-w-[560px] text-balance text-[26px] font-bold leading-[1.13] tracking-tight lg:text-[40px]">
              {title}
              {titleAccent && (
                <>
                  {" "}
                  <span
                    className="bg-clip-text text-transparent"
                    style={{ backgroundImage: "linear-gradient(120deg, #fff 0%, #c2d6ff 100%)" }}
                  >
                    {titleAccent}
                  </span>
                </>
              )}
            </h1>

            {description && (
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/75 lg:mt-4 lg:text-[15px]">
                {loading ? (
                  <span className="inline-flex h-4 w-64 animate-pulse rounded bg-white/10" />
                ) : (
                  description
                )}
              </p>
            )}

            {/* mobile-only compact composition, matching /kategori */}
            {panel?.bar && !loading && panel.stats.length > 1 && (
              <div className="mt-5 lg:hidden">
                <CompositionBar stats={panel.stats} height={8} />
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {panel.stats.filter((s) => s.share !== false).map((s) => (
                    <span key={s.key} className="inline-flex items-center gap-1.5 text-[11px] text-white/70">
                      <span
                        aria-hidden
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ background: s.color }}
                      />
                      {s.label} {s.display ?? nf(s.count)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {actions && (
              <div className="mt-5 flex min-w-0 flex-wrap items-center gap-2">{actions}</div>
            )}
          </div>

          {/* desktop summary panel */}
          {panel && (
            <div className="hidden rounded-2xl border border-white/10 bg-white/[0.07] p-5 backdrop-blur-md lg:block">
              <div className="mb-3 flex items-baseline justify-between">
                <div className="text-[11px] font-bold uppercase tracking-[0.05em] text-brand-300">
                  {panel.title}
                </div>
                {panel.note && <div className="text-[11px] text-white/60">{panel.note}</div>}
              </div>

              {panel.bar && panel.stats.length > 1 && <CompositionBar stats={panel.stats} />}

              <div
                className={`grid gap-2 ${panel.bar && panel.stats.length > 1 ? "mt-4" : ""} ${
                  panel.stats.length >= 4 ? "grid-cols-4" : "grid-cols-3"
                }`}
              >
                {panel.stats.map((s) => (
                  <div key={s.key} className="rounded-lg bg-white/[0.06] px-2.5 py-2">
                    <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-white/60">
                      {s.label}
                    </div>
                    <div className="text-[15px] font-bold tabular-nums text-white">
                      {s.display ?? nf(s.count)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** Emphasised figure inside a hero description, as on /kategori. */
export function HeroFigure({ children }: { children: ReactNode }) {
  return <strong className="font-bold text-white">{children}</strong>;
}
