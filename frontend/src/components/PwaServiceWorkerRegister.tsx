"use client";

import { useEffect } from "react";
import { enqueueRequest, flushQueue } from "@/lib/offlineQueue";

export default function PwaServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((registration) => registration.update().catch(() => undefined))
      .catch(() => {
        // intentionally silent; SW is optional
      });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if ((window as any).__MALIKA_FETCH_WRAPPED__) return;
    (window as any).__MALIKA_FETCH_WRAPPED__ = true;

    const originalFetch = window.fetch.bind(window);

    const isQueueable = (req: Request) => {
      const method = req.method.toUpperCase();
      if (["GET", "HEAD", "OPTIONS"].includes(method)) return false;
      if (req.headers.get("accept")?.includes("text/event-stream")) return false;
      const url = new URL(req.url);
      if (url.origin !== window.location.origin) return false;
      if (url.pathname.startsWith("/api/chat")) return false;
      if (url.pathname.startsWith("/api/insights")) return false;
      if (url.pathname.startsWith("/api/data-preview")) return false;
      return true;
    };

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (!isQueueable(request)) return originalFetch(request);

      const contentType = request.headers.get("content-type") || "";
      const canSerialize =
        contentType.includes("application/json") ||
        contentType.includes("text/") ||
        contentType.includes("application/x-www-form-urlencoded");

      if (!navigator.onLine) {
        if (!canSerialize) {
          return new Response(JSON.stringify({ queued: false, reason: "offline-unsupported" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          });
        }

        const body = request.clone() ? await request.clone().text() : null;
        const headers: Record<string, string> = {};
        request.headers.forEach((value, key) => {
          headers[key] = value;
        });
        enqueueRequest({
          url: request.url,
          method: request.method,
          headers,
          body,
        });

        return new Response(JSON.stringify({ queued: true }), {
          status: 202,
          headers: { "content-type": "application/json" },
        });
      }

      try {
        return await originalFetch(request);
      } catch {
        if (!canSerialize) throw new Error("offline-network-error");
        const body = request.clone() ? await request.clone().text() : null;
        const headers: Record<string, string> = {};
        request.headers.forEach((value, key) => {
          headers[key] = value;
        });
        enqueueRequest({
          url: request.url,
          method: request.method,
          headers,
          body,
        });
        return new Response(JSON.stringify({ queued: true }), {
          status: 202,
          headers: { "content-type": "application/json" },
        });
      }
    };

    const onOnline = () => flushQueue(originalFetch);
    window.addEventListener("online", onOnline);
    if (navigator.onLine) flushQueue(originalFetch);

    return () => window.removeEventListener("online", onOnline);
  }, []);

  return null;
}
