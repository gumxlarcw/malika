"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { applyTableRowOrdering } from "@/lib/tableRowOrdering";
import { CloseIcon } from "@/components/chat/icons";

// Types and utilities extracted for reusability
import type { Thread, BackendMessage, ChatUiMessage, MalikaUiMetaV1, ThinkingItem } from "@/types/chat";
import {
  toDayStartMs,
  fmtFullDateId,
  formatCellValue,
  decodeBasicEntities,
  sanitizeText,
  parseAbstractBullets,
  normalizeChatUiMessage,
  toCompactAssistantText,
  safeHref,
  extractMalikaUiBlock,
  fmtShortDateIso,
} from "@/lib/chatUtils";
import { useLocalMessages } from "@/hooks/useLocalMessages";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { useChatRating } from "@/hooks/useChatRating";
import { streamMessage, type StreamCallbacks } from "@/lib/chatTransport";
import { useChatProcess } from "@/context/ChatProcessContext";
import { MODEL_ALIASES, SAMPLE_QUERIES } from "@/lib/chatConstants";

// Assistant-UI components for mobile-friendly chat
import {
  MalikaThread,
  MalikaMessages,
  MalikaUserMessage,
  MalikaAssistantMessage,
  MalikaSystemMessage,
  MalikaErrorBubble,
  MalikaQuickReplies,
  // Extracted modular components
  KnowledgeModal,
  SourcesSection,
  DataSummaryBubble,
  CandidateSelector,
  KnowledgeCandidateSelector,
  ExternalSuggestionsSection,
  MessageFeedback,
  ThreadSkeleton,
  MessagesLoadingSkeleton,
} from "@/components/chat";

// Lazy-load modals — only fetched when user opens them
const ChatShortcutsModal = dynamic(() => import("@/components/chat/ChatShortcutsModal"), { ssr: false });
const ChatExportModal = dynamic(() => import("@/components/chat/ChatExportModal"), { ssr: false });
const ChatRatingModal = dynamic(() => import("@/components/chat/ChatRatingModal"), { ssr: false });
import { type ProcessStep } from "@/components/chat/UnifiedActivityFeed";
import { ThinkingFeed } from "@/components/chat/ThinkingFeed";
import { UnifiedThinkingCard } from "@/components/chat/UnifiedThinkingCard";
import DnaMetadataSection from "@/components/chat/DnaMetadataSection";

// Extracted helpers — renderMarkdown, BubbleText, TypingText, etc.
import {
  renderMarkdown,
  BubbleText,
  TypingText,
  TypingIndicator,
  IndonesianChatLocales,
  backendBaseUrl,
  safeRandomId,
  getOrCreateMalikaUid,
  getSearchHistory,
  addToSearchHistory,
} from "./chatHelpers";
// Lazy load ReactPdfPreview for PDF rendering
const ReactPdfPreview = dynamic(
  () => import("@/components/brs/ReactPdfPreview"),
  { ssr: false }
);

// renderMarkdown, BubbleText imported from ./chatHelpers
// Supports: [label](url), **bold**, *italic*, `code`, plain URLs, phone→WhatsApp, newlines

// TypingIndicator, TypingText, IndonesianChatLocales, backendBaseUrl,
// safeRandomId, getOrCreateMalikaUid, getSearchHistory, addToSearchHistory
// → all imported from ./chatHelpers above

/** Build a human-readable pipeline text line from a ThinkingItem step */
function buildPipelineLine(t: { step?: string; detail?: string; label?: string; count?: number; brsCount?: number; pubCount?: number }): string {
  if (!t.step || t.step === "thinking-delta" || t.step === "parse-error") return "";
  if (t.step === "query") { const topic = t.detail || t.label || ""; return topic ? `Mencari informasi tentang ${topic}...` : ""; }
  if (t.step === "sources") { const name = t.detail?.split("·")?.[0]?.trim() || ""; return `Ditemukan ${t.count || ""} sumber data${name ? `: ${name}` : ""}.`; }
  if (t.step === "knowledge") { const p: string[] = []; if (t.brsCount) p.push(`${t.brsCount} BRS`); if (t.pubCount) p.push(`${t.pubCount} Publikasi`); const title = t.detail?.slice(0, 60) || ""; return p.length ? `Memuat ${p.join(" dan ")} referensi${title ? `: ${title}...` : "."}` : ""; }
  if (t.step === "data") { const title = t.detail || ""; return `Memuat ${t.count || ""} baris data tabel${title ? `: ${title}` : ""}.`; }
  if (t.step === "reasoning") return "Menyusun konteks untuk analisis mendalam...";
  if (t.step === "strategy") return t.label ? `${t.label}.` : "";
  if (t.step === "orchestrator-sub") return t.label ? `Sub-analisis: ${t.label}` : "";
  return "";
}

