"use client";

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * Open/close state for the chat modal.
 *
 * Chat used to be a route of its own, which meant leaving whatever page you
 * were reading to ask about it. It is a dialog now, so the numbers stay on
 * screen behind it. `/chat` still resolves — deep links, shared links and
 * no-JS all keep working — but the navigation opens the dialog instead.
 */

type ChatModalValue = {
  open: boolean;
  /** Text handed over from a page's own ask box, consumed once on open. */
  carriedDraft: string;
  openChat: (draft?: string) => void;
  closeChat: () => void;
  consumeCarriedDraft: () => string;
};

const ChatModalContext = createContext<ChatModalValue | null>(null);

export function ChatModalProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [carriedDraft, setCarriedDraft] = useState("");

  const openChat = useCallback((draft?: string) => {
    setCarriedDraft(draft?.trim() ?? "");
    setOpen(true);
  }, []);

  const closeChat = useCallback(() => setOpen(false), []);

  /* Read-once: reopening the dialog later must not resurrect an old question. */
  const consumeCarriedDraft = useCallback(() => {
    let value = "";
    setCarriedDraft((current) => {
      value = current;
      return "";
    });
    return value;
  }, []);

  const value = useMemo(
    () => ({ open, carriedDraft, openChat, closeChat, consumeCarriedDraft }),
    [open, carriedDraft, openChat, closeChat, consumeCarriedDraft],
  );

  return <ChatModalContext.Provider value={value}>{children}</ChatModalContext.Provider>;
}

/** Null outside the provider, so a page can render without knowing about it. */
export function useChatModal(): ChatModalValue | null {
  return useContext(ChatModalContext);
}
