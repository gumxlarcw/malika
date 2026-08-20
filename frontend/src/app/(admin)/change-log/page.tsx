import type { Metadata } from "next";
import {
  CHANGELOG_CATEGORY_LABELS,
  CURRENT_APP_VERSION,
  formatReleaseHeading,
  formatVersionLabel,
  groupChangelogByDay,
  type ChangelogCategory,
} from "@/lib/changelog.data";

export const metadata: Metadata = {
  title: "Change Log",
};

const CATEGORY_STYLES: Record<
  ChangelogCategory,
  { badge: string; dot: string }
> = {
  baru: {
    badge:
      "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-400",
    dot: "bg-brand-500",
  },
  perbaikan: {
    badge:
      "bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-400",
    dot: "bg-green-500",
  },
  peningkatan: {
    badge: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400",
    dot: "bg-blue-500",
  },
};

export default function ChangeLogPage() {
  const releases = groupChangelogByDay();
  const totalEntries = releases.reduce(
    (sum, release) => sum + release.entries.length,
    0,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
            Change Log
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Riwayat pembaruan MALIKA per hari — {totalEntries} catatan
            pengguna dari {releases.length} versi.
          </p>
        </div>
        <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-2 text-center dark:border-brand-900/50 dark:bg-brand-500/10">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400">
            Versi terbaru
          </p>
          <p className="mt-0.5 font-mono text-lg font-bold text-brand-700 dark:text-brand-300">
            {formatVersionLabel(CURRENT_APP_VERSION)}
          </p>
        </div>
      </div>

      <div className="space-y-10">
        {releases.map((release) => (
          <section key={release.version} aria-labelledby={`release-${release.version}`}>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-gray-200 pb-3 dark:border-gray-800">
              <div>
                <h2
                  id={`release-${release.version}`}
                  className="text-base font-semibold text-gray-800 dark:text-white/90"
                >
                  {formatReleaseHeading(release)}
                </h2>
                {release.headline ? (
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    {release.headline}
                  </p>
                ) : null}
              </div>
              <span className="inline-flex items-center rounded-lg border border-gray-200 bg-gray-50 px-3 py-1 font-mono text-xs font-semibold text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
                {release.entries.length}{" "}
                {release.entries.length === 1 ? "perubahan" : "perubahan"}
              </span>
            </div>

            <ul className="relative space-y-4 before:absolute before:bottom-2 before:left-[11px] before:top-2 before:w-px before:bg-gray-200 dark:before:bg-gray-800">
              {release.entries.map((entry) => {
                const styles = CATEGORY_STYLES[entry.category];
                return (
                  <li
                    key={`${release.version}-${entry.id}`}
                    className="relative pl-8"
                  >
                    <span
                      className={`absolute left-0 top-5 h-6 w-6 rounded-full border-4 border-white dark:border-gray-900 ${styles.dot}`}
                      aria-hidden="true"
                    />
                    <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900 sm:p-6">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${styles.badge}`}
                          >
                            {CHANGELOG_CATEGORY_LABELS[entry.category]}
                          </span>
                          <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                            {entry.area}
                          </span>
                          <span className="font-mono text-[10px] text-gray-400 dark:text-gray-500">
                            {formatVersionLabel(release.version)}
                          </span>
                        </div>
                        <h3 className="mt-3 text-lg font-semibold text-gray-800 dark:text-white/90">
                          {entry.title}
                        </h3>
                        <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                          {entry.summary}
                        </p>
                        {entry.details && entry.details.length > 0 ? (
                          <ul className="mt-3 space-y-1.5 text-sm text-gray-600 dark:text-gray-400">
                            {entry.details.map((detail) => (
                              <li
                                key={detail}
                                className="flex gap-2 leading-relaxed"
                              >
                                <span
                                  className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-400 dark:bg-gray-500"
                                  aria-hidden="true"
                                />
                                <span>{detail}</span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    </article>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
