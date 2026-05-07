/**
 * useLocalMessages hook
 * Manages local chat message state with normalization and day separators
 * Extracted from ChatPageClient.tsx
 */

import { useCallback, useState } from "react";
import type { ChatUiMessage } from "@/types/chat";
import {
  normalizeChatUiMessage,
  toDayStartMs,
  fmtFullDateId,
} from "@/lib/chatUtils";

export interface UseLocalMessagesReturn {
  messages: ChatUiMessage[];
  resetList: (list?: any[]) => void;
  appendMsg: (msg: any) => string;
  updateMsg: (id: string, patch: any) => void;
  removeMsg: (id: string) => void;
}

/**
 * Hook to manage local chat messages with automatic normalization
 * and day separator insertion
 */
export function useLocalMessages(initial: any[] = []): UseLocalMessagesReturn {
  const [messages, setMessages] = useState<ChatUiMessage[]>(() =>
    initial.map((m) => normalizeChatUiMessage(m))
  );

  const resetList = useCallback((list: any[] = []) => {
    setMessages(list.map((m) => normalizeChatUiMessage(m)));
  }, []);

  const appendMsg = useCallback((msg: any) => {
    const normalized = normalizeChatUiMessage(msg);
    setMessages((prev) => {
      // Find last non-system message so separators don't interfere.
      let lastNonSystem: ChatUiMessage | null = null;
      for (let i = prev.length - 1; i >= 0; i -= 1) {
        const candidate = prev[i];
        if (candidate?.type !== "system") {
          lastNonSystem = candidate;
          break;
        }
      }

      // For regular messages, always show time under bubble.
      if (normalized.type !== "system") {
        const prevDay = lastNonSystem?.createdAt
          ? toDayStartMs(lastNonSystem.createdAt)
          : null;
        const nextDay = normalized.createdAt
          ? toDayStartMs(normalized.createdAt)
          : null;
        const dayChanged = !prevDay || (nextDay != null && prevDay !== nextDay);

        if (dayChanged && nextDay != null) {
          const sepId = `day_${nextDay}`;
          const already = prev.some((m) => m._id === sepId);
          const sep: ChatUiMessage = {
            _id: sepId,
            type: "system",
            content: { text: fmtFullDateId(nextDay) },
            position: "center",
            createdAt: nextDay,
            hasTime: false,
          };
          if (!already) {
            return [...prev, sep, { ...normalized, hasTime: true }];
          }
        }

        return [...prev, { ...normalized, hasTime: true }];
      }

      return [...prev, { ...normalized, hasTime: false }];
    });
    return normalized._id;
  }, []);

  const updateMsg = useCallback((id: string, patch: any) => {
    setMessages((prev) =>
      prev.map((m) =>
        m._id === id ? normalizeChatUiMessage({ ...m, ...patch }, id) : m
      )
    );
  }, []);

  const removeMsg = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m._id !== id));
  }, []);

  return { messages, resetList, appendMsg, updateMsg, removeMsg };
}

export default useLocalMessages;
