"use client";

import React, { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { ChatProcessProvider } from "@/context/ChatProcessContext";
import { useChatModal } from "@/context/ChatModalContext";

// The chat surface itself is untouched — the same 2,000-line client the /chat
// route renders, hosted in a dialog rather than rebuilt against the mockup.
// Loaded on open so its charting and PDF dependencies stay out of every other
// page's bundle.
const ChatPageClient = dynamic(() => import("@/app/(admin)/chat/ChatPageClient"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-300 border-t-brand-600" />
      <span className="sr-only">Memuat chat…</span>
    </div>
  ),
});

import "@/app/(admin)/chat/chatui-overrides.css";
import "@/components/chat/assistant-ui.css";

export default function ChatModal() {
  const ctx = useChatModal();
  const open = ctx?.open ?? false;
  const closeChat = ctx?.closeChat;
  const carriedDraft = ctx?.carriedDraft ?? "";

  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  const onClose = useCallback(() => closeChat?.(), [closeChat]);

  useEffect(() => {
    if (!open) return;

    restoreRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Chat has its own Escape binding for cancelling dictation; only close
        // the dialog when nothing inside claimed the key first.
        if (e.defaultPrevented) return;
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    const raf = requestAnimationFrame(() => closeRef.current?.focus());

    return () => {
      document.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf);
      document.body.style.overflow = previousOverflow;
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  /*
   * The carried question is handed to the chat surface as a prop and sent by
   * its own machinery — the same path the sample-query cards use, which
   * creates a thread and fires the message once it lands.
   *
   * An earlier attempt wrote the text straight into the composer instead. That
   * only ever put it there: the composer is disabled until a thread exists, so
   * with no thread nothing was seeded at all, and even when it was the reader
   * still had to press send. Opening chat with a question in hand should
   * answer it.
   */
  const question = open ? carriedDraft : "";

  if (!open || typeof document === "undefined") return null;

  const overlay = (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center bg-gray-900/45 p-0 backdrop-blur-[2px] md:p-6"
      onMouseDown={(e) => {
        // Only a click that starts on the scrim closes: a text selection that
        // ends outside the panel must not dismiss a conversation.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Chat MALIKA"
        className="relative flex h-full w-full max-w-[1240px] flex-col overflow-hidden bg-white shadow-2xl dark:bg-gray-900 md:h-[min(860px,calc(100vh-48px))] md:rounded-2xl"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800 md:px-5">
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-gray-900 dark:text-white">
              Chat MALIKA
            </div>
            <div className="truncate text-[11.5px] text-gray-500 dark:text-gray-400">
              Asisten data BPS Maluku Utara
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
            </svg>
          </button>
        </div>

        {/*
         * `relative` and a definite height because the chat surface pins its
         * composer to the bottom of its container; in an auto-height box it
         * would collapse to the height of the transcript.
         */}
        {question && (
          <div className="shrink-0 border-b border-brand-100 bg-brand-50 px-4 py-2 text-[12px] text-brand-700 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-300 md:px-5">
            Lanjutan dari kotak tanya di halaman.
          </div>
        )}

        <div className="relative min-h-0 flex-1">
          <ChatProcessProvider>
            <ChatPageClient initialQuestion={question} />
          </ChatProcessProvider>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
