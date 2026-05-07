"use client";

import AnimatedLogo from "@/components/AnimatedLogo";
import OrbAnimatedLogo from "@/components/OrbAnimatedLogo";

/**
 * AssistantThread - Chat UI components using @assistant-ui/react
 * 
 * These components provide the visual layer for the MALIKA chat.
 * They use assistant-ui primitives but styled to match the existing design.
 * 
 * Key benefits over @chatui/core:
 * - Better iOS Safari scrolling support (uses absolute positioning)
 * - Built-in auto-scrolling and accessibility
 * - Composable primitive architecture
 */

import {
  ThreadPrimitive,
} from "@assistant-ui/react";
import React, { forwardRef, memo, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { LightningIcon, LightbulbIcon, RetryIcon, ChevronRightIcon } from "@/components/chat/icons";

/**
 * Main Thread Container
 * Uses absolute positioning for reliable iOS Safari scrolling
 */
export const MalikaThread = forwardRef<
  HTMLDivElement,
  { children?: ReactNode; className?: string; footer?: ReactNode }
>(({ className, children, footer }, ref) => {
  return (
    <ThreadPrimitive.Root
      ref={ref}
      className={cn(
        "malika-thread flex h-full flex-col bg-white dark:bg-gray-900",
        className
      )}
    >
      <ThreadPrimitive.Viewport className="malika-viewport flex-1 overflow-y-auto scroll-smooth">
        {children}
        <MalikaScrollToBottom />
      </ThreadPrimitive.Viewport>
      {footer}
    </ThreadPrimitive.Root>
  );
});
MalikaThread.displayName = "MalikaThread";

/**
 * Message List Wrapper
 * Contains all messages with proper spacing.
 */
export const MalikaMessages = ({ children }: { children?: ReactNode }) => {
  return (
    <div className="malika-messages flex flex-col gap-3 px-4 py-4">
      {children}
    </div>
  );
};

/**
 * User Message Bubble
 * Right-aligned with brand color background
 */
export const MalikaUserMessage = forwardRef<
  HTMLDivElement,
  {
    children?: ReactNode;
    className?: string;
    hasTime?: boolean;
    createdAt?: number;
    onEdit?: () => void;
    isEditing?: boolean;
    editingText?: string;
    onEditChange?: (text: string) => void;
    onEditSave?: () => void;
    onEditCancel?: () => void;
  }
>(({ className, children, hasTime, createdAt, onEdit, isEditing, editingText, onEditChange, onEditSave, onEditCancel }, ref) => {
  // Auto-resize textarea when editing
  const textareaRef = useCallback((node: HTMLTextAreaElement | null) => {
    if (node) {
      node.style.height = "auto";
      node.style.height = node.scrollHeight + "px";
      node.focus();
      // Move cursor to end
      node.setSelectionRange(node.value.length, node.value.length);
    }
  }, []);

  return (
    <div
      ref={ref}
      className={cn("malika-user-message group/user flex w-full justify-end", className)}
    >
      {/* Edit button — appears on hover, left of bubble */}
      {onEdit && !isEditing && (
        <button
          type="button"
          onClick={onEdit}
          className="mr-1.5 mt-2 flex h-7 w-7 shrink-0 items-center justify-center self-start rounded-full text-gray-400 opacity-100 lg:opacity-0 transition-all hover:bg-gray-100 hover:text-gray-600 lg:group-hover/user:opacity-100 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          title="Edit pesan"
          aria-label="Edit pesan"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
      )}
      <div className={cn("max-w-[min(85%,520px)]", isEditing && "w-full max-w-[min(90%,600px)]")}>
        {isEditing ? (
          /* Inline edit mode — textarea + Save/Cancel */
          <div className="rounded-2xl border-2 border-brand-400 bg-white px-3 py-2.5 shadow-sm dark:border-brand-600 dark:bg-gray-800">
            <textarea
              ref={textareaRef}
              value={editingText || ""}
              onChange={(e) => {
                onEditChange?.(e.target.value);
                // Auto-resize
                e.target.style.height = "auto";
                e.target.style.height = e.target.scrollHeight + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onEditSave?.();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  onEditCancel?.();
                }
              }}
              className="w-full resize-none bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400 dark:text-white dark:placeholder:text-gray-500"
              rows={1}
              placeholder="Edit pesan..."
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onEditCancel}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={onEditSave}
                disabled={!editingText?.trim()}
                className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Kirim
              </button>
            </div>
          </div>
        ) : (
          /* Normal display mode */
          <>
            <div className="rounded-[20px] bg-gradient-to-br from-brand-500 to-brand-600 px-4 py-3 text-white shadow-md shadow-brand-500/20 dark:from-brand-500 dark:to-brand-700 dark:shadow-brand-900/30 [&_.Bubble]:bg-transparent [&_.Bubble]:p-0 [&_.Bubble]:text-inherit">
              {children}
            </div>
            {hasTime && createdAt && (
              <div className="mt-1 text-right text-[11px] text-gray-400 dark:text-gray-500">
                {new Date(createdAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
});
MalikaUserMessage.displayName = "MalikaUserMessage";

/**
 * Assistant Message Bubble
 * Left-aligned with gray background
 */
export const MalikaAssistantMessage = forwardRef<
  HTMLDivElement,
  { children?: ReactNode; className?: string; showFeedback?: boolean; hasTime?: boolean; createdAt?: number; copyText?: string; responseTimeMs?: number; onRegenerate?: () => void; isRegenerating?: boolean; modelLabel?: string | null; tokenInfo?: { input: number; output: number; reasoning: number; total: number } | null; variant?: "bubble" | "panel" }
>(({ className, children, hasTime, createdAt, copyText, responseTimeMs, onRegenerate, isRegenerating, modelLabel, tokenInfo, variant = "bubble" }, ref) => {
  const [copied, setCopied] = useState(false);
  const isPanel = variant === "panel";

  const handleCopy = useCallback(() => {
    if (!copyText) return;
    navigator.clipboard.writeText(copyText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, [copyText]);

  return (
    <div
      ref={ref}
      className={cn("malika-assistant-message group flex w-full justify-start gap-2", className)}
    >
      {/* MALIKA bot avatar — hidden for panel variant */}
      {!isPanel ? (
        <div className="flex-shrink-0 mt-0.5" style={{ width: 48, height: 48 }}>
          <OrbAnimatedLogo size={22} orbSize={48} />
        </div>
      ) : (
        <div className="w-10 flex-shrink-0" /> /* spacer to align with bubble above */
      )}
      <div className="max-w-[min(85%,520px)]">
        <div className={isPanel
          ? "overflow-hidden rounded-xl border border-gray-200/80 bg-gradient-to-b from-gray-50/80 to-white px-4 py-3 text-gray-900 shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:border-gray-700/40 dark:from-gray-800/60 dark:to-gray-850/40 dark:text-white"
          : "overflow-hidden rounded-[20px] border border-gray-100 bg-white px-4 py-3 text-gray-900 shadow-sm dark:border-gray-700/50 dark:bg-gray-800 dark:text-white dark:shadow-none"
        }>
          {isPanel && (
            <div className="flex items-center gap-1.5 mb-2 pb-1.5 border-b border-gray-100 dark:border-gray-700/40">
              <svg className="h-3.5 w-3.5 text-brand-500 dark:text-brand-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Referensi & Data serta Kontak</span>
            </div>
          )}
          {children}
        </div>
        <div className="mt-1 flex items-center gap-2">
          {hasTime && createdAt && (
            <span className="text-[11px] text-gray-500 dark:text-gray-400">
              {new Date(createdAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          {responseTimeMs != null && responseTimeMs > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] tabular-nums text-gray-400 dark:text-gray-500" title={`Waktu respons: ${(responseTimeMs / 1000).toFixed(1)}s`}>
              <LightningIcon className="h-2.5 w-2.5" />
              {responseTimeMs < 1000 ? '<1s' : responseTimeMs < 60000 ? `${(responseTimeMs / 1000).toFixed(1)}s` : `${Math.floor(responseTimeMs / 60000)}m ${Math.round((responseTimeMs % 60000) / 1000)}s`}
            </span>
          )}
          {modelLabel && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                modelLabel === 'MALIKA Deep'
                  ? 'bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300'
                  : 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300'
              }`}
              title={tokenInfo ? `Input: ${tokenInfo.input} · Output: ${tokenInfo.output}${tokenInfo.reasoning > 0 ? ` · Reasoning: ${tokenInfo.reasoning}` : ''} · Total: ${tokenInfo.total} token` : undefined}
            >
              {modelLabel === 'MALIKA Deep' ? (
                <LightbulbIcon className="h-2.5 w-2.5" fill="currentColor" />
              ) : (
                <LightningIcon className="h-2.5 w-2.5" fill="currentColor" />
              )}
              {modelLabel}
            </span>
          )}
          {tokenInfo && tokenInfo.total > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[9px] tabular-nums text-gray-400 dark:text-gray-500" title={`Input: ${tokenInfo.input} · Output: ${tokenInfo.output}${tokenInfo.reasoning > 0 ? ` · Reasoning: ${tokenInfo.reasoning}` : ''}`}>
              <svg className="h-2.5 w-2.5" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 1.5a5.5 5.5 0 110 11 5.5 5.5 0 010-11zM7.25 4v4.5l3.25 1.94.75-1.22-2.5-1.5V4h-1.5z"/></svg>
              {tokenInfo.total >= 1000 ? `${(tokenInfo.total / 1000).toFixed(1)}k` : tokenInfo.total} tok
            </span>
          )}
          {copyText && !onRegenerate && (
            <button
              type="button"
              onClick={handleCopy}
              className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity text-[11px] text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 px-1.5 py-0.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
              title="Salin teks"
            >
              {copied ? "✅ Disalin!" : "📋 Salin"}
            </button>
          )}
          {onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              disabled={isRegenerating}
              className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-600 transition-all hover:bg-brand-100 active:scale-95 disabled:opacity-50 dark:border-brand-800 dark:bg-brand-950/40 dark:text-brand-400 dark:hover:bg-brand-900/50"
              title="Coba kirim ulang"
            >
              {isRegenerating ? (
                <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : (
                <RetryIcon className="h-3 w-3" />
              )}
              <span>{isRegenerating ? "Mengirim..." : "Coba lagi"}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
MalikaAssistantMessage.displayName = "MalikaAssistantMessage";

/**
 * System Message (date separators, etc.)
 * Centered with subtle styling.
 * Wrapped in memo — children is always a string, so shallow compare is effective.
 */
export const MalikaSystemMessage = memo(forwardRef<
  HTMLDivElement,
  { children?: ReactNode; className?: string }
>(({ className, children }, ref) => {
  return (
    <div
      ref={ref}
      className={cn("malika-system-message flex w-full justify-center py-2", className)}
    >
      <span className="rounded-full bg-gray-100/80 px-3.5 py-1 text-[11px] font-medium text-gray-400 dark:bg-gray-800/60 dark:text-gray-500">
        {children}
      </span>
    </div>
  );
}));
MalikaSystemMessage.displayName = "MalikaSystemMessage";

/**
 * Typing Indicator
 * Animated bouncing dots
 */
export const MalikaTypingIndicator = () => {
  return (
    <div className="flex items-center gap-1.5 px-1 py-1" role="status" aria-label="Sedang mengetik">
      <div className="malika-dot h-2 w-2 rounded-full bg-brand-500" style={{ animationDelay: "0s" }} />
      <div className="malika-dot h-2 w-2 rounded-full bg-brand-500" style={{ animationDelay: "0.15s" }} />
      <div className="malika-dot h-2 w-2 rounded-full bg-brand-500" style={{ animationDelay: "0.3s" }} />
    </div>
  );
};

/**
 * Thinking Bubble with Status Text
 * Shows animated dots with the real status from the backend pipeline.
 * Backend sends real status events within ~200ms, so no fake cycling needed.
 */
export const MalikaThinkingBubble = ({
  status,
  thinkingLevel,
  showDots = true,
}: {
  status?: string;
  thinkingLevel?: string;
  showDots?: boolean;
}) => {
  const displayStatus = status || "Berpikir...";

  // Thinking level descriptor for analytical/comprehensive
  const levelDescriptor = thinkingLevel === "comprehensive"
    ? "Analisis komprehensif"
    : thinkingLevel === "analytical"
    ? "Analisis mendalam"
    : null;

  return (
    <div
      className="malika-thinking-bubble malika-thinking-container"
      role="status"
      aria-live="polite"
      aria-label={displayStatus}
    >
      {showDots && (
        <div className="flex items-center gap-1.5">
          <div className="malika-dot h-2 w-2 rounded-full bg-brand-500" style={{ animationDelay: "0s" }} />
          <div className="malika-dot h-2 w-2 rounded-full bg-brand-500" style={{ animationDelay: "0.15s" }} />
          <div className="malika-dot h-2 w-2 rounded-full bg-brand-500" style={{ animationDelay: "0.3s" }} />
        </div>
      )}
      <div className="flex flex-col">
        <span className="malika-status-text" key={displayStatus}>
          {displayStatus}
        </span>
        {levelDescriptor && (
          <span className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
            {levelDescriptor}
          </span>
        )}
      </div>
    </div>
  );
};

/**
 * Error Bubble with Retry
 * Shows error message with retry and dismiss actions
 */
export const MalikaErrorBubble = ({
  error,
  errorType,
  onRetry,
  onDismiss,
  isRetrying = false,
}: {
  error: string;
  errorType?: "network" | "timeout" | "server" | "unknown";
  onRetry?: () => void;
  onDismiss?: () => void;
  isRetrying?: boolean;
}) => {
  // Get user-friendly error message based on type
  const getErrorMessage = () => {
    switch (errorType) {
      case "network":
        return "Koneksi internet terputus atau server tidak dapat dijangkau. Periksa koneksi Anda dan coba lagi.";
      case "timeout":
        return "Permintaan terputus setelah menunggu terlalu lama. Server mungkin sedang sibuk — silakan coba lagi.";
      case "server":
        return "Server sedang mengalami gangguan sementara. Silakan tunggu beberapa saat lalu coba lagi.";
      default:
        return error || "Maaf, terjadi kendala saat memproses pesan Anda.";
    }
  };

  return (
    <div className="malika-error-bubble" role="alert">
      <div className="flex items-start gap-2">
        <svg className="h-4 w-4 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
        </svg>
        <span className="text-sm">{getErrorMessage()}</span>
      </div>
      {(onRetry || onDismiss) && (
        <div className="malika-error-actions">
          {onRetry && (
            <button
              type="button"
              className="malika-retry-btn"
              onClick={onRetry}
              disabled={isRetrying}
              aria-label="Coba lagi"
            >
              {isRetrying ? (
                <>
                  <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Mengirim...</span>
                </>
              ) : (
                <>
                  <RetryIcon className="h-3 w-3" />
                  <span>Coba lagi</span>
                </>
              )}
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              className="malika-dismiss-btn"
              onClick={onDismiss}
              aria-label="Tutup"
            >
              Tutup
            </button>
          )}
        </div>
      )}
    </div>
  );
};

/* MalikaThinkingSection removed — replaced by UnifiedActivityFeed */

/* MalikaComposer removed — ChatPageClient uses its own inline composer */

/**
 * Quick Replies
 * Horizontal scrollable suggestion chips
 */
export const MalikaQuickReplies = ({
  items,
  onSelect,
  visible = true,
  loading = false,
}: {
  items: Array<{ name: string; icon?: string }>;
  onSelect: (item: { name: string }) => void;
  visible?: boolean;
  loading?: boolean;
}) => {
  if (!visible || (!items.length && !loading)) return null;

  return (
    <div
      className="malika-quick-replies flex gap-2 overflow-x-auto bg-white/80 px-4 py-2.5 backdrop-blur-sm dark:bg-gray-900/80"
      role="menu"
      aria-label="Saran pertanyaan"
    >
      {loading && items.length === 0 ? (
        /* Skeleton chips while LLM suggestions are loading */
        <>
          {[1, 2, 3].map((i) => (
            <div
              key={`skeleton-${i}`}
              className="inline-flex shrink-0 animate-pulse items-center gap-1.5 rounded-full border border-gray-200 bg-gray-100 px-3 py-1.5 dark:border-gray-700 dark:bg-gray-800"
            >
              <div className="h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-600" />
              <div
                className="h-3.5 rounded bg-gray-300 dark:bg-gray-600"
                style={{ width: `${60 + i * 20}px` }}
              />
            </div>
          ))}
          <span className="flex shrink-0 items-center text-xs text-gray-400 dark:text-gray-500">
            Menyiapkan saran…
          </span>
        </>
      ) : (
        items.map((item, idx) => (
          <button
            key={idx}
            type="button"
            role="menuitem"
            onClick={() => onSelect(item)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-brand-200/60 bg-brand-50/80 px-3.5 py-2 text-[13px] font-medium text-brand-700 shadow-sm transition-all duration-150 hover:scale-[1.03] hover:bg-brand-100 hover:shadow-md active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:border-brand-800/50 dark:bg-brand-950/50 dark:text-brand-300 dark:hover:bg-brand-900/50"
          >
            {item.icon && <span aria-hidden="true">{item.icon}</span>}
            <span>{item.name}</span>
          </button>
        ))
      )}
    </div>
  );
};

/**
 * Scroll to Bottom Button
 * Pure implementation — detects scroll position on the nearest scrollable ancestor
 * and shows a floating button when user scrolls up.
 */
export const MalikaScrollToBottom = () => {
  const [visible, setVisible] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Find the closest scrollable ancestor (.malika-viewport)
    const viewport = btnRef.current?.closest(".malika-viewport") as HTMLElement | null;
    if (!viewport) return;

    const checkScroll = () => {
      const distFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      setVisible(distFromBottom > 120);
    };

    viewport.addEventListener("scroll", checkScroll, { passive: true });
    checkScroll();
    return () => viewport.removeEventListener("scroll", checkScroll);
  }, []);

  const scrollDown = useCallback(() => {
    const viewport = btnRef.current?.closest(".malika-viewport") as HTMLElement | null;
    if (viewport) viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
  }, []);

  if (!visible) return <button ref={btnRef} type="button" className="hidden" aria-hidden />;

  return (
    <button
      ref={btnRef}
      type="button"
      onClick={scrollDown}
      className="sticky bottom-4 left-1/2 -translate-x-1/2 z-10 rounded-full bg-white/90 p-2.5 shadow-lg ring-1 ring-black/5 backdrop-blur-sm transition-all hover:shadow-xl hover:scale-110 active:scale-95 dark:bg-gray-800/90 dark:ring-white/10"
      aria-label="Scroll ke bawah"
    >
      <svg className="h-4 w-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
    </button>
  );
};
