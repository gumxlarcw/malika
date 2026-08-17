"use client";

import React, { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import SiteHeader from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";
import { appNav } from "@/components/site/siteNav";
import SimpleTour from "@/components/SimpleTour";
import PullToRefresh from "@/components/common/PullToRefresh";
import { cn } from "@/lib/utils";
import { PAGE_BG } from "@/lib/surfaceTokens";
import { getCopy, type Lang } from "@/lib/siteCopy";

import "@/components/simple-tour.css";

/**
 * Shell for every page below the landing.
 *
 * These pages used to sit inside a sidebar + top-bar admin chrome, which gave
 * MALIKA two different appearances depending on where a visitor arrived. They
 * now wear the same header, ground and footer as the landing page, and the
 * sidebar is gone.
 *
 * Every page reads in the same 1200px column as the landing, and ends on the
 * same footer. One exception, below.
 */

/**
 * Pins to the viewport and never scrolls: the composer has to sit on the bottom
 * edge, and the transcript scrolls inside itself. A reading column and a tall
 * footer would both change what that page is.
 */
const FIXED = new Set(["/chat"]);

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  /*
   * Language lives here rather than in a provider because only the chrome reads
   * it — the sub-page bodies are Indonesian. Resetting to ID on navigation would
   * be wrong, but a layout is not remounted between routes, so the choice holds.
   */
  const [lang, setLang] = useState<Lang>("id");
  const t = useMemo(() => getCopy(lang), [lang]);
  const nav = useMemo(() => appNav(), []);

  const isFixed = FIXED.has(pathname);

  const handleRefresh = useCallback(async () => {
    router.refresh();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }, [router]);

  // Pull-to-refresh is a touch gesture; on a mouse it only intercepts scrolling.
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  React.useEffect(() => {
    setIsTouchDevice("ontouchstart" in window || navigator.maxTouchPoints > 0);
  }, []);

  return (
    /*
     * Document pages grow past the viewport and the document scrolls. Full-bleed
     * pages must not: they pin to the viewport so the chat composer and the map
     * controls stay reachable. The distinction has to be made with `height`, not
     * `min-height` — a child asking for `h-full` cannot resolve a percentage
     * against an auto-height ancestor, which silently collapsed the chat surface
     * to the height of its own content.
     */
    <div
      className={cn(
        "flex flex-col font-outfit",
        PAGE_BG,
        isFixed ? "h-screen h-[100dvh] overflow-hidden" : "min-h-screen"
      )}
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[99999] focus:rounded-lg focus:bg-brand-500 focus:px-4 focus:py-2 focus:text-white focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2"
      >
        Langsung ke konten utama
      </a>

      <SimpleTour />

      <SiteHeader t={t} lang={lang} onLangChange={setLang} home="/" nav={nav} activeHref={pathname} />

      <main
        id="main-content"
        role="main"
        aria-label="Konten utama"
        tabIndex={-1}
        className={cn(
          "w-full min-w-0 flex-1 outline-none",
          isFixed
            ? // `relative` is the anchor the chat surface positions against.
              "relative min-h-0 overflow-hidden"
            : "mx-auto max-w-[1200px] px-[18px] pb-16 pt-8 md:px-8 md:pt-10"
        )}
      >
        {isTouchDevice && !isFixed ? <PullToRefresh onRefresh={handleRefresh}>{children}</PullToRefresh> : children}
      </main>

      {isFixed ? null : <SiteFooter t={t} />}
    </div>
  );
}
