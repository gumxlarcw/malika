"use client";

import React, { useEffect, useRef, useState } from "react";
import { driver, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import { useSidebar } from "@/context/SidebarContext";

const TOUR_COMPLETED_KEY = "malika_tour_completed_v1";
const TOUR_DISMISSED_KEY = "malika_tour_dismissed_v1";

/** Detect iOS device */
function isIos() {
  if (typeof window === "undefined") return false;
  return /iPad|iPhone|iPod/i.test(window.navigator.userAgent);
}

/** Detect Android device */
function isAndroid() {
  if (typeof window === "undefined") return false;
  return /Android/i.test(window.navigator.userAgent);
}

/** Check if running in standalone mode (already installed as PWA) */
function isStandalone() {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as unknown as { standalone?: boolean };
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    nav.standalone === true
  );
}

/** Check if device is mobile */
function isMobile() {
  if (typeof window === "undefined") return false;
  // Use screen width to match CSS breakpoints (lg: 1024px)
  // Sidebar is hidden below lg breakpoint
  return window.innerWidth < 1024;
}

export type GuidedTourProps = {
  /** Force show the tour even if already completed */
  forceShow?: boolean;
  /** Callback when tour is completed */
  onComplete?: () => void;
  /** Callback when tour is dismissed/skipped */
  onDismiss?: () => void;
};

