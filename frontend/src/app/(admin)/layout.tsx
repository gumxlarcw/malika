"use client";

import { useSidebar } from "@/context/SidebarContext";
import AppHeader from "@/layout/AppHeader";
import AppSidebar from "@/layout/AppSidebar";
import Backdrop from "@/layout/Backdrop";
import MobileBottomNav from "@/layout/MobileBottomNav";
import SimpleTour from "@/components/SimpleTour";
import PullToRefresh from "@/components/common/PullToRefresh";
import { usePathname, useRouter } from "next/navigation";
import React, { useCallback } from "react";

// Import tour styles
import "@/components/simple-tour.css";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isExpanded, isHovered, isMobileOpen } = useSidebar();
  const pathname = usePathname();
  const router = useRouter();
  // The Metabase embed needs the full-bleed, non-scrolling main area. It moved to
  // /dashboard when the public landing page took over "/".
  const isDashboard = pathname === "/dashboard";
  const isChat = pathname === "/chat";

  // Handle pull-to-refresh
  const handleRefresh = useCallback(async () => {
    router.refresh();
    // Small delay to allow the refresh to process
    await new Promise((resolve) => setTimeout(resolve, 500));
  }, [router]);

  // Dynamic class for main content margin based on sidebar state
  const mainContentMargin = isMobileOpen
    ? "ml-0"
    : isExpanded || isHovered
    ? "lg:ml-[290px]"
    : "lg:ml-[90px]";

  // Disable pull-to-refresh on desktop (only for touch devices)
  const [isTouchDevice, setIsTouchDevice] = React.useState(false);
  React.useEffect(() => {
    setIsTouchDevice("ontouchstart" in window || navigator.maxTouchPoints > 0);
  }, []);

  return (
    <div className="flex h-screen h-[100dvh] overflow-hidden">
      {/* Skip to Content Link - Accessibility */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[99999] focus:rounded-lg focus:bg-brand-500 focus:px-4 focus:py-2 focus:text-white focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2"
      >
        Langsung ke konten utama
      </a>
      {/* Simple Tour - shows on all pages for first-time users */}
      <SimpleTour />
      {/* Sidebar and Backdrop */}
      <AppSidebar />
      <Backdrop />
      {/* Main Content Area */}
      <div
        className={`flex min-w-0 min-h-0 flex-1 flex-col transition-all duration-300 ease-in-out ${mainContentMargin}`}
      >
        {/* Header */}
        <AppHeader />
        {/* Page Content - add pt for fixed header height */}
        <main
          id="main-content"
          role="main"
          aria-label="Konten utama"
          tabIndex={-1}
          className={
            isDashboard || isChat
              ? "min-w-0 min-h-0 flex-1 overflow-hidden p-0 pt-[60px] pb-16 lg:pt-[73px] lg:pb-0 outline-none"
              : "min-w-0 flex-1 overflow-y-auto px-4 pt-[76px] pb-20 md:px-6 md:pt-[89px] lg:pb-6 outline-none"
          }
        >
          {/* Pull-to-Refresh wrapper for touch devices on non-dashboard pages */}
          {isTouchDevice && !isDashboard && !isChat ? (
            <PullToRefresh onRefresh={handleRefresh}>
              {children}
            </PullToRefresh>
          ) : (
            children
          )}
        </main>
      </div>
      {/* Mobile Bottom Navigation */}
      <MobileBottomNav />
    </div>
  );
}
