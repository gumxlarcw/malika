import type { Copy } from "@/lib/siteCopy";
import type { NavLink } from "./SiteHeader";

/**
 * The two link sets the shared header switches between.
 *
 * The landing navigates within one long page, so its links are fragments. Every
 * other page navigates between routes. Keeping both here means the header stays
 * a presentation component and neither set can quietly diverge from the other.
 */

/** In-page anchors, for the landing only. */
export function landingNav(t: Copy): { desktop: NavLink[]; mobile: NavLink[] } {
  const menu = { href: "#menu", label: t.tNavMenu };
  const peta = { href: "#peta", label: "Peta Tematik" };
  const konsultasi = { href: "#konsultasi", label: t.tNavKonsul };
  const layanan = { href: "#layanan", label: t.tNavLayanan };
  return {
    desktop: [menu, peta, konsultasi, layanan],
    // The chip row carries one extra entry the desktop bar leaves out.
    mobile: [menu, peta, konsultasi, { href: "#kategori", label: t.tKatLink }, layanan],
  };
}

/**
 * Routes, for the sub-pages.
 *
 * This is the navigation the sidebar used to provide. Its full list ran to a
 * dozen entries, which does not fit a header bar — the five destinations the
 * landing's own menu grid leads with are here, and the rest stay reachable from
 * the footer and from the pages themselves.
 */
export function appNav(): { desktop: NavLink[]; mobile: NavLink[] } {
  const dashboard = { href: "/dashboard", label: "Dashboard" };
  const peta = { href: "/peta-tematik", label: "Peta Tematik" };
  const chat = { href: "/chat", label: "Chat MALIKA" };
  const data = { href: "/kategori", label: "Data Statistik" };
  return {
    desktop: [dashboard, peta, chat, data],
    mobile: [
      { href: "/", label: "Beranda" },
      dashboard,
      peta,
      chat,
      data,
      // "?kind=all" because the label promises both catalogues. /brs and
      // /publikasi keep their own defaults so each stays a valid deep link.
      { href: "/brs?kind=all", label: "BRS & Publikasi" },
    ],
  };
}
