"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import type { NotificationItem } from "@/lib/notifications.data";
import { clearAppBadgeSafe, maxNotificationCreatedAt, setLastSeenNotificationAt } from "@/lib/notifications.unread";
import { BellIcon, DocsIcon, PieChartIcon } from "@/icons";
import LoadingProgressBar from "@/components/LoadingProgressBar";

export default function NotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/notifications?limit=200", { cache: "no-store" });
        const data = (await res.json()) as { items?: NotificationItem[] };
        if (cancelled) return;
        const nextItems = Array.isArray(data.items) ? data.items : [];
        setItems(nextItems);
        const maxAt = maxNotificationCreatedAt(nextItems);
        if (maxAt) setLastSeenNotificationAt(maxAt);
        clearAppBadgeSafe();
        setLoading(false);
      } catch {
        if (cancelled) return;
        setItems([]);
        setLoading(false);
      }
    };
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
            Notifications
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Riwayat notifikasi yang pernah dikirim ke perangkat ini.
          </p>
        </div>
        <Link
          href="/settings"
          className="inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-theme-xs hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          Preferensi
        </Link>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900 sm:p-6">
        {loading ? (
          <LoadingProgressBar label="Loading" />
        ) : items.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Belum ada notifikasi.
          </p>
        ) : (
          <ul className="flex flex-col">
            {items.map((n) => (
            <li key={n.id}>
              <Link
                href={n.link || "/notifications"}
                className="flex gap-3 border-b border-gray-100 p-3 px-4.5 py-3 last:border-b-0 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-white/5"
              >
                <span className="relative block h-11 w-full max-w-11 rounded-full">
                  <span
                    className={
                      "flex h-11 w-11 items-center justify-center rounded-full p-1.5 " +
                      (n.category === "Publikasi"
                        ? "bg-success-50 text-success-500 dark:bg-success-500/[0.12] dark:text-success-400"
                        : n.category === "Berita Resmi Statistik"
                          ? "bg-warning-50 text-warning-500 dark:bg-warning-500/[0.12] dark:text-warning-400"
                          : n.category === "Data Statistik"
                            ? "bg-brand-50 text-brand-500 dark:bg-brand-500/[0.12] dark:text-brand-400"
                            : "bg-gray-100 text-gray-700 dark:bg-white/[0.05] dark:text-gray-200")
                    }
                  >
                    {n.category === "Publikasi" ? (
                      <DocsIcon className="block h-8 w-8 overflow-visible flex-shrink-0" />
                    ) : n.category === "Berita Resmi Statistik" ? (
                      <DocsIcon className="block h-8 w-8 overflow-visible flex-shrink-0" />
                    ) : n.category === "Data Statistik" ? (
                      <PieChartIcon className="block h-8 w-8 overflow-visible flex-shrink-0" />
                    ) : (
                      <BellIcon className="block h-8 w-8 overflow-visible flex-shrink-0" />
                    )}
                  </span>
                  <span
                    className={`absolute bottom-0 right-0 z-10 h-2.5 w-full max-w-2.5 rounded-full border-[1.5px] border-white dark:border-gray-900 ${n.statusDotClass}`}
                  ></span>
                </span>

                <span className="block">
                  <span className="mb-1.5 block space-x-1 text-theme-sm text-gray-500 dark:text-gray-400">
                    <span className="font-medium text-gray-800 dark:text-white/90">
                      {n.userName}
                    </span>
                    <span>{n.actionText}</span>
                  </span>

                  <span className="flex flex-wrap items-center gap-2 text-gray-500 text-theme-xs dark:text-gray-400">
                    <span className="inline-flex items-center rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300">
                      {n.category}
                    </span>
                    <span className="h-1 w-1 rounded-full bg-gray-400"></span>
                    <span>{n.timeAgo}</span>
                  </span>
                </span>
              </Link>
            </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
