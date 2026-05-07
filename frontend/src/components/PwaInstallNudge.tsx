"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/ui/modal";
import PwaInstallInstructions from "@/components/PwaInstallInstructions";
import { trackAnalyticsEvent } from "@/hooks/useAnalytics";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

declare global {
  interface Window {
    __MALIKA_PWA_PROMPT__?: BeforeInstallPromptEvent | null;
  }
}

const DISMISS_KEY = "pwa_install_nudge_dismissed_v1";

function isIos() {
  if (typeof window === "undefined") return false;
  return /iPad|iPhone|iPod/i.test(window.navigator.userAgent);
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as unknown as { standalone?: boolean };
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    nav.standalone === true
  );
}

export default function PwaInstallNudge() {
  const [hydrated, setHydrated] = useState(false);
  const [promptReady, setPromptReady] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [ios, setIos] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [trackedShown, setTrackedShown] = useState(false);

  const showInstall = promptReady;
  const showIosHelp = !promptReady && ios;

  useEffect(() => {
    if (typeof window === "undefined") return;

    setHydrated(true);
    setIos(isIos());

    setInstalled(isStandalone());

    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      window.__MALIKA_PWA_PROMPT__ = e as BeforeInstallPromptEvent;
      setPromptReady(true);
    };

    const onInstalled = () => {
      window.__MALIKA_PWA_PROMPT__ = null;
      setPromptReady(false);
      setInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    if (!hydrated || trackedShown) return;
    if (showInstall || showIosHelp) {
      setTrackedShown(true);
      void trackAnalyticsEvent("pwa_install_nudge_shown", {
        ios: showIosHelp,
        promptReady: showInstall,
      });
    }
  }, [hydrated, trackedShown, showInstall, showIosHelp]);

  // Avoid hydration mismatch on iOS (UA detection differs between server and client).
  if (!hydrated) return null;

  if (installed || dismissed) return null;

  if (!showInstall && !showIosHelp) return null;

  const onDismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
    setDismissed(true);
    void trackAnalyticsEvent("pwa_install_nudge_dismissed");
  };

  const onInstall = async () => {
    const ev = window.__MALIKA_PWA_PROMPT__;
    if (!ev) return;

    try {
      void trackAnalyticsEvent("pwa_install_prompt_opened");
      await ev.prompt();
      const choice = await ev.userChoice;
      void trackAnalyticsEvent("pwa_install_prompt_choice", {
        outcome: choice.outcome,
        platform: choice.platform,
      });
      if (choice.outcome === "accepted") {
        onDismiss();
      }
    } catch {
      // ignore
    }
  };

  const onOpenTutorial = () => {
    setShowTutorial(true);
    void trackAnalyticsEvent("pwa_install_tutorial_opened");
  };

  return (
    <>
      <div className="fixed bottom-4 left-0 right-0 z-[2147483646] flex justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-md dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-500 dark:bg-brand-500/10">
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900 dark:text-white/90">
                Install MALIKA
              </p>
              {showInstall ? (
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  Akses cepat, bisa dipakai offline, dan terasa seperti aplikasi.
                </p>
              ) : (
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  iPhone: buka Safari → Share → Add to Home Screen.
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {showInstall ? (
                  <button
                    type="button"
                    onClick={onInstall}
                    className="inline-flex items-center justify-center rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white shadow-theme-xs hover:bg-brand-600"
                  >
                    Install
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={onOpenTutorial}
                  className="inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-white/[0.03] dark:text-white/90"
                >
                  Lihat tutorial
                </button>

                <Link
                  href="/settings"
                  className="inline-flex items-center justify-center rounded-lg border border-transparent px-3 py-2 text-sm font-medium text-brand-600 hover:text-brand-700"
                >
                  Pengaturan
                </Link>
              </div>
            </div>

            <button
              type="button"
              onClick={onDismiss}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-opacity hover:opacity-90 dark:border-gray-800 dark:bg-white/[0.03] dark:text-white/90"
            >
              Nanti
            </button>
          </div>
        </div>
      </div>

      <Modal
        isOpen={showTutorial}
        onClose={() => setShowTutorial(false)}
        className="max-w-2xl m-4 p-0"
      >
        <div className="p-4 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white/90">
                Panduan Instalasi
              </h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Ikuti langkah berikut sesuai perangkat Anda.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowTutorial(false)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-theme-xs hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Tutup
            </button>
          </div>
          <div className="mt-4">
            <PwaInstallInstructions />
          </div>
        </div>
      </Modal>
    </>
  );
}
