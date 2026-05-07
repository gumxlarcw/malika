"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Checkbox from "@/components/form/input/Checkbox";
import { StartTourButton } from "@/components/SimpleTour";
import PwaInstallInstructions from "@/components/PwaInstallInstructions";
import type { NotificationPrefs } from "@/lib/notificationPrefs";
import {
  DEFAULT_NOTIFICATION_PREFS,
  readNotificationPrefs,
  writeNotificationPrefs,
} from "@/lib/notificationPrefs";

export default function SettingsPage() {
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);

  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported">("default");

  const [pushStatus, setPushStatus] = useState<
    "unknown" | "unsupported" | "blocked" | "ready" | "subscribed" | "error"
  >("unknown");
  const [pushMessage, setPushMessage] = useState<string>("");

  const permissionText = useMemo(() => {
    if (typeof window === "undefined") return "";
    if (notifPermission === "unsupported") return "Browser tidak mendukung Notification API.";
    if (notifPermission === "granted") return "Diizinkan";
    if (notifPermission === "denied") return "Diblokir";
    return "Belum diminta";
  }, [notifPermission]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const refreshPermission = () => {
      if (!("Notification" in window)) {
        setNotifPermission("unsupported");
        return;
      }
      setNotifPermission(Notification.permission);
    };

    refreshPermission();

    const onFocus = () => refreshPermission();
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshPermission();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    setPrefs(readNotificationPrefs());
  }, []);

  useEffect(() => {
    void writeNotificationPrefs(prefs);
  }, [prefs]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const supported =
      "Notification" in window &&
      "serviceWorker" in navigator &&
      "PushManager" in window;

    if (!supported) {
      setPushStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setPushStatus("blocked");
      return;
    }

    // If permission is granted, check whether the device is already subscribed.
    // This prevents showing "Belum aktif" when the user already enabled push.
    const run = async () => {
      try {
        if (Notification.permission !== "granted") {
          setPushStatus("ready");
          return;
        }

        const registration = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
        await registration.update().catch(() => undefined);
        const existing = await registration.pushManager.getSubscription();
        if (!existing) {
          setPushStatus("ready");
          return;
        }

        // Best-effort: ensure backend knows this device subscription.
        const res = await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(existing),
        });

        if (!res.ok) {
          setPushStatus("error");
          setPushMessage(`Push aktif, tapi gagal sinkron ke server (HTTP ${res.status}).`);
          return;
        }

        setPrefs((prev) => ({ ...prev, enabled: true }));
        setPushStatus("subscribed");
        setPushMessage("Push sudah aktif di perangkat ini.");
      } catch {
        setPushStatus("ready");
      }
    };

    void run();
  }, []);

  async function requestPermission() {
    if (!("Notification" in window)) {
      setNotifPermission("unsupported");
      return;
    }

    try {
      const result = await Notification.requestPermission();
      setNotifPermission(result);
      if (result === "granted") {
        setPrefs((prev) => ({ ...prev, enabled: true }));
        // Permission granted but not necessarily subscribed yet.
        if (pushStatus !== "subscribed") setPushStatus("ready");
      } else if (result === "denied") {
        setPushStatus("blocked");
      }
    } catch {
      // ignore
    }
  }

  function urlBase64ToUint8Array(base64String: string) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
      .replace(/\-/g, "+")
      .replace(/_/g, "/");

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; i++) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  async function enablePush() {
    setPushMessage("");
    try {
      if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        setPushStatus("unsupported");
        return;
      }

      const permission = await Notification.requestPermission();
      setNotifPermission(permission);
      if (permission !== "granted") {
        setPushStatus(permission === "denied" ? "blocked" : "ready");
        setPushMessage("Izin notifikasi belum diberikan.");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
      await registration.update().catch(() => undefined);
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        const res = await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(existing),
        });

        if (!res.ok) {
          setPushStatus("error");
          setPushMessage(`Push aktif, tapi gagal sinkron ke server (HTTP ${res.status}).`);
          return;
        }

        setPrefs((prev) => ({ ...prev, enabled: true }));
        setPushStatus("subscribed");
        setPushMessage("Push sudah aktif di perangkat ini.");
        return;
      }

      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) {
        setPushStatus("error");
        setPushMessage("VAPID public key belum dikonfigurasi.");
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
        setPushStatus("error");
        setPushMessage(`Gagal simpan subscription (HTTP ${res.status}).`);
        return;
      }

      setPrefs((prev) => ({ ...prev, enabled: true }));
      setPushStatus("subscribed");
      setPushMessage("Push berhasil diaktifkan.");
    } catch {
      setPushStatus("error");
      setPushMessage("Gagal mengaktifkan push.");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
          Settings
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Pengaturan notifikasi per perangkat (tanpa login).
        </p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900 sm:p-6">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                Status permission
              </p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {permissionText}
              </p>
            </div>
            <button
              type="button"
              onClick={requestPermission}
              className="inline-flex items-center justify-center rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white shadow-theme-xs hover:bg-brand-600"
            >
              Minta izin
            </button>
          </div>

          <div className="h-px w-full bg-gray-200 dark:bg-gray-800" />

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                Aktifkan notifikasi
              </p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Jika dimatikan, perangkat tidak akan menerima notifikasi.
              </p>
            </div>
            <Checkbox
              checked={prefs.enabled}
              onChange={(enabled) => setPrefs((prev) => ({ ...prev, enabled }))}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                Update dashboard
              </p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Notifikasi saat ada pembaruan dashboard/data.
              </p>
            </div>
            <Checkbox
              checked={prefs.enabled && prefs.updates}
              disabled={!prefs.enabled}
              onChange={(updates) => setPrefs((prev) => ({ ...prev, updates }))}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                Alert penting
              </p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Notifikasi alert.
              </p>
            </div>
            <Checkbox
              checked={prefs.enabled && prefs.alerts}
              disabled={!prefs.enabled}
              onChange={(alerts) => setPrefs((prev) => ({ ...prev, alerts }))}
            />
          </div>

          <div className="h-px w-full bg-gray-200 dark:bg-gray-800" />

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                Quiet hours
              </p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Nonaktifkan notifikasi pada jam tertentu (WIT).
              </p>
            </div>
            <Checkbox
              checked={prefs.quietHoursEnabled}
              onChange={(quietHoursEnabled) =>
                setPrefs((prev) => ({ ...prev, quietHoursEnabled }))
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-sm text-gray-600 dark:text-gray-400">Mulai</span>
              <input
                type="time"
                value={prefs.quietHoursStart}
                disabled={!prefs.quietHoursEnabled}
                onChange={(event) =>
                  setPrefs((prev) => ({
                    ...prev,
                    quietHoursStart: event.target.value,
                  }))
                }
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-theme-xs dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-sm text-gray-600 dark:text-gray-400">Selesai</span>
              <input
                type="time"
                value={prefs.quietHoursEnd}
                disabled={!prefs.quietHoursEnabled}
                onChange={(event) =>
                  setPrefs((prev) => ({
                    ...prev,
                    quietHoursEnd: event.target.value,
                  }))
                }
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-theme-xs dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              />
            </label>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-800 dark:text-white/90">
              Push notification
            </h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Status: {pushStatus === "subscribed" ? "Aktif" : pushStatus === "blocked" ? "Diblokir" : pushStatus === "unsupported" ? "Tidak didukung" : "Belum aktif"}
            </p>
            {pushMessage ? (
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {pushMessage}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={enablePush}
            disabled={pushStatus === "unsupported" || pushStatus === "blocked"}
            className="inline-flex items-center justify-center rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white shadow-theme-xs hover:bg-brand-600 disabled:opacity-50"
          >
            Aktifkan push
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-800 dark:text-white/90">
              Riwayat notifikasi
            </h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Lihat notifikasi yang pernah dikirim ke perangkat ini.
            </p>
          </div>
          <Link
            href="/notifications"
            className="inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-theme-xs hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            Buka
          </Link>
        </div>
      </div>

      <PwaInstallInstructions />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-800 dark:text-white/90">
              Tutorial aplikasi
            </h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Pelajari cara menggunakan MALIKA dengan panduan interaktif.
            </p>
          </div>
          <StartTourButton />
        </div>
      </div>
    </div>
  );
}
