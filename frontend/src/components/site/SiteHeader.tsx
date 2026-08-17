"use client";

import React from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { BellIcon } from "@/icons";
import { cn } from "@/lib/utils";
import { BORDER, SURFACE, SURFACE_2, TEXT, TEXT_2, TEXT_4 } from "@/lib/surfaceTokens";
import type { Copy, Lang } from "@/lib/siteCopy";
import { MalikaMark, MoonIcon, SearchIcon, SunIcon } from "./SiteIcons";

/** `/dashboard` → `nav-dashboard`, `#peta` → `nav-peta`. Tour + test hook. */
const tourId = (href: string) => `nav-${href.replace(/^[#/]/, "").split(/[/?#]/)[0] || "home"}`;

export type NavLink = { href: string; label: string };

type Props = {
  t: Copy;
  lang: Lang;
  onLangChange: (lang: Lang) => void;
  /** Where the wordmark points: the landing scrolls to top, sub-pages go home. */
  home: string;
  /** The landing navigates by in-page anchor; sub-pages navigate by route. */
  nav: { desktop: NavLink[]; mobile: NavLink[] };
  /** Route currently shown, so the matching link can be marked. Anchors pass none. */
  activeHref?: string;
  /** The landing opens its own panel; without this the bell links to /notifications. */
  onOpenNotif?: () => void;
};

/**
 * The site header, on the landing page and every sub-page.
 *
 * One component rather than two so the chrome cannot drift: the sub-pages were
 * previously wrapped in a sidebar shell with its own header, which meant two
 * different answers to "what does MALIKA look like" depending on where you
 * landed.
 *
 * The desktop bar switches at `lg`, not `md` like the rest of the page. Logo
 * lockup + four nav links + the control cluster need roughly 1000px; at the
 * 768px `md` edge they collide — the wordmark overlaps the first nav link and
 * "Install app" runs off the right edge. Between 768 and 1024 the chip row
 * below carries navigation instead.
 */
