/**
 * Chat Transport Layer for Vercel AI SDK
 *
 * Custom transport that connects the AI SDK's useChat hook to our
 * thread-based backend API, handling SSE proxying, metadata extraction,
 * and message persistence.
 *
 * Key differences from default transport:
 * - Thread-based (POST /api/chat/threads/:id/stream)
 * - Custom SSE events: intent, malika_ui, thinking, status
 * - Auth via x-malika-uid header
 * - Backward-compatible with legacy SSE protocol
 */

import { CHAT_API_BASE } from "@/lib/chatConstants";
import type { ThinkingItem } from "@/types/chat";

/** Re-export retained for backward compatibility — context state types still reference it. */
export type ThinkingEvent = ThinkingItem;

/**
 * SSE events emitted by the live backend.
 * `status` was re-wired into streaming.service.js: 5 stages emit progress
 * updates ("Mengenali topik…" → "Mencari sumber data…" → … → "Berpikir &
 * menyusun jawaban…") so the chat UI can render a step list.
 * The V2 refactor's richer events (thinking, status_detail, tool_call,
 * tool_result, suggestions_update) remain unwired — the matching frontend
 * components were trimmed in commit b4bde20.
 */
export type SSEEventType =
  | "text"
  | "chunk"    // V1 legacy format (greeting handler)
  | "status"
  | "intent"
  | "malika_ui"
  | "user_saved"
  | "thread_updated"
  | "done"
  | "error"
  | "heartbeat";

export interface SSEEvent {
  event: SSEEventType;
  data: any;
}

/** Retained for ChatProcessContext state shape — never populated at runtime. */
export interface ToolCallEvent {
  toolName: string;
  callId: string;
  args: Record<string, unknown>;
  message: string;
}

/** Retained for ChatProcessContext state shape — never populated at runtime. */
export interface ToolResultEvent {
  toolName: string;
  callId: string | null;
  summary: string;
  found: boolean;
  cached: boolean;
  elapsedMs: number | null;
}

export interface StatusEvent {
  message: string;
  stage: "normalize" | "search" | "preview" | "knowledge" | "thinking" | string;
}

export interface StreamCallbacks {
  onUserSaved?: (data: { id: number }) => void;
  onThreadUpdated?: (data: { title: string; topics?: string }) => void;
  onIntent?: (data: IntentEvent) => void;
  onMalikaUi?: (data: any) => void;
  onStatus?: (data: StatusEvent) => void;
  onText?: (data: { content: string }) => void;
  onDone?: (data: { full_text: string }) => void;
  onError?: (data: { message: string }) => void;
}

export interface IntentEvent {
  datasource: any;
  candidates: Array<{ id: number; name: string; type: string }>;
  hasPreview: boolean;
  effectiveQuery: string | null;
  periodFallback: any;
  modelTier?: string;
}

/**
 * Parse SSE text stream into events.
 * Handles the `event: X\ndata: {...}\n\n` format.
 */
export function* parseSSEEvents(text: string): Generator<SSEEvent> {
  const blocks = text.split("\n\n");
  for (const block of blocks) {
    if (!block.trim()) continue;

    const lines = block.split("\n");
    let eventType: SSEEventType = "text";
    let dataStr = "";

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        eventType = line.slice(7).trim() as SSEEventType;
      } else if (line.startsWith("data: ")) {
        dataStr += line.slice(6);
      }
    }

    if (dataStr) {
      try {
        yield { event: eventType, data: JSON.parse(dataStr) };
      } catch (e) {
        // Log malformed JSON for debugging
        console.warn('[chatTransport] Malformed SSE JSON:', eventType, dataStr.slice(0, 200));
        // Emit as error event so callers get notified of data loss
        yield { event: "error" as SSEEventType, data: { message: `Malformed ${eventType} event`, event: eventType } };
      }
    }
  }
}

/**
 * Stream a message to the backend and consume SSE events.
 *
 * Includes automatic retry on network failures (up to 2 retries with
 * exponential backoff). Does NOT retry on server errors (4xx/5xx) or
 * user-initiated aborts.
 *
 * @returns AbortController for cancellation
 */
export function streamMessage(
  threadId: number,
  text: string,
  malikaUid: string,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  options?: { model?: string }
): AbortController {
  const controller = new AbortController();
  const MAX_RETRIES = 2;
  const BASE_DELAY_MS = 1500;

  // Merge external signal
  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  const url = `${CHAT_API_BASE}/threads/${threadId}/stream`;

  const attemptStream = async (attempt: number) => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-malika-uid": malikaUid,
        },
        body: JSON.stringify({ text, model: options?.model || "claude-haiku-4-5" }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        callbacks.onError?.({ message: `Server error: ${res.status}` });
        return; // Don't retry server errors
      }

      if (!res.body) {
        callbacks.onError?.({ message: "No stream body" });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Split on double-newline boundaries
        const parts = buffer.split("\n\n");
        // Keep the last potentially-incomplete chunk
        buffer = parts.pop() || "";

        for (const part of parts) {
          if (!part.trim()) continue;

          for (const evt of parseSSEEvents(part + "\n\n")) {
            switch (evt.event) {
              case "user_saved":
                callbacks.onUserSaved?.(evt.data);
                break;
              case "thread_updated":
                callbacks.onThreadUpdated?.(evt.data);
                break;
              case "intent":
                callbacks.onIntent?.(evt.data);
                break;
              case "status":
                callbacks.onStatus?.(evt.data);
                break;
              case "text":
                callbacks.onText?.(evt.data);
                break;
              case "chunk":
                // V1 compat: chunk uses {text} → map to onText {content}
                callbacks.onText?.({ content: evt.data?.text || "" });
                break;
              case "malika_ui":
                callbacks.onMalikaUi?.(evt.data);
                break;
              case "done":
                callbacks.onDone?.(evt.data);
                break;
              case "error":
                callbacks.onError?.(evt.data);
                break;
              case "heartbeat":
                // Keep-alive, no action needed
                break;
            }
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        for (const evt of parseSSEEvents(buffer + "\n\n")) {
          switch (evt.event) {
            case "text":
              callbacks.onText?.(evt.data);
              break;
            case "chunk":
              callbacks.onText?.({ content: evt.data?.text || "" });
              break;
            case "done":
              callbacks.onDone?.(evt.data);
              break;
            case "malika_ui":
              callbacks.onMalikaUi?.(evt.data);
              break;
            case "error":
              callbacks.onError?.(evt.data);
              break;
            case "heartbeat":
              break;
          }
        }
      }
    } catch (err: any) {
      if (err.name === "AbortError") return;

      // Network error — retry with exponential backoff
      if (attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(`[chatTransport] Network error (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delay}ms:`, err.message);
        await new Promise((r) => setTimeout(r, delay));
        if (!controller.signal.aborted) {
          return attemptStream(attempt + 1);
        }
        return;
      }

      callbacks.onError?.({ message: err.message || "Network error" });
    }
  };

  attemptStream(0).catch((err) => {
    if (err?.name === "AbortError") return;
    callbacks.onError?.({ message: err?.message || "Unexpected stream error" });
  });

  return controller;
}