export default function GuidedTour({
  forceShow = false,
  onComplete,
  onDismiss,
}: GuidedTourProps) {
  const driverRef = useRef<Driver | null>(null);
  const [mounted, setMounted] = useState(false);
  const [shouldShow, setShouldShow] = useState(false);
  const [tourStarted, setTourStarted] = useState(false);
  const { isMobileOpen, toggleMobileSidebar } = useSidebar();
  
  // Store sidebar functions in refs to avoid dependency issues
  const toggleMobileSidebarRef = useRef(toggleMobileSidebar);
  const isMobileOpenRef = useRef(isMobileOpen);
  
  // Keep refs updated
  useEffect(() => {
    toggleMobileSidebarRef.current = toggleMobileSidebar;
    isMobileOpenRef.current = isMobileOpen;
  }, [toggleMobileSidebar, isMobileOpen]);

  useEffect(() => {
    setMounted(true);
    console.log("[GuidedTour] Mounted, forceShow:", forceShow);

    // Check if tour should be shown
    if (forceShow) {
      console.log("[GuidedTour] Force showing tour");
      setShouldShow(true);
      return;
    }

    try {
      const completed = localStorage.getItem(TOUR_COMPLETED_KEY) === "1";
      const dismissed = localStorage.getItem(TOUR_DISMISSED_KEY) === "1";
      console.log("[GuidedTour] localStorage check - completed:", completed, "dismissed:", dismissed);
      if (!completed && !dismissed) {
        // Delay showing tour to ensure page is fully loaded
        console.log("[GuidedTour] Will show tour in 1.5s");
        const timer = setTimeout(() => {
          console.log("[GuidedTour] Setting shouldShow to true");
          setShouldShow(true);
        }, 1500);
        return () => clearTimeout(timer);
      } else {
        console.log("[GuidedTour] Tour already completed or dismissed");
      }
    } catch (e) {
      // localStorage not available
      console.error("[GuidedTour] localStorage error:", e);
    }
  }, [forceShow]);

  useEffect(() => {
    // Prevent re-running tour after it has started
    console.log("[GuidedTour] Tour effect - mounted:", mounted, "shouldShow:", shouldShow, "tourStarted:", tourStarted);
    if (!mounted || !shouldShow || tourStarted) return;

    console.log("[GuidedTour] Starting tour...");
    const ios = isIos();
    const android = isAndroid();
    const standalone = isStandalone();
    const mobile = isMobile();
    console.log("[GuidedTour] Device info - ios:", ios, "android:", android, "mobile:", mobile, "standalone:", standalone);

    // Mark tour as started to prevent re-runs
    setTourStarted(true);

    // Track if we opened the sidebar for the tour
    let openedSidebarForTour = false;

    // Function to start tour (async for mobile sidebar handling)
    const startTour = async () => {
      // On mobile, open sidebar for tour
      if (mobile && !isMobileOpenRef.current) {
        openedSidebarForTour = true;
        toggleMobileSidebarRef.current();
        // Wait for sidebar animation
        await new Promise((resolve) => setTimeout(resolve, 400));
      }

      // Build tour steps dynamically based on device
      const steps: Array<{
        element?: string;
        popover: {
          title: string;
          description: string;
          side?: "top" | "bottom" | "left" | "right";
          align?: "start" | "center" | "end";
        };
      }> = [
        {
          popover: {
            title: "👋 Selamat Datang di MALIKA!",
            description:
              "MALIKA adalah aplikasi layanan data statistik BPS Maluku Utara. Mari kami tunjukkan cara menggunakan aplikasi ini.",
          },
        },
      ];

    // Sidebar items - show on all devices (sidebar opens on mobile during tour)
    steps.push(
      {
        element: '[data-tour="sidebar-dashboard"]',
        popover: {
          title: "📊 Dashboard",
          description:
            "Lihat ringkasan data statistik penting Maluku Utara dalam bentuk visualisasi interaktif.",
          side: "right",
        },
      },
      {
        element: '[data-tour="sidebar-chat"]',
        popover: {
          title: "💬 Chat MALIKA",
          description:
            'Tanya apapun tentang data statistik Maluku Utara! Coba ketik "data kemiskinan 2024" atau "jumlah penduduk Ternate".',
          side: "right",
        },
      },
      {
        element: '[data-tour="sidebar-brs"]',
        popover: {
          title: "📰 Berita Resmi Statistik",
          description:
            "Akses semua publikasi Berita Resmi Statistik (BRS) BPS Maluku Utara terbaru.",
          side: "right",
        },
      },
      {
        element: '[data-tour="sidebar-publikasi"]',
        popover: {
          title: "📚 Publikasi",
          description:
            "Jelajahi publikasi statistik lengkap dari BPS Maluku Utara.",
          side: "right",
        },
      },
      {
        element: '[data-tour="sidebar-notifications"]',
        popover: {
          title: "🔔 Notifikasi",
          description:
            "Dapatkan notifikasi ketika ada data atau publikasi baru dari BPS Maluku Utara.",
          side: "right",
        },
      }
    );

    // Search - use different element for mobile vs desktop
    steps.push({
      element: mobile
        ? '[data-tour="search-mobile"]'
        : '[data-tour="search-bar"]',
      popover: {
        title: "🔍 Pencarian Cepat",
        description: mobile
          ? 'Ketuk tombol ini untuk mencari data statistik. Coba ketik "inflasi", "PDRB", atau "ekspor".'
          : 'Cari data statistik dengan cepat. Ketik kata kunci seperti "inflasi", "PDRB", atau "ekspor".',
        side: "bottom",
      },
    });

    // Theme toggle - use different element for mobile vs desktop
    steps.push({
      element: mobile
        ? '[data-tour="theme-toggle"]'
        : '[data-tour="theme-toggle-desktop"]',
      popover: {
        title: "🌙 Mode Gelap/Terang",
        description:
          "Ubah tampilan aplikasi sesuai preferensi Anda - mode terang atau gelap.",
        side: mobile ? "bottom" : "left",
      },
    });

    // Add PWA installation step based on device type
    if (!standalone) {
      if (ios) {
        steps.push({
          popover: {
            title: "📱 Install di iPhone/iPad",
            description: `
              <div class="space-y-3">
                <p class="font-medium">Untuk menginstall MALIKA di perangkat Apple Anda:</p>
                <ol class="list-decimal list-inside space-y-2 text-sm">
                  <li>Ketuk tombol <strong>Share</strong> <span class="inline-block w-5 h-5 align-middle">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 5l-1.42 1.42-1.59-1.59V16h-2V4.83L9.41 6.42 8 5l4-4 4 4zm4 5v11c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V10c0-1.1.9-2 2-2h3v2H6v11h12V10h-3V8h3c1.1 0 2 .9 2 2z"/></svg>
                  </span> di Safari</li>
                  <li>Scroll ke bawah dan ketuk <strong>"Add to Home Screen"</strong></li>
                  <li>Ketuk <strong>"Add"</strong> di pojok kanan atas</li>
                </ol>
                <p class="text-xs text-gray-500 mt-2">
                  ⚠️ Fitur ini hanya tersedia di Safari. Jika menggunakan Chrome atau browser lain, buka dengan Safari terlebih dahulu.
                </p>
              </div>
            `,
          },
        });
      } else if (android) {
        steps.push({
          popover: {
            title: "📱 Install di Android",
            description: `
              <div class="space-y-3">
                <p class="font-medium">Untuk menginstall MALIKA di perangkat Android Anda:</p>
                <ol class="list-decimal list-inside space-y-2 text-sm">
                  <li>Ketuk tombol <strong>Menu (⋮)</strong> di pojok kanan atas browser</li>
                  <li>Pilih <strong>"Install app"</strong> atau <strong>"Add to Home screen"</strong></li>
                  <li>Ketuk <strong>"Install"</strong> untuk konfirmasi</li>
                </ol>
                <p class="text-xs text-gray-500 mt-2">
                  💡 Jika muncul banner install di bawah layar, Anda juga bisa langsung ketuk "Install" di sana.
                </p>
              </div>
            `,
          },
        });
      } else if (!mobile) {
        // Desktop browser
        steps.push({
          popover: {
            title: "💻 Install di Desktop",
            description: `
              <div class="space-y-3">
                <p class="font-medium">Untuk menginstall MALIKA di komputer Anda:</p>
                <div class="space-y-2 text-sm">
                  <div>
                    <strong>Chrome/Edge:</strong>
                    <ol class="list-decimal list-inside ml-2">
                      <li>Klik ikon install <span class="inline-block">⊕</span> di address bar</li>
                      <li>Atau klik Menu (⋮) → "Install MALIKA"</li>
                    </ol>
                  </div>
                  <div>
                    <strong>Firefox:</strong>
                    <p class="ml-2">Bookmark halaman ini untuk akses cepat</p>
                  </div>
                </div>
              </div>
            `,
          },
        });
      }
    }

    // Final step
    steps.push({
      popover: {
        title: "🎉 Siap Menggunakan MALIKA!",
        description: `
          <div class="space-y-2">
            <p>Anda sudah siap menggunakan aplikasi MALIKA!</p>
            <p class="text-sm text-gray-600">
              Jika butuh bantuan, gunakan fitur <strong>Chat MALIKA</strong> untuk bertanya seputar data statistik.
            </p>
            <p class="text-sm text-gray-600 mt-2">
              💡 Tip: Anda bisa membuka tutorial ini lagi melalui menu <strong>Settings</strong>.
            </p>
          </div>
        `,
      },
    });

    // Filter out steps with missing elements
    const validSteps = steps.filter((step) => {
      if (!step.element) return true;
      return document.querySelector(step.element) !== null;
    });

    // Initialize driver.js
    const driverInstance = driver({
      showProgress: true,
      showButtons: ["next", "previous", "close"],
      nextBtnText: "Lanjut",
      prevBtnText: "Kembali",
      doneBtnText: "Selesai",
      progressText: "{{current}} dari {{total}}",
      popoverClass: "malika-tour-popover",
      steps: validSteps,
      allowClose: true,
      overlayColor: "rgba(0, 0, 0, 0.7)",
      stagePadding: 10,
      stageRadius: 8,
      animate: true,
      smoothScroll: true,
      onPopoverRender: (popover) => {
        // Add skip button to footer
        const footer = popover.footerButtons;
        if (footer) {
          const skipBtn = document.createElement("button");
          skipBtn.innerText = "Lewati Tutorial";
          skipBtn.className = "driver-popover-skip-btn";
          skipBtn.onclick = () => {
            driverInstance.destroy();
          };
          // Insert skip button at the beginning
          footer.insertBefore(skipBtn, footer.firstChild);
        }
      },
      onHighlightStarted: () => {
        // Add class to body to override z-index of header/sidebar
        document.body.classList.add("driver-active");
      },
      onDeselected: () => {
        // Remove class when step changes
        document.body.classList.remove("driver-active");
      },
      onDestroyed: () => {
        // Remove class and handle completion
        document.body.classList.remove("driver-active");
        
        // Close sidebar on mobile if we opened it for tour
        if (mobile && openedSidebarForTour) {
          toggleMobileSidebarRef.current();
        }
        
        // Check if tour was completed or just dismissed
        const currentStep = driverInstance.getActiveIndex();
        const totalSteps = validSteps.length;

        if (currentStep !== undefined && currentStep >= totalSteps - 1) {
          // Tour completed
          try {
            localStorage.setItem(TOUR_COMPLETED_KEY, "1");
          } catch {
            // ignore
          }
          onComplete?.();
        } else {
          // Tour dismissed/skipped
          try {
            localStorage.setItem(TOUR_DISMISSED_KEY, "1");
          } catch {
            // ignore
          }
          onDismiss?.();
        }
      },
    });

    driverRef.current = driverInstance;

    // Start the tour
    console.log("[GuidedTour] Valid steps count:", validSteps.length);
    console.log("[GuidedTour] Calling driver.drive()...");
    try {
      driverInstance.drive();
      console.log("[GuidedTour] driver.drive() called successfully");
      
      // Debug: check if driver elements exist in DOM
      setTimeout(() => {
        const overlay = document.querySelector(".driver-overlay");
        const popover = document.querySelector(".driver-popover");
        console.log("[GuidedTour] Overlay element:", overlay);
        console.log("[GuidedTour] Popover element:", popover);
        if (overlay) {
          const overlayStyle = window.getComputedStyle(overlay);
          console.log("[GuidedTour] Overlay display:", overlayStyle.display, "visibility:", overlayStyle.visibility, "z-index:", overlayStyle.zIndex);
        }
        if (popover) {
          const popoverStyle = window.getComputedStyle(popover);
          console.log("[GuidedTour] Popover display:", popoverStyle.display, "visibility:", popoverStyle.visibility, "z-index:", popoverStyle.zIndex);
        }
      }, 500);
    } catch (err) {
      console.error("[GuidedTour] driver.drive() error:", err);
    }
    };

    // Start the tour
    startTour();

    return () => {
      if (driverRef.current) {
        driverRef.current.destroy();
      }
    };
     
  }, [mounted, shouldShow, tourStarted, onComplete, onDismiss]);

  return null;
}

/** Hook to manually trigger the tour */
export function useTriggerTour() {
  const startTour = () => {
    // Remove the dismissed flag so tour can be shown again
    try {
      localStorage.removeItem(TOUR_DISMISSED_KEY);
      localStorage.removeItem(TOUR_COMPLETED_KEY);
    } catch {
      // ignore
    }
    // Reload to trigger tour
    window.location.reload();
  };

  return { startTour };
}

/** Button component to start the tour manually */
export function StartTourButton({
  className = "",
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  const { startTour } = useTriggerTour();

  return (
    <button
      type="button"
      onClick={startTour}
      className={`inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white shadow-theme-xs hover:bg-brand-600 transition-colors ${className}`}
    >
      {children || (
        <>
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
            />
          </svg>
          Mulai Tutorial
        </>
      )}
    </button>
  );
}