export default function SiteHeader({ t, lang, onLangChange, home, nav, activeHref, onOpenNotif }: Props) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  const langPill = (active: boolean) =>
    cn(
      "cursor-pointer rounded-full px-3 py-1.5 text-xs font-semibold transition-colors duration-150",
      active ? cn(SURFACE, TEXT, "shadow-theme-xs") : cn("bg-transparent", TEXT_4)
    );

  const roundButton = cn(
    "flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border",
    BORDER,
    SURFACE,
    TEXT_4,
    "transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
  );

  /* An anchor stays an <a>: Link would try to route to "#peta" as a path. */
  const isAnchor = (href: string) => href.startsWith("#");

  const desktopLink = (href: string) =>
    cn(
      "whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150",
      href === activeHref ? cn(SURFACE_2, TEXT) : cn(TEXT_2, "hover:bg-gray-100 dark:hover:bg-gray-800")
    );

  const chipLink = (href: string) =>
    cn(
      "shrink-0 whitespace-nowrap rounded-full border px-3.5 py-[7px] text-[13px] font-medium leading-5",
      href === activeHref ? cn("border-brand-200 bg-brand-25 dark:border-brand-500/45 dark:bg-[#141a33]", "text-brand-600 dark:text-brand-300") : cn(BORDER, SURFACE, TEXT_2)
    );

  return (
    <>
      <header
        className={cn("sticky top-0 z-50 border-b backdrop-blur-xl", BORDER, "bg-white/[0.92] dark:bg-gray-950/[0.92]")}
      >
        <div className="mx-auto flex h-15 max-w-[1200px] items-center justify-between gap-2 px-[18px] md:h-17 md:gap-4 md:px-8">
          {isAnchor(home) ? (
            <a href={home} className="flex min-w-0 items-center gap-2.5 text-inherit">
              <Wordmark />
            </a>
          ) : (
            <Link href={home} className="flex min-w-0 items-center gap-2.5 text-inherit">
              <Wordmark />
            </Link>
          )}

          <nav data-tour="site-nav" className="hidden items-center gap-1.5 lg:flex">
            {nav.desktop.map((link) =>
              isAnchor(link.href) ? (
                <a key={link.href} href={link.href} data-tour={tourId(link.href)} className={desktopLink(link.href)}>
                  {link.label}
                </a>
              ) : (
                <Link
                  key={link.href}
                  href={link.href}
                  data-tour={tourId(link.href)}
                  aria-current={link.href === activeHref ? "page" : undefined}
                  className={desktopLink(link.href)}
                >
                  {link.label}
                </Link>
              )
            )}
          </nav>

          <div className="flex shrink-0 items-center gap-1.5 md:gap-2.5">
            <span className={cn("flex items-center gap-0.5 rounded-full border p-[3px]", BORDER, SURFACE_2)}>
              <button type="button" onClick={() => onLangChange("id")} className={langPill(lang === "id")}>
                ID
              </button>
              <button type="button" onClick={() => onLangChange("en")} className={langPill(lang === "en")}>
                EN
              </button>
            </span>

            {/*
              The sidebar shell's header carried an inline search with previews
              and recents. That chrome is gone; this keeps search one tap away
              rather than letting the affordance disappear with it.
            */}
            <Link href="/search" data-tour="search" className={roundButton} aria-label={t.tSearchLabel}>
              <SearchIcon className="h-5 w-5" />
            </Link>

            <button
              type="button"
              onClick={toggleTheme}
              data-tour="theme-toggle"
              className={roundButton}
              aria-label={t.tThemeLabel}
            >
              {isDark ? <MoonIcon className="h-5 w-5" /> : <SunIcon className="h-5 w-5" />}
            </button>

            {onOpenNotif ? (
              <button
                type="button"
                onClick={onOpenNotif}
                data-tour="notifications"
                className={cn(roundButton, "relative")}
                aria-label={t.tMNotifH}
              >
                <NotifDot />
                <BellIcon className="h-[22px] w-[22px]" />
              </button>
            ) : (
              <Link
                href="/notifications"
                data-tour="notifications"
                className={cn(roundButton, "relative")}
                aria-label={t.tMNotifH}
              >
                <NotifDot />
                <BellIcon className="h-[22px] w-[22px]" />
              </Link>
            )}

            <button
              type="button"
              className={cn(
                "hidden h-10 cursor-pointer items-center gap-2 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors duration-150 lg:inline-flex",
                BORDER,
                SURFACE,
                TEXT_2,
                "hover:bg-gray-100 dark:hover:bg-gray-800"
              )}
            >
              {t.tInstall}
            </button>
          </div>
        </div>
      </header>

      <nav
        data-tour="site-nav-mobile"
        /*
         * `w-full` is load-bearing. The site shell lays its children out in a
         * column flex container, and an auto cross-axis margin — `mx-auto`, here
         * to centre the row under the 1200px column — suppresses the stretch a
         * flex item would otherwise get. Without it the row sizes to its chips
         * and drags the whole document sideways on a phone.
         */
        className="mx-auto flex w-full max-w-[1200px] gap-2 overflow-x-auto px-[18px] pt-3 md:px-8 lg:hidden"
      >
        {nav.mobile.map((link) =>
          isAnchor(link.href) ? (
            <a key={link.href} href={link.href} data-tour={`m-${tourId(link.href)}`} className={chipLink(link.href)}>
              {link.label}
            </a>
          ) : (
            <Link
              key={link.href}
              href={link.href}
              data-tour={`m-${tourId(link.href)}`}
              aria-current={link.href === activeHref ? "page" : undefined}
              className={chipLink(link.href)}
            >
              {link.label}
            </Link>
          )
        )}
      </nav>
    </>
  );
}

function Wordmark() {
  return (
    <>
      <MalikaMark className="h-8 w-8 shrink-0" />
      <span className="flex min-w-0 flex-col leading-none">
        <span className={cn("text-lg font-semibold -tracking-[0.01em]", TEXT)}>MALIKA</span>
        {/* One line always: wrapping this pushes the lockup past the 60px
            header height the design specifies for mobile. */}
        <span className={cn("mt-[3px] truncate text-[11px] font-normal", TEXT_4)}>BPS Provinsi Maluku Utara</span>
      </span>
    </>
  );
}

function NotifDot() {
  return <span className="absolute right-2.5 top-[5px] h-2 w-2 rounded-full bg-orange-500" />;
}
