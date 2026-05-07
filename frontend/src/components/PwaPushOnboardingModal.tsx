"use client";

import React, { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { readNotificationPrefs, writeNotificationPrefs } from "@/lib/notificationPrefs";
import { trackAnalyticsEvent } from "@/hooks/useAnalytics";

const ONBOARDING_KEY = "pwa_push_onboarding_shown_v1";
const TOUR_COMPLETED_KEY = "malika_tour_completed_v1";
const TOUR_DISMISSED_KEY = "malika_tour_dismissed_v1";

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as unknown as { standalone?: boolean };
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    nav.standalone === true
  );
}

function isTourFinished(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      localStorage.getItem(TOUR_COMPLETED_KEY) === "1" ||
      localStorage.getItem(TOUR_DISMISSED_KEY) === "1"
    );
  } catch {
    return false;
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, "+")
    .replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length) as Uint8Array<ArrayBuffer>;

  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function PwaPushOnboardingModal() {
  const [hydrated, setHydrated] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    setHydrated(true);

    // Only show in standalone (PWA) mode - installed on Android, iOS, or Desktop
    if (!isStandalone()) return;

    // Check if notification APIs are supported
    const supported =
      "Notification" in window &&
      "serviceWorker" in navigator &&
      "PushManager" in window;
    
    if (!supported) return;

    // Check if push onboarding was already shown
    try {
      if (window.localStorage.getItem(ONBOARDING_KEY) === "1") return;
    } catch {}

    // Permission denied - don't show modal (can't do anything)
    if (Notification.permission === "denied") return;

    // Start polling for tour completion
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let attempts = 0;
    const maxAttempts = 120;

    const checkAndShow = () => {
      const tourFinished = isTourFinished();
      
      if (tourFinished) {
        if (intervalId) clearInterval(intervalId);
        setTimeout(() => setShowModal(true), 800);
        return true;
      }
      return false;
    };

    // Check immediately
    if (checkAndShow()) return;

    // Poll for tour completion
    intervalId = setInterval(() => {
      attempts++;
      if (checkAndShow()) return;
      
      if (attempts >= maxAttempts) {
        if (intervalId) clearInterval(intervalId);
        // Tour not completed in 60 seconds, show anyway
        setShowModal(true);
      }
    }, 500);

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  const closeModal = () => {
    setShowModal(false);
    // Mark as shown even if user dismisses
    try {
      window.localStorage.setItem(ONBOARDING_KEY, "1");
    } catch {}
    void trackAnalyticsEvent("pwa_push_onboarding_closed");
  };

  const handleEnablePush = async () => {
    setStatus("loading");
    setErrorMsg("");

    try {
      // Request notification permission
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("error");
        setErrorMsg(
          permission === "denied"
            ? "Izin notifikasi ditolak. Anda bisa mengaktifkannya di pengaturan browser."
            : "Izin notifikasi belum diberikan."
        );
        void trackAnalyticsEvent("pwa_push_permission_denied", { permission });
        return;
      }

      // Register service worker and subscribe
      const registration = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
      await registration.update().catch(() => undefined);

      // Check for existing subscription
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        // Already subscribed, just sync to server
        const res = await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(existing),
        });

        if (!res.ok) {
          setStatus("error");
          setErrorMsg(`Gagal sinkron ke server (HTTP ${res.status}).`);
          return;
        }

        await savePrefs(true);
        setStatus("success");
        void trackAnalyticsEvent("pwa_push_enabled_existing");
        return;
      }

      // Create new subscription
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) {
        setStatus("error");
        setErrorMsg("Konfigurasi push belum tersedia.");
        return;
      }

      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });

      if (!res.ok) {
        setStatus("error");
        setErrorMsg(`Gagal menyimpan subscription (HTTP ${res.status}).`);
        return;
      }

      await savePrefs(true);
      setStatus("success");
      void trackAnalyticsEvent("pwa_push_enabled_success");
    } catch (err) {
      setStatus("error");
      setErrorMsg("Terjadi kesalahan saat mengaktifkan notifikasi.");
      void trackAnalyticsEvent("pwa_push_enabled_error");
    }
  };

  const savePrefs = async (enabled: boolean) => {
    const current = readNotificationPrefs();
    await writeNotificationPrefs({
      ...current,
      enabled,
    });
  };

  const handleSkip = () => {
    void trackAnalyticsEvent("pwa_push_onboarding_skipped");
    closeModal();
  };

  const handleDone = () => {
    void trackAnalyticsEvent("pwa_push_onboarding_done");
    closeModal();
  };

  if (!hydrated) return null;

  return (
    <Modal
      isOpen={showModal}
      onClose={closeModal}
      showCloseButton={false}
      className="max-w-md m-4 p-0"
    >
      <div className="rounded-3xl bg-white p-6 dark:bg-gray-900 sm:p-8">
        {/* Icon */}
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 dark:bg-brand-500/10">
          <svg
            className="h-8 w-8 text-brand-500"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
            />
          </svg>
        </div>

        {/* Content */}
        <div className="text-center">
          <h3 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">
            Aktifkan Notifikasi
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Dapatkan pemberitahuan saat ada data statistik terbaru dan informasi penting lainnya.
          </p>
        </div>

        {/* Status messages */}
        {status === "error" && errorMsg && (
          <div className="mt-4 rounded-lg bg-error-50 p-3 text-sm text-error-600 dark:bg-error-500/10 dark:text-error-400">
            {errorMsg}
          </div>
        )}

        {status === "success" && (
          <div className="mt-4 rounded-lg bg-success-50 p-3 text-sm text-success-600 dark:bg-success-500/10 dark:text-success-400">
            Notifikasi berhasil diaktifkan! Anda akan menerima pemberitahuan saat ada update data terbaru.
          </div>
        )}

        {/* Actions */}
        <div className="mt-6 flex flex-col gap-3">
          {status === "success" ? (
            <button
              type="button"
              onClick={handleDone}
              className="w-full rounded-lg bg-brand-500 px-4 py-3 text-sm font-medium text-white shadow-theme-xs transition-colors hover:bg-brand-600"
            >
              Lanjutkan
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleEnablePush}
                disabled={status === "loading"}
                className="w-full rounded-lg bg-brand-500 px-4 py-3 text-sm font-medium text-white shadow-theme-xs transition-colors hover:bg-brand-600 disabled:opacity-60"
              >
                {status === "loading" ? (
                  <span className="inline-flex items-center gap-2">
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    Mengaktifkan...
                  </span>
                ) : (
                  "Aktifkan Notifikasi"
                )}
              </button>
              <button
                type="button"
                onClick={handleSkip}
                disabled={status === "loading"}
                className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-theme-xs transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Nanti saja
              </button>
            </>
          )}
        </div>

        {/* Footer hint */}
        <p className="mt-4 text-center text-xs text-gray-500 dark:text-gray-500">
          Anda dapat mengubah pengaturan ini kapan saja di menu Settings.
        </p>
      </div>
    </Modal>
  );
}
