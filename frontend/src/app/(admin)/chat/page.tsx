import type { Metadata } from "next";
import React, { Suspense } from "react";

import ChatPageClient from "./ChatPageClient";
import ChatLoading from "./loading";

export const metadata: Metadata = {
  title: "Chat MALIKA",
  description: "Chat dengan MALIKA - Customer Service BPS Maluku Utara",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function ChatPage() {
  return (
    <Suspense fallback={<ChatLoading />}>
      <ChatPageClient />
    </Suspense>
  );
}
