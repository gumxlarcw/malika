"use client";

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";
import type { ProcessStep } from "@/components/chat/ProcessIndicator";
import type { ToolCallEvent, ToolResultEvent } from "@/lib/chatTransport";

/** Tracked tool call with call + result paired together */
export interface TrackedToolCall {
  toolName: string;
  callId: string;
  args: Record<string, unknown>;
  message: string;
  startedAt: number;
  /** Filled when tool_result arrives */
  result?: {
    summary: string;
    found: boolean;
    cached: boolean;
    elapsedMs: number | null;
  };
}

interface ChatProcessContextValue {
  /** True while MALIKA is generating a response */
  isChatProcessing: boolean;
  /** ThreadId currently being processed */
  processingThreadId: number | null;
  /** Timestamp when processing started — used to keep timer accurate across nav */
  processingStartedAt: number | null;
  /** Signal that processing started */
  startProcessing: (threadId?: number) => void;
  /** Signal that processing finished (triggers toast + notification) */
  finishProcessing: (preview?: string) => void;
  /** Last completed message preview (first ~80 chars) */
  lastCompletedPreview: string | null;
  /** Clear the completion (after toast is dismissed) */
  clearCompletion: () => void;
  /** Timestamp of last completion — used to trigger effects */
  completedAt: number | null;
  /** True if user navigated away from /chat while processing was active */
  navigatedAway: boolean;
  /** Mark that user navigated away from chat during processing */
  markNavigatedAway: () => void;

  // --- Unified process steps (state + ref for persistence across remounts) ---
  /** Current process steps — drives UI rendering */
  processSteps: ProcessStep[];
  /** Push a new step (marks previous active steps as done) */
  pushStep: (step: ProcessStep) => void;
  /** Attach detail to a step by stage name */
  pushStepDetail: (stage: string, detail: string, detailStatus?: "ok" | "warn" | "empty") => void;
  /** Mark all steps as done */
  markAllStepsDone: () => void;
  /** Set steps directly (e.g., restore from ref after remount) */
  setProcessSteps: (steps: ProcessStep[] | ((prev: ProcessStep[]) => ProcessStep[])) => void;
  /** Clear all steps */
  clearSteps: () => void;

  // --- Tool call tracking ---
  /** Tracked tool calls for current processing */
  toolCalls: TrackedToolCall[];
  /** Push a new tool call */
  pushToolCall: (data: ToolCallEvent) => void;
  /** Update a tool call with its result */
  pushToolResult: (data: ToolResultEvent) => void;
  /** Clear tool calls */
  clearToolCalls: () => void;
}

const ChatProcessContext = createContext<ChatProcessContextValue>({
  isChatProcessing: false,
  processingThreadId: null,
  processingStartedAt: null,
  startProcessing: () => {},
  finishProcessing: () => {},
  lastCompletedPreview: null,
  clearCompletion: () => {},
  completedAt: null,
  navigatedAway: false,
  markNavigatedAway: () => {},
  processSteps: [],
  pushStep: () => {},
  pushStepDetail: () => {},
  markAllStepsDone: () => {},
  setProcessSteps: () => {},
  clearSteps: () => {},
  toolCalls: [],
  pushToolCall: () => {},
  pushToolResult: () => {},
  clearToolCalls: () => {},
});

