"use client";

import React, { useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import Footer from "@/components/Footer";
import FloatingThemeToggle from "@/components/FloatingThemeToggle";
import { useAuth } from "@/components/AuthProvider";
import { Menu, LogOut, PanelLeftClose, PanelLeft } from "lucide-react";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "";
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Keep login page clean (no topbar/sidebar/footer chrome)
  const isLogin = pathname === "/backend/login" || pathname.endsWith("/login");
  if (isLogin) {
    return <>{children}</>;
  }

  return (
    <div className="h-screen overflow-hidden flex">
      {/* Desktop Sidebar - extends full height */}
      <Sidebar variant="desktop" collapsed={sidebarCollapsed} />

      {/* Mobile sidebar drawer */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            className="absolute inset-0 bg-black/40"
            aria-label="Close sidebar"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <div className="relative h-full w-72 max-w-[80vw]">
            <Sidebar variant="mobile" onNavigate={() => setMobileSidebarOpen(false)} />
          </div>
        </div>
      )}

      <FloatingThemeToggle />

      {/* Main content area with header */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Top header bar - only in main content area */}
        <header className="shrink-0 h-14 border-b border-border bg-card px-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Desktop sidebar collapse button */}
            <button
              className="hidden md:inline-flex items-center justify-center h-9 w-9 rounded border border-border bg-secondary text-secondary-foreground hover:bg-muted transition-colors"
              onClick={() => setSidebarCollapsed((v) => !v)}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? <PanelLeft className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
            </button>
            
            {/* Mobile menu button */}
            <button
              className="md:hidden inline-flex items-center justify-center h-9 w-9 rounded border border-border bg-secondary text-secondary-foreground"
              onClick={() => setMobileSidebarOpen((v) => !v)}
              aria-label="Toggle sidebar"
            >
              <Menu className="h-5 w-5" />
            </button>
            
            {/* Page title */}
            <h1 className="text-lg font-bold text-foreground">
              <span className="text-primary">MALIKA</span> Admin Panel
            </h1>
          </div>

          <nav className="flex items-center gap-2 text-sm">
            <UserMenu />
          </nav>
        </header>

        {/* Scrollable content + footer */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6">
            {children}
          </main>
          <Footer />
        </div>
      </div>
    </div>
  );
}

function UserMenu() {
  const { user, logout, loading } = useAuth();

  if (loading) return null;

  if (!user) {
    return (
      <a
        href="/login"
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded border border-border bg-secondary text-secondary-foreground text-sm"
      >
        Login
      </a>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-muted-foreground hidden sm:block">
        {user.email || user.name || "User"}
      </span>
      <button
        onClick={logout}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-secondary text-secondary-foreground text-sm hover:bg-muted"
      >
        <LogOut className="h-4 w-4" />
        <span className="hidden sm:inline">Logout</span>
      </button>
    </div>
  );
}
