"use client";

import { useEffect, useState } from "react";
import { getQueueState, subscribeQueueState } from "@/lib/offlineQueue";

export default function PwaOfflineIndicator() {
  const [isOnline, setIsOnline] = useState(true);
  const [queueSize, setQueueSize] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (typeof navigator !== "undefined") {
      setIsOnline(navigator.onLine);
    }
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    const initial = getQueueState();
    setQueueSize(initial.size);
    setSyncing(initial.syncing);
    return subscribeQueueState((state) => {
      setQueueSize(state.size);
      setSyncing(state.syncing);
    });
  }, []);

  if (isOnline && queueSize === 0 && !syncing) return null;

  const label = !isOnline
    ? "Anda sedang offline. Perubahan akan disinkronkan saat online."
    : syncing
      ? "Menyinkronkan perubahan yang tertunda..."
      : queueSize > 0
        ? `${queueSize} aksi menunggu sinkronisasi.`
        : "";

  return (
    <div className="fixed bottom-4 left-1/2 z-[9999] -translate-x-1/2 rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700 shadow-theme-xs dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
      {label}
    </div>
  );
}
