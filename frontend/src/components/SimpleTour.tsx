"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import "./simple-tour.css";

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

/** Check if screen is mobile size */
function isMobileScreen() {
  if (typeof window === "undefined") return false;
  return window.innerWidth < 1024;
}

interface TourStep {
  id: string;
  title: string;
  description: string;
  element?: string; // CSS selector
  position?: "top" | "bottom" | "left" | "right" | "center";
}

export type SimpleTourProps = {
  forceShow?: boolean;
  onComplete?: () => void;
  onDismiss?: () => void;
};

export default function SimpleTour({
  forceShow = false,
  onComplete,
  onDismiss,
}: SimpleTourProps) {
  const [mounted, setMounted] = useState(false);
  const [shouldShow, setShouldShow] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [highlightRect, setHighlightRect] = useState<{x: number; y: number; width: number; height: number} | null>(null);
  const [popoverPosition, setPopoverPosition] = useState<"top" | "bottom" | "center">("center");
  const popoverRef = useRef<HTMLDivElement>(null);

  // Generate steps based on device
  useEffect(() => {
    if (!mounted) return;

    const ios = isIos();
    const android = isAndroid();
    const standalone = isStandalone();
    const mobile = isMobileScreen();

    const tourSteps: TourStep[] = [
      {
        id: "welcome",
        title: "👋 Selamat Datang di MALIKA!",
        description:
          "MALIKA adalah aplikasi layanan data statistik BPS Maluku Utara. Mari kami tunjukkan cara menggunakan aplikasi ini.",
        position: "center",
      },
    ];

    // Navigation steps - different for mobile (bottom nav) vs desktop (sidebar)
    if (mobile) {
      // Mobile bottom nav steps
      tourSteps.push(
        {
          id: "bottom-nav",
          title: "📱 Navigasi Bawah",
          description:
            "Gunakan bar navigasi di bawah layar untuk berpindah halaman dengan cepat.",
          element: '[data-tour="bottom-nav"]',
          position: "top",
        },
        {
          id: "bottom-nav-home",
          title: "🏠 Beranda",
          description:
            "Ketuk untuk kembali ke dashboard dan lihat ringkasan data statistik.",
          element: '[data-tour="bottom-nav-home"]',
          position: "top",
        },
        {
          id: "bottom-nav-chat",
          title: "💬 Chat MALIKA",
          description:
            'Tanya apapun tentang data statistik! Coba ketik "data kemiskinan 2024" atau "jumlah penduduk Ternate".',
          element: '[data-tour="bottom-nav-chat"]',
          position: "top",
        },
        {
          id: "bottom-nav-notifications",
          title: "🔔 Notifikasi",
          description:
            "Dapatkan notifikasi ketika ada data atau publikasi baru.",
          element: '[data-tour="bottom-nav-notifications"]',
          position: "top",
        }
      );
    } else {
      // Desktop sidebar steps
      tourSteps.push(
        {
          id: "sidebar-dashboard",
          title: "📊 Dashboard",
          description:
            "Lihat ringkasan data statistik penting Maluku Utara dalam bentuk visualisasi interaktif.",
          element: '[data-tour="sidebar-dashboard"]',
          position: "right",
        },
        {
          id: "sidebar-chat",
          title: "💬 Chat MALIKA",
          description:
            'Tanya apapun tentang data statistik Maluku Utara! Coba ketik "data kemiskinan 2024" atau "jumlah penduduk Ternate".',
          element: '[data-tour="sidebar-chat"]',
          position: "right",
        },
        {
          id: "sidebar-brs",
          title: "📰 Berita Resmi Statistik",
          description:
            "Akses semua publikasi Berita Resmi Statistik (BRS) BPS Maluku Utara terbaru.",
          element: '[data-tour="sidebar-brs"]',
          position: "right",
        },
        {
          id: "sidebar-publikasi",
          title: "📚 Publikasi",
          description:
            "Jelajahi publikasi statistik lengkap dari BPS Maluku Utara.",
          element: '[data-tour="sidebar-publikasi"]',
          position: "right",
        },
        {
          id: "sidebar-notifications",
          title: "🔔 Notifikasi",
          description:
            "Dapatkan notifikasi ketika ada data atau publikasi baru dari BPS Maluku Utara.",
          element: '[data-tour="sidebar-notifications"]',
          position: "right",
        }
      );
    }

    // Search
    tourSteps.push({
      id: "search",
      title: "🔍 Pencarian Cepat",
      description: mobile
        ? 'Ketuk tombol Cari di navigasi bawah untuk mencari data statistik. Coba ketik "inflasi", "PDRB", atau "ekspor".'
        : 'Cari data statistik dengan cepat. Ketik kata kunci seperti "inflasi", "PDRB", atau "ekspor".',
      element: mobile
        ? '[data-tour="bottom-nav-search"]'
        : '[data-tour="search-bar"]',
      position: mobile ? "top" : "bottom",
    });

    // Theme toggle
    tourSteps.push({
      id: "theme",
      title: "🌙 Mode Gelap/Terang",
      description:
        "Ubah tampilan aplikasi sesuai preferensi Anda - mode terang atau gelap.",
      element: mobile
        ? '[data-tour="theme-toggle"]'
        : '[data-tour="theme-toggle-desktop"]',
      position: "bottom",
    });

    // PWA installation based on device
    if (!standalone) {
      if (ios) {
        tourSteps.push({
          id: "pwa-ios",
          title: "📱 Install di iPhone/iPad",
          description:
            'Untuk menginstall MALIKA: Ketuk tombol Share di Safari → "Add to Home Screen" → "Add". Catatan: Fitur ini hanya tersedia di Safari.',
          position: "center",
        });
      } else if (android) {
        tourSteps.push({
          id: "pwa-android",
          title: "📱 Install di Android",
          description:
            'Untuk menginstall MALIKA: Ketuk Menu (⋮) di pojok kanan atas → "Install app" atau "Add to Home screen" → "Install".',
          position: "center",
        });
      } else if (!mobile) {
        tourSteps.push({
          id: "pwa-desktop",
          title: "💻 Install di Desktop",
          description:
            'Chrome/Edge: Klik ikon install (⊕) di address bar, atau Menu (⋮) → "Install MALIKA". Firefox: Bookmark halaman ini untuk akses cepat.',
          position: "center",
        });
      }
    }

    // Final step
    tourSteps.push({
      id: "finish",
      title: "🎉 Siap Menggunakan MALIKA!",
      description:
        "Anda sudah siap menggunakan aplikasi MALIKA! Jika butuh bantuan, gunakan fitur Chat MALIKA untuk bertanya seputar data statistik. Tip: Anda bisa membuka tutorial ini lagi melalui menu Settings.",
      position: "center",
    });

    setSteps(tourSteps);
  }, [mounted]);

  // Check if tour should be shown
  useEffect(() => {
    setMounted(true);

    if (forceShow) {
      setShouldShow(true);
      return;
    }

    try {
      const completed = localStorage.getItem(TOUR_COMPLETED_KEY) === "1";
      const dismissed = localStorage.getItem(TOUR_DISMISSED_KEY) === "1";
      if (!completed && !dismissed) {
        const timer = setTimeout(() => {
          setShouldShow(true);
        }, 1500);
        return () => clearTimeout(timer);
      }
    } catch {
      // localStorage not available
    }
  }, [forceShow]);

  // No longer need to open sidebar on mobile - we use bottom nav instead

  // Update highlight position when step changes
  useEffect(() => {
    if (!shouldShow || steps.length === 0) return;

    const step = steps[currentStep];
    
    // Remove previous highlight
    document.querySelectorAll(".simple-tour-highlighted").forEach((el) => {
      el.classList.remove("simple-tour-highlighted");
    });

    if (step?.element) {
      const el = document.querySelector(step.element);
      if (el) {
        // Add highlight class
        el.classList.add("simple-tour-highlighted");
        
        // Update spotlight position IMMEDIATELY (before scroll)
        const updatePosition = () => {
          const rect = el.getBoundingClientRect();
          setHighlightRect({
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
          });
          
          // Determine popover position based on element location
          const viewportHeight = window.innerHeight;
          const mobile = isMobileScreen();
          
          // On mobile, prefer bottom position if element is in top half
          if (mobile) {
            if (rect.top < viewportHeight * 0.4) {
              setPopoverPosition("bottom");
            } else {
              setPopoverPosition("top");
            }
          } else {
            if (rect.top > viewportHeight / 2) {
              setPopoverPosition("top");
            } else {
              setPopoverPosition("bottom");
            }
          }
        };
        
        // Update position immediately
        updatePosition();
        
        // Scroll into view smoothly
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        
        // Update position again after scroll completes (position may have changed)
        setTimeout(updatePosition, 400);
      } else {
        setHighlightRect(null);
        setPopoverPosition("center");
      }
    } else {
      setHighlightRect(null);
      setPopoverPosition("center");
    }
  }, [currentStep, steps, shouldShow]);

  // Cleanup highlight on unmount
  useEffect(() => {
    return () => {
      document.querySelectorAll(".simple-tour-highlighted").forEach((el) => {
        el.classList.remove("simple-tour-highlighted");
      });
    };
  }, []);

  const handleNext = useCallback(() => {
    if (currentStep < steps.length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      // Tour completed
      try {
        localStorage.setItem(TOUR_COMPLETED_KEY, "1");
      } catch {
        // ignore
      }
      document.querySelectorAll(".simple-tour-highlighted").forEach((el) => {
        el.classList.remove("simple-tour-highlighted");
      });
      setShouldShow(false);
      onComplete?.();
    }
  }, [currentStep, steps.length, onComplete]);

  const handlePrev = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  }, [currentStep]);

  const handleSkip = useCallback(() => {
    try {
      localStorage.setItem(TOUR_DISMISSED_KEY, "1");
    } catch {
      // ignore
    }
    document.querySelectorAll(".simple-tour-highlighted").forEach((el) => {
      el.classList.remove("simple-tour-highlighted");
    });
    setShouldShow(false);
    onDismiss?.();
  }, [onDismiss]);

  if (!mounted || !shouldShow || steps.length === 0) {
    return null;
  }

  const step = steps[currentStep];
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === steps.length - 1;

  // Calculate popover style class based on highlight position
  const getPopoverClass = () => {
    if (!highlightRect || popoverPosition === "center") {
      return "simple-tour-popover simple-tour-popover-center";
    }
    return `simple-tour-popover simple-tour-popover-${popoverPosition}`;
  };

  // Calculate popover position styles
  const getPopoverStyles = (): React.CSSProperties => {
    if (!highlightRect || popoverPosition === "center") {
      return {};
    }
    
    const mobile = isMobileScreen();
    const padding = mobile ? 12 : 16;
    const popoverWidth = mobile ? Math.min(360, window.innerWidth - 24) : 400;
    
    // Calculate horizontal position - try to center on element
    let left = highlightRect.x + highlightRect.width / 2 - popoverWidth / 2;
    
    // Keep popover within viewport
    if (left < padding) left = padding;
    if (left + popoverWidth > window.innerWidth - padding) {
      left = window.innerWidth - popoverWidth - padding;
    }
    
    if (popoverPosition === "bottom") {
      return {
        top: `${highlightRect.y + highlightRect.height + 16}px`,
        left: `${left}px`,
        transform: "none",
        maxWidth: `${popoverWidth}px`,
      };
    } else {
      return {
        bottom: `${window.innerHeight - highlightRect.y + 16}px`,
        left: `${left}px`,
        transform: "none",
        maxWidth: `${popoverWidth}px`,
      };
    }
  };

  return (
    <>
      {/* Overlay with spotlight cutout using SVG */}
      <svg className="simple-tour-overlay-svg" onClick={handleSkip}>
        <defs>
          <mask id="spotlight-mask">
            {/* White = visible, Black = hidden */}
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {highlightRect && (
              <rect
                className="simple-tour-spotlight-rect"
                x={highlightRect.x - 8}
                y={highlightRect.y - 8}
                width={highlightRect.width + 16}
                height={highlightRect.height + 16}
                rx="8"
                ry="8"
                fill="black"
              />
            )}
          </mask>
        </defs>
        {/* Dark overlay with mask cutout */}
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(0, 0, 0, 0.75)"
          mask="url(#spotlight-mask)"
        />
      </svg>

      {/* Popover */}
      <div
        ref={popoverRef}
        className={getPopoverClass()}
        style={getPopoverStyles()}
      >
        {/* Close button */}
        <button
          type="button"
          className="simple-tour-close"
          onClick={handleSkip}
          aria-label="Close"
        >
          ×
        </button>

        {/* Progress */}
        <div className="simple-tour-progress">
          {currentStep + 1} dari {steps.length}
        </div>

        {/* Title */}
        <h3 className="simple-tour-title">{step.title}</h3>

        {/* Description */}
        <p className="simple-tour-description">{step.description}</p>

        {/* Footer */}
        <div className="simple-tour-footer">
          <button
            type="button"
            className="simple-tour-skip"
            onClick={handleSkip}
          >
            Lewati Tutorial
          </button>

          <div className="simple-tour-nav">
            {!isFirstStep && (
              <button
                type="button"
                className="simple-tour-prev"
                onClick={handlePrev}
              >
                Kembali
              </button>
            )}
            <button
              type="button"
              className="simple-tour-next"
              onClick={handleNext}
            >
              {isLastStep ? "Selesai" : "Lanjut"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/** Hook to manually trigger the tour */
export function useTriggerTour() {
  const startTour = () => {
    try {
      localStorage.removeItem(TOUR_DISMISSED_KEY);
      localStorage.removeItem(TOUR_COMPLETED_KEY);
    } catch {
      // ignore
    }
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
      className={`inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors ${className}`}
    >
      {children || (
        <>
          <span>🎓</span>
          <span>Mulai Tutorial</span>
        </>
      )}
    </button>
  );
}
