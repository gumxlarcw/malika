import type { ReactNode } from "react";
import { ChatProcessProvider } from "@/context/ChatProcessContext";

// Note: @chatui/core CSS removed - using assistant-ui.css instead
// chatui-overrides.css kept for .Bubble classes still used in message rendering
import "./chatui-overrides.css";
import "@/components/chat/assistant-ui.css";

export default function ChatLayout({ children }: { children: ReactNode }) {
  return <ChatProcessProvider>{children}</ChatProcessProvider>;
}