export function ChatProcessProvider({ children }: { children: ReactNode }) {
  const [isChatProcessing, setIsChatProcessing] = useState(false);
  const [processingThreadId, setProcessingThreadId] = useState<number | null>(null);
  const [processingStartedAt, setProcessingStartedAt] = useState<number | null>(null);
  const [lastCompletedPreview, setLastCompletedPreview] = useState<string | null>(null);
  const [completedAt, setCompletedAt] = useState<number | null>(null);
  const [navigatedAway, setNavigatedAway] = useState(false);
  const processingRef = useRef(false);
  const navigatedAwayRef = useRef(false);

  // --- Unified process steps: useState for rendering + shadow ref for persistence ---
  const [processSteps, _setProcessSteps] = useState<ProcessStep[]>([]);
  // Shadow ref: keeps steps in sync so getSteps() returns current data
  // even from stale closures (SSE callbacks captured at mount time)
  const stepsRef = useRef<ProcessStep[]>([]);

  /** Wrapper that updates both state and ref atomically */
  const setProcessSteps = useCallback((updater: ProcessStep[] | ((prev: ProcessStep[]) => ProcessStep[])) => {
    _setProcessSteps((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      stepsRef.current = next;
      return next;
    });
  }, []);

  const pushStep = useCallback((step: ProcessStep) => {
    setProcessSteps((prev) => {
      // Skip duplicate stage
      if (prev.some((s) => s.stage === step.stage)) return prev;
      // Mark previous active steps as done
      const now = Date.now();
      const updated = prev.map((s) =>
        s.status === "active" ? { ...s, status: "done" as const, doneAt: now } : s
      );
      return [...updated, step];
    });
  }, [setProcessSteps]);

  const pushStepDetail = useCallback((stage: string, detail: string, detailStatus?: "ok" | "warn" | "empty") => {
    setProcessSteps((prev) =>
      prev.map((s) => (s.stage === stage ? { ...s, detail, ...(detailStatus ? { detailStatus } : {}) } : s))
    );
  }, [setProcessSteps]);

  const markAllStepsDone = useCallback(() => {
    setProcessSteps((prev) => {
      const now = Date.now();
      return prev.map((s) =>
        s.status === "active" ? { ...s, status: "done" as const, doneAt: s.doneAt ?? now } : s
      );
    });
  }, [setProcessSteps]);

  const clearSteps = useCallback(() => {
    setProcessSteps([]);
  }, [setProcessSteps]);

  // --- Tool call tracking ---
  const [toolCalls, _setToolCalls] = useState<TrackedToolCall[]>([]);
  const toolCallsRef = useRef<TrackedToolCall[]>([]);

  const setToolCalls = useCallback((updater: TrackedToolCall[] | ((prev: TrackedToolCall[]) => TrackedToolCall[])) => {
    _setToolCalls((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      toolCallsRef.current = next;
      return next;
    });
  }, []);

  const pushToolCall = useCallback((data: ToolCallEvent) => {
    setToolCalls((prev) => {
      // Deduplicate by callId
      if (prev.some((tc) => tc.callId === data.callId)) return prev;
      return [...prev, {
        toolName: data.toolName,
        callId: data.callId,
        args: data.args,
        message: data.message,
        startedAt: Date.now(),
      }];
    });
  }, [setToolCalls]);

  const pushToolResult = useCallback((data: ToolResultEvent) => {
    setToolCalls((prev) =>
      prev.map((tc) => {
        // Match by toolName (callId may be null in some cases)
        if ((data.callId && tc.callId === data.callId) || (!data.callId && tc.toolName === data.toolName && !tc.result)) {
          return {
            ...tc,
            result: {
              summary: data.summary,
              found: data.found,
              cached: data.cached,
              elapsedMs: data.elapsedMs,
            },
          };
        }
        return tc;
      })
    );
  }, [setToolCalls]);

  const clearToolCalls = useCallback(() => {
    setToolCalls([]);
  }, [setToolCalls]);

  const startProcessing = useCallback((threadId?: number) => {
    processingRef.current = true;
    navigatedAwayRef.current = false;
    setProcessSteps([]); // Reset steps for new processing
    setToolCalls([]); // Reset tool calls for new processing
    setIsChatProcessing(true);
    setProcessingThreadId(threadId ?? null);
    setProcessingStartedAt(Date.now());
    setNavigatedAway(false);
    setLastCompletedPreview(null);
    setCompletedAt(null);

    // Request notification permission proactively
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  const finishProcessing = useCallback((preview?: string) => {
    if (!processingRef.current) return; // Avoid double-fire
    processingRef.current = false;
    setIsChatProcessing(false);

    const snippet = preview
      ? preview.length > 80
        ? preview.slice(0, 80) + "…"
        : preview
      : "Respons MALIKA sudah siap.";
    setLastCompletedPreview(snippet);
    setCompletedAt(Date.now());

    // Push notification — only when user navigated away from /chat
    if (navigatedAwayRef.current) {
      try {
        if (
          typeof window !== "undefined" &&
          "Notification" in window &&
          Notification.permission === "granted"
        ) {
          // Prefer service worker notification (works when PWA is minimized)
          if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.ready
              .then((registration) => {
                registration.showNotification("MALIKA", {
                  body: snippet,
                  icon: "/images/pwa/icon-192.png",
                  badge: "/images/pwa/icon-96.png",
                  tag: "malika-chat-done",
                  renotify: true,
                  data: { url: "/chat", receivedAt: Date.now() },
                } as NotificationOptions);
              })
              .catch(() => {});
          } else {
            // Fallback to basic Notification API
            new Notification("MALIKA", {
              body: snippet,
              icon: "/images/pwa/icon-192.png",
              tag: "malika-chat-done",
            });
          }
        }
      } catch {
        // Notification API not available
      }
    }
  }, []);

  const markNavigatedAway = useCallback(() => {
    navigatedAwayRef.current = true;
    setNavigatedAway(true);
  }, []);

  const clearCompletion = useCallback(() => {
    setLastCompletedPreview(null);
    setCompletedAt(null);
    navigatedAwayRef.current = false;
    setNavigatedAway(false);
  }, []);

  return (
    <ChatProcessContext.Provider
      value={{
        isChatProcessing,
        processingThreadId,
        processingStartedAt,
        startProcessing,
        finishProcessing,
        lastCompletedPreview,
        clearCompletion,
        completedAt,
        navigatedAway,
        markNavigatedAway,
        processSteps,
        pushStep,
        pushStepDetail,
        markAllStepsDone,
        setProcessSteps,
        clearSteps,
        toolCalls,
        pushToolCall,
        pushToolResult,
        clearToolCalls,
      }}
    >
      {children}
    </ChatProcessContext.Provider>
  );
}

export function useChatProcess() {
  return useContext(ChatProcessContext);
}
