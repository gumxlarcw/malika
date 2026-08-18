"use client";

import { useEffect } from "react";
import { useChatModal } from "@/context/ChatModalContext";

/**
 * Turns a plain left click on any `/chat` link into opening the dialog.
 *
 * Mounted once at the root so it covers the landing page as well as the pages
 * below it — chat is reachable from both, and only one of them sits inside the
 * app shell.
 *
 * The links keep their real hrefs on purpose: middle click, ctrl/cmd click,
 * "open in new tab", a shared URL and a no-JS visit all still land on the
 * route, which is why nothing here rewrites markup.
 */
export default function ChatLinkInterceptor() {
  const chatModal = useChatModal();

  useEffect(() => {
    if (!chatModal) return;

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest?.("a");
      if (!anchor) return;
      // Compare the resolved pathname, not the literal attribute: the same link
      // is written as "/chat" in the nav and as an absolute URL in the footer.
      const href = anchor.getAttribute("href");
      if (!href) return;
      let path: string;
      try {
        path = new URL(href, window.location.origin).pathname;
      } catch {
        return;
      }
      if (path !== "/chat") return;
      e.preventDefault();
      chatModal.openChat();
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [chatModal]);

  return null;
}