export default function ChatPageClient({ initialQuestion }: { initialQuestion?: string } = {}) {
  const {
    startProcessing, finishProcessing,
    isChatProcessing, processingThreadId, processingStartedAt,
    completedAt, navigatedAway,
    markNavigatedAway, clearCompletion,
    processSteps, setProcessSteps,
    pushStep, pushStepDetail, markAllStepsDone, clearSteps,
    toolCalls, pushToolCall, pushToolResult, clearToolCalls,
  } = useChatProcess();
  const [malikaUid, setMalikaUid] = useState<string>("");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const loadMessagesAbortRef = useRef<AbortController | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  // Step list "Lihat detail" toggle — done steps hide under a collapse so the
  // long-running active step doesn't get crowded out visually
  const [stepsExpanded, setStepsExpanded] = useState(false);
  // Sample-query plumbing: when user clicks a category card from the
  // !activeThreadId empty state, we createThread() then auto-send this query.
  const pendingSampleQueryRef = useRef<string | null>(null);
  const [typingStatus, setTypingStatus] = useState<string | undefined>(undefined);
  const [wasStopped, setWasStopped] = useState(false);
  const stoppedMessageRef = useRef<string | null>(null);
  /** Tracks the current (unique per-message) streaming bubble ID so retry/dismiss/stop can find it */
  const currentStreamIdRef = useRef<string | null>(null);
  const [thinkingItems, setThinkingItems] = useState<ThinkingItem[]>([]);
  const [showThinking, setShowThinking] = useState(false);
  /** Batch buffer for incoming thinking events — flushed via rAF to reduce re-renders */
  const thinkingBatchRef = useRef<ThinkingItem[]>([]);
  const thinkingItemsRafRef = useRef<number | null>(null);
  /** Pipeline text: human-readable summary of pipeline steps */
  const [pipelineText, setPipelineText] = useState("");
  const pipelineTextRef = useRef("");
  const pipelineRafRef = useRef<number | null>(null);
  /** Extended Thinking: accumulated reasoning text from Claude's chain-of-thought */
  const [reasoningText, setReasoningText] = useState("");
  const [isThinkingActive, setIsThinkingActive] = useState(false);
  const reasoningBufferRef = useRef("");
  const reasoningRafRef = useRef<number | null>(null);

  // Single-lane (2026-05-16): only Sonnet. Clean stale dropdown selection from
  // pre-2026-05-16 visits — idempotent, safe to ship and re-ship.
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("malika_selected_model");
    }
  }, []);

  // Inline edit state — when user clicks pencil on their own message
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  // Pagination: show last N messages to keep DOM small for long conversations
  const [msgPageSize, setMsgPageSize] = useState(50);
  const MSG_PAGE_INCREMENT = 50;

  // Helper: derive user-facing model label from model ID — NEVER show raw model IDs
  const getModelLabel = useCallback((modelId?: string | null): string | null => {
    if (!modelId) return null;
    return MODEL_ALIASES[modelId] || null;
  }, []);
  const [isExporting, setIsExporting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<"network" | "timeout" | "server" | "unknown">("unknown");
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportJsonData, setExportJsonData] = useState<string>("");
  const [exportFilename, setExportFilename] = useState<string>("");
  const [copySuccess, setCopySuccess] = useState(false);
  const [lastAssistantUi, setLastAssistantUi] = useState<MalikaUiMetaV1 | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const suggestionsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const llmSuggestionsRef = useRef<string[] | null>(null);

  // Cleanup suggestionsTimeout on unmount to prevent state update on unmounted component
  useEffect(() => {
    return () => {
      if (suggestionsTimeoutRef.current) clearTimeout(suggestionsTimeoutRef.current);
    };
  }, []);

  // Auto-collapse thinking section after streaming ends (3s reading buffer)
  useEffect(() => {
    if (!isTyping && showThinking && thinkingItems.length > 0) {
      const t = setTimeout(() => setShowThinking(false), 3000);
      return () => clearTimeout(t);
    }
  }, [isTyping, showThinking, thinkingItems.length]);

  // Mounted guard — SSE callbacks can outlive the component
  const mountedRef = useRef(true);
  // Cleanup thinking rAFs on unmount to prevent setState on unmounted component
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (reasoningRafRef.current !== null) { cancelAnimationFrame(reasoningRafRef.current); reasoningRafRef.current = null; }
      if (pipelineRafRef.current !== null) { cancelAnimationFrame(pipelineRafRef.current); pipelineRafRef.current = null; }
      if (thinkingItemsRafRef.current !== null) { cancelAnimationFrame(thinkingItemsRafRef.current); thinkingItemsRafRef.current = null; }
    };
  }, []);
  
  // Mobile history drawer state
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false);
  // Thread pending deletion (confirm dialog)
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

  // Browser detection for conditional bottom spacing (Safari vs Chrome/others)
  const [isIOSSafari, setIsIOSSafari] = useState(false);
  useEffect(() => {
    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isSafari = /safari/i.test(ua) && !/chrome|chromium|crios|android/i.test(ua);
    setIsIOSSafari(isIOS || isSafari);
  }, []);
  
  // Rating via shared hook (triggered by "terima kasih")
  const {
    isOpen: ratingModalOpen,
    openRating,
    closeRating: closeRatingModal,
    stars: ratingStars,
    setStars: setRatingStars,
    review: ratingReview,
    setReview: setRatingReview,
    isSubmitting: ratingSubmitting,
    isSubmitted: ratingSubmitted,
    submitRating,
    isThankYouMessage,
    hasExistingFeedback,
    checkExistingFeedback,
    pendingThankYouRef,
  } = useChatRating();

  // Check existing feedback on mount
  useEffect(() => { checkExistingFeedback(); }, [checkExistingFeedback]);
  
  // Voice input via shared hook
  const { isSupported: voiceSupported, isListening, transcript: voiceTranscript, toggleVoiceInput, clearTranscript: clearVoiceTranscript } = useVoiceInput({
    onError: (msg) => setErrorText(msg),
  });
  
  // Offline state
  const [isOffline, setIsOffline] = useState(false);
  
  // Keyboard shortcuts modal state
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

  const { messages, resetList, appendMsg, updateMsg, removeMsg } = useLocalMessages([]);
  const activeThreadIdRef = useRef<number | null>(null);
  const threadsRef = useRef<Thread[]>([]);
  const pendingSendRef = useRef<AbortController | null>(null);
  const processStartRef = useRef<number>(Date.now());
  const userStoppedRef = useRef(false);
  // Persist response times across message list refreshes (keyed by threadId)
  const responseTimeRef = useRef<Map<number, number>>(new Map());

  const apiBase = useMemo(() => backendBaseUrl(), []);

  // Keep threadsRef in sync with threads state for use in closures
  useEffect(() => { threadsRef.current = threads; }, [threads]);

  // Detect online/offline status
  useEffect(() => {
    if (typeof window === "undefined") return;
    
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    
    // Set initial state
    setIsOffline(!navigator.onLine);
    
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const headers = useMemo(() => {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (malikaUid) h["x-malika-uid"] = malikaUid;
    return h;
  }, [malikaUid]);

  // Quick replies — fully LLM-driven, no hardcoded suggestions
  const quickReplies = useMemo(() => {
    const MAX_CHIPS = 5;

    if (!lastAssistantUi) {
      // New/empty chat — return empty so skeleton shows via suggestionsLoading
      return [];
    }

    // Use LLM/backend suggestions directly
    const suggestions = Array.isArray(lastAssistantUi.suggestions) ? lastAssistantUi.suggestions : [];
    const chips: { name: string }[] = [];

    for (const s of suggestions.slice(0, MAX_CHIPS)) {
      const text = String(s || "").trim();
      if (text && text.length >= 3 && text.length <= 60) {
        chips.push({ name: text });
      }
    }

    // Also include agent recommendations if available
    const recommendations = Array.isArray(lastAssistantUi.recommendations) ? lastAssistantUi.recommendations : [];
    for (const rec of recommendations.slice(0, 3)) {
      if (rec.queryHint && chips.length < MAX_CHIPS) {
        const text = String(rec.queryHint).trim();
        if (text && !chips.some(c => c.name.toLowerCase() === text.toLowerCase())) {
          chips.push({ name: text });
        }
      }
    }

    return chips.slice(0, MAX_CHIPS);
  }, [lastAssistantUi]);

  const mapBackendMessagesToChatUI = useCallback((rows: BackendMessage[]) => {
    const list: ChatUiMessage[] = [];
    let lastDayStart: number | null = null;
    const MODEL_ALIASES_MAP = MODEL_ALIASES;

    for (const m of rows) {
      if (m.role !== "user" && m.role !== "assistant") continue;

      const createdAtRaw = new Date(m.created_at).getTime();
      const createdAt = Number.isFinite(createdAtRaw) ? createdAtRaw : Date.now();
      const dayStart = toDayStartMs(createdAt);
      const position = m.role === "user" ? ("right" as const) : ("left" as const);

      // Insert a centered date separator when the day changes.
      if (dayStart !== lastDayStart) {
        list.push({
          _id: `day_${dayStart}`,
          type: "system",
          content: { text: fmtFullDateId(dayStart) },
          position: "center",
          createdAt: dayStart,
          hasTime: false,
        });
        lastDayStart = dayStart;
      }

      const pushMsg = (msg: ChatUiMessage) => {
        list.push({
          ...msg,
          createdAt,
          // Always show time below each bubble.
          hasTime: true,
        });
      };

      if (m.role !== "assistant") {
        pushMsg({
          _id: String(m.id),
          type: "text",
          content: { text: m.content },
          position,
        });
        continue;
      }

      const extracted = extractMalikaUiBlock(String(m.content || ""));
      if (!extracted.ui) {
        pushMsg({
          _id: String(m.id),
          type: "text",
          content: { text: m.content, responseTimeMs: m.latency_ms || undefined },
          position,
        });
        continue;
      }

      const ui = extracted.ui;

      // Check if we have table data from backend
      const hasBackendTableRows = Boolean(
        ui.table && ui.table.kind === "data" && Array.isArray(ui.table.rows) && ui.table.rows.length > 0
      ) || Boolean(
        ui.table2 && ui.table2.kind === "data" && Array.isArray(ui.table2.rows) && ui.table2.rows.length > 0
      );

      // Check for any content that belongs in the second bubble:
      // table data, datasource candidates, knowledge candidates, or external links
      const hasText = Boolean(extracted.text);
      const hasTableOrQuery = hasBackendTableRows || Boolean(ui.query);
      const hasKnowledge = Array.isArray(ui.knowledgeCandidates) && ui.knowledgeCandidates.length > 0;
      const hasExternalLinks = Array.isArray(ui.externalLinks) && (ui.externalLinks as any[]).length > 0;
      const hasCandidates = Array.isArray(ui.candidates) && ui.candidates.length > 0;
      const hasSecondBubble = hasTableOrQuery || hasKnowledge || hasExternalLinks || hasCandidates;

      // First, show the text interpretation if available
      if (hasText) {
        list.push({
          _id: `${m.id}_interpretation`,
          type: "text",
          content: { text: extracted.text, responseTimeMs: !hasSecondBubble ? (m.latency_ms || undefined) : undefined, modelLabel: MODEL_ALIASES_MAP[ui?.metadata?.model || ''] || null, tokenInfo: ui?.metadata?.tokens || null },
          position,
          createdAt,
          // Only show time if there's no second bubble following
          hasTime: !hasSecondBubble,
        });
      }

      // Then show the second bubble (table + referensi terkait + link eksternal)
      if (hasSecondBubble) {
        list.push({
          _id: `${m.id}_table`,
          type: "result_table",
          content: { ui, responseTimeMs: m.latency_ms || undefined, modelLabel: MODEL_ALIASES_MAP[ui?.metadata?.model || ''] || null, tokenInfo: ui?.metadata?.tokens || null },
          position,
          createdAt,
          // Always show time on the last part
          hasTime: true,
        });
      }
      
      // If neither text nor second bubble, show empty message (shouldn't happen normally)
      if (!hasText && !hasSecondBubble) {
        pushMsg({
          _id: String(m.id),
          type: "text",
          content: { text: m.content || "" },
          position,
        });
      }
    }

    return list;
  }, []);

  const extractLastAssistantUi = useCallback((rows: BackendMessage[], uiMessages?: ChatUiMessage[]) => {
    // Strip stored suggestions: pre-cleanup messages have hardcoded chips
    // ("Data penduduk", etc.) baked into their malika_ui blob. Always blank
    // them out — fresh chips come from the live /suggestions endpoint instead.
    const stripStoredSuggestions = (ui: any) => {
      if (!ui || typeof ui !== "object") return ui;
      // Shallow clone + force suggestions=[] so the skeleton stays visible
      // until fetchThreadSuggestions populates them.
      return { ...ui, suggestions: [] };
    };

    if (uiMessages?.length) {
      for (let i = uiMessages.length - 1; i >= 0; i -= 1) {
        const m = uiMessages[i];
        if (m.position === "left" && m.type === "result_table" && m.content?.ui) {
          return stripStoredSuggestions(m.content.ui);
        }
      }
    }
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const m = rows[i];
      if (!m || m.role !== "assistant") continue;
      const extracted = extractMalikaUiBlock(String(m.content || ""));
      if (extracted.ui) return stripStoredSuggestions(extracted.ui);
    }
    return null;
  }, []);

  const refreshMessagesSilently = useCallback(
    async (threadId: number) => {
      if (!malikaUid) return;
      try {
        const res = await fetch(`${apiBase}/threads/${threadId}/messages`, {
          method: "GET",
          headers,
        });
        const json = await res.json();
        if (!res.ok || !json?.ok) {
          return;
        }
        const rows = (json.messages || []) as BackendMessage[];
        const uiMsgs = mapBackendMessagesToChatUI(rows);
        resetList(uiMsgs);
        let dbUi = extractLastAssistantUi(rows, uiMsgs);
        // Preserve LLM suggestions if already received via SSE
        if (llmSuggestionsRef.current) {
          if (dbUi) {
            dbUi.suggestions = llmSuggestionsRef.current;
          } else {
            // Greeting or messages without embedded malika_ui block
            dbUi = { v: 1, suggestions: llmSuggestionsRef.current } as MalikaUiMetaV1;
          }
        }
        setLastAssistantUi(dbUi);
      } catch (err) {
        // Log refresh failures for debugging — don't break UX
        console.warn('[ChatRefresh] Silent refresh failed:', err);
      }
    },
    [apiBase, extractLastAssistantUi, headers, malikaUid, mapBackendMessagesToChatUI, resetList]
  );

  // Legacy loadThreads for refreshing thread list without reloading messages
  const loadThreads = useCallback(async () => {
    if (!malikaUid) return;
    setLoadingThreads(true);
    setErrorText(null);
    try {
      const res = await fetch(`${apiBase}/threads`, {
        method: "GET",
        headers,
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `HTTP_${res.status}`);
      }
      const list = (json.threads || []) as Thread[];
      setThreads(list);
      // Note: Don't auto-select first thread here - only done on initial mount
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingThreads(false);
    }
  }, [apiBase, headers, malikaUid]);

  const createThread = useCallback(async () => {
    if (!malikaUid) return;
    setErrorText(null);
    try {
      const res = await fetch(`${apiBase}/threads`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title: "Chat baru" }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `HTTP_${res.status}`);
      }
      const t = json.thread as Thread;
      setThreads((prev) => [t, ...prev]);
      setActiveThreadId(t.id);
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : String(e));
    }
  }, [apiBase, headers, malikaUid]);

  /** Delete a thread and cascade-remove messages, feedback, flags */
  const deleteThread = useCallback(async (threadId: number) => {
    if (!malikaUid) return;
    try {
      const res = await fetch(`${apiBase}/threads/${threadId}`, {
        method: "DELETE",
        headers,
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP_${res.status}`);
      setThreads((prev) => prev.filter((t) => t.id !== threadId));
      if (activeThreadId === threadId) {
        setActiveThreadId(null);
        resetList();
      }
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : String(e));
    }
  }, [activeThreadId, apiBase, headers, malikaUid, resetList]);

  /**
   * Fetch context-aware suggestions for a loaded thread.
   *
   * The backend returns 200 only when the LLM produced real chips; on
   * unavailable/error it returns 503. We retry on 503 with exponential
   * backoff (4 attempts, ~30s total) and KEEP the loading skeleton
   * visible the whole time — no hardcoded fallback chips. If all attempts
   * fail, loading stops and chip area stays empty.
   */
  const fetchThreadSuggestions = useCallback(
    async (threadId: number) => {
      if (!malikaUid) return;
      // Take ownership of the loading state — clear any short safety timeout
      // set elsewhere so retries get to run to completion.
      if (suggestionsTimeoutRef.current) {
        clearTimeout(suggestionsTimeoutRef.current);
        suggestionsTimeoutRef.current = null;
      }
      setSuggestionsLoading(true);

      const delays = [0, 3000, 8000, 15000]; // attempt offsets in ms
      for (let attempt = 0; attempt < delays.length; attempt++) {
        if (delays[attempt] > 0) {
          await new Promise((r) => setTimeout(r, delays[attempt]));
        }
        try {
          const res = await fetch(`${apiBase}/threads/${threadId}/suggestions`, {
            method: "GET",
            headers,
          });
          const json = await res.json().catch(() => null);
          if (res.ok && json?.ok && Array.isArray(json.suggestions) && json.suggestions.length > 0) {
            llmSuggestionsRef.current = json.suggestions;
            setLastAssistantUi((prev) => {
              if (!prev) return { v: 1, suggestions: json.suggestions } as MalikaUiMetaV1;
              return { ...prev, suggestions: json.suggestions };
            });
            setSuggestionsLoading(false);
            return;
          }
          // 503 / non-ok / empty → fall through to next retry
        } catch {
          // network error → fall through to next retry
        }
      }
      // All attempts exhausted — drop loading without hardcoded chips so the
      // UI shows the empty state rather than misleading defaults.
      setSuggestionsLoading(false);
    },
    [apiBase, headers, malikaUid]
  );

  const loadMessages = useCallback(
    async (threadId: number) => {
      if (!malikaUid) return;
      setLoadingMessages(true);
      setErrorText(null);
      setIsTyping(false);
      setLastAssistantUi(null); // Reset quick replies context when switching threads
      llmSuggestionsRef.current = null; // Clear stale LLM suggestions from previous thread
      setSuggestionsLoading(true); // Show skeleton immediately while loading
      setThinkingItems([]); // Clear thinking items from previous thread
      thinkingBatchRef.current = [];
      if (reasoningRafRef.current !== null) { cancelAnimationFrame(reasoningRafRef.current); reasoningRafRef.current = null; }
      if (pipelineRafRef.current !== null) { cancelAnimationFrame(pipelineRafRef.current); pipelineRafRef.current = null; }
      if (thinkingItemsRafRef.current !== null) { cancelAnimationFrame(thinkingItemsRafRef.current); thinkingItemsRafRef.current = null; }
      setShowThinking(false);
      setReasoningText(""); reasoningBufferRef.current = ""; setPipelineText(""); pipelineTextRef.current = ""; setIsThinkingActive(false);
      setEditingMessageId(null); // Clear inline edit when switching threads
      setEditingText("");
      setMsgPageSize(50); // Reset pagination when switching threads
      try {
        pendingSendRef.current?.abort();
      } catch {
        // ignore
      }
      pendingSendRef.current = null;
      // Abort any in-flight loadMessages fetch to prevent stale data overwrite
      if (loadMessagesAbortRef.current) loadMessagesAbortRef.current.abort();
      const loadAbort = new AbortController();
      loadMessagesAbortRef.current = loadAbort;
      // Note: We DON'T call resetList([]) here anymore to avoid flicker.
      // The skeleton overlay will show loading state, and messages will be replaced
      // atomically when the fetch completes.
      try {
        const res = await fetch(`${apiBase}/threads/${threadId}/messages`, {
          method: "GET",
          headers,
          signal: loadAbort.signal,
        });
        const json = await res.json();
        if (!res.ok || !json?.ok) {
          throw new Error(json?.error || `HTTP_${res.status}`);
        }
        const rows = (json.messages || []) as BackendMessage[];
        // P12: Guard against stale fetch — if user switched threads while fetching, discard
        if (activeThreadIdRef.current !== threadId) return;
        const uiMsgs = mapBackendMessagesToChatUI(rows);
        resetList(uiMsgs);
        const ui = extractLastAssistantUi(rows, uiMsgs);
        setLastAssistantUi(ui);

        // Restore persisted thinking items from saved uiMeta
        if (ui?.thinkingItems?.length) {
          setThinkingItems(ui.thinkingItems);
          // Restore reasoning content from persisted thinking items (historical)
          const reasoningItem = ui.thinkingItems.find((t: ThinkingItem) => t.step === "reasoning" && t.content);
          if (reasoningItem?.content) {
            setReasoningText(reasoningItem.content);
            reasoningBufferRef.current = reasoningItem.content;
          }
          // Rebuild pipelineText from persisted thinkingItems
          const rebuilt = ui.thinkingItems.map(buildPipelineLine).filter((l: string) => l.trim()).join("\n");
          if (rebuilt) {
            setPipelineText(rebuilt);
            pipelineTextRef.current = rebuilt;
          }
          setShowThinking(true);
        }

        // Fire-and-forget: chat surfaces immediately. The chip area shows
        // its own skeleton (driven by suggestionsLoading) while the LLM
        // endpoint runs in the background — see MalikaQuickReplies skeleton
        // chips at AssistantThread.tsx:489. Stored hardcoded chips are
        // already stripped in extractLastAssistantUi so nothing flashes
        // before the real chips arrive.
        if (rows.length > 0) {
          fetchThreadSuggestions(threadId);
        }
      } catch (e: any) {
        if (e?.name === "AbortError") return; // Aborted by newer loadMessages call
        setErrorText(e instanceof Error ? e.message : String(e));
        resetList([]);
      } finally {
        setLoadingMessages(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apiBase, extractLastAssistantUi, fetchThreadSuggestions, headers, malikaUid, mapBackendMessagesToChatUI, resetList]
  );

  // (fetchThreadSuggestions defined above loadMessages)

  const sendToBackend = useCallback(
    async (threadId: number, text: string) => {
      const trimmed = String(text || "").trim();
      if (!trimmed) return;

      // Check if user is saying "thank you" - will trigger rating modal after response
      if (isThankYouMessage(trimmed)) {
        pendingThankYouRef.current = true;
      }

      // Add to search history
      addToSearchHistory(trimmed);

      // Use a unique streaming ID per message (timestamp-based) so
      // sending a second message doesn't remove the first response.
      const streamSeq = Date.now();
      const assistantStreamId = `assistant_stream_${threadId}_${streamSeq}`;
      currentStreamIdRef.current = assistantStreamId;
      let gotFirstChunk = false;
      const nowMs = Date.now();

      setErrorText(null);
      setLastFailedMessage(null);
      setWasStopped(false);
      stoppedMessageRef.current = trimmed; // Track for stop → retry/edit
      setThinkingItems([]);
      thinkingBatchRef.current = [];
      if (reasoningRafRef.current !== null) { cancelAnimationFrame(reasoningRafRef.current); reasoningRafRef.current = null; }
      if (pipelineRafRef.current !== null) { cancelAnimationFrame(pipelineRafRef.current); pipelineRafRef.current = null; }
      if (thinkingItemsRafRef.current !== null) { cancelAnimationFrame(thinkingItemsRafRef.current); thinkingItemsRafRef.current = null; }
      setShowThinking(false);
      setReasoningText(""); reasoningBufferRef.current = ""; setPipelineText(""); pipelineTextRef.current = ""; setIsThinkingActive(false);
      setEditingMessageId(null); // Clear any inline edit
      setEditingText("");
      llmSuggestionsRef.current = null; // Reset LLM suggestions for new message

      // Track malika_ui metadata received during streaming (local var to avoid stale closure)
      let streamingUiMeta: MalikaUiMetaV1 | null = null;

      // Haptic feedback on send
      if (navigator.vibrate) {
        navigator.vibrate(10);
      }

      appendMsg({
        type: "text",
        content: { text: trimmed },
        position: "right",
        createdAt: nowMs,
      });

      removeMsg(assistantStreamId);
      appendMsg({
        _id: assistantStreamId,
        type: "typing",
        content: {},
        position: "left",
        createdAt: nowMs,
      });

      setIsTyping(true);
      startProcessing(threadId);
      if (suggestionsTimeoutRef.current) clearTimeout(suggestionsTimeoutRef.current);
      setLastAssistantUi({ v: 1, suggestions: [], recommendations: [] } as MalikaUiMetaV1);
      setSuggestionsLoading(true);
      suggestionsTimeoutRef.current = setTimeout(() => setSuggestionsLoading(false), 60000);
      let assistantText = "";
      clearSteps();
      clearToolCalls();
      setThinkingItems([]);
      thinkingBatchRef.current = [];
      if (reasoningRafRef.current !== null) { cancelAnimationFrame(reasoningRafRef.current); reasoningRafRef.current = null; }
      if (pipelineRafRef.current !== null) { cancelAnimationFrame(pipelineRafRef.current); pipelineRafRef.current = null; }
      if (thinkingItemsRafRef.current !== null) { cancelAnimationFrame(thinkingItemsRafRef.current); thinkingItemsRafRef.current = null; }
      setReasoningText(""); reasoningBufferRef.current = ""; setPipelineText(""); pipelineTextRef.current = ""; setIsThinkingActive(false);
      processStartRef.current = Date.now();
      userStoppedRef.current = false;
      let firstChunkTimerId: ReturnType<typeof setTimeout> | null = null;
      let streamDone = false; // Guard: prevents stale timer from overwriting enriched content

      // Shared cleanup function
      const cleanup = () => {
        // If user explicitly stopped, don't overwrite — the stop handler already handled UI
        if (userStoppedRef.current) {
          pendingSendRef.current = null;
          finishProcessing(assistantText || undefined);
          clearSteps();
          setIsThinkingActive(false);
          return;
        }
        setIsTyping(false);
        setTypingStatus(undefined);
        setIsThinkingActive(false);
        // Mark all remaining steps as done on cleanup
        markAllStepsDone();
        pendingSendRef.current = null;
        finishProcessing(assistantText || undefined);

        if (!gotFirstChunk) {
          setLastFailedMessage(trimmed);
          updateMsg(assistantStreamId, {
            type: "text",
            content: { text: "Maaf, terjadi kendala saat mengirim pesan. Coba lagi sebentar.", isFailed: true },
          });
        }
      };

      // Build SSE callbacks using chatTransport abstraction
      const callbacks: StreamCallbacks = {
        onText: (data) => {
          const piece = String(data?.content || "");
          if (!piece) return;
          if (!gotFirstChunk) {
            gotFirstChunk = true;
            // Mark all process steps as done before switching to text
            markAllStepsDone();
            setTypingStatus(undefined);
            // Micro-delay: yield to React so process steps render as "done" before typing bubble disappears
            assistantText += piece;
            firstChunkTimerId = setTimeout(() => {
              firstChunkTimerId = null;
              if (streamDone) return; // onDone already set enriched content
              updateMsg(assistantStreamId, { type: "text", content: { text: assistantText } });
            }, 80);
            return;
          }
          assistantText += piece;
          updateMsg(assistantStreamId, { content: { text: assistantText } });
        },

        // Pipeline progress: backend emits 5 status events at the major
        // stages (normalize → search → preview → knowledge → thinking).
        // Each event updates the typing-pill status text AND pushes a step
        // into the visible step list. Previous step is marked done when the
        // next one arrives.
        onStatus: (data) => {
          const message = String(data?.message || "").trim();
          const stage = String(data?.stage || "").trim();
          if (!message) return;
          // Option A: typing-pill status text
          setTypingStatus(message);
          // Option B: append to step list (skips duplicate stages)
          if (stage) {
            pushStep({
              message,
              stage,
              status: "active" as const,
              startedAt: Date.now(),
            });
          }
        },

        // Note: status_detail, tool_call, tool_result, thinking,
        // suggestions_update remain unwired (V2 ghost). See chat-pipeline.md.

        onDone: (data) => {
          const finalText = String(data?.full_text || "");
          if (finalText && !assistantText) {
            assistantText = finalText;
          }

          // Cancel the 80ms first-chunk timer so it doesn't overwrite
          // the enriched content (modelLabel, responseTimeMs) set below.
          streamDone = true;
          if (firstChunkTimerId) {
            clearTimeout(firstChunkTimerId);
            firstChunkTimerId = null;
          }

          // Store total response time — persist in ref so refreshMessagesSilently won't lose it
          const responseTimeMs = Date.now() - processStartRef.current;
          responseTimeRef.current.set(threadId, responseTimeMs);

          // Check if we should show a second bubble (table / referensi / external links)
          const uiMeta = streamingUiMeta;
          const hasUiTable = Boolean(
            uiMeta?.table?.kind === "data" &&
            Array.isArray(uiMeta.table.rows) &&
            uiMeta.table.rows.length > 0
          ) || Boolean(
            uiMeta?.table2?.kind === "data" &&
            Array.isArray(uiMeta.table2.rows) &&
            uiMeta.table2.rows.length > 0
          );
          const hasUiCandidates = Array.isArray(uiMeta?.candidates) && uiMeta!.candidates!.length > 0;
          const hasUiKnowledge = Array.isArray(uiMeta?.knowledgeCandidates) && uiMeta!.knowledgeCandidates!.length > 0;
          const hasUiExternalLinks = Array.isArray(uiMeta?.externalLinks) && (uiMeta!.externalLinks as any[]).length > 0;
          const hasSecondBubble = hasUiTable || hasUiCandidates || hasUiKnowledge || hasUiExternalLinks;

          // Update streaming message as interpretation text (first bubble)
          const streamModelLabel = getModelLabel(uiMeta?.metadata?.model);
          const streamTokenInfo = uiMeta?.metadata?.tokens || null;
          updateMsg(assistantStreamId, {
            type: "text",
            content: {
              text: assistantText,
              responseTimeMs: hasSecondBubble ? undefined : responseTimeMs,
              modelLabel: streamModelLabel,
              tokenInfo: streamTokenInfo,
            },
            hasTime: !hasSecondBubble,
          });

          // Create the second bubble (table + referensi + external links) from streaming data
          // This avoids the race condition where refreshMessagesSilently runs before the
          // backend has saved the assistant message to DB.
          if (hasSecondBubble && uiMeta) {
            appendMsg({
              _id: `${assistantStreamId}_table`,
              type: "result_table",
              content: { ui: uiMeta, responseTimeMs, modelLabel: streamModelLabel, tokenInfo: streamTokenInfo },
              position: "left" as const,
              createdAt: Date.now(),
              hasTime: true,
            });
          }

          cleanup();

          // If user switched threads during stream, don't refresh
          if (activeThreadIdRef.current !== threadId) return;

          // Skip refreshMessagesSilently after a successful stream.
          // The streaming onDone handler already built the complete message
          // state (text + table + metadata) from SSE events, so a DB refresh
          // would only cause a visual "double render" flash (streaming IDs
          // replaced by DB IDs → React unmounts/remounts all bubbles).
          // DB state is canonical for page reloads; live state is fine here.
          loadThreads();

          // If the streamed malika_ui didn't include suggestions (or only
          // generic ones), fetch LLM-generated context-aware chips. The
          // skeleton stays visible until they arrive.
          const streamedSuggestions = streamingUiMeta?.suggestions;
          if (!Array.isArray(streamedSuggestions) || streamedSuggestions.length === 0) {
            fetchThreadSuggestions(threadId);
          }

          // Thank-you rating check
          if (pendingThankYouRef.current && !hasExistingFeedback) {
            pendingThankYouRef.current = false;
            setTimeout(() => {
              const currentThread = threadsRef.current.find((t) => t.id === threadId);
              openRating(threadId, currentThread?.title || "Chat");
            }, 500);
          } else {
            pendingThankYouRef.current = false;
          }
        },

        onError: (data) => {
          const errorMsg = String(data?.message || "stream_error");
          setErrorText(errorMsg);
          setLastFailedMessage(trimmed);

          // Derive errorType locally to avoid stale closure (setState is async)
          let derivedErrorType: "network" | "timeout" | "server" | "unknown" = "unknown";
          const errLower = errorMsg.toLowerCase();
          if (errLower.includes("backend_unreachable") || errLower.includes("fetch") || errLower.includes("network") || errLower.includes("failed to fetch") || errLower.includes("err_internet") || errLower.includes("net::")) {
            derivedErrorType = "network";
          } else if (errLower.includes("timeout") || errLower.includes("etimedout") || errLower.includes("econnaborted") || errLower.includes("waktu terlalu lama")) {
            derivedErrorType = "timeout";
          } else if (errLower.includes("http_5") || errLower.includes("500") || errLower.includes("502") || errLower.includes("503") || errLower.includes("504") || errLower.includes("server_busy") || errLower.includes("internal server") || errLower.includes("service unavailable")) {
            derivedErrorType = "server";
          }
          setErrorType(derivedErrorType);

          // Haptic error feedback — skip if user already navigated away
          if (navigator.vibrate && activeThreadIdRef.current === threadId) {
            navigator.vibrate([50, 100, 50]);
          }

          updateMsg(assistantStreamId, {
            type: "error",
            content: { text: errorMsg, errorType: derivedErrorType },
          });

          // Stop suggestion loading on error
          setSuggestionsLoading(false);
          if (suggestionsTimeoutRef.current) clearTimeout(suggestionsTimeoutRef.current);

          cleanup();
        },

        onThreadUpdated: (data) => {
          const newTitle = String(data?.title || "");
          if (newTitle && threadId) {
            setThreads((prev) =>
              prev.map((t) =>
                t.id === threadId ? { ...t, title: newTitle } : t
              )
            );
          }
        },

        onMalikaUi: (data) => {
          if (data && data.v === 1) {
            // Store in local var so onDone can access without stale closure
            streamingUiMeta = data as MalikaUiMetaV1;
            // Merge any suggestions that arrived before malika_ui
            if (llmSuggestionsRef.current) {
              streamingUiMeta = { ...streamingUiMeta, suggestions: llmSuggestionsRef.current };
            }
            setLastAssistantUi(streamingUiMeta);
          }
        },

        onUserSaved: () => { /* persisted on backend */ },
        onIntent: () => { /* debug info */ },
      };

      // Start streaming via chatTransport — replaces manual fetch + ReadableStream + SSE parsing.
      // Single-lane (2026-05-16): omit `model` so chatTransport applies its Sonnet default.
      const controller = streamMessage(threadId, trimmed, malikaUid, callbacks, undefined);
      pendingSendRef.current = controller;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startProcessing, finishProcessing, clearSteps, clearToolCalls, markAllStepsDone, pushStep, pushStepDetail, pushToolCall, pushToolResult, setProcessSteps, getModelLabel are stable (useCallback with [] deps). openRating and hasExistingFeedback are used only in rare thank-you path and captured via ref.
    [appendMsg, isThankYouMessage, loadThreads, malikaUid, refreshMessagesSilently, removeMsg, updateMsg]
  );

  // Retry failed message
  const retryLastMessage = useCallback(async () => {
    if (!lastFailedMessage || !activeThreadId || isRetrying) return;
    
    setIsRetrying(true);
    setErrorText(null);
    
    // Remove the error bubble (use the tracked unique streaming ID)
    const streamId = currentStreamIdRef.current || `assistant_stream_${activeThreadId}`;
    removeMsg(streamId);
    // Also remove the corresponding table bubble if it exists
    removeMsg(`${streamId}_table`);
    
    // Remove the LAST user message to prevent duplication
    // (sendToBackend will add a fresh user bubble)
    const lastUserMsg = [...messages].reverse().find(m => m.position === 'right');
    if (lastUserMsg?._id) {
      removeMsg(lastUserMsg._id);
    }
    
    try {
      await sendToBackend(activeThreadId, lastFailedMessage);
      setLastFailedMessage(null);
    } catch {
      // Error handling is done in sendToBackend
    } finally {
      setIsRetrying(false);
    }
  }, [activeThreadId, isRetrying, lastFailedMessage, messages, removeMsg, sendToBackend]);

  // Dismiss error
  const dismissError = useCallback(() => {
    if (!activeThreadId) return;
    const streamId = currentStreamIdRef.current || `assistant_stream_${activeThreadId}`;
    removeMsg(streamId);
    setErrorText(null);
    setLastFailedMessage(null);
  }, [activeThreadId, removeMsg]);

  // Track if initial load has happened
  const initialLoadDoneRef = useRef(false);
  // Track the last loaded thread ID to prevent redundant loads
  const lastLoadedThreadIdRef = useRef<number | null>(null);

  useEffect(() => {
    const uid = getOrCreateMalikaUid();
    setMalikaUid(uid);
  }, []);

  // Initial mount: load threads AND first thread's messages together for faster perceived load
  useEffect(() => {
    if (!malikaUid) return;
    if (initialLoadDoneRef.current) return; // Only run once
    initialLoadDoneRef.current = true;
    
    // Inline the initial load to set lastLoadedThreadIdRef properly
    (async () => {
      setLoadingThreads(true);
      setLoadingMessages(true);
      setSuggestionsLoading(true); // Show skeleton immediately on mount
      setErrorText(null);
      try {
        const threadsRes = await fetch(`${apiBase}/threads`, {
          method: "GET",
          headers,
        });
        const threadsJson = await threadsRes.json();
        if (!threadsRes.ok || !threadsJson?.ok) {
          throw new Error(threadsJson?.error || `HTTP_${threadsRes.status}`);
        }
        const list = (threadsJson.threads || []) as Thread[];
        setThreads(list);
        
        if (list.length > 0 && !activeThreadIdRef.current) {
          const firstThreadId = list[0].id;
          setActiveThreadId(firstThreadId);
          activeThreadIdRef.current = firstThreadId;
          lastLoadedThreadIdRef.current = firstThreadId; // Prevent duplicate load
          
          try {
            const messagesRes = await fetch(`${apiBase}/threads/${firstThreadId}/messages`, {
              method: "GET",
              headers,
            });
            const messagesJson = await messagesRes.json();
            if (messagesRes.ok && messagesJson?.ok) {
              const rows = (messagesJson.messages || []) as BackendMessage[];
              const uiMsgs = mapBackendMessagesToChatUI(rows);
              resetList(uiMsgs);
              const ui = extractLastAssistantUi(rows, uiMsgs);
              setLastAssistantUi(ui);

              // Fire-and-forget: chat appears immediately, chip skeleton
              // (driven by suggestionsLoading) covers the LLM round-trip.
              if (rows.length > 0) {
                fetchThreadSuggestions(firstThreadId);
              } else {
                setSuggestionsLoading(false);
              }
            }
          } catch {
            // Ignore message fetch errors on initial load
          }
        }
      } catch (e) {
        setErrorText(e instanceof Error ? e.message : String(e));
      } finally {
        setLoadingThreads(false);
        setLoadingMessages(false);
        if (!activeThreadIdRef.current) {
          setSuggestionsLoading(false);
        }
      }
    })();
  }, [apiBase, extractLastAssistantUi, fetchThreadSuggestions, headers, malikaUid, mapBackendMessagesToChatUI, resetList]);

  // When user manually switches threads, load messages for that thread
  useEffect(() => {
    if (!activeThreadId) return;
    // Skip if we already loaded messages for this thread
    if (lastLoadedThreadIdRef.current === activeThreadId) return;
    lastLoadedThreadIdRef.current = activeThreadId;
    activeThreadIdRef.current = activeThreadId;
    loadMessages(activeThreadId);
  }, [activeThreadId, loadMessages]);

  /*
   * A question typed in a page's own ask box, handed over when chat opens as a
   * dialog. It rides the same rails as the sample-query cards below — queue it,
   * create a thread, and the effect after this one sends it once the thread
   * lands — so the reader gets an answer instead of an empty composer.
   *
   * Guarded by a ref: this must fire once per mount, never again when threads
   * reload underneath it.
   */
  const carriedQuestionSentRef = useRef(false);
  useEffect(() => {
    const question = initialQuestion?.trim();
    // Wait for the uid: createThread() bails without one, and firing early
    // burned the one-shot guard below, so the question was silently dropped.
    if (!question || !malikaUid || carriedQuestionSentRef.current) return;
    carriedQuestionSentRef.current = true;
    pendingSampleQueryRef.current = question;
    void createThread();
  }, [initialQuestion, malikaUid, createThread]);

  // Auto-fire the sample-query queued from the EmptyState category cards.
  // Runs after activeThreadId lands and loadMessages has resolved (small
  // delay to let UI settle so the user sees the typing indicator clearly).
  useEffect(() => {
    if (!activeThreadId) return;
    const queued = pendingSampleQueryRef.current;
    if (!queued) return;
    pendingSampleQueryRef.current = null;
    const t = setTimeout(() => sendToBackend(activeThreadId, queued), 250);
    return () => clearTimeout(t);
  }, [activeThreadId, sendToBackend]);

  // --- Background processing persistence effects ---

  // Track current isChatProcessing value via ref for the unmount cleanup
  const isChatProcessingRef = useRef(false);
  isChatProcessingRef.current = isChatProcessing;

  // When component unmounts while a stream is active, mark "navigated away"
  // so the context + toast + notification know the user left mid-stream.
  useEffect(() => {
    return () => {
      if (isChatProcessingRef.current) {
        markNavigatedAway();
      }
    };
  }, [markNavigatedAway]);

  // Restore "processing" indicator when returning to a thread that's still
  // being streamed in the background (SSE callback continues after unmount).
  // KEY INSIGHT: UnifiedActivityFeed only renders inside msg.type==="typing" blocks.
  // So we must inject a typing bubble into the message list, not just set isTyping.
  useEffect(() => {
    if (loadingMessages) return; // wait for loadMessages to finish
    if (!activeThreadId) return;

    // Case A: stream STILL running → inject typing bubble + show progress indicator
    if (isChatProcessing && processingThreadId === activeThreadId && navigatedAway) {
      const bgStreamId = `assistant_stream_${activeThreadId}_bg`;
      currentStreamIdRef.current = bgStreamId;
      // Inject a typing bubble so UnifiedActivityFeed renders
      appendMsg({
        _id: bgStreamId,
        type: "typing",
        content: {},
        position: "left",
        createdAt: Date.now(),
      });
      setIsTyping(true);
      // Restore accumulated steps from context (unified state survives remount)
      if (processSteps.length === 0) {
        setProcessSteps([{
          message: "Memproses respons...",
          stage: "background",
          status: "active" as const,
          startedAt: processingStartedAt || Date.now(),
        }]);
      }
      return;
    }

    // Case B: stream already FINISHED while user was away → refresh from DB
    if (!isChatProcessing && completedAt && navigatedAway) {
      // The stream finished before we came back — load the completed response from DB
      const timer = setTimeout(() => {
        setIsTyping(false);
        clearSteps();
        refreshMessagesSilently(activeThreadId);
        clearCompletion();
      }, 300);
      return () => { clearTimeout(timer); };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingMessages, activeThreadId, isChatProcessing, processingThreadId, navigatedAway, completedAt]);

  // When a background stream finishes WHILE user is already looking at /chat,
  // reload the completed response from the backend database.
  useEffect(() => {
    if (!completedAt || !activeThreadId || !navigatedAway) return;
    if (isChatProcessing) return; // still running, wait for it
    // Only refresh if this is the thread that was being processed
    if (processingThreadId !== null && processingThreadId !== activeThreadId) return;
    const timer = setTimeout(() => {
      setIsTyping(false);
      clearSteps();
      // Remove the typing bubble we injected
      const bgStreamId = currentStreamIdRef.current;
      if (bgStreamId) removeMsg(bgStreamId);
      refreshMessagesSilently(activeThreadId);
      clearCompletion();
    }, 800); // short delay for backend to finalise DB write
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedAt, activeThreadId, navigatedAway, isChatProcessing]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in input fields (except Escape)
      const target = e.target as HTMLElement;
      const isInputting = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      
      // Ctrl/Cmd + K: Focus search input (for new query)
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        const input = document.querySelector('.Composer textarea, .Composer input') as HTMLElement;
        input?.focus();
      }
      
      // Escape: Stop voice recording if active, close shortcuts modal, or close mobile history
      if (e.key === "Escape") {
        if (isListening) {
          e.preventDefault();
          toggleVoiceInput(); // Stop recording via hook
        } else if (showShortcutsModal) {
          e.preventDefault();
          setShowShortcutsModal(false);
        }
      }
      
      // Ctrl/Cmd + N: New chat
      if ((e.ctrlKey || e.metaKey) && e.key === "n") {
        e.preventDefault();
        createThread();
      }
      
      // / key: Focus input (only when not typing)
      if (e.key === "/" && !isInputting && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const input = document.querySelector('.malika-composer textarea, .malika-composer input') as HTMLElement;
        input?.focus();
      }
      
      // ? key: Show keyboard shortcuts help (only when not typing)
      if (e.key === "?" && !isInputting && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setShowShortcutsModal(true);
      }

      // L5: Arrow key navigation for thread list (Alt+Up/Down)
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && threads.length > 0) {
        e.preventDefault();
        const currentIdx = threads.findIndex((t) => t.id === activeThreadId);
        let nextIdx: number;
        if (e.key === "ArrowDown") {
          nextIdx = currentIdx < threads.length - 1 ? currentIdx + 1 : 0;
        } else {
          nextIdx = currentIdx > 0 ? currentIdx - 1 : threads.length - 1;
        }
        setActiveThreadId(threads[nextIdx].id);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isListening, toggleVoiceInput, createThread, showShortcutsModal, threads, activeThreadId]);

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) || null,
    [activeThreadId, threads]
  );

  const exportActiveChatJson = useCallback(async () => {
    if (!activeThreadId) return;
    setErrorText(null);
    setIsExporting(true);

    try {
      const res = await fetch(`${apiBase}/threads/${activeThreadId}/messages`, {
        method: "GET",
        headers,
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `HTTP_${res.status}`);
      }

      const rows = (json.messages || []) as BackendMessage[];
      const recap = {
        exported_at: new Date().toISOString(),
        thread: activeThread,
        messages: rows
          .filter((m) => m && (m.role === "user" || m.role === "assistant"))
          .map((m) => {
            const extracted = m.role === "assistant" ? extractMalikaUiBlock(String(m.content || "")) : null;
            return {
              id: m.id,
              thread_id: m.thread_id,
              role: m.role,
              created_at: m.created_at,
              content: m.content,
              assistant_text: extracted ? extracted.text : undefined,
              malika_ui: extracted ? extracted.ui : undefined,
            };
          }),
      };

      const safeTitle = String(activeThread?.title || "chat")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40);
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `malika_rekap_${activeThreadId}_${safeTitle || "chat"}_${ts}.json`;

      // Open modal instead of direct download
      setExportJsonData(JSON.stringify(recap, null, 2));
      setExportFilename(filename);
      setCopySuccess(false);
      setExportModalOpen(true);
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : String(e));
    } finally {
      setIsExporting(false);
    }
  }, [activeThread, activeThreadId, apiBase, headers]);

  // Copy JSON to clipboard
  const handleCopyJson = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(exportJsonData);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (e) {
      console.error("Failed to copy:", e);
    }
  }, [exportJsonData]);

  // Download JSON file
  const handleDownloadJson = useCallback(() => {
    const blob = new Blob([exportJsonData], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFilename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [exportJsonData, exportFilename]);

  const renderMessageContent = useCallback((msg: ChatUiMessage) => {
    // Typing indicator — unified ThinkingCard from Claude Design handoff
    // (replaces the prior step-list-card + Berpikir-pill stack).
    if (msg.type === "typing") {
      const onStopHandler = pendingSendRef.current
        ? () => {
            userStoppedRef.current = true;
            pendingSendRef.current?.abort();
            pendingSendRef.current = null;
            setIsTyping(false);
            setTypingStatus(undefined);
            markAllStepsDone();
            setWasStopped(true);
          }
        : undefined;

      // While we have any process steps, render the UnifiedThinkingCard.
      // Fall back to the legacy ThinkingFeed only when steps haven't started yet
      // (covers the initial gap between user-send and the first 'status' SSE).
      if (processSteps.length > 0) {
        return (
          <UnifiedThinkingCard
            steps={processSteps}
            isStreaming={isTyping}
            onStop={onStopHandler}
          />
        );
      }

      // Bootstrapping state — no status events received yet
      return (
        <ThinkingFeed
          thinkingItems={thinkingItems}
          pipelineText={pipelineText}
          reasoningText={reasoningText}
          isStreaming={isTyping}
          isThinkingActive={isThinkingActive}
          onStop={onStopHandler}
        />
      );
    }

    // Error bubble with retry option
    if (msg.type === "error") {
      return (
        <MalikaErrorBubble
          error={msg.content?.text || "Terjadi kesalahan"}
          errorType={msg.content?.errorType || errorType}
          onRetry={lastFailedMessage ? retryLastMessage : undefined}
          onDismiss={dismissError}
          isRetrying={isRetrying}
        />
      );
    }

    if (msg.type === "typing_text") {
      return <TypingText content={String(msg.content?.text || "")} options={{ interval: 14, step: 1 }} />;
    }

    if (msg.type === "result_table") {
      const ui = msg.content?.ui as MalikaUiMetaV1 | undefined;
      if (!ui) return <BubbleText content="(Tidak ada data)" />;

      // NEW: Use DataSummaryBubble to show data as text with modal button
      const table = ui?.table;
      const table2 = ui?.table2;
      const hasTableData = table && Array.isArray(table.columns) && table.columns.length > 0 && Array.isArray(table.rows) && table.rows.length > 0;
      const hasTable2Data = table2 && Array.isArray(table2.columns) && table2.columns.length > 0 && Array.isArray(table2.rows) && table2.rows.length > 0;
      const hasAnyTableData = hasTableData || hasTable2Data;
      const kind = (table?.kind || "search") as "data" | "search";
      const hasCandidates = Array.isArray(ui?.candidates) && ui.candidates.length > 0;
      const hasKnowledgeCandidates = Array.isArray(ui?.knowledgeCandidates) && ui.knowledgeCandidates.length > 0;
      const hasSources = Array.isArray(ui?.sources) && ui.sources.length > 0;
      const hasExternalLinks = Array.isArray(ui?.externalLinks) && (ui.externalLinks as any[]).length > 0;

      // Skip search-type tables (candidate lists) UNLESS we have something to display
      if (kind === "search" && !hasSources && !hasCandidates && !hasKnowledgeCandidates && !hasExternalLinks) return null;

      // If we have table data, show the summary bubble (candidates inline)
      if (hasAnyTableData) {
        return (
          <DataSummaryBubble
            ui={ui}
            sourcesSlot={hasSources ? <SourcesSection sources={ui.sources!} /> : undefined}
            KnowledgeCandidateSelector={KnowledgeCandidateSelector}
            ExternalSuggestionsSection={ExternalSuggestionsSection}
            threadId={activeThreadId ?? undefined}
          />
        );
      }

      // If we have candidates (datasources or knowledge), show unified card
      if (hasCandidates || hasKnowledgeCandidates) {
        return (
          <div className="max-w-[min(680px,96vw)] sm:max-w-[min(680px,90vw)]">
            <div className="Bubble text">
              {hasCandidates && <CandidateSelector ui={ui} variant="inline" />}

              {/* DNA metadata — statistical literacy */}
              <DnaMetadataSection dnaMetadata={ui.dnaMetadata} />

              {/* Inline sections — same padding as table section */}
              {hasKnowledgeCandidates && <KnowledgeCandidateSelector ui={ui} variant="inline" />}
              <ExternalSuggestionsSection ui={ui} variant="inline" />

              {/* Feedback */}
              <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                <MessageFeedback messageId={`ref-${ui?.query || "unknown"}`} threadId={activeThreadId ?? undefined} />
              </div>
            </div>
          </div>
        );
      }

      // No table data and no candidates — but may have sources, DNA metadata, or external links
      if (hasSources || hasExternalLinks || ui.dnaMetadata) {
        return (
          <div className="max-w-[min(680px,96vw)] sm:max-w-[min(680px,90vw)]">
            <div className="Bubble text">
              {/* DNA metadata — statistical literacy */}
              <DnaMetadataSection dnaMetadata={ui.dnaMetadata} />

              {/* Sources */}
              {hasSources && <SourcesSection sources={ui.sources!} />}

              {/* External links */}
              <ExternalSuggestionsSection ui={ui} variant="inline" />

              {/* Feedback */}
              <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                <MessageFeedback messageId={`ref-${ui?.query || "unknown"}`} threadId={activeThreadId ?? undefined} />
              </div>
            </div>
          </div>
        );
      }

      return null;
    }

    if (msg.type === "link_list") {
      // Deprecated: link list only appears with preview (PreviewGate).
      return null;
    }

    if (msg.type === "suggestions") {
      // Deprecated: suggestions only appear with preview (PreviewGate).
      return null;
    }

    if (msg.type === "text") {
      return <BubbleText content={String(msg.content?.text ?? "")} />;
    }
    return <BubbleText content={String(msg.content || "")} />;
  }, [activeThreadId, dismissError, errorType, isRetrying, isTyping, lastFailedMessage, processSteps, removeMsg, retryLastMessage, sendToBackend, thinkingItems, typingStatus, wasStopped]);

  return (
    <div className={`chat-page-root ${isIOSSafari ? 'chat-ios' : 'chat-non-ios'} h-full w-full overflow-hidden bg-white dark:bg-gray-900`}>
      {/* Skip to composer link for keyboard accessibility */}
      <a
        href="#chat-composer"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100002] focus:rounded-lg focus:bg-brand-500 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
      >
        Langsung ke composer
      </a>
      <div className="flex h-full min-h-0 flex-col lg:flex-row">
        {/* History panel - drawer on mobile, sidebar on desktop */}
        <>
          {/* Mobile overlay backdrop */}
          {mobileHistoryOpen && (
            <div 
              className="fixed inset-0 z-[100000] bg-black/40 lg:hidden" 
              onClick={() => setMobileHistoryOpen(false)} 
            />
          )}
          <div className={`
            fixed inset-y-0 left-0 z-[100001] w-[85vw] max-w-[320px] transform transition-transform duration-200 ease-out
            ${mobileHistoryOpen ? 'translate-x-0' : '-translate-x-full'}
            md:w-[50vw] md:max-w-[400px]
            lg:relative lg:inset-auto lg:z-auto lg:w-[280px] lg:max-w-none lg:translate-x-0 lg:transition-none
            xl:w-[320px]
            flex flex-col border-r border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900
            lg:h-full
          `}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-white/90">Chat MALIKA</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {malikaUid ? "Anon" : ""}{malikaUid ? ` • ${malikaUid.slice(0, 8)}…` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={createThread}
                  className="inline-flex items-center justify-center rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
                  disabled={!malikaUid}
                >
                  New Chat
                </button>
                {/* Close button for mobile drawer */}
                <button
                  type="button"
                  onClick={() => setMobileHistoryOpen(false)}
                  className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 lg:hidden dark:hover:bg-gray-800"
                >
                  <CloseIcon className="h-5 w-5" />
                </button>
              </div>
            </div>

          {/* Show error banner only when not loading and threads are present (non-thread-list errors like SSE/streaming) */}
          {errorText && !loadingThreads && threads.length > 0 ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
              {errorText}
            </div>
          ) : null}

          <div className="mt-4 min-h-0 flex-1 overflow-y-auto malika-sidebar-scroll">
            {/* L6: Error state takes precedence over loading skeletons to avoid overlap */}
            {errorText && !loadingThreads ? (
              <div className="rounded-xl border border-dashed border-red-300 p-4 text-sm text-red-600 dark:border-red-700 dark:text-red-300">
                <p className="mb-2 font-medium">Gagal memuat riwayat</p>
                <p className="text-xs text-red-500 dark:text-red-400">{errorText}</p>
                <button
                  type="button"
                  onClick={loadThreads}
                  className="mt-3 rounded-lg bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-200 dark:hover:bg-red-900/50"
                >
                  Coba lagi
                </button>
              </div>
            ) : loadingThreads ? (
              <div className="space-y-2">
                <ThreadSkeleton />
                <ThreadSkeleton />
                <ThreadSkeleton />
              </div>
            ) : threads.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-600 dark:border-gray-600 dark:text-gray-300">
                <p className="mb-3">Belum ada chat. Klik <strong>New Chat</strong> untuk mulai.</p>
                <div className="text-[11px] text-gray-400 dark:text-gray-500">
                  <p className="font-medium mb-1">Pintasan Keyboard:</p>
                  <p>• <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[10px]">Ctrl</kbd> + <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[10px]">N</kbd> — Chat baru</p>
                  <p>• <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[10px]">Ctrl</kbd> + <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[10px]">K</kbd> — Fokus input</p>
                  <p>• <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[10px]">Alt</kbd> + <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[10px]">↑↓</kbd> — Navigasi chat</p>
                  <p>• <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[10px]">Esc</kbd> — Batalkan suara</p>
                </div>
              </div>
            ) : (
              <ul className="space-y-2">
                {threads.map((t) => {
                  const active = t.id === activeThreadId;
                  const isConfirmingDelete = pendingDeleteId === t.id;
                  return (
                    <li key={t.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveThreadId(t.id);
                          setMobileHistoryOpen(false); // Close drawer on mobile
                        }}
                        className={
                          "w-full rounded-xl border px-3 py-2 text-left transition-all duration-150 " +
                          (active
                            ? "border-brand-500 bg-brand-50 shadow-sm dark:bg-brand-950/20"
                            : "border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800 dark:hover:border-gray-700")
                        }
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="line-clamp-2 text-sm font-semibold text-gray-900 dark:text-white/90">
                            {t.title || "Chat"}
                          </p>
                          <span className="shrink-0 text-[11px] text-gray-500 dark:text-gray-400">
                            {fmtShortDateIso(t.last_message_at)}
                          </span>
                        </div>
                      </button>
                      {/* Delete button — visible on hover / focus-within */}
                      {isConfirmingDelete ? (
                        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1 bg-white dark:bg-gray-900 rounded-lg shadow px-1.5 py-1 border border-gray-200 dark:border-gray-700 z-10">
                          <span className="text-[10px] text-gray-600 dark:text-gray-300 mr-1">Hapus?</span>
                          <button type="button" onClick={(e) => { e.stopPropagation(); deleteThread(t.id); setPendingDeleteId(null); }}
                            className="rounded bg-red-500 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-red-600">
                            Ya
                          </button>
                          <button type="button" onClick={(e) => { e.stopPropagation(); setPendingDeleteId(null); }}
                            className="rounded bg-gray-200 dark:bg-gray-700 px-2 py-0.5 text-[10px] font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600">
                            Batal
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setPendingDeleteId(t.id); }}
                          className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus:opacity-100 rounded-lg p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-opacity"
                          title="Hapus chat"
                          aria-label={`Hapus chat "${t.title || 'Chat'}"`}
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
        </>

        {/* Chat panel */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Fixed header on mobile, sticky on desktop - fixes iOS scroll issue */}
          <div className="fixed left-0 right-0 top-[60px] z-[50] flex items-center justify-between border-b border-gray-200 bg-white/95 backdrop-blur-sm px-3 sm:px-4 py-3 lg:sticky lg:top-0 lg:left-auto lg:right-auto lg:z-20 dark:border-gray-800 dark:bg-gray-900/95">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              {/* Hamburger menu for mobile history */}
              <button
                type="button"
                onClick={() => setMobileHistoryOpen(true)}
                className="shrink-0 rounded-lg p-2 text-gray-500 hover:bg-gray-100 active:bg-gray-200 lg:hidden dark:hover:bg-gray-800 dark:active:bg-gray-700"
                title="Riwayat Chat"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-900 dark:text-white/90">
                  {activeThread?.title || "Chat MALIKA"}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {loadingMessages ? "Memuat pesan…" : isListening ? "🎤 Mendengarkan..." : ""}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2">
              {/* New Chat button - prominent on mobile */}
              <button
                type="button"
                onClick={createThread}
                disabled={loadingMessages || isTyping}
                aria-label="Mulai chat baru"
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 min-h-[44px] text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-60 dark:bg-brand-600 dark:hover:bg-brand-700 lg:hidden"
                title="Mulai chat baru"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span className="hidden xs:inline">Baru</span>
              </button>
              {/* Voice Input Button */}
              {voiceSupported && (
                <button
                  type="button"
                  onClick={toggleVoiceInput}
                  disabled={!activeThreadId || loadingMessages || isTyping}
                  aria-disabled={!activeThreadId || loadingMessages || isTyping}
                  aria-label={isListening ? "Berhenti merekam suara" : (!activeThreadId || loadingMessages || isTyping) ? "Input suara tidak tersedia" : "Bicara untuk mengetik"}
                  className={`inline-flex items-center justify-center rounded-lg border p-2.5 min-h-[44px] min-w-[44px] text-xs font-semibold transition-all disabled:opacity-60 ${
                    isListening
                      ? "border-red-400 bg-red-50 text-red-600 hover:bg-red-100 dark:border-red-600 dark:bg-red-950/50 dark:text-red-400 dark:hover:bg-red-900/50"
                      : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                  }`}
                  title={isListening ? "Klik untuk berhenti" : "Bicara untuk mengetik"}
                >
                  {isListening ? (
                    <svg className="h-4 w-4 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                      <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                  )}
                </button>
              )}
              
              <button
                type="button"
                onClick={exportActiveChatJson}
                disabled={!activeThreadId || loadingMessages || isTyping || isExporting}
                aria-label={!activeThreadId ? "Pilih chat terlebih dahulu" : "Export JSON rekap chat"}
                className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 min-h-[44px] text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                title={!activeThreadId ? "Pilih chat terlebih dahulu" : "Export JSON rekap chat"}
              >
                {isExporting ? "Export…" : "Export JSON"}
              </button>
            </div>
          </div>
          {/* Spacer for fixed header on mobile */}
          <div className="h-[52px] shrink-0 lg:hidden" />

          <div className="relative min-h-0 flex-1 overflow-hidden">
            {!activeThreadId ? (
              // Branded onboarding (no thread selected). Same shape as the
              // empty-thread state but the sample cards create a new thread
              // first, then send the query. Matches Claude Design's EmptyState.
              <div className="malika-welcome-placeholder mx-auto h-full max-w-[680px] overflow-y-auto px-4 py-8 sm:px-6 sm:py-10">
                <div className="flex flex-col items-center pb-6 text-center sm:pb-8">
                  <div className="relative mb-4">
                    <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-lg shadow-brand-500/30 sm:h-16 sm:w-16">
                      <svg className="h-7 w-7 sm:h-8 sm:w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
                      </svg>
                    </div>
                    <span aria-hidden="true" className="absolute -top-1 -right-1 inline-block h-3 w-3 rounded-full bg-emerald-500 ring-4 ring-white dark:ring-gray-950" />
                  </div>
                  <h1 className="text-balance text-[22px] font-semibold tracking-tight text-gray-900 dark:text-white sm:text-[26px]">
                    Halo, saya MALIKA
                  </h1>
                  <p className="mt-1.5 max-w-md text-pretty text-[13.5px] leading-relaxed text-gray-600 dark:text-gray-400 sm:text-[14px]">
                    Asisten data statistik untuk Provinsi Maluku Utara. Tanyakan apa saja tentang penduduk, ekonomi, sosial, dan harga — saya akan menjawab dari publikasi resmi BPS.
                  </p>
                  <button
                    type="button"
                    onClick={createThread}
                    disabled={loadingMessages || isTyping}
                    className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-[13.5px] font-semibold text-white shadow-sm shadow-brand-500/30 transition hover:bg-brand-600 disabled:opacity-60"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                    Mulai Chat Baru
                  </button>
                </div>

                <h2 className="mb-3 text-[11.5px] font-medium uppercase tracking-[0.08em] text-gray-500 dark:text-gray-400">
                  Atau pilih contoh
                </h2>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {SAMPLE_QUERIES.map((cat) => {
                    const colorClasses: Record<typeof cat.color, { bg: string; ring: string; icon: string }> = {
                      sky: { bg: "bg-sky-50 dark:bg-sky-500/10", ring: "ring-sky-100 dark:ring-sky-500/20", icon: "text-sky-600 dark:text-sky-400" },
                      emerald: { bg: "bg-emerald-50 dark:bg-emerald-500/10", ring: "ring-emerald-100 dark:ring-emerald-500/20", icon: "text-emerald-600 dark:text-emerald-400" },
                      rose: { bg: "bg-rose-50 dark:bg-rose-500/10", ring: "ring-rose-100 dark:ring-rose-500/20", icon: "text-rose-600 dark:text-rose-400" },
                      violet: { bg: "bg-brand-50 dark:bg-brand-500/10", ring: "ring-brand-100 dark:ring-brand-500/20", icon: "text-brand-600 dark:text-brand-300" },
                    };
                    const c = colorClasses[cat.color];
                    const iconSvg = (() => {
                      switch (cat.iconKey) {
                        case "users":
                          return <path d="M16 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" fill="currentColor" />;
                        case "trending":
                          return <path d="M3.5 18.5l6-6.5 4 4L22 6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />;
                        case "heart":
                          return <path d="M12 21s-7-4.5-7-10a4 4 0 017-2.65A4 4 0 0119 11c0 5.5-7 10-7 10z" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />;
                        case "gauge":
                          return <g fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 14l4-4" /><circle cx={12} cy={14} r={1.5} /><path d="M3 14a9 9 0 0118 0" /></g>;
                      }
                    })();
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={async () => {
                          // Create thread, then queue the sample query.
                          // pendingSampleQueryRef plumbs the query through to
                          // the thread-load effect so it sends after thread mounts.
                          pendingSampleQueryRef.current = cat.examples[0];
                          await createThread();
                        }}
                        disabled={loadingMessages || isTyping}
                        className="group rounded-xl bg-white p-3.5 text-left ring-1 ring-gray-200/80 transition hover:shadow-sm hover:ring-brand-300 disabled:opacity-50 dark:bg-gray-900 dark:ring-white/10 dark:hover:ring-brand-500/40"
                      >
                        <div className="mb-2 flex items-center gap-2.5">
                          <div className={`grid h-8 w-8 place-items-center rounded-lg ring-1 ${c.bg} ${c.ring}`}>
                            <svg className={`h-[15px] w-[15px] ${c.icon}`} viewBox="0 0 24 24">{iconSvg}</svg>
                          </div>
                          <div className="text-[12px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            {cat.label}
                          </div>
                        </div>
                        <div className="text-[13.5px] font-medium leading-snug text-gray-800 dark:text-gray-200">
                          {cat.examples[0]}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <p className="mt-6 text-center text-[11px] text-gray-400 dark:text-gray-500 lg:hidden">
                  Atau buka{" "}
                  <button type="button" onClick={() => setMobileHistoryOpen(true)} className="text-brand-500 hover:underline">
                    riwayat chat
                  </button>
                </p>
              </div>
            ) : (
              <>
                {/* Offline indicator - shown when device is offline */}
                {isOffline && (
                  <div 
                    role="alert"
                    className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 dark:border-amber-800 dark:bg-amber-950/30"
                  >
                    <svg className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.415 1.414m-1.415-1.414L3 3m8.293 8.293l1.414 1.414" />
                    </svg>
                    <span className="flex-1 text-sm text-amber-800 dark:text-amber-200">
                      Tidak ada koneksi internet. Pesan tidak dapat dikirim.
                    </span>
                  </div>
                )}
                {/* Voice transcript preview bar */}
                {voiceTranscript && (
                  <div className="flex items-center gap-2 border-b border-gray-200 bg-blue-50 px-4 py-2 dark:border-gray-600 dark:bg-blue-950/30">
                    <span className="text-[11px] text-gray-500 dark:text-gray-400 shrink-0">🎤 Hasil:</span>
                    <span className="flex-1 text-sm text-gray-800 dark:text-gray-200 truncate">
                      {voiceTranscript}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (voiceTranscript && activeThreadId && !voiceTranscript.endsWith("...")) {
                          sendToBackend(activeThreadId, voiceTranscript);
                          clearVoiceTranscript();
                        }
                      }}
                      disabled={isListening || voiceTranscript.endsWith("...")}
                      aria-label="Kirim pesan suara"
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 min-h-[44px] text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                      Kirim
                    </button>
                    <button
                      type="button"
                      onClick={() => clearVoiceTranscript()}
                      aria-label="Batalkan pesan suara"
                      className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-800"
                      title="Batalkan"
                    >
                      <CloseIcon className="h-5 w-5" />
                    </button>
                  </div>
                )}
                {/* Loading overlay with skeleton - shown on top while messages are loading */}
                {loadingMessages && messages.length === 0 ? (
                  <div className="absolute inset-0 z-10 flex flex-col bg-white dark:bg-gray-900">
                    <MessagesLoadingSkeleton />
                  </div>
                ) : loadingMessages ? (
                  <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-center gap-2 bg-brand-50/90 dark:bg-brand-950/90 px-4 py-2 backdrop-blur-sm">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-300 border-t-brand-600" />
                    <span className="text-sm text-brand-700 dark:text-brand-300">Memuat pesan…</span>
                  </div>
                ) : null}
                {/* Chat using assistant-ui components for iOS-safe scrolling */}
                <MalikaThread className="relative" footer={
                  <div className="malika-footer">
                    {/* Quick Replies */}
                    <MalikaQuickReplies
                      items={quickReplies}
                      onSelect={(item) => {
                        if (!activeThreadId) return;
                        if (loadingMessages || isTyping) return;
                        sendToBackend(activeThreadId, String(item.name || ""));
                      }}
                      visible={!loadingMessages && !voiceTranscript && (quickReplies.length > 0 || suggestionsLoading)}
                      loading={suggestionsLoading}
                    />
                    {/* Chat Input */}
                    <div id="chat-composer" className="malika-composer bg-white/80 backdrop-blur-xl p-3 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] dark:bg-gray-900/80 dark:shadow-[0_-4px_20px_rgba(0,0,0,0.3)]">
                      <form
                        className="flex items-end gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const form = e.currentTarget;
                          const input = form.querySelector("textarea") as HTMLTextAreaElement;
                          if (input && input.value.trim()) {
                            if (!activeThreadId) return;
                            if (loadingMessages || isTyping) return;
                            sendToBackend(activeThreadId, input.value.trim());
                            input.value = "";
                            // Hide mobile keyboard after send
                            input.blur();
                          }
                        }}
                      >
                        <textarea
                          rows={1}
                          maxLength={4000}
                          placeholder={loadingMessages ? "Memuat…" : isTyping ? "Menunggu respons…" : "Tulis pertanyaan…"}
                          disabled={loadingMessages || isTyping || !activeThreadId}
                          className="flex-1 resize-none rounded-2xl border-0 bg-gray-100/70 px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 ring-1 ring-gray-200/80 transition-all duration-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:shadow-lg focus:shadow-brand-500/5 disabled:opacity-50 dark:bg-gray-800/50 dark:text-white dark:placeholder:text-gray-500 dark:ring-gray-700 dark:focus:bg-gray-800 dark:focus:ring-brand-400/40"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              (e.currentTarget.form as HTMLFormElement)?.requestSubmit();
                            }
                          }}
                        />
                        <button
                          type="submit"
                          disabled={loadingMessages || isTyping || !activeThreadId}
                          className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-md shadow-brand-500/25 transition-all duration-200 hover:shadow-lg hover:shadow-brand-500/30 hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-40 disabled:shadow-none disabled:hover:scale-100"
                          aria-label="Kirim pesan"
                        >
                          <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L12 5M12 5L18 12M12 5V19" />
                          </svg>
                        </button>
                      </form>
                    </div>
                  </div>
                }>
                  {/* Welcome placeholder — branded onboarding from Chat MALIKA design.
                      Logo + status dot, welcome heading, "data terakhir diperbarui"
                      badge, 4 colored sample query cards, and a tour CTA. */}
                  {messages.length === 0 && !loadingMessages && !isTyping && (
                    <div className="malika-welcome-placeholder animate-in fade-in mx-auto max-w-[680px] px-4 py-8 duration-500 sm:px-6 sm:py-10">
                      {/* Hero block */}
                      <div className="flex flex-col items-center pb-6 text-center sm:pb-8">
                        <div className="relative mb-4">
                          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-lg shadow-brand-500/30 sm:h-16 sm:w-16">
                            <svg className="h-7 w-7 sm:h-8 sm:w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
                            </svg>
                          </div>
                          <span aria-hidden="true" className="absolute -top-1 -right-1 inline-block h-3 w-3 rounded-full bg-emerald-500 ring-4 ring-white dark:ring-gray-950" />
                        </div>
                        <h1 className="text-balance text-[22px] font-semibold tracking-tight text-gray-900 dark:text-white sm:text-[26px]">
                          Halo, saya MALIKA
                        </h1>
                        <p className="mt-1.5 max-w-md text-pretty text-[13.5px] leading-relaxed text-gray-600 dark:text-gray-400 sm:text-[14px]">
                          Asisten data statistik untuk Provinsi Maluku Utara. Tanyakan apa saja tentang penduduk, ekonomi, sosial, dan harga — saya akan menjawab dari publikasi resmi BPS.
                        </p>
                        <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-[11px] text-gray-500 dark:bg-white/5 dark:text-gray-400">
                          <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          Sumber data: publikasi resmi BPS Maluku Utara
                        </div>
                      </div>

                      {/* Sample query cards */}
                      <h2 className="mb-3 text-[11.5px] font-medium uppercase tracking-[0.08em] text-gray-500 dark:text-gray-400">
                        Mulai dengan contoh
                      </h2>
                      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                        {SAMPLE_QUERIES.map((cat) => {
                          const colorClasses: Record<typeof cat.color, { bg: string; ring: string; icon: string }> = {
                            sky: { bg: "bg-sky-50 dark:bg-sky-500/10", ring: "ring-sky-100 dark:ring-sky-500/20", icon: "text-sky-600 dark:text-sky-400" },
                            emerald: { bg: "bg-emerald-50 dark:bg-emerald-500/10", ring: "ring-emerald-100 dark:ring-emerald-500/20", icon: "text-emerald-600 dark:text-emerald-400" },
                            rose: { bg: "bg-rose-50 dark:bg-rose-500/10", ring: "ring-rose-100 dark:ring-rose-500/20", icon: "text-rose-600 dark:text-rose-400" },
                            violet: { bg: "bg-brand-50 dark:bg-brand-500/10", ring: "ring-brand-100 dark:ring-brand-500/20", icon: "text-brand-600 dark:text-brand-300" },
                          };
                          const c = colorClasses[cat.color];
                          // Inline icon by key so we don't pull in another component
                          const iconSvg = (() => {
                            switch (cat.iconKey) {
                              case "users":
                                return <path d="M16 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" fill="currentColor" />;
                              case "trending":
                                return <path d="M3.5 18.5l6-6.5 4 4L22 6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />;
                              case "heart":
                                return <path d="M12 21s-7-4.5-7-10a4 4 0 017-2.65A4 4 0 0119 11c0 5.5-7 10-7 10z" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />;
                              case "gauge":
                                return <g fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 14l4-4" /><circle cx={12} cy={14} r={1.5} /><path d="M3 14a9 9 0 0118 0" /></g>;
                            }
                          })();
                          return (
                            <button
                              key={cat.id}
                              type="button"
                              onClick={() => {
                                if (!activeThreadId || loadingMessages || isTyping) return;
                                sendToBackend(activeThreadId, cat.examples[0]);
                              }}
                              className="group rounded-xl bg-white p-3.5 text-left ring-1 ring-gray-200/80 transition hover:shadow-sm hover:ring-brand-300 dark:bg-gray-900 dark:ring-white/10 dark:hover:ring-brand-500/40"
                            >
                              <div className="mb-2 flex items-center gap-2.5">
                                <div className={`grid h-8 w-8 place-items-center rounded-lg ring-1 ${c.bg} ${c.ring}`}>
                                  <svg className={`h-[15px] w-[15px] ${c.icon}`} viewBox="0 0 24 24">{iconSvg}</svg>
                                </div>
                                <div className="text-[12px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                  {cat.label}
                                </div>
                              </div>
                              <div className="text-[13.5px] font-medium leading-snug text-gray-800 dark:text-gray-200">
                                {cat.examples[0]}
                              </div>
                              <div className="mt-2 flex items-center gap-1 text-[11.5px] text-brand-600 opacity-0 transition group-hover:opacity-100 dark:text-brand-300">
                                Tanyakan ini
                                <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7.293 4.707a1 1 0 011.414 0L14.414 10l-5.707 5.293a1 1 0 01-1.414-1.414L11.586 10 7.293 5.707a1 1 0 010-1z" clipRule="evenodd" /></svg>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {/* Accessibility: role="log" with aria-live for screen reader announcements */}
                  <div 
                    role="log" 
                    aria-live="polite" 
                    aria-atomic="false"
                    aria-label="Riwayat percakapan dengan MALIKA"
                  >
                    <MalikaMessages>
                      {(() => {
                        // Pagination: only render the last N messages for long conversations
                        const hasMore = messages.length > msgPageSize;
                        const visibleMessages = hasMore
                          ? messages.slice(messages.length - msgPageSize)
                          : messages;

                        // Find last assistant text message ID to attach persisted thinking section
                        const lastAssistantTextId = !isTyping && thinkingItems.length > 0
                          ? [...messages].reverse().find(m => m.position === "left" && m.type === "text")?._id
                          : null;

                        return (
                          <>
                            {/* Load-more button for paginated view */}
                            {hasMore && (
                              <div className="flex justify-center py-2">
                                <button
                                  type="button"
                                  onClick={() => setMsgPageSize(prev => prev + MSG_PAGE_INCREMENT)}
                                  className="rounded-full bg-gray-100 px-4 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                                >
                                  Muat {Math.min(MSG_PAGE_INCREMENT, messages.length - msgPageSize)} pesan sebelumnya
                                </button>
                              </div>
                            )}
                            {visibleMessages.map((msg) => {
                        const key = msg._id || `msg_${msg.createdAt}`;
                        
                        // System messages (date separators)
                        if (msg.type === "system") {
                          return (
                            <MalikaSystemMessage key={key}>
                              {msg.content?.text || ""}
                            </MalikaSystemMessage>
                          );
                        }

                        // Pre-render content; skip entirely if null (avoids empty bubbles)
                        const content = renderMessageContent(msg);
                        if (content === null || content === undefined) return null;
                        
                        // User messages (right side)
                        if (msg.position === "right") {
                          const isMsgEditing = editingMessageId === msg._id;
                          return (
                            <MalikaUserMessage 
                              key={key} 
                              hasTime={msg.hasTime} 
                              createdAt={msg.createdAt}
                              isEditing={isMsgEditing}
                              editingText={isMsgEditing ? editingText : undefined}
                              onEditChange={(text) => setEditingText(text)}
                              onEdit={!isTyping ? () => {
                                const text = msg.content?.text;
                                if (!text) return;
                                setEditingMessageId(msg._id);
                                setEditingText(text);
                              } : undefined}
                              onEditCancel={() => {
                                setEditingMessageId(null);
                                setEditingText("");
                              }}
                              onEditSave={() => {
                                const trimmed = editingText.trim();
                                if (!trimmed || !activeThreadId) return;

                                // Abort any in-flight stream before re-sending
                                if (pendingSendRef.current) {
                                  pendingSendRef.current.abort();
                                  pendingSendRef.current = null;
                                  setIsTyping(false);
                                  markAllStepsDone();
                                }

                                // Find the index of this user message
                                const msgIndex = messages.findIndex(m => m._id === msg._id);
                                if (msgIndex === -1) return;

                                // Remove all messages AFTER this user message (assistant responses)
                                const msgsAfter = messages.slice(msgIndex + 1);
                                for (const m of msgsAfter) {
                                  removeMsg(m._id);
                                }

                                // Remove the original user message too
                                removeMsg(msg._id);

                                // Clear editing state
                                setEditingMessageId(null);
                                setEditingText("");

                                // Send the edited message as a new message
                                sendToBackend(activeThreadId, trimmed);
                              }}
                            >
                              {content}
                            </MalikaUserMessage>
                          );
                        }
                        
                        // Assistant messages (left side) - includes typing indicator
                        const isFailed = msg.content?.isFailed === true;
                        // Only show response time on the bubble that shows the clock (hasTime=true)
                        // This avoids showing duration on the first bubble when 2 bubbles are rendered
                        const rTimeMs = msg.hasTime
                          ? (msg.content?.responseTimeMs || (activeThreadId ? responseTimeRef.current.get(activeThreadId) : undefined))
                          : undefined;
                        
                        // Attach persisted thinking timeline to the last assistant text bubble
                        const showPersistedThinking = lastAssistantTextId && msg._id === lastAssistantTextId;
                        
                        return (
                          <MalikaAssistantMessage 
                            key={key}
                            hasTime={msg.hasTime}
                            createdAt={msg.createdAt}
                            copyText={msg.content?.text || ""}
                            responseTimeMs={rTimeMs}
                            modelLabel={msg.content?.modelLabel || undefined}
                            tokenInfo={msg.content?.tokenInfo}
                            onRegenerate={isFailed && lastFailedMessage ? retryLastMessage : undefined}
                            isRegenerating={isFailed && isRetrying}
                          >
                            {showPersistedThinking && (thinkingItems.length > 0 || reasoningText || pipelineText) && (
                              <div className="mb-2">
                                <ThinkingFeed
                                  thinkingItems={thinkingItems}
                                  pipelineText={pipelineText}
                                  reasoningText={reasoningText}
                                  isStreaming={false}
                                  isThinkingActive={false}
                                  isExpanded={showThinking}
                                  onToggle={() => setShowThinking(!showThinking)}
                                />
                              </div>
                            )}
                            {content}
                          </MalikaAssistantMessage>
                        );
                      })}
                          </>
                        );
                      })()}
                    </MalikaMessages>
                  </div>
                </MalikaThread>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Export JSON Modal */}
      <ChatExportModal
        isOpen={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        jsonData={exportJsonData}
        filename={exportFilename}
        copySuccess={copySuccess}
        onCopy={handleCopyJson}
        onDownload={handleDownloadJson}
      />

      {/* Rating Modal - triggered when user says "terima kasih" */}
      <ChatRatingModal
        isOpen={ratingModalOpen}
        onClose={closeRatingModal}
        stars={ratingStars}
        setStars={setRatingStars}
        review={ratingReview}
        setReview={setRatingReview}
        isSubmitting={ratingSubmitting}
        isSubmitted={ratingSubmitted}
        onSubmit={submitRating}
      />

      {/* Keyboard Shortcuts Help Modal */}
      <ChatShortcutsModal isOpen={showShortcutsModal} onClose={() => setShowShortcutsModal(false)} />
    </div>
  );
}
