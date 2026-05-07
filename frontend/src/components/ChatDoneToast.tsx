"use client";

import { useEffect, useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useChatProcess } from "@/context/ChatProcessContext";
import MalikaAvatar from "@/components/MalikaAvatar";

/**
 * ChatDoneToast — shown when MALIKA finishes a response while user is on another page.
 * Renders a fixed bottom-right toast that auto-dismisses after 6 seconds.
 * Clicking takes the user back to /chat.
 */
export default function ChatDoneToast() {
  const pathname = usePathname();
  const router = useRouter();
  const { lastCompletedPreview, completedAt, clearCompletion } = useChatProcess();
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!completedAt || !lastCompletedPreview) return;
    // Only show toast if user is NOT on /chat
    // Don't clear completion here — ChatPageClient will handle it when it mounts
    if (pathname === "/chat") {
      setVisible(false);
      return;
    }
    setLeaving(false);
    setVisible(true);

    // Auto-dismiss after 6s — only hide the toast, don't clear completion state
    // (completion state is cleared by ChatPageClient when it loads the messages)
    const timer = setTimeout(() => {
      setLeaving(true);
      setTimeout(() => {
        setVisible(false);
      }, 300);
    }, 6000);

    return () => clearTimeout(timer);
  }, [completedAt, lastCompletedPreview, pathname]);

  const handleClick = useCallback(() => {
    setLeaving(true);
    setTimeout(() => {
      setVisible(false);
      // Don't clearCompletion — ChatPageClient will read it and refresh messages
      router.push("/chat");
    }, 150);
  }, [router]);

  const handleDismiss = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setLeaving(true);
    setTimeout(() => {
      setVisible(false);
      // User explicitly dismissed — clear the completion state
      clearCompletion();
    }, 300);
  }, [clearCompletion]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      onClick={handleClick}
      className={`fixed bottom-20 right-4 z-[99999] max-w-xs cursor-pointer rounded-2xl border border-brand-100 bg-white/95 p-3.5 shadow-xl shadow-brand-500/10 backdrop-blur-lg transition-all duration-300 dark:border-brand-800/50 dark:bg-gray-900/95 dark:shadow-brand-500/5 lg:bottom-6 lg:right-6 ${
        leaving ? "translate-y-2 opacity-0" : "translate-y-0 opacity-100"
      }`}
      style={{ animation: leaving ? "none" : "slideUpFade 0.3s ease-out" }}
    >
      <div className="flex items-start gap-3">
        {/* MALIKA orb avatar */}
        <MalikaAvatar size={40} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-gray-800 dark:text-gray-100">MALIKA selesai</p>
          <p className="mt-0.5 truncate text-[12px] leading-snug text-gray-500 dark:text-gray-400">
            {lastCompletedPreview}
          </p>
          <p className="mt-1 text-[11px] font-medium text-brand-500">Ketuk untuk lihat →</p>
        </div>
        {/* Dismiss button */}
        <button
          type="button"
          onClick={handleDismiss}
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          aria-label="Tutup notifikasi"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
