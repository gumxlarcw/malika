"use client";

import { useSyncExternalStore } from "react";
import { getQueueState, subscribeQueueState } from "@/lib/offlineQueue";

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

// Each snapshot returns a primitive, never the QueueState object: getQueueState
// builds a fresh object on every call, and useSyncExternalStore compares
// snapshots by identity, so returning it directly would re-render forever.
export default function PwaOfflineIndicator() {
  const isOnline = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  const queueSize = useSyncExternalStore(
    subscribeQueueState,
    () => getQueueState().size,
    () => 0,
  );
  const syncing = useSyncExternalStore(
    subscribeQueueState,
    () => getQueueState().syncing,
    () => false,
  );

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
