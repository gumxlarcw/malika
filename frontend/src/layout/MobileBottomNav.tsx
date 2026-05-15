"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";

// Custom event to trigger mobile search from bottom nav
export const triggerMobileSearch = () => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("open-mobile-search"));
  }
};

// Icons for bottom nav
function HomeIcon({ active }: { active?: boolean }) {
  return (
    <svg
      className={`h-6 w-6 ${active ? "text-brand-500" : "text-gray-500 dark:text-gray-400"}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9,22 9,12 15,12 15,22" />
    </svg>
  );
}

function SearchIcon({ active }: { active?: boolean }) {
  return (
    <svg
      className={`h-6 w-6 ${active ? "text-brand-500" : "text-gray-500 dark:text-gray-400"}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function ChatIcon({ active }: { active?: boolean }) {
  return (
    <svg
      className={`h-6 w-6 ${active ? "text-brand-500" : "text-gray-500 dark:text-gray-400"}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function BookIcon({ active }: { active?: boolean }) {
  return (
    <svg
      className={`h-6 w-6 ${active ? "text-brand-500" : "text-gray-500 dark:text-gray-400"}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function PetaTematikIcon({ active }: { active?: boolean }) {
  return (
    <svg
      className={`h-6 w-6 ${active ? "text-brand-500" : "text-gray-500 dark:text-gray-400"}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="1,6 8,3 16,6 23,3 23,18 16,21 8,18 1,21" />
      <line x1="8" y1="3" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="21" />
    </svg>
  );
}

// Kategori/Data icon
function KategoriIcon({ active }: { active?: boolean }) {
  return (
    <svg
      className={`h-6 w-6 ${active ? "text-brand-500" : "text-gray-500 dark:text-gray-400"}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
      <path d="M22 12A10 10 0 0 0 12 2v10z" />
    </svg>
  );
}

const navItems = [
  { href: "/", label: "Beranda", icon: HomeIcon, tourId: "bottom-nav-home" },
  { href: "/kategori", label: "Data", icon: KategoriIcon, tourId: "bottom-nav-kategori" },
  { href: "/chat", label: "Malika", icon: ChatIcon, tourId: "bottom-nav-chat" },
  { href: "/brs", label: "BRS & Publikasi", icon: BookIcon, tourId: "bottom-nav-brs-publikasi" },
  { href: "/peta-tematik", label: "Peta", icon: PetaTematikIcon, tourId: "bottom-nav-peta-tematik" },
];

export default function MobileBottomNav() {
  const pathname = usePathname();
  const [isStandalone, setIsStandalone] = useState(false);

  // Detect if running as PWA standalone mode
  useEffect(() => {
    const checkStandalone = () => {
      const isStandaloneMode = 
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as any).standalone === true ||
        document.referrer.includes('android-app://');
      setIsStandalone(isStandaloneMode);
    };
    
    checkStandalone();
    
    // Also listen for display mode changes
    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleChange = () => checkStandalone();
    mediaQuery.addEventListener('change', handleChange);
    
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return (
    <nav 
      className={`fixed bottom-0 left-0 right-0 z-[99999] border-t border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 lg:hidden ${isStandalone ? '' : 'pb-safe'}`}
      data-tour="bottom-nav"
      role="navigation"
      aria-label="Navigasi utama mobile"
    >
      <div className="flex h-16 items-center justify-around" role="menubar">
        {navItems.map((item) => {
          const isActive = item.href
            ? (pathname === item.href ||
               (item.href !== "/" && pathname.startsWith(item.href)) ||
               // The merged "Arsip" entry links to /brs but should also light up
               // when the user is on /publikasi (both render ArchiveBrowser).
               (item.href === "/brs" && pathname.startsWith("/publikasi")))
            : false;
          const Icon = item.icon;
          
          return (
            <Link
              key={item.href}
              href={item.href!}
              data-tour={item.tourId}
              aria-label={`${item.label}${isActive ? " - Halaman aktif" : ""}`}
              aria-current={isActive ? "page" : undefined}
              role="menuitem"
              className={`flex flex-1 flex-col items-center justify-center gap-1 py-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
                isActive
                  ? "text-brand-500"
                  : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              }`}
            >
              <Icon active={isActive} />
              <span
                className={`text-[11px] leading-tight text-center px-0.5 ${isActive ? "font-medium" : ""}`}
                aria-hidden="true"
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
