"use client";

import Image from "next/image";
import React, { useEffect, useRef, useState } from "react";
import lottie, { type AnimationItem } from "lottie-web";

export default function AppSplashScreen() {
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);
  const [lottieReady, setLottieReady] = useState(false);
  const [showContent, setShowContent] = useState(false);
  const lottieRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Trigger content animation after a brief delay
    const contentDelay = window.setTimeout(() => {
      setShowContent(true);
    }, 100);

    // Fallback safety: if animation can't load, don't block the app.
    const safety = window.setTimeout(() => {
      setFading(true);
      window.setTimeout(() => setVisible(false), 400);
    }, 2500);
    return () => {
      window.clearTimeout(safety);
      window.clearTimeout(contentDelay);
    };
  }, []);

  useEffect(() => {
    if (!visible) return;

    const container = lottieRef.current;
    if (!container) return;

    // Clear any previous render.
    container.innerHTML = "";

    let anim: AnimationItem | null = null;
    try {
      anim = lottie.loadAnimation({
        container,
        renderer: "svg",
        loop: true,
        autoplay: true,
        path: "/lottie/malika-splash.json",
        rendererSettings: {
          // Keep sizing predictable.
          preserveAspectRatio: "xMidYMid meet",
        },
      });

      anim.addEventListener("DOMLoaded", () => {
        setLottieReady(true);
      });

      // If DOMLoaded doesn't fire quickly (some devices), still show fallback.
      const t = window.setTimeout(() => {
        setLottieReady((prev) => prev);
      }, 250);

      // Show splash for a short minimum duration, then fade out.
      const minShow = window.setTimeout(() => {
        setFading(true);
        window.setTimeout(() => setVisible(false), 400);
      }, 1800);
    } catch {
      // If lottie fails for any reason, fall back to the static logo (below).
    }

    return () => {
      try {
        anim?.destroy();
      } catch {
        // ignore
      }

      try {
        // Ensure we don't keep stale SVGs.
        container.innerHTML = "";
      } catch {
        // ignore
      }
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      aria-hidden="true"
      className={
        "fixed inset-0 z-[2147483647] flex flex-col items-center justify-center bg-gradient-to-b from-white via-white to-gray-50 transition-opacity duration-400 ease-out dark:from-gray-900 dark:via-gray-900 dark:to-gray-950" +
        (fading ? " opacity-0" : " opacity-100")
      }
    >
      {/* Main content area */}
      <div className="flex flex-1 flex-col items-center justify-center">
        <div
          className={
            "flex flex-col items-center gap-6 transition-all duration-700 ease-out" +
            (showContent
              ? " translate-y-0 scale-100 opacity-100"
              : " translate-y-4 scale-95 opacity-0")
          }
        >
          <div className="relative">
            {/* Animated gradient glow */}
            <div className="absolute -inset-8 animate-pulse rounded-full bg-gradient-to-r from-blue-400/20 via-orange-400/20 to-green-400/20 blur-2xl [animation-duration:2s] dark:from-blue-500/10 dark:via-orange-500/10 dark:to-green-500/10" />
            <div className="absolute -inset-4 rounded-full bg-gray-200/40 blur-xl dark:bg-white/5" />

            {/* Lottie overlay (pulse ring) */}
            <div
              ref={lottieRef}
              className="absolute left-1/2 top-1/2 h-48 w-48 -translate-x-1/2 -translate-y-1/2 dark:invert"
            />

            {/* Fallback if Lottie isn't visible - removed dots, keep only rings */}
            {!lottieReady && (
              <div
                aria-hidden="true"
                className="absolute left-1/2 top-1/2 h-48 w-48 -translate-x-1/2 -translate-y-1/2"
              >
                <div className="absolute inset-4 rounded-full border-2 border-gray-300/40 animate-ping [animation-duration:1.5s] dark:border-white/15" />
                <div className="absolute inset-8 rounded-full border border-gray-300/30 animate-pulse [animation-duration:2s] dark:border-white/10" />
              </div>
            )}

            {/* Main logo with breathing animation */}
            <div className="relative flex h-24 w-24 animate-[breathe_3s_ease-in-out_infinite] items-center justify-center">
              <Image
                src="/images/logo/logo-icon.svg"
                alt=""
                width={96}
                height={96}
                className="drop-shadow-lg"
              />
            </div>
          </div>

          {/* App name & tagline */}
          <div className="flex flex-col items-center gap-1 text-center">
            <h1 className="text-2xl font-bold tracking-wide text-gray-800 dark:text-white">
              MALIKA
            </h1>
            <p className="max-w-xs text-xs font-medium tracking-wide text-gray-500 dark:text-gray-400">
              Maluku Utara Analytics &amp; Insights for Knowledge Advancement
            </p>
          </div>
        </div>
      </div>

      {/* Bottom section: Logos & Copyright */}
      <div
        className={
          "flex flex-col items-center gap-4 pb-12 transition-all duration-700 delay-300 ease-out" +
          (showContent
            ? " translate-y-0 opacity-100"
            : " translate-y-4 opacity-0")
        }
      >
        {/* TODO: partner logos (BPS-color + SE2026) — original assets
            /images/logo/Logo-BPS-color.png and Logo-SE2026.png have been
            404ing in production since launch (files never existed). Restore
            this block once the proper PNG assets are added to public/images/logo/. */}

        {/* Copyright text */}
        <p
          className="text-center text-sm text-gray-500 dark:text-gray-400"
          style={{ fontFamily: "Arial, sans-serif" }}
        >
          © BPS Provinsi Maluku Utara
        </p>
      </div>

      {/* Custom breathing animation */}
      <style jsx global>{`
        @keyframes breathe {
          0%,
          100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.05);
          }
        }
      `}</style>
    </div>
  );
}
