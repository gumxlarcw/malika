"use client";

import React from "react";
import { useTheme } from "@/context/ThemeContext";
import { BellIcon } from "@/icons";
import { cn } from "@/lib/utils";
import type { Copy, Lang } from "../_lib/copy";
import { BORDER, SURFACE, SURFACE_2, TEXT, TEXT_2, TEXT_4 } from "../_lib/ui";
import { MalikaMark, MoonIcon, SunIcon } from "./LandingIcons";

type Props = {
  t: Copy;
  lang: Lang;
  onLangChange: (lang: Lang) => void;
  onOpenNotif: () => void;
};

const NAV_LINKS: Array<{ href: string; key: keyof Copy | "peta" }> = [
  { href: "#menu", key: "tNavMenu" },
  { href: "#peta", key: "peta" },
  { href: "#konsultasi", key: "tNavKonsul" },
  { href: "#layanan", key: "tNavLayanan" },
];

/** The mobile chip row carries one extra entry the desktop bar leaves out. */
const MOBILE_LINKS: Array<{ href: string; key: keyof Copy | "peta" }> = [
  { href: "#menu", key: "tNavMenu" },
  { href: "#peta", key: "peta" },
  { href: "#konsultasi", key: "tNavKonsul" },
  { href: "#kategori", key: "tKatLink" },
  { href: "#layanan", key: "tNavLayanan" },
];

const label = (t: Copy, key: keyof Copy | "peta") =>
  key === "peta" ? "Peta Tematik" : t[key];

export default function LandingHeader({ t, lang, onLangChange, onOpenNotif }: Props) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  const langPill = (active: boolean) =>
    cn(
      "cursor-pointer rounded-full px-3 py-1.5 text-xs font-semibold transition-colors duration-150",
      active
        ? cn(SURFACE, TEXT, "shadow-theme-xs")
        : cn("bg-transparent", TEXT_4)
    );

  const roundButton = cn(
    "flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border",
    BORDER,
    SURFACE,
    TEXT_4,
    "transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
  );

  return (
    <>
      <header
        className={cn(
          "sticky top-0 z-50 border-b backdrop-blur-xl",
          BORDER,
          "bg-white/[0.92] dark:bg-gray-950/[0.92]"
        )}
      >
        <div className="mx-auto flex h-15 max-w-[1200px] items-center justify-between gap-2 px-[18px] md:h-17 md:gap-4 md:px-8">
          <a href="#" className="flex min-w-0 items-center gap-2.5 text-inherit">
            <MalikaMark className="h-8 w-8 shrink-0" />
            <span className="flex min-w-0 flex-col leading-none">
              <span className={cn("text-lg font-semibold -tracking-[0.01em]", TEXT)}>MALIKA</span>
              {/* One line always: wrapping this pushes the lockup past the 60px
                  header height the design specifies for mobile. */}
              <span className={cn("mt-[3px] truncate text-[11px] font-normal", TEXT_4)}>
                BPS Provinsi Maluku Utara
              </span>
            </span>
          </a>

          <nav className="hidden items-center gap-1.5 md:flex">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className={cn(
                  "whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150",
                  TEXT_2,
                  "hover:bg-gray-100 dark:hover:bg-gray-800"
                )}
              >
                {label(t, link.key)}
              </a>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-1.5 md:gap-2.5">
            <span
              className={cn("flex items-center gap-0.5 rounded-full border p-[3px]", BORDER, SURFACE_2)}
            >
              <button type="button" onClick={() => onLangChange("id")} className={langPill(lang === "id")}>
                ID
              </button>
              <button type="button" onClick={() => onLangChange("en")} className={langPill(lang === "en")}>
                EN
              </button>
            </span>

            <button
              type="button"
              onClick={toggleTheme}
              className={roundButton}
              aria-label={t.tThemeLabel}
            >
              {isDark ? <MoonIcon className="h-5 w-5" /> : <SunIcon className="h-5 w-5" />}
            </button>

            <button
              type="button"
              onClick={onOpenNotif}
              className={cn(roundButton, "relative")}
              aria-label={t.tMNotifH}
            >
              <span className="absolute right-2.5 top-[5px] h-2 w-2 rounded-full bg-orange-500" />
              <BellIcon className="h-[22px] w-[22px]" />
            </button>

            <button
              type="button"
              className={cn(
                "hidden h-10 cursor-pointer items-center gap-2 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors duration-150 md:inline-flex",
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

      <nav className="flex gap-2 overflow-x-auto px-[18px] pt-3 md:hidden">
        {MOBILE_LINKS.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-full border px-3.5 py-[7px] text-[13px] font-medium leading-5",
              BORDER,
              SURFACE,
              TEXT_2
            )}
          >
            {label(t, link.key)}
          </a>
        ))}
      </nav>
    </>
  );
}
